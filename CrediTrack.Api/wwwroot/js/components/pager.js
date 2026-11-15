/* Pagination bar (window.CrediTrackPager).
   Shows round navy ‹ / › buttons with a plain "5 of 20" between them, plus a "Go to: Page N" dropdown, under a list and outside its panel.
   The list pages send a query with page + pageSize and get back { page, totalPages, totalCount } (see js/api/list-query.js);
   this bar only draws those numbers and tells the page which page was chosen. It never loads anything itself.

   Usage:
     var pager = CrediTrackPager.create(document.getElementById("pager"), function (n) { return load(n); }, listElement);
     pager.update(data);     // data = { page, totalPages }  (hidden when there is only one page)

   The go() callback may return a promise; when it finishes the page scrolls back to the top of the list (the third argument). */
(function () {
  "use strict";

  // Which page numbers to show: always the first, the last and the current page with one neighbour on each side; gaps become "...".
  function windowOf(page, total) {
    var wanted = {};
    [1, 2, page - 1, page, page + 1, total - 1, total].forEach(function (n) { if (n >= 1 && n <= total) wanted[n] = true; });
    var list = Object.keys(wanted).map(Number).sort(function (a, b) { return a - b; });
    var out = [], prev = 0;
    list.forEach(function (n) {
      if (n - prev > 1) out.push(n - prev === 2 ? prev + 1 : 0);   // a single missing number is just shown; a longer gap is "..."
      out.push(n); prev = n;
    });
    return out;
  }

  function create(el, go, anchor) {
    if (!el) return { update: function () {} };
    var current = 1, total = 1, busy = false;

    // The bar sits BELOW the list's panel, not inside it. It is moved there once, so no page has to change its markup.
    // While the panel (or the row it was in, e.g. Reports' "more" row) is hidden, the bar stays hidden too.
    var guards = [];
    var panel = el.closest ? el.closest("section.panel") : null;
    if (panel && panel.parentNode) {
      guards.push(panel);
      if (el.parentNode !== panel) guards.push(el.parentNode);
      panel.parentNode.insertBefore(el, panel.nextSibling);
    }
    function blocked() { return guards.some(function (g) { return g.hidden; }); }

    function button(label, page, extra, aria) {
      return '<button type="button" class="pager__btn ' + (extra || "") + '" data-page="' + page + '"' +
        (aria ? ' aria-label="' + aria + '"' : "") + ">" + label + "</button>";
    }

    function draw() {
      if (total <= 1 || blocked()) { el.hidden = true; el.innerHTML = ""; return; }
      el.hidden = false;
      // Row 1: round navy arrows with a plain "1 of 20" between them. Row 2 (wraps under on small screens): "Go to" dropdown.
      var html = '<div class="pager__nav">';
      html += '<button type="button" class="pager__btn pager__btn--step" data-page="' + (current - 1) + '"' + (current <= 1 ? " disabled" : "") + ' aria-label="Previous page"><span aria-hidden="true">&lsaquo;</span></button>';
      html += '<span class="pager__status" aria-live="polite" aria-label="Page ' + current + " of " + total + '">' + current + " of " + total + "</span>";
      html += '<button type="button" class="pager__btn pager__btn--step" data-page="' + (current + 1) + '"' + (current >= total ? " disabled" : "") + ' aria-label="Next page"><span aria-hidden="true">&rsaquo;</span></button>';
      html += "</div>";
      html += '<label class="pager__goto"><span class="pager__goto-label">Go to:</span><select class="pager__select" aria-label="Go to page">';
      for (var n = 1; n <= total; n++) html += '<option value="' + n + '"' + (n === current ? " selected" : "") + ">Page " + n + "</option>";
      html += "</select></label>";
      el.innerHTML = html;
    }

    if (window.MutationObserver) {
      guards.forEach(function (g) { new MutationObserver(draw).observe(g, { attributes: true, attributeFilter: ["hidden"] }); });
    }

    // Ask the page to load page n; scroll back to the top of the list when it is done.
    function jump(n) {
      busy = true;
      Promise.resolve(go(n)).then(function () {
        if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }).then(function () { busy = false; }, function () { busy = false; });
    }

    el.setAttribute("role", "navigation");
    el.setAttribute("aria-label", "Pagination");
    el.addEventListener("change", function (event) {
      var sel = event.target.closest ? event.target.closest(".pager__select") : null;
      if (!sel) return;
      var n = parseInt(sel.value, 10);
      if (!isFinite(n) || n < 1 || n > total || n === current || busy) { sel.value = current; return; }
      jump(n);
    });
    el.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-page]");
      if (!btn || btn.disabled || busy) return;
      var n = parseInt(btn.getAttribute("data-page"), 10);
      if (!isFinite(n) || n < 1 || n > total || n === current) return;
      jump(n);
    });

    return {
      update: function (data) {
        current = Math.max(1, (data && data.page) || 1);
        total = Math.max(1, (data && data.totalPages) || 1);
        draw();
      }
    };
  }

  // "Showing 21-40 of 87" for the line above a list (the page number and size come from the response).
  function range(data, noun) {
    var size = data.pageSize || 20, from = (data.page - 1) * size + 1, to = Math.min(data.totalCount, from + (data.items ? data.items.length : size) - 1);
    return "Showing " + from + "\u2013" + to + " of " + data.totalCount + (noun ? " " + noun : "");
  }

  window.CrediTrackPager = { create: create, range: range, windowOf: windowOf };
})();
