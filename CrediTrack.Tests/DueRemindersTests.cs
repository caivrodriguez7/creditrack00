using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// The customer Home reminder. Run with:  dotnet test CrediTrack.Tests
public class DueRemindersTests
{
    private static readonly DateOnly Today = new(2026, 11, 12);
    private static int next = 1000;

    private static Transaction Credit(decimal amount, DateOnly? due, bool voided = false, int customer = 1) => new()
    {
        Id = next++, Number = next, CustomerId = customer, Type = "credit", Amount = amount, DueDate = due, IsVoided = voided,
        Date = new DateTime(2026, 10, 1, 4, 0, 0, DateTimeKind.Utc)
    };

    private static Transaction Payment(decimal amount, int customer = 1) => new()
    {
        Id = next++, CustomerId = customer, Type = "payment", Amount = amount,
        Date = new DateTime(2026, 10, 20, 4, 0, 0, DateTimeKind.Utc)
    };

    [Fact] public void Past_due_date_is_overdue_with_days()
    {
        var r = Assert.Single(DueReminders.Build(new[] { Credit(500, Today.AddDays(-3)) }, Today));
        Assert.Equal("overdue", r.Status); Assert.Equal(3, r.Days); Assert.Equal(500m, r.Outstanding);
    }

    [Fact] public void Due_today_is_today_and_not_overdue()
    {
        var r = Assert.Single(DueReminders.Build(new[] { Credit(200, Today) }, Today));
        Assert.Equal("today", r.Status); Assert.Equal(0, r.Days);
    }

    [Fact] public void Due_within_a_week_is_soon_with_days_left()
    {
        var r = Assert.Single(DueReminders.Build(new[] { Credit(200, Today.AddDays(3)) }, Today));
        Assert.Equal("soon", r.Status); Assert.Equal(3, r.Days);
    }

    [Fact] public void Due_later_than_the_window_is_left_out()
        => Assert.Empty(DueReminders.Build(new[] { Credit(200, Today.AddDays(8)) }, Today));

    [Fact] public void No_due_date_fully_paid_and_voided_are_left_out()
    {
        var paid = Credit(300, Today.AddDays(-1));
        var all = new[] { Credit(100, null), paid, Payment(300), Credit(400, Today.AddDays(-2), voided: true) };
        Assert.Empty(DueReminders.Build(all, Today));
    }

    [Fact] public void Partly_paid_shows_only_what_is_left()
    {
        var r = Assert.Single(DueReminders.Build(new[] { Credit(500, Today.AddDays(-1)), Payment(200) }, Today));
        Assert.Equal(300m, r.Outstanding);
    }

    [Fact] public void Overdue_first_then_by_due_date()
    {
        var list = DueReminders.Build(new[] { Credit(1, Today.AddDays(2)), Credit(1, Today.AddDays(-5)), Credit(1, Today) }, Today);
        Assert.Equal(new[] { "overdue", "today", "soon" }, list.Select(x => x.Status).ToArray());
    }

    [Fact] public void Midnight_turns_due_today_into_overdue()
    {
        var all = new[] { Credit(250, Today) };
        Assert.Equal("today", DueReminders.Build(all, Today)[0].Status);
        Assert.Equal("overdue", DueReminders.Build(all, Today.AddDays(1))[0].Status);   // 12:00 AM of the next Philippine day
    }
}
