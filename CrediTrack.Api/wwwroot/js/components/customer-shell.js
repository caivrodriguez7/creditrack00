/* Customer shell: header, sidebar (desktop) and bottom navigation (phone) for the Customer Portal.
   The Store Owner shell (owner-shell.js) is left exactly as it was; this file is its sibling and
   reuses its styles (css/components/owner-shell.css: .owner-header, .owner-sidebar, .owner-nav__link,
   .owner-bottomnav, .owner-tab), plus the small differences in css/components/customer-shell.css.
   The navigation lives in ONE list (NAV below), as it does for the owner.

   Usage on a page:
     <body class="owner customer" data-root="../../" data-page="home">
       <div class="owner-app"><main class="owner-main" id="main">...</main></div>
   Load this file BEFORE js/main.js so main.js can wire up the data-route links. */
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
  // Also used by the page scripts (window.CrediTrackCustomerIcons)
  var ICONS = {
    home: icon('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V10"/>'),
    history: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    payments: icon('<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9.5 13.5l2 2 3.5-4"/>'),
    profile: icon('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
    bell: icon('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>'),
    logout: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    store: icon('<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M10 20v-4.5h4V20"/>'),
    plus: icon('<path d="M12 5v14M5 12h14"/>'),
    check: icon('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.5 2.5 4.5-5"/>'),
    chevronDown: icon('<path d="m6 9 6 6 6-6"/>'),
    chevronRight: icon('<path d="m9 6 6 6-6 6"/>'),
    credit: icon('<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    payment: icon('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5z"/><circle cx="16.5" cy="14.5" r="1"/>'),
    pending: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
  };
  window.CrediTrackCustomerIcons = ICONS;
  ICONS.back = icon('<path d="M19 12H5M11 18l-6-6 6-6"/>');

  // ---- Full-page flows (data-nav="none", for example Make a Payment): no header, sidebar or bottom navigation, and no Back bar ----
  // The page has its own heading and Back button, so only the navigation is left out (same look as the subpages without the extra bar).
  if (document.body.getAttribute("data-nav") === "none") {
    document.body.classList.add("owner--subpage");
    if (/[?&]modal=1(&|$)/.test(window.location.search) && window.parent !== window) document.documentElement.classList.add("mp-embed");   // shown inside the Make a Payment modal
    return;
  }

  // ---- Subpages (data-nav="sub", for example Notifications): just a Back button and the page title ----
  // Same as the Store Owner's subpages: no header, sidebar or bottom navigation. The bar styles are in owner-shell.css.
  //   data-title  the page title (first heading of the page)      data-back  where Back goes when there is no page to step back to
  if (document.body.getAttribute("data-nav") === "sub") {
    document.body.classList.add("owner--subpage");
    var bar = document.createElement("header");
    bar.className = "subbar";
    bar.innerHTML = '<div class="subbar__inner"><button class="subbar__back" type="button" id="subbar-back">' + ICONS.back + "<span>Back</span></button></div>";
    app.insertBefore(bar, main);

    var heading = document.createElement("h1");
    heading.className = "subpage-title";
    heading.id = "subbar-title";
    heading.textContent = document.body.getAttribute("data-title") || document.title.split("|")[0].trim();
    var content = main.querySelector(".page") || main;
    content.insertBefore(heading, content.firstChild);

    // Back: the Customer Portal page the customer came from (it keeps its place), otherwise the fallback
    document.getElementById("subbar-back").addEventListener("click", function () {
      var cameFromCustomerPage = false;
      try {
        var from = new URL(document.referrer);
        cameFromCustomerPage = window.history.length > 1 && from.origin === window.location.origin && /^\/customer\/[^/]+$/.test(from.pathname);
      } catch (e) { /* no referrer */ }
      if (cameFromCustomerPage) window.history.back();
      else window.location.href = document.body.getAttribute("data-back") || (root + "customer/home");
    });
    return;   // no header, sidebar or bottom navigation on these pages
  }

  // The one navigation list. "route" names live in js/main.js. "short" is the phone label.
  var NAV = [
    { id: "home", label: "Home", route: "customer-dashboard", icon: "home" },
    { id: "history", label: "History", route: "customer-history", icon: "history" },
    { id: "payments", label: "Payments", route: "customer-payments", icon: "payments" },
    { id: "profile", label: "Profile", route: "customer-profile", icon: "profile" }
  ];

  var LOGO = '<img class="logo-light" src="' + root + 'assets/images/creditrack-logo-transparent.png?v=3" width="1363" height="597" alt="CrediTrack">' +
    '<img class="logo-dark" src="' + root + 'assets/images/creditrack-logo-dark.png?v=3" width="1363" height="597" alt="" aria-hidden="true">';
  var WORDMARK = '<img class="logo-light" src="' + root + 'assets/images/creditrack-wordmark-transparent.png?v=3" width="1363" height="214" alt="CrediTrack">' +
    '<img class="logo-dark" src="' + root + 'assets/images/creditrack-wordmark-dark.png?v=3" width="1363" height="214" alt="" aria-hidden="true">';
  var HOME_URL = root + "customer/home";

  function current(item) { return item.id === activePage ? ' aria-current="page"' : ""; }
  function href(item) { return item.id === "home" ? HOME_URL : "#"; }
  function navLink(item, cls) {
    return '<a class="' + cls + '" href="' + href(item) + '" data-route="' + item.route + '"' + current(item) + ">" +
      ICONS[item.icon] + "<span>" + item.label + "</span></a>";
  }

  // Sidebar (desktop)
  var sidebar = document.createElement("aside");
  sidebar.className = "owner-sidebar";
  sidebar.innerHTML =
    '<a class="owner-sidebar__logo" href="' + HOME_URL + '" data-route="customer-dashboard" aria-label="CrediTrack home">' + LOGO + "</a>" +
    '<nav class="owner-sidebar__nav" aria-label="Main">' + NAV.map(function (n) { return navLink(n, "owner-nav__link"); }).join("") + "</nav>" +
    '<a class="owner-nav__link owner-sidebar__logout" href="#" data-route="login" data-logout>' + ICONS.logout + "<span>Log Out</span></a>";

  // Header: phone = wordmark and bell (Profile is in the bottom bar); desktop = the customer's name and the bell.
  var header = document.createElement("header");
  header.className = "owner-header";
  header.innerHTML =
    '<a class="owner-header__brand" href="' + HOME_URL + '" data-route="customer-dashboard" aria-label="CrediTrack home">' + WORDMARK + "</a>" +
    '<a class="owner-header__store" href="#" data-route="customer-profile"><span class="owner-header__avatar" id="customer-avatar" aria-hidden="true"></span>' +
    '<span class="owner-header__name" id="customer-name"></span></a>' +
    '<div class="owner-header__tools">' +
    '<a class="owner-header__btn" href="#" data-route="customer-notifications" aria-label="Notifications">' + ICONS.bell + '<span class="owner-header__dot" id="notif-dot" hidden></span></a>' +
    "</div>";

  // Bottom navigation (phone): four tabs
  var bottom = document.createElement("nav");
  bottom.className = "owner-bottomnav";
  bottom.setAttribute("aria-label", "Main");
  bottom.innerHTML = NAV.map(function (n) { return navLink(n, "owner-tab"); }).join("");

  // The bell shows a pressed background when tapped and keeps it until Notifications opens
  var bell = header.querySelector('[data-route="customer-notifications"]');
  if (bell) bell.addEventListener("click", function () { bell.classList.add("is-pressed"); });
  window.addEventListener("pageshow", function () { if (bell) bell.classList.remove("is-pressed"); });   // back/forward cache

  app.insertBefore(sidebar, main);
  app.insertBefore(header, main);
  app.appendChild(bottom);

  // Name and initials for the header (from the mock session), and the profile photo when the customer has set one in Edit Profile
  function paintHeader() {
    var session = window.CrediTrackSession && window.CrediTrackSession.get();
    var fullName = session && session.role === "customer" ? session.name : "";
    var nameEl = document.getElementById("customer-name"), avatar = document.getElementById("customer-avatar");
    nameEl.textContent = fullName || "My Account";
    avatar.textContent = fullName
      ? fullName.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase()
      : "";
    var customerApi = window.CrediTrackCustomerApi;
    if (customerApi && customerApi.getProfile) customerApi.getProfile().then(function (profile) {
      if (!profile.photo) return;
      var img = document.createElement("img");
      img.src = profile.photo; img.alt = "";
      avatar.textContent = "";
      avatar.appendChild(img);
    });
  }
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

  paintHeader();
  // A page restored from the back/forward cache (for example Back from Edit Profile) shows the current name and photo
  window.addEventListener("pageshow", function (event) { if (event.persisted) paintHeader(); });
  if (window.CrediTrackCustomerApi && window.CrediTrackCustomerApi.getUnreadNotificationCount) {
    watchNotifications(function () { return window.CrediTrackCustomerApi.getUnreadNotificationCount(); }, "customer");
  }
})();
