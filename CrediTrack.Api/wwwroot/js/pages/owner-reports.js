/* Store Owner > Reports overview (reports).
   Shows the selected reporting period with its filters (This Week, This Month, Last Month, This Year, Custom Date Range),
   four summary cards (Total Utang, Total Bayad, Outstanding Balance, Overdue Balance), a simple Utang-vs-Bayad chart by
   month and, below it, the Detailed Transactions table (every Utang and confirmed Bayad in the period, newest first).
   The Export Report button (PDF / CSV) lives in js/components/report-export.js and exports the selected period.
   There is no Recent Transactions preview here: the Transactions page already covers that.
   Every number comes from CrediTrackApi.getReportsOverview(period): GET /api/owner/reports for real accounts (the table loads
   20 rows at a time from the API), the local sample data in demo mode. Nothing is hard-coded.
   The chart is drawn as plain SVG (no chart library is needed for two bars per month). */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var ICONS = window.CrediTrackIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var VIEW_KEY = "creditrack.reports.view";

  var data = null;
  // The period being shown. Custom ranges also keep their dates.
  var period = { key: "month", start: "", end: "" };
  // Detailed table: rows are shown 20 at a time. The count starts again whenever the period changes.
  var ROWS_PER_STEP = 10;
  var tablePage = 1;          // the page of the Detailed Transactions table that is open
  var pager = window.CrediTrackPager.create(document.getElementById("pager"), function (n) { return goPage(n); }, document.getElementById("detail-sub"));
  var shownPeriodKey = "";

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoDay(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function dayText(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  function timeText(iso) {
    return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); });
  }
  function periodKey(p) { return [p.key, p.start || "", p.end || ""].join("|"); }
  function rangeText(p) {
    var a = new Date(p.start), b = new Date(p.end);
    var short = { month: "short", day: "numeric" }, full = { month: "short", day: "numeric", year: "numeric" };
    if (a.getFullYear() !== b.getFullYear()) return a.toLocaleDateString("en-PH", full) + " – " + b.toLocaleDateString("en-PH", full);
    return a.toLocaleDateString("en-PH", short) + " – " + b.toLocaleDateString("en-PH", full);
  }

  // ---- Summary cards and period ----
  function renderSummary() {
    var range = rangeText(data.period);
    $("period-name").textContent = data.period.label;
    $("period-range").textContent = range;
    $("period-live").textContent = "Showing " + data.period.label + ": " + range;
    $("v-utang").textContent = peso(data.utang.total);
    $("s-utang").textContent = plural(data.utang.count, "credit recorded", "credits recorded") + " in this period";
    $("v-bayad").textContent = peso(data.bayad.total);
    $("s-bayad").textContent = plural(data.bayad.count, "confirmed payment", "confirmed payments") + " in this period";
    $("v-balance").textContent = peso(data.outstanding.total);
    $("s-balance").textContent = "Unpaid by " + plural(data.outstanding.customers, "customer", "customers") + " · as of today";
    $("v-overdue").textContent = peso(data.overdue.total);
    $("s-overdue").textContent = plural(data.overdue.accounts, "overdue account", "overdue accounts") + " · as of today";
  }

  // ---- Chart: grouped bars, Utang (navy) beside Bayad (turquoise), one group per month ----
  function niceMax(max) {
    if (!(max > 0)) return 1000;
    var pow = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var n = max / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }
  function axisLabel(v) {
    if (v >= 1000) return "₱" + (Math.round(v / 100) / 10).toString().replace(/\.0$/, "") + "k";
    return "₱" + v;
  }
  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  }

  function renderChart() {
    var months = data.months;
    var hasData = months.some(function (m) { return m.utang > 0 || m.bayad > 0; });
    var box = $("chart");
    $("chart-empty").hidden = hasData;
    $("chart-legend").hidden = !hasData;
    box.hidden = !hasData;

    var what = data.period.label + (data.period.key === "custom" ? " (" + rangeText(data.period) + ")" : "");
    $("chart-sub").textContent = "Utang versus Bayad by month · " + what + (data.monthsTruncated ? " · latest 12 months" : "");
    $("chart-caption").textContent = "Utang and Bayad by month, " + what;
    $("chart-table").querySelector("tbody").innerHTML = months.map(function (m) {
      return "<tr><th scope=\"row\">" + esc(m.title) + "</th><td>" + peso(m.utang) + "</td><td>" + peso(m.bayad) + "</td></tr>";
    }).join("");
    if (!hasData) {
      box.innerHTML = "";
      $("chart-empty-title").textContent = data.hasRecords ? "Nothing in this period" : "Nothing to chart yet";
      $("chart-empty-text").textContent = data.hasRecords ? "No utang or bayad was recorded in the selected period." : "Utang and bayad you record will appear here, month by month.";
      return;
    }

    var W = Math.max(box.clientWidth || 320, 260);
    var H = W < 480 ? 220 : 250;
    var spansYears = months[0].year !== months[months.length - 1].year;
    var m = { l: 46, r: 6, t: 10, b: spansYears ? 40 : 28 };
    var plotW = W - m.l - m.r, plotH = H - m.t - m.b;
    var top = niceMax(Math.max.apply(null, months.map(function (x) { return Math.max(x.utang, x.bayad); })));
    var y = function (v) { return m.t + plotH - (v / top) * plotH; };

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-labelledby": "chart-svg-title" });
    el("title", { id: "chart-svg-title" }, svg).textContent = "Utang versus Bayad by month, " + what + ". The values are listed in the table below the chart.";

    // Grid lines and the amount scale
    for (var i = 0; i <= 4; i++) {
      var v = (top / 4) * i, gy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: gy, y2: gy, "class": "rp-grid-line" }, svg);
      el("text", { x: m.l - 8, y: gy + 4, "text-anchor": "end", "class": "rp-axis-text" }, svg).textContent = axisLabel(v);
    }

    // One group per month
    var groupW = plotW / months.length;
    var barW = Math.max(5, Math.min(36, groupW * 0.3)), gap = 4;
    months.forEach(function (mo, idx) {
      var gx = m.l + groupW * idx, cx = gx + groupW / 2;
      var g = el("g", {}, svg);
      el("title", {}, g).textContent = mo.title + " – Utang " + peso(mo.utang) + ", Bayad " + peso(mo.bayad);
      el("rect", { x: gx + 1, y: m.t, width: Math.max(groupW - 2, 1), height: plotH, rx: 6, "class": "rp-hit" }, g);
      [["utang", mo.utang, cx - gap / 2 - barW], ["bayad", mo.bayad, cx + gap / 2]].forEach(function (b) {
        if (!(b[1] > 0)) return;
        var h = Math.max(2, plotH - (y(b[1]) - m.t));
        el("rect", { x: b[2], y: m.t + plotH - h, width: barW, height: h, rx: 3, "class": "rp-bar rp-bar--" + b[0] }, g);
      });
      el("text", { x: cx, y: m.t + plotH + 17, "text-anchor": "middle", "class": "rp-month-text" + (mo.current ? " is-current" : "") }, g).textContent = mo.label;
      if (spansYears && (idx === 0 || mo.month === 1)) {
        el("text", { x: cx, y: m.t + plotH + 31, "text-anchor": "middle", "class": "rp-year-text" }, g).textContent = mo.year;
      }
    });

    box.innerHTML = "";
    box.appendChild(svg);
  }

  // ---- Detailed Transactions table ----
  // Utang (credit) and Bayad (confirmed payment) inside the selected period, newest first. The rows come from the same
  // data as the cards and the chart, so the counts always agree with them. Pending and rejected requests are never in it.
  function renderTable() {
    var rows = data.table || [];
    var paged = data.totalCount != null;                    // API: rows holds the pages loaded so far, totalCount is the whole period
    var total = paged ? data.totalCount : rows.length;
    var totalPages = Math.max(1, Math.ceil(total / ROWS_PER_STEP));
    if (tablePage > totalPages) tablePage = totalPages;
    var shown = paged ? rows : rows.slice((tablePage - 1) * ROWS_PER_STEP, tablePage * ROWS_PER_STEP);
    var what = data.period.label + " (" + rangeText(data.period) + ")";

    $("detail-sub").textContent = "Utang and confirmed Bayad · " + what;
    $("detail-caption").textContent = "Utang and Bayad transactions, " + what + ", newest first";
    $("detail-count").hidden = !total;
    $("detail-count").textContent = plural(total, "transaction", "transactions");

    $("detail-body").innerHTML = shown.map(function (t) {
      var pay = t.type === "payment";
      return '<tr class="rp-tr" role="row">' +
        '<td class="rp-td rp-td--id" role="cell"><a href="transaction-details?id=' + encodeURIComponent(t.id) + '" aria-label="Open ' + esc(t.code) + '">' + esc(t.code) + "</a></td>" +
        '<td class="rp-td rp-td--date" role="cell"><span class="rp-day">' + esc(dayText(t.date)) + '</span><span class="rp-time">' + esc(timeText(t.date)) + "</span></td>" +
        '<td class="rp-td rp-td--cust" role="cell">' + esc(t.customer || "Unknown customer") + "</td>" +
        '<td class="rp-td rp-td--type" role="cell"><span class="badge rp-type ' + (pay ? "badge--success rp-type--bayad" : "badge--warning rp-type--utang") + '">' + (pay ? "Bayad" : "Utang") + "</span></td>" +
        '<td class="rp-td rp-td--amt" role="cell"><span class="rp-amount rp-amount--' + t.type + '">' + (pay ? "&minus;" : "+") + peso(t.amount) + "</span></td></tr>";
    }).join("");
    $("detail-wrap").hidden = !total;

    var more = total > ROWS_PER_STEP;
    $("detail-more").hidden = !more;
    if (more) {
      $("detail-shown").textContent = window.CrediTrackPager.range({ page: tablePage, pageSize: ROWS_PER_STEP, totalCount: total, items: shown }, "transactions");
      pager.update({ page: tablePage, totalPages: totalPages });
    }

    var empty = !total;
    $("detail-empty").hidden = !empty;
    $("empty-record").hidden = false; setRetry(false);
    if (empty) {
      $("detail-empty-title").textContent = data.hasRecords ? "No transactions in this period" : "No transactions yet";
      $("detail-empty-text").textContent = data.hasRecords
        ? "No utang or confirmed bayad was recorded for " + rangeText(data.period) + ". Try a different reporting period."
        : "Utang and confirmed bayad you record will appear here.";
    }
  }

  function render() {
    renderSummary();
    renderChart();
    renderTable();
  }

  // ---- Period filters ----
  function saveView() {
    try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ key: period.key, start: period.start, end: period.end, page: tablePage })); } catch (e) { /* ignore */ }
  }

  function syncChips() {
    document.querySelectorAll("#period-chips .chip").forEach(function (chip) {
      var on = chip.getAttribute("data-period") === period.key;
      chip.setAttribute("aria-pressed", String(on));
      if (chip.getAttribute("data-period") === "custom") chip.setAttribute("aria-expanded", String(on));
    });
    $("custom").hidden = period.key !== "custom";
    if (period.key === "custom") { $("start-date").value = period.start; $("end-date").value = period.end; }
  }
  function setCustomError(message) {
    var box = $("custom-error");
    box.textContent = message || "";
    box.hidden = !message;
    ["start-date", "end-date"].forEach(function (id) {
      if (message) $(id).setAttribute("aria-invalid", "true"); else $(id).removeAttribute("aria-invalid");
    });
  }

  // ---- Loading and error states (built from the existing cards and the table's empty block) ----
  var requestId = 0;
  function setBusy(busy) {
    document.querySelector(".rp-cards").setAttribute("aria-busy", String(busy));
    if (busy) {
      $("period-live").textContent = "Loading report…";
      $("detail-sub").textContent = "Loading…";
      $("chart-sub").textContent = "Loading…";
      if (!data) ["v-utang", "v-bayad", "v-balance", "v-overdue"].forEach(function (id) { $(id).textContent = "…"; });
    }
  }
  function setRetry(on) {
    var btn = $("retry-btn");
    if (!btn && on) {
      btn = document.createElement("button");
      btn.type = "button"; btn.id = "retry-btn"; btn.className = "btn btn--secondary"; btn.textContent = "Try again";
      btn.addEventListener("click", load);
      $("detail-empty").appendChild(btn);
    }
    if (btn) btn.hidden = !on;
  }
  function failText(err) {
    return err && err.status === 401 ? "Your session has expired. Please log in again." : (err && err.message) || "The report could not be loaded. Please try again.";
  }
  // The very first load failed: nothing to show, so say so where the table would be
  function showLoadError(err) {
    ["v-utang", "v-bayad", "v-balance", "v-overdue"].forEach(function (id) { $(id).textContent = peso(0); });
    ["s-utang", "s-bayad", "s-balance", "s-overdue"].forEach(function (id) { $(id).textContent = ""; });
    $("period-live").textContent = "The report could not be loaded.";
    $("chart").hidden = true; $("chart-legend").hidden = true; $("chart-empty").hidden = true;
    $("detail-wrap").hidden = true; $("detail-more").hidden = true; $("detail-count").hidden = true;
    $("detail-sub").textContent = "";
    $("detail-empty").hidden = false;
    $("detail-empty-title").textContent = "Could not load the report";
    $("detail-empty-text").textContent = failText(err);
    $("empty-record").hidden = true; setRetry(true);
  }

  // Calculates and shows the report for `next` ({ key, start, end }). Keeps the old report when the dates are not valid.
  function show(next) {
    var id = ++requestId;
    var samePeriod = periodKey({ key: next.key, start: next.start || "", end: next.end || "" }) === shownPeriodKey;
    var wantPage = samePeriod ? tablePage : 1;               // new period: back to the first page of the table
    setBusy(true);
    return api.getReportsOverview(Object.assign({}, next, { page: wantPage, pageSize: ROWS_PER_STEP })).then(function (d) {
      if (id !== requestId) return;                          // a newer request is already running
      data = d; period = { key: next.key, start: next.start || "", end: next.end || "" };
      tablePage = d.totalCount != null ? (d.page || wantPage) : wantPage; shownPeriodKey = periodKey(period);
      setBusy(false); setCustomError("");
      syncChips(); saveView(); render();
    }, function (err) {
      if (id !== requestId) return;
      setBusy(false);
      if (err.status === 400) { if (data) { setBusy(false); renderSummary(); renderChart(); renderTable(); } setCustomError(err.message); return; }   // not valid dates: keep the old report
      if (data) { renderSummary(); renderChart(); renderTable(); window.CrediTrack.showToast(failText(err)); return; }   // keep what is on screen
      showLoadError(err);
    });
  }
  function load() { return show(period); }

  document.querySelector("#period-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    var key = chip.getAttribute("data-period");
    if (key !== "custom") { show({ key: key }); return; }
    if (period.key === "custom") { $("start-date").focus(); return; }
    // Custom Date Range opens with this month so far; the owner then chooses the dates and presses Apply
    var now = new Date();
    show({ key: "custom", start: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoDay(now) }).then(function () { $("start-date").focus(); });
  });

  $("custom").addEventListener("submit", function (event) {
    event.preventDefault();
    var start = $("start-date").value, end = $("end-date").value;
    if (end && end > isoDay(new Date())) { setCustomError("The end date cannot be in the future."); $("end-date").focus(); return; }
    show({ key: "custom", start: start, end: end }).then(function () {
      if (!$("custom-error").hidden) (!start ? $("start-date") : !end ? $("end-date") : $("end-date")).focus();
    });
  });
  ["start-date", "end-date"].forEach(function (id) { $(id).addEventListener("input", function () { setCustomError(""); }); });
  $("start-date").max = $("end-date").max = isoDay(new Date());

  // Icons on the summary cards (the shell exposes the shared icon set)
  document.querySelectorAll("[data-icon]").forEach(function (slot) { slot.innerHTML = ICONS[slot.getAttribute("data-icon")] || ""; });

  // Pagination bar under the table: opens another page of the same period (the cards and the chart stay as they are)
  function goPage(n) {
    if (data.totalCount == null) {                           // sample data: everything is already here
      tablePage = n; saveView(); renderTable(); return Promise.resolve();
    }
    var id = requestId;
    return api.getReportsOverview(Object.assign({}, period, { page: n, pageSize: ROWS_PER_STEP })).then(function (d) {
      if (id !== requestId) return;                          // the period changed while loading
      data.table = d.table || []; data.totalCount = d.totalCount; data.hasMore = d.hasMore;
      tablePage = d.page || n; saveView(); renderTable();
    }, function (err) {
      window.CrediTrack.showToast(failText(err));
    });
  }

  // ---- Export Report: PDF or CSV of the period that is currently selected ----
  var exportBtn = $("export-btn"), exportMenu = $("export-menu");
  function exportItems() { return Array.prototype.slice.call(exportMenu.querySelectorAll("[role=menuitem]")); }
  function setExportOpen(open, focusButton) {
    exportMenu.hidden = !open;
    exportBtn.setAttribute("aria-expanded", String(open));
    if (open) exportItems()[0].focus(); else if (focusButton) exportBtn.focus();
  }
  function runExport(format) {
    if (!data || !window.ReportExport) return;
    var label = format.toUpperCase();
    setExportOpen(false, true);
    exportBtn.disabled = true;
    window.ReportExport.run(format, { key: period.key, start: period.start, end: period.end }).then(function () {
      window.CrediTrack.showToast(label + " report downloaded.");
    }, function () {
      window.CrediTrack.showToast("The " + label + " report could not be created. Please try again.");
    }).then(function () { exportBtn.disabled = false; });
  }
  exportBtn.addEventListener("click", function () { setExportOpen(exportMenu.hidden); });
  exportMenu.addEventListener("click", function (event) {
    var item = event.target.closest("[data-format]");
    if (item) runExport(item.getAttribute("data-format"));
  });
  document.addEventListener("click", function (event) {
    if (!exportMenu.hidden && !$("export").contains(event.target)) setExportOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (exportMenu.hidden) return;
    var items = exportItems(), i = items.indexOf(document.activeElement);
    if (event.key === "Escape") { setExportOpen(false, true); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
    else if (event.key === "Tab") { setExportOpen(false); }
  });


  // Redraw the chart when the width changes (rotating a phone, resizing the window)
  var resizeTimer, lastWidth = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var w = $("chart").clientWidth;
      if (data && w && w !== lastWidth) { lastWidth = w; renderChart(); }
    }, 120);
  });
  // Coming back with the Back button: show the latest records
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });

  // Back from a transaction keeps the period that was selected; opening Reports from the menu starts at This Month
  try {
    var saved = JSON.parse(window.sessionStorage.getItem(VIEW_KEY));
    if (saved && saved.key && window.CrediTrack.navType() === "back_forward") {
      period = { key: saved.key, start: saved.start || "", end: saved.end || "" };
      if (saved.page >= 1) { tablePage = saved.page; shownPeriodKey = periodKey(period); }   // Back keeps the table page that was open
    }
  } catch (e) { /* ignore */ }

  load().then(function () { if (period.key === "custom" && !data) show({ key: "month" }); });
})();
