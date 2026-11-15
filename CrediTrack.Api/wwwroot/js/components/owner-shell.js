/* Store Owner shell: header, sidebar (desktop), bottom navigation (mobile)
   and the mobile "+" quick-action sheet. Built once here and reused by every
   Store Owner page, so the navigation lives in ONE list (NAV below).

   Usage on a page:
     <body class="owner" data-root="../../" data-page="dashboard">
       <div class="owner-app"><main class="owner-main" id="main">...</main></div>
   Load this file BEFORE js/main.js so main.js can wire up the data-route links.

   Two kinds of page:
   - MAIN pages (Dashboard, Customers, Transactions, Payment Requests, Reports, Settings): the default.
     Full navigation: top header, desktop sidebar, phone bottom bar and the "+" quick actions.
   - DETAIL pages and subpages (Customer Details, Add Customer, Edit Customer, ...): add data-nav="sub"
     and data-title="Page title" to <body>. No header, sidebar, bottom bar or "+" is built; the page
     shows only a Back button in a slim bar, with the page title as a heading just below it. Back returns to the page the person came from
     (CrediTrack.goBack in js/main.js). Set data-back="<url>" as the fallback for when there is no
     previous page (for example a bookmarked link). */
(function () {
  "use strict";

  var root = document.body.getAttribute("data-root") || "";
  var activePage = document.body.getAttribute("data-page");
  var app = document.querySelector(".owner-app");
  var main = document.querySelector(".owner-main");
  if (!app || !main) return;

  // Skip link: lets keyboard and screen reader users jump past the navigation (styles: css/polish.css)
  if (!document.querySelector(".skip-link")) {
    var skip = document.createElement("a");
    skip.className = "skip-link";
    skip.href = "#main";
    skip.textContent = "Skip to main content";
    skip.addEventListener("click", function () { main.setAttribute("tabindex", "-1"); main.focus(); });
    document.body.insertBefore(skip, document.body.firstChild);
  }


  function icon(paths) {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICONS = {
    dashboard: icon('<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect x="3" y="15.5" width="7.5" height="5.5" rx="2"/>'),
    customers: icon('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>'),
    transactions: icon('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
    requests: icon('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-6z"/>'),
    reports: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    plus: icon('<path class="plus-v" d="M12 5v14"/><path d="M5 12h14"/>'),
    bell: icon('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
    profile: icon('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
    credit: icon('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h10M7 14h5"/>'),
    payment: icon('<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9.5 13.5l2 2 3.5-4"/>'),
    logout: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')
  };
  window.CrediTrackIcons = ICONS; // reused by page scripts
  ICONS.back = icon('<path d="M19 12H5M11 18l-6-6 6-6"/>');

  // ---- Detail pages and subpages: just a Back button and the page title ----
  if (document.body.getAttribute("data-nav") === "sub") {
    document.body.classList.add("owner--subpage");
    var bar = document.createElement("header");
    bar.className = "subbar";
    bar.innerHTML =
      '<div class="subbar__inner">' +
      '<button class="subbar__back" type="button" id="subbar-back">' + ICONS.back + "<span>Back</span></button></div>";
    app.insertBefore(bar, main);

    // The page title is NOT part of the bar: it is the first heading of the page content, just below the bar.
    var heading = document.createElement("h1");
    heading.className = "subpage-title";
    heading.id = "subbar-title";
    heading.textContent = document.body.getAttribute("data-title") || document.title.split("|")[0].trim();
    var content = main.querySelector(".page") || main;
    content.insertBefore(heading, content.firstChild);

    document.getElementById("subbar-back").addEventListener("click", function () {
      window.CrediTrack.goBack(document.body.getAttribute("data-back"));
    });
    return;   // no header, sidebar, bottom navigation or quick actions on these pages
  }

  // The one navigation list. "route" names live in js/main.js.
  // "short" is the label used on the phone bottom bar.
  var NAV = [
    { id: "dashboard", label: "Home", short: "Home", route: "store-dashboard", icon: "dashboard" },
    { id: "customers", label: "Customers", short: "Customers", route: "owner-customers", icon: "customers" },
    { id: "transactions", label: "Transactions", short: "History", route: "owner-transactions", icon: "transactions" },
    { id: "payment-requests", label: "Payment Requests", route: "owner-payment-requests", icon: "requests" },
    { id: "reports", label: "Reports", short: "Reports", route: "owner-reports", icon: "reports" },
    { id: "settings", label: "Settings", route: "owner-settings", icon: "settings" }
  ];
  // Phone bottom bar: four tabs plus the "+" in the middle (no hamburger menu).
  // Payment Requests is reached from the dashboard and the bell, Settings from the profile icon.
  var BOTTOM_IDS = ["dashboard", "customers", "transactions", "reports"];

  var LOGO = '<img class="logo-light" src="' + root + 'assets/images/creditrack-logo-transparent.png?v=3" width="1363" height="597" alt="CrediTrack">' +
    '<img class="logo-dark" src="' + root + 'assets/images/creditrack-logo-dark.png?v=3" width="1363" height="597" alt="" aria-hidden="true">';
  var WORDMARK = '<img class="logo-light" src="' + root + 'assets/images/creditrack-wordmark-transparent.png?v=3" width="1363" height="214" alt="CrediTrack">' +
    '<img class="logo-dark" src="' + root + 'assets/images/creditrack-wordmark-dark.png?v=3" width="1363" height="214" alt="" aria-hidden="true">';
  var DASH_URL = root + "owner/dashboard";

  function byId(id) { return NAV.filter(function (n) { return n.id === id; })[0]; }
  function current(item) { return item.id === activePage ? ' aria-current="page"' : ""; }
  function href(item) { return item.id === "dashboard" ? root + "owner/dashboard" : "#"; }

  function navLink(item, cls, label) {
    return '<a class="' + cls + '" href="' + href(item) + '" data-route="' + item.route + '"' + current(item) + ">" +
      ICONS[item.icon] + "<span>" + (label || item.label) + "</span></a>";
  }

  // Sidebar (desktop)
  var sidebar = document.createElement("aside");
  sidebar.className = "owner-sidebar";
  sidebar.innerHTML =
    '<a class="owner-sidebar__logo" href="' + root + 'owner/dashboard" data-route="store-dashboard" aria-label="CrediTrack dashboard">' + LOGO + "</a>" +
    '<nav class="owner-sidebar__nav" aria-label="Main">' +
    // Payment Requests is not in the sidebar: the Home page has its own Payment Requests section (and the bell leads there too)
    NAV.filter(function (n) { return n.id !== "payment-requests"; }).map(function (n) { return navLink(n, "owner-nav__link"); }).join("") +
    "</nav>" +
    '<a class="owner-nav__link owner-sidebar__logout" href="#" data-route="login" data-logout>' + ICONS.logout + "<span>Log Out</span></a>";

  // Header: phone shows a white bar with the wordmark; desktop shows the store identity.
  var settings = byId("settings");
  var header = document.createElement("header");
  header.className = "owner-header";
  header.innerHTML =
    '<a class="owner-header__brand" href="' + DASH_URL + '" data-route="store-dashboard" aria-label="CrediTrack dashboard">' + WORDMARK + "</a>" +
    '<a class="owner-header__store" href="#" data-route="' + settings.route + '"><span class="owner-header__avatar" id="owner-avatar" aria-hidden="true"></span>' +
    '<span class="owner-header__name" id="owner-store-name"></span></a>' +
    '<div class="owner-header__tools">' +
    '<a class="owner-header__btn" href="#" data-route="owner-notifications" aria-label="Notifications">' + ICONS.bell + '<span class="owner-header__dot" id="notif-dot" hidden></span></a>' +
    '<a class="owner-header__btn owner-header__btn--profile" href="#" data-route="' + settings.route + '" aria-label="Profile and settings">' + ICONS.profile + "</a>" +
    "</div>";

  // Bottom navigation (phone)
  var tabs = BOTTOM_IDS.map(function (id) { return navLink(byId(id), "owner-tab", byId(id).short); });
  var bottom = document.createElement("nav");
  bottom.className = "owner-bottomnav";
  bottom.setAttribute("aria-label", "Main");
  bottom.innerHTML = tabs.slice(0, 2).join("") +
    '<button class="owner-tab owner-tab--add" type="button" id="quick-add" aria-haspopup="dialog" aria-expanded="false" aria-controls="quick-sheet">' +
    '<span class="owner-tab__plus">' + ICONS.plus + '</span><span class="visually-hidden">Quick actions</span></button>' +
    tabs.slice(2).join("");

  // Quick actions opened by the "+" button: dimmed page with two buttons above the bar
  var sheet = document.createElement("div");
  sheet.className = "quick-sheet";
  sheet.id = "quick-sheet";
  sheet.hidden = true;
  sheet.innerHTML =
    '<div class="quick-sheet__backdrop" data-close></div>' +
    '<div class="quick-sheet__actions" role="dialog" aria-label="Quick actions">' +
    '<a class="quick-sheet__btn quick-sheet__btn--credit" href="#" data-route="record-credit" data-close>' + ICONS.credit + "<span>Record Utang</span></a>" +
    '<a class="quick-sheet__btn quick-sheet__btn--payment" href="#" data-route="record-payment" data-close>' + ICONS.payment + "<span>Record Bayad</span></a>" +
    "</div>";

  app.insertBefore(sidebar, main);
  app.insertBefore(header, main);
  app.appendChild(bottom);
  document.body.appendChild(sheet);

  // Desktop floating action button (bottom-right). It opens the same quick actions as the phone "+".
  var fab = document.createElement("button");
  fab.className = "owner-fab";
  fab.type = "button";
  fab.id = "quick-fab";
  fab.setAttribute("aria-haspopup", "dialog");
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-controls", "quick-sheet");
  fab.innerHTML = ICONS.plus + '<span class="visually-hidden">Quick actions</span>';
  document.body.appendChild(fab);

  // Open / close the quick actions (shared by the phone "+" and the desktop button)
  var triggers = [document.getElementById("quick-add"), fab];
  var lastTrigger = triggers[0];
  function visibleTrigger() { return triggers.filter(function (t) { return t.getClientRects().length > 0; })[0] || triggers[0]; }
  function setSheet(open) {
    sheet.hidden = !open;
    triggers.forEach(function (t) { t.setAttribute("aria-expanded", String(open)); });
    if (open) sheet.querySelector(".quick-sheet__btn").focus();
    else lastTrigger.focus({ preventScroll: true });
  }
  triggers.forEach(function (t) {
    t.addEventListener("click", function () { lastTrigger = t; setSheet(sheet.hidden); });
  });
  sheet.addEventListener("click", function (event) {
    if (event.target.closest("[data-close]")) { sheet.hidden = true; triggers.forEach(function (t) { t.setAttribute("aria-expanded", "false"); }); }
  });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !sheet.hidden) { lastTrigger = visibleTrigger(); setSheet(false); } });

  // ---- The bell: red dot, checking for new notifications, a soft sound ----
  // Asks the server for the unread count every 25 seconds (and when the tab comes back into view). When the count goes UP since the
  // last check it plays a short two-note sound and shows a message. The sound can only play after the person has tapped or clicked
  // somewhere on the page (browsers block sound before that), so it may stay silent until then; the red dot always works.
  // The Notifications page listens to "creditrack:notifications" and refreshes its list when something changed.
  function watchNotifications(getCount, role) {
    var STORE = "creditrack.notif.last." + role, audio = null, last = null, timer = null;
    try { var saved = window.sessionStorage.getItem(STORE); last = saved === null ? null : parseInt(saved, 10); } catch (e) { last = null; }

    function unlock() {
      if (audio) return;
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audio = new Ctx();
        if (audio && audio.state === "suspended") audio.resume();
      } catch (e) { audio = null; }
    }
    ["click", "keydown", "touchstart"].forEach(function (name) { document.addEventListener(name, unlock, { passive: true }); });

    function beep() {
      try {
        if (!audio) return;
        if (audio.state === "suspended") audio.resume();
        var now = audio.currentTime;
        [[880, 0], [1175, 0.15]].forEach(function (note) {
          var osc = audio.createOscillator(), gain = audio.createGain(), at = now + note[1];
          osc.type = "sine"; osc.frequency.value = note[0];
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
          osc.connect(gain); gain.connect(audio.destination);
          osc.start(at); osc.stop(at + 0.2);
        });
      } catch (e) { /* no sound: the red dot still shows */ }
    }

    function check(quiet) {
      return getCount().then(function (count) {
        var dot = document.getElementById("notif-dot"), bellLink = dot && dot.parentNode;
        if (dot) {
          dot.hidden = !count;
          bellLink.setAttribute("aria-label", count ? "Notifications, " + count + " unread" : "Notifications");
        }
        var more = last !== null && count > last;
        if (more && !quiet) {
          beep();
          if (window.CrediTrack && window.CrediTrack.showToast) window.CrediTrack.showToast(count - last === 1 ? "You have a new notification." : "You have " + (count - last) + " new notifications.");
        }
        if (last === null || count !== last) { window.dispatchEvent(new CustomEvent("creditrack:notifications", { detail: { unread: count, more: more } })); }
        last = count;
        try { window.sessionStorage.setItem(STORE, String(count)); } catch (e) { /* ignore */ }
      }, function () { /* offline: try again next time */ });
    }
    function start() { if (!timer) timer = setInterval(function () { if (!document.hidden) check(false); }, 25000); }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) check(false); });
    window.addEventListener("pageshow", function (event) { if (event.persisted) check(true); });
    check(false);
    start();
  }

  // Fill the store name, initials and request badge from the data layer.
  if (window.CrediTrackApi) {
    window.CrediTrackApi.getOwner().then(function (owner) {
      document.getElementById("owner-store-name").textContent = owner.storeName;
      var avatar = document.getElementById("owner-avatar");
      avatar.textContent = owner.fullName.split(" ").map(function (w) { return w[0]; }).slice(0, 2).join("");
      if (owner.photo) { var img = document.createElement("img"); img.src = owner.photo; img.alt = ""; avatar.textContent = ""; avatar.appendChild(img); }
    });
    // The saved photo lives on the server (so customers see it too); fetch it once per page and update the header avatar.
    if (window.CrediTrackApi.refreshOwnerPhoto) window.CrediTrackApi.refreshOwnerPhoto().then(function (photo) {
      var avatar = document.getElementById("owner-avatar");
      if (!avatar || !photo) return;
      var current = avatar.querySelector("img");
      if (current && current.getAttribute("src") === photo) return;
      var img = document.createElement("img"); img.src = photo; img.alt = "";
      avatar.textContent = ""; avatar.appendChild(img);
    });
    // The bell opens Notifications, so its red dot means "you have unread notifications".
    watchNotifications(function () { return window.CrediTrackApi.getUnreadNotificationCount(); }, "owner");
  }
})();
