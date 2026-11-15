using CrediTrack.Api.Models;

namespace CrediTrack.Api.Services;

// One credit the customer should be reminded about on opening the app.
//   Status  "overdue" (due date already passed), "today" (due today) or "soon" (due within the next few days)
//   Days    days overdue (overdue), 0 (today) or days left (soon)
public record DueReminder(int TransactionId, int CustomerId, int Number, DateOnly DueDate, decimal Outstanding, string Status, int Days);

// The customer Home reminder. It never decides "overdue" itself: it asks OverdueRule, the one place that does, so the customer
// sees the same overdue credits the store owner sees on the Overdue Accounts page. Only credits that still have a balance and a
// due date are listed; a credit with no due date, a fully paid credit and a voided credit never appear.
public static class DueReminders
{
    public const int WindowDays = 7;   // "due soon" = due within the next 7 days

    // `all` must hold ALL the transactions of the customer records involved (their payments decide what is still outstanding)
    public static List<DueReminder> Build(IReadOnlyCollection<Transaction> all, DateOnly today, int windowDays = WindowDays)
    {
        var byId = all.ToDictionary(t => t.Id);
        return OverdueRule.Evaluate(all, today).Values
            .Where(o => o.DueDate != null && o.Outstanding > 0 && o.DueDate.Value <= today.AddDays(windowDays))
            .OrderBy(o => o.DueDate).ThenBy(o => o.TransactionId)
            .Select(o =>
            {
                var due = o.DueDate!.Value;
                var status = due < today ? "overdue" : due == today ? "today" : "soon";
                var days = status == "overdue" ? o.DaysOverdue : status == "today" ? 0 : due.DayNumber - today.DayNumber;
                return new DueReminder(o.TransactionId, o.CustomerId, byId[o.TransactionId].Number, due, Math.Round(o.Outstanding, 2), status, days);
            })
            .ToList();
    }
}
