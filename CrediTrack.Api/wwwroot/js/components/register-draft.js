/* CrediTrack: keeps a half-filled registration form while the person reads the Terms and Conditions or Privacy Policy.
   Both registration pages open the policies in the SAME tab (a link with data-legal), so Back has a page to
   return to. Just before leaving, the form is saved to sessionStorage (this tab only); when the registration page
   loads again it is filled back in.

   Rules:
   - Passwords (any type="password" field) are NEVER saved, so they must be typed again.
   - The draft is removed after a successful registration or when the person leaves on purpose
     (Back to account type, Log in). Closing the tab also removes it (sessionStorage).
   - A draft is only used when the page is reached by going Back/Forward/Reload or coming back from a policy
     page, never when someone starts a new registration from the Account Type page. It also expires. */
(function () {
  "use strict";

  var PREFIX = "creditrack.regdraft.v1:";
  var MAX_AGE_MS = 30 * 60 * 1000;
  var LEGAL_PATH = /^\/(terms|privacy)\/?$/;

  function read(key) {
    try {
      var raw = window.sessionStorage.getItem(PREFIX + key);
      var draft = raw ? JSON.parse(raw) : null;
      if (draft && typeof draft.savedAt === "number" && Date.now() - draft.savedAt <= MAX_AGE_MS) return draft;
      if (draft) window.sessionStorage.removeItem(PREFIX + key);
    } catch (e) { /* storage blocked or corrupt */ }
    return null;
  }
  function write(key, draft) {
    try { window.sessionStorage.setItem(PREFIX + key, JSON.stringify(draft)); } catch (e) { /* storage blocked */ }
  }
  function remove(key) {
    try { window.sessionStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  function isSensitive(el) { return el.type === "password"; }
  function isSavable(el) {
    return el.id && !isSensitive(el) && el.type !== "hidden" && el.type !== "button" && el.type !== "submit" && el.type !== "file" &&
      (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
  }

  function snapshot(form) {
    var values = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!isSavable(el)) return;
      values[el.id] = el.type === "checkbox" || el.type === "radio" ? !!el.checked : el.value;
    });
    return values;
  }

  // True when this load should bring a saved draft back (see the rules at the top).
  function shouldRestore() {
    var type = window.CrediTrack && window.CrediTrack.navType ? window.CrediTrack.navType() : "navigate";
    if (type === "back_forward" || type === "reload") return true;
    try {
      var from = document.referrer ? new URL(document.referrer) : null;
      return !!from && from.origin === window.location.origin && LEGAL_PATH.test(from.pathname);
    } catch (e) { return false; }
  }

  /* options:
       key      draft name, one per registration form ("customer", "owner")
       form     the <form> element
       getStep  () => current step number
       apply    (values, step) => void   put values back into the fields (it may be async) and show the step
     returns { save, clear } */
  function init(options) {
    var key = options.key;
    var form = options.form;

    function save() {
      write(key, { savedAt: Date.now(), step: options.getStep(), values: snapshot(form) });
    }
    function clear() { remove(key); }

    // Policy links: save, then open in this tab. Ctrl/Cmd/Shift/middle click keep their normal browser meaning.
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a[data-legal]") : null;
      if (!link || !form.contains(link)) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      save();
    });

    // Leaving on purpose throws the draft away.
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a[data-discard-draft]") : null;
      if (link) clear();
    });

    // Bring the draft back. A page restored from the back/forward cache still has its fields, so only a fresh load needs it.
    var draft = read(key);
    if (draft && draft.values && shouldRestore()) {
      options.apply(draft.values, draft.step);
    } else if (draft) {
      remove(key);   // a new registration was started: do not show old answers
    }

    return { save: save, clear: clear };
  }

  window.CrediTrackDraft = { init: init };
})();
