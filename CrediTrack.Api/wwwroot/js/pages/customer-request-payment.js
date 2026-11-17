/* Customer Portal > Make a Payment (request-payment). Mock data only: stores and saving go through js/api/customer-api.js.
   One page, three steps (one visible at a time), plus a "blocked" message when there is nothing to pay:
     form     Payment details   store (preselected), amount, method, reference number, proof (optional), message (optional)
     review   Review Payment    everything entered, the balance rules, Submit Payment Request
     done     Submitted         success message, status Pending, "Balance status: Not yet updated"
   Nothing is saved until Submit Payment Request. The request is saved as PENDING and the customer's balance is NOT changed:
   only the Store Owner's approval (a later step) records the payment and lowers the balance. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  if (!api) return;

  var SCOPE_KEY = "creditrack.customer.home.store";     // the store selected on Home (kept while the tab is open)
  var PROOF_MAX_BYTES = 5 * 1024 * 1024;
  var PROOF_MAX_SIDE = 800;                              // the stored copy of the picture is scaled down (mock data lives in the browser)
  var STEPS = ["form", "review", "done", "blocked"];

  function icon(paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>"; }
  var EXTRA = {
    back: icon('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
    upload: icon('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/><path d="M17 3v4M15 5h4"/>'),
    close: icon('<path d="M6 6l12 12M18 6 6 18"/>')
  };
  function ico(name) { return EXTRA[name] || ICONS[name] || ""; }
  function peso(n) { return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(text) { var d = document.createElement("div"); d.textContent = text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function text(id, value) { $(id).textContent = value; }
  function fileSize(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB"; }

  var transactionIdFromUrl = fromUrl("transactionId");
  var state = { step: "form", data: null, method: "gcash", proof: null,
    transactionId: /^\d+$/.test(transactionIdFromUrl) ? Number(transactionIdFromUrl) : null,
    transactionOutstanding: parseAmount(fromUrl("amount")),
    requestId: "req-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), busy: false, review: null };
  var sections = {};
  STEPS.forEach(function (name) { sections[name] = document.querySelector('[data-step="' + name + '"]'); });

  // ---------- Icons ----------
  document.querySelectorAll("[data-icon]").forEach(function (el) { el.innerHTML = ico(el.getAttribute("data-icon")); });
  document.querySelectorAll(".jback").forEach(function (el) { el.innerHTML = ico("back"); });

  // ---------- Showing a step ----------
  function show(step) {
    state.step = step;
    STEPS.forEach(function (name) { sections[name].hidden = name !== step; });
    window.scrollTo(0, 0);
    var heading = sections[step].querySelector("h1");
    if (heading) heading.focus({ preventScroll: true });
  }
  // Back from the first screen: to the page the customer came from (Home or Payments), else Payments
  // Opened inside the Make a Payment modal (?modal=1): Back closes the modal, and the success buttons ask the page behind to navigate
  var embedded = /[?&]modal=1(&|$)/.test(window.location.search) && window.parent !== window;
  function tell(message) { try { window.parent.postMessage(message, window.location.origin); } catch (e) { /* ignore */ } }
  function leave() {
    if (embedded) { tell({ type: "close" }); return; }
    var came = false;
    try { var from = new URL(document.referrer); came = from.origin === window.location.origin && /^\/customer\//.test(from.pathname) && window.history.length > 1; } catch (e) { /* no referrer */ }
    if (came) window.history.back(); else window.CrediTrack.goTo("customer-payments");
  }
  document.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { if (state.step === "review") show("form"); else leave(); });
  });
  $("review-back").addEventListener("click", function () { show("form"); });
  if (embedded) {
    sections.done.addEventListener("click", function (event) {
      var link = event.target.closest("[data-route]");
      if (!link) return;
      event.preventDefault(); event.stopPropagation();
      tell({ type: "navigate", route: link.getAttribute("data-route") });
    }, true);
  }

  function setError(fieldId, errorId, message) {
    var box = $(errorId), input = fieldId ? $(fieldId) : null;
    box.textContent = message || ""; box.hidden = !message;
    if (input) { if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }

  // ---------- Stores ----------
  function storeById(id) { return state.data.stores.filter(function (s) { return s.id === id; })[0] || null; }
  function selectedStore() { return storeById($("store").value); }
  function fromUrl(name) { try { return new URLSearchParams(window.location.search).get(name) || ""; } catch (e) { return ""; } }
  function readHomeScope() { try { return window.sessionStorage.getItem(SCOPE_KEY) || ""; } catch (e) { return ""; } }
  function amountLimit(store) {
    if (!state.transactionId) return store.balance;
    return isFinite(state.transactionOutstanding) && state.transactionOutstanding > 0
      ? Math.min(state.transactionOutstanding, store.balance) : 0;
  }

  // The store to preselect: the one in the address (Home's PAY button), else the one selected on Home, else the only store that can be paid
  function initialStore() {
    var payable = state.data.stores.filter(function (s) { return s.canPay; });
    var wanted = [fromUrl("store"), readHomeScope()];
    for (var i = 0; i < wanted.length; i++) {
      var hit = payable.filter(function (s) { return s.id === wanted[i]; })[0];
      if (hit) return hit.id;
    }
    return payable.length === 1 ? payable[0].id : "";
  }

  function fillStores(selectedId) {
    var select = $("store");
    select.innerHTML = '<option value="">Choose a store</option>' + state.data.stores.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.canPay ? "" : " disabled") + ">" + esc(s.name) + (s.canPay ? "" : " (nothing to pay)") + "</option>";
    }).join("");
    select.value = selectedId || "";
  }
  function renderStoreInfo() {
    var s = selectedStore(), info = $("store-info");
    $("store").disabled = !!state.transactionId;
    info.hidden = !s;
    $("amount-full").hidden = !s;
    if (!s) return;
    info.className = "field__hint cpr__info";
    info.innerHTML = "Your balance at " + esc(s.name) + ": <strong>" + peso(s.balance) + "</strong>" +
      (s.pendingCount ? "<br>" + peso(s.pendingAmount) + " is already waiting for the store to verify." : "");
    if (state.transactionId && isFinite(state.transactionOutstanding) && state.transactionOutstanding > 0) {
      $("amount-hint").textContent = "Outstanding on this transaction: " + peso(state.transactionOutstanding) + ". You can edit the amount for a partial payment.";
      $("amount-full").textContent = "Full transaction balance (" + peso(state.transactionOutstanding) + ")";
    } else {
      $("amount-hint").textContent = "Enter the amount you paid.";
      $("amount-full").textContent = "Full balance (" + peso(s.balance) + ")";
    }
  }
  $("store").addEventListener("change", function () { setError("store", "store-error", ""); setError("amount", "amount-error", ""); renderStoreInfo(); resetPayDetails(); });

  // ---------- Store payment details (collapsible) ----------
  // "View payment details" shows the GCash / Maya / Bank details the selected store has set up, so the customer knows where to pay.
  // They are asked from the server each time the card is opened (the owner may have just changed them). Copy puts the account number
  // on the clipboard; a QR picture can be saved. Nothing is paid or sent from here: CrediTrack only records payments.
  var PAY_QR_URL = /^\/api\/files\/qrs\/[0-9a-f]{32}\.(jpg|png|webp)$/;   // only the store's own QR pictures are shown
  var payAccounts = [], payToken = 0;

  function payLabel(method) { var m = methodOf(method); return m ? m.label : method; }
  function setPayOpen(open) {
    $("pay-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    $("pay-panel").hidden = !open;
    if (open) loadPayDetails();
  }
  // A new store (or the first load) closes the card and forgets what it showed
  function resetPayDetails() {
    payToken++;
    payAccounts = [];
    $("pay-list").innerHTML = "";
    $("pay-status").hidden = true;
    $("pay-note").hidden = true;
    text("pay-sub", "Where to send your payment");
    setPayOpen(false);
    $("pay-details").hidden = !selectedStore();
  }
  function payAccountHtml(a, storeName) {
    var label = payLabel(a.method), html = '<li class="cpr__acct"><h3 class="cpr__acct__title">' + esc(label) + "</h3><dl class=\"cpr__acct__rows\">";
    if (a.method === "bank" && a.bankName) html += "<div><dt>Bank</dt><dd>" + esc(a.bankName) + "</dd></div>";
    html += "<div><dt>Account name</dt><dd>" + esc(a.accountName) + "</dd></div>" +
      '<div><dt>Account number</dt><dd class="cpr__acct__num"><span>' + esc(a.accountNumber) + "</span>" +
      '<button class="cpr__copy" type="button" data-copy="' + esc(a.method) + '" aria-label="Copy the ' + esc(label) + ' account number">Copy</button></dd></div></dl>';
    if (PAY_QR_URL.test(a.qrUrl)) {
      // Tapping the picture opens it bigger. Save QR is a normal download link too (it still works if this script fails),
      // but the click is handled below: fetch -> blob -> download, and when that cannot work, the big picture with a "press and hold" hint.
      html += '<div class="cpr__qr"><button class="cpr__qr__zoom" type="button" data-qr-zoom="' + esc(a.method) + '" aria-haspopup="dialog" aria-label="Enlarge the ' + esc(label) + " QR code of " + esc(storeName) + '">' +
        '<img class="cpr__qr__img" src="' + esc(a.qrUrl) + '" alt="" loading="lazy"></button>' +
        '<span class="cpr__qr__cap">Tap the QR code to make it bigger</span>' +
        '<a class="btn btn--secondary" href="' + esc(a.qrUrl) + '" download="' + esc(qrFileName(a)) + '" data-qr-save="' + esc(a.method) + '">Save QR</a>' +
        '<p class="field__hint cpr__qr__hint" role="status" hidden></p></div>';
    }
    return html + "</li>";
  }
  function renderPayDetails(store, accounts) {
    var status = $("pay-status");
    payAccounts = accounts;
    if (!accounts.length) {
      status.textContent = store.name + " has not added payment details yet. Ask the store how you can pay.";
      status.hidden = false;
      $("pay-note").hidden = true;
      text("pay-sub", "Not set up by the store yet");
      return;
    }
    status.hidden = true;
    $("pay-list").innerHTML = accounts.map(function (a) { return payAccountHtml(a, store.name); }).join("");
    $("pay-note").hidden = false;
    text("pay-sub", accounts.map(function (a) { return payLabel(a.method); }).join(", "));
  }
  function loadPayDetails() {
    var store = selectedStore(), token = ++payToken, status = $("pay-status");
    if (!store) return;
    $("pay-list").innerHTML = "";
    $("pay-note").hidden = true;
    status.textContent = "Loading payment details\u2026";
    status.hidden = false;
    api.getStorePaymentAccounts(store.id).then(function (data) {
      if (token !== payToken) return;                  // another store was chosen, or the card was closed, meanwhile
      renderPayDetails(store, data.accounts || []);
    }).catch(function () {
      if (token !== payToken) return;
      status.textContent = "We couldn't load the payment details. Close this card and open it again to try once more.";
    });
  }
  $("pay-toggle").addEventListener("click", function () { setPayOpen($("pay-toggle").getAttribute("aria-expanded") !== "true"); });

  // Copies text with the Clipboard API, or an old-fashioned hidden textarea where that is not available
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    return new Promise(function (resolve, reject) {
      var box = document.createElement("textarea"), done = false;
      box.value = value; box.setAttribute("readonly", ""); box.style.position = "fixed"; box.style.opacity = "0";
      document.body.appendChild(box); box.select();
      try { done = document.execCommand("copy"); } catch (e) { done = false; }
      document.body.removeChild(box);
      if (done) resolve(); else reject(new Error("copy failed"));
    });
  }
  $("pay-list").addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-copy]") : null;
    if (!button) return;
    var account = payAccounts.filter(function (a) { return a.method === button.getAttribute("data-copy"); })[0];
    if (!account) return;
    // Spaces and dashes are left out, so the number can be pasted straight into GCash, Maya or a bank app
    copyText(String(account.accountNumber).replace(/[\s-]/g, "")).then(function () {
      window.CrediTrack.showToast(payLabel(account.method) + " account number copied.");
    }).catch(function () { window.CrediTrack.showToast("We couldn't copy it. Press and hold the number to copy it."); });
  });

  // ---------- Save QR and the big QR picture ----------
  // Save QR first tries a real download: fetch the picture with the login cookie, turn it into a blob and download that from an
  // object URL. Some browsers (iPhone Safari at times, and the browsers inside Facebook, Messenger, Instagram and similar apps)
  // only open the picture, or ignore "download". Nobody can tell from the page whether a download worked, so:
  //   - when the download cannot even start (known in-app browser, fetch failed, not a picture) the big QR opens with a
  //     "Press and hold the QR code to save it" hint;
  //   - when the download did start, a hint stays under the button in case nothing was actually saved.
  // Tapping the QR opens the same big picture, so the customer can also press and hold it, or screenshot it.
  var viewer = $("qr-viewer"), viewerOpener = null;
  var IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|Snapchat|TikTok|BytedanceWebview|Twitter|GSA\/|; wv\)/i;
  var TOUCH_SCREEN = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  function qrFileName(account) { return "creditrack-" + account.method + "-qr." + String(account.qrUrl).split(".").pop(); }
  function accountOf(method) { return payAccounts.filter(function (a) { return a.method === method; })[0] || null; }
  function canDownloadQr() {
    return !!(window.fetch && window.URL && window.URL.createObjectURL && "download" in document.createElement("a") && !IN_APP_BROWSER.test(navigator.userAgent || ""));
  }
  function showQrHint(el, message) { if (!el) return; el.textContent = message; el.hidden = !message; }

  // Downloads the picture through a temporary link. Rejects when the picture could not be fetched (not signed in, offline, not a picture).
  function downloadQr(account) {
    return window.fetch(account.qrUrl, { credentials: "include" }).then(function (response) {
      if (!response.ok) throw new Error("status " + response.status);
      return response.blob();
    }).then(function (blob) {
      if (!blob || !blob.size || !/^image\//.test(blob.type)) throw new Error("not a picture");
      var url = window.URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = qrFileName(account); link.rel = "noopener";
      link.target = "_blank";                          // if a browser ignores "download" and opens the picture, it opens in a new tab and this page stays
      link.hidden = true;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 60000);   // not at once: some browsers read the file a moment later
    });
  }

  function openViewer(account, opener) {
    var label = payLabel(account.method), store = selectedStore(), img = $("qr-viewer-img");
    text("qr-viewer-title", label + " QR code");
    img.alt = label + " QR code of " + (store ? store.name : "the store");
    img.src = account.qrUrl;                           // the browser already has it from the card, so this is instant
    text("qr-viewer-hint", TOUCH_SCREEN ? "Press and hold the QR code to save it to your photos." : "Right-click the QR code and choose Save image as…");
    viewerOpener = opener || null;
    if (viewer.showModal) { if (!viewer.open) viewer.showModal(); } else viewer.setAttribute("open", "");
    $("qr-viewer-close").focus();
  }
  function closeViewer() {
    if (viewer.close) viewer.close(); else { viewer.removeAttribute("open"); viewerClosed(); }
  }
  function viewerClosed() {
    $("qr-viewer-img").removeAttribute("src");
    var back = viewerOpener; viewerOpener = null;
    if (back && document.body.contains(back)) back.focus();
  }
  $("qr-viewer-close").addEventListener("click", closeViewer);
  viewer.addEventListener("close", viewerClosed);                      // Esc, the Close button or a tap outside the card
  viewer.addEventListener("click", function (event) { if (event.target === viewer) closeViewer(); });   // a tap on the dark area around the card
  document.addEventListener("keydown", function (event) {            // browsers without <dialog>: the opened box is a plain element, so Esc is handled here
    if (event.key === "Escape" && !viewer.showModal && viewer.hasAttribute("open")) closeViewer();
  });

  function saveQr(link) {
    var account = accountOf(link.getAttribute("data-qr-save")), hint = link.parentNode.querySelector(".cpr__qr__hint");
    if (!account || link.getAttribute("aria-busy") === "true") return;
    function fallback() {
      showQrHint(hint, "Press and hold the QR code to save it. Tap the QR code to make it bigger.");
      openViewer(account, link);
    }
    if (!canDownloadQr()) { fallback(); return; }
    link.setAttribute("aria-busy", "true");
    link.textContent = "Saving…";
    downloadQr(account).then(function () {
      showQrHint(hint, "If the picture did not save, tap the QR code to make it bigger, then press and hold it to save it.");
      window.CrediTrack.showToast("QR download started.");
    }).catch(fallback).then(function () {
      link.removeAttribute("aria-busy");
      link.textContent = "Save QR";
    });
  }
  $("pay-list").addEventListener("click", function (event) {
    var target = event.target.closest ? event.target : event.target.parentNode;
    var save = target.closest("[data-qr-save]"), zoom = target.closest("[data-qr-zoom]");
    if (save) { event.preventDefault(); saveQr(save); return; }
    if (zoom) { var account = accountOf(zoom.getAttribute("data-qr-zoom")); if (account) openViewer(account, zoom); }
  });

  // ---------- Amount ----------
  function parseAmount(raw) {
    var v = String(raw || "").replace(/[,\s₱]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
    return Math.round(parseFloat(v) * 100) / 100;
  }
  $("amount").addEventListener("input", function (event) {
    var cleaned = event.target.value.replace(/[^\d.,]/g, "");
    if (cleaned !== event.target.value) event.target.value = cleaned;
    setError("amount", "amount-error", "");
  });
  $("amount-full").addEventListener("click", function () {
    var s = selectedStore();
    if (!s) return;
    var amount = amountLimit(s);
    if (!isFinite(amount) || amount <= 0) return;
    $("amount").value = amount.toFixed(2);
    setError("amount", "amount-error", "");
    $("amount").focus();
  });

  // ---------- Method and reference number ----------
  function methodOf(id) { return api.PAYMENT_METHODS.filter(function (m) { return m.id === id; })[0]; }
  function renderMethods() {
    $("methods").innerHTML = api.PAYMENT_METHODS.map(function (m) {
      return '<label class="cpr__radio"><input type="radio" name="method" value="' + m.id + '"' + (state.method === m.id ? " checked" : "") + '>' +
        '<span class="cpr__radio__dot" aria-hidden="true"></span><span class="cpr__radio__label">' + esc(m.label) + "</span></label>";
    }).join("");
  }
  function renderReference() {
    var m = methodOf(state.method);
    $("reference-field").hidden = m.reference === "none";
    $("reference-opt").textContent = m.reference === "required" ? "(required)" : "(optional)";
    text("reference-hint", m.hint);
    $("reference-hint").hidden = !m.hint;
    $("reference").placeholder = m.id === "gcash" ? "e.g. 1234 5678 9012" : "Enter reference number";
    setError("reference", "reference-error", "");
    // Proof picture: required for everything except cash
    $("proof-opt").textContent = m.proof === "required" ? "(required)" : "(optional)";
    if (m.proof !== "required") setError(null, "proof-error", "");
  }
  $("methods").addEventListener("change", function (event) {
    if (event.target.name !== "method") return;
    state.method = event.target.value;
    setError(null, "method-error", "");
    renderReference();
  });
  $("reference").addEventListener("input", function () { setError("reference", "reference-error", ""); });

  // ---------- Payment proof (optional) ----------
  $("proof-pick").addEventListener("click", function () { $("proof").click(); });
  function clearProof() { state.proof = null; $("proof").value = ""; $("proof-chosen").hidden = true; $("proof-pick").hidden = false; $("proof-img").removeAttribute("src"); }
  $("proof-remove").addEventListener("click", function () { clearProof(); setError(null, "proof-error", ""); $("proof-pick").focus(); });

  // A scaled-down JPEG copy of the picture (so it can be kept with the mock data), or null when the file is not a readable picture
  function shrink(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () { resolve(null); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { resolve(null); };
        img.onload = function () {
          try {
            var scale = Math.min(1, PROOF_MAX_SIDE / Math.max(img.width, img.height));
            var canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.72));
          } catch (e) { resolve(null); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  $("proof").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    setError(null, "proof-error", "");
    var okType = /^image\/(png|jpe?g)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    if (!okType) { clearProof(); setError(null, "proof-error", "Upload a JPG or PNG picture."); return; }
    if (file.size > PROOF_MAX_BYTES) { clearProof(); setError(null, "proof-error", "That picture is too big. Choose one up to 5 MB."); return; }
    shrink(file).then(function (dataUrl) {
      if (!dataUrl) { clearProof(); setError(null, "proof-error", "We could not read that picture. Try another one."); return; }
      state.proof = { name: file.name, type: "image/jpeg", dataUrl: dataUrl, size: file.size };
      $("proof-img").src = dataUrl;
      text("proof-name", file.name);
      text("proof-size", fileSize(file.size));
      $("proof-chosen").hidden = false;
      $("proof-pick").hidden = true;
    });
  });

  // ---------- Message (optional) ----------
  function updateCount() { text("note-count", $("note").value.length + " / " + api.NOTE_MAX); }
  $("note").addEventListener("input", function () { updateCount(); setError("note", "note-error", ""); });

  // ---------- Form: check every field, then go to Review ----------
  var REFERENCE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9 \-]{4,28}[A-Za-z0-9]$/;
  function readForm() {
    var s = selectedStore(), m = methodOf(state.method);
    return { store: s, method: m, amount: parseAmount($("amount").value), reference: m.reference === "none" ? "" : $("reference").value.trim().replace(/\s+/g, " "), note: $("note").value.trim() };
  }
  function validate(f) {
    var first = null;
    function fail(fieldId, errorId, message) { setError(fieldId, errorId, message); if (!first) first = fieldId || errorId; }
    setError("store", "store-error", ""); setError("amount", "amount-error", ""); setError("reference", "reference-error", ""); setError("note", "note-error", "");
    if (!f.store) fail("store", "store-error", "Choose the store you are paying.");
    if (!$("amount").value.trim()) fail("amount", "amount-error", "Enter the amount you paid.");
    else if (isNaN(f.amount) || f.amount <= 0) fail("amount", "amount-error", "Enter a valid amount, for example 300 or 300.50.");
    else if (f.store && f.amount > amountLimit(f.store)) {
      var limit = amountLimit(f.store);
      fail("amount", "amount-error", "That is more than the outstanding balance of " + peso(limit) + " at " + f.store.name + ".");
    }
    if (f.method.reference === "required" && !f.reference) fail("reference", "reference-error", "Enter the reference number from your receipt.");
    else if (f.reference && !REFERENCE_FORMAT.test(f.reference)) fail("reference", "reference-error", "The reference number should be 6 to 30 letters or numbers.");
    if (f.method.proof === "required" && !state.proof) { setError(null, "proof-error", "Attach a picture of your " + f.method.label + " receipt."); if (!first) first = "proof-pick"; }
    else setError(null, "proof-error", "");
    if (f.note.length > api.NOTE_MAX) fail("note", "note-error", "Keep your message to " + api.NOTE_MAX + " characters or fewer.");
    if (first && $(first)) $(first).focus();
    return !first;
  }

  $("pay-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var f = readForm();
    if (!validate(f)) return;
    state.review = f;
    renderReview(f);
    show("review");
  });

  function renderReview(f) {
    text("r-store", f.store.name);
    text("r-amount", peso(f.amount));
    text("r-method", f.method.label);
    $("r-reference-row").hidden = f.method.reference === "none";
    text("r-reference", f.reference || "Not provided");
    text("r-proof", state.proof ? state.proof.name : "None attached");
    $("r-note-row").hidden = !f.note;
    text("r-note", f.note);
    text("r-balance", peso(f.store.balance) + " (not changed yet)");
    text("r-after", peso(Math.max(0, f.store.balance - f.amount)));
    setError(null, "submit-error", "");
  }

  // ---------- Submit ----------
  $("submit").addEventListener("click", function () {
    if (state.busy || !state.review) return;
    var f = state.review, button = $("submit");
    state.busy = true; button.disabled = true; $("review-back").disabled = true;
    button.dataset.label = button.textContent; button.textContent = "Submitting...";
    setError(null, "submit-error", "");
    api.submitPaymentRequest({
      storeId: f.store.id, transactionId: state.transactionId, amount: f.amount, method: f.method.id, reference: f.reference, note: f.note,
      proof: state.proof ? { name: state.proof.name, type: state.proof.type, dataUrl: state.proof.dataUrl } : null,
      requestId: state.requestId
    }).then(function (result) {
      state.busy = false; button.disabled = false; $("review-back").disabled = false; button.textContent = button.dataset.label;
      renderDone(result);
      if (embedded) tell({ type: "submitted" });
      show("done");
    }).catch(function (err) {
      state.busy = false; button.disabled = false; $("review-back").disabled = false; button.textContent = button.dataset.label;
      var map = { store: ["store", "store-error"], amount: ["amount", "amount-error"], over: ["amount", "amount-error"], reference: ["reference", "reference-error"], note: ["note", "note-error"], proof: ["proof-pick", "proof-error"] };
      var target = err && map[err.code];
      if (target) { show("form"); setError(target[0], target[1], err.message); $(target[0]).focus(); return; }
      if (err && err.code === "method") { show("form"); setError(null, "method-error", err.message); return; }
      setError(null, "submit-error", err && err.code === "duplicate" ? err.message : "We could not send your request. Please try again.");
    });
  });

  function renderDone(result) {
    var r = result.request;
    text("d-text", "Your request has been sent to " + result.store.name + ".");
    text("d-amount", peso(r.amount));
    text("d-store", result.store.name);
    text("d-method", r.method);
    $("d-reference-row").hidden = !r.reference;
    text("d-reference", r.reference);
    // The balance is exactly what it was before: the request does not pay anything until the store owner approves it
    text("d-balance", "Not yet updated");
  }

  // ---------- Load ----------
  function blocked(title, body, join) {
    text("b-title", title); text("b-text", body); $("b-join").hidden = !join;
    show("blocked");
  }
  function load() {
    return api.getPayableStores().then(function (data) {
      state.data = data;
      if (!data.stores.length) { blocked("No store joined yet", "Join a store first. Then you can tell it about the payments you make.", true); return; }
      if (!data.stores.some(function (s) { return s.canPay; })) { blocked("Nothing to pay right now", "You have no outstanding balance at your connected stores.", false); return; }
      var selected = initialStore();
      fillStores(selected);
      if (state.transactionId && isFinite(state.transactionOutstanding) && state.transactionOutstanding > 0) {
        $("amount").value = state.transactionOutstanding.toFixed(2);
      }
      renderStoreInfo(); resetPayDetails(); renderMethods(); renderReference(); updateCount();
      show("form");
    }).catch(function (err) {
      window.CrediTrack.showToast(err && err.message ? err.message : "Something went wrong. Please try again.");
    });
  }

  // A page restored from the back/forward cache starts clean: the saved request must not be sent again
  window.addEventListener("pageshow", function (event) { if (event.persisted) window.location.reload(); });
  load();
})();
