using CrediTrack.Api.Models;

namespace CrediTrack.Api.Services;

// Query string of GET /api/owner/overdue-accounts. Every value is optional; a bad or unknown value falls back to its default.
public class OverdueAccountQuery
{
    public string? Search { get; set; }         // customer name contains this text (not case sensitive)
    public string? OverdueRange { get; set; }   // all | 1-7 | 8-30 | 30+  (days overdue; 30+ means more than 30)
    public string? SortBy { get; set; }         // due-asc | due-desc | amount-desc | amount-asc | days-desc | days-asc | name-asc | name-desc
    public int? Page { get; set; }              // 1-based
    public int? PageSize { get; set; }          // 1..100 (default 20)
}

// Search, filter, sort and paging of the overdue accounts. It works on a plain list, so it can be tested without a database.
// WHO is overdue and by how much is NOT decided here: that comes from OverdueRule (OverdueRule.Accounts); this class only
// filters, orders and cuts pages out of those results.
public static class OverdueAccounts
{
    public static readonly string[] Ranges = { "all", "1-7", "8-30", "30+" };
    public static readonly string[] Sorts = { "due-asc", "due-desc", "amount-desc", "amount-asc", "days-desc", "days-asc", "name-asc", "name-desc" };

    private record Row(OverdueAccount Account, Customer Customer, decimal Balance);

    private static bool InRange(string range, int days) => range switch
    {
        "1-7" => days >= 1 && days <= 7,
        "8-30" => days >= 8 && days <= 30,
        "30+" => days > 30,
        _ => true
    };

    // "30+" arrives as "30 " when the plus sign was not URL-encoded (a + in a query string means a space)
    private static string? NormalizeRange(string? value) => value != null && value.Trim() == "30" ? "30+" : value;

    // accounts   the overdue accounts of ONE store (OverdueRule.Accounts)
    // customers  that store's customers, by id (an account whose customer is not in it is left out: nothing of another store can appear)
    // balances   that store's customer balances (Ledger.Balances): the "outstanding balance" of the whole customer
    public static Dictionary<string, object?> Build(IEnumerable<OverdueAccount> accounts, IReadOnlyDictionary<int, Customer> customers,
        IReadOnlyDictionary<int, decimal> balances, OverdueAccountQuery q)
    {
        var range = Paging.Pick(NormalizeRange(q.OverdueRange), Ranges, "all");
        var sort = Paging.Pick(q.SortBy, Sorts, "due-asc");
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);
        var search = Paging.Search(q.Search);

        var all = accounts.Where(a => customers.ContainsKey(a.CustomerId))
            .Select(a => new Row(a, customers[a.CustomerId], balances.GetValueOrDefault(a.CustomerId))).ToList();

        // Search by customer name; the chip counts follow the search but ignore the days filter
        var named = search.Length == 0 ? all : all.Where(r => r.Customer.Name.Contains(search, StringComparison.OrdinalIgnoreCase)).ToList();
        var chipCounts = new Dictionary<string, int>();
        foreach (var r in Ranges) chipCounts[r] = named.Count(x => InRange(r, x.Account.DaysOverdue));

        var matches = named.Where(r => InRange(range, r.Account.DaysOverdue)).ToList();

        // The tie-breakers keep the order stable between pages: amount (largest first), name, then id
        IOrderedEnumerable<Row> ordered = sort switch
        {
            "due-desc" => matches.OrderByDescending(r => r.Account.DueDate),
            "amount-desc" => matches.OrderByDescending(r => r.Account.OverdueAmount),
            "amount-asc" => matches.OrderBy(r => r.Account.OverdueAmount),
            "days-desc" => matches.OrderByDescending(r => r.Account.DaysOverdue),
            "days-asc" => matches.OrderBy(r => r.Account.DaysOverdue),
            "name-asc" => matches.OrderBy(r => r.Customer.Name, StringComparer.OrdinalIgnoreCase),
            "name-desc" => matches.OrderByDescending(r => r.Customer.Name, StringComparer.OrdinalIgnoreCase),
            _ => matches.OrderBy(r => r.Account.DueDate)
        };
        var pageRows = ordered.ThenByDescending(r => r.Account.OverdueAmount)
            .ThenBy(r => r.Customer.Name, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.Customer.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToList();

        var items = pageRows.Select(r => new
        {
            customerId = r.Customer.Id,
            code = r.Customer.Code,
            name = r.Customer.Name,
            phone = r.Customer.Phone ?? "",
            archived = r.Customer.IsArchived,
            balance = r.Balance,                                    // outstanding balance: everything the customer still owes
            overdueAmount = r.Account.OverdueAmount,                // the part of it that is on overdue credits
            dueDate = r.Account.DueDate.ToString("yyyy-MM-dd"),     // oldest overdue due date
            daysOverdue = r.Account.DaysOverdue,
            overdueCredits = r.Account.OverdueCredits
        }).ToList();

        var result = Paging.Result(items, matches.Count, page, pageSize);
        result["summary"] = new { count = matches.Count, total = Math.Round(matches.Sum(r => r.Account.OverdueAmount), 2) };   // every match, not just this page
        result["chipCounts"] = chipCounts;
        result["totalAll"] = all.Count;                              // every overdue account of the store, before search and filter
        return result;
    }
}
