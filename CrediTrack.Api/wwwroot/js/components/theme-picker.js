/* Appearance picker: Light, Dark or Follow device (also opens / closes the expandable Appearance and Language rows).
   Put <div class="theme-picker" data-theme-picker></div> on a page and load this file; it fills the buttons in.
   It is a radio group, so arrow keys move the choice (Left/Up = previous, Right/Down = next). */
(function () {
  "use strict";
  var Theme = window.CrediTheme;

  /* Expandable settings rows (Appearance and Language, on both Settings pages): a button with data-st-toggle opens the
     panel named in its aria-controls. One delegated listener, so rows added later by js/language.js work too. */
  document.addEventListener("click", function (e) {
    var toggle = e.target.closest ? e.target.closest("[data-st-toggle]") : null;
    if (!toggle) return;
    var panel = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!panel) return;
    var open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
  });

  /* The chip on the Appearance row shows the current mode */
  var chip = document.getElementById("appearance-current");
  var LABELS = { light: "Light", dark: "Dark", system: "Auto" };
  function paintChip() {
    if (!chip || !Theme) return;
    var pref = Theme.get();
    chip.textContent = LABELS[pref] || "Auto";
    chip.setAttribute("data-mode", pref);
  }
  window.addEventListener("creditheme", paintChip);
  paintChip();

  var holders = document.querySelectorAll("[data-theme-picker]");
  if (!Theme || !holders.length) return;

  var ICONS = {
    light: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>',
    dark: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    system: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };
  var OPTIONS = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "Follow device" }
  ];

  Array.prototype.forEach.call(holders, function (holder) {
    holder.setAttribute("role", "radiogroup");
    holder.innerHTML = OPTIONS.map(function (o) {
      return '<button type="button" class="theme-picker__btn" role="radio" data-theme-option="' + o.id + '">' +
        ICONS[o.id] + "<span>" + o.label + "</span></button>";
    }).join("");
    var buttons = Array.prototype.slice.call(holder.querySelectorAll("[data-theme-option]"));

    function paint() {
      var pref = Theme.get();
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-theme-option") === pref;
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;       // one tab stop for the group
      });
    }
    holder.addEventListener("click", function (e) {
      var b = e.target.closest("[data-theme-option]");
      if (!b) return;
      Theme.set(b.getAttribute("data-theme-option"));
      paint();
    });
    holder.addEventListener("keydown", function (e) {
      var i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = buttons[(i + 1) % buttons.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = buttons[(i + buttons.length - 1) % buttons.length];
      if (!next) return;
      e.preventDefault();
      next.focus(); next.click();
    });
    window.addEventListener("creditheme", paint);
    paint();
  });

  /* Text Size row (Small / Default / Large / Extra large): same radio-group behavior as the Appearance picker */
  (function () {
    var Size = window.CrediTextSize;
    var holder = document.querySelector("[data-textsize-picker]");
    if (!Size || !holder) return;
    var chipEl = document.getElementById("textsize-current");
    var SIZE_OPTIONS = [
      { id: "small", label: "Small", px: "0.8125rem" },
      { id: "default", label: "Default", px: "1rem" },
      { id: "large", label: "Large", px: "1.25rem" },
      { id: "xlarge", label: "Extra large", px: "1.5rem" }
    ];
    holder.setAttribute("role", "radiogroup");
    holder.innerHTML = SIZE_OPTIONS.map(function (o) {
      return '<button type="button" class="theme-picker__btn" role="radio" data-textsize-option="' + o.id + '">' +
        '<span class="theme-picker__aa" aria-hidden="true" style="font-size:' + o.px + '">Aa</span><span>' + o.label + "</span></button>";
    }).join("");
    var buttons = Array.prototype.slice.call(holder.querySelectorAll("[data-textsize-option]"));
    function paintSize() {
      var cur = Size.get();
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-textsize-option") === cur;
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      if (chipEl) {
        var match = SIZE_OPTIONS.filter(function (o) { return o.id === cur; })[0];
        chipEl.textContent = match ? match.label : "Default";
        chipEl.setAttribute("data-text-size", cur);
      }
    }
    holder.addEventListener("click", function (e) {
      var b = e.target.closest("[data-textsize-option]");
      if (!b) return;
      Size.set(b.getAttribute("data-textsize-option"));
      paintSize();
    });
    holder.addEventListener("keydown", function (e) {
      var i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = buttons[(i + 1) % buttons.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = buttons[(i + buttons.length - 1) % buttons.length];
      if (!next) return;
      e.preventDefault();
      next.focus(); next.click();
    });
    window.addEventListener("credittextsize", paintSize);
    paintSize();
  })();
})();
