/* Store Owner > Payment Requests > Review Payment (payment-request-details?id=...), a subpage. Mock data only.
   Shows one payment request (amount, method, reference number, proof of payment, what the balance would be) and lets the owner
   Confirm (after one more confirmation) or Reject (a reason is required). All rules live in js/api/owner-api.js:
   only approving creates a payment and lowers the balance, and a request can be reviewed once. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };
  var id = new URLSearchParams(window.location.search).get("id");
  var current = null, busy = false;
  var STATUS = {
    pending:  { label: "Pending",  cls: "badge--pending" },
    confirmed: { label: "Confirmed", cls: "badge--success" },
    rejected: { label: "Rejected", cls: "badge--danger" },
    voided:   { label: "Voided",   cls: "badge--voided" }
  };

  function peso(n) { return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text == null ? "" : text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function clock(iso) { return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/i, function (m) { return m.toUpperCase(); }); }
  function stamp(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) + " · " + clock(iso); }
  function rows(list) {
    return list.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd" + (r[2] ? ' class="is-empty"' : "") + ">" + esc(r[1]) + "</dd></div>"; }).join("");
  }

  function renderProof(r) {
    var box = $("prd-proof");
    if (!r.proof) {
      box.className = "";
      box.innerHTML = '<div class="prd-noproof"><strong>No proof uploaded</strong>The customer did not attach a screenshot or receipt. Check the reference number against your own records before approving.</div>';
      return;
    }
    box.className = "prd-proof";
    box.innerHTML = '<div class="prd-proof__frame"><img src="' + esc(r.proof) + '" alt="Proof of payment uploaded by ' + esc(r.customer) + '"></div>' +
      '<button class="btn btn--ghost prd-proof__toggle" type="button" id="proof-toggle" aria-pressed="false">View Larger</button>';
    $("proof-toggle").addEventListener("click", function () {
      var large = box.classList.toggle("is-large");
      this.textContent = large ? "View Smaller" : "View Larger";
      this.setAttribute("aria-pressed", String(large));
    });
  }

  function render(data) {
    var r = data.request;
    current = r;
    var ps = r.paymentStatus || r.status, pending = ps === "pending", st = STATUS[ps] || STATUS.pending;
    document.title = "Review Payment | CrediTrack";
    $("prd-status").textContent = st.label;
    $("prd-status").className = "badge " + st.cls;
    $("prd-amount").textContent = peso(r.amount);
    var link = $("prd-customer");
    link.textContent = r.customer || "Unknown customer";
    link.href = "customer-details?id=" + encodeURIComponent(r.customerId);

    $("prd-details").innerHTML = rows([
      ["Payment method", r.method || "Not specified"],
      ["Reference number", r.reference || "Not provided", !r.reference],
      ["Amount", peso(r.amount)],
      ["Submitted", stamp(r.submittedAt)]
    ].concat(r.note ? [["Message from customer", r.note]] : []));
    renderProof(r);

    // What approving would do (pending), or the result (reviewed)
    $("prd-balance-panel").hidden = !pending;
    if (pending) {
      $("prd-balance").innerHTML = rows([
        ["Current balance", peso(r.customerBalance)],
        ["This payment", "− " + peso(r.amount)],
        ["Balance after confirmation", r.exceedsBalance ? "Not available" : peso(r.balanceAfter), r.exceedsBalance]
      ]);
      $("prd-warn").hidden = !r.exceedsBalance;
      $("prd-warn").innerHTML = "<strong>Cannot be confirmed</strong>This payment is more than " + esc(r.customer) + "’s current balance of " + esc(peso(r.customerBalance)) + ". You can reject it and tell the customer why.";
    }
    $("prd-outcome-panel").hidden = pending;
    if (!pending) {
      var confirmed = ps === "confirmed", voided = ps === "voided", approved = confirmed || voided;
      var v = r.voidInfo;
      $("prd-outcome-title").textContent = voided ? "Voided" : confirmed ? "Confirmed" : "Rejected";
      var list = [[approved ? "Confirmed on" : "Rejected on", r.reviewedAt ? stamp(r.reviewedAt) : "Not recorded", !r.reviewedAt]];
      if (approved) list.push(["Payment recorded", data.transaction ? data.transaction.code : "Yes"]);
      if (voided) {
        list.push(["Voided on", v && v.at ? stamp(v.at) : "Not recorded", !(v && v.at)]);
        list.push(["Voided by", v && v.by && v.by.name ? v.by.name + " (" + (v.by.role || "Store Owner") + ")" : "Store owner"]);
        list.push(["Reason", v && v.reasonLabel ? v.reasonLabel + (v.remarks ? ": " + v.remarks : "") : "Not recorded", !(v && v.reasonLabel)]);
        list.push(["Customer’s balance", "Payment reversed. The amount is owed again."]);
      } else if (confirmed) list.push(["Customer’s balance", "Updated"]);
      else list.push(["Reason", r.rejectionReason || "Not recorded", !r.rejectionReason], ["Customer’s balance", "Not changed"]);
      $("prd-outcome").innerHTML = rows(list);
      var tx = $("prd-tx");
      tx.hidden = !(approved && data.transaction);
      if (data.transaction) tx.href = "transaction-details?id=" + encodeURIComponent(data.transaction.id);
    }

    // Archive / Restore: reviewed requests only
    $("archive-panel").hidden = pending;
    $("archive-note").hidden = !r.archived;
    $("archived-when").textContent = r.archived && r.archivedAt ? " on " + new Date(r.archivedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "";
    $("archive-open").textContent = r.archived ? "Restore Request" : "Archive Request";
    $("archive-buttons").hidden = false;
    $("archive-confirm").hidden = true;

    // Actions only while pending
    $("actions").hidden = !pending;
    $("approve-open").disabled = !!r.exceedsBalance;
    showButtons();
  }

  function showButtons() {
    $("action-buttons").hidden = false;
    $("approve-confirm").hidden = true;
    $("reject-form").hidden = true;
  }
  function setReasonError(message) {
    $("reject-error").textContent = message;
    $("reject-error").hidden = !message;
    if (message) $("reject-reason").setAttribute("aria-invalid", "true"); else $("reject-reason").removeAttribute("aria-invalid");
  }

  function showResult(kind, title, text) {
    var box = $("result");
    box.className = "notice prd-result" + (kind === "rejected" ? " prd-result--rejected" : "");
    box.innerHTML = "<p><strong>" + esc(title) + "</strong>" + esc(text) + "</p>";
    box.hidden = false;
    box.scrollIntoView({ block: "nearest" });
  }

  // ---- Archive / Restore (with a confirmation; nothing is deleted) ----
  $("archive-open").addEventListener("click", function () {
    if (!current) return;
    var restoring = !!current.archived;
    $("archive-title").textContent = restoring ? "Restore this payment request?" : "Archive this payment request?";
    $("archive-text").textContent = restoring ? "It will show in the " + (STATUS[current.paymentStatus] || STATUS.pending).label + " tab again."
      : "It will be hidden from the status tabs and kept under Archived. The payment record and " + current.customer + "\u2019s balance are not changed.";
    $("archive-yes").textContent = restoring ? "Yes, Restore" : "Yes, Archive";
    $("archive-buttons").hidden = true;
    $("archive-confirm").hidden = false;
    $("archive-yes").focus();
  });
  $("archive-cancel").addEventListener("click", function () { $("archive-confirm").hidden = true; $("archive-buttons").hidden = false; $("archive-open").focus(); });
  $("archive-yes").addEventListener("click", function () {
    if (busy || !current) return;
    busy = true; $("archive-yes").disabled = true;
    var was = !!current.archived;
    (was ? api.restorePaymentRequest(id) : api.archivePaymentRequest(id)).then(function () {
      return api.getPaymentRequest(id).then(function (data) { render(data); toast(was ? "Payment request restored." : "Payment request archived."); });
    }).catch(function (err) {
      toast(err && err.message ? err.message : "Something went wrong. Please try again.");
      return api.getPaymentRequest(id).then(render);
    }).then(function () { busy = false; $("archive-yes").disabled = false; });
  });

  // ---- Approve ----
  $("approve-open").addEventListener("click", function () {
    if (!current || current.exceedsBalance) return;
    $("approve-text").textContent = peso(current.amount) + " will be recorded as a " + current.method + " payment from " + current.customer +
      ", and their balance will go from " + peso(current.customerBalance) + " to " + peso(current.balanceAfter) + ".";
    $("action-buttons").hidden = true;
    $("approve-confirm").hidden = false;
    $("approve-confirm-btn").focus();
  });
  $("approve-cancel").addEventListener("click", function () { showButtons(); $("approve-open").focus(); });
  $("approve-confirm-btn").addEventListener("click", function () {
    if (busy) return;
    busy = true; $("approve-confirm-btn").disabled = true;               // a double click can never approve twice
    api.approvePaymentRequest(id).then(function (result) {
      return api.getPaymentRequest(id).then(function (data) {
        render(data);
        showResult("confirmed", "Payment confirmed", peso(result.request.amount) + " was recorded as " + result.transaction.code + ". " + result.request.customer + "’s balance is now " + peso(result.customer.balance) + ".");
        toast("Payment confirmed.");
      });
    }).catch(function (err) {
      toast(err && err.message ? err.message : "Something went wrong. Please try again.");
      return api.getPaymentRequest(id).then(render);                     // show what the request looks like now (for example already reviewed)
    }).then(function () { busy = false; $("approve-confirm-btn").disabled = false; });
  });

  // ---- Reject ----
  $("reject-open").addEventListener("click", function () {
    $("action-buttons").hidden = true;
    $("reject-form").hidden = false;
    setReasonError("");
    $("reject-reason").focus();
  });
  $("reject-cancel").addEventListener("click", function () {
    $("reject-reason").value = ""; $("reject-count").textContent = "0"; setReasonError("");
    showButtons(); $("reject-open").focus();
  });
  $("reject-reason").addEventListener("input", function () {
    $("reject-count").textContent = this.value.length;
    if (this.hasAttribute("aria-invalid")) setReasonError("");
  });
  $("reject-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;
    busy = true; $("reject-confirm-btn").disabled = true;
    api.rejectPaymentRequest(id, $("reject-reason").value).then(function (result) {
      return api.getPaymentRequest(id).then(function (data) {
        render(data);
        showResult("rejected", "Payment rejected", result.request.customer + "’s balance was not changed.");
        toast("Payment rejected.");
      });
    }).catch(function (err) {
      if (err && err.errors && err.errors.reason) { setReasonError(err.errors.reason); $("reject-reason").focus(); toast("Please give a reason."); }
      else {
        toast(err && err.message ? err.message : "Something went wrong. Please try again.");
        return api.getPaymentRequest(id).then(render);
      }
    }).then(function () { busy = false; $("reject-confirm-btn").disabled = false; });
  });

  api.getPaymentRequest(id).then(function (data) {
    $("missing").hidden = !!data.request;
    $("detail").hidden = !data.request;
    if (!data.request) { document.title = "Payment request not found | CrediTrack"; return; }
    render(data);
  }).catch(function (err) {
    toast(err && err.message ? err.message : "Could not load this payment request. Please try again.");
  });
})();
