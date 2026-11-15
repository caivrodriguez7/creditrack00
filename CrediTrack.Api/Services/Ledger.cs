using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Services;

// How much of one credit has been paid, and its status (unpaid / partial / paid)
public record CreditState(decimal Paid, decimal Remaining, string Status);

// Just the columns the payment-allocation rule needs
public record SlimTx(int Id, int CustomerId, string Type, decimal Amount, DateTime Date, bool Voided);

// The one place that knows how balances and transaction statuses are calculated.
public static class Ledger
{
    public static string Code(int number) => "TRX-" + number.ToString("0000");

    public static object CustomerDto(Customer c, decimal balance, string? photo = null, int overdueDays = 0) => new
    {
        id = c.Id,
        code = c.Code,
        name = c.Name,
        phone = c.Phone ?? "",
        archived = c.IsArchived,
        archivedAt = c.ArchivedAt,
        createdAt = c.CreatedAt,
        updatedAt = c.UpdatedAt,
        balance,
        linked = c.LinkedUserId != null && !c.IsDisconnected,
        photo = photo ?? "",     // the linked customer account's profile photo (empty when none or not linked)
        overdueDays          // days since the customer's oldest overdue credit (0 = not overdue); from OverdueRule.OverdueCustomerDays
    };

    // customerId -> profile photo of the linked, still-connected customer account (customers without a photo are left out)
    public static async Task<Dictionary<int, string>> Photos(AppDb db, IEnumerable<Customer> customers)
    {
        var byUser = customers.Where(c => c.LinkedUserId != null && !c.IsDisconnected)
            .GroupBy(c => c.LinkedUserId!.Value).ToDictionary(g => g.Key, g => g.Select(c => c.Id).ToList());
        if (byUser.Count == 0) return new();
        var ids = byUser.Keys.ToList();
        var users = await db.Users.Where(u => ids.Contains(u.Id) && u.PhotoPath != null)
            .Select(u => new { u.Id, u.PhotoPath }).ToListAsync();
        var result = new Dictionary<int, string>();
        foreach (var u in users)
            foreach (var customerId in byUser[u.Id]) result[customerId] = FileStorage.Url(u.PhotoPath);
        return result;
    }

    // customerId -> outstanding balance (credits minus payments; voided ones do not count)
    public static async Task<Dictionary<int, decimal>> Balances(AppDb db, int storeId)
    {
        var rows = await db.Transactions
            .Where(t => t.StoreId == storeId && !t.IsVoided)
            .GroupBy(t => new { t.CustomerId, t.Type })
            .Select(g => new { g.Key.CustomerId, g.Key.Type, Total = g.Sum(t => t.Amount) })
            .ToListAsync();

        var result = new Dictionary<int, decimal>();
        foreach (var r in rows)
        {
            var current = result.GetValueOrDefault(r.CustomerId);
            result[r.CustomerId] = current + (r.Type == "credit" ? r.Total : -r.Total);
        }
        return result;
    }

    // The balance of one customer
    public static async Task<decimal> BalanceOf(AppDb db, int customerId)
    {
        var rows = await db.Transactions
            .Where(t => t.CustomerId == customerId && !t.IsVoided)
            .GroupBy(t => t.Type)
            .Select(g => new { Type = g.Key, Total = g.Sum(t => t.Amount) })
            .ToListAsync();
        return rows.Sum(r => r.Type == "credit" ? r.Total : -r.Total);
    }

    // A customer's payments are applied to their oldest credits first, so
    // Unpaid / Partially paid / Paid always agrees with the customer's balance.
    public static Dictionary<int, CreditState> ComputeStates(IEnumerable<SlimTx> txs)
    {
        var list = txs.Where(t => !t.Voided).ToList();
        var pool = new Dictionary<int, decimal>();   // payment money still to apply, per customer
        foreach (var t in list.Where(t => t.Type == "payment"))
            pool[t.CustomerId] = pool.GetValueOrDefault(t.CustomerId) + t.Amount;

        var result = new Dictionary<int, CreditState>();
        foreach (var t in list.Where(t => t.Type == "credit").OrderBy(t => t.Date).ThenBy(t => t.Id))
        {
            var available = pool.GetValueOrDefault(t.CustomerId);
            var applied = Math.Min(t.Amount, available);
            pool[t.CustomerId] = available - applied;
            var remaining = t.Amount - applied;
            result[t.Id] = new CreditState(applied, remaining,
                remaining <= 0 ? "paid" : applied > 0 ? "partial" : "unpaid");
        }
        return result;
    }

    // Credit states for a whole store, reading only the few columns needed (no items)
    public static async Task<Dictionary<int, CreditState>> CreditStates(AppDb db, int storeId)
    {
        var rows = await db.Transactions.Where(t => t.StoreId == storeId)
            .Select(t => new SlimTx(t.Id, t.CustomerId, t.Type, t.Amount, t.Date, t.IsVoided))
            .ToListAsync();
        return ComputeStates(rows);
    }

    // A credit's note is the names of its items. They are stored once (TransactionItems), not copied into Transactions.Note.
    private static string? CreditNote(Transaction t)
    {
        var names = string.Join(", ", t.Items.OrderBy(i => i.Id).Select(i => i.Name));
        return names.Length > 0 ? names : null;
    }

    // One transaction in the shape the frontend pages expect
    // forCustomer: the customer sees when and why a record was voided, but not which staff account did it.
    public static Dictionary<string, object?> BuildRow(Transaction t, Customer? c, CreditState? state, bool forCustomer = false)
    {
        var d = new Dictionary<string, object?>
        {
            ["id"] = t.Id,
            ["code"] = Code(t.Number),
            ["customerId"] = t.CustomerId,
            ["customer"] = c?.Name,
            ["customerCode"] = c?.Code ?? "",
            ["type"] = t.Type,
            ["amount"] = t.Amount,
            ["date"] = t.Date,
            ["note"] = t.Type == "credit" ? CreditNote(t) : t.Note,
            ["voided"] = t.IsVoided
        };
        if (t.Type == "credit")
        {
            var paid = t.IsVoided ? 0m : state?.Paid ?? 0m;
            var remaining = t.IsVoided ? 0m : state?.Remaining ?? t.Amount;
            d["dueDate"] = t.DueDate?.ToString("yyyy-MM-dd");   // null = no due date
            d["paidAmount"] = paid;
            d["remaining"] = remaining;
            d["status"] = t.IsVoided ? "voided" : state?.Status ?? "unpaid";
            d["items"] = t.Items.OrderBy(i => i.Id).Select(i => new
            {
                name = i.Name, qty = i.Qty, qtyText = i.QtyText, unit = i.Unit, price = i.Price
            }).ToList();
        }
        else
        {
            d["method"] = t.Method;
            d["reference"] = t.Reference;
            d["balanceBefore"] = t.BalanceBefore;
            d["status"] = t.IsVoided ? "voided" : "confirmed";
            d["paymentStatus"] = d["status"];
        }
        if (t.IsVoided)
        {
            d["voidedAt"] = t.VoidedAt;
            d["voidReason"] = t.VoidReason;
            d["voidRemarks"] = t.VoidRemarks;
            // The shape the pages read: when, who (owner only), why
            d["voidInfo"] = new Dictionary<string, object?>
            {
                ["at"] = t.VoidedAt,
                ["reasonLabel"] = t.VoidReason,
                ["remarks"] = t.VoidRemarks,
                ["by"] = forCustomer || string.IsNullOrWhiteSpace(t.VoidedBy?.FullName) ? null
                    : new { name = t.VoidedBy!.FullName, role = "Store Owner" }
            };
        }
        return d;
    }

    // Every transaction of the store, newest first, in the shape the frontend pages expect.
    public static async Task<List<Dictionary<string, object?>>> Decorate(AppDb db, int storeId)
    {
        var customers = await db.Customers.Where(c => c.StoreId == storeId).ToDictionaryAsync(c => c.Id);
        var txs = await db.Transactions.Include(t => t.Items).Include(t => t.VoidedBy).Where(t => t.StoreId == storeId).ToListAsync();
        var states = ComputeStates(txs.Select(t => new SlimTx(t.Id, t.CustomerId, t.Type, t.Amount, t.Date, t.IsVoided)));

        var list = new List<Dictionary<string, object?>>();
        foreach (var t in txs.OrderByDescending(t => t.Date).ThenByDescending(t => t.Id))
        {
            customers.TryGetValue(t.CustomerId, out var c);
            list.Add(BuildRow(t, c, states.GetValueOrDefault(t.Id)));
        }
        return list;
    }

    // Next "CUS-001" style code for a store (never reuses a code that exists)
    public static async Task<string> NextCustomerCode(AppDb db, int storeId)
    {
        var n = await db.Customers.CountAsync(c => c.StoreId == storeId) + 1;
        while (await db.Customers.AnyAsync(c => c.StoreId == storeId && c.Code == "CUS-" + n.ToString("000"))) n++;
        return "CUS-" + n.ToString("000");
    }

    // Next transaction counter of the store (shown as TRX-0001)
    public static async Task<int> NextNumber(AppDb db, int storeId) =>
        (await db.Transactions.Where(t => t.StoreId == storeId).MaxAsync(t => (int?)t.Number) ?? 0) + 1;
}
