/* Pagination bar (window.CrediTrackPager).
   Draws one rounded bar under a list:  [ < ]  1 ... 4 [5] 6 ... 20  [ > ]  |  Go to: [ 5 ] [ -> ]
   (arrow buttons, a window of page numbers, and a "Go to" box to jump straight to any page; styled in css/components/pager.css).
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
    [1, page - 1, page, page + 1, total].forEach(function (n) { if (n >= 1 && n <= total) wanted[n] = true; });
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
    var current = 1, total = 1, busy = false, uid = (create.count = (create.count || 0) + 1);

    function button(label, page, extra, aria) {
      return '<button type="button" class="pager__btn ' + (extra || "") + '" data-page="' + page + '"' +
        (aria ? ' aria-label="' + aria + '"' : "") + ">" + label + "</button>";
    }

    var ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_GO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function draw() {
      if (total <= 1) { el.hidden = true; el.innerHTML = ""; return; }
      el.hidden = false;
      var html = '<div class="pager__bar">';
      html += '<div class="pager__nav">';
      html += '<button type="button" class="pager__btn pager__btn--step" data-page="' + (current - 1) + '"' + (current <= 1 ? " disabled" : "") + ' aria-label="Previous page">' + ICON_PREV + "</button>";
      html += '<span class="pager__nums">';
      windowOf(current, total).forEach(function (n) {
        if (n === 0) html += '<span class="pager__gap" aria-hidden="true">&hellip;</span>';
        else if (n === current) html += '<button type="button" class="pager__btn pager__btn--num is-current" aria-current="page" aria-label="Page ' + n + ' of ' + total + ', current page" disabled>' + n + "</button>";
        else html += button(n, n, "pager__btn--num", "Go to page " + n);
      });
      html += "</span>";
      html += '<button type="button" class="pager__btn pager__btn--step" data-page="' + (current + 1) + '"' + (current >= total ? " disabled" : "") + ' aria-label="Next page">' + ICON_NEXT + "</button>";
      html += "</div>";
      html += '<span class="pager__divider" aria-hidden="true"></span>';
      html += '<form class="pager__jump" novalidate>' +
        '<label class="pager__jump-label" for="pager-jump-' + uid + '">Go to:</label>' +
        '<input class="pager__input" id="pager-jump-' + uid + '" type="number" inputmode="numeric" min="1" max="' + total + '" value="' + current + '" aria-label="Go to page (1 to ' + total + ')">' +
        '<button type="submit" class="pager__go" aria-label="Go to the page typed">' + ICON_GO + "</button></form>";
      html += "</div>";
      html += '<span class="pager__status" aria-live="polite">Page ' + current + " of " + total + "</span>";
      html += '<span class="pager__note" role="alert" hidden></span>';
      el.innerHTML = html;
    }

    function jump(n) {
      if (!isFinite(n)) return;
      n = Math.min(total, Math.max(1, Math.round(n)));
      if (n === current || busy) { draw(); return; }
      busy = true;
      Promise.resolve(go(n)).then(function () {
        if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }).then(function () { busy = false; }, function () { busy = false; draw(); });
    }

    el.setAttribute("role", "navigation");
    el.setAttribute("aria-label", "Pagination");
    el.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-page]");
      if (!btn || btn.disabled || busy) return;
      jump(parseInt(btn.getAttribute("data-page"), 10));
    });
    // A page number that does not exist (empty, letters, 0, more than the last page, decimals): stay on this page and say why.
    function note(message) {
      var box = el.querySelector(".pager__note"), input = el.querySelector(".pager__input");
      if (box) { box.textContent = message || ""; box.hidden = !message; }
      if (input) { input.classList.toggle("is-invalid", !!message); input.setAttribute("aria-invalid", message ? "true" : "false"); }
    }
    el.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = el.querySelector(".pager__input");
      var raw = input ? String(input.value).trim() : "";
      var n = Number(raw);
      if (raw === "" || !isFinite(n) || n % 1 !== 0 || n < 1 || n > total) {
        note("Page " + (raw === "" ? "number is needed" : raw) + (raw === "" ? "" : " does not exist") + ". Choose from 1 to " + total + ".");
        if (input) input.select();
        return;
      }
      note("");
      jump(n);
    });
    el.addEventListener("input", function (event) {
      if (event.target.classList && event.target.classList.contains("pager__input")) note("");
    });
    el.addEventListener("focusin", function (event) {
      if (event.target.classList && event.target.classList.contains("pager__input")) event.target.select();
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
