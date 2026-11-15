/* Shared list-query helpers (window.CrediTrackQuery).
   Used by the API layer (owner-api.js, customer-api.js) to filter and paginate lists the SAME way a server will.

   THE CONTRACT
   A list screen never receives the whole table and filters it itself. It sends a query and gets back ONE PAGE:

     request   { search, <filters...>, page (1-based), pageSize }
     response  { items, totalCount, page, pageSize, totalPages, hasMore, ...extras (counts, totals) }

   `totalCount` is the number of rows that match the filters (not the rows on this page).
   `extras` are numbers the screen shows (tab counts, summary totals) that must cover ALL matching rows, so they are
   computed by the API function and never by the page.

   MOVING TO ASP.NET CORE + POSTGRESQL (later; nothing of that exists yet)
   - Each query object below becomes a query DTO bound with [FromQuery] (use toQueryString() to build the URL):
       GET /api/customers?search=ana&status=archived&balance=debt&page=2&pageSize=20
   - The response becomes a PagedResult<T> { Items, TotalCount, Page, PageSize } plus the extras for that screen.
   - The mapping to SQL / EF Core:
       search      -> WHERE name ILIKE '%' || @search || '%'          (EF.Functions.ILike)
       status etc. -> WHERE status = @status
       date range  -> WHERE created_at >= @from AND created_at < @toExclusive   (store timestamps as timestamptz)
       paging      -> ORDER BY <stable sort>, id LIMIT @pageSize OFFSET (@page - 1) * @pageSize
       totalCount  -> a COUNT(*) with the SAME WHERE clause
       counts      -> one grouped query (COUNT(*) FILTER (WHERE ...)) with the filters that do NOT include the chosen tab
   - Only the function BODIES in owner-api.js / customer-api.js change (to a fetch call). The pages do not change. */
(function () {
  "use strict";

  var DEFAULT_PAGE_SIZE = 20;
  var MAX_PAGE_SIZE = 100;
  var DATE_RANGES = ["all", "today", "7", "30", "month", "custom"];

  function toInt(value, fallback) {
    var n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
  }

  // -> { page (>= 1), pageSize (1..MAX_PAGE_SIZE) }. Bad input never throws; the server should clamp the same way.
  function normalizePaging(query) {
    query = query || {};
    var size = toInt(query.pageSize, DEFAULT_PAGE_SIZE);
    return {
      page: Math.max(1, toInt(query.page, 1)),
      pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, size))
    };
  }

  // Cuts one page out of an already filtered, already sorted list.
  // In SQL this is LIMIT / OFFSET plus a COUNT(*) over the same WHERE.
  function paginate(list, query) {
    var p = normalizePaging(query);
    var start = (p.page - 1) * p.pageSize;
    var items = list.slice(start, start + p.pageSize);
    return {
      items: items,
      totalCount: list.length,
      page: p.page,
      pageSize: p.pageSize,
      totalPages: Math.max(1, Math.ceil(list.length / p.pageSize)),
      hasMore: start + items.length < list.length
    };
  }

  // Returns `value` when it is one of `allowed`, otherwise `fallback` (an unknown filter value falls back to the default).
  function pick(value, allowed, fallback) {
    return allowed.indexOf(value) !== -1 ? value : fallback;
  }

  // Lower-cased, trimmed text for case-insensitive search (ILIKE).
  function text(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // "YYYY-MM-DD" -> local Date, or null when it is not a real calendar day.
  function parseDay(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return !isNaN(d.getTime()) && d.getMonth() === Number(m[2]) - 1 ? d : null;
  }

  // The date filter: { dateRange: "all" | "today" | "7" | "30" | "month" | "custom", from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
  // -> { from: Date | null (inclusive), to: Date | null (inclusive, end of that day), invalid: boolean }
  // "invalid" means a custom range whose start is after its end: the list is then empty and the page says so.
  // A server would turn this into: created_at >= from AND created_at < (to + 1 day).
  function dateWindow(query) {
    query = query || {};
    var range = pick(query.dateRange, DATE_RANGES, "all");
    var today = startOfDay(new Date()), from = null, to = null;
    if (range === "today") from = today;
    else if (range === "7") from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    else if (range === "30") from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    else if (range === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (range === "custom") {
      var a = parseDay(query.from), b = parseDay(query.to);
      if (a) from = a;
      if (b) to = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999);
      if (from && to && from > to) return { from: null, to: null, invalid: true };
    }
    return { from: from, to: to, invalid: false };
  }

  function inWindow(iso, win) {
    var d = new Date(iso);
    if (win.from && d < win.from) return false;
    if (win.to && d > win.to) return false;
    return true;
  }

  // { search: "ana", status: "all", page: 2 } -> "search=ana&page=2" (empty values and "all" are left out).
  // Ready for the day these become real requests: fetch("/api/customers?" + toQueryString(query)).
  function toQueryString(query) {
    var out = [];
    Object.keys(query || {}).forEach(function (key) {
      var v = query[key];
      if (v === undefined || v === null || v === "" || v === "all") return;
      out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
    });
    return out.join("&");
  }

  window.CrediTrackQuery = {
    DEFAULT_PAGE_SIZE: DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE: MAX_PAGE_SIZE,
    DATE_RANGES: DATE_RANGES,
    normalizePaging: normalizePaging,
    paginate: paginate,
    pick: pick,
    text: text,
    dateWindow: dateWindow,
    inWindow: inWindow,
    toQueryString: toQueryString
  };
})();
