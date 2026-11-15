using System.Globalization;
using CrediTrack.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Services;

// Part 6B: tells a customer when one of their credits becomes overdue.
//
// WHO is overdue is NOT decided here: it comes only from OverdueRule (Part 4A: a credit with a due date before today and
// something still unpaid). This class only finds the customers who must be told, and makes the notification through the
// existing Notifier, so it shows up in the customer's normal notification list and bell, follows their Notification
// Preferences ("overdue" counts as the customer's "activity" switch, see Notifier.PrefKey) and opens the credit
// (target "transaction", the same target as "Credit Recorded").
//
// One notification per overdue EVENT: an event is "this credit passed this due date without being paid". The scan runs
// again and again (OverdueNotificationService), so before sending it looks at the overdue notifications the customer already
// has for that credit. The due date is part of the notification text (EventMarker), so:
//   - the same credit and the same due date never notifies twice, however many times the scan runs;
//   - if the store moves the due date and the credit goes overdue again later, that is a new event and notifies again.
// Nothing is added to the database: the existing Notifications table (Type, TargetKind, TargetId, Message) is enough.
public static class OverdueNotifier
{
    public const string Type = "overdue";
    public const string TargetKind = "transaction";

    // One overdue credit whose customer has a linked account (UserId)
    public record OverdueCredit(int TransactionId, int Number, DateOnly DueDate, decimal Outstanding, int UserId, string StoreName);
    // An overdue notification the customer already has
    public record SentNotice(int UserId, int? TargetId, string Message);
    // A notification to make
    public record OverdueNotice(int UserId, int TransactionId, string Title, string Message);

    // "was due on November 5, 2026 and is now overdue": the part of the text that names the event (and is used to spot a duplicate)
    public static string EventMarker(DateOnly due) =>
        "was due on " + due.ToString("MMMM d, yyyy", CultureInfo.InvariantCulture) + " and is now overdue";

    private static string Short(string name) => name.Length > 60 ? name[..60] : name;

    public static OverdueNotice Build(OverdueCredit c) => new(
        c.UserId, c.TransactionId, "Credit Overdue",
        "Your credit " + Ledger.Code(c.Number) + " at " + Short(c.StoreName) + " " + EventMarker(c.DueDate) +
        ". Unpaid on this credit: " + Notifier.Peso(c.Outstanding) + ".");

    // Which notifications still have to be made. Pure (no database), so it can be tested on its own.
    public static List<OverdueNotice> Plan(IEnumerable<OverdueCredit> credits, IEnumerable<SentNotice> sent)
    {
        var already = new Dictionary<(int UserId, int TransactionId), List<string>>();
        foreach (var s in sent)
        {
            if (s.TargetId == null) continue;
            var key = (s.UserId, s.TargetId.Value);
            if (!already.TryGetValue(key, out var messages)) already[key] = messages = new List<string>();
            messages.Add(s.Message);
        }

        var result = new List<OverdueNotice>();
        var planned = new HashSet<(int UserId, int TransactionId, DateOnly DueDate)>();
        foreach (var c in credits)
        {
            if (!planned.Add((c.UserId, c.TransactionId, c.DueDate))) continue;   // the same event twice in one scan
            var marker = EventMarker(c.DueDate);
            if (already.TryGetValue((c.UserId, c.TransactionId), out var old) && old.Any(m => m.Contains(marker, StringComparison.Ordinal)))
                continue;                                                          // the customer was already told about this event
            result.Add(Build(c));
        }
        return result;
    }

    // Scans every store that has an overdue credit and notifies the linked customers. Returns how many notifications were made.
    // `today` is only passed by tests; normally it is the Philippine today (OverdueRule.Today).
    public static async Task<int> Run(AppDb db, DateOnly? today = null)
    {
        var day = today ?? OverdueRule.Today();
        // Only stores with a credit that is past its due date can have anything overdue (the cheap first cut; OverdueRule decides for real)
        var storeIds = await db.Transactions.AsNoTracking()
            .Where(t => t.Type == "credit" && !t.IsVoided && t.DueDate != null && t.DueDate < day)
            .Select(t => t.StoreId).Distinct().ToListAsync();

        var made = 0;
        foreach (var storeId in storeIds) made += await RunStore(db, storeId, day);
        return made;
    }

    public static async Task<int> RunStore(AppDb db, int storeId, DateOnly day)
    {
        var overdue = (await OverdueRule.ForStore(db, storeId, day)).Values
            .Where(o => o.IsOverdue && o.DueDate != null).ToList();
        if (overdue.Count == 0) return 0;

        // Only a customer with a linked account who is still connected to the store (and not archived by the owner) is told
        var customerIds = overdue.Select(o => o.CustomerId).Distinct().ToList();
        var linked = await db.Customers.AsNoTracking()
            .Where(c => c.StoreId == storeId && customerIds.Contains(c.Id) && c.LinkedUserId != null && !c.IsDisconnected && !c.IsArchived)
            .Select(c => new { c.Id, c.LinkedUserId }).ToListAsync();
        var userOf = new Dictionary<int, int>();
        foreach (var c in linked) userOf[c.Id] = c.LinkedUserId!.Value;
        if (userOf.Count == 0) return 0;

        var mine = overdue.Where(o => userOf.ContainsKey(o.CustomerId)).ToList();
        var txIds = mine.Select(o => o.TransactionId).ToList();
        var numbers = await db.Transactions.AsNoTracking().Where(t => txIds.Contains(t.Id))
            .Select(t => new { t.Id, t.Number }).ToListAsync();
        var numberOf = new Dictionary<int, int>();
        foreach (var t in numbers) numberOf[t.Id] = t.Number;
        var storeName = await db.Stores.AsNoTracking().Where(s => s.Id == storeId).Select(s => s.Name).FirstOrDefaultAsync() ?? "the store";

        var userIds = userOf.Values.Distinct().ToList();
        var sentRows = await db.Notifications.AsNoTracking()
            .Where(n => n.Type == Type && n.TargetKind == TargetKind && userIds.Contains(n.UserId) && n.TargetId != null && txIds.Contains(n.TargetId.Value))
            .Select(n => new { n.UserId, n.TargetId, n.Message }).ToListAsync();
        var sent = sentRows.Select(n => new SentNotice(n.UserId, n.TargetId, n.Message)).ToList();

        var credits = new List<OverdueCredit>();
        foreach (var o in mine)
        {
            if (!numberOf.TryGetValue(o.TransactionId, out var number)) continue;
            credits.Add(new OverdueCredit(o.TransactionId, number, o.DueDate!.Value, o.Outstanding, userOf[o.CustomerId], storeName));
        }

        var notices = Plan(credits, sent);
        foreach (var n in notices)
            await Notifier.Add(db, n.UserId, Type, n.Title, n.Message, TargetKind, n.TransactionId);
        return notices.Count;
    }
}
