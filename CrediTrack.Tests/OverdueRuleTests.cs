using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// Run with:  dotnet test CrediTrack.Tests
public class OverdueRuleTests
{
    private static readonly DateOnly Today = new(2026, 11, 12);
    private static int next = 1;

    private static Transaction Credit(decimal amount, DateOnly? due, int day = 1, bool voided = false, int customer = 1) => new()
    {
        Id = next++, CustomerId = customer, Type = "credit", Amount = amount, DueDate = due, IsVoided = voided,
        Date = new DateTime(2026, 10, day, 4, 0, 0, DateTimeKind.Utc)
    };

    private static Transaction Payment(decimal amount, int day = 20, int customer = 1) => new()
    {
        Id = next++, CustomerId = customer, Type = "payment", Amount = amount,
        Date = new DateTime(2026, 10, day, 4, 0, 0, DateTimeKind.Utc)
    };

    private static OverdueInfo Run(Transaction subject, params Transaction[] others) =>
        OverdueRule.Evaluate(new[] { subject }.Concat(others).ToList(), Today)[subject.Id];

    [Fact] public void Overdue_unpaid_credit_with_past_due_date()
    {
        var r = Run(Credit(500, Today.AddDays(-5)));
        Assert.True(r.IsOverdue); Assert.Equal(5, r.DaysOverdue); Assert.Equal(500m, r.Outstanding);
    }

    [Fact] public void Overdue_when_only_partly_paid()
    {
        var c = Credit(500, Today.AddDays(-1));
        var r = Run(c, Payment(200));
        Assert.True(r.IsOverdue); Assert.Equal(300m, r.Outstanding); Assert.Equal(1, r.DaysOverdue);
    }

    [Fact] public void Not_overdue_when_due_in_the_future()
    {
        var r = Run(Credit(500, Today.AddDays(3)));
        Assert.False(r.IsOverdue); Assert.Equal(0, r.DaysOverdue);
    }

    [Fact] public void Not_overdue_when_due_today()
    {
        Assert.False(Run(Credit(500, Today)).IsOverdue);
    }

    [Fact] public void Not_overdue_without_a_due_date_even_when_unpaid_and_old()
    {
        var r = Run(Credit(500, null, day: 1));
        Assert.False(r.IsOverdue); Assert.Equal(500m, r.Outstanding);
    }

    [Fact] public void Not_overdue_when_fully_paid()
    {
        var r = Run(Credit(500, Today.AddDays(-30)), Payment(500));
        Assert.False(r.IsOverdue); Assert.Equal(0m, r.Outstanding);
    }

    [Fact] public void Voided_credit_is_not_overdue()
    {
        Assert.False(Run(Credit(500, Today.AddDays(-30), voided: true)).IsOverdue);
    }

    [Fact] public void Payments_go_to_the_oldest_credit_first()
    {
        var older = Credit(300, Today.AddDays(-10), day: 1);
        var newer = Credit(300, Today.AddDays(-2), day: 2);
        var result = OverdueRule.Evaluate(new[] { older, newer, Payment(300) }, Today);
        Assert.False(result[older.Id].IsOverdue);   // the payment cleared the oldest credit
        Assert.True(result[newer.Id].IsOverdue);
    }

    [Fact] public void Another_customers_payment_does_not_help()
    {
        var c = Credit(500, Today.AddDays(-5), customer: 1);
        Assert.True(Run(c, Payment(500, customer: 2)).IsOverdue);
    }

    [Fact] public void Plain_value_rule()
    {
        Assert.True(OverdueRule.IsOverdue(Today.AddDays(-1), 0.01m, Today));
        Assert.False(OverdueRule.IsOverdue(Today.AddDays(-1), 0m, Today));
        Assert.False(OverdueRule.IsOverdue(null, 100m, Today));
        Assert.False(OverdueRule.IsOverdue(Today, 100m, Today));
    }

    // ---- Part 4B: Dashboard count and Customers badge both come from DaysByCustomer ----
    [Fact] public void Customer_days_use_the_oldest_overdue_credit_and_skip_customers_that_are_not_overdue()
    {
        var jun1 = Credit(100, Today.AddDays(-12), day: 1, customer: 1);   // overdue 12 days
        var jun2 = Credit(100, Today.AddDays(-3), day: 2, customer: 1);    // overdue 3 days (same customer)
        var rosa = Credit(100, Today.AddDays(-8), customer: 2);            // overdue 8 days
        var ben = Credit(100, Today.AddDays(5), customer: 3);              // not yet due
        var noDue = Credit(100, null, customer: 4);                        // no due date
        var paid = Credit(100, Today.AddDays(-20), customer: 5);           // fully paid
        var all = new List<Transaction> { jun1, jun2, rosa, ben, noDue, paid, Payment(100, customer: 5) };
        var days = OverdueRule.DaysByCustomer(OverdueRule.Evaluate(all, Today).Values);
        Assert.Equal(2, days.Count);                                        // Dashboard overdue count: customers 1 and 2
        Assert.Equal(12, days[1]); Assert.Equal(8, days[2]);
        Assert.False(days.ContainsKey(3)); Assert.False(days.ContainsKey(4)); Assert.False(days.ContainsKey(5));
    }

    // ---- Part 4C: Overdue Balance for Reports and its exports ----
    [Fact] public void Overdue_balance_adds_up_only_the_unpaid_part_of_overdue_credits()
    {
        var overdueA = Credit(500, Today.AddDays(-5), day: 1, customer: 1);    // overdue; the 100 payment goes to the OLDEST credit first -> 400 unpaid
        var overdueB = Credit(300, Today.AddDays(-2), day: 2, customer: 1);    // overdue, nothing paid -> 300
        var notYetDue = Credit(400, Today.AddDays(7), customer: 2);            // not yet due            -> 0
        var dueToday = Credit(250, Today, customer: 3);                        // due today (not late)   -> 0
        var noDue = Credit(600, null, customer: 4);                            // no due date            -> 0
        var paid = Credit(700, Today.AddDays(-30), customer: 5);               // fully paid             -> 0
        var voided = Credit(900, Today.AddDays(-9), voided: true, customer: 6);// voided                 -> 0
        var all = new List<Transaction> { overdueA, overdueB, notYetDue, dueToday, noDue, paid, voided,
            Payment(100, customer: 1), Payment(700, customer: 5) };
        var t = OverdueRule.Totals(OverdueRule.Evaluate(all, Today).Values);
        Assert.Equal(700m, t.Balance);   // 400 + 300
        Assert.Equal(1, t.Accounts);     // only customer 1
        Assert.Equal(2, t.Credits);
    }

    [Fact] public void Overdue_balance_is_zero_when_nothing_is_overdue()
    {
        var all = new List<Transaction> { Credit(400, Today.AddDays(3)), Credit(300, null, customer: 2) };
        var t = OverdueRule.Totals(OverdueRule.Evaluate(all, Today).Values);
        Assert.Equal(0m, t.Balance); Assert.Equal(0, t.Accounts); Assert.Equal(0, t.Credits);
    }

    [Fact] public void Overdue_account_count_matches_the_dashboard_and_customers_rule()
    {
        var all = new List<Transaction> { Credit(100, Today.AddDays(-12), day: 1), Credit(100, Today.AddDays(-3), day: 2),
            Credit(100, Today.AddDays(-8), customer: 2), Credit(100, Today.AddDays(5), customer: 3) };
        var infos = OverdueRule.Evaluate(all, Today).Values;
        Assert.Equal(OverdueRule.DaysByCustomer(infos).Count, OverdueRule.Totals(infos).Accounts);
    }
}
