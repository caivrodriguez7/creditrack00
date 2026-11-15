using System.Text.Json;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// Part 5A: search, days filter, sorting and paging of the overdue accounts list (no database needed).
// Run with:  dotnet test CrediTrack.Tests
public class OverdueAccountsTests
{
    private static readonly DateOnly Today = new(2026, 11, 12);

    private readonly List<Transaction> _tx = new();
    private readonly Dictionary<int, Customer> _customers = new();
    private readonly Dictionary<int, decimal> _balances = new();
    private int _next = 1;

    private void Add(int id, string name, int? daysOverdue, decimal amount, decimal paid = 0, bool dueInFuture = false)
    {
        _customers[id] = new Customer { Id = id, StoreId = 1, Code = "CUS-" + id.ToString("000"), Name = name };
        DateOnly? due = dueInFuture ? Today.AddDays(5) : daysOverdue == null ? null : Today.AddDays(-daysOverdue.Value);
        _tx.Add(new Transaction { Id = _next++, CustomerId = id, Type = "credit", Amount = amount, DueDate = due, Date = new DateTime(2026, 10, 1, 4, 0, 0, DateTimeKind.Utc) });
        if (paid > 0) _tx.Add(new Transaction { Id = _next++, CustomerId = id, Type = "payment", Amount = paid, Date = new DateTime(2026, 10, 20, 4, 0, 0, DateTimeKind.Utc) });
        _balances[id] = amount - paid;
    }

    public OverdueAccountsTests()
    {
        Add(1, "Ana Cruz", 12, 500);
        Add(2, "Mariana Lopez", 3, 300, paid: 100);    // overdue 200 of a 200 balance
        Add(3, "Ben Torres", 8, 800);
        Add(4, "Zed Late", 45, 1000);
        Add(8, "Edge Seven", 7, 150);
        Add(9, "Edge Thirty", 30, 250);
        Add(10, "Edge ThirtyOne", 31, 90);
        Add(5, "Not Yet Due", null, 400, dueInFuture: true);   // not overdue
        Add(6, "No Due Date", null, 600);                       // not overdue
        Add(7, "Fully Paid", 20, 700, paid: 700);               // paid, so not overdue
    }

    private JsonElement Run(OverdueAccountQuery q, IReadOnlyDictionary<int, Customer>? customers = null)
    {
        var accounts = OverdueRule.Accounts(OverdueRule.Evaluate(_tx, Today).Values);
        return JsonSerializer.SerializeToElement(OverdueAccounts.Build(accounts, customers ?? _customers, _balances, q));
    }

    private static List<string> Names(JsonElement r) => r.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()!).ToList();

    [Fact] public void Lists_only_overdue_customers_with_balance_due_date_and_days()
    {
        var r = Run(new OverdueAccountQuery());
        Assert.Equal(7, r.GetProperty("totalCount").GetInt32());
        Assert.Equal(7, r.GetProperty("totalAll").GetInt32());
        Assert.DoesNotContain("Not Yet Due", Names(r)); Assert.DoesNotContain("No Due Date", Names(r)); Assert.DoesNotContain("Fully Paid", Names(r));
        var mariana = r.GetProperty("items").EnumerateArray().First(i => i.GetProperty("name").GetString() == "Mariana Lopez");
        Assert.Equal(200m, mariana.GetProperty("balance").GetDecimal());
        Assert.Equal(200m, mariana.GetProperty("overdueAmount").GetDecimal());
        Assert.Equal("2026-11-09", mariana.GetProperty("dueDate").GetString());
        Assert.Equal(3, mariana.GetProperty("daysOverdue").GetInt32());
        Assert.Equal("CUS-002", mariana.GetProperty("code").GetString());
    }

    [Fact] public void Overdue_account_count_equals_the_dashboard_rule()
    {
        var infos = OverdueRule.Evaluate(_tx, Today).Values;
        Assert.Equal(OverdueRule.DaysByCustomer(infos).Count, Run(new OverdueAccountQuery()).GetProperty("totalAll").GetInt32());
    }

    [Fact] public void Search_by_name_is_a_case_insensitive_contains()
    {
        var r = Run(new OverdueAccountQuery { Search = "ANA" });
        Assert.Equal(new[] { "Mariana Lopez", "Ana Cruz" }.OrderBy(x => x), Names(r).OrderBy(x => x));
        Assert.Equal(2, r.GetProperty("totalCount").GetInt32());
        Assert.Equal(7, r.GetProperty("totalAll").GetInt32());
        Assert.Equal(2, r.GetProperty("chipCounts").GetProperty("all").GetInt32());   // chip counts follow the search
        Assert.Empty(Names(Run(new OverdueAccountQuery { Search = "nobody" })));
        Assert.Equal(7, Run(new OverdueAccountQuery { Search = "   " }).GetProperty("totalCount").GetInt32());
    }

    [Fact] public void Search_does_not_treat_percent_or_underscore_as_wildcards()
    {
        Assert.Empty(Names(Run(new OverdueAccountQuery { Search = "%" })));
        Assert.Empty(Names(Run(new OverdueAccountQuery { Search = "_" })));
    }

    [Theory]
    [InlineData("1-7", new[] { "Mariana Lopez", "Edge Seven" })]
    [InlineData("8-30", new[] { "Ana Cruz", "Ben Torres", "Edge Thirty" })]
    [InlineData("30+", new[] { "Zed Late", "Edge ThirtyOne" })]
    public void Days_filter_has_exact_boundaries(string range, string[] expected)
    {
        var r = Run(new OverdueAccountQuery { OverdueRange = range });
        Assert.Equal(expected.OrderBy(x => x), Names(r).OrderBy(x => x));
        Assert.Equal(expected.Length, r.GetProperty("totalCount").GetInt32());
        Assert.Equal(7, r.GetProperty("totalAll").GetInt32());
    }

    [Fact] public void Days_filter_summary_covers_every_match_and_chip_counts_ignore_the_filter()
    {
        var r = Run(new OverdueAccountQuery { OverdueRange = "8-30", PageSize = 1 });
        Assert.Equal(3, r.GetProperty("summary").GetProperty("count").GetInt32());
        Assert.Equal(1550m, r.GetProperty("summary").GetProperty("total").GetDecimal());   // 500 + 800 + 250, not just the page
        var chips = r.GetProperty("chipCounts");
        Assert.Equal(7, chips.GetProperty("all").GetInt32()); Assert.Equal(2, chips.GetProperty("1-7").GetInt32());
        Assert.Equal(3, chips.GetProperty("8-30").GetInt32()); Assert.Equal(2, chips.GetProperty("30+").GetInt32());
    }

    [Fact] public void Plus_sign_that_arrived_as_a_space_still_means_30_plus()
    {
        Assert.Equal(2, Run(new OverdueAccountQuery { OverdueRange = "30 " }).GetProperty("totalCount").GetInt32());
    }

    [Fact] public void Search_and_days_filter_work_together()
    {
        Assert.Equal(new[] { "Ana Cruz" }, Names(Run(new OverdueAccountQuery { Search = "ana", OverdueRange = "8-30" })));
        Assert.Empty(Names(Run(new OverdueAccountQuery { Search = "ana", OverdueRange = "30+" })));
    }

    [Theory]
    [InlineData(null, new[] { "Zed Late", "Edge ThirtyOne", "Edge Thirty", "Ana Cruz", "Ben Torres", "Edge Seven", "Mariana Lopez" })]   // default = due-asc
    [InlineData("due-asc", new[] { "Zed Late", "Edge ThirtyOne", "Edge Thirty", "Ana Cruz", "Ben Torres", "Edge Seven", "Mariana Lopez" })]
    [InlineData("due-desc", new[] { "Mariana Lopez", "Edge Seven", "Ben Torres", "Ana Cruz", "Edge Thirty", "Edge ThirtyOne", "Zed Late" })]
    [InlineData("amount-desc", new[] { "Zed Late", "Ben Torres", "Ana Cruz", "Edge Thirty", "Mariana Lopez", "Edge Seven", "Edge ThirtyOne" })]
    [InlineData("amount-asc", new[] { "Edge ThirtyOne", "Edge Seven", "Mariana Lopez", "Edge Thirty", "Ana Cruz", "Ben Torres", "Zed Late" })]
    [InlineData("days-desc", new[] { "Zed Late", "Edge ThirtyOne", "Edge Thirty", "Ana Cruz", "Ben Torres", "Edge Seven", "Mariana Lopez" })]
    [InlineData("days-asc", new[] { "Mariana Lopez", "Edge Seven", "Ben Torres", "Ana Cruz", "Edge Thirty", "Edge ThirtyOne", "Zed Late" })]
    [InlineData("name-asc", new[] { "Ana Cruz", "Ben Torres", "Edge Seven", "Edge Thirty", "Edge ThirtyOne", "Mariana Lopez", "Zed Late" })]
    [InlineData("name-desc", new[] { "Zed Late", "Mariana Lopez", "Edge ThirtyOne", "Edge Thirty", "Edge Seven", "Ben Torres", "Ana Cruz" })]
    [InlineData("nonsense", new[] { "Zed Late", "Edge ThirtyOne", "Edge Thirty", "Ana Cruz", "Ben Torres", "Edge Seven", "Mariana Lopez" })]   // unknown -> default
    public void Sorting(string? sortBy, string[] expected)
    {
        Assert.Equal(expected, Names(Run(new OverdueAccountQuery { SortBy = sortBy })));
    }

    [Fact] public void Equal_due_dates_are_ordered_by_amount_then_name()
    {
        Add(20, "Small Same Day", 15, 100);
        Add(21, "Big Same Day", 15, 900);
        var names = Names(Run(new OverdueAccountQuery { SortBy = "due-asc" }));
        Assert.True(names.IndexOf("Big Same Day") < names.IndexOf("Small Same Day"));
    }

    [Fact] public void Paging_returns_every_account_once_with_the_total_count()
    {
        var seen = new List<string>();
        for (var p = 1; p <= 3; p++)
        {
            var r = Run(new OverdueAccountQuery { Page = p, PageSize = 3 });
            Assert.Equal(7, r.GetProperty("totalCount").GetInt32());
            Assert.Equal(3, r.GetProperty("totalPages").GetInt32());
            Assert.Equal(p, r.GetProperty("page").GetInt32());
            Assert.Equal(p < 3, r.GetProperty("hasMore").GetBoolean());
            Assert.Equal(p < 3 ? 3 : 1, Names(r).Count);
            seen.AddRange(Names(r));
        }
        Assert.Equal(7, seen.Distinct().Count());
    }

    [Fact] public void Page_past_the_end_is_empty_but_still_reports_the_total()
    {
        var r = Run(new OverdueAccountQuery { Page = 9, PageSize = 3 });
        Assert.Empty(Names(r)); Assert.Equal(7, r.GetProperty("totalCount").GetInt32()); Assert.False(r.GetProperty("hasMore").GetBoolean());
    }

    [Fact] public void Bad_paging_is_clamped()
    {
        var r = Run(new OverdueAccountQuery { Page = 0, PageSize = 1000 });
        Assert.Equal(1, r.GetProperty("page").GetInt32()); Assert.Equal(100, r.GetProperty("pageSize").GetInt32());
        var d = Run(new OverdueAccountQuery { Page = -4, PageSize = -1 });
        Assert.Equal(1, d.GetProperty("page").GetInt32()); Assert.Equal(1, d.GetProperty("pageSize").GetInt32());
        Assert.Equal(20, Run(new OverdueAccountQuery()).GetProperty("pageSize").GetInt32());
    }

    [Fact] public void An_account_whose_customer_is_not_in_the_store_list_is_never_returned()
    {
        var onlyOne = new Dictionary<int, Customer> { [1] = _customers[1] };   // what the controller loads: only this store's customers
        var r = Run(new OverdueAccountQuery(), onlyOne);
        Assert.Equal(new[] { "Ana Cruz" }, Names(r)); Assert.Equal(1, r.GetProperty("totalAll").GetInt32());
    }
}
