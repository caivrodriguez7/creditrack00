/* Store Owner > Customers: searchable list with balances, filters, Add Customer and empty states.
   All data comes from js/api/owner-api.js (sample data in demo mode, the owner's own records otherwise).
   Search, the Active / Archived view and the balance chips are sent to CrediTrackApi.queryCustomers() as a query and the
   page draws the page of results it gets back (20 at a time, with page numbers). The page never filters the list itself. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var $ = function (id) { return document.getElementById(id); };

  var PAGE_SIZE = 20;
  var state = { data: null, items: [], page: 1, query: "", filter: "all", view: "active" };
  var pager = window.CrediTrackPager.create($("pager"), function (n) { return load(n); }, $("search"));
  var requestSeq = 0;   // only the newest request may draw (a slow earlier answer is ignored)

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
  }

  var CHEVRON = '<svg class="cust-row__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  function row(c) {
    var debt = c.balance > 0;
    var meta = esc(c.code) + (c.phone ? " &middot; " + esc(api.formatPhone(c.phone)) : "");
    return '<li><a class="cust-row" href="customer-details?id=' + encodeURIComponent(c.id) + '">' +
      '<span class="cust-row__avatar" aria-hidden="true">' + (c.photo ? '<img src="' + esc(c.photo) + '" alt="">' : esc(initials(c.name))) + "</span>" +
      '<span class="cust-row__main"><span class="cust-row__name">' + esc(c.name) + "</span>" +
      '<span class="cust-row__meta">' + meta + "</span></span>" +
      '<span class="cust-row__side"><span class="cust-row__amount' + (debt ? "" : " is-paid") + '">' + peso(c.balance) + "</span>" +
      '<span class="cust-row__status">' +
      (c.archived ? '<span class="badge badge--archived">Archived</span>' : c.overdueDays > 0 ? '<span class="badge badge--danger">Overdue</span>' : debt ? '<span class="cust-row__state is-debt">Outstanding</span>' : '<span class="cust-row__state">Fully paid</span>') +
      "</span>" + (!c.archived && c.overdueDays > 0 ? '<span class="cust-row__state is-overdue">' + c.overdueDays + (c.overdueDays === 1 ? " day" : " days") + " overdue</span>" : "") +
      "</span>" + CHEVRON + "</a></li>";
  }

  function render() {
    var d = state.data;
    if (!d) return;
    var archivedView = state.view === "archived";
    var counts = d.counts;

    $("count-active").textContent = counts.active;
    $("count-archived").textContent = counts.archived;
    $("count-all").textContent = counts.all;
    $("count-debt").textContent = counts.debt;
    $("count-paid").textContent = counts.paid;
    $("page-sub").textContent = d.totalAll
      ? counts.active + (counts.active === 1 ? " active customer" : " active customers") + (counts.archived ? " \u00B7 " + counts.archived + " archived" : "") + "."
      : "Manage your store\u2019s customers.";
    document.querySelectorAll(".seg__btn").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === state.view));
    });

    var hasAny = d.totalAll > 0;
    $("toolbar").hidden = !hasAny;
    $("empty-none").hidden = hasAny;
    // Nothing archived yet (Archived view) or everyone archived (Active view): the view has its own empty state
    var viewEmpty = hasAny && counts.all === 0;
    $("empty-archived").hidden = !viewEmpty;
    if (viewEmpty) {
      $("archived-title").textContent = archivedView ? "No archived customers" : "No active customers";
      $("archived-text").textContent = archivedView
        ? "Customers you archive are kept here with all their records, and can be restored anytime."
        : "All your customers are archived. Open the Archived view to restore one.";
    }
    $("chips").hidden = viewEmpty;

    var shown = state.items;
    var list = $("cust-list");
    list.innerHTML = shown.map(row).join("");
    list.hidden = !shown.length;
    pager.update(d);

    // "Showing X of Y": while filtering, X is what matches and Y is the view; while pages are still hidden, X is what is on screen
    var line = $("result-line");
    var filtering = state.query.trim() || state.filter !== "all";
    line.hidden = !(counts.all && shown.length);
    line.textContent = d.totalPages > 1
      ? window.CrediTrackPager.range(d) + (filtering ? " matching" : "")
      : "Showing " + d.totalCount + " of " + counts.all;

    var none = counts.all > 0 && d.totalCount === 0;
    $("empty-found").hidden = !none;
    if (none) {
      if (state.query.trim()) {
        $("found-title").textContent = "No customers found";
        $("found-text").textContent = "Nothing matches \u201C" + state.query.trim() + "\u201D in " + (archivedView ? "archived" : "active") + " customers. Check the spelling or try a different name.";
      } else if (state.filter === "debt") {
        $("found-title").textContent = "No customers with debt";
        $("found-text").textContent = archivedView ? "No archived customer has an outstanding balance." : "Everyone is fully paid right now.";
      } else {
        $("found-title").textContent = "No fully paid customers";
        $("found-text").textContent = "Every customer here still has an outstanding balance.";
      }
      $("found-reset").textContent = state.query.trim() ? "Clear search" : "Show all customers";
    }
    $("search-clear").hidden = !state.query;
    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-filter") === state.filter));
    });
  }

  // The query this page sends. The names match the future API (GET /api/customers?search=&status=&balance=&page=&pageSize=).
  function currentQuery(page) {
    return { search: state.query.trim(), status: state.view, balance: state.filter, page: page, pageSize: PAGE_SIZE };
  }
  // A number = that page; anything else (a filter changed) = start again from page 1
  function load(target) {
    var seq = ++requestSeq, page = typeof target === "number" ? target : 1;
    return api.queryCustomers(currentQuery(page)).then(function (data) {
      if (seq !== requestSeq) return;
      state.data = data;
      state.page = data.page;
      state.items = data.items;
      render();
    });
  }
  // Something changed in the search, view or chips: save the view and ask for page 1 again
  function refresh() { saveView(); return load(true); }

  // The list remembers its search and filter for this browser tab, so coming Back from Customer Details
  // (or from Add / Edit Customer) shows the list exactly as it was left. A fresh visit starts clean.
  var VIEW_KEY = "creditrack.customers.view";
  function saveView() {
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ query: state.query, filter: state.filter, view: state.view })); } catch (e) { /* ignore */ }
  }
  function readView() {
    try { return JSON.parse(window.sessionStorage.getItem(VIEW_KEY)); } catch (e) { return null; }
  }
  function clearView() {
    try { window.sessionStorage.removeItem(VIEW_KEY); } catch (e) { /* ignore */ }
  }
  function applyView(view) {
    state.query = view && typeof view.query === "string" ? view.query : "";
    state.filter = view && ["all", "debt", "paid"].indexOf(view.filter) !== -1 ? view.filter : "all";
    state.view = view && view.view === "archived" ? "archived" : "active";
    $("search").value = state.query;
  }

  $("search").addEventListener("input", function (event) { state.query = event.target.value; refresh(); });
  $("search-clear").addEventListener("click", function () { state.query = ""; $("search").value = ""; refresh(); $("search").focus(); });
  document.querySelector(".seg").addEventListener("click", function (event) {
    var btn = event.target.closest(".seg__btn");
    if (!btn) return;
    state.view = btn.getAttribute("data-view");
    state.filter = "all";
    state.query = ""; $("search").value = "";
    refresh();
  });
  document.querySelector(".chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    refresh();
  });
  $("found-reset").addEventListener("click", function () {
    if (state.query.trim()) { state.query = ""; $("search").value = ""; } else { state.filter = "all"; }
    refresh();
  });

  // Starting view:
  //   Back/Forward (for example Back from Customer Details): the view the person left.
  //   Link with ?filter=debt (the dashboard's "Customers with Debt"): that filter.
  //   Anything else (sidebar, bottom bar): all customers.
  var wanted = new URLSearchParams(window.location.search).get("filter");
  var saved = readView();
  if (window.CrediTrack.navType() === "back_forward" && saved) {
    applyView(saved);
  } else if (wanted === "debt" || wanted === "paid") {
    state.filter = wanted;
    saveView();
  } else {
    clearView();
  }


  // ---------- Join requests ----------
  // A customer who typed my store code is only a request until I approve (real accounts; the demo has none).
  var joinRequests = [];
  var joinRecords = [];      // the store's own records that are not linked to an account yet: an approved join can be attached to one
  function daysLeft(iso) {
    var d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    return d > 1 ? d + " days left" : "Expires soon";
  }
  // Options of the "attach to" menu. A record with the same name as the person is listed first and labelled, but never chosen for the
  // owner: a name is typed by the customer and proves nothing, so attaching is always the owner's own decision.
  function attachOptions(name) {
    var key = String(name || "").trim().toLowerCase();
    var same = joinRecords.filter(function (c) { return String(c.name).trim().toLowerCase() === key; });
    var others = joinRecords.filter(function (c) { return same.indexOf(c) < 0; });
    function opt(c, tag) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + " (" + esc(c.code) + ")" + tag + "</option>"; }
    return '<option value="">Add as a new customer</option>' + same.map(function (c) { return opt(c, " \u2013 same name"); }).join("") + others.map(function (c) { return opt(c, ""); }).join("");
  }
  function renderJoinRequests() {
    $("jr-panel").hidden = joinRequests.length === 0;
    $("jr-count").textContent = joinRequests.length ? "(" + joinRequests.length + ")" : "";
    $("jr-list").innerHTML = joinRequests.map(function (r) {
      var a = r.account || {};
      var facts = [a.accountId, a.email, a.phone].filter(Boolean).map(esc).join(" &middot; ");
      var attach = joinRecords.length
        ? '<div class="jr-item__attach"><label class="jr-item__attach-label" for="jr-attach-' + esc(r.id) + '">Already in your records?</label>' +
          '<select class="select jr-item__select" id="jr-attach-' + esc(r.id) + '" data-jr-attach="' + esc(r.id) + '" aria-describedby="jr-attach-hint">' + attachOptions(a.name) + "</select></div>"
        : "";
      return '<li class="jr-item" data-jr="' + esc(r.id) + '">' +
        '<span class="jr-item__avatar" aria-hidden="true">' + esc(initials(a.name || "?")) + "</span>" +
        '<div class="jr-item__main"><strong class="jr-item__name">' + esc(a.name || "Customer") + "</strong>" +
        '<span class="jr-item__facts">' + facts + "</span>" +
        '<span class="jr-item__facts">' + esc(daysLeft(r.expiresAt)) + "</span></div>" +
        '<div class="jr-item__actions">' +
        '<button class="btn btn--primary btn--sm" type="button" data-jr-approve="' + esc(r.id) + '">Approve</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-jr-decline="' + esc(r.id) + '">Decline</button></div>' + attach + "</li>";
    }).join("");
  }
  function loadJoinRequests() {
    return api.getJoinRequests().then(function (d) { joinRequests = d.requests || []; joinRecords = d.records || []; renderJoinRequests(); }, function () { /* keep what is shown */ });
  }
  $("jr-list").addEventListener("click", function (event) {
    var b = event.target.closest("[data-jr-approve],[data-jr-decline]");
    if (!b || b.disabled) return;
    var approve = b.hasAttribute("data-jr-approve");
    var id = b.getAttribute(approve ? "data-jr-approve" : "data-jr-decline");
    var item = b.closest(".jr-item");
    // Attach to one of my existing records (its utang and payments stay with it), or make a new record
    var pick = approve ? item.querySelector("[data-jr-attach]") : null;
    var recordId = pick && pick.value ? pick.value : "";
    var recordName = recordId ? pick.options[pick.selectedIndex].text.replace(/\s*\u2013 same name$/, "") : "";
    item.querySelectorAll("button,select").forEach(function (x) { x.disabled = true; });
    (approve ? api.approveJoinRequest(id, recordId) : api.declineJoinRequest(id)).then(function () {
      window.CrediTrack.showToast(approve ? (recordId ? "Approved. The account was attached to " + recordName + "." : "Approved. The customer was added to your list.") : "Request declined.");
      return Promise.all([loadJoinRequests(), approve ? load(true) : null]);
    }).catch(function (error) {
      window.CrediTrack.showToast(error && error.message ? error.message : "That did not work. Please try again.");
      return loadJoinRequests();
    });
  });
  loadJoinRequests();

  // Restored from the back/forward cache: the page is as it was left, so pick up any changes made
  // meanwhile (a customer added or edited) and the view saved by that page.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    applyView(readView());
    load(true);
    loadJoinRequests();
  });

  load(true);
})();
