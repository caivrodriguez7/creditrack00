/* Store Owner > Transaction History > Transaction Details > Edit Transaction (transaction-edit?id=...).
   One form for both kinds of transaction. The transaction ID (TRX-0001) and its type never change.
     Credit   customer, transaction date, and every item: name, quantity, unit (optional) and unit price. The total is recalculated.
     Payment  customer, payment date, amount, payment method, reference number (optional) and notes (optional).
   The fields start with the saved values. "Balance after this change" updates as the owner types. Save Changes checks every field,
   then asks for confirmation (what changed, and the new balance) before CrediTrackApi.updateTransaction saves it. After saving, the
   owner is returned to Transaction Details with a success message; the customer's balance, Customer Details, Dashboard, Overdue
   Accounts and Reports are all calculated from the same records, so they show the new numbers. Cancel and Back leave nothing changed.
   Payment due date (credit only): a credit that has NO due date shows "No due date" / "Set due date" (the same buttons and date picker as Record Utang).
   A credit that already HAS one shows the date picker with the current due date selected. Choosing a different date (today or later, within
   5 years) and saving sends dueDate with the rest of the edit, and old -> new appears in the confirmation. Remove due date: a credit that
   has a due date also shows "Keep due date" / "Remove due date". Choosing Remove hides the picker; saving sends removeDueDate: true
   through the same update endpoint (the API stores DueDate as NULL), the confirmation shows old date -> "No due date", and Transaction
   Details then shows "No due date".
   Void Transaction is on Transaction Details; Every saved edit, including a due date added, changed or removed, adds a Change History entry (shown on Transaction Details). All data goes through js/api/owner-api.js. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var ICONS = window.CrediTrackIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var txId = new URLSearchParams(window.location.search).get("id");
  var detailsUrl = "transaction-details?id=" + encodeURIComponent(txId || "");
  document.body.setAttribute("data-back", detailsUrl);

  var state = { data: null, tx: null, credit: true, items: [], saving: false, pending: null, pendingOnlyDue: false, pendingDueVerb: "set", dueMode: "none" };

  // ---------- Helpers ----------
  function peso(n) { return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(iso) { var d = new Date(iso); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function dayLong(day) { var p = day.split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }); }
  function clean(raw) { return String(raw).replace(/,/g, "").replace(/^\u20B1/, "").trim(); }
  var NUMBER = /^\d+(\.\d{1,2})?$/;
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 19l1-12M9 7V4.5A.5.5 0 0 1 9.5 4h5a.5.5 0 0 1 .5.5V7"/></svg>';

  // Quantity: whole number (2), decimal (0.5) or fraction (1/2, 1 1/2), the same rules as Record Utang.
  function parseQty(raw) {
    var t = String(raw).replace(/,/g, "").trim().replace(/\s+/g, " "), m, value;
    if (/^\d+$/.test(t) || /^(\d+)?\.\d{1,4}$|^\d+\.\d{1,4}$/.test(t)) value = Number(t);
    else if ((m = /^(\d+) ?\/ ?(\d+)$/.exec(t))) { if (Number(m[2]) === 0) return { bad: "zero" }; t = m[1] + "/" + m[2]; value = Number(m[1]) / Number(m[2]); }
    else if ((m = /^(\d+) (\d+) ?\/ ?(\d+)$/.exec(t))) { if (Number(m[3]) === 0) return { bad: "zero" }; t = m[1] + " " + m[2] + "/" + m[3]; value = Number(m[1]) + Number(m[2]) / Number(m[3]); }
    else return null;
    return { text: t, value: Math.round(value * 1000000) / 1000000 };
  }
  function qtyLabel(i) { return (i.qtyText || i.qty) + (i.unit ? " " + i.unit : ""); }

  function setError(inputId, message) {
    var box = $(inputId + "-error"), input = $(inputId);
    if (box) { box.textContent = message || ""; box.hidden = !message; }
    if (input) { if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }
  function banner(id, message) { var b = $(id); b.textContent = message || ""; b.hidden = !message; }

  // ---------- Customers ----------
  function customerById(id) { return state.data.customers.filter(function (c) { return String(c.id) === String(id); })[0] || null; }
  function fillCustomers() {
    var select = $("e-customer"), current = state.tx.customerId;
    select.innerHTML = state.data.customers.map(function (c) {
      // A payment can only be moved to a customer who owes something
      var blocked = !state.credit && c.id !== current && !(c.balance > 0);
      var archived = state.credit && c.archived && c.id !== current;   // credit cannot be moved to an archived customer
      return '<option value="' + esc(String(c.id)) + '"' + (blocked || archived ? " disabled" : "") + ">" + esc(c.name) + (blocked ? " (no balance)" : archived ? " (archived)" : "") + "</option>";
    }).join("");
    select.value = String(current);
    $("e-customer-hint").textContent = state.credit
      ? "Moving this credit to another customer changes both customers\u2019 balances."
      : "Moving this payment to another customer changes both customers\u2019 balances.";
  }

  // ---------- Credit items ----------
  function itemRow(it, i, count) {
    var n = i + 1;
    function field(key, label, attrs, extra) {
      var id = "ei-" + i + "-" + key;
      return '<div class="field' + (extra || "") + '"><label class="field__label" for="' + id + '">' + label + '</label>' +
        '<input class="input" id="' + id + '" data-i="' + i + '" data-key="' + key + '" value="' + esc(it[key]) + '" autocomplete="off" ' + attrs + ' aria-describedby="' + id + '-error">' +
        '<p class="field__error" id="' + id + '-error" hidden></p></div>';
    }
    return '<div class="eitem" data-item="' + i + '">' +
      '<div class="eitem__head"><h3 class="eitem__title">Item ' + n + '</h3>' +
      '<button class="eitem__remove" type="button" data-remove="' + i + '" aria-label="Remove item ' + n + '"' + (count < 2 ? " disabled" : "") + ">" + TRASH + "Remove</button></div>" +
      '<div class="eitem__grid">' +
        field("name", "Item name", 'type="text" maxlength="60" autocapitalize="sentences"', " field--wide") +
        field("qty", "Quantity", 'type="text" inputmode="text" maxlength="12" spellcheck="false" placeholder="1"') +
        field("unit", 'Unit <span class="field__opt">(optional)</span>', 'type="text" maxlength="20" spellcheck="false" placeholder="e.g. kg"') +
        field("price", "Unit price (\u20B1)", 'type="text" inputmode="decimal" placeholder="0.00"', " field--wide") +
      "</div>" +
      '<p class="eitem__sub">Subtotal <strong id="ei-' + i + '-sub"></strong></p></div>';
  }
  function renderItems() {
    $("e-items").innerHTML = state.items.map(function (it, i) { return itemRow(it, i, state.items.length); }).join("");
    state.items.forEach(function (it, i) { updateSub(i); });
    updateTotals();
  }
  function itemSub(it) {
    var q = parseQty(it.qty), p = clean(it.price);
    return q && !q.bad && q.value > 0 && NUMBER.test(p) ? round2(q.value * Number(p)) : null;
  }
  function updateSub(i) { var s = itemSub(state.items[i]); $("ei-" + i + "-sub").textContent = s === null ? "\u20B10.00" : peso(s); }
  function creditTotal() {
    var total = 0;
    for (var i = 0; i < state.items.length; i++) { var s = itemSub(state.items[i]); if (s === null) return null; total += s; }
    return round2(total);
  }
  function updateTotals() { var t = creditTotal(); $("e-total").textContent = t === null ? peso(round2(state.items.reduce(function (n, it) { return n + (itemSub(it) || 0); }, 0))) : peso(t); updateEffect(); }

  $("e-items").addEventListener("input", function (event) {
    var input = event.target.closest("[data-key]");
    if (!input) return;
    var i = Number(input.getAttribute("data-i"));
    state.items[i][input.getAttribute("data-key")] = input.value;
    setError(input.id, "");
    banner("e-error", ""); $("e-items-error").hidden = true;
    updateSub(i); updateTotals();
  });
  $("e-items").addEventListener("click", function (event) {
    var remove = event.target.closest("[data-remove]");
    if (!remove || state.items.length < 2) return;
    state.items.splice(Number(remove.getAttribute("data-remove")), 1);
    renderItems();
    var next = $("e-items").querySelector(".eitem__remove:not(:disabled)") || $("e-add-item");
    next.focus();
  });
  $("e-add-item").addEventListener("click", function () {
    state.items.push({ name: "", qty: "1", unit: "", price: "" });
    renderItems();
    $("ei-" + (state.items.length - 1) + "-name").focus();
  });

  // ---------- What the new balance will be ----------
  // The same rule the API uses: a credit adds to the balance, a payment takes from it. Take out the old effect, put in the new one.
  function currentAmount() {
    if (state.credit) return creditTotal();
    var raw = clean($("e-amount").value);
    return NUMBER.test(raw) && Number(raw) > 0 ? round2(Number(raw)) : null;
  }
  function balanceChange(amount) {
    var sign = state.credit ? 1 : -1, tx = state.tx;
    var next = customerById($("e-customer").value), prev = customerById(tx.customerId);
    if (!next || amount === null) return null;
    if (prev && prev.id === next.id) return { next: next, nextAfter: round2(next.balance - sign * tx.amount + sign * amount), prev: null };
    return { next: next, nextAfter: round2(next.balance + sign * amount), prev: prev, prevAfter: prev ? round2(prev.balance - sign * tx.amount) : null };
  }
  function availableForPayment() {
    var next = customerById($("e-customer").value);
    return next ? round2(next.balance + (next.id === state.tx.customerId ? state.tx.amount : 0)) : 0;
  }
  function row(label, value, cls) { return "<div" + (cls ? ' class="' + cls + '"' : "") + "><dt>" + esc(label) + "</dt><dd>" + value + "</dd></div>"; }
  function updateEffect() {
    if (!state.data) return;
    if (!state.credit) $("e-amount-hint").textContent = "Up to " + peso(availableForPayment()) + ", what this customer owed before this payment.";
    var amount = currentAmount(), change = balanceChange(amount), html = "";
    if (!change) {
      html = row("New balance", "Enter valid details to see it");
    } else {
      var n = change.next;
      if (change.prev || change.prevAfter !== undefined) {
        if (change.prev) html += row(change.prev.name + " (before)", peso(change.prev.balance) + " \u2192 " + peso(change.prevAfter), change.prevAfter < 0 ? "is-warn" : "");
        html += row(n.name, peso(n.balance) + " \u2192 " + peso(change.nextAfter), change.nextAfter < 0 ? "is-warn" : "is-main");
      } else {
        html += row("Balance now", peso(n.balance));
        html += row("Balance after this change", peso(change.nextAfter), change.nextAfter < 0 ? "is-warn" : "is-main");
      }
      if (change.nextAfter < 0 || (change.prev && change.prevAfter < 0)) html += row("Not allowed", "The balance cannot go below \u20B10.00", "is-warn");
    }
    $("e-effect-rows").innerHTML = html;
  }

  // ---------- Payment due date (a credit can receive one, or change the one it has) ----------
  function today() { return state.data.today; }
  function hasDue() { return state.credit && !!state.tx && !!state.tx.dueDate; }
  function savedDue() { return hasDue() ? String(state.tx.dueDate).slice(0, 10) : ""; }
  function maxDue() { var p = today().split("-"); var d = new Date(Number(p[0]) + 5, Number(p[1]) - 1, Number(p[2])); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function syncDue() {
    // No due date yet: "No due date" (none) / "Set due date" (set). Has a due date: "Remove due date" (none) / "Keep due date" (set, the default)
    var set = state.dueMode === "set";
    $("e-due-none").classList.toggle("is-on", !set); $("e-due-none").setAttribute("aria-pressed", String(!set));
    $("e-due-set").classList.toggle("is-on", set); $("e-due-set").setAttribute("aria-pressed", String(set));
    $("e-due-pick").hidden = !set;
    $("e-due").min = today(); $("e-due").max = maxDue();
    if (!set) $("e-due").value = "";
    else if (hasDue() && !$("e-due").value) $("e-due").value = savedDue();   // Keep due date: back to the saved date
    setError("e-due", "");
  }
  function setDueMode(mode) {
    state.dueMode = mode;
    syncDue();
    if (mode === "set") $("e-due").focus({ preventScroll: true });
  }
  $("e-due-none").addEventListener("click", function () { setDueMode("none"); });
  $("e-due-set").addEventListener("click", function () { setDueMode("set"); });
  $("e-due").addEventListener("input", function () { setError("e-due", ""); });
  $("e-due").addEventListener("change", function () { setError("e-due", ""); });

  // ---------- Validation ----------
  function validate() {
    var ok = true, first = null;
    function fail(inputId, message) { setError(inputId, message); ok = false; if (!first) first = $(inputId); }
    ["e-customer", "e-date", "e-due", "e-amount", "e-method", "e-reference", "e-notes"].forEach(function (id) { setError(id, ""); });
    $("e-items-error").hidden = true; banner("e-error", "");
    var values = { customerId: $("e-customer").value, date: $("e-date").value };

    if (!values.customerId || !customerById(values.customerId)) fail("e-customer", "Choose the customer.");
    if (!values.date) fail("e-date", "Choose the date.");
    else if (values.date > today()) fail("e-date", "The date cannot be in the future.");
    else if (values.date < "2000-01-01") fail("e-date", "Choose a date from the year 2000 or later.");
    else if (isNaN(new Date(values.date + "T12:00:00").getTime())) fail("e-date", "Choose a valid date.");

    if (state.credit) {
      values.items = [];
      state.items.forEach(function (it, i) {
        var id = "ei-" + i + "-", name = String(it.name).trim().replace(/\s+/g, " "), unit = String(it.unit).trim().replace(/\s+/g, " "), price = clean(it.price), qtyRaw = String(it.qty).trim(), q = qtyRaw ? parseQty(qtyRaw) : null, good = true;
        setError(id + "name", ""); setError(id + "qty", ""); setError(id + "unit", ""); setError(id + "price", "");
        if (!name) { fail(id + "name", "Enter the item name."); good = false; }
        else if (name.length > 60) { fail(id + "name", "Use 60 characters or fewer."); good = false; }
        if (!qtyRaw) { fail(id + "qty", "Enter the quantity."); good = false; }
        else if (q && q.bad) { fail(id + "qty", "The bottom number of a fraction cannot be 0."); good = false; }
        else if (!q) { fail(id + "qty", "Use a number like 2, 0.5 or 1/2."); good = false; }
        else if (q.value <= 0) { fail(id + "qty", "Must be more than 0."); good = false; }
        else if (q.value > 9999) { fail(id + "qty", "That is too many."); good = false; }
        if (unit.length > 20) { fail(id + "unit", "Use 20 characters or fewer."); good = false; }
        if (!price) { fail(id + "price", "Enter the unit price."); good = false; }
        else if (!NUMBER.test(price)) { fail(id + "price", "Use an amount like 25 or 12.50."); good = false; }
        else if (Number(price) <= 0) { fail(id + "price", "Must be more than 0."); good = false; }
        else if (Number(price) > 100000) { fail(id + "price", "That price is too high."); good = false; }
        if (good) values.items.push({ name: name, qty: q.value, qtyText: q.text, unit: unit, price: Number(price) });
      });
      // Due date. No due date yet: only when "Set due date" is chosen ("No due date" leaves it as it is).
      // Has a due date: "Remove due date" removes it; otherwise the picker holds the current date, a different valid date is a change
      // and the same date changes nothing.
      if (hasDue() && state.dueMode === "none") values.removeDueDate = true;
      else if (hasDue() || state.dueMode === "set") {
        var due = $("e-due").value;
        if (!due) fail("e-due", hasDue() ? "Pick a due date, or choose Remove due date." : "Pick a due date, or choose No due date.");
        else if (due !== savedDue()) {
          if (isNaN(new Date(due + "T12:00:00").getTime())) fail("e-due", "Enter a valid due date.");
          else if (due < today()) fail("e-due", "The due date cannot be in the past.");
          else if (due > maxDue()) fail("e-due", "That due date is too far away. Choose a date within 5 years.");
          else values.dueDate = due;
        }
      }
    } else {
      var raw = clean($("e-amount").value);
      values.amount = raw;
      if (!raw) fail("e-amount", "Enter the payment amount.");
      else if (!NUMBER.test(raw) || !(Number(raw) > 0)) fail("e-amount", "Enter an amount greater than \u20B10.00, like 250 or 250.50.");
      else if (Number(raw) > availableForPayment()) fail("e-amount", "The payment cannot be more than " + peso(availableForPayment()) + ", what this customer owed before this payment.");
      values.method = $("e-method").value;
      if (!values.method) fail("e-method", "Choose how the customer paid.");
      values.reference = $("e-reference").value.trim().replace(/\s+/g, " ");
      if (values.reference.length > 40) fail("e-reference", "Use a reference number of 40 characters or fewer.");
      values.notes = $("e-notes").value.trim();
      if (values.notes.length > 200) fail("e-notes", "Use notes of 200 characters or fewer.");
    }

    // The new balance must not go below zero
    if (ok) {
      var change = balanceChange(currentAmount());
      if (change && (change.nextAfter < 0 || (change.prev && change.prevAfter < 0))) {
        ok = false;
        var who = change.nextAfter < 0 ? change.next.name : change.prev.name;
        banner("e-error", who + "\u2019s balance would drop below \u20B10.00, because the payments recorded for them would be more than their credits. Check the amounts, or edit the payment first.");
        first = $("e-error");
      }
    }
    if (first) { if (first.focus) first.focus(); if (first.scrollIntoView) first.scrollIntoView({ block: "center", behavior: "smooth" }); }
    return ok ? values : null;
  }

  // ---------- Changes: what is different from the saved transaction ----------
  function changes(values) {
    var tx = state.tx, list = [];
    var oldC = customerById(tx.customerId), newC = customerById(values.customerId);
    if (String(values.customerId) !== String(tx.customerId)) list.push({ label: "Customer", was: oldC ? oldC.name : "Unknown", now: newC.name });
    if (values.date !== dayOf(tx.date)) list.push({ label: state.credit ? "Transaction date" : "Payment date", was: dayLong(dayOf(tx.date)), now: dayLong(values.date) });
    if (state.credit) {
      var oldItems = JSON.stringify(tx.items.map(function (i) { return [i.name, i.qty, i.unit || "", i.price]; }));
      var newItems = JSON.stringify(values.items.map(function (i) { return [i.name, i.qty, i.unit || "", i.price]; }));
      if (oldItems !== newItems) {
        list.push({ label: "Items", was: tx.items.length + (tx.items.length === 1 ? " item" : " items"), now: values.items.map(function (i) { return i.name + ": " + qtyLabel(i) + " \u00D7 " + peso(i.price); }).join("<br>"), html: true });
        var total = round2(values.items.reduce(function (n, i) { return n + round2(i.qty * i.price); }, 0));
        if (total !== round2(tx.amount)) list.push({ label: "Total credit", was: peso(tx.amount), now: peso(total) });
      }
      if (values.dueDate) list.push({ label: "Due date", was: hasDue() ? dayLong(savedDue()) : "No due date", now: dayLong(values.dueDate) });
      if (values.removeDueDate) list.push({ label: "Due date", was: dayLong(savedDue()), now: "No due date" });
    } else {
      var amount = round2(Number(values.amount));
      if (amount !== round2(tx.amount)) list.push({ label: "Amount", was: peso(tx.amount), now: peso(amount) });
      if (values.method !== tx.method) list.push({ label: "Payment method", was: tx.method || "Not specified", now: values.method });
      if (values.reference !== (tx.reference || "")) list.push({ label: "Reference number", was: tx.reference || "None", now: values.reference || "None" });
      if (values.notes !== (tx.note || "")) list.push({ label: "Notes", was: tx.note || "None", now: values.notes || "None" });
    }
    return list;
  }

  // ---------- Confirmation ----------
  var confirmBox = $("e-confirm"), card = confirmBox.querySelector(".etx-confirm__card"), lastFocus = null;
  function openConfirm(values, list) {
    var change = balanceChange(currentAmount()), html = "";
    list.forEach(function (c) {
      html += row(c.label, (c.was ? '<span class="was">' + esc(c.was) + "</span>" : "") + (c.html ? c.now : esc(c.now)));
    });
    if (change) {
      if (change.prev) html += row(change.prev.name + "\u2019s balance", peso(change.prev.balance) + " \u2192 " + peso(change.prevAfter));
      html += row(change.next.name + "\u2019s balance", peso(change.next.balance) + " \u2192 " + peso(change.nextAfter));
    }
    $("c-rows").innerHTML = html;
    $("c-title").textContent = "Save changes to " + state.tx.code + "?";
    banner("c-error", "");
    state.pending = values;
    state.pendingOnlyDue = list.length === 1 && list[0].label === "Due date";
    state.pendingDueVerb = values.removeDueDate ? "removed" : hasDue() ? "updated" : "set";
    lastFocus = document.activeElement;
    confirmBox.hidden = false;
    document.body.classList.add("is-etx-confirm");
    card.focus();
  }
  function closeConfirm() {
    if (state.saving) return;
    confirmBox.hidden = true;
    document.body.classList.remove("is-etx-confirm");
    state.pending = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  confirmBox.addEventListener("click", function (event) { if (event.target.closest("[data-confirm-close]")) closeConfirm(); });
  document.addEventListener("keydown", function (event) {
    if (confirmBox.hidden) return;
    if (event.key === "Escape") { closeConfirm(); return; }
    if (event.key === "Tab") {   // keep the focus inside the dialog
      var f = [$("c-back"), $("c-save")].filter(function (b) { return !b.disabled; });
      if (!f.length) return;
      var at = f.indexOf(document.activeElement);
      if (event.shiftKey && (at <= 0)) { event.preventDefault(); f[f.length - 1].focus(); }
      else if (!event.shiftKey && (at === f.length - 1 || at === -1)) { event.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- Save ----------
  var FIELD_FOR = { customer: "e-customer", date: "e-date", dueDate: "e-due", amount: "e-amount", method: "e-method", reference: "e-reference", notes: "e-notes" };
  $("eform").addEventListener("submit", function (event) {
    event.preventDefault();
    if (state.saving) return;
    var values = validate();
    if (!values) return;
    var list = changes(values);
    if (!list.length) { window.CrediTrack.showToast("No changes to save."); return; }
    openConfirm(values, list);
  });

  $("c-save").addEventListener("click", function () {
    if (state.saving || !state.pending) return;
    var v = state.pending, button = $("c-save");
    state.saving = true; button.disabled = true; $("c-back").disabled = true;
    button.dataset.label = button.textContent; button.textContent = "Saving...";
    var payload = state.credit
      ? { customerId: v.customerId, date: v.date, items: v.items }
      : { customerId: v.customerId, date: v.date, amount: v.amount, method: v.method, reference: v.reference, notes: v.notes };
    if (v.dueDate) payload.dueDate = v.dueDate;   // only sent to set or change the due date
    if (v.removeDueDate) payload.removeDueDate = true;   // only sent to remove the due date
    var onlyDue = state.pendingOnlyDue, dueVerb = state.pendingDueVerb;
    api.updateTransaction(state.tx.id, payload).then(function (result) {
      // Success: back to Transaction Details (replacing this page in the history, so Back does not return to the form)
      window.CrediTrack.flash(result.unchanged ? "No changes to save." : onlyDue ? "Due date " + dueVerb + " for " + state.tx.code + "." : "Transaction " + state.tx.code + " updated. The balance was recalculated.");
      window.location.replace(detailsUrl);
    }).catch(function (err) {
      state.saving = false; button.disabled = false; $("c-back").disabled = false; button.textContent = button.dataset.label;
      var message = err && err.message ? err.message : "Something went wrong. Please try again.";
      var target = err && FIELD_FOR[err.field];
      if (err && err.code === "missing") { banner("c-error", message); return; }
      closeConfirm();
      if (target) { setError(target, message); $(target).focus(); }
      else banner("e-error", message);
      if (!target && $("e-error").scrollIntoView) $("e-error").scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });

  // ---------- Other form events ----------
  $("e-cancel").addEventListener("click", function () { window.CrediTrack.goBack(detailsUrl); });
  $("e-customer").addEventListener("change", function () { setError("e-customer", ""); banner("e-error", ""); updateEffect(); });
  $("e-date").addEventListener("input", function () { setError("e-date", ""); });
  $("e-amount").addEventListener("input", function (event) {
    var cleaned = event.target.value.replace(/[^\d.,]/g, "");
    if (cleaned !== event.target.value) event.target.value = cleaned;
    setError("e-amount", ""); banner("e-error", ""); updateEffect();
  });
  $("e-method").addEventListener("change", function () { setError("e-method", ""); });
  $("e-reference").addEventListener("input", function () { setError("e-reference", ""); });
  $("e-notes").addEventListener("input", function (event) { setError("e-notes", ""); $("e-notes-count").textContent = event.target.value.length + " / 200"; });

  // ---------- Load ----------
  function show() {
    var tx = state.tx, credit = state.credit;
    document.title = "Edit " + (credit ? "Credit" : "Payment") + " " + tx.code + " | CrediTrack";
    var icon = $("e-icon");
    icon.className = "etx-id__icon tx-icon--" + tx.type;
    icon.innerHTML = ICONS[credit ? "credit" : "payment"] || "";
    $("e-title").textContent = credit ? "Credit Transaction" : "Payment Received";
    $("e-code").textContent = tx.code;
    $("e-intro").textContent = credit
      ? "Update the customer, date and items. The total is recalculated from each quantity and unit price."
      : "Update the customer, payment date, amount, payment method, reference number and notes.";
    $("e-date-label").innerHTML = (credit ? "Transaction date" : "Payment date") + ' <span aria-hidden="true">*</span>';
    $("e-date").value = dayOf(tx.date);
    $("e-date").max = state.data.today;
    $("credit-fields").hidden = !credit;
    $("payment-fields").hidden = credit;
    // Payment due date: credits only. No due date yet = No due date / Set due date buttons; one already saved = the picker showing it
    $("due-fields").hidden = !credit;
    state.dueMode = "none";
    if (credit) {
      var existing = !!tx.dueDate;
      $("due-toggle").hidden = false;
      $("e-due-none").textContent = existing ? "Remove due date" : "No due date";
      $("e-due-set").textContent = existing ? "Keep due date" : "Set due date";
      $("due-title").innerHTML = existing ? "Payment due date" : 'Payment due date <span class="field__opt">(optional)</span>';
      $("e-due-hint").textContent = existing ? "Pick a new date to change the due date, or choose Remove due date if there is no agreed payment date any more." : "Leave it on No due date if there is no agreed payment date.";
      state.dueMode = existing ? "set" : "none";
      syncDue();
      if (existing) $("e-due").value = String(tx.dueDate).slice(0, 10);
    }
    fillCustomers();
    if (credit) {
      state.items = tx.items.map(function (i) { return { name: i.name, qty: String(i.qtyText || i.qty), unit: i.unit || "", price: String(i.price) }; });
      renderItems();
    } else {
      $("e-amount").value = Number(tx.amount).toFixed(2);
      $("e-method").innerHTML = state.data.methods.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + "</option>"; }).join("");
      $("e-method").value = state.data.methods.indexOf(tx.method) === -1 ? "" : tx.method;
      if (!$("e-method").value) { $("e-method").insertAdjacentHTML("afterbegin", '<option value="">Choose a method</option>'); $("e-method").value = ""; }
      $("e-reference").value = tx.reference || "";
      $("e-notes").value = tx.note || "";
      $("e-notes-count").textContent = $("e-notes").value.length + " / 200";
    }
    updateEffect();
    $("eform").hidden = false;
  }

  api.getEditableTransaction(txId).then(function (data) {
    state.data = data;
    if (!data.transaction) { document.title = "Transaction not found | CrediTrack"; $("missing").hidden = false; return; }
    if (data.transaction.voided) {   // a voided transaction is kept for reference only: back to its details, which show it as Voided
      window.CrediTrack.flash("Transaction " + data.transaction.code + " is voided and can no longer be edited.");
      window.location.replace(detailsUrl);
      return;
    }
    state.tx = data.transaction;
    state.credit = data.transaction.type === "credit";
    show();
  });

  // A page restored from the back/forward cache could show an old balance: load it again
  window.addEventListener("pageshow", function (event) { if (event.persisted) window.location.reload(); });
})();
