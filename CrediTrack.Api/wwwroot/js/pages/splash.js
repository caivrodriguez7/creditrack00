/* Splash screen: runs on every launch (index, or via the Welcome guard), then routes by sign-in status.
     signed out              -> welcome
     signed in, dashboard    -> that role's dashboard
     signed in, no dashboard -> stays here with a clear message and a Log Out button
   The wait is short (about 1.6s) and always plays in full: there is no way to skip it.
   It runs on every screen size; the only things that change are the layout in splash.css. */
(function () {
  "use strict";

  var Session = window.CrediTrackSession;
  var logos = Array.prototype.slice.call(document.querySelectorAll(".splash__logo"));
  var logo = logos.filter(function (i) { return i.offsetParent !== null; })[0] || document.getElementById("splash-logo");
  var statusText = document.getElementById("splash-status");
  var actions = document.getElementById("splash-actions");
  var logoutButton = document.getElementById("splash-logout");

  // Same length on every device. Reduced motion only removes movement (see splash.css); the
  // screen still stays long enough to be seen, so phones with "remove animations" on are not skipped.
  var SHOW_MS = 1600;

  var session = Session ? Session.get() : null;
  var target = session ? Session.dashboardUrl(session.role, "/") : "/welcome";
  var finished = false;
  var timer;

  // Visibility of system status: say what is about to happen.
  if (session) {
    var name = Session.firstName(session);
    statusText.textContent = (name ? "Welcome back, " + name + ". " : "Welcome back. ") +
      (target ? "Opening your dashboard…" : "");
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    // Signed out: leave a one-time note so Welcome does not send us straight back (no loop).
    if (Session && !session) Session.markSplash();
    if (target) { window.location.replace(target); return; }
    showPending();
  }

  // Signed in, but this role's dashboard is not built yet: do not loop or hide the session.
  function showPending() {
    document.body.classList.add("is-pending");
    statusText.textContent = "Welcome back" + (session && Session.firstName(session) ? ", " + Session.firstName(session) : "") +
      ". Your customer dashboard is coming in a later step.";
    actions.hidden = false;
    logoutButton.focus();
  }

  logoutButton.addEventListener("click", function () {
    Session.end();
    window.location.replace("/welcome");
  });

  // Start the clock once the logo can be seen, so the reveal is never cut short.
  function play() {
    if (document.body.classList.contains("is-playing")) return;
    document.body.classList.add("is-playing");
    timer = setTimeout(finish, SHOW_MS);
  }
  if (logo.complete) play();
  else { logo.addEventListener("load", play); logo.addEventListener("error", play); setTimeout(play, 1200); }
  document.addEventListener("DOMContentLoaded", function () { if (logo.complete) play(); });

  // Back/forward cache: coming back to a finished splash should run again.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) window.location.reload();
  });
})();
