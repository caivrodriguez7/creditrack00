/* Customer Portal > My Payments (payments), the main screen.
   Top to bottom: payment summary, four status tabs (All, Pending, Completed, Rejected), the list of payment requests
   (store name, method, submission date, amount and a status badge), and the empty states.

   - Everything comes from js/api/customer-api.js queryPayments(): the page of rows, the summary and the tab counts, so this
     page never adds money up, filters or decides a status itself. The store name on each row is the joined store's name.
   - Filters: status (the tabs), store, payment method and date range. They are sent as a query and the API returns 20 rows
     at a time (with page numbers). Tab counts follow the store, method and date filters; the summary cards are never filtered.
   - The view (tab, store, method, date range) is kept in the address (?tab=pending&method=gcash&range=30) so a reload or the
     browser Back button returns to it.
   - Each row opens Payment Request Details (?id=&back=). The view is passed along, so the details screen's Back button
     returns to exactly this view.
   - Submitting a payment is a later step: this page only shows requests, it does not create them. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };

  var PAGE_SIZE = 10;
  var TABS = ["all", "pending", "completed", "rejected"];
  var ICON_ATTR = 'width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var STATUS = {
    pending:   { label: "Pending",   hint: "Waiting for the store to verify. Your balance has not changed yet.", icon: '<svg ' + ICON_ATTR + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
    completed: { label: "Completed", hint: "",                                                                    icon: '<svg ' + ICON_ATTR + '><circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.5 2.5 4.5-5"/></svg>' },
    rejected:  { label: "Rejected",  hint: "Not accepted by the store. Your balance was not changed.",            icon: '<svg ' + ICON_ATTR + '><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>' }
  };
  // Shown when a tab has no payments (and the whole list is not empty)
  var TAB_EMPTY = {
    pending:   { title: "No pending payments",   text: "Payments waiting for a store to verify will appear here." },
    completed: { title: "No completed payments", text: "Payments a store has recorded will appear here." },
    rejected:  { title: "No rejected payments",  text: "Payments a store did not accept will appear here." }
  };

  var RANGES = ["all", "today", "7", "30", "month", "custom"];
  var state = { data: null, items: [], page: 1, tab: "all", scope: "all", method: "all", range: "all", from: "", to: "" };
  var pager = window.CrediTrackPager.create($("pager"), function (n) { return load(n); }, $("result-line"));
  var requestSeq = 0;   // only the newest request may draw

  // ---------- Helpers ----------
  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function dateOf(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }

  // ---------- Rows ----------
  function rowHtml(p, back) {
    var st = STATUS[p.status] || STATUS.completed;
    var store = p.storeName || "Store";
    var meta = (p.method ? esc(p.method) + " · " : "") + esc(dateOf(p.date));
    var hint = st.hint ? '<span class="prow__hint">' + st.hint + "</span>" : "";
    if (p.status === "rejected" && p.rejectionReason) hint = '<span class="prow__hint prow__reason"><strong>Reason from the store:</strong> ' + esc(p.rejectionReason) + "</span>";
    var label = store + ", " + (p.method ? p.method + ", " : "") + dateOf(p.date) + ", " + peso(p.amount) + ", " + st.label + ". View details";
    var href = "payment-request-details?id=" + encodeURIComponent(p.id) + (back ? "&back=" + encodeURIComponent(back) : "");
    return '<li><a class="prow prow--' + p.status + '" href="' + href + '" aria-label="' + esc(label) + '">' +
      '<span class="prow__icon" aria-hidden="true">' + st.icon + "</span>" +
      '<span class="prow__main"><span class="prow__store">' + esc(store) + "</span>" +
      '<span class="prow__meta">' + meta + "</span>" + hint + "</span>" +
      '<span class="prow__side"><span class="prow__amount">' + peso(p.amount) + "</span>" +
      '<span class="pstatus pstatus--' + p.status + '">' + st.icon + st.label + "</span></span>" +
      '<span class="prow__chev" aria-hidden="true">' + (ICONS.chevronRight || "") + "</span></a></li>";
  }

  // ---------- Tabs ----------
  // The view to come back to, as a query string: "tab=pending&store=str-002&method=gcash&range=30" (only what differs from the default view)
  function viewQuery() {
    var p = [];
    if (state.tab !== "all") p.push("tab=" + encodeURIComponent(state.tab));
    if (state.scope !== "all") p.push("store=" + encodeURIComponent(state.scope));
    if (state.method !== "all") p.push("method=" + encodeURIComponent(state.method));
    if (state.range !== "all") p.push("range=" + encodeURIComponent(state.range));
    if (state.range === "custom") {
      if (state.from) p.push("from=" + encodeURIComponent(state.from));
      if (state.to) p.push("to=" + encodeURIComponent(state.to));
    }
    return p.join("&");
  }
  function syncUrl() {
    var q = viewQuery();
    try { window.history.replaceState(window.history.state, "", window.location.pathname + (q ? "?" + q : "")); } catch (e) { /* not supported (for example some file:// setups) */ }
  }
  function setTab(tab, focus) {
    state.tab = tab;
    document.querySelectorAll(".ptab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $("pay-panel").setAttribute("aria-labelledby", "tab-" + tab);
  }

  // Store, method or date range chosen (the tab alone does not count)
  function filtersActive() { return state.scope !== "all" || state.method !== "all" || state.range !== "all"; }

  // ---------- Query ----------
  // The query this page sends. The names match the future API
  // (GET /api/customer/payments?status=&method=&storeId=&dateRange=&from=&to=&page=&pageSize=).
  function currentQuery(page) {
    return { status: state.tab, method: state.method, storeId: state.scope, dateRange: state.range, from: state.from, to: state.to, page: page, pageSize: PAGE_SIZE };
  }
  // A number = that page; anything else (a filter changed) = start again from page 1
  function load(target) {
    var seq = ++requestSeq, page = typeof target === "number" ? target : 1;
    return api.queryPayments(currentQuery(page)).then(function (data) {
      if (seq !== requestSeq) return;
      // A store or method from the address that does not exist (any more) falls back to "all"; with one store there is nothing to filter by
      var knownStore = data.stores.length > 1 && data.stores.some(function (st) { return st.id === state.scope; });
      var knownMethod = data.methods.some(function (m) { return m.id === state.method; });
      var fix = false;
      if (state.scope !== "all" && !knownStore) { state.scope = "all"; fix = true; }
      if (state.method !== "all" && !knownMethod) { state.method = "all"; fix = true; }
      if (fix) return load(true);
      state.data = data;
      state.page = data.page;
      state.items = data.items;
      fillSelectors();
      render();
    }).catch(function (err) {
      window.CrediTrack.showToast(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  }
  // A filter changed: back to the first page
  function refresh() { return load(true); }

  // ---------- Render ----------
  function render() {
    var data = state.data;
    if (!data) return;
    var any = data.totalAll > 0, sum = data.summary, counts = data.counts;
    // Store filter: only with two or more connected stores. Method and date filters: whenever there are payments.
    var multi = data.stores.length > 1;
    $("store-filter").hidden = !multi || !any;
    $("extra-filters").hidden = !any;


    // Nothing at all: no store joined, or no payments yet
    $("empty-none").hidden = any;
    $("none-join").hidden = data.hasStores;
    $("none-title").textContent = data.hasStores ? "No payment requests yet" : "No store joined yet";
    $("none-text").textContent = data.hasStores
      ? "Payments you send to a store, and payments a store records for you, will show up here."
      : "Join a store first. Your payments to it will show up here.";
    $("summary").hidden = !any && !data.hasStores;
    $("tabs").hidden = !any;

    // Summary
    $("sum-pending").textContent = sum.pendingCount;
    $("sum-pending-note").textContent = sum.pendingCount ? peso(sum.pendingAmount) + " awaiting verification" : "Nothing awaiting verification";
    $("sum-recorded").textContent = peso(sum.recordedAmount);
    $("sum-recorded-label").textContent = "Confirmed (" + sum.recentDays + " days)";

    if (!any) {
      ["pay-list", "result-line", "pager", "empty-tab"].forEach(function (id) { $(id).hidden = true; });
      syncUrl();
      return;
    }

    // Custom date range fields
    $("custom").hidden = state.range !== "custom";
    $("from").value = state.from;
    $("to").value = state.to;
    $("custom-error").hidden = !data.invalidRange;
    $("from").setAttribute("aria-invalid", String(!!data.invalidRange));
    $("to").setAttribute("aria-invalid", String(!!data.invalidRange));

    // Tab counts (every payment that matches the store, method and date filters)
    TABS.forEach(function (t) { $("count-" + t).textContent = counts[t]; });

    var shown = state.items;
    $("pay-list").hidden = !shown.length;
    var back = viewQuery();
    $("pay-list").innerHTML = shown.map(function (p) { return rowHtml(p, back); }).join("");
    pager.update(data);

    var line = $("result-line");
    line.hidden = !shown.length;
    if (!line.hidden) line.textContent = data.totalPages > 1
      ? window.CrediTrackPager.range(data, data.totalCount === 1 ? "payment" : "payments")
      : "Showing " + data.totalCount + " of " + plural(data.totalAll, "payment", "payments");

    $("empty-tab").hidden = data.totalCount > 0;
    if (!data.totalCount) {
      var empty;
      if (data.invalidRange) empty = { title: "Check the date range", text: "The start date must be on or before the end date." };
      else if (filtersActive()) empty = { title: "No payments match these filters", text: "Try a different store, payment method or date range." };
      else empty = TAB_EMPTY[state.tab] || { title: "No payments for this store", text: "Payments to this store will appear here." };
      $("tab-title").textContent = empty.title;
      $("tab-text").textContent = empty.text;
      $("tab-reset").textContent = filtersActive() || data.invalidRange ? "Clear filters" : "View all payments";
    }
    syncUrl();
  }

  function fillSelectors() {
    var data = state.data, select = $("store-select");
    select.innerHTML = '<option value="all">All Stores (' + data.stores.length + ")</option>" +
      data.stores.map(function (st) { return '<option value="' + esc(st.id) + '">' + esc(st.name) + "</option>"; }).join("");
    select.value = state.scope;
    var methods = $("method-select");
    methods.innerHTML = '<option value="all">All methods</option>' +
      data.methods.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label) + "</option>"; }).join("");
    methods.value = state.method;
    $("range-select").value = state.range;
  }

  function show(tab, focus) { setTab(tab, focus); return refresh(); }

  // ---------- Events ----------
  $("tabs").addEventListener("click", function (event) {
    var b = event.target.closest(".ptab");
    if (b) show(b.getAttribute("data-tab"), false);
  });
  // Arrow keys, Home and End move between the tabs
  $("tabs").addEventListener("keydown", function (event) {
    var at = TABS.indexOf(state.tab), next = -1;
    if (event.key === "ArrowRight") next = (at + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (at + TABS.length - 1) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next === -1) return;
    event.preventDefault();
    show(TABS[next], true);
  });
  // "View all payments" / "Clear filters": back to every payment
  $("tab-reset").addEventListener("click", function () {
    state.scope = "all"; state.method = "all"; state.range = "all"; state.from = ""; state.to = "";
    show("all", false);
  });
  $("store-select").addEventListener("change", function (event) { state.scope = event.target.value; refresh(); });
  $("method-select").addEventListener("change", function (event) { state.method = event.target.value; refresh(); });
  $("range-select").addEventListener("change", function (event) {
    state.range = event.target.value;
    if (state.range !== "custom") { state.from = ""; state.to = ""; }
    refresh().then(function () { if (state.range === "custom") $("from").focus(); });
  });
  $("from").addEventListener("change", function (event) { state.from = event.target.value; refresh(); });
  $("to").addEventListener("change", function (event) { state.to = event.target.value; refresh(); });

  // ---------- Start ----------
  function fromUrl(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function readUrl() {   // restore the view (tab, store, method, date range) from the address
    var tab = fromUrl("tab"), range = fromUrl("range");
    setTab(TABS.indexOf(tab) !== -1 ? tab : "all", false);
    state.scope = fromUrl("store") || "all";
    state.method = fromUrl("method") || "all";
    state.range = RANGES.indexOf(range) !== -1 ? range : "all";
    state.from = state.range === "custom" ? fromUrl("from") : "";
    state.to = state.range === "custom" ? fromUrl("to") : "";
  }

  // A page restored from the back/forward cache shows the current data
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(true); });
  $("store-filter").querySelector(".hpick__icon").innerHTML = ICONS.store || "";
  $("store-filter").querySelector(".hpick__chev").innerHTML = ICONS.chevronDown || "";
  $("method-filter").querySelector(".hpick__icon").innerHTML = ICONS.payment || "";
  $("method-filter").querySelector(".hpick__chev").innerHTML = ICONS.chevronDown || "";
  $("range-filter").querySelector(".hpick__icon").innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>';
  $("range-filter").querySelector(".hpick__chev").innerHTML = ICONS.chevronDown || "";
  // Dates cannot be in the future
  (function () { var t = new Date(); $("from").max = $("to").max = t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2); })();
  readUrl();
  load(true);
})();
