/* Store Owner > Transaction History > Transaction Details (transaction-details?id=...).
   Shows one credit or payment: status, amount, customer, items (credit) or payment details (payment) and
   who recorded it, with an Edit Transaction button (transaction-edit) and a Void Transaction button. This is a subpage: only a Back button and the title (owner-shell.js).
   Void Transaction: a confirmation dialog explains the transaction is voided, not deleted, asks for a reason (Duplicate transaction,
   Incorrect entry or Other, which needs remarks) and shows the customer's balance before and after. Confirming calls
   CrediTrackApi.voidTransaction, which keeps the record, reverses its effect on the balance and removes it from every total. The page
   then shows the transaction as Voided (with when, by whom, why and the balance effect) and hides Edit and Void, so it cannot be voided twice.
   Change History: a timeline of every Edit and Void of this transaction, oldest first (what changed, previous and updated values, when, and by whom;
   for a void the reason, remarks and balance effect), or an empty state when nothing has changed. The entries are written by
   CrediTrackApi.updateTransaction and voidTransaction, come back as getTransaction().history and are only ever shown here, never edited.
   All data comes from js/api/owner-api.js. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var ICONS = window.CrediTrackIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var id = new URLSearchParams(window.location.search).get("id");

  var STATUS = {
    unpaid:   { label: "Unpaid",         cls: "badge--warning" },
    partial:  { label: "Partially paid", cls: "badge--lime" },
    paid:     { label: "Paid",           cls: "badge--success" },
    confirmed: { label: "Confirmed",     cls: "badge--success" },
    recorded: { label: "Confirmed",       cls: "badge--success" },
    voided:   { label: "Voided",         cls: "badge--danger" }
  };
  var state = { data: null, preview: null, saving: false };

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function dateLong(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }); }
  function dateShort(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  // Due date: the backend sends "YYYY-MM-DD" (or nothing) for a credit. It is read as a calendar day, never shifted by time zone.
  // Returns "" when there is no usable due date, so the page shows "No due date".
  function dueText(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || "");
    if (!m) return "";
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  }
  function timeOf(iso) {
    return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); });
  }
  function qtyText(i) { return (i.qtyText || i.qty) + (i.unit ? " " + (i.unit === "pcs" && i.qty === 1 ? "pc" : i.unit) : ""); }
  function rows(list) {
    return list.map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd" + (r[2] ? ' class="is-empty"' : "") + ">" + esc(r[1]) + "</dd></div>";
    }).join("");
  }

  // ---------- Voided notice ----------
  function renderVoidNotice(data) {
    var t = data.transaction, v = t.voidInfo, box = $("void-notice");
    box.hidden = !t.voided;
    if (!t.voided || !v) return;
    var name = t.customer || "the customer";
    $("void-notice-text").textContent = "The original record is kept for reference. It no longer counts toward " + name + "\u2019s balance, the dashboard or your reports.";
    // The person who voided it is stored with the void; older voids without one fall back to the store owner's name
    var who = v.by && v.by.name ? v.by : { name: data.owner && data.owner.fullName ? data.owner.fullName : "Store owner", role: "Store Owner" };
    var by = who.name + " (" + (who.role || "Store Owner") + ")";
    var list = [
      ["Status", "Voided"],
      ["Voided on", dateShort(v.at) + " \u00B7 " + timeOf(v.at)],
      ["Voided by", by],
      ["Reason", v.reasonLabel || "Not recorded", !v.reasonLabel]
    ];
    if (v.remarks) list.push(["Remarks", v.remarks]);
    if (v.balanceBefore != null && v.balanceAfter != null) list.push([name + "\u2019s balance", peso(v.balanceBefore) + " \u2192 " + peso(v.balanceAfter)]);
    $("void-info").innerHTML = rows(list);
  }

  // ---------- Change History ----------
  var HISTORY_ICONS = {
    edited: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14 7l3 3"/></svg>',
    voided: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>'
  };
  var HISTORY_TEXT = {
    edited: { title: "Transaction Edited", by: "Edited by", badge: "Edited", cls: "" },
    voided: { title: "Transaction Voided", by: "Voided by", badge: "Voided", cls: "badge--danger" }
  };
  // A value is text, or a list of lines (when items were added or removed)
  function valueHtml(v) {
    if (Array.isArray(v)) return '<ul class="txh__lines">' + v.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") + "</ul>";
    return '<p class="txh__val">' + esc(v === undefined || v === null || v === "" ? "None" : v) + "</p>";
  }
  function changeHtml(c) {
    return '<div class="txh__change"><p class="txh__field">' + esc(c.label || c.field || "Value") + "</p>" +
      '<div class="txh__values">' +
        '<div class="txh__side txh__side--before"><span class="txh__side-label">Previous value</span>' + valueHtml(c.before) + "</div>" +
        '<span class="txh__arrow" aria-hidden="true">\u2192</span>' +
        '<div class="txh__side txh__side--after"><span class="txh__side-label">Updated value</span>' + valueHtml(c.after) + "</div>" +
      "</div></div>";
  }
  function historyEntryHtml(e, customerName) {
    var kind = e.action === "voided" ? "voided" : "edited", text = HISTORY_TEXT[kind];
    var by = e.by && e.by.name ? text.by + " " + e.by.name + (e.by.role ? " (" + e.by.role + ")" : "") : "User not recorded";
    var body;
    if (kind === "voided") {
      var list = [["Reason", e.reasonLabel || "Not recorded", !e.reasonLabel]];
      if (e.remarks) list.push(["Remarks", e.remarks]);
      if (e.balanceBefore !== undefined && e.balanceAfter !== undefined) list.push([customerName + "\u2019s balance", peso(e.balanceBefore) + " \u2192 " + peso(e.balanceAfter)]);
      body = '<dl class="info__list">' + rows(list) + "</dl>";
    } else {
      body = e.changes && e.changes.length ? e.changes.map(changeHtml).join("") : '<p class="txh__none">The changed values were not recorded.</p>';
    }
    return '<li class="txh__item txh__item--' + kind + '">' +
      '<span class="txh__marker" aria-hidden="true">' + HISTORY_ICONS[kind] + "</span>" +
      '<div class="txh__body">' +
        '<div class="txh__top"><h3 class="txh__title">' + text.title + '</h3><span class="badge ' + text.cls + '">' + text.badge + "</span></div>" +
        '<p class="txh__when"><time datetime="' + esc(e.at) + '">' + esc(dateShort(e.at) + " \u00B7 " + timeOf(e.at)) + "</time></p>" +
        '<p class="txh__by' + (e.by && e.by.name ? "" : " is-empty") + '">' + esc(by) + "</p>" +
        '<div class="txh__details">' + body + "</div>" +
      "</div></li>";
  }
  function renderHistory(data) {
    var list = data.history || [], name = data.transaction.customer || "Customer";
    var count = $("history-count");
    $("history-empty").hidden = list.length > 0;
    $("history-list").hidden = !list.length;
    $("history-note").hidden = !list.length;
    count.hidden = !list.length;
    count.textContent = list.length + (list.length === 1 ? " change" : " changes");
    $("history-list").innerHTML = list.map(function (e) { return historyEntryHtml(e, name); }).join("");
  }

  function render(data) {
    var t = data.transaction, pay = t.type === "payment", voided = !!t.voided;
    var st = STATUS[t.status] || STATUS.recorded;
    $("detail").classList.toggle("is-voided", voided);
    document.title = (pay ? "Payment" : "Credit") + " " + t.code + " | CrediTrack";

    var icon = $("txd-icon");
    icon.className = "txd-head__icon tx-icon--" + t.type;
    icon.innerHTML = ICONS[pay ? "payment" : "credit"] || "";
    $("txd-title").textContent = pay ? "Payment Received" : "Credit Transaction";
    $("txd-meta").textContent = t.code + " \u00B7 " + dateLong(t.date);
    var badge = $("txd-status");
    badge.textContent = st.label;
    badge.className = "badge " + st.cls;

    $("amount-label").textContent = voided ? "Original Amount (voided)" : pay ? "Payment Amount" : "Transaction Amount";
    $("txd-amount").textContent = peso(t.amount);

    $("txd-edit").href = "transaction-edit?id=" + encodeURIComponent(t.id);
    $("txd-edit").hidden = voided;    // a voided transaction is kept for reference only
    $("txd-void").hidden = voided;    // and cannot be voided again
    renderVoidNotice(data);

    var link = $("txd-customer"), href = "customer-details?id=" + encodeURIComponent(t.customerId);
    link.textContent = t.customer || "Unknown customer";
    link.href = href;
    $("txd-view-customer").href = href;
    $("txd-view-customer").hidden = !data.customer;
    if (!data.customer) link.removeAttribute("href");

    // Credit: items. Payment: method and reference.
    $("items-panel").hidden = pay;
    $("payment-panel").hidden = !pay;
    if (!pay) {
      $("txd-items").innerHTML = t.items.map(function (i) {
        return "<li><span><span class=\"txd-item__name\">" + esc(i.name) + "</span>" +
          "<span class=\"txd-item__calc\">" + esc(qtyText(i)) + " \u00D7 " + esc(peso(i.price)) + "</span></span>" +
          "<span class=\"txd-item__amount\">" + peso(i.qty * i.price) + "</span></li>";
      }).join("");
      $("txd-total").textContent = peso(t.amount);
    } else {
      $("txd-payment").innerHTML = rows([
        ["Payment method", t.method || "Not specified"],
        ["Reference number", t.reference || (t.method === "Cash" ? "Not applicable (cash)" : "Not provided"), !t.reference],
        ["Amount", peso(t.amount)]
      ].concat(t.note ? [["Notes", t.note]] : []));
    }

    var info = [
      ["Recorded by", (data.owner && data.owner.fullName ? data.owner.fullName : "Store owner") + " (Store Owner)"],
      ["Date and time recorded", dateShort(t.date) + " \u00B7 " + timeOf(t.date)]
    ];
    if (!pay) {   // credits only: the agreed payment date from the saved record, or "No due date"
      var due = dueText(t.dueDate);
      info.push(["Due Date", due || "No due date", !due]);
    }
    if (!pay && !voided) {
      info.push(["Amount paid toward this credit", peso(t.paidAmount)]);
      info.push(["Remaining on this credit", peso(t.remaining)]);
    }
    $("txd-info").innerHTML = rows(info);
    renderHistory(data);
  }

  function load() {
    return api.getTransaction(id).then(function (data) {
      state.data = data;
      var found = !!data.transaction;
      $("missing").hidden = found;
      $("detail").hidden = !found;
      if (!found) { document.title = "Transaction not found | CrediTrack"; return; }
      render(data);
    });
  }


  // ---------- Void Transaction ----------
  var box = $("v-confirm"), card = box.querySelector(".etx-confirm__card"), lastFocus = null;
  var REMARKS_MIN = 5, REMARKS_MAX = 200;

  function showError(el, message) { el.textContent = message || ""; el.hidden = !message; }
  function clearErrors() {
    showError($("v-reason-error"), ""); showError($("v-remarks-error"), ""); showError($("v-error"), "");
    $("v-reasons").classList.remove("has-error"); $("v-remarks").classList.remove("has-error");
    $("v-remarks").removeAttribute("aria-invalid");
  }
  function chosenReason() { var r = document.querySelector('input[name="v-reason"]:checked'); return r ? r.value : ""; }
  function syncRemarks() {
    var other = chosenReason() === "other";
    $("v-remarks-field").hidden = !other;
    $("v-remarks-count").textContent = $("v-remarks").value.length + " / " + REMARKS_MAX;
  }

  function openVoid() {
    if (state.saving) return;
    lastFocus = document.activeElement;
    api.getVoidPreview(id).then(function (pv) {
      state.preview = pv;
      if (pv.code === "voided") { load(); return; }              // voided in another tab: just show it as Voided
      var t = pv.transaction, c = pv.customer, name = (c && c.name) || (t && t.customer) || "Customer";
      var pay = t && t.type === "payment";
      $("v-rows").innerHTML = rows([
        ["Transaction", t ? t.code + " \u00B7 " + (pay ? "Payment" : "Credit") : "Not found"],
        ["Customer", name],
        ["Amount", t ? peso(t.amount) : "-"]
      ].concat(c ? [[name + "\u2019s balance", peso(pv.balanceBefore) + " \u2192 " + (pv.canVoid ? peso(pv.balanceAfter) : "unchanged")]] : []));
      $("v-text").textContent = "This transaction will be marked as voided. It will not be permanently deleted: the original record stays in your history for reference. " +
        (pay ? "The payment will be added back to the customer\u2019s balance." : "The credit will be taken off the customer\u2019s balance.");
      // A credit that cannot be voided yet (the customer already paid more than their other credits) is explained instead of asked for a reason
      showError($("v-blocked"), pv.canVoid ? "" : pv.message);
      $("v-form").hidden = !pv.canVoid;
      $("v-confirm-btn").hidden = !pv.canVoid;
      $("v-cancel").textContent = pv.canVoid ? "Cancel" : "Close";
      document.querySelectorAll('input[name="v-reason"]').forEach(function (r) { r.checked = false; });
      $("v-remarks").value = "";
      clearErrors(); syncRemarks();
      box.hidden = false;
      document.body.classList.add("is-etx-confirm");
      card.focus();
    });
  }
  function closeVoid() {
    if (state.saving) return;
    box.hidden = true;
    document.body.classList.remove("is-etx-confirm");
    if (lastFocus && lastFocus.focus && !lastFocus.hidden) lastFocus.focus();
  }

  box.addEventListener("click", function (event) { if (event.target.closest("[data-void-close]")) closeVoid(); });
  document.addEventListener("keydown", function (event) {
    if (box.hidden) return;
    if (event.key === "Escape") { closeVoid(); return; }
    if (event.key === "Tab") {   // keep the focus inside the dialog
      var f = Array.prototype.slice.call(card.querySelectorAll("input:not([disabled]), textarea:not([disabled]), button:not([disabled])")).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var at = f.indexOf(document.activeElement);
      if (event.shiftKey && at <= 0) { event.preventDefault(); f[f.length - 1].focus(); }
      else if (!event.shiftKey && (at === f.length - 1 || at === -1)) { event.preventDefault(); f[0].focus(); }
    }
  });

  $("v-reasons").addEventListener("change", function () {
    showError($("v-reason-error"), ""); $("v-reasons").classList.remove("has-error"); showError($("v-error"), "");
    syncRemarks();
    if (chosenReason() === "other") $("v-remarks").focus();
  });
  $("v-remarks").addEventListener("input", function () {
    showError($("v-remarks-error"), ""); $("v-remarks").classList.remove("has-error"); $("v-remarks").removeAttribute("aria-invalid");
    $("v-remarks-count").textContent = $("v-remarks").value.length + " / " + REMARKS_MAX;
  });

  // The same rules as the API (which checks again): a reason is required, and Other needs remarks
  function validate() {
    clearErrors();
    var reason = chosenReason(), remarks = $("v-remarks").value.trim().replace(/\s+/g, " ");
    if (!reason) {
      showError($("v-reason-error"), "Choose why this transaction is being voided.");
      $("v-reasons").classList.add("has-error");
      var first = document.querySelector('input[name="v-reason"]'); if (first) first.focus();
      return null;
    }
    if (reason === "other") {
      var message = !remarks ? "Tell us why you are voiding this transaction."
        : remarks.length < REMARKS_MIN ? "Add a little more detail (at least " + REMARKS_MIN + " characters)."
        : remarks.length > REMARKS_MAX ? "Use " + REMARKS_MAX + " characters or fewer." : "";
      if (message) {
        showError($("v-remarks-error"), message);
        $("v-remarks").classList.add("has-error"); $("v-remarks").setAttribute("aria-invalid", "true"); $("v-remarks").focus();
        return null;
      }
    }
    return { reason: reason, remarks: reason === "other" ? remarks : "" };
  }

  $("txd-void").addEventListener("click", openVoid);
  $("v-confirm-btn").addEventListener("click", function () {
    if (state.saving) return;                       // a double tap cannot void twice
    var values = validate();
    if (!values) return;
    var button = $("v-confirm-btn"), cancel = $("v-cancel");
    state.saving = true; button.disabled = true; cancel.disabled = true;
    button.dataset.label = button.textContent; button.textContent = "Voiding...";
    api.voidTransaction(id, values).then(function (result) {
      state.saving = false; button.disabled = false; cancel.disabled = false; button.textContent = button.dataset.label;
      box.hidden = true; document.body.classList.remove("is-etx-confirm");
      var t = result.transaction, pay = t.type === "payment", name = t.customer || "the customer";
      return load().then(function () {
        // Success feedback: a message, and the Voided notice announced and brought into view
        window.CrediTrack.showToast("Transaction " + t.code + " voided. " + name + "\u2019s balance is now " + peso(result.balanceAfter) + ".");
        var notice = $("void-notice");
        if (!notice.hidden) { notice.focus({ preventScroll: true }); if (notice.scrollIntoView) notice.scrollIntoView({ block: "start", behavior: "smooth" }); }
      });
    }).catch(function (err) {
      state.saving = false; button.disabled = false; cancel.disabled = false; button.textContent = button.dataset.label;
      var message = err && err.message ? err.message : "Something went wrong. Please try again.";
      var code = err && err.code;
      if (code === "reason") { showError($("v-reason-error"), message); $("v-reasons").classList.add("has-error"); return; }
      if (code === "remarks") { showError($("v-remarks-error"), message); $("v-remarks").classList.add("has-error"); $("v-remarks").focus(); return; }
      if (code === "voided") { box.hidden = true; document.body.classList.remove("is-etx-confirm"); load().then(function () { window.CrediTrack.showToast(message); }); return; }   // already voided elsewhere
      showError($("v-error"), message);   // balance / missing: explained in the dialog, nothing was changed
    });
  });

  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });
  load();
})();
