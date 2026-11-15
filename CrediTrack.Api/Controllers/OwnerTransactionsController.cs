using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace CrediTrack.Api.Controllers;

[ApiController]
[Route("api/owner/transactions")]
[Authorize(Roles = "owner")]
public class OwnerTransactionsController : ControllerBase
{
    private readonly AppDb _db;
    public OwnerTransactionsController(AppDb db) { _db = db; }

    public record ItemRequest(string? Name, decimal Qty, string? QtyText, string? Unit, decimal Price);
    public record CreditRequest(int CustomerId, List<ItemRequest>? Items, string? RequestId, string? DueDate = null);
    public record PaymentRequest(int CustomerId, decimal Amount, string? Date, string? Method, string? Reference, string? Notes, string? RequestId);

    private static readonly string[] Methods = { "Cash", "GCash", "Maya", "Bank Transfer", "Other" };

    private async Task<int?> MyStoreId()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Stores.Where(s => s.OwnerId == userId)
            .Select(s => (int?)s.Id).FirstOrDefaultAsync();
    }

    // The optional agreed payment date of a credit: "yyyy-MM-dd". Empty = "No due date" (null, can never be overdue).
    // Must be today or later (yesterday is still accepted so a phone ahead of the server clock, e.g. Philippine time vs UTC,
    // is not refused) and within 5 years. Returns an error message, or null when it is fine.
    private static string? ParseDueDate(string? raw, out DateOnly? due)
    {
        due = null;
        var text = (raw ?? "").Trim();
        if (text.Length == 0) return null;
        if (!DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            return "Enter a valid due date.";
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (parsed < today.AddDays(-1)) return "The due date cannot be in the past.";
        if (parsed > today.AddYears(5)) return "That due date is too far away. Choose a date within 5 years.";
        due = parsed;
        return null;
    }

    // Only call this while holding the store lock (StoreLock.BeginAsync), or two saves can read the same MAX.
    private async Task<int> NextNumber(int storeId) =>
        (await _db.Transactions.Where(t => t.StoreId == storeId).MaxAsync(t => (int?)t.Number) ?? 0) + 1;

    // Saves a NEW credit / payment and commits (which also releases the store lock). Returns null when it was saved.
    // If the unique index refuses it because the same RequestId was saved a moment before (a double click that got
    // past the check), nothing is saved and the FIRST record is returned so the caller can answer with it.
    private async Task<Transaction?> SaveNew(IDbContextTransaction dbTx, Transaction tx, int storeId)
    {
        try
        {
            await _db.SaveChangesAsync();
            await dbTx.CommitAsync();
            return null;
        }
        catch (DbUpdateException ex) when (StoreLock.IsUniqueViolation(ex))
        {
            await dbTx.RollbackAsync();
            _db.ChangeTracker.Clear();
            if (!string.IsNullOrEmpty(tx.RequestId))
            {
                var first = await _db.Transactions.AsNoTracking()
                    .FirstOrDefaultAsync(t => t.StoreId == storeId && t.RequestId == tx.RequestId);
                if (first != null) return first;
            }
            throw;
        }
    }

    // What Record Utang / Record Bayad get back after saving
    private async Task<object> Result(int storeId, Transaction tx, bool duplicate)
    {
        var all = await Ledger.Decorate(_db, storeId);
        var decorated = all.First(d => (int)d["id"]! == tx.Id);
        var customer = await _db.Customers.FirstAsync(c => c.Id == tx.CustomerId);
        var balances = await Ledger.Balances(_db, storeId);
        var overdue = await OverdueRule.OverdueCustomerDays(_db, storeId);
        return new
        {
            transaction = decorated,
            customer = Ledger.CustomerDto(customer, balances.GetValueOrDefault(customer.Id), null, overdue.GetValueOrDefault(customer.Id)),
            balanceBefore = tx.BalanceBefore,
            duplicate
        };
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        return Ok(await Ledger.Decorate(_db, storeId.Value));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        var all = await Ledger.Decorate(_db, storeId.Value);
        var found = all.FirstOrDefault(d => (int)d["id"]! == id);
        return found == null ? NotFound(new { message = "Transaction not found." }) : Ok(found);
    }

    // ---------- Record Utang ----------
    [HttpPost("credits")]
    public async Task<IActionResult> AddCredit(CreditRequest req)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        // One writer at a time for this store (see StoreLock): everything below, up to the commit, runs alone.
        await using var dbTx = await StoreLock.BeginAsync(_db, storeId.Value);

        // Saving twice with the same requestId returns the first one (double click safe)
        if (!string.IsNullOrEmpty(req.RequestId))
        {
            var saved = await _db.Transactions.FirstOrDefaultAsync(t => t.StoreId == storeId && t.RequestId == req.RequestId);
            if (saved != null) return Ok(await Result(storeId.Value, saved, true));
        }

        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == req.CustomerId && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });
        if (customer.IsArchived)
            return BadRequest(new { message = "This customer is archived. Restore the customer before recording new utang." });

        if (req.Items == null || req.Items.Count == 0)
            return BadRequest(new { message = "Add at least one item." });

        var dueError = ParseDueDate(req.DueDate, out var dueDate);
        if (dueError != null) return BadRequest(new { field = "dueDate", message = dueError });

        var items = new List<TransactionItem>();
        foreach (var i in req.Items)
        {
            var name = string.Join(" ", (i.Name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
            if (name.Length == 0 || name.Length > 100 || !Validation.PlainText(name) || !Validation.PlainText(i.Unit) || !Validation.PlainText(i.QtyText) || i.Qty <= 0 || i.Price <= 0)
                return BadRequest(new { message = "One of the items is not valid. Check the name, quantity and price." });
            var unit = (i.Unit ?? "").Trim();
            var qtyText = (i.QtyText ?? "").Trim();
            items.Add(new TransactionItem
            {
                Name = name,
                Qty = Math.Round(i.Qty, 6),
                QtyText = qtyText.Length > 0 ? qtyText[..Math.Min(12, qtyText.Length)] : null,
                Unit = unit[..Math.Min(20, unit.Length)],
                Price = Math.Round(i.Price, 2)
            });
        }

        var itemNames = string.Join(", ", items.Select(i => i.Name));   // for the customer's notification only (not stored in Transactions)
        var tx = new Transaction
        {
            StoreId = storeId.Value,
            Number = await NextNumber(storeId.Value),
            CustomerId = customer.Id,
            Type = "credit",
            Amount = items.Sum(i => Math.Round(i.Qty * i.Price, 2)),
            Date = DateTime.UtcNow,
            DueDate = dueDate,
            RequestId = string.IsNullOrEmpty(req.RequestId) ? null : req.RequestId,
            Items = items
        };
        _db.Transactions.Add(tx);
        var first = await SaveNew(dbTx, tx, storeId.Value);
        if (first != null) return Ok(await Result(storeId.Value, first, true));
        await NotifyCustomer(customer, "credit_recorded", "Credit Recorded",
            " recorded a credit of " + Notifier.Peso(tx.Amount) + " for you" + (string.IsNullOrEmpty(itemNames) ? "" : " (" + (itemNames.Length > 60 ? itemNames[..60] + "..." : itemNames) + ")") + ".", tx.Id);
        return Ok(await Result(storeId.Value, tx, false));
    }

    // Tells the customer about a credit or payment the store recorded (only when their account is linked and connected)
    private async Task NotifyCustomer(Customer customer, string type, string title, string textAfterStoreName, int transactionId)
    {
        if (customer.LinkedUserId == null || customer.IsDisconnected) return;
        var storeName = await _db.Stores.Where(s => s.Id == customer.StoreId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, customer.LinkedUserId.Value, type, title, storeName + textAfterStoreName, "transaction", transactionId);
    }

    // ---------- Record Bayad ----------
    [HttpPost("payments")]
    public async Task<IActionResult> AddPayment(PaymentRequest req)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        // One writer at a time for this store (see StoreLock): everything below, up to the commit, runs alone.
        await using var dbTx = await StoreLock.BeginAsync(_db, storeId.Value);

        if (!string.IsNullOrEmpty(req.RequestId))
        {
            var saved = await _db.Transactions.FirstOrDefaultAsync(t => t.StoreId == storeId && t.RequestId == req.RequestId);
            if (saved != null) return Ok(await Result(storeId.Value, saved, true));
        }

        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == req.CustomerId && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });

        var balances = await Ledger.Balances(_db, storeId.Value);
        var balance = balances.GetValueOrDefault(customer.Id);
        if (balance <= 0)
            return BadRequest(new { message = "This customer has no outstanding balance to pay." });

        var amount = Math.Round(req.Amount, 2);
        if (amount <= 0)
            return BadRequest(new { message = "Enter a payment amount greater than ₱0.00." });
        if (amount > balance)
            return BadRequest(new { message = "The payment cannot be more than the outstanding balance of ₱" + balance.ToString("N2", CultureInfo.InvariantCulture) + "." });

        var method = req.Method ?? "";
        if (!Methods.Contains(method))
            return BadRequest(new { message = "Choose how the customer paid." });

        if (!DateTime.TryParseExact(req.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return BadRequest(new { message = "Choose the payment date." });
        var todayPh = DateTime.UtcNow.AddHours(8).Date;          // the app is for the Philippines (UTC+8)
        if (day.Date > todayPh)
            return BadRequest(new { message = "The payment date cannot be in the future." });
        // Today's payment keeps the real time; an earlier date is recorded at noon (Philippine time) of that day
        var when = day.Date == todayPh ? DateTime.UtcNow : DateTime.SpecifyKind(day.Date.AddHours(4), DateTimeKind.Utc);

        var reference = string.Join(" ", (req.Reference ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var notes = (req.Notes ?? "").Trim();
        if (reference.Length > 40)
            return BadRequest(new { message = "Use a reference number of 40 characters or fewer." });
        if (notes.Length > 200)
            return BadRequest(new { message = "Use notes of 200 characters or fewer." });

        var tx = new Transaction
        {
            StoreId = storeId.Value,
            Number = await NextNumber(storeId.Value),
            CustomerId = customer.Id,
            Type = "payment",
            Amount = amount,
            Date = when,
            Method = method,
            Reference = reference.Length > 0 ? reference : null,
            Note = notes.Length > 0 ? notes : null,
            BalanceBefore = balance,
            RequestId = string.IsNullOrEmpty(req.RequestId) ? null : req.RequestId
        };
        _db.Transactions.Add(tx);
        var first = await SaveNew(dbTx, tx, storeId.Value);
        if (first != null) return Ok(await Result(storeId.Value, first, true));
        await NotifyCustomer(customer, "payment_recorded", "Payment Recorded",
            " recorded your " + method.ToLower() + " payment of " + Notifier.Peso(amount) + ".", tx.Id);
        return Ok(await Result(storeId.Value, tx, false));
    }

    // ---------- Search / filter / sort / pagination ----------
    // GET /api/owner/transactions/query?search=ana&type=all|credit|payment
    //     &status=all|unpaid|partial|paid|confirmed|voided&dateRange=all|today|7|30|month|custom&from=2026-11-01&to=2026-11-09
    //     &customerId=3&sort=date|amount|customer|code&dir=asc|desc&page=1&pageSize=20
    // The existing GET /api/owner/transactions (whole list) is unchanged.
    public class TransactionQuery
    {
        public string? Search { get; set; }
        public string? Type { get; set; }
        public string? Status { get; set; }
        public string? DateRange { get; set; }
        public string? From { get; set; }
        public string? To { get; set; }
        public int? CustomerId { get; set; }
        public string? Sort { get; set; }
        public string? Dir { get; set; }
        public int? Page { get; set; }
        public int? PageSize { get; set; }
    }

    [HttpGet("query")]
    public async Task<IActionResult> Query([FromQuery] TransactionQuery q)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        var type = Paging.Pick(q.Type, new[] { "all", "credit", "payment" }, "all");
        var status = Paging.Pick(q.Status, new[] { "all", "unpaid", "partial", "paid", "confirmed", "voided" }, "all");
        var sort = Paging.Pick(q.Sort, new[] { "date", "amount", "customer", "code" }, "date");
        var asc = Paging.Pick(q.Dir, new[] { "asc", "desc" }, "desc") == "asc";   // newest first unless told otherwise
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);
        var search = Paging.Search(q.Search);
        var window = Paging.Window(q.DateRange, q.From, q.To);
        var totalAll = await _db.Transactions.CountAsync(t => t.StoreId == storeId);

        var emptyTotals = new { credit = 0m, creditCount = 0, payment = 0m, paymentCount = 0 };
        if (window.Invalid)
        {
            var none = Paging.Result(new List<object>(), 0, page, pageSize);
            none["totals"] = emptyTotals; none["totalAll"] = totalAll; none["invalidRange"] = true;
            return Ok(none);
        }

        var tx = _db.Transactions.Where(t => t.StoreId == storeId);
        if (type != "all") tx = tx.Where(t => t.Type == type);
        if (q.CustomerId != null) tx = tx.Where(t => t.CustomerId == q.CustomerId);
        if (window.FromUtc is DateTime from) tx = tx.Where(t => t.Date >= from);
        if (window.ToExclusiveUtc is DateTime to) tx = tx.Where(t => t.Date < to);

        if (search.Length > 0)
        {
            var like = Paging.Like(search);
            var code = Regex.Match(search, @"^trx-?(\d+)$", RegexOptions.IgnoreCase);
            if (code.Success && int.TryParse(code.Groups[1].Value, out var number))
                tx = tx.Where(t => t.Number == number);
            else
                tx = tx.Where(t => EF.Functions.ILike(t.Customer.Name, like, "\\")
                    || EF.Functions.ILike(t.Customer.Code, like, "\\")
                    || (t.Note != null && EF.Functions.ILike(t.Note, like, "\\"))
                    || t.Items.Any(i => EF.Functions.ILike(i.Name, like, "\\")));
        }

        // Unpaid / partial / paid come from the payment-allocation rule, so they are worked out first
        var states = await Ledger.CreditStates(_db, storeId.Value);
        if (status == "voided") tx = tx.Where(t => t.IsVoided);
        else if (status == "confirmed") tx = tx.Where(t => t.Type == "payment" && !t.IsVoided);
        else if (status != "all")
        {
            var ids = states.Where(kv => kv.Value.Status == status).Select(kv => kv.Key).ToList();
            tx = tx.Where(t => t.Type == "credit" && !t.IsVoided && ids.Contains(t.Id));
        }

        // Totals cover ALL matching rows (voided ones left out), not just this page
        var sums = await tx.Where(t => !t.IsVoided).GroupBy(t => t.Type)
            .Select(g => new { Type = g.Key, Sum = g.Sum(t => t.Amount), Count = g.Count() }).ToListAsync();
        var credit = sums.FirstOrDefault(x => x.Type == "credit");
        var payment = sums.FirstOrDefault(x => x.Type == "payment");
        var totals = new { credit = credit?.Sum ?? 0m, creditCount = credit?.Count ?? 0, payment = payment?.Sum ?? 0m, paymentCount = payment?.Count ?? 0 };
        var totalCount = await tx.CountAsync();

        var withData = tx.Include(t => t.Items).Include(t => t.Customer).Include(t => t.VoidedBy);
        var ordered = (sort, asc) switch
        {
            ("amount", true) => withData.OrderBy(t => t.Amount),
            ("amount", false) => withData.OrderByDescending(t => t.Amount),
            ("customer", true) => withData.OrderBy(t => t.Customer.Name),
            ("customer", false) => withData.OrderByDescending(t => t.Customer.Name),
            ("code", true) => withData.OrderBy(t => t.Number),
            ("code", false) => withData.OrderByDescending(t => t.Number),
            (_, true) => withData.OrderBy(t => t.Date),
            _ => withData.OrderByDescending(t => t.Date)
        };
        var rows = await (asc ? ordered.ThenBy(t => t.Id) : ordered.ThenByDescending(t => t.Id))
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        var items = rows.Select(t => Ledger.BuildRow(t, t.Customer, states.GetValueOrDefault(t.Id))).ToList();
        var result = Paging.Result(items, totalCount, page, pageSize);
        result["totals"] = totals; result["totalAll"] = totalAll; result["invalidRange"] = false;
        return Ok(result);
    }

    // ---------- Edit ----------
    public record EditRequest(int? CustomerId, string? Date, List<ItemRequest>? Items, decimal? Amount, string? Method, string? Reference, string? Notes, string? DueDate = null, bool? RemoveDueDate = null);
    private record Change(string Field, string? From, string? To);

    // How a due date reads in Change History: "Nov 20, 2026", or "No due date"
    private static string DueText(DateOnly? day) =>
        day == null ? "No due date" : day.Value.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);

    private static string Peso(decimal n) => "₱" + n.ToString("N2", CultureInfo.InvariantCulture);
    private static string ItemsText(IEnumerable<TransactionItem> items) =>
        string.Join("; ", items.Select(i => i.Name + " · " + (i.QtyText ?? i.Qty.ToString("0.######", CultureInfo.InvariantCulture))
            + (i.Unit.Length > 0 ? " " + i.Unit : "") + " × " + Peso(i.Price)));

    // Same item rules as Record Utang
    private static (List<TransactionItem>? Items, string? Error) CleanItems(List<ItemRequest>? list)
    {
        if (list == null || list.Count == 0) return (null, "Add at least one item.");
        var items = new List<TransactionItem>();
        foreach (var i in list)
        {
            var name = string.Join(" ", (i.Name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
            if (name.Length == 0 || name.Length > 100 || !Validation.PlainText(name) || !Validation.PlainText(i.Unit) || !Validation.PlainText(i.QtyText) || i.Qty <= 0 || i.Price <= 0)
                return (null, "One of the items is not valid. Check the name, quantity and price.");
            var unit = (i.Unit ?? "").Trim();
            var qtyText = (i.QtyText ?? "").Trim();
            items.Add(new TransactionItem
            {
                Name = name,
                Qty = Math.Round(i.Qty, 6),
                QtyText = qtyText.Length > 0 ? qtyText[..Math.Min(12, qtyText.Length)] : null,
                Unit = unit[..Math.Min(20, unit.Length)],
                Price = Math.Round(i.Price, 2)
            });
        }
        return (items, null);
    }

    private int UserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // The history entry keeps only WHO (the user's id; the name is read from Users) and one row per changed field
    private void LogChange(Transaction tx, string kind, string summary, IEnumerable<Change>? changes) =>
        _db.TransactionChanges.Add(new TransactionChange
        {
            TransactionId = tx.Id,
            ActorUserId = UserId(),
            Kind = kind,
            Summary = summary,
            Details = (changes ?? Enumerable.Empty<Change>())
                .Select(c => new TransactionChangeDetail { Field = c.Field, OldValue = c.From, NewValue = c.To }).ToList()
        });

    private async Task<Dictionary<string, object?>> Payload(int storeId, Transaction tx)
    {
        var all = await Ledger.Decorate(_db, storeId);
        var customer = await _db.Customers.FirstAsync(c => c.Id == tx.CustomerId);
        var balances = await Ledger.Balances(_db, storeId);
        var overdue = await OverdueRule.OverdueCustomerDays(_db, storeId);
        return new Dictionary<string, object?>
        {
            ["transaction"] = all.First(d => (int)d["id"]! == tx.Id),
            ["customer"] = Ledger.CustomerDto(customer, balances.GetValueOrDefault(customer.Id), null, overdue.GetValueOrDefault(customer.Id)),
            ["balanceBefore"] = tx.BalanceBefore
        };
    }

    // PUT /api/owner/transactions/{id}  (the id, number and type never change; voided transactions cannot be edited)
    //   credit : { customerId, date, items: [{ name, qty, qtyText, unit, price }], dueDate: "yyyy-MM-dd" }
    //   payment: { customerId, date, amount, method, reference, notes }
    // Every field is optional: only what is sent is changed. Each saved edit adds a Change History entry.
    // dueDate (credit only) sets or changes the due date (today or later, within 5 years). removeDueDate: true (credit only) removes it (DueDate is saved as NULL = "No due date").
    // Setting, changing or removing a due date adds a "Due date" change (old value -> new value) to the same Change History entry as every other edit.
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Edit(int id, EditRequest req)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        // One writer at a time for this store (see StoreLock): everything below, up to the commit, runs alone.
        await using var dbTx = await StoreLock.BeginAsync(_db, storeId.Value);

        var tx = await _db.Transactions.Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == id && t.StoreId == storeId);
        if (tx == null) return NotFound(new { message = "Transaction not found." });
        if (tx.IsVoided) return Conflict(new { message = "This transaction has been voided and can no longer be edited." });

        var oldCustomerId = tx.CustomerId;
        var customerId = req.CustomerId ?? tx.CustomerId;
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == customerId && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });
        var oldCustomer = customerId == oldCustomerId ? customer : await _db.Customers.FirstAsync(c => c.Id == oldCustomerId);

        var changes = new List<Change>();
        var reorder = false;   // customer or date changed: a payment's "balance before" is worked out again

        if (customerId != oldCustomerId)
        {
            if (customer.IsArchived)
                return BadRequest(new { field = "customer", message = "This customer is archived. Restore the customer first." });
            changes.Add(new Change("Customer", oldCustomer.Name, customer.Name));
            tx.CustomerId = customerId;
            reorder = true;
        }

        if (!string.IsNullOrWhiteSpace(req.Date))
        {
            if (!Paging.TryDay(req.Date, out var day))
                return BadRequest(new { field = "date", message = "Choose a valid date." });
            var todayPh = Paging.PhToday();
            if (day.Date > todayPh)
                return BadRequest(new { field = "date", message = "The date cannot be in the future." });
            var oldDay = tx.Date.Add(Paging.PhOffset).Date;
            if (day.Date != oldDay)
            {
                // Today keeps the real time; any other day is recorded at noon Philippine time
                tx.Date = day.Date == todayPh ? DateTime.UtcNow : Paging.DayStartUtc(day.Date).AddHours(12);
                changes.Add(new Change("Date", oldDay.ToString("yyyy-MM-dd"), day.Date.ToString("yyyy-MM-dd")));
                reorder = true;
            }
        }

        // Due date (credit only): set one on a credit that has none, change an existing one, or remove it (removeDueDate: true).
        // An empty dueDate is ignored: only the explicit removeDueDate flag removes a due date. Sending the date it already has is harmless.
        var dueChanged = false;
        var oldDue = tx.DueDate;   // kept for Change History
        var dueText = (req.DueDate ?? "").Trim();
        if (req.RemoveDueDate == true)
        {
            if (tx.Type != "credit")
                return BadRequest(new { field = "dueDate", message = "Only a credit can have a due date." });
            if (dueText.Length > 0)
                return BadRequest(new { field = "dueDate", message = "Choose either a due date or remove it, not both." });
            if (tx.DueDate != null) { tx.DueDate = null; dueChanged = true; }   // no due date: stored as NULL, can never be overdue
        }
        else if (dueText.Length > 0)
        {
            if (tx.Type != "credit")
                return BadRequest(new { field = "dueDate", message = "Only a credit can have a due date." });
            var currentDue = tx.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (currentDue != dueText)
            {
                var dueError = ParseDueDate(dueText, out var newDue);
                if (dueError != null) return BadRequest(new { field = "dueDate", message = dueError });
                if (newDue != tx.DueDate) { tx.DueDate = newDue; dueChanged = true; }
            }
        }

        if (tx.Type == "credit")
        {
            if (req.Items != null)
            {
                var (items, error) = CleanItems(req.Items);
                if (error != null) return BadRequest(new { field = "items", message = error });
                var cleanedItems = items!;
                var before = ItemsText(tx.Items.OrderBy(i => i.Id));
                var after = ItemsText(cleanedItems);
                if (before != after)
                {
                    var amount = cleanedItems.Sum(i => Math.Round(i.Qty * i.Price, 2));
                    changes.Add(new Change("Items", before, after));
                    if (amount != tx.Amount) changes.Add(new Change("Amount", Peso(tx.Amount), Peso(amount)));
                    foreach (var old in tx.Items.ToList()) _db.TransactionItems.Remove(old);
                    foreach (var item in cleanedItems) tx.Items.Add(item);
                    tx.Amount = amount;
                }
            }
        }
        else
        {
            if (req.Amount != null)
            {
                var amount = Math.Round(req.Amount.Value, 2);
                if (amount <= 0) return BadRequest(new { field = "amount", message = "Enter a payment amount greater than ₱0.00." });
                if (amount != tx.Amount) { changes.Add(new Change("Amount", Peso(tx.Amount), Peso(amount))); tx.Amount = amount; }
            }
            if (req.Method != null)
            {
                if (!Methods.Contains(req.Method)) return BadRequest(new { field = "method", message = "Choose how the customer paid." });
                if (req.Method != tx.Method) { changes.Add(new Change("Method", tx.Method, req.Method)); tx.Method = req.Method; }
            }
            if (req.Reference != null)
            {
                var reference = string.Join(" ", req.Reference.Split(' ', StringSplitOptions.RemoveEmptyEntries));
                if (reference.Length > 40) return BadRequest(new { field = "reference", message = "Use a reference number of 40 characters or fewer." });
                var value = reference.Length > 0 ? reference : null;
                if (value != tx.Reference) { changes.Add(new Change("Reference", tx.Reference, value)); tx.Reference = value; }
            }
            if (req.Notes != null)
            {
                var notes = req.Notes.Trim();
                if (notes.Length > 200) return BadRequest(new { field = "notes", message = "Use notes of 200 characters or fewer." });
                var value = notes.Length > 0 ? notes : null;
                if (value != tx.Note) { changes.Add(new Change("Notes", tx.Note, value)); tx.Note = value; }
            }
        }

        // Change History: adding (No due date -> date), changing (date -> date) or removing (date -> No due date) a due date
        if (dueChanged)
            changes.Add(new Change("Due date", DueText(oldDue), DueText(tx.DueDate)));

        if (changes.Count == 0 && !dueChanged)
        {
            var same = await Payload(storeId.Value, tx);
            same["changed"] = false;
            return Ok(same);
        }

        // After the edit no customer may have paid more than they were given on credit
        var affected = new List<int> { oldCustomerId, customerId }.Distinct().ToList();
        var related = await _db.Transactions
            .Where(t => t.StoreId == storeId && (affected.Contains(t.CustomerId) || t.Id == tx.Id)).ToListAsync();   // tracked rows carry the edited values
        foreach (var cid in affected)
        {
            var balance = related.Where(t => t.CustomerId == cid && !t.IsVoided)
                .Sum(t => t.Type == "credit" ? t.Amount : -t.Amount);
            if (balance < 0)
            {
                var name = cid == customerId ? customer.Name : oldCustomer.Name;
                return BadRequest(new { field = "amount", message = "This change would leave " + name + "'s payments higher than their credits. Edit or void those payments first." });
            }
        }
        if (tx.Type == "payment" && reorder)
        {
            var earlier = related.Where(t => t.CustomerId == tx.CustomerId && !t.IsVoided && t.Id != tx.Id
                && (t.Date < tx.Date || (t.Date == tx.Date && t.Id < tx.Id)))
                .Sum(t => t.Type == "credit" ? t.Amount : -t.Amount);
            tx.BalanceBefore = Math.Max(0, earlier);
        }

        tx.UpdatedAt = DateTime.UtcNow;
        if (changes.Count > 0)   // includes a due date added, changed or removed (a "Due date" change)
            LogChange(tx, "edit", "Edited " + string.Join(", ", changes.Select(c => c.Field)), changes);
        await _db.SaveChangesAsync();
        await dbTx.CommitAsync();

        var payload = await Payload(storeId.Value, tx);
        payload["changed"] = true;
        return Ok(payload);
    }

    // GET /api/owner/transactions/{id}/history : Change History, oldest first
    [HttpGet("{id:int}/history")]
    public async Task<IActionResult> History(int id)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        if (!await _db.Transactions.AnyAsync(t => t.Id == id && t.StoreId == storeId))
            return NotFound(new { message = "Transaction not found." });

        var rows = await _db.TransactionChanges.Include(c => c.Actor).Include(c => c.Details)
            .Where(c => c.TransactionId == id)
            .OrderBy(c => c.At).ThenBy(c => c.Id).ToListAsync();
        return Ok(rows.Select(c => new
        {
            id = c.Id,
            at = c.At,
            actor = string.IsNullOrWhiteSpace(c.Actor?.FullName) ? "Store Owner" : c.Actor!.FullName,
            role = "Store Owner",
            kind = c.Kind,
            summary = c.Summary,
            changes = c.Details.Count == 0 ? null
                : c.Details.OrderBy(d => d.Id).Select(d => new { field = d.Field, from = d.OldValue, to = d.NewValue }).ToList()
        }));
    }

    // ---------- Void ----------
    public record VoidRequest(string? Reason, string? Remarks);
    private static readonly string[] VoidReasons = { "Duplicate transaction", "Incorrect entry", "Other" };

    // GET /api/owner/transactions/{id}/void-preview : the customer's balance before and after, and whether voiding is allowed
    [HttpGet("{id:int}/void-preview")]
    public async Task<IActionResult> VoidPreview(int id)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        var tx = await _db.Transactions.FirstOrDefaultAsync(t => t.Id == id && t.StoreId == storeId);
        if (tx == null) return NotFound(new { message = "Transaction not found." });

        var balance = await Ledger.BalanceOf(_db, tx.CustomerId);
        var after = tx.IsVoided ? balance : balance + (tx.Type == "credit" ? -tx.Amount : tx.Amount);
        string? block = null;
        if (tx.IsVoided) block = "This transaction has already been voided.";
        else if (after < 0) block = "This credit has already been paid beyond the customer's other credits. Void or edit those payments first.";
        return Ok(new { id = tx.Id, type = tx.Type, amount = tx.Amount, balanceBefore = balance, balanceAfter = after, canVoid = block == null, blockReason = block });
    }

    // POST /api/owner/transactions/{id}/void { reason: "Duplicate transaction" | "Incorrect entry" | "Other", remarks }
    // The record is kept (never deleted); its effect on the balance is reversed.
    [HttpPost("{id:int}/void")]
    public async Task<IActionResult> Void(int id, VoidRequest req)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        // One writer at a time for this store (see StoreLock): everything below, up to the commit, runs alone.
        await using var dbTx = await StoreLock.BeginAsync(_db, storeId.Value);
        var tx = await _db.Transactions.FirstOrDefaultAsync(t => t.Id == id && t.StoreId == storeId);
        if (tx == null) return NotFound(new { message = "Transaction not found." });
        if (tx.IsVoided) return Conflict(new { message = "This transaction has already been voided." });   // safe to call twice

        var reason = (req.Reason ?? "").Trim();
        if (!VoidReasons.Contains(reason))
            return BadRequest(new { field = "reason", message = "Choose a reason for voiding." });
        var remarks = (req.Remarks ?? "").Trim();
        if (reason == "Other" && (remarks.Length < 5 || remarks.Length > 200))
            return BadRequest(new { field = "remarks", message = "Add remarks of 5 to 200 characters." });
        if (remarks.Length > 200)
            return BadRequest(new { field = "remarks", message = "Use remarks of 200 characters or fewer." });

        var balance = await Ledger.BalanceOf(_db, tx.CustomerId);
        var after = balance + (tx.Type == "credit" ? -tx.Amount : tx.Amount);
        if (after < 0)
            return BadRequest(new { message = "This credit has already been paid beyond the customer's other credits. Void or edit those payments first." });

        tx.IsVoided = true;
        tx.VoidedAt = DateTime.UtcNow;
        tx.VoidReason = reason;
        tx.VoidRemarks = remarks.Length > 0 ? remarks : null;
        tx.VoidedByUserId = UserId();
        tx.UpdatedAt = DateTime.UtcNow;
        LogChange(tx, "void", "Voided: " + reason, new[] { new Change("Status", "Active", "Voided") });
        await _db.SaveChangesAsync();
        await dbTx.CommitAsync();

        var payload = await Payload(storeId.Value, tx);
        payload["balanceBefore"] = balance;
        payload["balanceAfter"] = after;
        return Ok(payload);
    }
}
