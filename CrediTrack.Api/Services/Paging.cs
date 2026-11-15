using System.Globalization;

namespace CrediTrack.Api.Services;

// Helpers shared by every list endpoint: page numbers, text search, Philippine-time date windows.
public static class Paging
{
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 100;

    // Bad input never throws: page >= 1, pageSize 1..100 (same clamping as js/api/list-query.js)
    public static (int Page, int PageSize) Normalize(int? page, int? pageSize) =>
        (Math.Max(1, page ?? 1), Math.Min(MaxPageSize, Math.Max(1, pageSize ?? DefaultPageSize)));

    // The response every paged list returns. Screens add their own extras (counts, totals) to the dictionary.
    public static Dictionary<string, object?> Result<T>(IEnumerable<T> items, int totalCount, int page, int pageSize)
    {
        var list = items.ToList();
        return new Dictionary<string, object?>
        {
            ["items"] = list,
            ["totalCount"] = totalCount,
            ["page"] = page,
            ["pageSize"] = pageSize,
            ["totalPages"] = Math.Max(1, (int)Math.Ceiling(totalCount / (double)pageSize)),
            ["hasMore"] = (page - 1) * pageSize + list.Count < totalCount
        };
    }

    // An allowed value, or the fallback (an unknown filter falls back to the default, like the frontend)
    public static string Pick(string? value, string[] allowed, string fallback)
    {
        var v = (value ?? "").Trim().ToLowerInvariant();
        return Array.IndexOf(allowed, v) >= 0 ? v : fallback;
    }

    // Trimmed search text (max 100 characters)
    public static string Search(string? value)
    {
        var s = (value ?? "").Trim();
        return s.Length > 100 ? s[..100] : s;
    }

    // "%text%" for ILIKE, with the LIKE wildcards in the text escaped
    public static string Like(string text) =>
        "%" + text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    // ---- Dates: the app is for the Philippines (UTC+8), like the existing payment date rule ----
    public static readonly TimeSpan PhOffset = TimeSpan.FromHours(8);

    public static DateTime PhToday() => DateTime.UtcNow.Add(PhOffset).Date;

    // Start of a Philippine calendar day, as a UTC instant
    public static DateTime DayStartUtc(DateTime phDay) =>
        DateTime.SpecifyKind(phDay.Date - PhOffset, DateTimeKind.Utc);

    public static bool TryDay(string? text, out DateTime day) =>
        DateTime.TryParseExact(text ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day);

    // dateRange: all | today | 7 | 30 | month | custom (+ from / to as yyyy-MM-dd).
    // Returns [FromUtc, ToExclusiveUtc) and Invalid = a custom range that starts after it ends.
    public static (DateTime? FromUtc, DateTime? ToExclusiveUtc, bool Invalid) Window(string? range, string? from, string? to)
    {
        var r = Pick(range, new[] { "all", "today", "7", "30", "month", "custom" }, "all");
        var today = PhToday();
        DateTime? a = null, b = null;   // PH days, b inclusive
        if (r == "today") a = today;
        else if (r == "7") a = today.AddDays(-6);
        else if (r == "30") a = today.AddDays(-29);
        else if (r == "month") a = new DateTime(today.Year, today.Month, 1);
        else if (r == "custom")
        {
            if (TryDay(from, out var f)) a = f;
            if (TryDay(to, out var t)) b = t;
            if (a != null && b != null && a > b) return (null, null, true);
        }
        return (a == null ? null : DayStartUtc(a.Value), b == null ? null : DayStartUtc(b.Value.AddDays(1)), false);
    }
}
