/* Record Utang: the whole workflow inside ONE floating modal (no page changes).
   Opens centered above whatever page the owner is on (Dashboard, Customers, Transactions, Customer Details) with a
   slightly dimmed backdrop. The page and its navigation stay visible behind it. Opened through the "record-credit"
   route (js/main.js calls window.RecordUtang.open) from every Record Utang button, the "+" quick actions and
   Customer Details (which passes ?customer=<id> so that customer is already chosen).

   Steps (all in this modal)
   1. Customer   Search first: only the search field shows. Suggestions (name + outstanding balance) appear after typing.
                 No match: "Add New Customer" creates a basic customer from the typed name only (details are optional and
                 edited later on Customers), chooses them and moves on. A name that already exists is reused, never duplicated.
   2. Add items  Item name, quantity (whole number, decimal or fraction such as 1/2), optional unit (typed freely, with autocomplete
                 suggestions), unit price; subtotal = quantity x price; several items; edit and remove; running total.
                 Below the items: "Payment due date", optional. "No due date" is the default button; pressing "Set due date" shows a
                 date picker (today or later). The credit is saved with dueDate "YYYY-MM-DD", or with no dueDate when left on
                 "No due date" (such a credit can never be overdue).
   3. Review     Customer, every item with quantity, unit, price and subtotal, total, due date, balance before and after. Back / Confirm Utang.
   4. Done       Confirm saves ONE credit through CrediTrackApi.addCredit (mock data), shows the reference (TRX-0001 style) and
                 the new balance. Saving is locked while in progress and uses a request id, so repeated clicks never save twice.
   Closing (X, Escape, backdrop) asks before discarding entered items. When the modal is closed after something was
   saved or a customer was added, the page behind reloads so its numbers and lists are up to date. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;

  var CUSTOMERS_VIEW_KEY = "creditrack.customers.view";   // the Customers list restores its search/filter from here
  var STEP_NO = { customer: 1, items: 2, review: 3, done: 3 };
  var EYEBROW = { customer: "Step 1 of 3 \u00B7 Customer", items: "Step 2 of 3 \u00B7 Add items", review: "Step 3 of 3 \u00B7 Review", done: "Utang recorded" };

  var root = null, els = {};
  var state = blank();
  var opener = null;
  var confirmOpen = false, confirmReturn = null;

  function blank() {
    return { step: "customer", data: null, query: "", selectedId: null, active: -1, matches: [], items: [], editing: null,
      requestId: null, doneAt: 0, saving: false, adding: false, result: null, dueMode: "none", dueDate: "", dirty: state ? state.dirty : false };
  }

  // ---------- Small helpers ----------
  function peso(n) { return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function initials(name) { return name.split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase(); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function qtyText(n) { return String(Number(n)); }
  // Quantity as the owner entered it (e.g. "1/2") plus the optional unit: "1/2 kg".
  function qtyLabel(item) { return (item.qtyText || qtyText(item.qty)) + (item.unit ? " " + item.unit : ""); }
  function sub(item) { return round2(item.qty * item.price); }
  function total() { return round2(state.items.reduce(function (sum, it) { return sum + sub(it); }, 0)); }
  function store(key, value) { try { if (value === null) window.sessionStorage.removeItem(key); else window.sessionStorage.setItem(key, value); } catch (e) { /* ignore */ } }
  function find(id) {
    if (id === null || id === undefined || !state.data) return null;
    return state.data.customers.filter(function (c) { return String(c.id) === String(id); })[0] || null;
  }
  function dateTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) + " \u00B7 " + d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  }

  // ---------- Due date helpers (plain dates "YYYY-MM-DD" in local time, never shifted by a time zone) ----------
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayISO() { return isoDate(new Date()); }
  function maxDueISO() { var d = new Date(); return isoDate(new Date(d.getFullYear() + 5, d.getMonth(), d.getDate())); }
  function parseISO(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isoDate(d) === text ? d : null;   // rejects 2026-02-31 and the like
  }
  function dueText(iso) {
    var d = parseISO(iso);
    return d ? d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) : "No due date";
  }
  // The due date to save: null for "No due date", otherwise the picked date. Returns { value, error }.
  function readDue() {
    if (state.dueMode !== "set") return { value: null, error: "" };
    var v = state.dueDate;
    if (!v) return { value: null, error: "Pick a due date, or choose No due date." };
    if (!parseISO(v)) return { value: null, error: "Enter a valid due date." };
    if (v < todayISO()) return { value: null, error: "The due date cannot be in the past." };
    if (v > maxDueISO()) return { value: null, error: "That due date is too far away. Choose a date within 5 years." };
    return { value: v, error: "" };
  }

  function svg(paths, size, width) {
    return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (width || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON_CREDIT = svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h10M7 14h5"/>', 24, 1.8);
  var ICON_SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18, 1.9);
  var ICON_X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 18, 2.2);
  var ICON_EDIT = svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', 17, 1.9);
  var ICON_TRASH = svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 19l1-12M9 7V4.5A.5.5 0 0 1 9.5 4h5a.5.5 0 0 1 .5.5V7"/>', 17, 1.8);
  var ICON_CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 30, 2.6);
  var ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>', 18, 2.2);

  // ---------- Build the modal once ----------
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "ru";
    root.hidden = true;
    root.innerHTML =
      '<div class="ru__backdrop" data-act="close"></div>' +
      '<div class="ru__dialog" role="dialog" aria-modal="true" aria-labelledby="ru-title" tabindex="-1" data-step="customer">' +
        '<header class="ru__head">' +
          '<span class="ru__badge">' + ICON_CREDIT + "</span>" +
          '<div class="ru__heading"><p class="ru__eyebrow" id="ru-eyebrow"></p><h2 class="ru__title" id="ru-title">Record Utang</h2></div>' +
          '<button class="ru__close" type="button" data-act="close" aria-label="Close Record Utang">' + ICON_X + "</button>" +
          '<div class="ru__steps" id="ru-steps" aria-hidden="true"><span></span><span></span><span></span></div>' +
        "</header>" +
        '<div class="ru__body" id="ru-body">' +

          /* 1. Customer */
          '<section class="ru__panel" data-panel="customer">' +
            '<label class="ru__label" for="ru-search">Who bought on utang?</label>' +
            '<p class="ru__hint">Type the customer&rsquo;s name to find them.</p>' +
            '<div class="ru-search">' +
              '<span class="ru-search__icon">' + ICON_SEARCH + "</span>" +
              '<input class="input ru-search__input" id="ru-search" type="text" placeholder="Search customer name" autocomplete="off" autocapitalize="words" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="ru-list" aria-autocomplete="list">' +
              '<button class="ru-search__clear" type="button" id="ru-clear" aria-label="Clear search" hidden>' + ICON_X + "</button>" +
            "</div>" +
            '<ul class="ru-list" id="ru-list" role="listbox" aria-label="Matching customers" hidden></ul>' +
            '<div class="ru-none" id="ru-none" hidden>' +
              '<p class="ru-none__title" id="ru-none-title"></p>' +
              '<p class="ru-none__text" id="ru-none-text">Not on your list yet. Adding them uses just the name, and you can complete their details later in Customers.</p>' +
              '<p class="ru-none__error" id="ru-none-error" role="alert" hidden></p>' +
              '<button class="btn btn--primary" type="button" id="ru-add">Add New Customer</button>' +
            "</div>" +
            '<div class="ru-chosen" id="ru-chosen" hidden>' +
              '<span class="ru-avatar" id="ru-chosen-avatar" aria-hidden="true"></span>' +
              '<span class="ru-chosen__main"><span class="ru-chosen__name" id="ru-chosen-name"></span><span class="ru-chosen__bal" id="ru-chosen-bal"></span></span>' +
              '<button class="ru-chosen__change" type="button" id="ru-change">Change</button>' +
            "</div>" +
          "</section>" +

          /* 2. Add items */
          '<section class="ru__panel" data-panel="items" hidden>' +
            '<div class="ru-chosen ru-chosen--compact">' +
              '<span class="ru-avatar" id="ru-who-avatar" aria-hidden="true"></span>' +
              '<span class="ru-chosen__main"><span class="ru-chosen__name" id="ru-who-name"></span><span class="ru-chosen__bal" id="ru-who-bal"></span></span>' +
              '<button class="ru-chosen__change" type="button" data-act="change-customer">Change</button>' +
            "</div>" +
            '<form class="ru-item" id="ru-form" novalidate>' +
              '<h3 class="ru-item__title" id="ru-form-title">Add an item</h3>' +
              '<div class="ru-field"><label for="ru-iname">Item name</label>' +
                '<input class="input" id="ru-iname" type="text" maxlength="60" placeholder="e.g. Rice, Sardines" autocomplete="off" autocapitalize="sentences" aria-describedby="ru-iname-err">' +
                '<p class="ru-field__error" id="ru-iname-err" hidden></p></div>' +
              '<div class="ru-item__row">' +
                '<div class="ru-field ru-field--qty"><label for="ru-iqty">Quantity</label>' +
                  '<div class="ru-ac">' +
                    '<input class="input" id="ru-iqty" type="text" inputmode="text" maxlength="12" placeholder="1" autocomplete="off" autocapitalize="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ru-iqty-list" aria-describedby="ru-iqty-err">' +
                    '<ul class="ru-ac__list" id="ru-iqty-list" role="listbox" aria-label="Quantity suggestions" hidden></ul>' +
                  "</div>" +
                  '<p class="ru-field__error" id="ru-iqty-err" hidden></p></div>' +
                '<div class="ru-field ru-field--unit"><label for="ru-iunit">Unit <span class="ru-field__opt">(optional)</span></label>' +
                  '<div class="ru-ac">' +
                    '<input class="input" id="ru-iunit" type="text" maxlength="20" placeholder="e.g. kg" autocomplete="off" autocapitalize="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ru-iunit-list" aria-describedby="ru-iunit-err">' +
                    '<ul class="ru-ac__list" id="ru-iunit-list" role="listbox" aria-label="Unit suggestions" hidden></ul>' +
                  "</div>" +
                  '<p class="ru-field__error" id="ru-iunit-err" hidden></p></div>' +
                '<div class="ru-field"><label for="ru-iprice">Unit price (\u20B1)</label>' +
                  '<input class="input" id="ru-iprice" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" aria-describedby="ru-iprice-err">' +
                  '<p class="ru-field__error" id="ru-iprice-err" hidden></p></div>' +
              "</div>" +
              '<p class="ru-item__sub">Subtotal <strong id="ru-isub">\u20B10.00</strong></p>' +
              '<div class="ru-item__actions">' +
                '<button class="btn btn--secondary" type="submit" id="ru-iadd">' + ICON_PLUS + '<span id="ru-iadd-text">Add Item</span></button>' +
                '<button class="btn btn--ghost" type="button" id="ru-icancel" hidden>Cancel edit</button>' +
              "</div>" +
            "</form>" +
            '<div class="ru-items">' +
              '<h3 class="ru-items__title">Items <span id="ru-items-count"></span></h3>' +
              '<p class="ru-items__empty" id="ru-items-empty">No items yet. Add what the customer took on utang.</p>' +
              '<ul class="ru-items__list" id="ru-items" hidden></ul>' +
            "</div>" +
            '<fieldset class="ru-due" aria-describedby="ru-due-hint">' +
              '<legend class="ru-due__title">Payment due date <span class="ru-field__opt">(optional)</span></legend>' +
              '<div class="ru-due__toggle" role="group" aria-label="Payment due date">' +
                '<button class="ru-due__btn is-on" type="button" id="ru-due-none" data-act="due-none" aria-pressed="true">No due date</button>' +
                '<button class="ru-due__btn" type="button" id="ru-due-set" data-act="due-set" aria-pressed="false">Set due date</button>' +
              "</div>" +
              '<div class="ru-due__pick" id="ru-due-pick" hidden>' +
                '<label class="ru-due__label" for="ru-due-input">Customer will pay on</label>' +
                '<input class="input" id="ru-due-input" type="date" aria-describedby="ru-due-err">' +
              "</div>" +
              '<p class="ru-due__hint" id="ru-due-hint">Leave it on No due date if there is no agreed payment date. You can add one later.</p>' +
              '<p class="ru-field__error" id="ru-due-err" role="alert" hidden></p>' +
            "</fieldset>" +
            '<p class="ru-items__error" id="ru-items-error" role="alert" hidden></p>' +
          "</section>" +

          /* 3. Review */
          '<section class="ru__panel" data-panel="review" hidden>' +
            '<p class="ru__hint ru__hint--top">Check everything before saving. Nothing is saved until you press Confirm Utang.</p>' +
            '<div class="ru-sum">' +
              '<p class="ru-sum__label">Customer</p>' +
              '<div class="ru-chosen ru-chosen--plain"><span class="ru-avatar" id="ru-r-avatar" aria-hidden="true"></span>' +
                '<span class="ru-chosen__main"><span class="ru-chosen__name" id="ru-r-name"></span><span class="ru-chosen__bal" id="ru-r-bal"></span></span></div>' +
            "</div>" +
            '<div class="ru-sum">' +
              '<p class="ru-sum__label">Items</p>' +
              '<ul class="ru-rev" id="ru-r-items"></ul>' +
            "</div>" +
            '<dl class="ru-totals">' +
              '<div class="ru-totals__main"><dt>Total utang</dt><dd id="ru-r-total"></dd></div>' +
              '<div><dt>Due date</dt><dd id="ru-r-due"></dd></div>' +
              '<div><dt>Balance now</dt><dd id="ru-r-before"></dd></div>' +
              '<div><dt>Balance after this utang</dt><dd id="ru-r-after"></dd></div>' +
            "</dl>" +
            '<p class="ru-items__error" id="ru-save-error" role="alert" hidden></p>' +
          "</section>" +

          /* 4. Done */
          '<section class="ru__panel ru-done" data-panel="done" hidden>' +
            '<span class="ru-done__icon">' + ICON_CHECK + "</span>" +
            '<h3 class="ru-done__title">Utang recorded</h3>' +
            '<p class="ru-done__ref">Reference <strong id="ru-d-ref"></strong></p>' +
            '<dl class="ru-totals ru-totals--done">' +
              '<div><dt>Customer</dt><dd id="ru-d-name"></dd></div>' +
              '<div><dt>Items</dt><dd id="ru-d-count"></dd></div>' +
              '<div class="ru-totals__main"><dt>Total utang</dt><dd id="ru-d-total"></dd></div>' +
              '<div><dt>Due date</dt><dd id="ru-d-due"></dd></div>' +
              '<div><dt>New outstanding balance</dt><dd id="ru-d-balance"></dd></div>' +
              '<div><dt>Recorded</dt><dd id="ru-d-when"></dd></div>' +
            "</dl>" +
          "</section>" +
        "</div>" +
        '<footer class="ru__foot" id="ru-foot" hidden></footer>' +

        /* Asks before discarding entered information */
        '<div class="ru-confirm" id="ru-confirm" hidden>' +
          '<div class="ru-confirm__card" role="alertdialog" aria-modal="true" aria-labelledby="ru-confirm-title" aria-describedby="ru-confirm-text">' +
            '<h3 class="ru-confirm__title" id="ru-confirm-title">Discard this utang?</h3>' +
            '<p class="ru-confirm__text" id="ru-confirm-text">The items you entered have not been saved. If you close now, they will be lost.</p>' +
            '<div class="ru-confirm__actions">' +
              '<button class="btn btn--primary" type="button" data-act="keep">Keep editing</button>' +
              '<button class="btn btn--danger-outline" type="button" data-act="discard">Discard</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    root.querySelectorAll("[id]").forEach(function (el) { els[el.id.replace(/^ru-/, "")] = el; });
    els.dialog = root.querySelector(".ru__dialog");
    els.panels = root.querySelectorAll("[data-panel]");
    els.stepbars = els.steps.querySelectorAll("span");

    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onDialogKey);

    // Step 1
    els.search.addEventListener("input", function () {
      state.query = els.search.value;
      state.selectedId = null;                       // typing again means choosing someone else
      state.active = -1;
      renderCustomer();
    });
    els.search.addEventListener("keydown", onSearchKey);
    els.clear.addEventListener("click", function () { resetCustomer(); els.search.focus(); });
    els.change.addEventListener("click", function () { resetCustomer(); els.search.focus(); });
    els.list.addEventListener("click", function (event) { var opt = event.target.closest("[data-id]"); if (opt) choose(opt.getAttribute("data-id")); });
    els.list.addEventListener("mousemove", function (event) { var opt = event.target.closest("[data-id]"); if (opt) setActive(Number(opt.getAttribute("data-index")), false); });
    els.add.addEventListener("click", addNewCustomer);

    // Step 2
    els.form.addEventListener("submit", function (event) { event.preventDefault(); submitItem(); });
    [els.iname, els.iqty, els.iunit, els.iprice].forEach(function (input) {
      input.addEventListener("input", function () { clearFieldError(input); updateSubtotal(); els["items-error"].hidden = true; });
    });
    autocomplete(els.iqty, els["iqty-list"], quantitySuggestions);
    autocomplete(els.iunit, els["iunit-list"], unitSuggestions);
    els.icancel.addEventListener("click", cancelEdit);
    els["due-input"].addEventListener("input", function () { state.dueDate = els["due-input"].value; setDueError(""); });
    els["due-input"].addEventListener("change", function () { state.dueDate = els["due-input"].value; setDueError(""); });
    els.items.addEventListener("click", function (event) {
      var b = event.target.closest("[data-item-act]");
      if (!b) return;
      var i = Number(b.getAttribute("data-index"));
      if (b.getAttribute("data-item-act") === "edit") startEdit(i); else removeItem(i);
    });
  }

  function onClick(event) {
    var el = event.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var act = el.getAttribute("data-act");
    if (act === "close") {
      if (state.step === "done" && Date.now() - state.doneAt < 900) return;   // a double-tap on Confirm must not dismiss the result
      requestClose();
    }
    else if (act === "keep") hideConfirm();
    else if (act === "discard") { hideConfirm(); state.items = []; close(); }
    else if (act === "continue") goItems();
    else if (act === "due-none") setDueMode("none");
    else if (act === "due-set") setDueMode("set");
    else if (act === "change-customer") { resetCustomer(); setStep("customer"); els.search.focus(); }
    else if (act === "back-customer") setStep("customer");
    else if (act === "review") goReview();
    else if (act === "back-items") setStep("items");
    else if (act === "confirm") confirmUtang();
    else if (act === "another") recordAnother();
    else if (act === "done") close();
  }

  // ---------- Steps ----------
  function setStep(step) {
    state.step = step;
    els.dialog.setAttribute("data-step", step);
    els.panels.forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== step; });
    els.eyebrow.textContent = EYEBROW[step];
    els.stepbars.forEach(function (bar, i) {
      bar.className = step === "done" || i + 1 < STEP_NO[step] ? "is-done" : i + 1 === STEP_NO[step] ? "is-current" : "";
    });
    if (step === "customer") renderCustomer();
    if (step === "items") renderItemsStep();
    if (step === "review") renderReview();
    if (step === "done") renderDone();
    renderFoot();
    // The Done buttons sit where Confirm Utang was: ignore taps for a moment so a quick double-tap on Confirm
    // cannot land on "Done" or "Record Another" right after saving.
    if (step === "done") {
      state.doneAt = Date.now();
      var guarded = els.foot.querySelectorAll("button");
      guarded.forEach(function (b) { b.disabled = true; });
      setTimeout(function () { if (state.step === "done") guarded.forEach(function (b) { b.disabled = false; }); }, 900);
    }
    els.body.scrollTop = 0;
    if (step === "customer") { if (!find(state.selectedId)) els.search.focus({ preventScroll: true }); }
    else if (step === "items") els.iname.focus({ preventScroll: true });
    else els.dialog.focus({ preventScroll: true });
  }

  function footBtn(act, label, kind, extra) {
    return '<button class="btn btn--' + kind + '" type="button" data-act="' + act + '"' + (extra || "") + ">" + label + "</button>";
  }
  function renderFoot() {
    var s = state.step, h = "";
    if (s === "customer") {
      if (find(state.selectedId)) h = footBtn("continue", "Continue", "primary btn--block");
    } else if (s === "items") {
      h = '<p class="ru__total"><span>Total utang</span><strong id="ru-total">' + peso(total()) + "</strong></p>" +
        '<div class="ru__actions">' + footBtn("back-customer", "Back", "secondary") +
        footBtn("review", "Review Utang", "primary", state.items.length ? "" : " disabled") + "</div>";
    } else if (s === "review") {
      h = '<div class="ru__actions">' + footBtn("back-items", "Back", "secondary", state.saving ? " disabled" : "") +
        footBtn("confirm", state.saving ? "Saving\u2026" : "Confirm Utang", "primary", state.saving ? ' disabled aria-busy="true"' : "") + "</div>";
    } else if (s === "done") {
      h = '<div class="ru__actions">' + footBtn("another", "Record Another", "secondary") + footBtn("done", "Done", "primary") + "</div>";
    }
    els.foot.innerHTML = h;
    els.foot.hidden = !h;
  }

  // ---------- Step 1: customer ----------
  function search(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    // Archived customers can never be picked for new utang
    var hits = state.data.customers.filter(function (c) { return !c.archived && c.name.toLowerCase().indexOf(q) !== -1; });
    hits.sort(function (a, b) {
      var sa = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1, sb = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
      return sa - sb || a.name.localeCompare(b.name);
    });
    return hits;
  }
  function highlight(name, query) {
    var q = query.trim().toLowerCase(), i = q ? name.toLowerCase().indexOf(q) : -1;
    if (i === -1) return esc(name);
    return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length));
  }
  function option(c, index) {
    var debt = c.balance > 0;
    return '<li class="ru-opt" role="option" id="ru-opt-' + index + '" data-id="' + esc(String(c.id)) + '" data-index="' + index + '" aria-selected="false">' +
      '<span class="ru-avatar" aria-hidden="true">' + esc(initials(c.name)) + "</span>" +
      '<span class="ru-opt__main">' + highlight(c.name, state.query) + "</span>" +
      '<span class="ru-opt__side"><span class="ru-opt__amount' + (debt ? "" : " is-paid") + '">' + peso(c.balance) + "</span>" +
      '<span class="ru-opt__note' + (c.overdueDays > 0 ? " is-overdue" : "") + '">' + (c.overdueDays > 0 ? "Overdue" : debt ? "Outstanding" : "Fully paid") + "</span></span></li>";
  }
  function setAddError(message) { els["none-error"].textContent = message || ""; els["none-error"].hidden = !message; }

  function renderCustomer() {
    var chosen = find(state.selectedId);
    var typing = !!state.query.trim();
    els.clear.hidden = !state.query;
    if (chosen) {
      state.matches = [];
      els.list.hidden = true; els.list.innerHTML = "";
      els.none.hidden = true;
      els.chosen.hidden = false;
      els["chosen-avatar"].textContent = initials(chosen.name);
      els["chosen-name"].textContent = chosen.name;
      els["chosen-bal"].textContent = chosen.balance > 0 ? peso(chosen.balance) + " outstanding" : "Fully paid";
      els.search.setAttribute("aria-expanded", "false");
      els.search.removeAttribute("aria-activedescendant");
    } else {
      els.chosen.hidden = true;
      state.matches = typing ? search(state.query) : [];
      var has = state.matches.length > 0;
      els.list.hidden = !has;
      els.list.innerHTML = has ? state.matches.map(option).join("") : "";
      els.search.setAttribute("aria-expanded", String(has));
      // "Add New Customer" only when something was typed and nobody matches. Never while matches are shown.
      els.none.hidden = !(typing && !has);
      if (!(typing && !has)) setAddError("");
      if (typing && !has) els["none-title"].textContent = "No customer found for \u201C" + state.query.trim() + "\u201D";
      // The name belongs to an archived customer: say so (they can be restored from Customers > Archived)
      var q = state.query.trim().toLowerCase();
      var archivedHit = typing && !has && state.data.customers.some(function (c) { return c.archived && c.name.toLowerCase().indexOf(q) !== -1; });
      var noneText = document.getElementById("ru-none-text");
      if (noneText) noneText.textContent = archivedHit
        ? "A customer with this name is archived. Restore them from Customers > Archived to record new utang."
        : "Not on your list yet. Adding them uses just the name, and you can complete their details later in Customers.";
      els.add.hidden = !!archivedHit;
      setActive(state.active >= state.matches.length ? -1 : state.active, false);
    }
    if (state.step === "customer") renderFoot();
  }

  function setActive(index, scroll) {
    state.active = index;
    els.list.querySelectorAll(".ru-opt").forEach(function (li, i) {
      var on = i === index;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", String(on));
      if (on && scroll) li.scrollIntoView({ block: "nearest" });
    });
    if (index >= 0) els.search.setAttribute("aria-activedescendant", "ru-opt-" + index);
    else els.search.removeAttribute("aria-activedescendant");
  }

  function choose(id) {
    var c = find(id);
    if (!c) return;
    state.selectedId = c.id;
    state.query = c.name;
    els.search.value = c.name;
    renderCustomer();
    var go = els.foot.querySelector("[data-act=continue]");
    if (go) go.focus({ preventScroll: true });
  }
  function resetCustomer() {
    state.query = ""; state.selectedId = null; state.active = -1;
    els.search.value = "";
    renderCustomer();
  }
  function onSearchKey(event) {
    var n = state.matches.length;
    if (event.key === "ArrowDown" && n) { event.preventDefault(); setActive(state.active < n - 1 ? state.active + 1 : 0, true); }
    else if (event.key === "ArrowUp" && n) { event.preventDefault(); setActive(state.active > 0 ? state.active - 1 : n - 1, true); }
    else if (event.key === "Enter") {
      event.preventDefault();
      if (state.active >= 0 && state.matches[state.active]) choose(state.matches[state.active].id);
      else if (n === 1) choose(state.matches[0].id);
      else if (find(state.selectedId)) goItems();
    }
  }

  function goItems() {
    if (!find(state.selectedId)) return;
    setStep("items");
  }

  // "Add New Customer": create a basic record from the typed name only, choose it and go straight to Add Items.
  function addNewCustomer() {
    if (state.adding) return;
    var name = state.query.trim().replace(/\s+/g, " ");
    if (name.length < 2 || !/[A-Za-z\u00D1\u00F1]/.test(name)) { setAddError("Enter a valid customer name."); els.search.focus(); return; }
    if (name.length > 60) { setAddError("Use a name of 60 characters or fewer."); els.search.focus(); return; }
    setAddError("");
    state.adding = true;
    els.add.disabled = true;
    // Check the latest list first so the same person is never added twice.
    api.getCustomers().then(function (data) {
      state.data = data;
      var existing = data.customers.filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })[0];
      if (existing && existing.archived) { var e = new Error(existing.name + " is archived. Restore the customer from Customers > Archived to record new utang."); throw e; }
      if (existing) return { customer: existing, created: false };
      return api.addCustomer({ name: name }).then(function (c) { return { customer: c, created: true }; });
    }).then(function (result) {
      state.adding = false; els.add.disabled = false;
      if (result.created) {
        state.data.customers.push(result.customer);
        state.dirty = true;                          // the page behind reloads on close so Customers shows them
        store(CUSTOMERS_VIEW_KEY, JSON.stringify({ query: "", filter: "all" }));   // show everyone, not an old search
        if (window.CrediTrack) window.CrediTrack.showToast("Customer added.");
      }
      state.selectedId = result.customer.id;
      state.query = result.customer.name;
      els.search.value = state.query;
      goItems();
    }).catch(function (err) {
      state.adding = false; els.add.disabled = false;
      setAddError(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  }

  // ---------- Step 2: items ----------
  function renderWho() {
    var c = find(state.selectedId);
    if (!c) return;
    els["who-avatar"].textContent = initials(c.name);
    els["who-name"].textContent = c.name;
    els["who-bal"].textContent = c.balance > 0 ? peso(c.balance) + " outstanding" : "Fully paid";
  }

  function renderItemsStep() {
    renderWho();
    renderItems();
  }

  function renderItems() {
    var n = state.items.length;
    els["items-empty"].hidden = n > 0;
    els.items.hidden = n === 0;
    els["items-count"].textContent = n ? "(" + n + ")" : "";
    els.items.innerHTML = state.items.map(function (it, i) {
      return '<li class="ru-row' + (state.editing === i ? " is-editing" : "") + '">' +
        '<span class="ru-row__main"><span class="ru-row__name">' + esc(it.name) + "</span>" +
        '<span class="ru-row__calc">' + esc(qtyLabel(it)) + " \u00D7 " + peso(it.price) + "</span></span>" +
        '<span class="ru-row__sub">' + peso(sub(it)) + "</span>" +
        '<span class="ru-row__tools">' +
          '<button class="ru-icon" type="button" data-item-act="edit" data-index="' + i + '" aria-label="Edit ' + esc(it.name) + '">' + ICON_EDIT + "</button>" +
          '<button class="ru-icon ru-icon--danger" type="button" data-item-act="remove" data-index="' + i + '" aria-label="Remove ' + esc(it.name) + '">' + ICON_TRASH + "</button>" +
        "</span></li>";
    }).join("");
    if (state.step === "items") renderFoot();
  }

  function parseAmount(raw) { return Number(String(raw).replace(/,/g, "").replace(/^\u20B1/, "").trim()); }
  var NUMBER = /^\d+(\.\d{1,2})?$/;
  function clean(raw) { return String(raw).replace(/,/g, "").replace(/^\u20B1/, "").trim(); }

  // Quantity: whole number (2), decimal (0.5, .5) or fraction (1/2). A mixed number (1 1/2) is accepted too.
  // Returns { text, value } with text as entered (tidied) and value the number used for the subtotal, or null when invalid.
  // A fraction is converted exactly (1/4 -> 0.25, 1/8 -> 0.125, 1/3 -> 0.333333) so quantity x price stays correct.
  function parseQty(raw) {
    var t = String(raw).replace(/,/g, "").trim().replace(/\s+/g, " "), m, value;
    if (/^\d+$/.test(t) || /^(\d+)?\.\d{1,4}$|^\d+\.\d{1,4}$/.test(t)) value = Number(t);
    else if ((m = /^(\d+) ?\/ ?(\d+)$/.exec(t))) { if (Number(m[2]) === 0) return { bad: "zero" }; t = m[1] + "/" + m[2]; value = Number(m[1]) / Number(m[2]); }
    else if ((m = /^(\d+) (\d+) ?\/ ?(\d+)$/.exec(t))) { if (Number(m[3]) === 0) return { bad: "zero" }; t = m[1] + " " + m[2] + "/" + m[3]; value = Number(m[1]) + Number(m[2]) / Number(m[3]); }
    else return null;
    return { text: t, value: Math.round(value * 1000000) / 1000000 };
  }

  // Returns { errors: {name, qty, price}, item } (item only when everything is valid).
  function validateItem() {
    var name = els.iname.value.trim().replace(/\s+/g, " "), qtyRaw = els.iqty.value.trim(), unit = els.iunit.value.trim().replace(/\s+/g, " "),
      price = clean(els.iprice.value), errors = {}, q = qtyRaw ? parseQty(qtyRaw) : null;
    if (!name) errors.name = "Enter the item name.";
    else if (name.length > 60) errors.name = "Use 60 characters or fewer.";
    if (!qtyRaw) errors.qty = "Enter the quantity.";
    else if (q && q.bad) errors.qty = "The bottom number of a fraction cannot be 0.";
    else if (!q) errors.qty = "Use a number like 2, 0.5 or 1/2.";
    else if (q.value <= 0) errors.qty = "Must be more than 0.";
    else if (q.value > 9999) errors.qty = "That is too many.";
    if (unit.length > 20) errors.unit = "Use 20 characters or fewer.";
    if (!price) errors.price = "Enter the unit price.";
    else if (!NUMBER.test(price)) errors.price = "Use an amount like 25 or 12.50.";
    else if (Number(price) <= 0) errors.price = "Must be more than 0.";
    else if (Number(price) > 100000) errors.price = "That price is too high.";
    var ok = !errors.name && !errors.qty && !errors.unit && !errors.price;
    return { errors: errors, item: ok ? { name: name, qty: q.value, qtyText: q.text, unit: unit, price: Number(price) } : null };
  }
  function setFieldError(input, message) {
    var box = els[input.id.replace(/^ru-/, "") + "-err"];
    box.textContent = message || "";
    box.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }
  function clearFieldError(input) { setFieldError(input, ""); }
  function formHasText() { return !!(els.iname.value.trim() || els.iqty.value.trim() || els.iprice.value.trim()); }

  function updateSubtotal() {
    var q = parseQty(els.iqty.value), p = clean(els.iprice.value);
    els.isub.textContent = q && !q.bad && NUMBER.test(p) ? peso(round2(q.value * Number(p))) : "\u20B10.00";
  }
  function clearForm() {
    [els.iname, els.iqty, els.iunit, els.iprice].forEach(function (i) { i.value = ""; clearFieldError(i); });
    closeSuggestions();
    updateSubtotal();
  }

  // Add (or save an edit of) the item in the form. Returns true when it was valid.
  function submitItem() {
    var v = validateItem();
    setFieldError(els.iname, v.errors.name); setFieldError(els.iqty, v.errors.qty); setFieldError(els.iunit, v.errors.unit); setFieldError(els.iprice, v.errors.price);
    if (!v.item) {
      (v.errors.name ? els.iname : v.errors.qty ? els.iqty : v.errors.unit ? els.iunit : els.iprice).focus();
      return false;
    }
    if (state.editing !== null) state.items[state.editing] = v.item; else state.items.push(v.item);
    els["items-error"].hidden = true;
    endEditUi();
    clearForm();
    renderItems();
    els.iname.focus({ preventScroll: true });
    return true;
  }
  function startEdit(i) {
    var it = state.items[i];
    if (!it) return;
    state.editing = i;
    els.iname.value = it.name; els.iqty.value = it.qtyText || qtyText(it.qty); els.iunit.value = it.unit || ""; els.iprice.value = String(it.price);
    [els.iname, els.iqty, els.iunit, els.iprice].forEach(clearFieldError);
    closeSuggestions();
    updateSubtotal();
    els["form-title"].textContent = "Edit item";
    els["iadd-text"].textContent = "Save Changes";
    els.icancel.hidden = false;
    renderItems();
    els.form.scrollIntoView({ block: "nearest" });
    els.iname.focus({ preventScroll: true });
  }
  function endEditUi() {
    state.editing = null;
    els["form-title"].textContent = "Add an item";
    els["iadd-text"].textContent = "Add Item";
    els.icancel.hidden = true;
  }
  function cancelEdit() { endEditUi(); clearForm(); renderItems(); els.iname.focus({ preventScroll: true }); }
  function removeItem(i) {
    if (state.editing === i) { endEditUi(); clearForm(); }
    else if (state.editing !== null && state.editing > i) state.editing--;
    state.items.splice(i, 1);
    renderItems();
  }

  // ---------- Autocomplete (Quantity and Unit) ----------
  // Not dropdown menus: the owner types freely and suggestions only show while typing, matching the text. Picking one
  // fills the field; anything else typed stays as entered. Suggestions close when the field is empty or loses focus.
  var UNITS = ["kg", "g", "pc", "sachet", "pack", "bottle", "liter", "mL", "can", "bundle"];
  var FRACTION_BOTTOMS = [2, 3, 4, 5, 8, 10];
  var COMMON_QTY = ["1/2", "1/4", "3/4", "1/3", "2/3", "1/8", "1/5", "1/10", "0.25", "0.5", "0.75"];
  var activeAc = null;

  function quantitySuggestions(raw) {
    var t = raw.trim(), m, out = [];
    if (!t) return out;
    if ((m = /^(\d+) ?\/ ?(\d*)$/.exec(t))) {                      // "1/" or "1/1": complete the fraction
      FRACTION_BOTTOMS.forEach(function (d) { if (String(d).indexOf(m[2]) === 0 && Number(m[1]) !== 0) out.push(m[1] + "/" + d); });
    } else if (/^\d+$/.test(t)) {                                    // "1": common fractions that start with it
      out = COMMON_QTY.filter(function (c) { return c.indexOf("/") !== -1 && c.indexOf(t) === 0; });
    } else if (/^\d*\.\d*$/.test(t)) {                              // "0." or ".": common decimals
      out = COMMON_QTY.filter(function (c) { return c.indexOf(".") !== -1 && c.replace(/^0/, "").indexOf(t.replace(/^0/, "")) === 0; });
    }
    return out.filter(function (c) { return c !== t; });
  }
  function unitSuggestions(raw) {
    var t = raw.trim().toLowerCase();
    if (!t) return [];
    var starts = UNITS.filter(function (u) { return u.toLowerCase().indexOf(t) === 0; });
    var inside = UNITS.filter(function (u) { return u.toLowerCase().indexOf(t) > 0; });
    return starts.concat(inside).filter(function (u) { return u !== raw.trim(); });
  }

  function closeSuggestions() { if (activeAc) activeAc.close(); }

  function autocomplete(input, list, getSuggestions) {
    var shown = [], active = -1;
    function close() {
      list.hidden = true; list.innerHTML = ""; shown = []; active = -1;
      input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
      if (activeAc === api2) activeAc = null;
    }
    function highlight(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, k) {
        li.classList.toggle("is-active", k === i); li.setAttribute("aria-selected", String(k === i));
        if (k === i) li.scrollIntoView({ block: "nearest" });
      });
      if (i >= 0) input.setAttribute("aria-activedescendant", list.children[i].id); else input.removeAttribute("aria-activedescendant");
    }
    function pick(value) {
      input.value = value;
      close();
      clearFieldError(input); updateSubtotal(); els["items-error"].hidden = true;
      input.focus({ preventScroll: true });
    }
    function refresh() {
      if (!input.value.trim() || document.activeElement !== input) { close(); return; }
      shown = getSuggestions(input.value);
      if (!shown.length) { close(); return; }
      if (activeAc && activeAc !== api2) activeAc.close();
      activeAc = api2;
      list.innerHTML = shown.map(function (v, i) {
        return '<li class="ru-ac__opt" role="option" id="' + list.id + "-" + i + '" data-value="' + esc(v) + '" aria-selected="false">' + esc(v) + "</li>";
      }).join("");
      list.hidden = false; active = -1;
      input.setAttribute("aria-expanded", "true"); input.removeAttribute("aria-activedescendant");
      list.scrollIntoView({ block: "nearest" });
    }
    var api2 = { close: close };
    input.addEventListener("input", refresh);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", function (event) {
      if (list.hidden) return;
      var n = shown.length;
      if (event.key === "ArrowDown") { event.preventDefault(); highlight(active < n - 1 ? active + 1 : 0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); highlight(active > 0 ? active - 1 : n - 1); }
      else if (event.key === "Enter" && active >= 0) { event.preventDefault(); pick(shown[active]); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }   // closes the suggestions only, not the modal
    });
    // mousedown (not click) so the input keeps focus and its blur does not close the list before the pick lands
    list.addEventListener("mousedown", function (event) {
      event.preventDefault();
      var opt = event.target.closest("[data-value]");
      if (opt) pick(opt.getAttribute("data-value"));
    });
    list.addEventListener("mousemove", function (event) {
      var opt = event.target.closest("[data-value]");
      if (opt) highlight(Array.prototype.indexOf.call(list.children, opt));
    });
  }

  // ---------- Payment due date (optional, on the Add items step) ----------
  function setDueError(message) {
    els["due-err"].textContent = message || "";
    els["due-err"].hidden = !message;
    if (message) els["due-input"].setAttribute("aria-invalid", "true"); else els["due-input"].removeAttribute("aria-invalid");
  }
  // Shows the buttons and the date picker for state.dueMode / state.dueDate.
  function syncDueUi() {
    var set = state.dueMode === "set";
    els["due-none"].classList.toggle("is-on", !set); els["due-none"].setAttribute("aria-pressed", String(!set));
    els["due-set"].classList.toggle("is-on", set); els["due-set"].setAttribute("aria-pressed", String(set));
    els["due-pick"].hidden = !set;
    els["due-input"].min = todayISO();
    els["due-input"].max = maxDueISO();
    els["due-input"].value = set ? state.dueDate : "";
    setDueError("");
  }
  function setDueMode(mode) {
    state.dueMode = mode;
    if (mode === "none") state.dueDate = "";          // No due date: any picked date is dropped
    syncDueUi();
    if (mode === "set") els["due-input"].focus({ preventScroll: true });
  }

  // ---------- Step 3: review ----------
  function goReview() {
    // An item typed in the form but not added yet is added first (when valid) so nothing is lost.
    if (formHasText() && !submitItem()) return;
    if (!state.items.length) {
      els["items-error"].textContent = "Add at least one item to continue.";
      els["items-error"].hidden = false;
      return;
    }
    var due = readDue();
    if (due.error) { setDueError(due.error); els["due-input"].focus(); return; }
    setStep("review");
  }
  function renderReview() {
    var c = find(state.selectedId), t = total();
    els["r-avatar"].textContent = initials(c.name);
    els["r-name"].textContent = c.name;
    els["r-bal"].textContent = c.balance > 0 ? "Currently owes " + peso(c.balance) : "No balance right now";
    els["r-items"].innerHTML = state.items.map(function (it) {
      return '<li><span class="ru-rev__main"><span class="ru-rev__name">' + esc(it.name) + '</span><span class="ru-rev__calc">' +
        esc(qtyLabel(it)) + " \u00D7 " + peso(it.price) + '</span></span><span class="ru-rev__sub">' + peso(sub(it)) + "</span></li>";
    }).join("");
    els["r-total"].textContent = peso(t);
    els["r-due"].textContent = state.dueMode === "set" && state.dueDate ? dueText(state.dueDate) : "No due date";
    els["r-before"].textContent = peso(c.balance || 0);
    els["r-after"].textContent = peso(round2((c.balance || 0) + t));
    els["save-error"].hidden = true;
  }

  // ---------- Confirm Utang ----------
  function confirmUtang() {
    if (state.saving || state.step !== "review" || !state.items.length) return;   // a second click while saving does nothing
    state.saving = true;
    els["save-error"].hidden = true;
    renderFoot();
    // One request id per attempt: even if this ran twice, the data layer returns the first saved transaction.
    if (!state.requestId) state.requestId = "ru-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    var due = readDue();
    if (due.error) { state.saving = false; setStep("items"); setDueError(due.error); return; }
    var payload = { customerId: state.selectedId, items: state.items, requestId: state.requestId };
    if (due.value) payload.dueDate = due.value;       // left out entirely for "No due date"
    api.addCredit(payload).then(function (res) {
      state.result = res;
      state.dirty = true;
      state.saving = false;
      var c = find(state.selectedId);
      if (c && res.customer) c.balance = res.customer.balance;
      setStep("done");
    }).catch(function (err) {
      state.saving = false;
      els["save-error"].textContent = err && err.message ? err.message : "Could not save. Please try again.";
      els["save-error"].hidden = false;
      renderFoot();
    });
  }
  function renderDone() {
    var r = state.result, t = r.transaction;
    els["d-ref"].textContent = t.code;
    els["d-name"].textContent = r.customer ? r.customer.name : "";
    els["d-count"].textContent = t.items.length + (t.items.length === 1 ? " item" : " items");
    els["d-total"].textContent = peso(t.amount);
    els["d-due"].textContent = t.dueDate ? dueText(t.dueDate) : "No due date";
    els["d-balance"].textContent = peso(r.customer ? r.customer.balance : 0);
    els["d-when"].textContent = dateTime(t.date);
  }
  function recordAnother() {
    var keep = state.dirty;
    state = blank(); state.dirty = keep;
    endEditUi(); clearForm(); syncDueUi();
    els.search.value = "";
    api.getCustomers().then(function (data) { state.data = data; setStep("customer"); });
  }

  // ---------- Closing ----------
  function hasProgress() {
    return state.step !== "done" && (state.items.length > 0 || (state.step === "items" && formHasText()));
  }
  function requestClose() {
    if (state.saving || state.adding) return;
    if (hasProgress()) showConfirm(); else close();
  }
  function showConfirm() {
    confirmReturn = document.activeElement;
    confirmOpen = true;
    els.confirm.hidden = false;
    els.confirm.querySelector("[data-act=keep]").focus();
  }
  function hideConfirm() {
    confirmOpen = false;
    els.confirm.hidden = true;
    if (confirmReturn && root.contains(confirmReturn)) confirmReturn.focus({ preventScroll: true });
    confirmReturn = null;
  }

  function onDialogKey(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (confirmOpen) hideConfirm(); else requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    var scope = confirmOpen ? els.confirm : els.dialog;
    var items = Array.prototype.filter.call(scope.querySelectorAll("button, a[href], input"), function (el) { return !el.disabled && el.getClientRects().length > 0; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === els.dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  // options: { customerId } chooses a customer up front (Customer Details > Record Utang).
  function open(options) {
    options = options || {};
    build();
    if (!root.hidden) return Promise.resolve();
    opener = document.activeElement;
    var keep = state.dirty;
    state = blank(); state.dirty = keep;
    endEditUi(); clearForm(); syncDueUi(); els.search.value = ""; hideConfirm();
    els["items-error"].hidden = true;
    return api.getCustomers().then(function (data) {
      state.data = data;
      var c = find(options.customerId);
      if (c && c.archived) c = null;   // an archived customer is never preselected; the owner starts at Select Customer
      if (c) { state.selectedId = c.id; state.query = c.name; els.search.value = c.name; }
      root.hidden = false;
      document.documentElement.classList.add("ru-lock");
      // Opened from a customer's details page (customerId given): that customer is already chosen, so Select Customer is
      // skipped and the owner lands on Add Items, where the customer's name is shown. From the Dashboard no customerId is
      // given and the workflow starts with Select Customer as before.
      setStep(c ? "items" : "customer");
    });
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove("ru-lock");
    hideConfirm();
    // Something was saved or a customer was added: reload the page behind so its balances and lists are current.
    if (state.dirty) { window.location.reload(); return; }
    if (opener && document.body.contains(opener) && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
    opener = null;
  }

  window.RecordUtang = { open: open, close: close };

  // Fallback route from a page that has no modal: ?recordUtang=1 (and optionally &customer=<id>) opens it here.
  var params = new URLSearchParams(window.location.search);
  if (params.get("recordUtang") === "1") {
    open({ customerId: params.get("customer") });
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* ignore */ }
  }
})();
