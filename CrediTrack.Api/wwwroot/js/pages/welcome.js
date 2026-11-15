/* Welcome screen guard. Loaded in <head>, before the page paints.
   - signed in, dashboard built -> straight to that dashboard
   - signed in, no dashboard    -> the launch screen explains and offers Log Out
   - signed out, fresh launch   -> the splash screen first, which then returns here
   - signed out, moving around  -> nothing happens; the page shows */
(function () {
  "use strict";

  var Session = window.CrediTrackSession;
  if (!Session) return;

  var session = Session.get();
  var destination = null;
  if (session) destination = Session.dashboardUrl(session.role, "/") || "/";
  else if (Session.splashDue()) destination = "/";

  if (destination) {
    document.documentElement.classList.add("is-redirecting");
    window.location.replace(destination);
  }
})();

/* Scroll reveal: sections and the footer stay hidden on load and fade in as they scroll into view.
   Also: the active link in the navbar. Without JavaScript everything simply shows. */
(function () {
  "use strict";
  var root = document.documentElement;
  var hasIO = "IntersectionObserver" in window;
  if (hasIO) root.classList.add("js-reveal");

  document.addEventListener("DOMContentLoaded", function () {
    if (hasIO) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
        });
      }, { threshold: 0.12 });
      document.querySelectorAll("[data-reveal]").forEach(function (el) { io.observe(el); });
    }

    /* Numbers in the hero card and the dashboard mockup count up the first time they scroll into view. */
    var counters = document.querySelectorAll("[data-count]");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function fmt(n, prefix) { return (prefix || "") + Math.round(n).toLocaleString("en-US"); }
    function run(el) {
      var end = parseFloat(el.getAttribute("data-count")), prefix = el.getAttribute("data-prefix") || "";
      if (reduce || !isFinite(end)) { el.textContent = fmt(end, prefix); return; }
      var start = null, dur = 1600;
      function tick(t) {
        if (start === null) start = t;
        var p = Math.min((t - start) / dur, 1), eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(end * eased, prefix);
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    if (hasIO && counters.length) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { run(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.6 });
      counters.forEach(function (el) { cio.observe(el); });
    }

    var menu = document.getElementById("lp-menu");

    if (menu) {
      var links = {};
      menu.querySelectorAll('a[href^="#"]').forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
      var sections = ["features", "how", "about"].map(function (id) { return document.getElementById(id); }).filter(Boolean);
      var spyQueued = false;

      /* The active link is the last section whose top has reached the navbar. Measuring from the navbar (not the
         middle of the screen) keeps the clicked link highlighted even for short sections on tall screens. */
      function spy() {
        spyQueued = false;
        var line = menu.getBoundingClientRect().bottom + 32;
        var atEnd = window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2;
        var current = atEnd && sections.length ? sections[sections.length - 1].id : null;
        if (!atEnd) sections.forEach(function (el) { if (el.getBoundingClientRect().top <= line) current = el.id; });
        Object.keys(links).forEach(function (k) { links[k].classList.toggle("is-active", k === current); });
      }
      function queueSpy() { if (!spyQueued) { spyQueued = true; window.requestAnimationFrame(spy); } }
      window.addEventListener("scroll", queueSpy, { passive: true });
      window.addEventListener("resize", queueSpy);
      spy();
    }
  });
})();
