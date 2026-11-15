/* Record Bayad: floating modal, Steps 1-4 (Select Customer, Payment Details, Review Payment, Confirm). Mock data only.
   Opens centered above the current page with the same look as Record Utang (it reuses its .ru-* styles from
   css/components/record-utang.css; record-bayad.css only adds what is specific to payments). Opened through the
   "record-payment" route (js/main.js calls window.RecordBayad.open) from the Record Bayad quick action and buttons.

   Step 1 only:
   - A search field. Nothing is listed until the owner types; then matching customers appear with their name and
     outstanding balance.
   - Only customers who owe more than P0 can be chosen. Customers with no balance still show (so the owner sees why)
     but are greyed out and cannot be selected.
   - A chosen customer shows as a chip (name and balance) with a Continue button. Continue prepares the next step
     (the choice is kept in RecordBayad.getSelection()) but Payment Details is not built yet, so it only says so.
   - Close (X, Escape, backdrop) asks before discarding a chosen customer.

   Step 2 (Payment Details), shown in the same modal after Continue:
   - Customer name and current outstanding balance (read only), payment amount (required, more than P0 and not more than the
     balance; partial or full), payment date (defaults to today, not in the future), payment method (Cash, GCash, Maya,
     Bank Transfer, Other; required), reference number (optional) and notes (optional).
   - Back returns to Step 1 with the customer still chosen and keeps what was typed here. Continue validates; when valid it
     keeps the details for the next step (RecordBayad.getSelection().payment). Review Payment is not built yet, so it only
     says so. Nothing is saved and no balance changes.

   Step 3 (Review Payment), same modal after a valid Continue:
   - Summary: customer, previous outstanding balance, payment amount (highlighted), date, method, reference and notes (only
     when given) and the remaining balance (previous balance - payment), shown prominently. A full payment says the balance
     becomes P0.00 after confirmation; a partial payment shows the amount that remains.
   - Back returns to Step 2 with everything still filled in.

   Step 4 (Confirm Payment), when Confirm Bayad is pressed:
   - CrediTrackApi.addPayment validates the payment again and only then saves ONE payment transaction (TRX-0001 style
     reference), deducts it from the customer's balance and leaves every earlier record untouched. Nothing changes before
     this point. Saving is locked while in progress and uses a request id, so repeated clicks never save twice.
   - Success screen: customer, payment amount, reference and remaining balance, with a Done button. Done closes the modal
     and reloads the page behind it so the Transaction History, Customer Details, Customers and Dashboard show the new
     payment and balance. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;

  var root = null, els = {};
  var state = blank();
  var opener = null, confirmOpen = false, confirmReturn = null;

  function blank() {
    return { preselected: false, saving: false, requestId: null, result: null, dirty: false, doneAt: 0, step: "customer", data: null, query: "", selectedId: null, active: -1, matches: [], ready: false, valid: null,
      payment: { amount: "", date: todayISO(), method: "", ref: "", notes: "" } };
  }
  var METHODS = ["Cash", "GCash", "Maya", "Bank Transfer", "Other"];
  function todayISO() { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }

  // ---------- Helpers ----------
  function peso(n) { return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function initials(name) { return name.split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase(); }
  function owes(c) { return Number(c.balance) > 0; }
  function find(id) {
    if (id === null || id === undefined || !state.data) return null;
    return state.data.customers.filter(function (c) { return String(c.id) === String(id); })[0] || null;
  }
  function svg(paths, size, width) {
    return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (width || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON_PAYMENT = svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>', 24, 1.8);
  var ICON_SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18, 1.9);
  var ICON_X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 18, 2.2);

  // ---------- Build the modal once ----------
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "ru rb";
    root.hidden = true;
    root.innerHTML =
      '<div class="ru__backdrop" data-act="close"></div>' +
      '<div class="ru__dialog" role="dialog" aria-modal="true" aria-labelledby="rb-title" tabindex="-1" data-step="customer">' +
        '<header class="ru__head">' +
          '<span class="ru__badge">' + ICON_PAYMENT + "</span>" +
          '<div class="ru__heading"><p class="ru__eyebrow" id="rb-eyebrow">Step 1 of 3 \u00B7 Customer</p><h2 class="ru__title" id="rb-title">Record Bayad</h2></div>' +
          '<button class="ru__close" type="button" data-act="close" aria-label="Close Record Bayad">' + ICON_X + "</button>" +
          '<div class="ru__steps" id="rb-steps" aria-hidden="true"><span class="is-current"></span><span></span><span></span></div>' +
        "</header>" +
        '<div class="ru__body" id="rb-body">' +
          '<section class="ru__panel" data-panel="customer">' +
            '<label class="ru__label" for="rb-search">Who is paying?</label>' +
            '<p class="ru__hint">Type the customer&rsquo;s name to find them.</p>' +
            '<div class="ru-search">' +
              '<span class="ru-search__icon">' + ICON_SEARCH + "</span>" +
              '<input class="input ru-search__input" id="rb-search" type="text" placeholder="Search customer name" autocomplete="off" autocapitalize="words" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="rb-list" aria-autocomplete="list">' +
              '<button class="ru-search__clear" type="button" id="rb-clear" aria-label="Clear search" hidden>' + ICON_X + "</button>" +
            "</div>" +
            '<ul class="ru-list" id="rb-list" role="listbox" aria-label="Matching customers" hidden></ul>' +
            '<div class="ru-none" id="rb-none" hidden>' +
              '<p class="ru-none__title" id="rb-none-title"></p>' +
              '<p class="ru-none__text">Only customers on your list can record a payment. Check the spelling or try another name.</p>' +
            "</div>" +
            '<div class="ru-chosen" id="rb-chosen" hidden>' +
              '<span class="ru-avatar" id="rb-chosen-avatar" aria-hidden="true"></span>' +
              '<span class="ru-chosen__main"><span class="ru-chosen__name" id="rb-chosen-name"></span><span class="ru-chosen__bal" id="rb-chosen-bal"></span></span>' +
              '<button class="ru-chosen__change" type="button" id="rb-change">Change</button>' +
            "</div>" +
          "</section>" +

          /* 2. Payment details */
          '<section class="ru__panel" data-panel="payment" hidden>' +
            '<dl class="ru-totals rb-who">' +
              '<div><dt>Customer</dt><dd id="rb-p-name"></dd></div>' +
              '<div><dt>Outstanding balance</dt><dd class="rb-who__bal" id="rb-p-bal"></dd></div>' +
            "</dl>" +
            '<form class="ru-item rb-form" id="rb-form" novalidate>' +
              '<div class="ru-field"><label for="rb-amount">Payment amount (\u20B1)</label>' +
                '<input class="input" id="rb-amount" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" aria-describedby="rb-amount-hint rb-amount-err">' +
                '<p class="rb-hint" id="rb-amount-hint">Part of the balance or the full amount.</p>' +
                '<p class="ru-field__error" id="rb-amount-err" hidden></p>' +
                '<button class="rb-full" type="button" id="rb-full">Pay full balance</button></div>' +
              '<div class="ru-field"><label for="rb-date">Payment date</label>' +
                '<input class="input" id="rb-date" type="date" aria-describedby="rb-date-err">' +
                '<p class="ru-field__error" id="rb-date-err" hidden></p></div>' +
              '<fieldset class="ru-field rb-method" aria-describedby="rb-method-err"><legend>Payment method</legend>' +
                '<div class="rb-method__grid" id="rb-method-grid">' +
                  METHODS.map(function (m, i) {
                    return '<label class="rb-chip"><input type="radio" name="rb-method" value="' + m + '" id="rb-method-' + i + '"><span>' + m + "</span></label>";
                  }).join("") +
                "</div>" +
                '<p class="ru-field__error" id="rb-method-err" hidden></p></fieldset>' +
              '<div class="ru-field"><label for="rb-ref">Reference number <span class="ru-field__opt">(optional)</span></label>' +
                '<input class="input" id="rb-ref" type="text" maxlength="40" placeholder="e.g. GCash or bank reference" autocomplete="off" spellcheck="false" aria-describedby="rb-ref-err">' +
                '<p class="ru-field__error" id="rb-ref-err" hidden></p></div>' +
              '<div class="ru-field"><label for="rb-notes">Notes <span class="ru-field__opt">(optional)</span></label>' +
                '<textarea class="input rb-notes" id="rb-notes" rows="3" maxlength="200" placeholder="Anything to remember about this payment" aria-describedby="rb-notes-count"></textarea>' +
                '<p class="rb-hint rb-hint--end" id="rb-notes-count">0 / 200</p></div>' +
            "</form>" +
          "</section>" +

          /* 3. Review payment */
          '<section class="ru__panel" data-panel="review" hidden>' +
            '<p class="ru__hint ru__hint--top">Check the payment before you confirm. Nothing changes until you press Confirm Bayad.</p>' +
            '<div class="ru-sum">' +
              '<p class="ru-sum__label">Customer</p>' +
              '<div class="ru-chosen ru-chosen--plain"><span class="ru-avatar" id="rb-r-avatar" aria-hidden="true"></span>' +
                '<span class="ru-chosen__main"><span class="ru-chosen__name" id="rb-r-name"></span></span></div>' +
            "</div>" +
            '<div class="rb-pay"><span class="rb-pay__label">Payment amount</span><strong class="rb-pay__amount" id="rb-r-amount"></strong></div>' +
            '<dl class="ru-totals rb-rows">' +
              '<div><dt>Previous outstanding balance</dt><dd id="rb-r-before"></dd></div>' +
              '<div><dt>Payment date</dt><dd id="rb-r-date"></dd></div>' +
              '<div><dt>Payment method</dt><dd id="rb-r-method"></dd></div>' +
              '<div id="rb-r-ref-row"><dt>Reference number</dt><dd id="rb-r-ref"></dd></div>' +
              '<div class="rb-rows__notes" id="rb-r-notes-row"><dt>Notes</dt><dd id="rb-r-notes"></dd></div>' +
            "</dl>" +
            '<div class="rb-after" id="rb-r-after-card">' +
              '<span class="rb-after__label">Remaining balance after payment</span>' +
              '<strong class="rb-after__amount" id="rb-r-after"></strong>' +
              '<span class="rb-after__note" id="rb-r-note"></span>' +
            "</div>" +
            '<p class="ru-items__error" id="rb-save-error" role="alert" hidden></p>' +
          "</section>" +

          /* 4. Done */
          '<section class="ru__panel ru-done" data-panel="done" hidden>' +
            '<span class="ru-done__icon">' + svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 30, 2.6) + "</span>" +
            '<h3 class="ru-done__title">Payment recorded</h3>' +
            '<p class="ru-done__ref">Reference <strong id="rb-d-ref"></strong></p>' +
            '<dl class="ru-totals ru-totals--done">' +
              '<div><dt>Customer</dt><dd id="rb-d-name"></dd></div>' +
              '<div><dt>Payment amount</dt><dd id="rb-d-amount"></dd></div>' +
              '<div class="ru-totals__main"><dt>Remaining balance</dt><dd id="rb-d-balance"></dd></div>' +
            "</dl>" +
            '<p class="rb-done__note" id="rb-d-note"></p>' +
          "</section>" +
        "</div>" +
        '<footer class="ru__foot" id="rb-foot" hidden></footer>' +
        '<div class="ru-confirm" id="rb-confirm" hidden>' +
          '<div class="ru-confirm__card" role="alertdialog" aria-modal="true" aria-labelledby="rb-confirm-title" aria-describedby="rb-confirm-text">' +
            '<h3 class="ru-confirm__title" id="rb-confirm-title">Discard this selection?</h3>' +
            '<p class="ru-confirm__text" id="rb-confirm-text">You have chosen a customer for this payment. If you close now, the selection will be lost.</p>' +
            '<div class="ru-confirm__actions">' +
              '<button class="btn btn--primary" type="button" data-act="keep">Keep editing</button>' +
              '<button class="btn btn--danger-outline" type="button" data-act="discard">Discard</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    root.querySelectorAll("[id]").forEach(function (el) { els[el.id.replace(/^rb-/, "")] = el; });
    els.dialog = root.querySelector(".ru__dialog");
    els.panels = root.querySelectorAll("[data-panel]");
    els.stepbars = els.steps.querySelectorAll("span");

    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onDialogKey);
    els.search.addEventListener("input", function () {
      state.query = els.search.value; state.selectedId = null; state.active = -1; state.valid = null; render();
    });
    els.search.addEventListener("keydown", onSearchKey);
    els.clear.addEventListener("click", function () { reset(); els.search.focus(); });
    els.change.addEventListener("click", function () { reset(); els.search.focus(); });
    els.list.addEventListener("click", function (event) {
      var opt = event.target.closest("[data-id]");
      if (opt && opt.getAttribute("aria-disabled") !== "true") choose(opt.getAttribute("data-id"));
    });
    bindPayment();
    els.list.addEventListener("mousemove", function (event) {
      var opt = event.target.closest("[data-id]");
      if (opt && opt.getAttribute("aria-disabled") !== "true") setActive(Number(opt.getAttribute("data-index")), false);
    });
  }

  function bindPayment() {
    els.form.addEventListener("submit", function (event) { event.preventDefault(); goNext(); });
    [els.amount, els.date, els.ref, els.notes].forEach(function (input) {
      input.addEventListener("input", function () { setError(input.id.replace(/^rb-/, ""), ""); if (input === els.notes) countNotes(); });
    });
    els.date.addEventListener("change", function () { setError("date", ""); });
    els["method-grid"].addEventListener("change", function () { setError("method", ""); });
    els.full.addEventListener("click", function () {
      var c = find(state.selectedId);
      if (!c) return;
      els.amount.value = Number(c.balance).toFixed(2);
      setError("amount", "");
      els.amount.focus();
    });
    // Enter inside a single-line field moves forward like Continue (the notes box keeps its new lines)
    els.form.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && event.target.tagName === "INPUT" && event.target.type !== "radio") { event.preventDefault(); goNext(); }
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
    else if (act === "discard") { hideConfirm(); close(); }
    else if (act === "continue") goPayment();
    else if (act === "back") goBack();
    else if (act === "next") goNext();
    else if (act === "confirm") confirmBayad();
    else if (act === "done") close();
    else if (act === "another") recordAnother();
  }

  // ---------- Steps ----------
  var EYEBROW = { customer: "Step 1 of 3 \u00B7 Customer", payment: "Step 2 of 3 \u00B7 Payment details", review: "Step 3 of 3 \u00B7 Review payment", done: "Payment recorded" };
  var STEP_NO = { customer: 1, payment: 2, review: 3, done: 3 };
  function setStep(step) {
    state.step = step;
    els.dialog.setAttribute("data-step", step);
    els.panels.forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== step; });
    els.eyebrow.textContent = EYEBROW[step];
    els.stepbars.forEach(function (bar, i) {
      bar.className = step === "done" || i + 1 < STEP_NO[step] ? "is-done" : i + 1 === STEP_NO[step] ? "is-current" : "";
    });
    if (step === "customer") render(); else if (step === "payment") renderPayment(); else if (step === "review") renderReview(); else renderDone();
    els.body.scrollTop = 0;
    if (step === "customer") { var go = els.foot.querySelector("[data-act=continue]"); if (go) go.focus({ preventScroll: true }); else els.search.focus({ preventScroll: true }); }
    else if (step === "payment") els.amount.focus({ preventScroll: true });
    else els.dialog.focus({ preventScroll: true });
    // The Done button sits where Confirm Bayad was: ignore taps for a moment so a quick double-tap on Confirm cannot hit Done.
    if (step === "done") {
      state.doneAt = Date.now();
      var guarded = els.foot.querySelectorAll("button");
      guarded.forEach(function (b) { b.disabled = true; });
      setTimeout(function () { if (state.step === "done") guarded.forEach(function (b) { b.disabled = false; }); }, 900);
    }
  }
  function goPayment() { if (find(state.selectedId)) setStep("payment"); }
  function goBack() {
    if (state.step === "review") { setStep("payment"); return; }      // everything on Step 2 is still filled in
    readPayment(); setStep("customer");
  }

  // ---------- Search ----------
  function search(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var hits = state.data.customers.filter(function (c) { return c.name.toLowerCase().indexOf(q) !== -1; });
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
    var can = owes(c);
    return '<li class="ru-opt' + (can ? "" : " is-disabled") + '" role="option" id="rb-opt-' + index + '" data-id="' + esc(String(c.id)) + '" data-index="' + index + '" aria-selected="false"' + (can ? "" : ' aria-disabled="true"') + ">" +
      '<span class="ru-avatar" aria-hidden="true">' + esc(initials(c.name)) + "</span>" +
      '<span class="ru-opt__main">' + highlight(c.name, state.query) + "</span>" +
      '<span class="ru-opt__side"><span class="ru-opt__amount' + (can ? "" : " is-paid") + '">' + peso(Math.max(0, c.balance)) + "</span>" +
      '<span class="ru-opt__note' + (can && c.overdueDays > 0 ? " is-overdue" : "") + '">' + (!can ? "No balance to pay" : c.overdueDays > 0 ? "Overdue" : "Outstanding") + "</span></span></li>";
  }

  function render() {
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
      els["chosen-bal"].textContent = peso(chosen.balance) + " outstanding";
      els.search.setAttribute("aria-expanded", "false");
      els.search.removeAttribute("aria-activedescendant");
    } else {
      els.chosen.hidden = true;
      state.matches = typing ? search(state.query) : [];
      var has = state.matches.length > 0;
      els.list.hidden = !has;
      els.list.innerHTML = has ? state.matches.map(option).join("") : "";
      els.search.setAttribute("aria-expanded", String(has));
      els.none.hidden = !(typing && !has);
      if (typing && !has) els["none-title"].textContent = "No customer found for “" + state.query.trim() + "”";
      setActive(state.active >= state.matches.length ? -1 : state.active, false);
    }
    renderFoot();
  }

  function renderFoot() {
    var ok = !!find(state.selectedId), h = "";
    if (state.step === "payment") h = '<div class="ru__actions"><button class="btn btn--secondary" type="button" data-act="back">Back</button><button class="btn btn--primary" type="button" data-act="next">Continue</button></div>';
    else if (state.step === "review") h = '<div class="ru__actions"><button class="btn btn--secondary" type="button" data-act="back"' + (state.saving ? " disabled" : "") + '>Back</button>' +
      '<button class="btn btn--primary" type="button" data-act="confirm"' + (state.saving ? ' disabled aria-busy="true">Saving\u2026' : ">Confirm Bayad") + "</button></div>";
    else if (state.step === "done") h = '<div class="ru__actions"><button class="btn btn--secondary" type="button" data-act="another">Record Another</button><button class="btn btn--primary" type="button" data-act="done">Done</button></div>';
    else if (ok) h = '<button class="btn btn--primary btn--block" type="button" data-act="continue">Continue</button>';
    els.foot.innerHTML = h;
    els.foot.hidden = !h;
  }

  // ---------- Step 2: payment details ----------
  var AMOUNT = /^\d+(\.\d{1,2})?$/;
  function setError(name, message) {
    var box = els[name + "-err"], input = els[name];
    if (!box) return;
    box.textContent = message || ""; box.hidden = !message;
    if (input && input.setAttribute) { if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }
  function countNotes() { els["notes-count"].textContent = els.notes.value.length + " / 200"; }
  function methodValue() { var r = els.form.querySelector("input[name=rb-method]:checked"); return r ? r.value : ""; }
  function readPayment() {
    state.payment = { amount: els.amount.value, date: els.date.value, method: methodValue(), ref: els.ref.value, notes: els.notes.value };
  }
  function renderPayment() {
    var c = find(state.selectedId), pm = state.payment;
    els["p-name"].textContent = c.name;
    els["p-bal"].textContent = peso(c.balance);
    els.amount.value = pm.amount; els.date.value = pm.date; els.ref.value = pm.ref; els.notes.value = pm.notes;
    els.date.max = todayISO();
    Array.prototype.forEach.call(els.form.querySelectorAll("input[name=rb-method]"), function (r) { r.checked = r.value === pm.method; });
    ["amount", "date", "method", "ref"].forEach(function (n) { setError(n, ""); });
    countNotes();
    renderFoot();
  }

  // Returns the payment details when everything is valid, otherwise shows the messages and returns null.
  function validatePayment() {
    var c = find(state.selectedId), e = {}, raw = els.amount.value.replace(/,/g, "").replace(/^\u20B1/, "").trim(), amount = Number(raw);
    if (!raw) e.amount = "Enter the payment amount.";
    else if (!AMOUNT.test(raw)) e.amount = "Use an amount like 500 or 250.50 (up to 2 decimal places).";
    else if (!(amount > 0)) e.amount = "The payment must be more than \u20B10.00.";
    else if (amount > Math.round(c.balance * 100) / 100) e.amount = "The payment cannot be more than the outstanding balance of " + peso(c.balance) + ".";
    var date = els.date.value;
    if (!date) e.date = "Choose the payment date.";
    else if (date > todayISO()) e.date = "The payment date cannot be in the future.";
    if (!methodValue()) e.method = "Choose how the customer paid.";
    ["amount", "date", "method"].forEach(function (n) { setError(n, e[n]); });
    if (e.amount || e.date || e.method) {
      (e.amount ? els.amount : e.date ? els.date : els["method-0"]).focus();
      return null;
    }
    return { amount: Math.round(amount * 100) / 100, date: date, method: methodValue(), reference: els.ref.value.trim().replace(/\s+/g, " "), notes: els.notes.value.trim() };
  }

  function setActive(index, scroll) {
    state.active = index;
    els.list.querySelectorAll(".ru-opt").forEach(function (li, i) {
      var on = i === index;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", String(on));
      if (on && scroll) li.scrollIntoView({ block: "nearest" });
    });
    if (index >= 0) els.search.setAttribute("aria-activedescendant", "rb-opt-" + index);
    else els.search.removeAttribute("aria-activedescendant");
  }

  function choose(id) {
    var c = find(id);
    if (!c || !owes(c)) return;                       // customers with no balance can never be chosen
    state.selectedId = c.id;
    state.preselected = false;
    state.query = c.name;
    els.search.value = c.name;
    render();
    var go = els.foot.querySelector("[data-act=continue]");
    if (go) go.focus({ preventScroll: true });
  }
  function reset() {
    state.query = ""; state.selectedId = null; state.active = -1; state.preselected = false;
    els.search.value = "";
    render();
  }

  function onSearchKey(event) {
    var picks = [];
    state.matches.forEach(function (c, i) { if (owes(c)) picks.push(i); });
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && picks.length) {
      event.preventDefault();
      var at = picks.indexOf(state.active), down = event.key === "ArrowDown";
      var next = at === -1 ? (down ? 0 : picks.length - 1) : (at + (down ? 1 : -1) + picks.length) % picks.length;
      setActive(picks[next], true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (state.active >= 0 && state.matches[state.active] && owes(state.matches[state.active])) choose(state.matches[state.active].id);
      else if (picks.length === 1) choose(state.matches[picks[0]].id);
      else if (find(state.selectedId)) goNext();
    }
  }

  // Continue on Step 2: the details are validated and kept for the next step (Review Payment, not built yet).
  function goNext() {
    var c = find(state.selectedId);
    if (!c || state.step !== "payment") return;
    var details = validatePayment();
    if (!details) return;
    readPayment();
    state.valid = details;
    state.requestId = null;           // the details may have changed: a new review gets a new request id
    setStep("review");
  }

  // ---------- Step 3: review payment ----------
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  }
  function renderReview() {
    var c = find(state.selectedId), d = state.valid;
    var before = Math.round(c.balance * 100) / 100, after = Math.round((before - d.amount) * 100) / 100, full = after <= 0;
    els["r-avatar"].textContent = initials(c.name);
    els["r-name"].textContent = c.name;
    els["r-amount"].textContent = peso(d.amount);
    els["r-before"].textContent = peso(before);
    els["r-date"].textContent = longDate(d.date);
    els["r-method"].textContent = d.method;
    els["r-ref"].textContent = d.reference;       els["r-ref-row"].hidden = !d.reference;
    els["r-notes"].textContent = d.notes;         els["r-notes-row"].hidden = !d.notes;
    els["r-after"].textContent = peso(Math.max(0, after));
    els["r-after-card"].classList.toggle("is-cleared", full);
    els["r-note"].textContent = full ? "Full payment. The balance becomes " + peso(0) + " after confirmation." : "Partial payment. " + peso(after) + " will remain unpaid.";
    renderFoot();
  }
  // ---------- Step 4: confirm ----------
  // Nothing is saved or changed before this point. Locked while saving; one request id per review, so even if this ran
  // twice the data layer returns the first saved payment instead of creating another.
  function confirmBayad() {
    var c = find(state.selectedId), d = state.valid;
    if (state.saving || state.step !== "review" || !c || !d) return;
    state.saving = true;
    els["save-error"].hidden = true;
    renderFoot();
    if (!state.requestId) state.requestId = "rb-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    api.addPayment({ customerId: c.id, amount: d.amount, date: d.date, method: d.method, reference: d.reference, notes: d.notes, requestId: state.requestId })
      .then(function (res) {
        state.result = res;
        state.dirty = true;
        state.saving = false;
        if (res.customer) c.balance = res.customer.balance;
        setStep("done");
      }).catch(function (err) {
        state.saving = false;
        els["save-error"].textContent = err && err.message ? err.message : "Could not save the payment. Please try again.";
        els["save-error"].hidden = false;
        renderFoot();
        // The balance may have changed since this was opened: pick up the latest customers so Back shows the right balance.
        api.getCustomers().then(function (data) { if (state.step === "review") { state.data = data; } });
      });
  }
  // Record Another Bayad: a fresh workflow from Step 1 in the same modal. The chosen customer, the payment details and the
  // previous result are all cleared; only the "a payment was saved" flag stays so the page behind still reloads on close.
  function recordAnother() {
    if (state.step !== "done" || state.saving) return;
    var keep = state.dirty;
    state = blank(); state.dirty = keep;
    els.search.value = "";
    ["amount", "date", "method", "ref"].forEach(function (n) { setError(n, ""); });
    els["save-error"].hidden = true;
    hideConfirm();
    api.getCustomers().then(function (data) { state.data = data; setStep("customer"); });   // latest balances, so the paid customer shows their new balance
  }
  function renderDone() {
    var r = state.result, t = r.transaction, after = r.customer ? r.customer.balance : 0;
    els["d-ref"].textContent = t.code;
    els["d-name"].textContent = r.customer ? r.customer.name : "";
    els["d-amount"].textContent = peso(t.amount);
    els["d-balance"].textContent = peso(after);
    els["d-note"].textContent = after <= 0 ? "Fully paid. This customer has no outstanding balance." : "Partial payment recorded. The remaining balance is still due.";
    renderFoot();
  }
  function getSelection() {
    var c = find(state.selectedId);
    return c ? { customerId: c.id, name: c.name, balance: c.balance, payment: state.valid || null } : null;
  }

  // ---------- Closing ----------
  // A customer opened from Customer Details is not something the owner "chose", so closing before typing anything just closes.
  function hasEntries() {
    if (state.step === "review") return true;
    if (state.step !== "payment") return false;
    return !!(els.amount.value.trim() || els.ref.value.trim() || els.notes.value.trim() || methodValue());
  }
  function requestClose() {
    if (state.saving) return;
    if (state.step !== "done" && find(state.selectedId) && (!state.preselected || hasEntries())) showConfirm(); else close();
  }
  function showConfirm() {
    confirmReturn = document.activeElement;
    confirmOpen = true;
    els.confirm.hidden = false;
    els.confirm.querySelector("[data-act=keep]").focus();
  }
  function hideConfirm() {
    if (!root) return;
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
    var items = Array.prototype.filter.call(scope.querySelectorAll("button, a[href], input, textarea"), function (el) { return !el.disabled && el.getClientRects().length > 0; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === els.dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  // options: { customerId } preselects a customer (only if they still owe something).
  function open(options) {
    options = options || {};
    build();
    if (!root.hidden) return Promise.resolve();
    opener = document.activeElement;
    state = blank();
    els.search.value = "";
    els.dialog.setAttribute("data-step", "customer");
    hideConfirm();
    return api.getCustomers().then(function (data) {
      state.data = data;
      var c = find(options.customerId);
      root.hidden = false;
      document.documentElement.classList.add("ru-lock");
      if (c && owes(c)) {
        // Opened from a customer's details page: that customer is already chosen, so Select Customer is skipped and the
        // owner lands on Payment Details (name and balance are shown there).
        state.selectedId = c.id; state.query = c.name; els.search.value = c.name; state.preselected = true;
        setStep("payment");
      } else {
        // From the Dashboard no customer is given. A customer with no balance cannot be paid: Step 1 opens with their name
        // searched so the owner sees them greyed out ("No balance to pay") instead of a silent skip.
        if (c) { state.query = c.name; els.search.value = c.name; }
        setStep("customer");
      }
    });
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove("ru-lock");
    hideConfirm();
    var saved = state.dirty;
    state = blank();
    // A payment was saved: reload the page behind so its balances, lists and Transaction History are current.
    if (saved) { window.location.reload(); return; }
    if (opener && document.body.contains(opener) && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
    opener = null;
  }

  window.RecordBayad = { open: open, close: close, getSelection: getSelection };
})();
