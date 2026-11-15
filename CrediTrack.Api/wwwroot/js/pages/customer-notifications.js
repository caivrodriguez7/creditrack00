/* Customer Portal > Notifications (notifications), a subpage opened from the bell in the header (Back button only, no bottom navigation).
   Lists the customer's notifications newest first, grouped by day (Today, Yesterday, Earlier), with:
   - All / Unread tabs (with counts), a Read / Unread label and dot on every item, a "Mark as read" button on each unread
     item, and "Mark all as read"
   - payment request updates (pending, approved, rejected), store activity (credits and payments the store recorded)
     and account alerts (store joined, balance reminder, overdue, welcome)
   - empty states: nothing at all (with Join a Store when no store is joined) and Unread with everything read
   Opening a notification marks it read and goes to what it is about: a payment request opens Payment Request Details,
   a credit or payment opens Transaction Details, a store alert opens History for that store.
   All data comes from js/api/customer-api.js getNotifications() (sample notifications for the demo account, built from the
   same records as Home, History and Payments; a new real account starts with none). */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };
  var PAGE_SIZE = 10;     // notifications per page

  // Icon + colour class (from owner-notifications.css) + the action line for each notification type
  function svg(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON = {
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>'),
    cross: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    alert: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>'),
    store: svg('<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M10 20v-4.5h4V20"/>'),
    credit: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h10M7 14h5"/>'),
    receipt: svg('<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9.5 13.5l2 2 3.5-4"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
    bell: svg('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
    markRead: svg('<path d="M2.5 12.5l4.5 4.5 7-9M10.5 16.5l1 1 9-10.5"/>')
  };
  var TYPES = {
    payment_pending:  { icon: "clock",   cls: "request",  action: "View request" },
    payment_approved: { icon: "check",   cls: "approved", action: "View request" },
    payment_rejected: { icon: "cross",   cls: "rejected", action: "View request" },
    payment_recorded: { icon: "receipt", cls: "payment",  action: "View transaction" },
    credit_recorded:  { icon: "credit",  cls: "credit",   action: "View transaction" },
    store_joined:     { icon: "store",   cls: "customer", action: "View history" },
    link_request:     { icon: "store",   cls: "customer", action: "Review request" },
    join_approved:    { icon: "check",   cls: "approved", action: "View history" },
    join_declined:    { icon: "cross",   cls: "rejected", action: "Open" },
    balance_reminder: { icon: "credit",  cls: "credit",   action: "View history" },
    overdue:          { icon: "alert",   cls: "overdue",  action: "View history" },
    welcome:          { icon: "user",    cls: "customer", action: "Open" }
  };
  var FALLBACK_TYPE = { icon: "bell", cls: "customer", action: "Open" };

  var state = { data: null, filter: "all", page: 1 };
  var pager = window.CrediTrackPager.create($("pager"), function (n) { state.page = n; render(); }, $("toolbar"));

  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---- Dates and times ----
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dayDiff(iso) { return Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000); }
  function clock(iso) {
    return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); });
  }
  function shortDate(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  function longDate(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }); }
  // "5 minutes ago" within the hour, then "Today, 9:42 AM", "Yesterday, 4:30 PM", "Oct 28, 2026, 8:00 AM"
  function when(iso) {
    var minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000), days = dayDiff(iso);
    if (days === 0) {
      if (minutes < 1) return "Just now";
      if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
      return "Today, " + clock(iso);
    }
    if (days === 1) return "Yesterday, " + clock(iso);
    return shortDate(iso) + ", " + clock(iso);
  }
  function groupKey(iso) { var d = dayDiff(iso); return d <= 0 ? "today" : d === 1 ? "yesterday" : "earlier"; }
  var GROUP_TITLE = { today: "Today", yesterday: "Yesterday", earlier: "Earlier" };

  // ---- Where a notification goes (always a real link) ----
  // A payment request opens Payment Request Details and its Back button returns here (from=notifications).
  function linkFor(n) {
    var t = n.target;
    if (!t) return null;
    if (t.kind === "request") return "payment-request-details?id=" + encodeURIComponent(t.id) + "&from=notifications";
    if (t.kind === "transaction") return "transaction-details?id=" + encodeURIComponent(t.id);
    if (t.kind === "history") return "history?store=" + encodeURIComponent(t.storeId);
    if (t.kind === "stores") return "stores";
    return null;
  }

  // ---- Drawing ----
  function item(n) {
    var type = TYPES[n.type] || FALLBACK_TYPE, href = linkFor(n), unread = !n.read;
    var inner =
      '<span class="nt-icon nt-icon--' + type.cls + '" aria-hidden="true">' + ICON[type.icon] + "</span>" +
      '<span class="nt-body">' +
      '<span class="nt-title">' + esc(n.title) + "</span>" +
      '<span class="nt-text">' + esc(n.message) + "</span>" +
      '<span class="nt-meta"><time datetime="' + esc(n.createdAt) + '" title="' + esc(longDate(n.createdAt) + ", " + clock(n.createdAt)) + '" data-time="' + esc(n.createdAt) + '">' + esc(when(n.createdAt)) + "</time>" +
      '<span class="nt-status nt-status--' + (unread ? "unread" : "read") + '">' + (unread ? "Unread" : "Read") + "</span></span>" +
      (href ? '<span class="nt-action">' + esc(n.type === "overdue" && n.target && n.target.kind === "transaction" ? "View transaction" : type.action) + " &rarr;</span>" : "") +
      "</span>";
    var open = href
      ? '<a class="nt-open" href="' + href + '" data-open="' + esc(n.id) + '">' + inner + "</a>"
      : '<button class="nt-open" type="button" data-open="' + esc(n.id) + '">' + inner + "</button>";
    var markRead = unread
      ? '<button class="nt-read" type="button" data-read="' + esc(n.id) + '" aria-label="Mark as read: ' + esc(n.title) + '" title="Mark as read">' + ICON.markRead + '<span class="nt-read__label" aria-hidden="true">Mark as read</span></button>'
      : "";
    return '<li class="nt-item' + (unread ? " is-unread" : "") + '">' + open + markRead + "</li>";
  }

  function groups(list) {
    var order = ["today", "yesterday", "earlier"], buckets = { today: [], yesterday: [], earlier: [] };
    list.forEach(function (n) { buckets[groupKey(n.createdAt)].push(n); });
    return order.filter(function (k) { return buckets[k].length; }).map(function (k) {
      var id = "group-" + k;
      return '<section class="nt-group" aria-labelledby="' + id + '"><h3 class="nt-group__title" id="' + id + '">' + GROUP_TITLE[k] + '</h3><ul class="nt-list">' +
        buckets[k].map(item).join("") + "</ul></section>";
    }).join("");
  }

  function filtered() {
    var all = state.data.notifications;
    return state.filter === "unread" ? all.filter(function (n) { return !n.read; }) : all;
  }

  function render() {
    var d = state.data, hasAny = d.total > 0, list = filtered();
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;       // e.g. the last item on the last page was marked read
    var page = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    $("toolbar").hidden = !hasAny;
    $("count-all").textContent = d.total;
    $("count-unread").textContent = d.unread;
    $("mark-all").disabled = d.unread === 0;
    $("page-sub").textContent = !hasAny ? "Updates about your payments, account and stores." : d.unread === 0 ? "You\u2019re all caught up." : d.unread + (d.unread === 1 ? " unread notification." : " unread notifications.");
    document.querySelectorAll("#filter-chips .chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-filter") === state.filter));
    });

    $("nt-groups").innerHTML = groups(page);
    $("nt-groups").hidden = !page.length;
    pager.update({ page: state.page, totalPages: totalPages });
    $("empty-none").hidden = hasAny;
    $("none-join").hidden = d.hasStores;
    $("none-title").textContent = d.hasStores ? "No notifications yet" : "No store joined yet";
    $("none-text").textContent = d.hasStores
      ? "Updates on your payment requests, your account and your stores will show up here."
      : "Join a store first. Updates on your payments and balance will show up here.";
    $("empty-unread").hidden = !(hasAny && !list.length);
    $("show-all").hidden = state.filter === "all";
  }

  // ---- Marking as read ----
  function say(message) { $("live").textContent = ""; setTimeout(function () { $("live").textContent = message; }, 30); }

  function reload() {
    return api.getNotifications().then(function (data) { state.data = data; render(); });
  }
  // After a re-render, keep keyboard focus somewhere sensible (the button that was used may be gone)
  function refocus(index) {
    var opens = document.querySelectorAll(".nt-open");
    if (opens.length) opens[Math.min(index, opens.length - 1)].focus();
    else {
      var target = document.querySelector("#filter-chips .chip[aria-pressed='true']");
      if (target) target.focus();
    }
  }
  function indexOfItem(el) {
    return Array.prototype.indexOf.call(document.querySelectorAll(".nt-item"), el.closest(".nt-item"));
  }
  function markOne(id, index) {
    return api.markNotificationRead(id).then(function () { return reload(); }).then(function () {
      say("Marked as read. " + state.data.unread + " unread.");
      refocus(index);
    }).catch(function () { toast("Couldn\u2019t update that notification. Please try again."); });
  }

  $("nt-groups").addEventListener("click", function (event) {
    var read = event.target.closest("[data-read]");
    if (read) { markOne(read.getAttribute("data-read"), indexOfItem(read)); return; }
    var open = event.target.closest("[data-open]");
    if (!open) return;
    // Opening a notification counts as reading it. The mark is saved before the next page loads.
    var at = indexOfItem(open);
    api.markNotificationRead(open.getAttribute("data-open")).catch(function () { /* the page still opens */ });
    // Links are followed by the browser as usual (including Ctrl/Cmd-click). One with no destination just becomes read.
    if (open.tagName === "BUTTON") reload().then(function () { refocus(at); });
  });

  $("mark-all").addEventListener("click", function () {
    api.markAllNotificationsRead().then(function (result) {
      return reload().then(function () {
        toast(result.changed ? "All notifications marked as read." : "Nothing to mark: everything is already read.");
        say("All notifications marked as read.");
        refocus(0);
      });
    }).catch(function () { toast("Couldn\u2019t update the notifications. Please try again."); });
  });

  $("filter-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    state.page = 1;
    render();
  });
  $("show-all").addEventListener("click", function () { state.filter = "all"; state.page = 1; render(); var c = document.querySelector("#filter-chips .chip"); if (c) c.focus(); });

  // Keep "5 minutes ago" honest while the page stays open
  setInterval(function () {
    document.querySelectorAll("time[data-time]").forEach(function (t) { t.textContent = when(t.getAttribute("data-time")); });
  }, 60000);

  // Coming Back to this page (back/forward cache) shows what was marked read in the meantime
  window.addEventListener("pageshow", function (event) { if (event.persisted) reload(); });
  // A new notification arrived while this page is open: show it without a refresh
  window.addEventListener("creditrack:notifications", function (event) { if (event.detail && event.detail.more) reload().catch(function () { /* keep what is shown */ }); });

  reload().catch(function () { toast("Couldn\u2019t load your notifications. Please try again."); });
})();
