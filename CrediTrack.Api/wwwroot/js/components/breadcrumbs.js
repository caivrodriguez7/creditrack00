/* Breadcrumbs (window.CrediTrackBreadcrumbs).
   Adds a trail like  Dashboard > Customers > Customer Details  at the top of every sub-page of the Store Owner and Customer portals.
   The trail comes from the page's address (location.pathname), so no page has to describe itself. Each earlier step is a link;
   the last one is the current page (aria-current="page"). The main pages (Owner Dashboard, Customer Home) get no trail.

   Add a page: add one line to TRAILS below. Each step is [label, address]; the last step needs no address. */
(function () {
  "use strict";

  var OWNER_HOME = ["Home", "/owner/dashboard"];
  var CUSTOMER_HOME = ["Home", "/customer/home"];
  var O_CUSTOMERS = ["Customers", "/owner/customers"];
  var O_TRANSACTIONS = ["Transactions", "/owner/transactions"];
  var O_REQUESTS = ["Payment Requests", "/owner/payment-requests"];
  var O_SETTINGS = ["Settings", "/owner/settings"];
  var C_PROFILE = ["Profile", "/customer/profile"];
  var C_HISTORY = ["History", "/customer/history"];
  var C_PAYMENTS = ["Payments", "/customer/payments"];

  var TRAILS = {
    // Store Owner
    "/owner/customers":             [OWNER_HOME, ["Customers"]],
    "/owner/customer-details":      [OWNER_HOME, O_CUSTOMERS, ["Customer Details"]],
    "/owner/customer-form":         [OWNER_HOME, O_CUSTOMERS, ["Add / Edit Customer"]],
    "/owner/transactions":          [OWNER_HOME, ["Transactions"]],
    "/owner/transaction-details":   [OWNER_HOME, O_TRANSACTIONS, ["Transaction Details"]],
    "/owner/transaction-edit":      [OWNER_HOME, O_TRANSACTIONS, ["Edit Transaction"]],
    "/owner/payment-requests":      [OWNER_HOME, ["Payment Requests"]],
    "/owner/payment-request-details": [OWNER_HOME, O_REQUESTS, ["Request Details"]],
    "/owner/overdue":               [OWNER_HOME, ["Overdue Accounts"]],
    "/owner/reports":               [OWNER_HOME, ["Reports"]],
    "/owner/notifications":         [OWNER_HOME, ["Notifications"]],
    "/owner/settings":              [OWNER_HOME, ["Settings"]],
    "/owner/profile-edit":          [OWNER_HOME, O_SETTINGS, ["Edit Profile"]],
    "/owner/store-information":     [OWNER_HOME, O_SETTINGS, ["Store Information"]],
    "/owner/store-qr":              [OWNER_HOME, O_SETTINGS, ["Store QR Code"]],
    "/owner/security":              [OWNER_HOME, O_SETTINGS, ["Security"]],
    "/owner/settings-notifications": [OWNER_HOME, O_SETTINGS, ["Notification Settings"]],
    "/owner/help-support":          [OWNER_HOME, O_SETTINGS, ["Help & Support"]],
    "/owner/about":                 [OWNER_HOME, O_SETTINGS, ["About CrediTrack"]],

    // Customer
    "/customer/history":            [CUSTOMER_HOME, ["History"]],
    "/customer/transaction-details": [CUSTOMER_HOME, C_HISTORY, ["Transaction Details"]],
    "/customer/payments":           [CUSTOMER_HOME, ["Payments"]],
    "/customer/payment-request-details": [CUSTOMER_HOME, C_PAYMENTS, ["Payment Details"]],
    "/customer/request-payment":    [CUSTOMER_HOME, C_PAYMENTS, ["Request Payment"]],
    "/customer/join-store":         [CUSTOMER_HOME, ["Join a Store"]],
    "/customer/notifications":      [CUSTOMER_HOME, ["Notifications"]],
    "/customer/profile":            [CUSTOMER_HOME, ["Profile"]],
    "/customer/profile-edit":       [CUSTOMER_HOME, C_PROFILE, ["Edit Profile"]],
    "/customer/stores":             [CUSTOMER_HOME, C_PROFILE, ["My Stores"]],
    "/customer/customer-code":      [CUSTOMER_HOME, C_PROFILE, ["My Customer Code"]],
    "/customer/security":           [CUSTOMER_HOME, C_PROFILE, ["Security"]],
    "/customer/settings-notifications": [CUSTOMER_HOME, C_PROFILE, ["Notification Settings"]],
    "/customer/help-support":       [CUSTOMER_HOME, C_PROFILE, ["Help & Support"]],
    "/customer/about":              [CUSTOMER_HOME, C_PROFILE, ["About CrediTrack"]]
  };

  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // "/owner/customers/" and "/Owner/Customers" both find "/owner/customers"
  function keyOf(path) {
    return String(path || "").toLowerCase().replace(/\/+$/, "");
  }

  function build(trail) {
    var nav = document.createElement("nav");
    nav.className = "breadcrumbs";
    nav.setAttribute("aria-label", "Breadcrumb");
    var items = trail.map(function (step, i) {
      var last = i === trail.length - 1;
      return last
        ? '<li class="breadcrumbs__item"><span aria-current="page">' + esc(step[0]) + "</span></li>"
        : '<li class="breadcrumbs__item"><a href="' + esc(step[1]) + '">' + esc(step[0]) + "</a></li>";
    });
    nav.innerHTML = '<ol class="breadcrumbs__list">' + items.join("") + "</ol>";
    return nav;
  }

  function init() {
    var trail = TRAILS[keyOf(window.location.pathname)];
    if (!trail || document.querySelector(".breadcrumbs")) return;
    var main = document.getElementById("main");
    if (!main) return;
    var host = main.querySelector(":scope > .page") || main.firstElementChild || main;   // the page's own column, so it lines up with the content
    host.insertBefore(build(trail), host.firstChild);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.CrediTrackBreadcrumbs = { trails: TRAILS, init: init };
})();
