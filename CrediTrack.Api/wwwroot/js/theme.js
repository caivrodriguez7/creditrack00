/* CrediTrack theme (Light, Dark or Follow device).
   This file is loaded in the <head> on every page, BEFORE the stylesheets paint, so the right colors are in place
   from the first frame (no flash of the wrong theme).
   - The choice is saved in this browser only (localStorage key "creditrack.theme": "light", "dark" or "system").
   - <html data-theme="light|dark"> is what the CSS reads (css/theme.css). data-theme-pref keeps what the person chose.
   - window.CrediTheme: get() -> "light" | "dark" | "system", resolved() -> "light" | "dark", set(pref). */
(function () {
  "use strict";

  var KEY = "creditrack.theme";
  var PREFS = ["light", "dark", "system"];
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var memory = null;

  function read() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return memory; }   // storage can be blocked
  }
  function write(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { memory = value; }
  }

  function get() {
    var saved = read();
    return PREFS.indexOf(saved) === -1 ? "system" : saved;
  }
  function resolve(pref) {
    if (pref === "light" || pref === "dark") return pref;
    return query && query.matches ? "dark" : "light";
  }

  // The browser's own bar (address bar on phones) follows the page.
  function paintBar(theme) {
    var bar = document.querySelector('meta[name="theme-color"][data-theme-bar]');
    if (!bar) {
      var all = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < all.length; i++) all[i].parentNode.removeChild(all[i]);   // pages ship one fixed color; replace it
      bar = document.createElement("meta");
      bar.name = "theme-color"; bar.setAttribute("data-theme-bar", "");
      document.head.appendChild(bar);
    }
    bar.content = theme === "dark" ? "#0a1426" : "#ffffff";
  }

  function apply() {
    var pref = get(), theme = resolve(pref);
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-pref", pref);
    root.style.colorScheme = theme;
    if (document.head) paintBar(theme);
    return theme;
  }

  function set(pref) {
    if (PREFS.indexOf(pref) === -1) pref = "system";
    write(pref);
    var theme = apply();
    try { window.dispatchEvent(new CustomEvent("creditheme", { detail: { pref: pref, theme: theme } })); } catch (e) {}
  }

  window.CrediTheme = { get: get, set: set, resolved: function () { return resolve(get()); } };

  /* Text size (Small / Default / Large / Extra large): saved in this browser only (localStorage key "creditrack.textsize").
     <html data-text-size="..."> is what css/theme.css reads; everything is sized in rem, so the whole app scales together.
     window.CrediTextSize: get() -> "small" | "default" | "large" | "xlarge", set(size). */
  var SIZE_KEY = "creditrack.textsize";
  var SIZES = ["small", "default", "large", "xlarge"];
  var sizeMemory = null;
  function readSize() {
    var saved;
    try { saved = window.localStorage.getItem(SIZE_KEY); } catch (e) { saved = sizeMemory; }
    return SIZES.indexOf(saved) === -1 ? "default" : saved;
  }
  function applySize() { root.setAttribute("data-text-size", readSize()); }
  window.CrediTextSize = {
    get: readSize,
    set: function (size) {
      if (SIZES.indexOf(size) === -1) size = "default";
      try { window.localStorage.setItem(SIZE_KEY, size); } catch (e) { sizeMemory = size; }
      applySize();
      try { window.dispatchEvent(new CustomEvent("credittextsize", { detail: { size: size } })); } catch (e) {}
    }
  };
  applySize();
  window.addEventListener("storage", function (e) { if (e.key === SIZE_KEY) applySize(); });

  apply();

  // "Follow device" keeps up when the phone switches at sunset
  var onSystemChange = function () { if (get() === "system") apply(); };
  if (query) {
    if (query.addEventListener) query.addEventListener("change", onSystemChange);
    else if (query.addListener) query.addListener(onSystemChange);
  }
  // Another tab changed the setting
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(); });
  // The <head> may not exist yet on first run: set the bar color when it does
  if (!document.head) document.addEventListener("DOMContentLoaded", apply);
})();
