/* Store Owner > Notifications (notifications).
   Lists the store's notifications newest first, grouped by day (Today, Yesterday, then the date), with an
   All / Unread filter, a read/unread status on every item, a "mark as read" button for each unread item,
   "Mark all as read", and empty states.
   Opening a notification marks it read and goes to what it is about (customer, transaction, or a Payment Request).
   All data comes from js/api/owner-api.js (sample notifications in demo mode, none for a new real account). */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var $ = function (id) { return document.getElementById(id); };

  // Icon + color class for each notification type
  function svg(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON = {
    wallet: svg('<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5v3"/><rect x="3.5" y="8" width="17" height="11.5" rx="2.5"/><path d="M16 13.75h2"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>'),
    cross: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    alert: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>'),
    userPlus: svg('<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    credit: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h10M7 14h5"/>'),
    receipt: svg('<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9.5 13.5l2 2 3.5-4"/>'),
    bell: svg('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
    markRead: svg('<path d="M2.5 12.5l4.5 4.5 7-9M10.5 16.5l1 1 9-10.5"/>')
  };
  var TYPES = {
    payment_request:  { icon: "wallet",  cls: "request",  action: "Review request" },
    payment_approved: { icon: "check",   cls: "approved", action: "View details" },
    payment_rejected: { icon: "cross",   cls: "rejected", action: "View request" },
    overdue:          { icon: "alert",   cls: "overdue",  action: "View account" },
    customer_joined:  { icon: "userPlus", cls: "customer", action: "View customer" },
    customer_linked:  { icon: "link",    cls: "customer", action: "View customer" },
    join_request:     { icon: "userPlus", cls: "customer", action: "Review request" },
    link_accepted:    { icon: "link",    cls: "approved", action: "View customer" },
    link_declined:    { icon: "cross",   cls: "rejected", action: "View customer" },
    credit_recorded:  { icon: "credit",  cls: "credit",   action: "View transaction" },
    payment_recorded: { icon: "receipt", cls: "payment",  action: "View transaction" }
  };
  var FALLBACK_TYPE = { icon: "bell", cls: "customer", action: "Open" };

  var state = { data: null, filter: "all" };

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
  function groupKey(iso) { var d = dayDiff(iso); return d === 0 ? "today" : d === 1 ? "yesterday" : "earlier"; }
  var GROUP_TITLE = { today: "Today", yesterday: "Yesterday", earlier: "Earlier" };

  // ---- Where a notification goes ----
  // Customers and transactions are real links; a route (for example a payment request) goes through CrediTrack.goTo.
  function linkFor(n) {
    var t = n.target;
    if (!t) return null;
    if (t.kind === "customer") return { href: "customer-details?id=" + encodeURIComponent(t.id) };
    if (t.kind === "transaction") return { href: "transaction-details?id=" + encodeURIComponent(t.id) };
    if (t.kind === "route") return { route: t.route };
    return null;
  }

  // ---- Drawing ----
  function item(n) {
    var type = TYPES[n.type] || FALLBACK_TYPE, link = linkFor(n), unread = !n.read;
    var inner =
      '<span class="nt-icon nt-icon--' + type.cls + '" aria-hidden="true">' + ICON[type.icon] + "</span>" +
      '<span class="nt-body">' +
      '<span class="nt-title">' + esc(n.title) + "</span>" +
      '<span class="nt-text">' + esc(n.message) + "</span>" +
      '<span class="nt-meta"><time datetime="' + esc(n.createdAt) + '" title="' + esc(longDate(n.createdAt) + ", " + clock(n.createdAt)) + '" data-time="' + esc(n.createdAt) + '">' + esc(when(n.createdAt)) + "</time>" +
      '<span class="nt-status nt-status--' + (unread ? "unread" : "read") + '">' + (unread ? "Unread" : "Read") + "</span></span>" +
      (link ? '<span class="nt-action">' + esc(type.action) + " &rarr;</span>" : "") +
      "</span>";
    var open;
    if (link && link.href) open = '<a class="nt-open" href="' + link.href + '" data-open="' + esc(n.id) + '">' + inner + "</a>";
    else if (link) open = '<button class="nt-open" type="button" data-open="' + esc(n.id) + '" data-route="' + esc(link.route) + '">' + inner + "</button>";
    else open = '<button class="nt-open" type="button" data-open="' + esc(n.id) + '">' + inner + "</button>";
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

  function visible() {
    var all = state.data.notifications;
    return state.filter === "unread" ? all.filter(function (n) { return !n.read; }) : all;
  }

  function render() {
    var d = state.data, hasAny = d.total > 0, list = visible();
    $("toolbar").hidden = !hasAny;
    $("count-all").textContent = d.total;
    $("count-unread").textContent = d.unread;
    $("mark-all").disabled = d.unread === 0;
    $("page-sub").textContent = !hasAny ? "Updates about your store." : d.unread === 0 ? "You\u2019re all caught up." : d.unread + (d.unread === 1 ? " unread notification." : " unread notifications.");
    document.querySelectorAll("#filter-chips .chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-filter") === state.filter));
    });

    $("nt-groups").innerHTML = groups(list);
    $("nt-groups").hidden = !list.length;
    $("empty-none").hidden = hasAny;
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
  function markOne(id, index) {
    return api.markNotificationRead(id).then(function () { return reload(); }).then(function () {
      say("Marked as read. " + state.data.unread + " unread.");
      refocus(index);
    }).catch(function () { window.CrediTrack.showToast("Couldn\u2019t update that notification. Please try again."); });
  }

  $("nt-groups").addEventListener("click", function (event) {
    var read = event.target.closest("[data-read]");
    if (read) {
      var all = Array.prototype.slice.call(document.querySelectorAll(".nt-item"));
      markOne(read.getAttribute("data-read"), all.indexOf(read.closest(".nt-item")));
      return;
    }
    var open = event.target.closest("[data-open]");
    if (!open) return;
    var id = open.getAttribute("data-open");
    // Opening a notification counts as reading it. The mark is saved before the next page loads.
    api.markNotificationRead(id).catch(function () { /* the page still opens */ });
    var route = open.getAttribute("data-route");
    if (route) {                                   // not built yet: show its message, then refresh the list
      window.CrediTrack.goTo(route);
      var all2 = Array.prototype.slice.call(document.querySelectorAll(".nt-item"));
      var at = all2.indexOf(open.closest(".nt-item"));
      reload().then(function () { refocus(at); });
    } else if (open.tagName === "BUTTON") {        // no destination: just mark it read
      var all3 = Array.prototype.slice.call(document.querySelectorAll(".nt-item"));
      var at3 = all3.indexOf(open.closest(".nt-item"));
      reload().then(function () { refocus(at3); });
    }
    // Links (customer, transaction) are followed by the browser as usual, including Ctrl/Cmd-click.
  });

  $("mark-all").addEventListener("click", function () {
    api.markAllNotificationsRead().then(function (result) {
      return reload().then(function () {
        window.CrediTrack.showToast(result.changed ? "All notifications marked as read." : "Nothing to mark: everything is already read.");
        say("All notifications marked as read.");
        refocus(0);
      });
    }).catch(function () { window.CrediTrack.showToast("Couldn\u2019t update the notifications. Please try again."); });
  });

  $("filter-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    render();
  });
  $("show-all").addEventListener("click", function () { state.filter = "all"; render(); var c = document.querySelector("#filter-chips .chip"); if (c) c.focus(); });
  // Empty state for a brand-new store: switch on the sample data (same switch as the dashboard and Transactions)

  // Keep "5 minutes ago" honest while the page stays open
  setInterval(function () {
    document.querySelectorAll("time[data-time]").forEach(function (t) { t.textContent = when(t.getAttribute("data-time")); });
  }, 60000);

  // Coming Back to this page (back/forward cache) shows what was marked read in the meantime
  window.addEventListener("pageshow", function (event) { if (event.persisted) reload(); });
  // A new notification arrived while this page is open: show it without a refresh
  window.addEventListener("creditrack:notifications", function (event) { if (event.detail && event.detail.more) reload().catch(function () { /* keep what is shown */ }); });

  reload().catch(function () {
    window.CrediTrack.showToast("Couldn\u2019t load your notifications. Please try again.");
  });
})();
