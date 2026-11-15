/* Store Owner > Payment Requests (payment-requests), a main page. Mock data only.
   Lists the payment requests customers have sent, with Pending / Confirmed / Rejected / Voided / All filters. Each one opens
   Review Payment (payment-request-details?id=). Data comes from js/api/owner-api.js (CrediTrackApi). */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var PAGE_SIZE = 10;
  var state = { data: null, items: [], page: 1, status: "pending" };
  (function () {   // e.g. payment-requests?status=archived (from the dashboard link)
    var s = new URLSearchParams(window.location.search).get("status");
    if (["all", "pending", "confirmed", "rejected", "voided", "archived"].indexOf(s) >= 0) state.status = s;
  })();
  var pager = window.CrediTrackPager.create($("pager"), function (n) { return load(n); }, $("pr-list"));
  var requestSeq = 0;   // only the newest request may draw
  var STATUS = {
    pending:  { label: "Pending",  cls: "badge--pending" },
    confirmed: { label: "Confirmed", cls: "badge--success" },
    rejected: { label: "Rejected", cls: "badge--danger" },
    voided:   { label: "Voided",   cls: "badge--voided" }
  };
  var EMPTY = {
    pending:  ["Nothing to review", "You are all caught up. New payment requests will show up here."],
    confirmed: ["No confirmed payments yet", "Payments you confirm will be listed here."],
    rejected: ["No rejected payments", "Payments you reject will be listed here."],
    voided:   ["No voided payments", "Confirmed payments that you void will be listed here."],
    archived: ["No archived requests", "Reviewed requests you archive will be listed here. Nothing is deleted."],
    all:      ["No payment requests yet", "When a customer sends a payment for you to review, it will show up here."]
  };

  function peso(n) { return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text == null ? "" : text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function initials(name) { return String(name || "").split(" ").map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join(""); }
  function clock(iso) { return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); }); }
  function when(iso) {
    var d = new Date(iso), now = new Date(), minutes = Math.floor((now - d) / 60000);
    var days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (days === 0) return minutes < 1 ? "Just now" : minutes < 60 ? minutes + (minutes === 1 ? " minute ago" : " minutes ago") : "Today, " + clock(iso);
    if (days === 1) return "Yesterday, " + clock(iso);
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) + ", " + clock(iso);
  }

  function render() {
    var data = state.data;
    if (!data) return;
    var counts = data.counts;
    var none = counts.all === 0 && counts.archived === 0;
    $("status-chips").hidden = none;
    $("empty-none").hidden = !none;
    ["pending", "confirmed", "rejected", "voided", "all", "archived"].forEach(function (k) { $("count-" + k).textContent = counts[k]; });
    document.querySelectorAll("#status-chips [data-status]").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-status") === state.status));
    });
    $("page-sub").textContent = none ? "Review payments your customers say they made."
      : counts.pending ? counts.pending + (counts.pending === 1 ? " payment is" : " payments are") + " waiting for your review." : "No payments are waiting for your review.";

    // Archived requests only show under the Archived chip; every other chip leaves them out (the API applies that rule).
    var shown = state.items;
    pager.update(none ? { page: 1, totalPages: 1 } : data);
    $("pr-list").hidden = none || !shown.length;
    $("empty-filter").hidden = none || shown.length > 0;
    $("empty-filter-title").textContent = EMPTY[state.status][0];
    $("empty-filter-text").textContent = EMPTY[state.status][1];
    $("pr-list").innerHTML = shown.map(function (r) {
      var ps = r.paymentStatus, st = STATUS[ps] || STATUS.pending, pending = ps === "pending";
      var verb = { confirmed: "Confirmed ", rejected: "Rejected ", voided: "Voided " }[ps];
      var meta = esc(r.method) + (r.archived ? " · Archived" : "") + " · " + esc(pending ? when(r.submittedAt) : verb + when(ps === "voided" && r.voidInfo ? r.voidInfo.at : (r.reviewedAt || r.submittedAt)));
      return '<li class="pr-item pr-item--' + esc(r.paymentStatus) + '">' +
        '<div class="pr-item__top">' +
        '<span class="pr-item__avatar" aria-hidden="true">' + esc(initials(r.customer)) + "</span>" +
        '<span class="pr-item__main"><span class="pr-item__name">' + esc(r.customer) + '</span><span class="pr-item__meta">' + meta + "</span></span>" +
        '<span class="pr-item__side"><span class="pr-item__amount">' + peso(r.amount) + '</span><span class="badge ' + st.cls + '">' + st.label + "</span></span></div>" +
        '<a class="btn ' + (pending ? "btn--primary" : "btn--secondary") + '" href="payment-request-details?id=' + encodeURIComponent(r.id) + '" data-route="owner-payment-request?id=' + encodeURIComponent(r.id) + '" aria-label="' + (pending ? "Review payment from " : "View payment from ") + esc(r.customer) + '">' + (pending ? "Review Payment" : "View Details") + "</a></li>";
    }).join("");
    $("pr-list").querySelectorAll("[data-route]").forEach(function (link) {
      link.addEventListener("click", function (event) { event.preventDefault(); window.CrediTrack.goTo(link.getAttribute("data-route")); });
    });
  }

  $("status-chips").addEventListener("click", function (event) {
    var chip = event.target.closest("[data-status]");
    if (!chip) return;
    state.status = chip.getAttribute("data-status");
    load(true);
  });

  // The query this page sends. The names match the future API (GET /api/payment-requests?status=&page=&pageSize=).
  function currentQuery(page) { return { status: state.status, page: page, pageSize: PAGE_SIZE }; }
  // A number = that page; anything else (the status changed) = page 1
  function load(target) {
    var seq = ++requestSeq, page = typeof target === "number" ? target : 1;
    return api.queryPaymentRequests(currentQuery(page)).then(function (data) {
      if (seq !== requestSeq) return;
      // Open on Pending, but when nothing is pending show everything instead of an empty tab
      var first = !state.loaded, redirect = "";
      if (first) { state.loaded = true; if (!data.counts.pending && data.counts.all) redirect = "all"; }
      if (state.status === "archived" && !data.counts.archived) redirect = "all";
      if (redirect && state.status !== redirect) { state.status = redirect; return load(true); }
      state.data = data;
      state.page = data.page;
      state.items = data.items;
      render();
    }).catch(function (err) {
      window.CrediTrack.showToast(err && err.message ? err.message : "Could not load payment requests. Please try again.");
    });
  }
  load(true);
})();
