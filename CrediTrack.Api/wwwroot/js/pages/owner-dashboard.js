/* Store Owner dashboard page.
   Shows the owner's REAL records (none for a new account) or, in demo mode,
   clearly labelled SAMPLE data. All data comes from js/api/owner-api.js. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var ICONS = window.CrediTrackIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var PREVIEW = 3;     // payment requests shown in the Dashboard preview (the rest are on the Payment Requests page)

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function ago(iso) {
    var minutes = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (minutes < 60) return minutes + " min ago";
    var h = Math.floor(minutes / 60);
    return h + (h === 1 ? " hr ago" : " hrs ago");
  }
  // "Today, 9:42 AM", "Yesterday, 5:30 PM", "Oct 28"
  function when(iso) {
    var d = new Date(iso), now = new Date();
    var days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    var time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
    if (days === 0) return "Today, " + time;
    if (days === 1) return "Yesterday, " + time;
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  }
  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  // Links added after main.js ran need their own click handler.
  function bindRoutes(container) {
    container.querySelectorAll("[data-route]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        window.CrediTrack.goTo(link.getAttribute("data-route"));
      });
    });
  }

  function renderNotice(data) {
    var box = $("dash-notice");
    var isEmpty = !data.totalCustomers && !data.recentTransactions.length && !data.pendingPayments.length && !(data.recentReviewed || []).length;
    if (isEmpty) {
      box.className = "dash__notice notice notice--tip";
      box.innerHTML = '<p><strong>Your store is all set up.</strong> Your numbers will appear here as you add customers and record credit.</p>';
      box.hidden = false;
    } else {
      box.hidden = true;
      box.className = "dash__notice";      // drop the error / demo look so .notice cannot override [hidden]
    }
  }

  function render(data) {
    renderNotice(data);

    // Balance and the two quick numbers
    $("balance-amount").textContent = peso(data.outstandingBalance);
    $("balance-note").textContent = data.totalCustomers
      ? "Owed by " + data.customersWithDebt + (data.customersWithDebt === 1 ? " customer" : " customers")
      : "No customers yet";
    $("debt-count").textContent = data.customersWithDebt;
    $("debt-sub").textContent = data.totalCustomers ? "of " + data.totalCustomers + " customers" : "No customers yet";
    $("overdue-count").textContent = data.overdueCount;
    $("overdue-sub").textContent = data.overdueCount ? "Past due date" : "None past due";

    // Payment Requests panel: a count badge, the 3 newest requests waiting (tap one to review it) and a Review all button.
    // Approve / Reject, the reviewed and the archived requests are on the Payment Requests page, so this stays short.
    var waiting = data.pendingPaymentCount != null ? data.pendingPaymentCount : data.pendingPayments.length;
    var preview = data.pendingPayments.slice(0, PREVIEW);
    $("pending-badge").hidden = !waiting;
    $("pending-badge").textContent = waiting;
    $("pending-badge").setAttribute("aria-label", waiting + (waiting === 1 ? " request waiting" : " requests waiting"));
    $("pending-none").hidden = waiting > 0;
    $("pending-review").hidden = !waiting;
    $("pending-review").textContent = waiting > preview.length ? "Review all requests (" + waiting + ")" : waiting > 1 ? "Review requests" : "Review request";
    $("pending-past").hidden = waiting > 0;      // nothing waiting: a quiet link to the older ones instead of the big button
    $("pending-list").hidden = !preview.length;
    $("pending-list").innerHTML = preview.map(function (p) {
      // The whole row is a real link to that request's Review Payment page: it works even if a script is missing or out of date.
      return '<li class="pending-item"><a class="pending-item__top pending-item__link" href="payment-request-details?id=' + encodeURIComponent(p.id) + '" aria-label="Review payment from ' + esc(p.customer) + '">' +
        '<span class="pending-item__avatar" aria-hidden="true">' + (ICONS.profile || "") + "</span>" +
        '<span class="pending-item__main"><span class="pending-item__name">' + esc(p.customer) + "</span>" +
        '<span class="pending-item__meta">' + esc(p.method) + " · " + ago(p.submittedAt) + "</span></span>" +
        '<span class="pending-item__amount">' + peso(p.amount) + "</span></a></li>";
    }).join("");

    // Recent transactions (or the empty state)
    var has = data.recentTransactions.length > 0;
    $("tx-list").hidden = !has;
    $("tx-link").hidden = !has;
    $("tx-empty").hidden = has;
    $("tx-list").innerHTML = data.recentTransactions.map(function (t) {
      var isPayment = t.type === "payment";
      var detail = isPayment ? "Payment · " + t.method : "Credit · " + t.note;
      return '<li class="list__row list__row--link' + (t.voided ? " is-voided" : "") + '"><a class="list__link" href="transaction-details?id=' + encodeURIComponent(t.id) + '">' +
        '<span class="tx-icon tx-icon--' + t.type + '" aria-hidden="true">' + (ICONS[isPayment ? "payment" : "credit"] || "") + "</span>" +
        '<span class="list__main"><span class="list__name">' + esc(t.customer) + (t.voided ? '<span class="void-tag">Voided</span>' : "") + "</span>" +
        '<span class="list__meta">' + esc(detail) + " · " + when(t.date) + "</span></span>" +
        '<span class="list__amount' + (isPayment ? " list__amount--in" : "") + '">' + (isPayment ? "+" : "") + peso(t.amount) + "</span></a></li>";
    }).join("");
  }

  // Loading and error states: the first load shows "…" in the numbers; a failed load says so with a Try again button
  var loaded = false;
  function failText(err) {
    return err && err.status === 401 ? "Your session has expired. Please log in again." : (err && err.message) || "The dashboard could not be loaded. Please try again.";
  }
  function showError(err) {
    var box = $("dash-notice");
    box.className = "dash__notice notice notice--demo";
    box.innerHTML = '<p><strong>Could not load your dashboard.</strong> ' + esc(failText(err)) + '</p>' +
      '<button class="btn" type="button" id="dash-retry">Try again</button>';
    box.hidden = false;
  }
  function load() {
    api.getOwner().then(function (owner) {
      $("welcome-title").textContent = greeting() + (owner.firstName ? ", " + owner.firstName : "") + "!";
    });
    $("dash").setAttribute("aria-busy", "true");
    if (!loaded) { $("balance-amount").textContent = "…"; $("debt-count").textContent = "…"; $("overdue-count").textContent = "…"; }
    api.getOwnerDashboard().then(function (data) {
      loaded = true; $("dash").setAttribute("aria-busy", "false"); render(data);
    }, function (err) {
      $("dash").setAttribute("aria-busy", "false");
      if (!loaded) { $("balance-amount").textContent = peso(0); $("debt-count").textContent = "0"; $("overdue-count").textContent = "0"; }
      showError(err);
    });
  }

  // The Try again button of the error notice
  $("dash-notice").addEventListener("click", function (event) {
    var btn = event.target.closest("button");
    if (btn && btn.id === "dash-retry") load();
  });

  // ---- Utang vs Bayad chart: the last 6 months, from the same report data as the Reports page ----
  function isoDay(d) { return d.getFullYear() + "-" + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); }
  var chartMonths = null;
  function drawChart() {
    if (!chartMonths) return;
    var drawn = window.CrediTrackChart.render($("chart"), chartMonths, { title: "Utang versus Bayad, last 6 months" });
    $("chart").hidden = !drawn;
    $("chart-legend").hidden = !drawn;
    $("chart-empty").hidden = drawn;
    $("chart-error").hidden = true;
    $("chart-table").querySelector("tbody").innerHTML = chartMonths.map(function (m) {
      return "<tr><th scope=\"row\">" + esc(m.title) + "</th><td>" + peso(m.utang) + "</td><td>" + peso(m.bayad) + "</td></tr>";
    }).join("");
  }
  function loadChart() {
    var now = new Date();
    var spec = { key: "custom", start: isoDay(new Date(now.getFullYear(), now.getMonth() - 5, 1)), end: isoDay(now), page: 1, pageSize: 1 };
    api.getReportsOverview(spec).then(function (report) {
      chartMonths = (report.months || []).slice(-6);
      drawChart();
    }, function () {
      $("chart").hidden = true; $("chart-legend").hidden = true; $("chart-empty").hidden = true; $("chart-error").hidden = false;
    });
  }
  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 150); });

  bindRoutes($("tx-empty"));
  bindRoutes($("chart-panel"));
  load();
  loadChart();
})();
