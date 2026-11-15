using CrediTrack.Api.Services;
using Xunit;
using static CrediTrack.Api.Services.OverdueNotifier;

namespace CrediTrack.Tests;

// Part 6B: which overdue notifications are made, and that the same overdue event is never notified twice.
// These tests need no database (OverdueNotifier.Plan works on plain lists). Run with:  dotnet test CrediTrack.Tests
public class OverdueNotifierTests
{
    private static readonly DateOnly Due = new(2026, 11, 5);

    private static OverdueCredit Credit(int tx = 10, int user = 1, DateOnly? due = null, decimal outstanding = 70m) =>
        new(tx, 12, due ?? Due, outstanding, user, "Aling Nena");

    private static SentNotice Sent(OverdueNotice n) => new(n.UserId, n.TransactionId, n.Message);

    [Fact] public void An_overdue_credit_makes_one_notification()
    {
        var plan = Plan(new[] { Credit() }, Array.Empty<SentNotice>());
        var n = Assert.Single(plan);
        Assert.Equal(1, n.UserId);
        Assert.Equal(10, n.TransactionId);
        Assert.Equal("Credit Overdue", n.Title);
        Assert.Contains("TRX-0012", n.Message);
        Assert.Contains("Aling Nena", n.Message);
        Assert.Contains("November 5, 2026", n.Message);
        Assert.Contains("₱70.00", n.Message);
    }

    [Fact] public void The_same_event_is_not_notified_again()
    {
        var first = Plan(new[] { Credit() }, Array.Empty<SentNotice>());
        var second = Plan(new[] { Credit() }, first.Select(Sent));   // the next scan, after the first one was saved
        Assert.Empty(second);
    }

    [Fact] public void The_amount_changing_does_not_make_a_duplicate()
    {
        var first = Plan(new[] { Credit(outstanding: 70m) }, Array.Empty<SentNotice>());
        var later = Plan(new[] { Credit(outstanding: 20m) }, first.Select(Sent));   // part of it was paid since
        Assert.Empty(later);
    }

    [Fact] public void A_moved_due_date_that_goes_overdue_again_is_a_new_event()
    {
        var first = Plan(new[] { Credit(due: Due) }, Array.Empty<SentNotice>());
        var again = Plan(new[] { Credit(due: new DateOnly(2026, 11, 30)) }, first.Select(Sent));
        var n = Assert.Single(again);
        Assert.Contains("November 30, 2026", n.Message);
    }

    [Fact] public void Other_credits_and_other_customers_are_separate_events()
    {
        var first = Plan(new[] { Credit(tx: 10, user: 1) }, Array.Empty<SentNotice>());
        var plan = Plan(new[] { Credit(tx: 10, user: 1), Credit(tx: 11, user: 1), Credit(tx: 10, user: 2) }, first.Select(Sent));
        Assert.Equal(2, plan.Count);
        Assert.Contains(plan, n => n.TransactionId == 11 && n.UserId == 1);
        Assert.Contains(plan, n => n.TransactionId == 10 && n.UserId == 2);
    }

    [Fact] public void The_same_event_twice_in_one_scan_is_made_once()
    {
        Assert.Single(Plan(new[] { Credit(), Credit() }, Array.Empty<SentNotice>()));
    }

    [Fact] public void Day_numbers_do_not_confuse_the_duplicate_check()
    {
        // "November 5, 2026" must not match a notification for "November 15, 2026" (or the reverse)
        var for15 = Plan(new[] { Credit(due: new DateOnly(2026, 11, 15)) }, Array.Empty<SentNotice>());
        var plan = Plan(new[] { Credit(due: new DateOnly(2026, 11, 5)) }, for15.Select(Sent));
        Assert.Single(plan);
    }

    [Fact] public void Notifications_of_no_credit_are_ignored()
    {
        var plan = Plan(new[] { Credit() }, new[] { new SentNotice(1, null, EventMarker(Due)) });
        Assert.Single(plan);
    }
}
