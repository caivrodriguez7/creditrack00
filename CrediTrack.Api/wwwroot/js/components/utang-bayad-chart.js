/* Utang vs Bayad bar chart (plain SVG, no chart library).
   Same look and drawing rules as the chart on the Reports page (js/pages/owner-reports.js), packaged so the Dashboard can use it too.
   CrediTrackChart.render(box, months, { title })
     box    - the element the SVG is drawn into
     months - [{ label, title, year, month, utang, bayad, current }]  (the "months" array of getReportsOverview)
   Returns true when something was drawn, false when every month is zero (the caller then shows its empty state). */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
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

  function render(box, months, opts) {
    opts = opts || {};
    months = months || [];
    var hasData = months.some(function (m) { return m.utang > 0 || m.bayad > 0; });
    box.innerHTML = "";
    if (!hasData) return false;

    var W = Math.max(box.clientWidth || 320, 260);
    var H = W < 480 ? 220 : 250;
    var spansYears = months[0].year !== months[months.length - 1].year;
    var m = { l: 46, r: 6, t: 10, b: spansYears ? 40 : 28 };
    var plotW = W - m.l - m.r, plotH = H - m.t - m.b;
    var top = niceMax(Math.max.apply(null, months.map(function (x) { return Math.max(x.utang, x.bayad); })));
    var y = function (v) { return m.t + plotH - (v / top) * plotH; };

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-labelledby": "dash-chart-svg-title" });
    el("title", { id: "dash-chart-svg-title" }, svg).textContent = (opts.title || "Utang versus Bayad by month") + ". The values are listed in the table below the chart.";

    for (var i = 0; i <= 4; i++) {
      var v = (top / 4) * i, gy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: gy, y2: gy, "class": "rp-grid-line" }, svg);
      el("text", { x: m.l - 8, y: gy + 4, "text-anchor": "end", "class": "rp-axis-text" }, svg).textContent = axisLabel(v);
    }

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

    box.appendChild(svg);
    return true;
  }

  window.CrediTrackChart = { render: render };
})();
