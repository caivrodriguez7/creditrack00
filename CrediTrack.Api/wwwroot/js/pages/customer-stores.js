/* Customer Portal > Connected Stores (customer/stores).
   Lists every store the customer joined, each with its OWN balance, payment status and details, and lets the customer
   leave a store (after a confirmation) or reconnect one they left. Nothing is ever added across stores here.
   Leaving only changes the connection: the store's balance and every transaction are kept (customer-api.js disconnectStore),
   so a store that was left moves to "Disconnected" and still shows in History and Payments.
   Data: CrediTrackCustomerApi.getConnectedStores(), disconnectStore(id), reconnectStore(id).
   "View details" on a Home My Stores card opens this page with ?store=<id>: that card is opened and scrolled into view. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var data = null;                 // what getConnectedStores() returned
  var open = {};                   // store ids whose details are open (kept when the list redraws)
  var leaving = null;              // the store being left (dialog open)
  var saving = false;
  var lastFocus = null;
  var focusId = new URLSearchParams(window.location.search).get("store") || "";

  function peso(n) { return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text == null ? "" : text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : ""; }
  // The store owner's picture (saved on the server, shown only while I am connected to the store). A picture that cannot be loaded is
  // removed so the normal store icon / initial shows instead.
  function ownerPic(s, cls) {
    return s.ownerPhoto ? '<img class="' + cls + '" src="' + esc(s.ownerPhoto) + '" alt="" width="40" height="40" loading="lazy" data-owner-photo>' : "";
  }
  function bindOwnerPics(container) {
    container.querySelectorAll("img[data-owner-photo]").forEach(function (img) {
      img.addEventListener("error", function () { img.remove(); });
    });
  }
  function bindRoutes(container) {
    bindOwnerPics(container);
    container.querySelectorAll("[data-route]").forEach(function (link) {
      link.addEventListener("click", function (event) { event.preventDefault(); window.CrediTrack.goTo(link.getAttribute("data-route")); });
    });
  }

  // ---------- A store card ----------
  function detailRows(s) {
    var rows = [
      ["Store name", s.name], ["Store type", s.type], ["Store code", s.code],
      ["Store owner", s.owner || "Not provided"], ["Location", s.location || "Not provided"],
      ["Joined", day(s.joinedAt)],
      ["Customer record", s.linkedRecord ? s.linkedRecord + " (linked)" : "None (joined as a new customer)"],
      ["Total credits", peso(s.totalCredit)], ["Total payments", peso(s.totalPaid)],
      ["Transactions", String(s.transactionCount)], ["Last activity", s.lastActivityAt ? day(s.lastActivityAt) : "No activity yet"]
    ];
    if (!s.connected) rows.push(["Disconnected on", day(s.disconnectedAt)]);
    return rows.map(function (r) {
      var pic = r[0] === "Store owner" ? ownerPic(s, "cs-owner-pic") : "";
      return "<div><dt>" + esc(r[0]) + "</dt><dd>" + (pic ? '<span class="cs-owner">' + pic + "<span>" + esc(r[1]) + "</span></span>" : esc(r[1])) + "</dd></div>";
    }).join("");
  }

  function card(s) {
    var isOpen = !!open[s.id];
    var facts = ['<li>' + esc(s.location || "Location not provided") + "</li>",
      "<li>Joined " + day(s.joinedAt) + " · " + plural(s.transactionCount, "transaction", "transactions") + "</li>"].join("");
    var pending = s.pendingCount ? '<span class="cs-pending">' + peso(s.pendingAmount) + " payment pending verification</span>" : "";
    var kept = s.connected ? "" : '<p class="cs-kept">Balance and records kept. Reconnect to pay this store again.</p>';
    var action = s.connected
      ? '<button class="btn btn--ghost cs-leave" type="button" data-leave="' + esc(s.id) + '">Leave Store</button>'
      : '<button class="btn btn--primary" type="button" data-reconnect="' + esc(s.id) + '">Reconnect</button>';
    return '<article class="cs-card' + (s.connected ? "" : " cs-card--left") + '" id="store-' + esc(s.id) + '" data-store="' + esc(s.id) + '" aria-labelledby="name-' + esc(s.id) + '">' +
      '<header class="cs-card__top">' +
      '<span class="cs-card__icon' + (s.ownerPhoto ? " cs-card__icon--photo" : "") + '" aria-hidden="true">' + (ownerPic(s, "cs-card__photo") || ICONS.store || "") + "</span>" +
      '<div class="cs-card__id"><h3 class="cs-card__name" id="name-' + esc(s.id) + '" tabindex="-1">' + esc(s.name) + "</h3>" +
      '<p class="cs-card__type">' + esc(s.type) + " · " + esc(s.code) + "</p></div>" +
      '<span class="badge ' + (s.connected ? "badge--success" : "badge--muted") + '">' + (s.connected ? "Connected" : "Disconnected") + "</span></header>" +
      '<div class="cs-card__balance"><div><span class="cs-label">Outstanding balance</span><span class="cs-amount">' + peso(s.balance) + "</span></div>" +
      '<span class="badge badge--' + s.status.tone + '">' + esc(s.status.label) + "</span></div>" +
      '<ul class="cs-card__facts">' + facts + "</ul>" + pending + kept +
      '<div class="cs-card__actions">' +
      '<button class="btn btn--secondary" type="button" data-details="' + esc(s.id) + '" aria-expanded="' + isOpen + '" aria-controls="det-' + esc(s.id) + '">' +
      "<span>" + (isOpen ? "Hide Store Details" : "View Store Details") + "</span>" + (ICONS.chevronDown || "") + "</button>" + action + "</div>" +
      '<div class="cs-details" id="det-' + esc(s.id) + '"' + (isOpen ? "" : " hidden") + '><dl class="cs-details__list">' + detailRows(s) + "</dl>" +
      '<a class="cs-details__link" href="#" data-route="customer-history?store=' + encodeURIComponent(s.id) + '">View this store’s transactions</a></div>' +
      "</article>";
  }

  // ---------- The page ----------
  function render() {
    var c = data.connected, d = data.disconnected;

    $("empty-none").hidden = !!(c.length || d.length);
    $("connected-section").hidden = !(c.length || d.length);
    $("connected-count").textContent = c.length + " connected";
    $("connected-list").innerHTML = c.map(card).join("");
    $("connected-empty").hidden = c.length > 0;
    $("join-another").hidden = !c.length;
    $("left-section").hidden = !d.length;
    $("left-count").textContent = d.length + " disconnected";
    $("left-list").innerHTML = d.map(card).join("");

    document.querySelector(".cs-add__icon").innerHTML = ICONS.plus || "";
    bindRoutes($("page"));
  }

  function load() {
    return api.getConnectedStores().then(function (result) { data = result; render(); }).catch(function (err) {
      window.CrediTrack.showToast(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  }

  function find(id) { return data.connected.concat(data.disconnected).filter(function (s) { return s.id === id; })[0] || null; }

  // ---------- Leave Store (with confirmation) ----------
  function openLeave(store, trigger) {
    leaving = store; lastFocus = trigger;
    $("leave-title").textContent = "Leave " + store.name + "?";
    var keeps = [];
    keeps.push(store.balance > 0
      ? "Your balance of " + peso(store.balance) + " stays on record. Leaving does not cancel what you owe."
      : "You have no balance at this store.");
    keeps.push("All " + plural(store.transactionCount, "transaction", "transactions") + " stay in History and Payments.");
    if (store.pendingCount) keeps.push("Your " + peso(store.pendingAmount) + " payment request is still with the store for verification.");
    keeps.push("You can reconnect anytime from Connected Stores.");
    $("leave-keeps").innerHTML = keeps.map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("");
    $("leave-error").hidden = true;
    $("leave-confirm").disabled = false; $("leave-confirm").textContent = "Leave Store";
    $("leave-dialog").showModal();
    $("leave-cancel").focus();   // the safe choice has focus first
  }
  function closeLeave() { if ($("leave-dialog").open) $("leave-dialog").close(); }

  $("leave-cancel").addEventListener("click", closeLeave);
  $("leave-dialog").addEventListener("click", function (event) { if (event.target === $("leave-dialog")) closeLeave(); });   // click outside the card
  $("leave-dialog").addEventListener("close", function () {
    leaving = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  });
  $("leave-confirm").addEventListener("click", function () {
    if (!leaving || saving) return;          // pressing twice cannot leave twice
    saving = true;
    var store = leaving, button = $("leave-confirm");
    button.disabled = true; button.textContent = "Leaving...";
    api.disconnectStore(store.id).then(function (result) {
      lastFocus = null;
      closeLeave();
      saving = false;
      toast("You left " + result.store.name + ". Your balance and records were kept.");
      $("live").textContent = "You left " + result.store.name + ". It now appears under Disconnected.";
      return load().then(function () { var h = $("name-" + store.id); if (h) h.focus(); });
    }).catch(function (error) {
      saving = false;
      button.disabled = false; button.textContent = "Leave Store";
      $("leave-error").textContent = error && error.message ? error.message : "Something went wrong. Please try again.";
      $("leave-error").hidden = false;
      if (error && error.code === "already") load();
    });
  });

  // ---------- Buttons on the cards ----------
  $("page").addEventListener("click", function (event) {
    var details = event.target.closest("[data-details]");
    if (details) {
      var id = details.getAttribute("data-details"), box = $("det-" + id), show = box.hidden;
      box.hidden = !show; open[id] = show;
      details.setAttribute("aria-expanded", String(show));
      details.querySelector("span").textContent = show ? "Hide Store Details" : "View Store Details";
      return;
    }
    var leave = event.target.closest("[data-leave]");
    if (leave) { var store = find(leave.getAttribute("data-leave")); if (store) openLeave(store, leave); return; }
    var back = event.target.closest("[data-reconnect]");
    if (back) {
      var s = find(back.getAttribute("data-reconnect"));
      if (!s || back.disabled) return;
      back.disabled = true;
      api.reconnectStore(s.id).then(function () {
        toast("Reconnected to " + s.name + ".");
        $("live").textContent = "Reconnected to " + s.name + ". It is back under Connected.";
        return load().then(function () { var h = $("name-" + s.id); if (h) h.focus(); });
      }).catch(function (error) { back.disabled = false; toast(error && error.message ? error.message : "Could not reconnect. Please try again."); load(); });
    }
  });


  // ---------- Requests (consent) ----------
  // A store that wants to link its record of me to my account asks first: nothing is linked until I accept.
  // A join request I sent waits for the owner; I can cancel it. (Real accounts only; the demo has none.)
  var requests = { incoming: [], outgoing: [] };
  function daysLeft(iso) {
    var d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    return d > 1 ? d + " days left to answer" : "Expires soon";
  }
  function requestCard(r, incoming) {
    var rec = r.record
      ? '<p class="cs-req__rec">Their record: <strong>' + esc(r.record.name) + "</strong> (" + esc(r.record.code) + ") &middot; " +
        (r.record.balance > 0 ? "balance " + peso(r.record.balance) : "no balance") + " &middot; " + plural(r.record.creditCount, "credit", "credits") + "</p>"
      : "";
    var text = incoming
      ? "<strong>" + esc(r.storeName) + "</strong> wants to link your account to their record of you. Accept only if you know this store and the record is yours. After linking, the store can see you as this customer and you will see the record&rsquo;s credits and payments."
      : "You asked to join <strong>" + esc(r.storeName) + "</strong>. Waiting for the owner to approve.";
    var buttons = incoming
      ? '<button class="btn btn--primary" type="button" data-req-accept="' + esc(r.id) + '">Accept</button>' +
        '<button class="btn btn--ghost" type="button" data-req-decline="' + esc(r.id) + '">Decline</button>'
      : '<button class="btn btn--ghost" type="button" data-req-cancel="' + esc(r.id) + '">Cancel Request</button>';
    return '<article class="cs-req" data-req="' + esc(r.id) + '">' +
      '<p class="cs-req__title">' + esc(incoming ? "Link request" : "Join request") + " &middot; " + esc(r.storeCode) + "</p>" +
      '<p class="cs-req__text">' + text + "</p>" + rec +
      '<p class="cs-req__meta">' + esc(r.ownerName ? "Owner: " + r.ownerName + " · " : "") + esc(daysLeft(r.expiresAt)) + "</p>" +
      '<div class="cs-req__actions">' + buttons + "</div></article>";
  }
  function renderRequests() {
    var all = requests.incoming.concat(requests.outgoing);
    $("requests-section").hidden = all.length === 0;
    $("requests-count").textContent = all.length ? String(all.length) : "";
    $("requests-list").innerHTML = requests.incoming.map(function (r) { return requestCard(r, true); }).join("") +
      requests.outgoing.map(function (r) { return requestCard(r, false); }).join("");
  }
  function loadRequests() {
    return api.getRequests().then(function (r) { requests = r; renderRequests(); }, function () { /* the list stays as it was */ });
  }
  $("requests-list").addEventListener("click", function (event) {
    var button = event.target.closest("[data-req-accept],[data-req-decline],[data-req-cancel]");
    if (!button || button.disabled) return;
    var action = button.hasAttribute("data-req-accept") ? "accept" : button.hasAttribute("data-req-decline") ? "decline" : "cancel";
    var id = button.getAttribute("data-req-" + action);
    button.disabled = true;
    var call = action === "accept" ? api.acceptRequest(id) : action === "decline" ? api.declineRequest(id) : api.cancelRequest(id);
    call.then(function () {
      toast(action === "accept" ? "Linked. The record now shows in your stores." : action === "decline" ? "Request declined." : "Request cancelled.");
      return Promise.all([loadRequests(), load()]);
    }).catch(function (error) {
      toast(error && error.message ? error.message : "That did not work. Please try again.");
      return Promise.all([loadRequests(), load()]);
    });
  });
  loadRequests();

  // Coming Back to a page restored from the back/forward cache: show the current stores
  window.addEventListener("pageshow", function (event) { if (event.persisted) { load(); loadRequests(); } });

  load().then(function () {
    // Opened from a Home card's "View details": open that store and bring it into view
    var s = focusId && find(focusId);
    if (!s) return;
    open[s.id] = true; render();
    var el = $("store-" + s.id);
    el.classList.add("is-focus");
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    $("name-" + s.id).focus({ preventScroll: true });
  });
})();
