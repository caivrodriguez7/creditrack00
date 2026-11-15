/* Customer Portal > Join a Store (join-store). Mock data only: every lookup and save goes through js/api/customer-api.js.
   One page, seven steps (one visible at a time):
     method   Choose Joining Method     Scan Store QR or Enter Store Code
     code     Enter Store Code          input, Next, "Scan QR instead"
     scan     Scan Store QR             camera (QR text CREDITRACK:JOIN:<store code>); camera (BarcodeDetector or the bundled jsQR) or an uploaded QR picture
     verify   Store Verification        store name, type, location, owner; Confirm and Join / Cancel
     link     Link Existing Record      existing customer code, or "I don't have a code"
     confirm  Confirm Details           store, customer account, and whether an existing record will be linked
     done     Join Success              the store is saved; View My Stores opens Home, where it has its own balance card
   Nothing is saved until Confirm and Join Store on the confirm step. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var ICONS = window.CrediTrackCustomerIcons || {};
  var $ = function (id) { return document.getElementById(id); };
  if (!api) return;

  function icon(paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>"; }
  var EXTRA = {
    scan: icon('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
    keyboard: icon('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>'),
    link: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    back: icon('<path d="M19 12H5M11 18l-6-6 6-6"/>')
  };
  function ico(name) { return EXTRA[name] || ICONS[name] || ""; }
  function esc(text) { var d = document.createElement("div"); d.textContent = text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function peso(n) { return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function text(id, value) { $(id).textContent = value; }

  var state = { step: "method", trail: [], store: null, record: null, skipped: false, profile: null, busy: false };
  var STEPS = ["method", "code", "scan", "verify", "link", "confirm", "done"];
  var sections = {};
  STEPS.forEach(function (name) { sections[name] = document.querySelector('[data-step="' + name + '"]'); });

  // ---------- Icons ----------
  document.querySelectorAll("[data-icon]").forEach(function (el) { el.innerHTML = ico(el.getAttribute("data-icon")); });
  document.querySelectorAll(".jback").forEach(function (el) { el.innerHTML = ico("back"); });

  // ---------- Showing a step ----------
  function show(step, options) {
    options = options || {};
    if (state.step === "scan" && step !== "scan") stopScan();
    if (!options.back && state.step !== step && state.step !== "done") state.trail.push(state.step);
    if (options.reset) state.trail = [];
    state.step = step;
    STEPS.forEach(function (name) { sections[name].hidden = name !== step; });
    window.scrollTo(0, 0);
    var heading = sections[step].querySelector("h1");
    if (heading) heading.focus({ preventScroll: true });
    if (step === "verify") fillVerify();
    if (step === "code") { $("code-error").hidden = true; }
    if (step === "scan") { resetScanUi(); }
    if (step === "link") renderLink();
    if (step === "confirm") renderConfirm();
  }
  function goBack() {
    if (state.step === "method" || !state.trail.length) { window.CrediTrack.goTo("customer-dashboard"); return; }
    show(state.trail.pop(), { back: true });
  }
  document.querySelectorAll("[data-back]").forEach(function (b) { b.addEventListener("click", goBack); });
  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () {
      var target = b.getAttribute("data-go");
      // Switching between Enter Code and Scan QR replaces the step instead of stacking them
      if ((state.step === "code" && target === "scan") || (state.step === "scan" && target === "code")) { show(target, { back: true }); return; }
      show(target);
    });
  });

  function setError(id, inputId, message) {
    var box = $(id), input = inputId ? $(inputId) : null;
    box.textContent = message || ""; box.hidden = !message;
    if (input) { if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }
  function setBusy(button, busy, label) {
    state.busy = busy; button.disabled = busy;
    if (label) { if (busy) { button.dataset.label = button.textContent; button.textContent = label; } else if (button.dataset.label) { button.textContent = button.dataset.label; } }
  }

  // ---------- Finding the store (Enter Store Code and Scan Store QR end here) ----------
  function handleStoreInput(raw, via) {
    if (state.busy) return;
    state.busy = true;
    api.findStore(raw).then(function (store) {
      state.busy = false;
      state.store = store; state.record = null; state.skipped = false;
      show("verify");
    }).catch(function (err) {
      state.busy = false;
      var message = (err && err.message) || "Something went wrong. Please try again.";
      if (via === "scan") { scanMessage(message); resumeScan(); }
      else { setError("code-error", "store-code", message); $("store-code").focus(); }
    });
  }
  $("store-code").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase(); if (e.target.hasAttribute("aria-invalid")) setError("code-error", "store-code", ""); });
  $("code-form").addEventListener("submit", function (event) { event.preventDefault(); handleStoreInput($("store-code").value, "code"); });

  // ---------- Scan Store QR ----------
  var scan = { stream: null, timer: null, detector: null, busy: false };
  function scanMessage(message) { var m = $("scan-msg"); m.textContent = message || ""; m.hidden = !message; }
  function resetScanUi() { $("scan-box").classList.remove("is-live"); $("scan-placeholder").hidden = false; scanMessage(""); $("scan-start").hidden = false; $("scan-start").disabled = false; }
  function stopScan() {
    if (scan.timer) { clearInterval(scan.timer); scan.timer = null; }
    if (scan.stream) { scan.stream.getTracks().forEach(function (t) { t.stop(); }); scan.stream = null; }
    $("scan-video").srcObject = null; scan.detector = null; scan.busy = false;
    $("scan-box").classList.remove("is-live");
  }
  function resumeScan() { if (scan.stream && !scan.timer) scan.timer = setInterval(scanTick, 300); }
  // ---- Reading a QR code from a picture ----
  // Uses the browser's BarcodeDetector when it has one (Chrome on Android/Mac). Chrome on Windows, Firefox and Safari do not,
  // so js/vendor/jsqr.js (jsQR, Apache-2.0, runs offline) reads the picture instead.
  var scratch = document.createElement("canvas");
  function decodeWithJsQr(source, width, height) {
    if (!window.jsQR || !width || !height) return null;
    var max = 900, k = Math.min(1, max / Math.max(width, height));
    scratch.width = Math.max(1, Math.round(width * k)); scratch.height = Math.max(1, Math.round(height * k));
    var ctx = scratch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, scratch.width, scratch.height);
    var data = ctx.getImageData(0, 0, scratch.width, scratch.height);
    var hit = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
    return hit && hit.data ? String(hit.data) : null;
  }
  function decodeQr(source, width, height) {
    function fallback() { try { return decodeWithJsQr(source, width, height); } catch (e) { return null; } }
    if (scan.detector) return scan.detector.detect(source).then(function (found) { return found.length ? String(found[0].rawValue || "") : fallback(); }, fallback);
    return Promise.resolve(fallback());
  }
  function makeDetector() {
    if (!("BarcodeDetector" in window)) return null;
    try { return new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { return null; }
  }
  // A QR value is only used when it is a CrediTrack store code; returns true when it was handed on to the store lookup
  function useQrValue(raw) {
    if (!raw) return false;
    if (!/^\s*CREDITRACK:JOIN:/i.test(raw)) { scanMessage("That QR code is not a CrediTrack store code."); return false; }
    handleStoreInput(raw, "scan");
    return true;
  }

  function startScan() {
    var detector = makeDetector();
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scanMessage(window.isSecureContext === false
        ? "The camera only works on a secure page (https or localhost). This page is not secure, so the browser blocks the camera. Use Upload a QR photo or Enter Store Code instead."
        : "This browser cannot open the camera here. Use Upload a QR photo or Enter Store Code instead.");
      return;
    }
    $("scan-start").disabled = true; scanMessage("Starting camera…");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (stream) {
      if (state.step !== "scan") { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scan.stream = stream; scan.detector = detector;
      var video = $("scan-video"); video.srcObject = stream;
      var played = video.play(); if (played && played.catch) played.catch(function () { /* autoplay refused */ });
      $("scan-box").classList.add("is-live"); $("scan-placeholder").hidden = true; $("scan-start").hidden = true;
      scanMessage("Looking for a QR code…");
      scan.timer = setInterval(scanTick, 300);
    }).catch(function (err) {
      $("scan-start").disabled = false;
      var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      var none = err && (err.name === "NotFoundError" || err.name === "OverconstrainedError");
      var busyCam = err && (err.name === "NotReadableError" || err.name === "AbortError");
      scanMessage(denied ? "Camera access was blocked. Allow the camera for this site in your browser settings, or use Upload a QR photo or Enter Store Code."
        : none ? "No camera was found on this device. Use Upload a QR photo or Enter Store Code instead."
        : busyCam ? "The camera is being used by another app. Close it and try again, or use Upload a QR photo."
        : "The camera could not start. Use Upload a QR photo or Enter Store Code instead.");
    });
  }
  function scanTick() {
    var video = $("scan-video");
    if (scan.busy || !scan.timer || !video.videoWidth || state.busy) return;
    scan.busy = true;
    decodeQr(video, video.videoWidth, video.videoHeight).then(function (raw) {
      scan.busy = false;
      if (!raw || !scan.timer) return;
      if (!/^\s*CREDITRACK:JOIN:/i.test(raw)) { scanMessage("That QR code is not a CrediTrack store code."); return; }
      clearInterval(scan.timer); scan.timer = null;   // pause while the code is checked; resumeScan() restarts it if the store is not found
      handleStoreInput(raw, "scan");
    }).catch(function () { scan.busy = false; });
  }

  // Upload a QR photo (screenshot or picture from the gallery)
  function readPhoto(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { scanMessage("Choose a picture (JPG or PNG) of the QR code."); return; }
    scanMessage("Reading the picture…");
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var detector = scan.detector || makeDetector();
      var saved = scan.detector; scan.detector = detector;
      decodeQr(img, img.naturalWidth, img.naturalHeight).then(function (raw) {
        scan.detector = saved; URL.revokeObjectURL(url);
        if (!raw) { scanMessage("No QR code was found in that picture. Try a clearer, closer picture, or use Enter Store Code."); return; }
        scanMessage("");
        useQrValue(raw);
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); scanMessage("That picture could not be opened. Try another one."); };
    img.src = url;
  }
  $("scan-upload").addEventListener("click", function () { $("scan-file").click(); });
  $("scan-file").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; readPhoto(f); });
  $("scan-start").addEventListener("click", startScan);
  window.addEventListener("pagehide", stopScan);

  // ---------- Store Verification ----------
  function fillVerify() {
    var s = state.store;
    text("v-name", s.name); text("v-type", s.type); text("v-location", s.location); text("v-owner", s.owner); text("v-code", s.code);
  }
  // A real account cannot link a record by typing a code here: the store owner does that with the customer code (see Customer Code)
  $("verify-confirm").addEventListener("click", function () {
    state.record = null; state.skipped = true; show("confirm");
  });
  $("verify-cancel").addEventListener("click", function () { window.CrediTrack.goTo("customer-dashboard"); });

  // ---------- Link Existing Customer Record ----------
  function renderLink() {
    text("l-sub", "Link it to " + state.store.name + " to see your existing credits, payments and balance. You can skip this and join as a new customer.");
    setError("link-error", "customer-code", "");
    $("customer-code").value = state.record ? state.record.code : "";
  }
  $("customer-code").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase(); if (e.target.hasAttribute("aria-invalid")) setError("link-error", "customer-code", ""); });
  $("link-form").addEventListener("submit", function (event) {
    event.preventDefault();
    if (state.busy) return;
    setBusy($("link-next"), true);
    api.lookupRecord(state.store.code, $("customer-code").value).then(function (record) {
      setBusy($("link-next"), false);
      state.record = record; state.skipped = false;
      show("confirm");
    }).catch(function (err) {
      setBusy($("link-next"), false);
      setError("link-error", "customer-code", (err && err.message) || "The record could not be checked. Please try again.");
      $("customer-code").focus();
    });
  });
  $("link-skip").addEventListener("click", function () { state.record = null; state.skipped = true; show("confirm"); });

  // ---------- Confirm Details ----------
  function renderConfirm() {
    var s = state.store, p = state.profile || {};
    text("c-store-name", s.name); text("c-store-type", s.type); text("c-store-location", s.location); text("c-store-owner", s.owner);
    text("c-acct-name", p.fullName || "Your account");
    [["email", p.email], ["phone", p.contactNumber], ["code", p.customerCode]].forEach(function (row) {
      $("c-acct-" + row[0] + "-row").hidden = !row[1]; text("c-acct-" + row[0], row[1] || "");
    });
    if (!(api.isDemo && api.isDemo())) $("confirm-join").textContent = "Send Join Request";   // a real join is a request the owner approves
    var r = state.record;
    $("c-rec-rows").hidden = !r;
    $("c-record").classList.toggle("is-linked", !!r);
    if (r) {
      text("c-rec-text", "Yes. This existing record will be linked to your account.");
      text("c-rec-code", r.code); text("c-rec-name", r.nameHint); text("c-rec-balance", peso(r.balance));
    } else {
      text("c-rec-text", (api.isDemo && api.isDemo() ? "No. You are joining as a new customer, so you start with a balance of " + peso(0) + " at this store." : "No. This sends a join request. The store owner has to approve it before you become a customer there, and you start with a balance of " + peso(0) + ".") + " Credits the store records for you will appear here." +
        " If the store already has a record for you, ask the owner to link it using your customer code (Profile > Customer Code).");
    }
    setError("confirm-error", null, "");
  }
  $("confirm-back").addEventListener("click", goBack);
  $("confirm-join").addEventListener("click", function () {
    if (state.busy) return;
    var button = $("confirm-join");
    setBusy(button, true, "Sending…");
    api.joinStore({ storeCode: state.store.code, customerCode: state.record ? state.record.code : "" }).then(function (result) {
      setBusy(button, false, true);
      showDone(result);
    }).catch(function (err) {
      setBusy(button, false, true);
      setError("confirm-error", null, (err && err.message) || "You could not join this store. Please try again.");
    });
  });

  // ---------- Join Success ----------
  function showDone(result) {
    if (result.pending) {   // a real account: the store owner must approve before I become their customer
      text("t-done", "Request sent to " + result.store.name);
      text("d-text", "The owner has to approve your request first. You will get a notification when they answer. You can cancel it anytime in My Stores > Requests.");
      text("d-store", result.store.name);
      text("d-record", "Waiting for the owner\u2019s approval");
      text("d-balance", "Not joined yet");
      state.store = null; state.record = null;
      show("done", { reset: true });
      return;
    }
    text("t-done", "You\u2019ve joined " + result.store.name + "!");
    text("d-text", "The store was added to My Stores. Its balance is kept separate from your other stores.");
    text("d-store", result.store.name);
    text("d-record", result.linked ? result.linkedRecord + " linked" : "None (new customer)");
    text("d-balance", peso(result.balance));
    state.store = null; state.record = null;
    show("done", { reset: true });
  }
  $("done-another").addEventListener("click", function () { state.skipped = false; show("method", { reset: true }); });

  // ---------- Start ----------
  api.getProfile().then(function (p) { state.profile = p; });
  show("method", { reset: true });
})();
