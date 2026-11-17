/* CrediTrack: shared behavior and route map.
   Every page loads this file. Pages that are not built yet show a short
   "coming soon" message instead of navigating. */
(function () {
  "use strict";

  // Pages that exist so far, relative to the project root.
  // When a placeholder page is built, add its path here.
  var AVAILABLE_PAGES = {
    splash: "",
    welcome: "welcome",
    login: "login",
    "account-type": "account-type",
    "register-owner": "register-owner",
    "register-customer": "register-customer",
    "check-email": "check-email",
    "verify-email": "verify-email",
    "forgot-password": "forgot-password",
    "reset-password": "reset-password",
    "store-dashboard": "owner/dashboard",
    "owner-customers": "owner/customers",
    "owner-customers-debt": "owner/customers?filter=debt",
    "owner-customer-add": "owner/customer-form",
    "owner-transactions": "owner/transactions",
    "owner-reports": "owner/reports",
    "owner-notifications": "owner/notifications",
    "owner-payment-requests": "owner/payment-requests",
    "owner-payment-request": "owner/payment-request-details",
    "owner-overdue": "owner/overdue",
    "owner-settings": "owner/settings",
    "owner-profile-edit": "owner/profile-edit",
    "owner-store-info": "owner/store-information",
    "owner-store-qr": "owner/store-qr",
    "owner-security": "owner/security",
    "owner-settings-notifications": "owner/settings-notifications",
    "owner-help": "owner/help-support",
    "owner-about": "owner/about",
    // Customer Portal (sign-up lands on Home)
    "customer-dashboard": "customer/home",
    "customer-join-store": "customer/join-store",
    "customer-history": "customer/history",
    "customer-payments": "customer/payments",
    "customer-payment": "customer/request-payment",
    "customer-transaction": "customer/transaction-details",
    "customer-notifications": "customer/notifications",
    "customer-profile": "customer/profile",
    "customer-profile-edit": "customer/profile-edit",
    "customer-personal-info": "customer/personal-info",
    "customer-code": "customer/customer-code",
    "customer-security": "customer/security",
    "customer-settings-notifications": "customer/settings-notifications",
    "customer-help": "customer/help-support",
    "customer-about": "customer/about",
    "customer-stores": "customer/stores",
    // Record Utang is a floating modal (js/components/record-utang.js), not a page. On a page that does not load the
    // modal, this route opens the Dashboard and asks it to show the modal (?recordUtang=1).
    "record-credit": "owner/dashboard?recordUtang=1"
    // Placeholders (not built yet): forgot-password, dashboard, customer-dashboard,
    // and the Store Owner pages listed in PLACEHOLDER_MESSAGES below
  };

  var PLACEHOLDER_MESSAGES = {
    // Customer Portal pages the Home dashboard links to (built in later steps)
    // Pages behind the Profile menu (built in later steps; each will open with a Back button to Profile)
    "customer-store": "Store details are coming in the next step.",
    dashboard: "Log in works once accounts and dashboards are built.",
    // Store Owner pages (links live in js/components/owner-shell.js)
    "record-payment": "Record Bayad is coming in a later step."
  };

  // Every page sets data-root="/" on <body>: page routes (like owner/dashboard) are added to it.
  var root = document.body.getAttribute("data-root") || "";

  var toast = document.getElementById("toast");
  var timer;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(timer);
    timer = setTimeout(function () { toast.classList.remove("is-visible"); }, 2800);
  }

  // A route may carry a query string, for example "record-credit?customer=4" (Customer Details > Record Utang
  // opens the Record Utang modal with that customer already chosen).
  function goTo(route) {
    var parts = String(route).split("?");
    // Record Utang opens as a floating modal above the current page (no navigation).
    if (parts[0] === "record-credit" && window.RecordUtang) {
      window.RecordUtang.open({ customerId: new URLSearchParams(parts[1] || "").get("customer") });
      return;
    }
    // Record Bayad (payment) opens as a floating modal too.
    if (parts[0] === "record-payment" && window.RecordBayad) {
      window.RecordBayad.open({ customerId: new URLSearchParams(parts[1] || "").get("customer") });
      return;
    }
    // Make a Payment opens as a floating modal too (js/components/make-payment.js), with the store already chosen.
    if (parts[0] === "customer-payment" && window.MakePayment) {
      window.MakePayment.open({ store: new URLSearchParams(parts[1] || "").get("store") });
      return;
    }
    var page = AVAILABLE_PAGES[parts[0]];
    if (typeof page === "string") {
      var query = parts[1] ? (page.indexOf("?") === -1 ? "?" : "&") + parts[1] : "";
      window.location.href = root + page + query;
    } else {
      showToast(PLACEHOLDER_MESSAGES[parts[0]] || "This page is coming in the next step.");
    }
  }

  document.querySelectorAll("[data-route]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      // Log Out links carry data-logout: end the session first, then follow the route.
      if (link.hasAttribute("data-logout") && window.CrediTrackSession) window.CrediTrackSession.end();
      goTo(link.getAttribute("data-route"));
    });
  });

  // Show/hide password. Usage: <button type="button" data-toggle-password="inputId"> with
  // .icon-eye and .icon-eye-off inside. The icon is driven by aria-pressed in CSS:
  // hidden (aria-pressed="false") shows eye-off (slashed); visible shows eye.
  function setPasswordVisible(button, input, visible) {
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  }

  document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
    var input = document.getElementById(button.getAttribute("data-toggle-password"));
    if (!input) return;
    button.type = "button"; // never submits the form
    setPasswordVisible(button, input, input.type === "text");

    // Keep focus (and any blur validation) on the field while tapping the icon.
    button.addEventListener("mousedown", function (event) { event.preventDefault(); });
    button.addEventListener("click", function (event) {
      event.preventDefault();
      var start = input.selectionStart, end = input.selectionEnd;
      setPasswordVisible(button, input, input.type === "password");
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(start, end); } catch (e) { /* not supported */ }
    });
  });

  // Back/forward cache can restore a page with the field type and icon out of sync.
  window.addEventListener("pageshow", function () {
    document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
      var input = document.getElementById(button.getAttribute("data-toggle-password"));
      if (input) setPasswordVisible(button, input, input.type === "text");
    });
  });

  // ---- Back navigation (detail pages and subpages) ----
  // Goes to the exact page the person came from: browser history, so the earlier page keeps its
  // place (search, filter, scroll). Only when that is not possible (a bookmarked link, a new tab,
  // or a page opened from outside the app) does it use `fallback`, the page's logical parent.
  function cameFromOwnerPage() {
    if (window.history.length < 2 || !document.referrer) return false;
    try {
      var from = new URL(document.referrer);
      return from.origin === window.location.origin && /^\/owner\//.test(from.pathname);
    } catch (e) { return false; }
  }
  function goBack(fallback) {
    if (cameFromOwnerPage()) window.history.back();
    else window.location.href = fallback || (root + AVAILABLE_PAGES["store-dashboard"]);
  }

  // "back_forward" when the page was opened with the browser or on-screen Back/Forward button.
  function navType() {
    var entry = window.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (entry) return entry.type;
    return window.performance && performance.navigation && performance.navigation.type === 2 ? "back_forward" : "navigate";
  }

  // ---- One-time message for the next page ("Customer added.") ----
  // A page that saves something and then goes back calls flash(); the page it lands on shows the toast.
  var FLASH_KEY = "creditrack.flash";
  function flash(message) {
    try { window.sessionStorage.setItem(FLASH_KEY, message); } catch (e) { /* ignore */ }
  }
  function showFlash() {
    var message = null;
    try { message = window.sessionStorage.getItem(FLASH_KEY); window.sessionStorage.removeItem(FLASH_KEY); } catch (e) { /* ignore */ }
    if (message) showToast(message);
  }
  showFlash();
  // A page restored from the back/forward cache does not run its scripts again.
  window.addEventListener("pageshow", function (event) { if (event.persisted) showFlash(); });

  window.CrediTrack = { goTo: goTo, showToast: showToast, goBack: goBack, navType: navType, flash: flash };
})();
