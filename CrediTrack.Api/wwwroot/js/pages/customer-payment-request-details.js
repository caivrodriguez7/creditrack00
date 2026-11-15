/* Customer Portal > My Payments > Payment Request Details (payment-request-details?id=...&back=...).
   Shows one payment request from the Payments list: store, amount, method, reference number, proof of payment (with
   View Larger), the customer's note, submission date and time, and the current status.
   - Pending    explains that the request is waiting for the store owner's review
   - Completed  shows the approval date and the payment confirmation details
   - Rejected   shows the reason the store owner gave
   "Back to Payments" returns to the Payments view the customer came from (same status tab and store filter):
   the browser's own Back when the customer arrived from Payments, otherwise a link rebuilt from ?back=.
   Opened from a notification (?from=notifications) the button reads "Back to Notifications" and returns there instead.
   This screen only reads: the request workflow (submit, then the store approves or rejects) is unchanged.
   All data comes from js/api/customer-api.js getPaymentRequest(). */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var id = params.get("id");

  var ICON_ATTR = 'width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var STATUS = {   // same words, colours and icons as the Payments list
    pending:   { label: "Pending",   icon: '<svg ' + ICON_ATTR + '><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
    completed: { label: "Completed", icon: '<svg ' + ICON_ATTR + '><circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.5 2.5 4.5-5"/></svg>' },
    rejected:  { label: "Rejected",  icon: '<svg ' + ICON_ATTR + '><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>' }
  };

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text == null ? "" : text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function dateLong(d) { return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }); }
  function timeOf(d) { return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); }); }
  function stamp(iso) { var d = new Date(iso); return dateLong(d) + " · " + timeOf(d); }
  function rows(list) {
    return list.map(function (r) {
      return "<div><dt>" + esc(r[0]) + "</dt><dd" + (r[2] ? ' class="is-empty"' : "") + ">" + esc(r[1]) + "</dd></div>";
    }).join("");
  }

  // ---------- Back ----------
  // From the Payments list: "Back to Payments", with the Payments view kept. ?back= holds that view ("tab=pending&store=str-002&method=gcash&range=30"),
  // and only those keys are kept.
  // From a notification (?from=notifications): "Back to Notifications".
  var fromNotifications = params.get("from") === "notifications";
  function paymentsHref() {
    var incoming = new URLSearchParams(params.get("back") || ""), out = new URLSearchParams();
    ["tab", "store", "method", "range", "from", "to"].forEach(function (k) { if (incoming.get(k)) out.set(k, incoming.get(k)); });
    var query = out.toString();
    return "payments" + (query ? "?" + query : "");
  }
  function cameFrom(pattern) {
    if (window.history.length < 2 || !document.referrer) return false;
    try {
      var from = new URL(document.referrer);
      return from.origin === window.location.origin && pattern.test(from.pathname);
    } catch (e) { return false; }
  }
  function wireBack() {
    var href = fromNotifications ? "notifications" : paymentsHref();
    var pattern = fromNotifications ? /^\/customer\/notifications$/ : /^\/customer\/payments$/;
    var label = fromNotifications ? "Back to Notifications" : "Back to Payments";
    $("back-top").querySelector("span").textContent = label;
    $("back-bottom").textContent = label;
    ["back-top", "back-bottom"].forEach(function (name) {
      var link = $(name);
      link.setAttribute("href", href);
      link.addEventListener("click", function (event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;   // let "open in new tab" work
        // Coming from the list: step back so its scroll position is kept too. Its address already holds the view.
        if (cameFrom(pattern)) { event.preventDefault(); window.history.back(); }
      });
    });
  }

  // ---------- Proof of payment + View Larger ----------
  function renderProof(r) {
    var box = $("prq-proof");
    if (!r.proof) {
      box.innerHTML = '<div class="prq-noproof"><strong>No proof uploaded</strong>' +
        (r.method === "Cash" ? "A picture is not needed for a cash payment." : "No screenshot or receipt was attached to this payment.") + "</div>";
      return;
    }
    if (!r.proof.dataUrl) {   // the file name was kept but the picture was too large to store
      box.innerHTML = '<div class="prq-noproof"><strong>Proof uploaded</strong>' + esc(r.proof.name) + " (the picture is not available to view here).</div>";
      return;
    }
    box.innerHTML = '<div class="prq-proof">' +
      '<button class="prq-proof__frame" type="button" id="proof-open" aria-label="View larger: proof of payment ' + esc(r.proof.name) + '">' +
      '<img src="' + esc(r.proof.dataUrl) + '" alt="Proof of payment for the ' + esc(peso(r.amount)) + ' payment to ' + esc(r.storeName) + '"></button>' +
      '<button class="btn btn--secondary prq-proof__view" type="button" id="proof-view">View Larger</button></div>';
    var open = function () {
      $("viewer-img").src = r.proof.dataUrl;
      $("viewer-img").alt = "Proof of payment, larger view";
      var dialog = $("viewer");
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
      $("viewer-close").focus();
    };
    $("proof-open").addEventListener("click", open);
    $("proof-view").addEventListener("click", open);
  }
  function closeViewer() {
    var dialog = $("viewer");
    if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
  }
  $("viewer-close").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", function (event) { if (event.target === $("viewer")) closeViewer(); });   // click outside the picture
  $("viewer").addEventListener("close", function () { var b = $("proof-view"); if (b) b.focus(); });

  // ---------- Render ----------
  function renderState(r) {
    var panel = $("prq-state"), list = $("prq-state-list");
    panel.className = "panel prq-state prq-state--" + r.status;
    list.hidden = true;
    if (r.status === "pending") {
      $("prq-state-title").textContent = "Waiting for the store owner’s review";
      $("prq-state-text").textContent = "Your request was sent to " + (r.storeName || "the store") + ". The store owner will check it and either approve or reject it. Your balance has not changed yet and will only go down if the request is approved.";
    } else if (r.status === "completed") {
      $("prq-state-title").textContent = r.fromRequest ? "Confirmed by the store" : "Recorded by the store";
      $("prq-state-text").textContent = "This payment was recorded and has been deducted from your balance at " + (r.storeName || "the store") + ".";
      list.hidden = false;
      list.innerHTML = rows([
        [r.fromRequest ? "Confirmed on" : "Recorded on", r.reviewedAt ? stamp(r.reviewedAt) : "Not recorded", !r.reviewedAt],
        ["Confirmation number", r.confirmationCode],
        ["Amount recorded", peso(r.amount)],
        ["Payment method", r.method || "Not specified", !r.method],
        ["Reference number", refText(r), !r.reference],
        ["Your balance", "Deducted by " + peso(r.amount)]
      ]);
    } else {
      $("prq-state-title").textContent = "Not accepted by the store";
      $("prq-state-text").textContent = "Your balance was not changed. Reason from the store owner:";
      list.hidden = false;
      list.innerHTML = rows([
        ["Reason", r.rejectionReason || "The store owner did not give a reason.", !r.rejectionReason],
        ["Rejected on", r.reviewedAt ? stamp(r.reviewedAt) : "Not recorded", !r.reviewedAt]
      ]);
    }
  }
  function refText(r) { return r.reference || (r.method === "Cash" ? "Not applicable (cash)" : "Not provided"); }

  function render(r) {
    var st = STATUS[r.status] || STATUS.pending;
    document.title = "Payment Request " + r.code + " | CrediTrack";

    var badge = $("prq-status");
    badge.className = "pstatus pstatus--" + r.status;
    badge.innerHTML = st.icon + esc(st.label);
    $("prq-amount").textContent = peso(r.amount);
    $("prq-store").textContent = r.storeName || "Unknown store";

    renderState(r);

    $("prq-details").innerHTML = rows([
      ["Store", r.storeName || "Unknown store"],
      ["Requested amount", peso(r.amount)],
      ["Payment method", r.method || "Not specified", !r.method],
      ["Reference number", refText(r), !r.reference],
      ["Submitted", stamp(r.submittedAt)],
      ["Status", st.label],
      ["Request ID", r.code]
    ]);

    renderProof(r);
    $("prq-note-panel").hidden = !r.note;
    $("prq-note").textContent = r.note || "";
  }

  function load() {
    var ready = id ? api.getPaymentRequest(id) : Promise.resolve({ isSample: false, request: null });
    return ready.then(function (data) {
      var found = !!data.request;
      $("missing").hidden = found;
      $("detail").hidden = !found;
      if (!found) { document.title = "Payment request not found | CrediTrack"; return; }
      render(data.request);
    }).catch(function (err) {
      window.CrediTrack.showToast(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  }

  wireBack();
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });
  load();
})();
