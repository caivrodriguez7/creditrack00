/* Terms and Conditions and Privacy Policy: Back behavior when opened from a registration page.
   The registration pages link here with ?from=register-customer or ?from=register-owner. Only then does this
   script do anything; opened from the landing page (no "from") the pages keep their original Back behavior.

   - Back (the on-page button) returns to the registration page. That page refills the form (see
     components/register-draft.js).
   - Switching between Terms and Privacy REPLACES the current history entry instead of adding one, so the browser's
     Back button and the on-page Back button both land on the registration page, not on the other policy.
   - "from" is checked against a fixed list, so it can never send someone to another site. */
(function () {
  "use strict";

  var SOURCES = { "register-customer": "/register-customer", "register-owner": "/register-owner" };
  var from = new URLSearchParams(window.location.search).get("from");
  if (!from || !Object.prototype.hasOwnProperty.call(SOURCES, from)) {
    // Opened from the landing page: Back goes to the previous page, or to /welcome (the link's own address) when there is none.
    // (This used to be an inline onclick, which the Content-Security-Policy does not allow.)
    var plainBack = document.querySelector(".legal__back");
    if (plainBack) plainBack.addEventListener("click", function (event) {
      if (window.history.length > 1) { event.preventDefault(); window.history.back(); }
    });
    return;
  }
  var target = SOURCES[from];
  var POLICY_PATH = /^\/(terms|privacy)\/?$/;

  // Is the page before this one (in this tab) the registration page or the other policy page?
  function cameFromFlow() {
    if (window.history.length < 2 || !document.referrer) return false;
    try {
      var ref = new URL(document.referrer);
      return ref.origin === window.location.origin && (ref.pathname === target || POLICY_PATH.test(ref.pathname));
    } catch (e) { return false; }
  }

  var back = document.querySelector(".legal__back");
  if (back) {
    back.setAttribute("href", target);
    back.removeAttribute("onclick");   // replaces the landing-page behavior that falls back to /welcome
    back.addEventListener("click", function (event) {
      event.preventDefault();
      if (cameFromFlow()) window.history.back(); else window.location.replace(target);
    });
  }

  // Terms <-> Privacy links (in the text and in the footer) keep "from" and replace this history entry.
  document.querySelectorAll('a[href="/terms"], a[href="/privacy"]').forEach(function (link) {
    var url = link.getAttribute("href") + "?from=" + encodeURIComponent(from);
    link.setAttribute("href", url);
    link.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.location.replace(url);
    });
  });
})();
