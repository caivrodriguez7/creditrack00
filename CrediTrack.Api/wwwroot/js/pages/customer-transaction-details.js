/* Customer Portal > Transaction Details (transaction-details?id=...&back=...).
   Shows one credit or payment from the customer's History list:
   - always: Transaction ID, type (Credit or Payment), date and time, store name, amount, status
   - credit: purchased items with quantity, unit price and the total amount, and the Due date the store agreed on
     ("No due date" when the store did not set one). The date is display only: customers cannot change it.
   - payment: payment method, reference number (if any) and payment details
   "Back to History" returns to the History view the customer came from (same tab, store filter and search):
   the browser's own Back when the customer arrived from History, otherwise a link rebuilt from ?back=.
   All data comes from js/api/customer-api.js getTransaction(). */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var id = params.get("id");

  var STATUS = {
    unpaid:   { label: "Unpaid",               cls: "badge--warning" },
    recorded: { label: "Confirmed",            cls: "badge--success" },
    pending:  { label: "Pending Verification", cls: "badge--warning" },
    rejected: { label: "Rejected",             cls: "badge--danger" },
    voided:   { label: "Voided",               cls: "badge--danger" }
  };

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function dateLong(d) { return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }); }
  function timeOf(d) { return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); }); }
  // "2026-11-20" -> "November 20, 2026", read as a calendar day (never shifted by time zone). "" or anything else -> "".
  function dueText(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || "");
    return m ? dateLong(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : "";
  }
  function qtyText(i) { return i.qty + (i.unit ? " " + (i.unit === "pcs" && i.qty === 1 ? "pc" : i.unit) : ""); }
  function rows(list) {
    return list.map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd" + (r[2] ? ' class="is-empty"' : "") + ">" + esc(r[1]) + "</dd></div>";
    }).join("");
  }

  // ---------- Back to History ----------
  // ?back= holds the History view ("tab=credit&store=str-002&q=gcash"). Only those three keys are kept.
  function historyHref() {
    var incoming = new URLSearchParams(params.get("back") || ""), out = new URLSearchParams();
    ["tab", "store", "q"].forEach(function (k) { if (incoming.get(k)) out.set(k, incoming.get(k)); });
    var query = out.toString();
    return "history" + (query ? "?" + query : "");
  }
  function cameFromHistory() {
    if (window.history.length < 2 || !document.referrer) return false;
    try {
      var from = new URL(document.referrer);
      return from.origin === window.location.origin && /^\/customer\/history$/.test(from.pathname);
    } catch (e) { return false; }
  }
  function wireBack() {
    var href = historyHref();
    ["back-top", "back-bottom"].forEach(function (name) {
      var link = $(name);
      link.setAttribute("href", href);
      link.addEventListener("click", function (event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;   // let "open in new tab" work
        // Coming from History: step back so its scroll position is kept too. History's address already holds the view.
        if (cameFromHistory()) { event.preventDefault(); window.history.back(); }
      });
    });
  }

  // ---------- Render ----------
  function render(t) {
    var pay = t.type !== "credit";                       // a payment request is shown as a Payment (status Pending / Rejected)
    var voided = !!t.voided;
    var st = voided ? STATUS.voided : t.type === "credit" ? STATUS.unpaid : (STATUS[t.status] || STATUS.recorded);
    $("detail").classList.toggle("is-voided", voided);
    var d = new Date(t.date);
    var typeName = pay ? "Payment" : "Credit";
    document.title = typeName + " " + t.code + " | CrediTrack";

    var icon = $("txd-icon");
    icon.className = "txd-head__icon tx-icon--" + (pay ? "payment" : "credit");
    icon.innerHTML = (pay ? ICONS.payment : ICONS.credit) || "";
    $("txd-title").textContent = !pay ? "Credit Transaction" : (t.type === "request" ? "Payment Request" : "Payment Transaction");
    $("txd-meta").textContent = t.code + " · " + dateLong(d);
    var badge = $("txd-status");
    badge.textContent = st.label;
    badge.className = "badge " + st.cls;

    $("amount-label").textContent = voided ? "Original Amount (voided)" : pay ? "Payment Amount" : "Transaction Amount";
    $("txd-amount").textContent = peso(t.amount);
    $("txd-store").textContent = t.storeName || "Unknown store";

    // Credit: items. Payment: method, reference and details.
    $("items-panel").hidden = pay;
    $("payment-panel").hidden = !pay;
    if (!pay) {
      $("txd-items").innerHTML = t.items.map(function (i) {
        return '<li><span><span class="txd-item__name">' + esc(i.name) + "</span>" +
          '<span class="txd-item__calc">' + esc(qtyText(i)) + " × " + esc(peso(i.price)) + " each</span></span>" +
          '<span class="txd-item__amount">' + peso(i.amount) + "</span></li>";
      }).join("");
      $("items-none").hidden = t.items.length > 0;
      $("txd-total").textContent = peso(t.amount);
    } else {
      var balance = voided ? "Reversed. This payment was voided, so it is added back to your balance" : t.status === "recorded" ? "Deducted from your balance" : t.status === "pending" ? "Not yet updated. Waiting for the store to verify" : "Not changed. The request was not accepted";
      $("txd-payment").innerHTML = rows([
        ["Payment method", t.method || "Not specified"],
        ["Reference number", t.reference || (t.method === "Cash" ? "Not applicable (cash)" : "Not provided"), !t.reference],
        ["Amount paid", peso(t.amount)],
        [t.type === "request" ? "Date submitted" : "Date recorded", dateLong(d)],
        ["Balance status", balance]
      ].concat(t.status === "rejected" ? [["Reason from the store", t.rejectionReason || "The store owner did not give a reason.", !t.rejectionReason]] : [])
        .concat(t.note ? [["Your message", t.note]] : []));
    }

    // Pay a credit's remaining amount, with the credit ID and balance passed to the existing request form.
    var payBtn = $("txd-pay");
    var outstanding = typeof t.remaining === "number" ? t.remaining : (t.status === "unpaid" ? t.amount : 0);
    payBtn.hidden = pay || voided || !t.storeId || outstanding <= 0;
    if (!payBtn.hidden) {
      var transactionId = t.transactionId || String(t.id || "").replace(/^tx-/, "");
      payBtn.setAttribute("href", "request-payment?store=" + encodeURIComponent(t.storeId) +
        "&transactionId=" + encodeURIComponent(transactionId) + "&amount=" + encodeURIComponent(outstanding.toFixed(2)));
      payBtn.textContent = "Pay " + peso(outstanding);
    }

    // Only a credit can have a due date; a payment has none, so it gets no row. No date saved = "No due date".
    var due = !pay ? dueText(t.dueDate) : "";
    $("txd-info").innerHTML = rows([
      ["Transaction ID", t.code],
      ["Transaction type", typeName],
      ["Date and time", dateLong(d) + " · " + timeOf(d)]
    ].concat(!pay ? [["Due date", due || "No due date", !due]] : []).concat([
      ["Store name", t.storeName || "Unknown store"],
      ["Amount", peso(t.amount)],
      ["Status", st.label]
    ]).concat(voided && t.voidInfo ? [
      ["Voided on", dateLong(new Date(t.voidInfo.at)) + " · " + timeOf(new Date(t.voidInfo.at))],
      ["Voided by", "The store"],
      ["Reason", t.voidInfo.reason || "Not recorded", !t.voidInfo.reason]
    ].concat(t.voidInfo.remarks ? [["Remarks", t.voidInfo.remarks]] : []) : []));
  }

  function load() {
    var ready = id ? api.getTransaction(id) : Promise.resolve({ isSample: false, transaction: null });
    return ready.then(function (data) {
      var found = !!data.transaction;
      $("missing").hidden = found;
      $("detail").hidden = !found;
      if (!found) { document.title = "Transaction not found | CrediTrack"; return; }
      render(data.transaction);
    });
  }

  wireBack();
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });
  load();
})();
