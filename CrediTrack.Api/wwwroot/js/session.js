/* CrediTrack: mock session (frontend only, no backend yet).
   One small place that knows whether someone is signed in and which dashboard they belong to.
   Pages call window.CrediTrackSession; nothing else reads the storage key directly.
   The password is never stored. When the ASP.NET Core API exists, replace start/end/get
   with calls that use the real token (for example an HTTP-only cookie). */
(function () {
  "use strict";

  var KEY = "creditrack.session";
  var ROLES = ["owner", "customer"];

  // Dashboards that are built, relative to the project root. A role set to null has no
  // dashboard yet.
  var DASHBOARDS = {
    owner: "owner/dashboard",
    customer: "customer/home"
  };

  // localStorage can be blocked (private windows), so fall back to memory.
  var memory = null;
  function read() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return memory; }
  }
  function write(value) {
    try {
      if (value === null) window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, value);
    } catch (e) { memory = value; }
  }

  // "Remember me" off: the server issues a session cookie that disappears when the browser closes.
  // The saved session below lives in localStorage, so a small session cookie (no expiry, shared by all tabs,
  // gone when the browser closes) marks that the same browser session is still running.
  var BROWSER_MARK = "creditrack.browser=1";
  function markBrowserSession() {
    try {
      document.cookie = BROWSER_MARK + "; path=/; SameSite=Lax";
      return document.cookie.indexOf(BROWSER_MARK) !== -1;
    } catch (e) { return false; }
  }
  function browserSessionAlive() {
    try { return document.cookie.indexOf(BROWSER_MARK) !== -1; } catch (e) { return true; }
  }

  // Returns { role, name, startedAt } or null. Anything unexpected counts as signed out.
  function get() {
    try {
      var session = JSON.parse(read());
      if (!session || ROLES.indexOf(session.role) === -1) return null;
      if (session.temporary && !browserSessionAlive()) { write(null); return null; }   // browser was closed
      return session;
    } catch (e) { return null; }
  }

  function start(details) {
    if (!details || ROLES.indexOf(details.role) === -1) return null;
    var session = { role: details.role, name: String(details.name || "").trim(), startedAt: Date.now() };
    if (details.remember === false && markBrowserSession()) session.temporary = true;   // ends with the browser session
    write(JSON.stringify(session));
    return session;
  }

  // Older builds had a sample-data demo. Remove anything it left in this browser so it can never show up again.
  function purgeLegacyDemo() {
    [window.localStorage, window.sessionStorage].forEach(function (store) {
      try {
        Object.keys(store)
          .filter(function (k) { return k.indexOf("creditrack.demo") === 0 || k.indexOf("creditrack.customer.demo") === 0; })
          .forEach(function (k) { store.removeItem(k); });
      } catch (e) { /* storage is not available */ }
    });
  }
  purgeLegacyDemo();

  function end() {
    var current = get();
    // Also sign out on the server (removes the login cookie).
    // keepalive lets the request finish even if the page changes right away.
    if (current) {
      fetch((window.location.port === "5500" ? "http://localhost:5224" : "") + "/api/auth/logout", { method: "POST", credentials: "include", keepalive: true, headers: { "X-Requested-With": "CrediTrack" } })
        .catch(function () { /* the API may be offline: the browser session is still cleared below */ });
    }
    write(null);
  }

  // Path to the role's dashboard, prefixed with `root` (pass "/").
  // Returns null when that dashboard is not built yet.
  function dashboardUrl(role, root) {
    return DASHBOARDS[role] ? (root || "") + DASHBOARDS[role] : null;
  }

  function firstName(session) {
    return session && session.name ? session.name.split(/\s+/)[0] : "";
  }

  // ---- Launch screen helpers ----
  // The splash plays on every launch. A page asks splashDue() "should the splash run first?":
  //   yes: a fresh visit (new tab, bookmark, link from outside the app) or a reload, on any screen size
  //   no:  moving around inside the app, and the one arrival that comes straight from the splash itself
  // The splash leaves a one-time hand-off note (markSplash) just before it opens the Welcome screen.
  // splashDue() reads and removes that note, so it only ever skips ONE load. Reloading Welcome
  // (for example after switching to a phone-sized window) therefore always shows the splash again.
  var SPLASH_KEY = "creditrack.splash";
  var HANDOFF_MS = 15000;                                   // a stale note is ignored
  function markSplash() {
    try { window.sessionStorage.setItem(SPLASH_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }
  function isReload() {
    var nav = window.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (nav) return nav.type === "reload";
    return !!(window.performance && performance.navigation && performance.navigation.type === 1);   // older Safari
  }
  function splashDue() {
    if (!/^https?:$/.test(window.location.protocol)) return false;
    try {
      var note = Number(window.sessionStorage.getItem(SPLASH_KEY));
      window.sessionStorage.removeItem(SPLASH_KEY);          // one-time: consumed here
      if (note && Date.now() - note < HANDOFF_MS) return false;
    } catch (e) { return false; }                            // storage blocked: never risk a loop
    if (isReload()) return true;
    var ref = document.referrer;
    return !(ref && ref.indexOf(window.location.origin) === 0);   // came from outside the app
  }

  window.CrediTrackSession = {
    get: get, start: start, end: end, markSplash: markSplash, splashDue: splashDue,
    isAuthenticated: function () { return get() !== null; },
    dashboardUrl: dashboardUrl, firstName: firstName
  };
})();
