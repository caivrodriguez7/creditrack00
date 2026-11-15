/* Store Owner > Customers > Customer Details (customer-details?id=...).
   Shows the customer's information, outstanding balance, credit/payment history and linked CrediTrack account (Customer Account). Edit opens the
   Edit Customer page (customer-form?id=...). This is a subpage: only a Back button and title (owner-shell.js). All data comes from js/api/owner-api.js. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var ICONS = window.CrediTrackIcons || {};
  var $ = function (id) { return document.getElementById(id); };

  var PAGE_SIZE = 10;
  var state = { id: new URLSearchParams(window.location.search).get("id"), data: null, filter: "all", visible: PAGE_SIZE };

  function peso(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(text) {
    var d = document.createElement("div");
    d.textContent = text;
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
  }
  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) + " · " +
      d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  }
  function dateOnly(iso) {
    return new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  }

  function renderHistory() {
    var all = state.data.history;
    var rows = all.filter(function (t) { return state.filter === "all" || t.type === state.filter; });
    var shown = rows.slice(0, state.visible);

    $("history-list").innerHTML = shown.map(function (t) {
      var isPayment = t.type === "payment";
      var title = isPayment ? "Payment received" : "Credit";
      var detail = isPayment ? t.method : t.note;
      return '<li class="list__row' + (t.voided ? " is-voided" : "") + '">' +
        '<span class="tx-icon tx-icon--' + t.type + '" aria-hidden="true">' + (ICONS[isPayment ? "payment" : "credit"] || "") + "</span>" +
        '<span class="list__main"><span class="list__name">' + esc(title) + (detail ? " &middot; " + esc(detail) : "") + (t.voided ? '<span class="void-tag">Voided</span>' : "") + "</span>" +
        '<span class="list__meta">' + esc(when(t.date)) + "</span>" +
        (t.voided && t.voidInfo ? '<span class="list__meta list__meta--void">Voided ' + esc(dateOnly(t.voidInfo.at)) + (t.voidInfo.by && t.voidInfo.by.name ? " by " + esc(t.voidInfo.by.name) : "") + (t.voidInfo.reasonLabel ? " \u00B7 " + esc(t.voidInfo.reasonLabel) : "") + "</span>" : "") + "</span>" +
        '<span class="list__amount ' + (isPayment ? "list__amount--in" : "list__amount--credit") + '">' + (isPayment ? "&minus;" : "+") + peso(t.amount) + "</span></li>";
    }).join("");
    $("history-list").hidden = !shown.length;
    $("history-more").hidden = rows.length <= shown.length;
    $("history-chips").hidden = !all.length;

    var empty = !rows.length;
    $("history-empty").hidden = !empty;
    if (empty) {
      if (!all.length) {
        $("history-empty-title").textContent = "No transactions yet";
        $("history-empty-text").textContent = "Credit and payments recorded for this customer will show up here.";
      } else {
        $("history-empty-title").textContent = state.filter === "credit" ? "No credits recorded" : "No payments recorded";
        $("history-empty-text").textContent = "Try another filter to see this customer\u2019s other activity.";
      }
    }
    document.querySelectorAll("#history-chips .chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.getAttribute("data-filter") === state.filter));
    });
  }

  // Customer Account: the customer's CrediTrack account linked to this record (data from api.getCustomer -> linkedAccount).
  // Not linked: the message and the Link Customer Account button. Linked: the account's details and its connection status instead.
  var CONNECTION = { connected: ["Connected", "badge--success"], disconnected: ["Disconnected", "badge--danger"] };
  function renderAccount() {
    var d = state.data, c = d.customer, a = d.linkedAccount;
    var linked = !!a, waiting = !linked && d.pendingLink;
    $("account-link").hidden = linked || !!waiting;
    $("account-cancel").hidden = !waiting;
    $("account-info").hidden = !linked;
    if (waiting) {   // the customer has to accept before anything is linked
      $("account-text").textContent = "Waiting for " + (waiting.account.name || "the customer") + " to accept your link request. It expires " + dateOnly(waiting.expiresAt) + ".";
      return;
    }
    if (!linked) {
      $("account-text").textContent = "This customer has not linked their CrediTrack account yet.";
      return;
    }
    var status = CONNECTION[a.status] || CONNECTION.disconnected;
    $("account-text").textContent = a.status === "connected"
      ? "This customer\u2019s CrediTrack account is linked."
      : "This customer\u2019s CrediTrack account is no longer connected.";
    $("account-name").textContent = a.name || "Not available";
    $("account-id").textContent = a.accountId || "Not available";
    $("account-email").textContent = a.email;
    $("account-phone").textContent = a.phone;
    $("account-email-row").hidden = !a.email;
    $("account-phone-row").hidden = !a.phone;
    $("account-linked").textContent = a.linkedAt ? dateOnly(a.linkedAt) : "Not available";
    $("account-status").textContent = status[0];
    $("account-status").className = "badge " + status[1];
  }

  function render() {
    var d = state.data, c = d.customer;
    document.title = c.name + " | CrediTrack";
    var avatar = $("cust-avatar");       // the customer's own profile photo when their account is linked and they set one
    avatar.textContent = "";
    if (c.photo) { var photoImg = document.createElement("img"); photoImg.src = c.photo; photoImg.alt = ""; avatar.appendChild(photoImg); }
    else avatar.textContent = initials(c.name);
    $("cust-name").textContent = c.name;
    $("cust-code").textContent = "Customer ID: " + c.code;

    var debt = c.balance > 0;
    var status = $("cust-status");
    status.textContent = c.archived ? "Archived" : c.overdueDays > 0 ? "Overdue" : debt ? "With Debt" : "Fully Paid";
    status.className = "badge " + (c.archived ? "badge--archived" : c.overdueDays > 0 ? "badge--danger" : debt ? "badge--warning" : "badge--success");
    $("archived-note").hidden = !c.archived;
    $("archived-when").textContent = c.archived && c.archivedAt ? " on " + dateOnly(c.archivedAt) : "";
    $("archive-btn").textContent = c.archived ? "Restore Customer" : "Archive Customer";
    $("archive-text").textContent = c.archived
      ? "Restoring brings this customer back to your active list and lets you record new utang for them."
      : "Archive a customer you no longer serve. They are hidden from your active list and from new utang, and nothing is deleted.";

    $("cust-balance").textContent = peso(c.balance);
    $("cust-credit").textContent = peso(d.totalCredit);
    $("cust-paid").textContent = peso(d.totalPayments);
    var overdue = $("cust-overdue");
    overdue.hidden = !(c.overdueDays > 0);
    overdue.textContent = c.overdueDays + (c.overdueDays === 1 ? " day overdue" : " days overdue");

    $("edit-open").href = "customer-form?id=" + encodeURIComponent(c.id);
    // Record Credit opens with this customer already selected (main.js reads the query on the route).
    var credit = document.querySelector('.actions [data-route^="record-credit"]');
    // An archived customer cannot get new utang: the button is switched off until they are restored.
    if (credit) {
      if (c.archived) { credit.removeAttribute("data-route"); credit.setAttribute("aria-disabled", "true"); credit.setAttribute("title", "Restore this customer to record new utang"); }
      else { credit.setAttribute("data-route", "record-credit?customer=" + encodeURIComponent(c.id)); credit.removeAttribute("aria-disabled"); credit.removeAttribute("title"); }
    }
    // Record Bayad does the same: this customer is already chosen and the owner starts at Payment Details.
    var payment = document.querySelector('.actions [data-route^="record-payment"]');
    if (payment) payment.setAttribute("data-route", "record-payment?customer=" + encodeURIComponent(c.id));

    $("info-name").textContent = c.name;
    $("info-phone").textContent = c.phone ? api.formatPhone(c.phone) : "Not provided";
    $("info-phone").classList.toggle("is-empty", !c.phone);
    $("info-code").textContent = c.code;
    $("info-since").textContent = c.createdAt ? dateOnly(c.createdAt) : "Not available";

    renderHistory();
    renderAccount();
  }

  function load() {
    return api.getCustomer(state.id).then(function (data) {
      state.data = data;
      var found = !!data.customer;
      $("missing").hidden = found;
      $("detail").hidden = !found;
      if (!found) { document.title = "Customer not found | CrediTrack"; return; }
      render();
    });
  }

  // Icons on the Record buttons (the shell exposes the shared icon set)
  document.querySelectorAll("[data-icon]").forEach(function (slot) { slot.outerHTML = ICONS[slot.getAttribute("data-icon")] || ""; });

  $("history-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    state.visible = PAGE_SIZE;
    renderHistory();
  });
  $("history-more").addEventListener("click", function () { state.visible += PAGE_SIZE; renderHistory(); });

  // Archive / Restore (with a confirmation). Nothing is deleted: history, payments and balance stay exactly as they are.
  var confirmBox = $("archive-confirm"), confirmFrom = null;
  function closeConfirm() { confirmBox.hidden = true; if (confirmFrom) { confirmFrom.focus(); confirmFrom = null; } }
  $("archive-btn").addEventListener("click", function () {
    var c = state.data && state.data.customer;
    if (!c) return;
    confirmFrom = $("archive-btn");
    if (c.archived) {
      $("archive-confirm-title").textContent = "Restore " + c.name + "?";
      $("archive-confirm-text").textContent = "They will appear in your active list again and can be chosen for new utang.";
      $("archive-confirm-yes").textContent = "Restore Customer";
    } else {
      $("archive-confirm-title").textContent = "Archive " + c.name + "?";
      $("archive-confirm-text").textContent = (c.balance > 0
        ? "They still owe " + peso(c.balance) + ". That balance stays on record and in your totals. "
        : "") + "They will be hidden from your active list and cannot be chosen for new utang. All transactions and payments are kept, and you can restore them anytime.";
      $("archive-confirm-yes").textContent = "Archive Customer";
    }
    confirmBox.hidden = false;
    $("archive-confirm-no").focus();
  });
  $("archive-confirm-no").addEventListener("click", closeConfirm);
  confirmBox.addEventListener("click", function (event) { if (event.target === confirmBox) closeConfirm(); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !confirmBox.hidden) closeConfirm(); });
  $("archive-confirm-yes").addEventListener("click", function () {
    var c = state.data && state.data.customer;
    if (!c) return;
    var btn = $("archive-confirm-yes"), was = !!c.archived;
    btn.disabled = true;
    (was ? api.restoreCustomer(c.id) : api.archiveCustomer(c.id)).then(function () {
      btn.disabled = false;
      confirmFrom = $("archive-btn");
      closeConfirm();
      return load().then(function () { window.CrediTrack.showToast(was ? "Customer restored." : "Customer archived."); });
    }).catch(function (err) {
      btn.disabled = false;
      closeConfirm();
      window.CrediTrack.showToast(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  });
  // The switched-off Record Utang button does nothing
  document.querySelector(".actions").addEventListener("click", function (event) {
    var a = event.target.closest('[aria-disabled="true"]');
    if (a) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  // Link Customer Account opens the linking modal (js/components/link-account.js); when an account was linked, the page redraws with it.
  $("account-link").addEventListener("click", function () {
    var c = state.data && state.data.customer;
    if (!c || !window.LinkAccount) return;
    window.LinkAccount.open({
      customerId: c.id,
      customerName: c.name,
      onLinked: function () {
        load().then(function () {
          window.CrediTrack.showToast(state.data && state.data.pendingLink ? "Link request sent. The customer has to accept it." : "Customer account linked.");
          $("account-title").scrollIntoView({ block: "center" });
        });
      }
    });
  });
  $("account-cancel").addEventListener("click", function () {
    var c = state.data && state.data.customer, button = $("account-cancel");
    if (!c || button.disabled) return;
    button.disabled = true;
    api.cancelLinkRequest(c.id).then(function () { window.CrediTrack.showToast("Link request cancelled."); return load(); })
      .catch(function (error) { window.CrediTrack.showToast(error && error.message ? error.message : "Could not cancel the request."); return load(); })
      .then(function () { button.disabled = false; });
  });

  // Back from Edit Customer can restore this page from the back/forward cache: show the saved changes.
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });

  load();
})();
