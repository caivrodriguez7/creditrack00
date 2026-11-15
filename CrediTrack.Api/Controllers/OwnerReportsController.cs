using System.Globalization;
using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Reports screen. Same response shape as CrediTrackApi.getReportsOverview() in js/api/owner-api.js,
// plus paging for the detailed table.
// GET /api/owner/reports?period=week|month|last-month|year|custom&startDate=2026-11-01&endDate=2026-11-09&page=1&pageSize=20
[ApiController]
[Route("api/owner/reports")]
[Authorize(Roles = "owner")]
public class OwnerReportsController : ControllerBase
{
    private readonly AppDb _db;
    public OwnerReportsController(AppDb db) { _db = db; }

    public class ReportQuery
    {
        public string? Period { get; set; }
        public string? StartDate { get; set; }
        public string? EndDate { get; set; }
        public string? Start { get; set; }   // same as startDate (the frontend period uses start / end)
        public string? End { get; set; }
        public int? Page { get; set; }
        public int? PageSize { get; set; }
    }

    private const int MaxChartMonths = 12;
    private const string DayFormat = "yyyy-MM-dd";
    private static readonly Dictionary<string, string> Labels = new()
    {
        ["week"] = "This Week", ["month"] = "This Month", ["last-month"] = "Last Month",
        ["year"] = "This Year", ["custom"] = "Custom Range"
    };

    private async Task<int?> MyStoreId()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Stores.Where(s => s.OwnerId == userId)
            .Select(s => (int?)s.Id).FirstOrDefaultAsync();
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] ReportQuery q)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        var key = string.IsNullOrWhiteSpace(q.Period) ? "month" : q.Period.Trim().ToLowerInvariant();
        if (!Labels.ContainsKey(key)) return BadRequest(new { message = "Unknown reporting period." });
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);

        // Philippine calendar days, both ends included (weeks run Monday to Sunday)
        var today = Paging.PhToday();
        DateTime start, end;
        if (key == "week") { start = today.AddDays(-(((int)today.DayOfWeek + 6) % 7)); end = start.AddDays(6); }
        else if (key == "month") { start = new DateTime(today.Year, today.Month, 1); end = start.AddMonths(1).AddDays(-1); }
        else if (key == "last-month") { start = new DateTime(today.Year, today.Month, 1).AddMonths(-1); end = start.AddMonths(1).AddDays(-1); }
        else if (key == "year") { start = new DateTime(today.Year, 1, 1); end = new DateTime(today.Year, 12, 31); }
        else
        {
            if (!Paging.TryDay(q.StartDate ?? q.Start, out start) || !Paging.TryDay(q.EndDate ?? q.End, out end))
                return BadRequest(new { message = "Choose both a start date and an end date." });
            if (end < start) return BadRequest(new { message = "The end date cannot be earlier than the start date." });
            if ((end - start).TotalDays > 366 * 5) return BadRequest(new { message = "Choose a date range of 5 years or less." });
        }
        var fromUtc = Paging.DayStartUtc(start);
        var toUtc = Paging.DayStartUtc(end.AddDays(1));   // exclusive

        // Voided records are kept but never counted. Only the columns the totals need.
        var rows = await _db.Transactions
            .Where(t => t.StoreId == storeId && !t.IsVoided && t.Date >= fromUtc && t.Date < toUtc)
            .Select(t => new { t.Id, t.Type, t.Amount, t.Date })
            .ToListAsync();
        var credits = rows.Where(r => r.Type == "credit").ToList();
        var payments = rows.Where(r => r.Type == "payment").ToList();

        // Chart: every calendar month the period touches, never later than this month, the latest 12
        var months = new List<object>();
        var lastMonth = new DateTime(Math.Min(end.Ticks, today.Ticks)).Date;
        lastMonth = new DateTime(lastMonth.Year, lastMonth.Month, 1);
        var cursor = new DateTime(start.Year, start.Month, 1);
        while (cursor <= lastMonth)
        {
            var c = cursor;
            bool InMonth(DateTime utc) { var ph = utc + Paging.PhOffset; return ph.Year == c.Year && ph.Month == c.Month; }
            months.Add(new
            {
                key = c.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                year = c.Year,
                month = c.Month,
                label = c.ToString("MMM", CultureInfo.InvariantCulture),
                title = c.ToString("MMMM yyyy", CultureInfo.InvariantCulture),
                utang = credits.Where(r => InMonth(r.Date)).Sum(r => r.Amount),
                bayad = payments.Where(r => InMonth(r.Date)).Sum(r => r.Amount),
                current = c.Year == today.Year && c.Month == today.Month
            });
            cursor = cursor.AddMonths(1);
        }
        var truncated = months.Count > MaxChartMonths;
        if (truncated) months = months.Skip(months.Count - MaxChartMonths).ToList();

        // Outstanding comes from the existing Ledger rule (credits minus payments, voided left out)
        var owing = (await Ledger.Balances(_db, storeId.Value)).Values.Where(b => b > 0).ToList();

        // Overdue Balance (Part 4C): unpaid amount of the overdue credits only, from the one overdue rule (OverdueRule).
        // Like Outstanding it is "as of today" and does not depend on the selected period.
        var overdue = await OverdueRule.TotalsForStore(_db, storeId.Value);

        // Newest first; the table is one page, "recent" is the 5 newest of the period
        var ordered = rows.OrderByDescending(r => r.Date).ThenByDescending(r => r.Id).Select(r => r.Id).ToList();
        var pageIds = ordered.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        var recentIds = ordered.Take(5).ToList();
        var wanted = pageIds.Union(recentIds).ToList();
        var loaded = await _db.Transactions.Include(t => t.Customer)
            .Where(t => t.StoreId == storeId && wanted.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);
        object Row(int id)
        {
            var t = loaded[id];
            return new { id = t.Id, code = Ledger.Code(t.Number), date = t.Date, customer = t.Customer.Name, type = t.Type, amount = t.Amount };
        }

        var totalCount = ordered.Count;
        return Ok(new
        {
            isSample = false,
            hasRecords = await _db.Transactions.AnyAsync(t => t.StoreId == storeId)
                         || await _db.Customers.AnyAsync(c => c.StoreId == storeId),
            period = new
            {
                key,
                label = Labels[key],
                start = fromUtc.ToString("o", CultureInfo.InvariantCulture),
                end = toUtc.AddMilliseconds(-1).ToString("o", CultureInfo.InvariantCulture)
            },
            utang = new { total = Math.Round(credits.Sum(r => r.Amount), 2), count = credits.Count },
            bayad = new { total = Math.Round(payments.Sum(r => r.Amount), 2), count = payments.Count },
            outstanding = new { total = Math.Round(owing.Sum(), 2), customers = owing.Count },
            overdue = new { total = overdue.Balance, accounts = overdue.Accounts, credits = overdue.Credits },
            months,
            monthsTruncated = truncated,
            recent = recentIds.Select(Row).ToList(),
            table = pageIds.Select(Row).ToList(),
            page,
            pageSize,
            totalCount,
            totalPages = Math.Max(1, (int)Math.Ceiling(totalCount / (double)pageSize)),
            hasMore = (page - 1) * pageSize + pageIds.Count < totalCount
        });
    }
}
