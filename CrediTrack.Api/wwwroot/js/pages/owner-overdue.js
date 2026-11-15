/* Store Owner > Overdue Accounts (overdue).
   Shows how many accounts are overdue, the total overdue balance, and one entry per overdue customer:
   name, outstanding balance, overdue amount, due date, days overdue and a View Details link to Customer Details.
   What counts as overdue is decided ONLY by the server (OverdueRule, behind GET /api/owner/overdue-accounts): an unpaid credit with
   an agreed due date before today; a credit with no fixed date never is. This page never calculates it; it only draws what comes back.
   Search, the days-overdue chips, the sort and the page number are sent to CrediTrackApi.queryOverdueAccounts() as a query; the page
   draws the page of results (20 at a time, with page numbers), the summary cards and the chip counts the API returns.
   States: loading (first load, and dimmed while a new search / filter / page loads), empty (nothing overdue), no match
   (search or filter finds nothing) and error (message + Try again). */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var $ = function (id) { return document.getElementById(id); };

  function peso(n) {
    return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // "2026-10-19" -> "Oct 19, 2026" (read as a local calendar day, never shifted by time zone)
  function dateText(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
    if (!m) return "";
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  }

  function row(a) {
    var days = a.daysOverdue + (a.daysOverdue === 1 ? " day overdue" : " days overdue");
    return '<li class="od-row">' +
      '<div class="od-name"><span class="od-name__text">' + esc(a.name) + '</span><span class="od-name__code">' + esc(a.code) + "</span></div>" +
      '<dl class="od-fields">' +
      "<div><dt>Outstanding Balance</dt><dd>" + peso(a.balance) + "</dd></div>" +
      '<div><dt>Overdue Amount</dt><dd class="od-amount">' + peso(a.overdueAmount) + "</dd></div>" +
      "<div><dt>Due Date</dt><dd>" + esc(dateText(a.dueDate)) +
      (a.overdueCredits > 1 ? '<span class="od-more">' + a.overdueCredits + " credits past due</span>" : "") + "</dd></div>" +
      "</dl>" +
      '<span class="badge badge--danger od-days">' + days + "</span>" +
      '<a class="btn btn--secondary od-action" href="customer-details?id=' + encodeURIComponent(a.customerId) + '" aria-label="View details for ' + esc(a.name) + '">View Details</a>' +
      "</li>";
  }

  // ---- Search, filter and sort (the API does the work: see queryOverdueAccounts in js/api/owner-api.js) ----
  var PAGE_SIZE = 10;
  var state = { data: null, items: [], page: 1, query: "", range: "all", sort: "due-asc" };
  var pager = window.CrediTrackPager.create($("pager"), function (n) { return load(n); }, $("od-head"));
  var requestSeq = 0;   // only the newest request may draw
  var RANGE_KEYS = ["all", "1-7", "8-30", "30+"];
  var SORT_KEYS = ["amount-desc", "amount-asc", "due-asc", "due-desc"];
  var DEFAULT_SORT = "due-asc";
  var RANGE_LABELS = { "1-7": "1\u20137 Days Overdue", "8-30": "8\u201330 Days Overdue", "30+": "More than 30 Days Overdue" };
  var SORT_LABELS = { "amount-desc": "Highest Overdue Amount", "amount-asc": "Lowest Overdue Amount", "due-asc": "Oldest Due Date", "due-desc": "Most Recent Due Date" };
  function filtering() { return !!state.query.trim() || state.range !== "all"; }

  function render() {
    var d = state.data;
    if (!d) return;
    var has = d.totalAll > 0, shown = state.items;
    $("empty-error").hidden = true;

    // Chip counts follow the search, so each chip shows how many it would list
    $("cnt-all").textContent = d.chipCounts["all"];
    $("cnt-1-7").textContent = d.chipCounts["1-7"];
    $("cnt-8-30").textContent = d.chipCounts["8-30"];
    $("cnt-30").textContent = d.chipCounts["30+"];

    // Summary always matches everything the filters match (not only the rows on screen)
    $("sum-count").textContent = d.summary.count;
    $("sum-count-note").textContent = d.summary.count === 1 ? "Customer past their due date" : "Customers past their due date";
    $("sum-total").textContent = peso(d.summary.total);

    $("od-tools").hidden = !has;
    $("od-head").hidden = !shown.length;
    $("od-list").hidden = !shown.length;
    $("od-list").innerHTML = shown.map(row).join("");
    pager.update(d);
    $("empty").hidden = has;

    // "Showing X of Y": while filtering, X is what matches and Y is every overdue account; while pages are hidden, X is what is on screen
    var line = $("od-result");
    line.hidden = !(has && shown.length);
    line.textContent = d.totalPages > 1
      ? window.CrediTrackPager.range(d) + (filtering() ? " matching" : "") + (d.totalCount === 1 ? " overdue account" : " overdue accounts")
      : "Showing " + d.totalCount + " of " + d.totalAll + (d.totalAll === 1 ? " overdue account" : " overdue accounts");

    var none = has && !d.totalCount;
    $("empty-found").hidden = !none;
    if (none) {
      $("found-text").textContent = state.query.trim()
        ? "No overdue account matches \u201C" + state.query.trim() + "\u201D" + (state.range !== "all" ? " in this filter." : ".") + " Check the spelling or try another filter."
        : "No account is overdue by this many days right now.";
    }
    $("od-search-clear").hidden = !state.query;
    // Phone: the Filter & Sort button shows how many settings are changed, and the line under it says which
    var changed = (state.range !== "all" ? 1 : 0) + (state.sort !== DEFAULT_SORT ? 1 : 0);
    $("od-toggle-count").hidden = !changed;
    $("od-toggle-count").textContent = changed;
    var active = $("od-active");
    active.hidden = !changed;
    active.innerHTML = (state.range !== "all" ? "<strong>" + RANGE_LABELS[state.range] + "</strong>" : "") +
      (changed === 2 ? " &middot; " : "") + (state.sort !== DEFAULT_SORT ? "Sorted by " + SORT_LABELS[state.sort] : "");
    document.querySelectorAll("#od-tools .chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-range") === state.range));
    });
    if (!has) {
      $("empty-title").textContent = d.hasRecords || d.isSample ? "No overdue accounts" : "No overdue accounts yet";
      $("page-sub").textContent = "Nothing is past due right now.";
    } else {
      $("page-sub").textContent = "Customers with an unpaid balance past the due date you agreed on.";
    }
  }

  // The query this page sends. The names match the future API (GET /api/owner/overdue-accounts?search=&overdueRange=&sortBy=&page=&pageSize=).
  function currentQuery(page) {
    return { search: state.query.trim(), overdueRange: state.range, sortBy: state.sort, page: page, pageSize: PAGE_SIZE };
  }
  // Loading and error states
  function setLoading(on) {
    $("od-panel").classList.toggle("is-loading", on && !!state.data);   // later loads: dim what is on screen
    $("od-panel").setAttribute("aria-busy", String(on));
    $("od-loading").hidden = !(on && !state.data);                       // first load: nothing to dim yet, so say it is loading
    if (on && !state.data) {
      ["od-head", "od-list", "pager", "empty", "empty-found", "empty-error", "od-result"].forEach(function (id) { $(id).hidden = true; });
    }
  }
  function errorText(err) {
    if (err && err.status === 401) return "Your session has expired. Please log in again.";
    if (err && err.status === 403) return "This account is not allowed to see overdue accounts.";
    return (err && err.message) || "Something went wrong. Please try again.";
  }
  function showError(err) {
    // Keep the search / filter / sort tools (when the list was loaded before) so the owner can change them and retry
    ["od-head", "od-list", "pager", "empty", "empty-found", "od-result"].forEach(function (id) { $(id).hidden = true; });
    $("od-tools").hidden = !state.data || !(state.data.totalAll > 0);
    $("error-text").textContent = errorText(err);
    $("empty-error").hidden = false;
  }
  // A number = that page; anything else (a filter changed) = page 1
  function load(target) {
    var seq = ++requestSeq, page = typeof target === "number" ? target : 1;
    lastPage = page;
    setLoading(true);
    return api.queryOverdueAccounts(currentQuery(page)).then(function (data) {
      if (seq !== requestSeq) return;
      state.data = data;
      state.page = data.page;
      state.items = data.items;
      setLoading(false);
      render();
    }).catch(function (err) {
      if (seq !== requestSeq) return;
      setLoading(false);
      showError(err);
    });
  }
  var lastPage = 1;

  // The view is remembered for this browser tab, so Back from Customer Details shows the list as it was left.
  var VIEW_KEY = "creditrack.overdue.view";
  function saveView() {
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ query: state.query, range: state.range, sort: state.sort })); } catch (e) { /* ignore */ }
  }
  function syncInputs() { $("od-search").value = state.query; $("od-sort").value = state.sort; }
  function update() { saveView(); return load(true); }

  // Search waits a moment after the last key, so typing does not send one request per letter
  var searchTimer = null;
  $("od-search").addEventListener("input", function (e) {
    state.query = e.target.value;
    $("od-search-clear").hidden = !state.query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(update, 300);
  });
  $("od-search-clear").addEventListener("click", function () { clearTimeout(searchTimer); state.query = ""; syncInputs(); update(); $("od-search").focus(); });
  // Phone: open and close the Filter & Sort panel (it stays open while choosing, so filter and sort can both be set)
  $("od-toggle").addEventListener("click", function () {
    var open = $("od-tools").classList.toggle("is-open");
    $("od-toggle").setAttribute("aria-expanded", String(open));
  });
  $("od-sort").addEventListener("change", function (e) { state.sort = e.target.value; update(); });
  document.querySelector(".od-chips").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.range = chip.getAttribute("data-range");
    update();
  });
  $("error-retry").addEventListener("click", function () { load(lastPage); });
  $("found-reset").addEventListener("click", function () { clearTimeout(searchTimer); state.query = ""; state.range = "all"; syncInputs(); update(); });

  try {
    var saved = JSON.parse(window.sessionStorage.getItem(VIEW_KEY));
    if (window.CrediTrack.navType() === "back_forward" && saved) {
      state.query = typeof saved.query === "string" ? saved.query : "";
      state.range = RANGE_KEYS.indexOf(saved.range) !== -1 ? saved.range : "all";
      state.sort = SORT_KEYS.indexOf(saved.sort) !== -1 ? saved.sort : "due-asc";
      syncInputs();
    } else { window.sessionStorage.removeItem(VIEW_KEY); }
  } catch (e) { /* ignore */ }
  syncInputs();   // the sort box always shows the sort in use (Oldest Due Date to start)

  // Empty state for a brand-new store: switch on the sample data (same switch as the Dashboard)
  // Empty-state Back: same as the Back bar, so it returns to the page the owner came from (Dashboard or Reports)
  $("empty-back").addEventListener("click", function (event) { event.preventDefault(); window.CrediTrack.goBack("dashboard"); });
  // Restored from the back/forward cache (for example Back from Customer Details): show current data
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(true); });

  load(true);
})();
