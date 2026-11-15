/* Customer Portal > Transaction History (history), the list screen.
   Top to bottom: search, store filter (only when 2+ stores are connected), three tabs (All, Credits, Payments)
   and the transaction list. Tapping a row opens Transaction Details (transaction-details?id=).

   - Search, store filter and tabs work together. Tab counts follow the search and the store filter.
   - Payments tab = recorded payments plus payment requests (pending or rejected), each with its own status badge.
   - The view (tab, store, search) is kept in the page address (?tab=credit&store=str-002&q=gcash) so that coming
     back from Transaction Details (browser Back or its "Back to History" button) restores exactly this view.
   All data comes from js/api/customer-api.js getHistory() (sample data for the demo account, real records otherwise). */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };

  var PAGE_SIZE = 10;
  var TYPE_LABEL = { credit: "Credit", payment: "Payment", request: "Payment request" };
  var STATUS = {
    recorded: { label: "Confirmed", cls: "badge--success" },
    pending:  { label: "Pending",  cls: "badge--warning" },
    rejected: { label: "Rejected", cls: "badge--danger" },
    voided:   { label: "Voided",   cls: "badge--danger" }
  };
  var TAB_NAME = { all: "transactions", credit: "credits", payment: "payments" };

  var state = { data: null, scope: "all", query: "", tab: "all", page: 1 };
  var pager = window.CrediTrackPager.create($("pager"), function (n) { state.page = n; render(); }, $("result-line"));
  var hay = {};   // searchable text per transaction id

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
  function timeOf(d) {
    return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); });
  }
  function dateOf(d) { return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  function dayDiff(d) {
    var now = new Date();
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  }
  // "Today · 3:20 PM", "Yesterday · 11:10 AM", "Oct 14, 2026 · 4:30 PM"
  function stamp(iso) {
    var d = new Date(iso), days = dayDiff(d);
    return (days === 0 ? "Today" : days === 1 ? "Yesterday" : dateOf(d)) + " · " + timeOf(d);
  }
  function typeOf(t) { return t.type === "credit" ? "credit" : "payment"; }   // tabs: a payment request belongs with Payments
  function sign(t) { return t.type === "credit" ? "+" : t.type === "payment" ? "−" : ""; }

  function searchText(t) {
    if (hay[t.id]) return hay[t.id];
    var d = new Date(t.date);
    var status = t.voided ? "Voided" : t.type === "credit" ? "" : (STATUS[t.status] || {}).label || "";
    hay[t.id] = [t.title, t.storeName, t.method || "", TYPE_LABEL[t.type] || "", status,
      Number(t.amount).toFixed(2), peso(t.amount), dateOf(d), d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })].join(" ").toLowerCase();
    return hay[t.id];
  }

  // ---------- Filtering ----------
  function inScope(t) { return state.scope === "all" || t.storeId === state.scope; }
  function matchesQuery(t) {
    var words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var text = searchText(t);
    return words.every(function (w) { return text.indexOf(w) !== -1; });   // every word must appear somewhere
  }
  // Store filter + search (what the tab counts are based on)
  function base() { return state.data.transactions.filter(function (t) { return inScope(t) && matchesQuery(t); }); }
  function shown(list) { return state.tab === "all" ? list : list.filter(function (t) { return typeOf(t) === state.tab; }); }

  // ---------- List ----------
  // The view to come back to, as a query string: "tab=credit&store=str-002&q=gcash" (only what differs from the default view)
  function viewQuery() {
    var p = [];
    if (state.tab !== "all") p.push("tab=" + encodeURIComponent(state.tab));
    if (state.scope !== "all") p.push("store=" + encodeURIComponent(state.scope));
    if (state.query.trim()) p.push("q=" + encodeURIComponent(state.query.trim()));
    return p.join("&");
  }
  function syncUrl() {
    try { window.history.replaceState(window.history.state, "", window.location.pathname + (viewQuery() ? "?" + viewQuery() : "")); } catch (e) { /* not supported (for example some file:// setups) */ }
  }

  function rowHtml(t, showStore, back) {
    var kind = t.type === "credit" ? "credit" : t.type === "payment" ? "payment" : (t.status === "rejected" ? "rejected" : "pending");
    var icon = t.type === "credit" ? ICONS.credit : t.type === "payment" ? ICONS.payment : ICONS.pending;
    var st = t.voided ? STATUS.voided : t.type === "credit" ? null : (STATUS[t.status] || STATUS.recorded);
    var meta1 = '<span class="hrow__type">' + TYPE_LABEL[t.type] + "</span>" + (t.method && t.type !== "credit" ? " · " + esc(t.method) : "") + (showStore && t.storeName ? " · " + esc(t.storeName) : "");
    var amountCls = "hrow__amount" + (t.type === "payment" ? " hrow__amount--payment" : "") + (t.status === "rejected" ? " hrow__amount--rejected" : "");
    var href = "transaction-details?id=" + encodeURIComponent(t.id) + (back ? "&back=" + encodeURIComponent(back) : "");
    return '<li><a class="hrow' + (t.voided ? " is-voided" : "") + '" href="' + esc(href) + '" aria-label="' + esc(TYPE_LABEL[t.type] + ": " + t.title + ", " + sign(t) + peso(t.amount) + ". View details") + '">' +
      '<span class="tx-icon tx-icon--' + kind + '" aria-hidden="true">' + (icon || "") + "</span>" +
      '<span class="hrow__main"><span class="hrow__title">' + esc(t.title) + "</span>" +
      '<span class="hrow__meta">' + meta1 + "</span>" +
      '<span class="hrow__meta">' + esc(stamp(t.date)) + "</span>" +
      (t.voided && t.voidInfo ? '<span class="hrow__meta hrow__void">Voided by the store on ' + esc(stamp(t.voidInfo.at)) + (t.voidInfo.reason ? " · " + esc(t.voidInfo.reason) : "") + "</span>" : "") +
      (t.status === "rejected" && t.rejectionReason ? '<span class="hrow__meta hrow__reason"><strong>Reason:</strong> ' + esc(t.rejectionReason) + "</span>" : "") + "</span>" +
      '<span class="hrow__side"><span class="' + amountCls + '">' + sign(t) + peso(t.amount) + "</span>" +
      (st ? '<span class="badge ' + st.cls + '">' + st.label + "</span>" : "") + "</span>" +
      '<span class="hrow__chev" aria-hidden="true">' + (ICONS.chevronRight || "") + "</span></a></li>";
  }

  function setTab(tab, focus) {
    state.tab = tab;
    document.querySelectorAll(".htab").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $("tx-panel").setAttribute("aria-labelledby", "tab-" + tab);
  }

  function render() {
    var data = state.data;
    var hasStores = data.stores.length > 0, hasAny = data.transactions.length > 0;

    $("toolbar").hidden = !hasAny;

    // Nothing to list at all: no store joined yet, or no transactions yet
    var none = !hasAny;
    $("empty-none").hidden = !none;
    $("none-join").hidden = hasStores;
    $("none-title").textContent = hasStores ? "No transactions yet" : "No store joined yet";
    $("none-text").textContent = hasStores ? "Credits and payments recorded at your stores will show up here." : "Join a store to see your credits, payments and balance here.";
    if (none) {
      ["tx-list", "result-line", "pager", "empty-found"].forEach(function (id) { $(id).hidden = true; });
      return;
    }

    // Store filter: only with two or more connected stores
    var multi = data.stores.length > 1;
    $("store-filter").hidden = !multi;
    $("toolbar").classList.toggle("has-picker", multi);

    // Tab counts follow the search and the store filter
    var b = base();
    $("count-all").textContent = b.length;
    $("count-credit").textContent = b.filter(function (t) { return typeOf(t) === "credit"; }).length;
    $("count-payment").textContent = b.filter(function (t) { return typeOf(t) === "payment"; }).length;

    var list = shown(b);
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;      // the list got shorter (a filter or search changed)
    var page = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    var filtering = !!state.query.trim() || state.scope !== "all";
    var back = viewQuery();
    syncUrl();

    $("tx-list").hidden = !list.length;
    $("tx-list").innerHTML = page.map(function (t) { return rowHtml(t, state.scope === "all" && multi, back); }).join("");
    pager.update({ page: state.page, totalPages: totalPages });

    var line = $("result-line");
    line.hidden = !list.length || (!filtering && list.length <= page.length && state.tab === "all");
    if (!line.hidden) line.textContent = totalPages === 1 ? plural(list.length, "transaction", "transactions") : window.CrediTrackPager.range({ page: state.page, pageSize: PAGE_SIZE, totalCount: list.length, items: page }, list.length === 1 ? "transaction" : "transactions");

    $("empty-found").hidden = list.length > 0;
    if (!list.length) {
      var q = state.query.trim();
      $("found-title").textContent = q ? "No results for “" + q + "”" : "No " + TAB_NAME[state.tab] + " found";
      $("found-text").textContent = q ? "Check the spelling or try a different search." : "There is nothing here for this store yet.";
    }
    $("search-clear").hidden = !state.query;
  }

  function resetView() { state.page = 1; render(); }

  // ---------- Store filter options ----------
  function fillSelector() {
    var select = $("store-select");
    select.innerHTML = '<option value="all">All Stores (' + state.data.stores.length + ")</option>" +
      state.data.stores.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>"; }).join("");
    select.value = state.scope;
  }

  // ---------- Events ----------
  $("search").addEventListener("input", function (event) { state.query = event.target.value; resetView(); });
  $("search").addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.query) { event.target.value = ""; state.query = ""; resetView(); }
  });
  $("search-clear").addEventListener("click", function () { $("search").value = ""; state.query = ""; resetView(); $("search").focus(); });

  $("store-select").addEventListener("change", function (event) { state.scope = event.target.value; resetView(); });

  $("tabs").addEventListener("click", function (event) {
    var b = event.target.closest(".htab");
    if (!b) return;
    setTab(b.getAttribute("data-tab"), false);
    resetView();
  });
  // Arrow keys, Home and End move between the tabs
  $("tabs").addEventListener("keydown", function (event) {
    var keys = ["all", "credit", "payment"], at = keys.indexOf(state.tab), next = -1;
    if (event.key === "ArrowRight") next = (at + 1) % keys.length;
    else if (event.key === "ArrowLeft") next = (at + keys.length - 1) % keys.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = keys.length - 1;
    if (next === -1) return;
    event.preventDefault();
    setTab(keys[next], true);
    resetView();
  });

  $("found-reset").addEventListener("click", function () {
    state.query = ""; state.scope = "all"; $("search").value = ""; $("store-select").value = "all";
    setTab("all", false); resetView();
  });

  // ---------- Load ----------
  function fromUrl(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ""; } catch (e) { return ""; }
  }
  function load(first) {
    return api.getHistory().then(function (data) {
      state.data = data;
      hay = {};
      if (first) {   // restore the view from the address (store, tab and search)
        state.scope = fromUrl("store") || "all";
        state.tab = ["credit", "payment"].indexOf(fromUrl("tab")) !== -1 ? fromUrl("tab") : "all";
        state.query = fromUrl("q");
        state.page = 1;
        $("search").value = state.query;
        setTab(state.tab, false);
      }
      var known = data.stores.length > 1 && data.stores.some(function (s) { return s.id === state.scope; });
      state.scope = known ? state.scope : "all";    // with one store (or none) there is nothing to filter by
      fillSelector();
      render();
    });
  }

  // A page restored from the back/forward cache shows the current data
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(false); });

  $("store-filter").querySelector(".hpick__icon").innerHTML = ICONS.store || "";
  $("store-filter").querySelector(".hpick__chev").innerHTML = ICONS.chevronDown || "";
  load(true);
})();
