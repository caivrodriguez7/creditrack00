/* Reports > Export Report (PDF and CSV). Mock data only, nothing is uploaded: the file is built in the browser and downloaded.

   ReportExport.run("pdf" | "csv", { key, start, end })  ->  Promise that resolves with the file name.
   The period is the one currently selected on the Reports page. The data is read again from
   CrediTrackApi.getReportsOverview(period) at the moment of export, so the export always uses the SAME rules as the page:
     - Total Utang and Total Bayad: only transactions inside the selected period (confirmed payments only;
       pending and rejected payment requests are never transactions, so they are never exported)
     - Outstanding and Overdue Balance: current balances as of today (they do not depend on the period)
     - Detailed table: every transaction inside the period, newest first, with the 5 columns the page shows
   Nothing is calculated here: this file only lays out what getReportsOverview returns.

   CSV: UTF-8 with a byte-order mark (so Excel shows the peso sign), summary lines first, then the table. No chart.
        Amounts are written as plain "₱1,250.00" text; the Transaction Type column says whether it is Utang or Bayad.
   PDF: A4, built by js/components/pdf-lite.js. Brand header with the CrediTrack logo, store name, period, "Prepared by", four summary cards, the Utang vs. Bayad chart
        (drawn as vector bars) and the Detailed Transactions table, which continues on extra pages with repeated column headings. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;

  // Brand colors (same values as css/tokens.css)
  var C = { navy: "#071A52", teal: "#086B70", turquoise: "#35A5A0", lime: "#F0F59A", ink: "#16244D", muted: "#52627E",
    border: "#D6E4E6", surface: "#F3F8F8", amber: "#9A6410", danger: "#C93C3C", limeSoft: "#FBFDD6", limeEdge: "#DFE67E" };

  // ---------- Formatting ----------
  function peso(n) {
    return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pesoWhole(n) { return "\u20B1" + Math.round(Number(n)).toLocaleString("en-PH"); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoDay(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function ampm(text) { return text.replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); }); }
  function dayText(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  function timeText(iso) { return ampm(new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })); }
  function rangeText(p) {
    var a = new Date(p.start), b = new Date(p.end);
    var short = { month: "short", day: "numeric" }, full = { month: "short", day: "numeric", year: "numeric" };
    if (a.getFullYear() !== b.getFullYear()) return a.toLocaleDateString("en-PH", full) + " \u2013 " + b.toLocaleDateString("en-PH", full);
    return a.toLocaleDateString("en-PH", short) + " \u2013 " + b.toLocaleDateString("en-PH", full);
  }
  function generatedText() { return dayText(new Date().toISOString()) + ", " + timeText(new Date().toISOString()); }
  function slug(text, fallback) {
    var s = String(text || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || fallback;
  }
  // CrediTrack_Report_Aling-Nenas-Store_2026-10-01_to_2026-10-31.pdf
  function fileName(ctx, extension) {
    return "CrediTrack_Report_" + slug(ctx.store, "Store") + "_" + isoDay(new Date(ctx.data.period.start)) + "_to_" +
      isoDay(new Date(ctx.data.period.end)) + "." + extension;
  }
  function typeName(t) { return t.type === "payment" ? "Bayad" : "Utang"; }

  // ---------- CSV ----------
  // Quotes a cell when needed, and stops spreadsheet programs from running text that starts like a formula.
  function cell(value) {
    var s = String(value === undefined || value === null ? "" : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(ctx) {
    var d = ctx.data, rows = [];
    function add() { rows.push(Array.prototype.slice.call(arguments).map(cell).join(",")); }
    add("CrediTrack Report");
    add("Store Name", ctx.store);
    add("Prepared By", ctx.preparedBy);
    add("Reporting Period", d.period.label);
    add("Period Dates", rangeText(d.period));
    add("Generated", generatedText());
    add("");
    add("Summary");
    add("Total Utang (selected period)", peso(d.utang.total));
    add("Total Bayad (selected period)", peso(d.bayad.total));
    add("Outstanding Balance (as of today)", peso(d.outstanding.total));
    add("Overdue Balance (as of today)", peso(d.overdue.total));
    add("");
    add("Detailed Transactions");
    add("Transaction ID", "Date", "Customer Name", "Transaction Type", "Amount");
    if (!d.table.length) add("No transactions in this period.");
    d.table.forEach(function (t) {
      add(t.code, dayText(t.date) + " " + timeText(t.date), t.customer || "Unknown customer", typeName(t), peso(t.amount));
    });
    return "\uFEFF" + rows.join("\r\n") + "\r\n";
  }

  // ---------- PDF ----------
  function niceMax(max) {
    if (!(max > 0)) return 1000;
    var pow = Math.pow(10, Math.floor(Math.log(max) / Math.LN10)), n = max / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }
  function axisLabel(v) {
    if (v >= 1000) return "\u20B1" + (Math.round(v / 100) / 10).toString().replace(/\.0$/, "") + "k";
    return "\u20B1" + v;
  }

  function buildPdf(ctx) {
    var d = ctx.data, doc = new window.CrediTrackPdf({ title: "CrediTrack Report - " + ctx.store + " - " + d.period.label });
    var size = doc.pageSize(), PW = size.width, PH = size.height, M = 40, CW = PW - M * 2, BOTTOM = PH - 52;
    var periodLine = d.period.label + "  \u00B7  " + rangeText(d.period);
    var y;

    // First page: brand header band
    function firstHeader() {
      doc.rect(0, 0, PW, 72, { fill: C.navy });
      doc.rect(0, 72, PW, 3, { fill: C.turquoise });
      doc.rect(PW * 0.78, 72, PW * 0.22, 3, { fill: C.lime });
      if (ctx.logo) {
        var lh = 56, lw = lh * ctx.logo.w / ctx.logo.h;      // keeps the logo's own proportions
        doc.image(ctx.logo, M, 8, lw, lh);
      } else {
        doc.text("CrediTrack", M, 40, { size: 22, bold: true, color: "#FFFFFF" });
        doc.text("Every Credit, On Track.", M, 56, { size: 9, color: C.lime });
      }
      doc.text(doc.fit(ctx.store, 12, true, 300), PW - M, 38, { size: 12, bold: true, color: "#FFFFFF", align: "right" });
      doc.text("Store Credit Report", PW - M, 54, { size: 9, color: "#DCE6F2", align: "right" });
    }
    // Later pages: slim band with the store and the period
    function nextHeader() {
      doc.rect(0, 0, PW, 34, { fill: C.navy });
      doc.rect(0, 34, PW, 2, { fill: C.turquoise });
      if (ctx.wordmark) {
        var wh = 15, ww = wh * ctx.wordmark.w / ctx.wordmark.h;
        doc.image(ctx.wordmark, M, 9.5, ww, wh);
      } else {
        doc.text("CrediTrack", M, 22, { size: 12, bold: true, color: "#FFFFFF" });
      }
      doc.text(doc.fit(ctx.store + "  \u00B7  " + periodLine, 8.5, false, CW - 90), PW - M, 21, { size: 8.5, color: "#DCE6F2", align: "right" });
    }

    doc.addPage();
    firstHeader();

    // Title and period
    y = 104;
    doc.text("Credit Report", M, y, { size: 17, bold: true, color: C.navy });
    y += 19;
    doc.text("Reporting period:", M, y, { size: 9.5, bold: true, color: C.muted });
    doc.text(periodLine, M + doc.measure("Reporting period:", 9.5, true) + 6, y, { size: 9.5, color: C.ink });
    y += 14;
    doc.text("Store:", M, y, { size: 9.5, bold: true, color: C.muted });
    doc.text(doc.fit(ctx.store, 9.5, false, CW - 60), M + doc.measure("Store:", 9.5, true) + 6, y, { size: 9.5, color: C.ink });
    y += 14;
    doc.text("Prepared by:", M, y, { size: 9.5, bold: true, color: C.muted });
    doc.text(doc.fit(ctx.preparedBy, 9.5, false, CW - 80), M + doc.measure("Prepared by:", 9.5, true) + 6, y, { size: 9.5, color: C.ink });
    y += 14;
    doc.text("Generated on " + generatedText(), M, y, { size: 8.5, color: C.muted });
    y += 16;

    // Summary cards
    var cards = [
      { label: "Total Utang", value: peso(d.utang.total), sub: plural(d.utang.count, "credit recorded", "credits recorded"), color: C.navy },
      { label: "Total Bayad", value: peso(d.bayad.total), sub: plural(d.bayad.count, "confirmed payment", "confirmed payments"), color: C.turquoise },
      { label: "Outstanding Balance", value: peso(d.outstanding.total), sub: plural(d.outstanding.customers, "customer", "customers") + " \u00B7 as of today", color: C.teal },
      { label: "Overdue Balance", value: peso(d.overdue.total), sub: plural(d.overdue.accounts, "account", "accounts") + " overdue \u00B7 as of today", color: C.danger }
    ];
    var gap = 10, cw = (CW - gap * 3) / 4, ch = 60;
    cards.forEach(function (c, i) {
      var x = M + i * (cw + gap), inner = cw - 20, fs = 14;
      doc.rect(x, y, cw, ch, { fill: "#FFFFFF", stroke: C.border, radius: 5 });
      doc.rect(x + 5, y, cw - 10, 3, { fill: c.color });
      doc.text(c.label, x + 10, y + 19, { size: 8, bold: true, color: C.muted });
      while (fs > 8 && doc.measure(c.value, fs, true) > inner) fs -= 0.5;
      doc.text(c.value, x + 10, y + 37, { size: fs, bold: true, color: c.color === C.turquoise ? C.teal : c.color });
      doc.text(doc.fit(c.sub, 7, false, inner), x + 10, y + 51, { size: 7, color: C.muted });
    });
    y += ch + 18;

    // Chart: Utang vs. Bayad by month (vector bars, PDF only)
    var months = d.months || [], hasData = months.some(function (m) { return m.utang > 0 || m.bayad > 0; });
    var chartTop = y, plotH = 132, chartH = hasData ? 46 + plotH + 34 : 46 + 56 + 8;
    doc.rect(M, chartTop, CW, chartH, { fill: "#FFFFFF", stroke: C.border, radius: 6 });
    doc.rect(M + 12, chartTop + 13, 3, 12, { fill: C.turquoise });
    doc.text("Utang vs. Bayad by Month", M + 21, chartTop + 23, { size: 11, bold: true, color: C.navy });
    doc.text(doc.fit(d.period.label + " \u00B7 " + rangeText(d.period) + (d.monthsTruncated ? " \u00B7 latest 12 months" : ""), 8, false, CW - 170), M + 21, chartTop + 36, { size: 8, color: C.muted });
    // Legend (right)
    var lx = M + CW - 12;
    doc.text("Bayad", lx, chartTop + 23, { size: 8.5, bold: true, color: C.ink, align: "right" });
    var bw = doc.measure("Bayad", 8.5, true);
    doc.rect(lx - bw - 14, chartTop + 15.5, 8, 8, { fill: C.turquoise });
    var ux = lx - bw - 14 - 14;
    doc.text("Utang", ux, chartTop + 23, { size: 8.5, bold: true, color: C.ink, align: "right" });
    var uw = doc.measure("Utang", 8.5, true);
    doc.rect(ux - uw - 14, chartTop + 15.5, 8, 8, { fill: C.navy });

    if (!hasData) {
      doc.rect(M + 12, chartTop + 46, CW - 24, 56, { fill: C.surface, radius: 4 });
      doc.text(d.hasRecords ? "No utang or bayad was recorded in the selected period." : "No utang or bayad has been recorded yet.", M + CW / 2, chartTop + 78, { size: 9, color: C.muted, align: "center" });
    } else {
      var x0 = M + 52, x1 = M + CW - 14, pTop = chartTop + 56, pBottom = pTop + plotH;
      var top = niceMax(Math.max.apply(null, months.map(function (m) { return Math.max(m.utang, m.bayad); })));
      var yOf = function (v) { return pBottom - (v / top) * plotH; };
      for (var i = 0; i <= 4; i++) {
        var gv = (top / 4) * i, gy = yOf(gv);
        doc.line(x0, gy, x1, gy, { color: i === 0 ? "#B9CDD0" : C.border, width: 0.5 });
        doc.text(axisLabel(gv), x0 - 7, gy + 2.7, { size: 7.5, color: C.muted, align: "right" });
      }
      var groupW = (x1 - x0) / months.length, barW = Math.max(4, Math.min(34, groupW * 0.3)), bGap = 3;
      var spansYears = months[0].year !== months[months.length - 1].year;
      months.forEach(function (mo, idx) {
        var cx = x0 + groupW * idx + groupW / 2;
        [["utang", mo.utang, cx - bGap / 2 - barW, C.navy], ["bayad", mo.bayad, cx + bGap / 2, C.turquoise]].forEach(function (b) {
          if (!(b[1] > 0)) return;
          var h = Math.max(1.5, pBottom - yOf(b[1]));
          doc.rect(b[2], pBottom - h, barW, h, { fill: b[3] });
          if (months.length <= 4) doc.text(pesoWhole(b[1]), b[2] + barW / 2, pBottom - h - 4, { size: 7, bold: true, color: C.ink, align: "center" });
        });
        doc.text(mo.label, cx, pBottom + 13, { size: 8, bold: mo.current, color: mo.current ? C.navy : C.muted, align: "center" });
        if (spansYears && (idx === 0 || mo.month === 1)) doc.text(String(mo.year), cx, pBottom + 24, { size: 7, color: C.muted, align: "center" });
      });
    }
    y = chartTop + chartH + 22;

    // Detailed transactions table
    var COLS = [
      { key: "id", title: "Transaction ID", x: M + 10, w: 72 },
      { key: "date", title: "Date", x: M + 88, w: 118 },
      { key: "cust", title: "Customer Name", x: M + 212, w: 168 },
      { key: "type", title: "Transaction Type", x: M + 386, w: 64 },
      { key: "amt", title: "Amount", x: M + CW - 10, w: 0, right: true }
    ];
    var ROW = 21, HEAD = 22;
    function newPage() { doc.addPage(); nextHeader(); y = 58; }
    function tableHead() {
      doc.rect(M, y, CW, HEAD, { fill: C.surface });
      doc.line(M, y, M + CW, y, { color: C.border, width: 0.6 });
      doc.line(M, y + HEAD, M + CW, y + HEAD, { color: C.border, width: 0.6 });
      COLS.forEach(function (c) { doc.text(c.title, c.x, y + 14.5, { size: 8, bold: true, color: C.muted, align: c.right ? "right" : "left" }); });
      y += HEAD;
    }

    var rows = d.table || [];
    if (y + 36 + HEAD + ROW > BOTTOM) newPage();     // keep the title together with the first rows
    doc.rect(M, y - 1, 3, 12, { fill: C.turquoise });
    doc.text("Detailed Transactions", M + 9, y + 9, { size: 11, bold: true, color: C.navy });
    doc.text(plural(rows.length, "transaction", "transactions"), M + CW, y + 9, { size: 8.5, bold: true, color: C.muted, align: "right" });
    y += 22;
    doc.text("Utang and confirmed Bayad inside the selected period, newest first. Pending and rejected payment requests are not included.", M, y, { size: 7.5, color: C.muted });
    y += 12;
    tableHead();

    if (!rows.length) {
      doc.text("No transactions in this period.", M + CW / 2, y + 22, { size: 9, color: C.muted, align: "center" });
      doc.line(M, y + 36, M + CW, y + 36, { color: C.border, width: 0.6 });
      y += 36;
    }
    rows.forEach(function (t, i) {
      if (y + ROW > BOTTOM) { newPage(); tableHead(); }
      var pay = t.type === "payment", color = pay ? C.teal : C.amber, base = y + 14;
      if (i % 2 === 1) doc.rect(M, y, CW, ROW, { fill: "#F8FBFB" });
      doc.text(t.code, COLS[0].x, base, { size: 8.5, bold: true, color: C.teal });
      doc.text(dayText(t.date) + ", " + timeText(t.date), COLS[1].x, base, { size: 8.5, color: C.ink });
      doc.text(doc.fit(t.customer || "Unknown customer", 8.5, true, COLS[2].w), COLS[2].x, base, { size: 8.5, bold: true, color: C.navy });
      doc.text(typeName(t), COLS[3].x, base, { size: 8.5, bold: true, color: color });
      doc.text((pay ? "-" : "+") + peso(t.amount), COLS[4].x, base, { size: 8.5, bold: true, color: color, align: "right" });
      doc.line(M, y + ROW, M + CW, y + ROW, { color: "#E6EEEF", width: 0.4 });
      y += ROW;
    });

    // Footer and page numbers on every page
    var count = doc.pageCount();
    for (var p = 1; p <= count; p++) {
      doc.setPage(p);
      doc.line(M, PH - 36, M + CW, PH - 36, { color: C.border, width: 0.5 });
      doc.text("Generated by CrediTrack  \u00B7  Every Credit, On Track.", M, PH - 22, { size: 7.5, color: C.muted });
      doc.text("Page " + p + " of " + count, M + CW, PH - 22, { size: 7.5, color: C.muted, align: "right" });
    }
    return doc;
  }

  // ---------- Run ----------
  function run(format, spec) {
    if (format !== "pdf" && format !== "csv") return Promise.reject(new Error("Unknown export format."));
    // The logo only matters for the PDF; if it cannot load, the PDF falls back to the text header instead of failing.
    var logos = format === "pdf" && window.CrediTrackPdf.loadImage ? Promise.all([
      window.CrediTrackPdf.loadImage("/assets/images/creditrack-logo-dark.png", 300).catch(function () { return null; }),
      window.CrediTrackPdf.loadImage("/assets/images/creditrack-wordmark-dark.png", 320).catch(function () { return null; })
    ]) : Promise.resolve([null, null]);
    return Promise.all([api.getReportsOverview(spec), api.getOwner(), logos]).then(function (results) {
      var owner = results[1] || {};
      var ctx = { data: results[0], store: owner.storeName || "Your Store", preparedBy: owner.fullName || "Store Owner",
        logo: results[2][0], wordmark: results[2][1] };
      var name = fileName(ctx, format);
      if (format === "pdf") buildPdf(ctx).download(name);
      else window.CrediTrackDownload(new Blob([buildCsv(ctx)], { type: "text/csv;charset=utf-8" }), name);
      return name;
    });
  }

  window.ReportExport = { run: run, buildCsv: buildCsv, _buildPdf: buildPdf };
})();
