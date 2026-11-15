/* Customer Home dashboard.
   State 1 (no store joined): welcome, Join a Store, why it helps, bottom navigation.
   State 2 (joined at least one store), top to bottom: outstanding balance (with Total Credits and Total Payments),
   My Stores dropdown, My Stores section (cards + Join Another Store), Recent Activity. A floating PAY button
   (lower-right) opens a store chooser and then continues to Make a Payment.
   All data comes from js/api/customer-api.js (mock data only, no backend yet).
   The pages these buttons lead to (Join a Store, History, Payments, Profile) are built in later steps;
   until then their routes show a short message (see PLACEHOLDER_MESSAGES in js/main.js). */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var SCOPE_KEY = "creditrack.customer.home.store";   // remembers the selected store while the tab is open
  var ACTIVITY_LIMIT = 5;     // recent activity rows per page
  var DUE_LIMIT = 5;          // payment reminders shown (only credits due today)
  var activityPage = 1;
  var activityPager = window.CrediTrackPager.create($("activity-pager"), function (n) { activityPage = n; renderActivity(); }, $("activity-panel"));

  var payFab = null;       // the floating PAY button (set below)
  var home = null;          // what api.getHome() returned
  var scope = "all";        // "all" or a store id

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // "Today, 9:42 AM", "Yesterday, 5:30 PM", "Oct 28"
  function when(iso) {
    var d = new Date(iso), now = new Date();
    var days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    var time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
    if (days === 0) return "Today, " + time;
    if (days === 1) return "Yesterday, " + time;
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  }
  // Links added after main.js ran need their own click handler.
  function bindRoutes(container) {
    container.querySelectorAll("[data-route]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        window.CrediTrack.goTo(link.getAttribute("data-route"));
      });
    });
  }
  function readScope() { try { return window.sessionStorage.getItem(SCOPE_KEY); } catch (e) { return null; } }
  function saveScope(value) { try { window.sessionStorage.setItem(SCOPE_KEY, value); } catch (e) { /* ignore */ } }

  function selectedStore() {
    return home.stores.filter(function (s) { return s.id === scope; })[0] || null;
  }
  // A route for the selected store, e.g. "customer-history?store=str-001"
  function routeFor(name) { return scope === "all" ? name : name + "?store=" + encodeURIComponent(scope); }

  // ---------- Static icons ----------
  function fillIcons() {
    document.querySelector(".picker__icon").innerHTML = ICONS.store || "";
    document.querySelector(".picker__chev").innerHTML = ICONS.chevronDown || "";
    document.querySelectorAll(".why__check").forEach(function (el) { el.innerHTML = ICONS.check || ""; });
    document.querySelector(".pay-fab__icon").innerHTML = ICONS.payment || "";
  }

  // ---------- Store selector ----------
  function fillSelector() {
    var select = $("store-select");
    select.innerHTML = "";
    if (home.stores.length > 1) {
      var all = document.createElement("option");
      all.value = "all";
      all.textContent = "All stores (" + home.stores.length + ")";
      select.appendChild(all);
    }
    home.stores.forEach(function (s) {
      var option = document.createElement("option");
      option.value = s.id;
      option.textContent = s.name;
      select.appendChild(option);
    });
    select.value = scope;
  }

  // ---------- Everything that follows the selected store ----------
  function renderScope() {
    var one = selectedStore();
    var sum = api.summarize(home, one ? one.id : "");

    // Outstanding balance
    $("balance-title").textContent = one ? "Outstanding Balance" : "Total Outstanding Balance";
    $("balance-amount").textContent = peso(sum.balance);
    $("balance-note").textContent = one ? "Your balance at " + one.name : "Across " + plural(sum.storeCount, "connected store", "connected stores");
    var pending = $("pending-note");
    pending.hidden = !sum.pendingCount;
    if (sum.pendingCount) pending.textContent = peso(sum.pendingAmount) + (sum.pendingCount === 1 ? " payment" : " in " + sum.pendingCount + " payments") + " pending verification";
    $("total-credit").textContent = peso(sum.totalCredit);
    $("total-paid").textContent = peso(sum.totalPaid);

    // Account Status and Payment Status (the status rules live in customer-api.js)
    $("account-sub").textContent = one ? "Linked to " + one.name : "Linked to " + plural(sum.storeCount, "store", "stores");
    $("payment-card").setAttribute("data-tone", sum.status.tone);
    $("payment-status").innerHTML = '<span class="dot dot--' + sum.status.tone + '"></span>' + esc(sum.status.label);
    var percent = sum.totalCredit > 0 ? Math.min(100, Math.round(sum.totalPaid / sum.totalCredit * 100)) : 0;
    $("paid-bar").style.width = percent + "%";
    $("payment-sub").textContent = sum.balance <= 0 ? "Nothing to pay right now" : percent + "% of credits paid";

    activityPage = 1;
    renderActivity();
    markSelectedStore();
  }

  // ---------- Recent activity ----------
  function renderActivity() {
    var all = home.activity.filter(function (a) { return scope === "all" || a.storeId === scope; });
    var totalPages = Math.max(1, Math.ceil(all.length / ACTIVITY_LIMIT));
    if (activityPage > totalPages) activityPage = totalPages;
    var rows = all.slice((activityPage - 1) * ACTIVITY_LIMIT, activityPage * ACTIVITY_LIMIT);
    activityPager.update({ page: activityPage, totalPages: totalPages });
    $("activity-list").hidden = !rows.length;
    $("activity-empty").hidden = rows.length > 0;
    $("activity-link").hidden = !rows.length;
    $("activity-link").setAttribute("data-route", routeFor("customer-history"));
    $("activity-list").innerHTML = rows.map(function (a) {
      var kind = a.type === "credit" ? "credit" : a.type === "payment" ? "payment" : "pending";
      var label = a.type === "credit" ? "Credit: " : a.type === "payment" ? "Payment: " : "Payment request: ";
      var sign = a.type === "credit" ? "+" : a.type === "payment" ? "−" : "";
      var badge = a.type === "credit" ? "" :
        a.status === "pending" ? '<span class="badge badge--warning">Pending</span>' :
        a.status === "rejected" ? '<span class="badge badge--danger">Rejected</span>' :
        '<span class="badge badge--success">Recorded</span>';
      var meta = (scope === "all" && a.storeName ? esc(a.storeName) + " · " : "") + when(a.date);
      return '<li class="list__row list__row--link"><a class="list__link" href="transaction-details?id=' + encodeURIComponent(a.id) + '">' +
        '<span class="tx-icon tx-icon--' + kind + '" aria-hidden="true">' + (ICONS[kind] || "") + "</span>" +
        '<span class="act__main"><span class="act__title"><span class="visually-hidden">' + label + "</span>" + esc(a.title) + "</span>" +
        '<span class="act__meta">' + meta + "</span></span>" +
        '<span class="act__right"><span class="list__amount' + (a.type === "payment" ? " list__amount--in" : "") + '">' + sign + peso(a.amount) + "</span>" + badge + "</span></a></li>";
    }).join("");
  }

  // ---------- My Stores ----------
  function renderStores() {
    $("stores-count").textContent = home.stores.length + " connected";
    $("stores-grid").innerHTML = home.stores.map(function (s) {
      return '<a class="store-card" href="#" data-store="' + esc(s.id) + '" data-route="customer-stores?store=' + encodeURIComponent(s.id) + '">' +
        '<span class="store-card__icon" aria-hidden="true">' + (ICONS.store || "") + "</span>" +
        '<span class="store-card__name">' + esc(s.name) + "</span>" +
        '<span class="store-card__label">Your balance</span>' +
        '<span class="store-card__amount">' + peso(s.balance) + "</span>" +
        '<span class="badge badge--' + s.status.tone + '">' + esc(s.status.label) + "</span>" +
        '<span class="store-card__more">View details ' + (ICONS.chevronRight || "") + "</span></a>";
    }).join("") +
      '<a class="store-card store-card--add" href="#" data-route="customer-join-store">' +
      '<span class="store-card__icon" aria-hidden="true">' + (ICONS.plus || "") + "</span>" +
      '<span class="store-card__name">Join Another Store</span>' +
      "<p>Connect another suking tindahan.</p></a>";
    bindRoutes($("stores-grid"));
  }
  function markSelectedStore() {
    $("stores-grid").querySelectorAll("[data-store]").forEach(function (card) {
      card.classList.toggle("is-selected", card.getAttribute("data-store") === scope);
    });
  }

  // ---------- Payment reminders (overdue / due today / due soon) ----------
  function dueText(d) {
    if (d.status === "overdue") return "Overdue by " + plural(d.days, "day", "days");
    if (d.status === "today") return "Due today";
    return d.days === 1 ? "Due tomorrow" : "Due in " + d.days + " days";
  }
  function dueDateText(iso) {
    var p = String(iso).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  }
  function renderDue() {
    // Only credits that are due TODAY are listed (the server sends just those), up to DUE_LIMIT of them
    var list = (home.dueReminders || []).filter(function (d) { return d.status === "today"; }), section = $("due-section");
    section.hidden = list.length === 0;
    if (!list.length) return;
    section.classList.remove("cdue--late");
    // A count badge, the one credit that needs attention first (the list is in due-date order; tapping it opens its details, where Pay is),
    // and a link to the rest. Overdue credits turn the badge red.
    var total = Math.max(home.dueReminderCount || 0, list.length);
    $("due-count").textContent = total;
    $("due-count").setAttribute("aria-label", plural(total, "reminder", "reminders"));
    $("due-list").innerHTML = list.slice(0, DUE_LIMIT).map(function (d) {
      return '<li class="cdue__item cdue__item--' + d.status + '">' +
        '<a class="cdue__link" href="transaction-details?id=' + encodeURIComponent(d.id) + '">' +
        '<span class="cdue__main"><span class="cdue__when">' + esc(dueText(d)) + "</span>" +
        '<span class="cdue__store">' + esc(d.storeName) + " · " + esc(d.code) + " · due " + esc(dueDateText(d.dueDate)) + "</span></span>" +
        '<span class="cdue__amount">' + peso(d.outstanding) + "</span></a></li>";
    }).join("");
    var extra = total - DUE_LIMIT;
    $("due-more").hidden = extra <= 0;
    if (extra > 0) $("due-more").textContent = "View all " + total + " reminders";
  }
  bindRoutes($("due-more"));

  // ---------- The two states ----------
  function render() {
    var joined = home.stores.length > 0;
    $("state-empty").hidden = joined;
    $("state-joined").hidden = !joined;
    payFab.hidden = !joined;
    $("welcome-sub").textContent = joined ? "Here’s your credit summary." : "Welcome to CrediTrack.";
    if (!joined) return;

    // One store: no "All stores" choice. Otherwise restore the remembered choice if it still exists.
    var saved = readScope();
    var known = home.stores.some(function (s) { return s.id === saved; });
    scope = home.stores.length === 1 ? home.stores[0].id : (saved === "all" || known ? saved : "all");
    renderDue();
    fillSelector();
    renderStores();
    renderScope();
  }

  function load() {
    api.getCustomer().then(function (customer) {
      $("welcome-title").textContent = customer.firstName ? "Hi, " + customer.firstName + "!" : "Hi there!";
    });
    return api.getHome().then(function (data) { home = data; render(); }).catch(function (err) {
      window.CrediTrack.showToast(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  }

  // ---------- Events ----------
  $("store-select").addEventListener("change", function (event) {
    scope = event.target.value;
    saveScope(scope);
    renderScope();
  });

  // ---------- Floating PAY button: choose a connected store, then continue to Make a Payment ----------
  var sheet = $("paysheet"), payChoice = "", lastFocus = null;

  function renderPayChoices() {
    $("paysheet-list").innerHTML = home.stores.map(function (s) {
      var owes = s.balance > 0;
      return '<label class="payopt' + (owes ? "" : " is-disabled") + '">' +
        '<input type="radio" name="pay-store" value="' + esc(s.id) + '"' + (owes ? "" : " disabled") + (payChoice === s.id ? " checked" : "") + ">" +
        '<span class="payopt__icon" aria-hidden="true">' + (ICONS.store || "") + "</span>" +
        '<span class="payopt__main"><span class="payopt__name">' + esc(s.name) + "</span>" +
        '<span class="payopt__sub">' + (owes ? "Balance " + peso(s.balance) : "Nothing to pay") + "</span></span>" +
        '<span class="badge badge--' + s.status.tone + '">' + esc(s.status.label) + "</span></label>";
    }).join("");
  }
  function openPay() {
    if (!home || !home.stores.length) return;
    var owing = home.stores.filter(function (s) { return s.balance > 0; });
    if (!owing.length) { window.CrediTrack.showToast("You have no outstanding balance to pay."); return; }
    // The store picked in the dropdown is preselected when it has a balance; a single store with a balance needs no choice.
    var current = owing.filter(function (s) { return s.id === scope; })[0];
    payChoice = current ? current.id : (owing.length === 1 ? owing[0].id : "");
    if (home.stores.length === 1) { window.CrediTrack.goTo("customer-payment?store=" + encodeURIComponent(payChoice)); return; }
    renderPayChoices();
    $("paysheet-error").hidden = true;
    lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.classList.add("is-paysheet-open");
    var first = sheet.querySelector("input:checked") || sheet.querySelector("input:not(:disabled)");
    if (first) first.focus();
  }
  function closePay() {
    sheet.hidden = true;
    document.body.classList.remove("is-paysheet-open");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  payFab = $("pay-fab");
  payFab.addEventListener("click", openPay);
  sheet.addEventListener("click", function (event) { if (event.target.closest("[data-pay-close]")) closePay(); });
  $("paysheet-list").addEventListener("change", function (event) {
    payChoice = event.target.value;
    $("paysheet-error").hidden = true;
  });
  $("paysheet-continue").addEventListener("click", function () {
    if (!payChoice) { $("paysheet-error").hidden = false; return; }
    closePay();
    window.CrediTrack.goTo("customer-payment?store=" + encodeURIComponent(payChoice));
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !sheet.hidden) closePay(); });


  // Coming Back to a page restored from the back/forward cache: show the current data
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });

  fillIcons();
  load();
})();
