/* Store Owner > Transaction History (transactions).
   Lists credits and payments newest first, grouped by day, with search by customer name, a type filter
   (All / Credits / Payments), a status filter, a date filter, totals, page numbers and empty states.
   Opening a row goes to transaction-details?id=.
   All data comes from js/api/owner-api.js (sample data in demo mode, the owner's own records otherwise).
   Search, type, status and the date filter are sent to CrediTrackApi.queryTransactions() as a query; the page draws the
   page of results (20 at a time, with page numbers) and the totals the API returns. It never filters the list itself. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var ICONS = window.CrediTrackIcons || {};
  var $ = function (id) { return document.getElementById(id); };

  var PAGE_SIZE = 10;
  var STATUS = {
    unpaid:   { label: "Unpaid",         cls: "badge--warning" },
    partial:  { label: "Partially paid", cls: "badge--lime" },
    paid:     { label: "Paid",           cls: "badge--success" },
    confirmed: { label: "Confirmed",     cls: "badge--success" },
    recorded: { label: "Confirmed",       cls: "badge--success" },
    voided:   { label: "Voided",         cls: "badge--danger" }
  };
  var STATUS_FILTERS = ["all", "unpaid", "partial", "paid", "confirmed", "voided"];
  var state = { data: null, items: [], page: 1, query: "", type: "all", status: "all", range: "all", from: "", to: "", customerId: "", customerName: "" };
  // Opened from Customer Details (transactions?customerId=3&customer=Ana&type=credit): list only that customer's transactions
  var params = new URLSearchParams(window.location.search);
  var urlCustomer = { id: params.get("customerId") || "", name: params.get("customer") || "", type: params.get("type") || "" };
  var pager = window.CrediTrackPager.create($("pager"), function (n) { return load(n); }, $("result-line"));
  var requestSeq = 0;   // only the newest request may draw

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function timeOf(iso) {
    return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); });
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dayKey(iso) { var d = new Date(iso); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function isoDate(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function dateLong(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }); }
  function groupTitle(iso) {
    var days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000);
    if (days === 0) return "<strong>Today</strong> &middot; " + esc(dateLong(iso));
    if (days === 1) return "<strong>Yesterday</strong> &middot; " + esc(dateLong(iso));
    return esc(dateLong(iso));
  }

  function isFiltering() { return !!(state.customerId || state.query.trim() || state.type !== "all" || state.status !== "all" || state.range !== "all"); }

  // ---- Drawing ----
  var CHEVRON = '<svg class="tx-row__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  function row(t) {
    var pay = t.type === "payment", st = STATUS[t.status] || STATUS.recorded;
    var what = pay ? "Payment &middot; " + esc(t.method || "") : "Credit &middot; " + esc(t.note || (t.items && t.items[0] ? t.items[0].name : ""));
    return '<li><a class="tx-row' + (t.voided ? " is-voided" : "") + '" href="transaction-details?id=' + encodeURIComponent(t.id) + '">' +
      '<span class="tx-icon tx-icon--' + t.type + '" aria-hidden="true">' + (ICONS[pay ? "payment" : "credit"] || "") + "</span>" +
      '<span class="tx-row__main"><span class="tx-row__name">' + esc(t.customer || "Unknown customer") + "</span>" +
      '<span class="tx-row__meta">' + what + "</span>" +
      '<span class="tx-row__time">' + esc(timeOf(t.date)) + " &middot; Recorded by you</span>" +
      (t.voided && t.voidInfo ? '<span class="tx-row__void">Voided ' + esc(new Date(t.voidInfo.at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })) + (t.voidInfo.by && t.voidInfo.by.name ? " by " + esc(t.voidInfo.by.name) : "") + "</span>" : "") + "</span>" +
      '<span class="tx-row__side"><span class="tx-row__amount tx-row__amount--' + t.type + '">' + (pay ? "&minus;" : "+") + peso(t.amount) + "</span>" +
      '<span class="badge ' + st.cls + '">' + st.label + "</span></span>" + CHEVRON + "</a></li>";
  }

  function groups(list) {
    var out = [], current = null;
    list.forEach(function (t) {
      var key = dayKey(t.date);
      if (!current || current.key !== key) { current = { key: key, date: t.date, rows: [] }; out.push(current); }
      current.rows.push(t);
    });
    return out.map(function (g) {
      return '<section class="tx-group"><h3 class="tx-group__title">' + groupTitle(g.date) + '</h3><ul class="tx-list">' + g.rows.map(row).join("") + "</ul></section>";
    }).join("");
  }

  function noun(n) { return n + (n === 1 ? " transaction" : " transactions"); }

  function render() {
    var d = state.data;
    if (!d) return;
    var hasAny = d.totalAll > 0;
    var shown = state.items;

    $("page-sub").textContent = state.customerId ? "Transactions of " + (state.customerName || "this customer") + "." : hasAny ? noun(d.totalAll) + " recorded in your store." : "Review all store credits and payments.";
    $("toolbar").hidden = !hasAny;
    $("empty-none").hidden = hasAny;

    // Totals for everything that matches the filters (the API adds them up over every matching row, not only this page)
    var t = d.totals;
    $("summary").hidden = !hasAny;
    $("sum-credit").textContent = peso(t.credit);
    $("sum-payment").textContent = peso(t.payment);
    $("sum-credit-note").textContent = t.creditCount === 1 ? "1 credit" : t.creditCount + " credits";
    $("sum-payment-note").textContent = t.paymentCount === 1 ? "1 payment" : t.paymentCount + " payments";

    // List
    $("tx-groups").innerHTML = groups(shown);
    $("tx-groups").hidden = !shown.length;
    pager.update(d.invalidRange ? { page: 1, totalPages: 1 } : d);

    var line = $("result-line");
    line.hidden = !(hasAny && (shown.length || d.invalidRange));
    line.textContent = d.invalidRange ? "Fix the date range to see transactions." : window.CrediTrackPager.range(d) + (isFiltering() ? " matching" : "") + (d.totalCount === 1 ? " transaction" : " transactions");

    // "No matches" empty state
    var none = hasAny && !d.totalCount && !d.invalidRange;
    $("empty-found").hidden = !none;
    if (none) {
      var q = state.query.trim();
      if (q) {
        $("found-title").textContent = "No transactions found";
        $("found-text").textContent = "Nothing matches \u201C" + q + "\u201D with the current filters. Check the spelling or try a different name.";
      } else if (state.status !== "all") {
        $("found-title").textContent = "No transactions match these filters";
        $("found-text").textContent = "Try a different status, transaction type or date range.";
      } else {
        var what = state.type === "credit" ? "credits" : state.type === "payment" ? "payments" : "transactions";
        $("found-title").textContent = "No " + what + " in this period";
        $("found-text").textContent = "Try a different date range or another transaction type.";
      }
      $("found-reset").textContent = "Clear filters";
    }

    // Controls
    $("customer-filter").hidden = !state.customerId;
    if (state.customerId) {
      $("customer-filter-name").textContent = state.customerName || "this customer";
      $("customer-filter-back").href = "customer-details?id=" + encodeURIComponent(state.customerId);
    }
    $("search-clear").hidden = !state.query;
    document.querySelectorAll("#type-chips .chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-type") === state.type));
    });
    $("status").value = state.status;
    $("range").value = state.range;
    $("custom").hidden = state.range !== "custom";
    $("from").value = state.from;
    $("to").value = state.to;
    $("custom-error").hidden = !d.invalidRange;
    $("from").setAttribute("aria-invalid", String(!!d.invalidRange));
    $("to").setAttribute("aria-invalid", String(!!d.invalidRange));
  }

  // The query this page sends. The names match the future API (GET /api/transactions?search=&type=&status=&dateRange=&from=&to=&page=&pageSize=).
  function currentQuery(page) {
    return { customerId: state.customerId, search: state.query.trim(), type: state.type, status: state.status, dateRange: state.range, from: state.from, to: state.to, page: page, pageSize: PAGE_SIZE };
  }
  // A number = that page; anything else (a filter changed) = start again from page 1
  function load(target) {
    var seq = ++requestSeq, page = typeof target === "number" ? target : 1;
    return api.queryTransactions(currentQuery(page)).then(function (data) {
      if (seq !== requestSeq) return;
      state.data = data;
      state.page = data.page;
      state.items = data.items;
      if (state.customerId && !state.customerName && data.items.length) state.customerName = data.items[0].customer || "";
      render();
    });
  }

  // ---- Remember the view (same idea as Customers) ----
  // Coming Back from Transaction Details shows the list exactly as it was left; opening Transactions from the
  // navigation starts clean.
  var VIEW_KEY = "creditrack.transactions.view";
  function saveView() {
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ query: state.query, type: state.type, status: state.status, range: state.range, from: state.from, to: state.to })); } catch (e) { /* ignore */ }
  }
  function readView() {
    try { return JSON.parse(window.sessionStorage.getItem(VIEW_KEY)); } catch (e) { return null; }
  }
  function clearView() {
    try { window.sessionStorage.removeItem(VIEW_KEY); } catch (e) { /* ignore */ }
  }
  function applyView(v) {
    v = v || {};
    state.query = typeof v.query === "string" ? v.query : "";
    state.type = ["all", "credit", "payment"].indexOf(v.type) !== -1 ? v.type : "all";
    state.status = STATUS_FILTERS.indexOf(v.status) !== -1 ? v.status : "all";
    state.range = ["all", "today", "7", "30", "month", "custom"].indexOf(v.range) !== -1 ? v.range : "all";
    state.from = typeof v.from === "string" ? v.from : "";
    state.to = typeof v.to === "string" ? v.to : "";
    $("search").value = state.query;
  }
  function change() { saveView(); return load(true); }

  $("search").addEventListener("input", function (e) { state.query = e.target.value; change(); });
  $("search-clear").addEventListener("click", function () { state.query = ""; $("search").value = ""; change(); $("search").focus(); });
  $("type-chips").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.type = chip.getAttribute("data-type");
    change();
  });
  $("status").addEventListener("change", function (e) { state.status = e.target.value; change(); });
  $("range").addEventListener("change", function (e) {
    state.range = e.target.value;
    if (state.range !== "custom") { state.from = ""; state.to = ""; }
    change();
    if (state.range === "custom") $("from").focus();
  });
  $("from").addEventListener("change", function (e) { state.from = e.target.value; change(); });
  $("to").addEventListener("change", function (e) { state.to = e.target.value; change(); });
  $("found-reset").addEventListener("click", function () {
    state.query = ""; state.type = "all"; state.status = "all"; state.range = "all"; state.from = ""; state.to = "";
    $("search").value = "";
    clearCustomer();
    change();
  });
  // Back to every customer's transactions (also takes the customer out of the address)
  function clearCustomer() {
    if (!state.customerId) return;
    state.customerId = ""; state.customerName = "";
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* ignore */ }
  }
  $("customer-filter-clear").addEventListener("click", function () { clearCustomer(); change(); });
  // Empty state for a brand-new store: switch on the sample data (same switch as the dashboard)

  // Dates cannot be in the future
  $("from").max = $("to").max = isoDate(new Date());

  // Starting view: the one the person left (Back/Forward), otherwise clean.
  if (window.CrediTrack.navType() === "back_forward" && readView()) applyView(readView()); else clearView();
  if (urlCustomer.id) {   // coming from a customer: that customer, and the Credits / Payments chip they had on
    state.customerId = urlCustomer.id; state.customerName = urlCustomer.name;
    if (["credit", "payment"].indexOf(urlCustomer.type) !== -1 && window.CrediTrack.navType() !== "back_forward") state.type = urlCustomer.type;
  }
  // Restored from the back/forward cache: pick up the saved view and any new data.
  window.addEventListener("pageshow", function (event) { if (event.persisted) { applyView(readView()); load(true); } });

  load(true);
})();
