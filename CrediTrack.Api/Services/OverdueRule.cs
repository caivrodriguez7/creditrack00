using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Services;

// The overdue result of one credit transaction.
//   Outstanding  what is still unpaid on this credit (Ledger's payment-allocation rule: payments go to the oldest credits first)
//   IsOverdue    the rule below
//   DaysOverdue  whole days past the due date (0 when not overdue)
public record OverdueInfo(int TransactionId, int CustomerId, DateOnly? DueDate, decimal Outstanding, bool IsOverdue, int DaysOverdue);

// The Overdue Balance (Part 4C): what is still unpaid on the OVERDUE credits only.
//   Balance   sum of Outstanding over the overdue credits (not-yet-due, no-due-date and fully paid credits add nothing)
//   Accounts  customers with at least one overdue credit (the same count as DaysByCustomer, the Dashboard and Customers)
//   Credits   how many credits are overdue
public record OverdueTotals(decimal Balance, int Accounts, int Credits);

// One overdue ACCOUNT (Part 5A) = one customer with at least one overdue credit.
//   DueDate        the OLDEST due date among the customer's overdue credits
//   DaysOverdue    days since that date (the customer's longest overdue credit, same number as DaysByCustomer)
//   OverdueAmount  what is still unpaid on the customer's overdue credits only
//   OverdueCredits how many credits are overdue
public record OverdueAccount(int CustomerId, DateOnly DueDate, int DaysOverdue, decimal OverdueAmount, int OverdueCredits);

// The ONE place that decides whether a transaction is overdue. Every overdue feature (Dashboard, Customers, Overdue Accounts,
// Reports, notifications ...) must ask this class instead of comparing due dates itself.
//
// A transaction is overdue only when ALL of these are true:
//   1. it has a due date,
//   2. the due date is earlier than today (a credit due today is not overdue yet),
//   3. it still has an outstanding balance greater than zero.
// So a credit with no due date is never overdue, and a fully paid credit is never overdue. Payments, and voided credits
// (which no longer count toward any balance), are never overdue either.
//
// The outstanding balance is NOT calculated here: it comes from Ledger.ComputeStates, the same calculation behind
// Unpaid / Partially paid / Paid and the customer balance.
public static class OverdueRule
{
    // "Today" for the rule: the Philippine calendar day, like every other date rule in the app (Paging.PhToday)
    public static DateOnly Today() => DateOnly.FromDateTime(Paging.PhToday());

    // The rule itself, on plain values (no database needed)
    public static bool IsOverdue(DateOnly? dueDate, decimal outstanding, DateOnly today) =>
        dueDate != null && dueDate.Value < today && outstanding > 0;

    public static int DaysOverdue(DateOnly? dueDate, decimal outstanding, DateOnly today) =>
        IsOverdue(dueDate, outstanding, today) ? today.DayNumber - dueDate!.Value.DayNumber : 0;

    // One transaction, given its credit state from Ledger (null = nothing paid toward it, so all of it is outstanding)
    public static OverdueInfo Check(Transaction t, CreditState? state, DateOnly today)
    {
        // Only a credit that has not been voided can be owed, so only that can be overdue
        if (t.Type != "credit" || t.IsVoided)
            return new OverdueInfo(t.Id, t.CustomerId, t.DueDate, 0m, false, 0);
        var outstanding = state?.Remaining ?? t.Amount;
        return new OverdueInfo(t.Id, t.CustomerId, t.DueDate, outstanding,
            IsOverdue(t.DueDate, outstanding, today), DaysOverdue(t.DueDate, outstanding, today));
    }

    // Every credit in `all` (it must hold ALL the transactions of the customers involved, because their payments decide what is
    // still outstanding). transactionId -> result. Payments are not in the result.
    public static Dictionary<int, OverdueInfo> Evaluate(IReadOnlyCollection<Transaction> all, DateOnly today)
    {
        var states = Ledger.ComputeStates(all.Select(t => new SlimTx(t.Id, t.CustomerId, t.Type, t.Amount, t.Date, t.IsVoided)));
        return all.Where(t => t.Type == "credit")
            .ToDictionary(t => t.Id, t => Check(t, states.GetValueOrDefault(t.Id), today));
    }

    // Every credit of a store: transactionId -> result. `today` is only passed by tests; normally it is the Philippine today.
    public static async Task<Dictionary<int, OverdueInfo>> ForStore(AppDb db, int storeId, DateOnly? today = null)
    {
        var all = await db.Transactions.AsNoTracking().Where(t => t.StoreId == storeId).ToListAsync();
        return Evaluate(all, today ?? Today());
    }

    // customerId -> days overdue, for every customer with at least one overdue credit (a customer who is not overdue is simply missing).
    // Days overdue = the OLDEST overdue credit of that customer. "Overdue accounts" = the number of entries (Dashboard count,
    // Customers badge and any later overdue feature all read this, so they can never disagree).
    public static Dictionary<int, int> DaysByCustomer(IEnumerable<OverdueInfo> credits) =>
        credits.Where(o => o.IsOverdue).GroupBy(o => o.CustomerId).ToDictionary(g => g.Key, g => g.Max(o => o.DaysOverdue));

    // One entry per overdue customer, built only from what Check already decided (IsOverdue, Outstanding, DaysOverdue).
    // The set of customers is exactly the key set of DaysByCustomer, so the Dashboard count and this list always agree.
    public static List<OverdueAccount> Accounts(IEnumerable<OverdueInfo> credits) =>
        credits.Where(o => o.IsOverdue && o.DueDate != null).GroupBy(o => o.CustomerId)
            .Select(g => new OverdueAccount(g.Key, g.Min(o => o.DueDate!.Value), g.Max(o => o.DaysOverdue),
                Math.Round(g.Sum(o => o.Outstanding), 2), g.Count()))
            .ToList();

    public static async Task<Dictionary<int, int>> OverdueCustomerDays(AppDb db, int storeId, DateOnly? today = null) =>
        DaysByCustomer((await ForStore(db, storeId, today)).Values);

    // The Overdue Balance of a set of credits. It only adds up what OverdueRule.Check already decided (IsOverdue + Outstanding), so
    // Reports and its exports can never disagree with the Dashboard, Customers or the Overdue Accounts page.
    public static OverdueTotals Totals(IEnumerable<OverdueInfo> credits)
    {
        var late = credits.Where(o => o.IsOverdue).ToList();
        return new OverdueTotals(Math.Round(late.Sum(o => o.Outstanding), 2), DaysByCustomer(late).Count, late.Count);
    }

    public static async Task<OverdueTotals> TotalsForStore(AppDb db, int storeId, DateOnly? today = null) =>
        Totals((await ForStore(db, storeId, today)).Values);

    // Convenience for features that only want the overdue credits, most overdue first
    public static async Task<List<OverdueInfo>> OverdueCredits(AppDb db, int storeId, DateOnly? today = null) =>
        (await ForStore(db, storeId, today)).Values.Where(o => o.IsOverdue)
            .OrderByDescending(o => o.DaysOverdue).ThenBy(o => o.TransactionId).ToList();
}
