/* Link Customer Account: floating modal on Customer Details. Real account: the customer's Customer Code (CT-CUS-123456) is checked and linked by the server.
   Opened by the Link Customer Account button: window.LinkAccount.open({ customerId, customerName, onLinked }).
   It looks and behaves like Record Utang / Record Bayad (it reuses their .ru-* styles from css/components/record-utang.css;
   css/components/link-account.css only adds what is specific to linking).

   Step 1 - Enter the code. Two ways, one at a time (tabs):
     Enter Code  the customer's temporary linking code (8 letters and numbers, shown as XXXX-XXXX). It is capitalised and spaced as typed.
     Scan QR     the camera reads the customer's linking QR code (text CREDITRACK:LINK:<code>). It needs a browser with camera access and
                 QR reading (BarcodeDetector); anywhere else the tab says so and points to Enter Code. A QR that is not a linking code is refused.
   Step 2 - Confirm the account. Nothing is linked yet. The code is checked first (api.verifyLinkCode: valid, not expired, not used, account
     not linked to someone else) and the account it belongs to is shown (name, account ID, masked email and mobile, member since) next to
     the customer record, so the owner can make sure it is the right person. Link Account saves (api.linkCustomerAccount).
   Step 3 - Done. The account is linked; Done closes the modal and Customer Details shows the linked account. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;

  var root = null, els = {};
  var state = blank();
  var opener = null, confirmOpen = false, confirmReturn = null;
  var scan = { stream: null, timer: null, detector: null, busy: false };

  function blank() {
    return { customerId: null, customerName: "", onLinked: null, step: "code", tab: "enter", busy: false, saving: false, result: null, code: "", linked: false, doneAt: 0, info: { isSample: false, samples: [] } };
  }

  // A real account only SENDS a request; the customer has to accept it in their app before anything is linked.
  function isRequest() { return !!(api.isDemo && !api.isDemo()); }

  // ---------- Helpers ----------
  function esc(text) { var d = document.createElement("div"); d.textContent = text; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function initials(name) { return String(name || "").split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase(); }
  function longDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) : ""; }
  // The words of a name without initials ("Lito M. Mendoza" -> lito, mendoza), to tell whether two names are the same person
  function nameWords(name) {
    return String(name || "").toLowerCase().replace(/[^a-z\u00C0-\u024F\s-]/g, " ").split(/[\s-]+/).filter(function (w) { return w.length > 1; });
  }
  function sameName(a, b) {
    var x = nameWords(a), y = nameWords(b);
    if (!x.length || !y.length) return true;   // nothing to compare: no warning
    var small = x.length <= y.length ? x : y, big = x.length <= y.length ? y : x;
    return small.every(function (w) { return big.indexOf(w) !== -1; });
  }
  function svg(paths, size, width) {
    return '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (width || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  var ICON_LINK = svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 24, 1.8);
  var ICON_X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 18, 2.2);
  var ICON_KEY = svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>', 18, 1.9);
  var ICON_QR = svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>', 18, 1.9);

  // ---------- Build the modal once ----------
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.className = "ru la";
    root.hidden = true;
    root.innerHTML =
      '<div class="ru__backdrop" data-act="close"></div>' +
      '<div class="ru__dialog" role="dialog" aria-modal="true" aria-labelledby="la-title" tabindex="-1" data-step="code">' +
        '<header class="ru__head">' +
          '<span class="ru__badge">' + ICON_LINK + "</span>" +
          '<div class="ru__heading"><p class="ru__eyebrow" id="la-eyebrow">Step 1 of 2 \u00B7 Enter code</p><h2 class="ru__title" id="la-title">Link Customer Account</h2></div>' +
          '<button class="ru__close" type="button" data-act="close" aria-label="Close Link Customer Account">' + ICON_X + "</button>" +
          '<div class="ru__steps" id="la-steps" aria-hidden="true"><span class="is-current"></span><span></span></div>' +
        "</header>" +
        '<div class="ru__body" id="la-body">' +

          /* 1. Enter the code or scan the QR code */
          '<section class="ru__panel" data-panel="code">' +
            '<p class="ru__hint ru__hint--top" id="la-intro"></p>' +
            '<div class="la-tabs" role="tablist" aria-label="How to enter the linking code">' +
              '<button class="la-tab" type="button" role="tab" id="la-tab-enter" aria-controls="la-pane-enter" aria-selected="true" data-act="tab" data-tab="enter">' + ICON_KEY + "<span>Enter Code</span></button>" +
              '<button class="la-tab" type="button" role="tab" id="la-tab-scan" aria-controls="la-pane-scan" aria-selected="false" tabindex="-1" data-act="tab" data-tab="scan">' + ICON_QR + "<span>Scan QR</span></button>" +
            "</div>" +

            '<div class="la-pane" id="la-pane-enter" role="tabpanel" aria-labelledby="la-tab-enter">' +
              '<form class="ru-field" id="la-form" novalidate>' +
                '<label for="la-code">Linking code</label>' +
                '<input class="input la-code" id="la-code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="XXXX-XXXX" aria-describedby="la-code-hint la-code-err">' +
                '<p class="la-hint" id="la-code-hint">Ask the customer to open their CrediTrack app and show you their linking code.</p>' +
                '<p class="ru-field__error" id="la-code-err" role="alert" hidden></p>' +
              "</form>" +
            "</div>" +

            '<div class="la-pane" id="la-pane-scan" role="tabpanel" aria-labelledby="la-tab-scan" hidden>' +
              '<div class="la-scan" id="la-scan">' +
                '<video class="la-scan__video" id="la-video" playsinline muted aria-label="Camera preview"></video>' +
                '<span class="la-scan__frame" aria-hidden="true"></span>' +
                '<div class="la-scan__msg" id="la-scan-msg" hidden></div>' +
              "</div>" +
              '<p class="la-hint" id="la-scan-hint">Point the camera at the customer&rsquo;s linking QR code.</p>' +
              '<p class="ru-field__error" id="la-scan-err" role="alert" hidden></p>' +
              '<div class="la-scan__actions" id="la-scan-actions" hidden>' +
                '<button class="btn btn--secondary" type="button" data-act="rescan">Scan Again</button>' +
                '<button class="btn btn--secondary" type="button" data-act="tab" data-tab="enter">Enter Code Instead</button>' +
              "</div>" +
              '<div class="la-scan__upload">' +
                '<button class="btn btn--secondary btn--block" type="button" data-act="upload">Upload a QR photo</button>' +
                '<input type="file" id="la-file" accept="image/*" hidden>' +
              "</div>" +
            "</div>" +

          "</section>" +

          /* 2. Confirm the account */
          '<section class="ru__panel" data-panel="confirm" hidden>' +
            '<h3 class="la-q" id="la-q" tabindex="-1">Is this the right account?</h3>' +
            '<p class="ru__hint ru__hint--top">Check the details with the customer. Nothing is linked until the customer accepts. Send Link Request asks them to accept in their app.</p>' +
            '<div class="ru-chosen ru-chosen--plain la-acct"><span class="ru-avatar" id="la-a-avatar" aria-hidden="true"></span>' +
              '<span class="ru-chosen__main"><span class="ru-chosen__name" id="la-a-name"></span><span class="ru-chosen__bal">CrediTrack customer account</span></span></div>' +
            '<dl class="ru-totals la-rows">' +
              '<div><dt>Account ID</dt><dd id="la-a-id"></dd></div>' +
              '<div id="la-a-email-row"><dt>Email</dt><dd id="la-a-email"></dd></div>' +
              '<div id="la-a-phone-row"><dt>Mobile number</dt><dd id="la-a-phone"></dd></div>' +
              '<div id="la-a-since-row"><dt>Member since</dt><dd id="la-a-since"></dd></div>' +
            "</dl>" +
            '<div class="la-link-to"><span class="la-link-to__label">Will be linked to</span><strong id="la-a-customer"></strong></div>' +
            '<p class="la-note la-note--warn" id="la-a-warn" role="alert" hidden></p>' +
            '<p class="ru-items__error" id="la-save-error" role="alert" hidden></p>' +
          "</section>" +

          /* 3. Done */
          '<section class="ru__panel ru-done" data-panel="done" hidden>' +
            '<span class="ru-done__icon">' + svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 30, 2.6) + "</span>" +
            '<h3 class="ru-done__title" id="la-d-title" tabindex="-1">Account linked</h3>' +
            '<p class="la-done__text" id="la-d-text"></p>' +
            '<dl class="ru-totals ru-totals--done">' +
              '<div><dt>Customer</dt><dd id="la-d-customer"></dd></div>' +
              '<div><dt>CrediTrack account</dt><dd id="la-d-account"></dd></div>' +
              '<div class="ru-totals__main"><dt>Connection status</dt><dd>Connected</dd></div>' +
            "</dl>" +
          "</section>" +
        "</div>" +
        '<footer class="ru__foot" id="la-foot" hidden></footer>' +
        '<div class="ru-confirm" id="la-confirm" hidden>' +
          '<div class="ru-confirm__card" role="alertdialog" aria-modal="true" aria-labelledby="la-confirm-title" aria-describedby="la-confirm-text">' +
            '<h3 class="ru-confirm__title" id="la-confirm-title">Cancel linking?</h3>' +
            '<p class="ru-confirm__text" id="la-confirm-text">The account has not been linked yet. If you close now, nothing is saved.</p>' +
            '<div class="ru-confirm__actions">' +
              '<button class="btn btn--primary" type="button" data-act="keep">Continue linking</button>' +
              '<button class="btn btn--danger-outline" type="button" data-act="discard">Cancel linking</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    root.querySelectorAll("[id]").forEach(function (el) { els[el.id.replace(/^la-/, "")] = el; });
    els.dialog = root.querySelector(".ru__dialog");
    els.panels = root.querySelectorAll("[data-panel]");
    els.stepbars = els.steps.querySelectorAll("span");

    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onDialogKey);
    els.form.addEventListener("submit", function (event) { event.preventDefault(); verifyTyped(); });
    els.code.addEventListener("input", onCodeInput);
    els.file.addEventListener("change", function (event) { var f = event.target.files && event.target.files[0]; event.target.value = ""; readPhoto(f); });
    els["tab-enter"].parentNode.addEventListener("keydown", onTabKey);
  }

  // ---------- Events ----------
  function onClick(event) {
    var el = event.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var act = el.getAttribute("data-act");
    if (act === "close") {
      if (state.step === "done" && Date.now() - state.doneAt < 900) return;   // a double-tap on Link Account must not dismiss the result
      requestClose();
    }
    else if (act === "keep") hideConfirm();
    else if (act === "discard") { hideConfirm(); close(); }
    else if (act === "tab") setTab(el.getAttribute("data-tab"), true);
    else if (act === "verify") verifyTyped();
    else if (act === "rescan") startScan();
    else if (act === "upload") els.file.click();
    else if (act === "back") goBack();
    else if (act === "link") confirmLink();
    else if (act === "done") close();
  }

  // ---------- Steps ----------
  var EYEBROW = { code: "Step 1 of 2 \u00B7 Enter code", confirm: "Step 2 of 2 \u00B7 Confirm account", done: "Done" };
  var STEP_NO = { code: 1, confirm: 2, done: 2 };
  function setStep(step) {
    state.step = step;
    els.dialog.setAttribute("data-step", step);
    els.panels.forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== step; });
    els.eyebrow.textContent = EYEBROW[step];
    els.stepbars.forEach(function (bar, i) {
      bar.className = step === "done" || i + 1 < STEP_NO[step] ? "is-done" : i + 1 === STEP_NO[step] ? "is-current" : "";
    });
    els["save-error"].hidden = true;
    hideConfirm();
    if (step !== "code") stopScan();
    if (step === "code") renderCode(); else if (step === "confirm") renderConfirm(); else renderDone();
    renderFoot();
    var target = step === "confirm" ? els.q : step === "done" ? els["d-title"] : null;
    if (target) target.focus({ preventScroll: true });
    else if (state.tab === "scan") { startScan(); els["tab-scan"].focus({ preventScroll: true }); }   // coming Back from Confirm account: the camera starts again
    else els.code.focus({ preventScroll: true });
  }
  function goBack() {
    if (state.saving) return;
    state.result = null;
    setStep("code");
  }

  function renderFoot() {
    var h = "";
    if (state.step === "code" && state.tab === "enter") h = '<button class="btn btn--primary btn--block" type="button" data-act="verify"' + (state.busy ? ' disabled aria-busy="true">Checking\u2026' : ">Verify Code") + "</button>";
    else if (state.step === "confirm") h = '<div class="ru__actions"><button class="btn btn--secondary" type="button" data-act="back"' + (state.saving ? " disabled" : "") + '>Back</button>' +
      '<button class="btn btn--primary" type="button" data-act="link"' + (state.saving ? ' disabled aria-busy="true">' + (isRequest() ? "Sending" : "Linking") + "\u2026" : ">" + (isRequest() ? "Send Link Request" : "Link Account")) + "</button></div>";
    else if (state.step === "done") h = '<button class="btn btn--primary btn--block" type="button" data-act="done">Done</button>';
    els.foot.innerHTML = h;
    els.foot.hidden = !h;
  }

  // ---------- Step 1: enter the code ----------
  function renderCode() {
    var info = state.info;
    els.intro.textContent = info.real
      ? "Link " + state.customerName + "\u2019s CrediTrack account to this customer record. Ask the customer for their Customer Code (Profile > Customer Code & QR), or scan their QR code."
      : "Link " + state.customerName + "\u2019s CrediTrack account to this customer record. Use the temporary code from the customer, or scan their linking QR code.";
    els.code.placeholder = info.real ? "CT-CUS-123456" : "XXXX-XXXX";
    els["code-hint"].textContent = info.real ? "The Customer Code is shown on the customer\u2019s phone, like CT-CUS-123456." : "Ask the customer to open their CrediTrack app and show you their linking code.";
    els["scan-hint"].textContent = info.real ? "Point the camera at the customer\u2019s Customer Code QR." : "Point the camera at the customer\u2019s linking QR code.";
  }
  function setTab(tab, focus) {
    if (tab !== "enter" && tab !== "scan") return;
    state.tab = tab;
    ["enter", "scan"].forEach(function (name) {
      var selected = name === tab;
      els["tab-" + name].setAttribute("aria-selected", String(selected));
      els["tab-" + name].tabIndex = selected ? 0 : -1;
      els["pane-" + name].hidden = !selected;
    });
    setCodeError("");
    if (tab === "scan") { startScan(); if (focus) els["tab-scan"].focus({ preventScroll: true }); }
    else { stopScan(); if (focus) els.code.focus({ preventScroll: true }); }
    renderCode();
    renderFoot();
  }
  function onTabKey(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    var next = event.key === "Home" ? "enter" : event.key === "End" ? "scan" : state.tab === "enter" ? "scan" : "enter";
    setTab(next, true);
  }

  // Real account: the customer's Customer Code, CT-CUS-123456 (typed, pasted or read from their QR).
  function formatCode(raw) {
    if (state.info && state.info.real) {
      var s = String(raw).toUpperCase().replace(/^\s*CREDITRACK:CUSTOMER:/, "").replace(/[^A-Z0-9]/g, ""), prefix = "CTCUS";
      if (prefix.indexOf(s) === 0) return s;                               // still typing the CT-CUS part
      var digits = (s.indexOf(prefix) === 0 ? s.slice(prefix.length) : s).replace(/\D/g, "").slice(0, 6);
      return "CT-CUS-" + digits;
    }
    var code = /^\s*creditrack:link:/i.test(raw) ? api.normalizeLinkCode(raw) : String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
    code = code.slice(0, 8);
    return code.length > 4 ? code.slice(0, 4) + "-" + code.slice(4) : code;
  }
  function onCodeInput() {
    var formatted = formatCode(els.code.value);
    if (formatted !== els.code.value) els.code.value = formatted;
    setCodeError("");
  }
  function setCodeError(message) {
    els["code-err"].textContent = message || "";
    els["code-err"].hidden = !message;
    els.code.setAttribute("aria-invalid", message ? "true" : "false");
    els.code.classList.toggle("is-invalid", !!message);
  }
  // The viewfinder and its hint are only shown while a camera could work; otherwise just the message and the buttons
  function showViewfinder(on) {
    els.scan.hidden = !on;
    els["scan-hint"].hidden = !on;
  }
  function setScanError(message, canRetry) {
    els["scan-err"].textContent = message || "";
    els["scan-err"].hidden = !message;
    els["scan-actions"].hidden = !message;
    els["scan-actions"].querySelector('[data-act="rescan"]').hidden = !canRetry;
  }

  function verifyTyped() {
    verify(els.code.value, "enter");
  }
  // source: "enter" (typed) or "scan" (read from a QR code): decides where an error is shown
  function verify(raw, source) {
    if (state.busy) return;
    state.busy = true;
    renderFoot();
    api.verifyLinkCode(state.customerId, raw).then(function (result) {
      state.busy = false;
      state.result = result;
      state.code = result.code;
      setStep("confirm");
    }).catch(function (err) {
      state.busy = false;
      renderFoot();
      if (source === "scan") { showViewfinder(false); setScanError(err.message || "We could not check this code.", true); }
      else { setCodeError(err.message || "We could not check this code."); els.code.focus({ preventScroll: true }); }
    });
  }

  // ---------- Scan QR (camera + BarcodeDetector, only where the browser has both) ----------
  function scanMessage(text) {
    els["scan-msg"].textContent = text || "";
    els["scan-msg"].hidden = !text;
  }
  function stopScan() {
    if (scan.timer) clearInterval(scan.timer);
    scan.timer = null; scan.busy = false;
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    scan.stream = null;
    if (els.video) { try { els.video.pause(); } catch (e) { /* ignore */ } els.video.srcObject = null; }
  }
  function startScan() {
    stopScan();
    setScanError("");
    els.scan.classList.remove("is-live");
    showViewfinder(true);
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.BarcodeDetector || window.jsQR))) {
      scanMessage("");
      showViewfinder(false);
      setScanError("This browser cannot scan QR codes here. Use Enter Code instead.", false);
      return;
    }
    scanMessage("Starting camera\u2026");
    var detector = null;
    // Chrome on Android and Mac has BarcodeDetector. Windows Chrome, Firefox and Safari do not, so the bundled jsQR reads the video instead.
    if (window.BarcodeDetector) { try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; } }
    if (!detector && !window.jsQR) { scanMessage(""); showViewfinder(false); setScanError("This browser cannot scan QR codes here. Use Enter Code instead.", false); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (stream) {
      if (!root || root.hidden || state.tab !== "scan" || state.step !== "code") { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scan.stream = stream;
      els.video.srcObject = stream;
      var played = els.video.play();
      if (played && played.catch) played.catch(function () { /* autoplay refused: the frame stays blank */ });
      els.scan.classList.add("is-live");
      scanMessage("");
      scan.detector = detector;
      scan.timer = setInterval(scanTick, 250);
    }).catch(function (err) {
      scanMessage("");
      var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      var none = err && (err.name === "NotFoundError" || err.name === "OverconstrainedError");
      showViewfinder(false);
      setScanError(denied ? "Camera access was blocked. Allow the camera in your browser, or use Enter Code instead."
        : none ? "No camera was found on this device. Use Enter Code instead."
        : "The camera could not start. Use Enter Code instead.", denied || !none);
    });
  }
  var frameCanvas = null;
  // One camera frame read with jsQR (used when the browser has no BarcodeDetector) -> the QR text, or ""
  function readFrameWithJsQr() {
    var w = els.video.videoWidth, h = els.video.videoHeight;
    if (!w || !h) return "";
    var scale = Math.min(1, 640 / Math.max(w, h));
    if (!frameCanvas) frameCanvas = document.createElement("canvas");
    frameCanvas.width = Math.round(w * scale); frameCanvas.height = Math.round(h * scale);
    var ctx = frameCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(els.video, 0, 0, frameCanvas.width, frameCanvas.height);
    var data = ctx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
    var hit = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
    return hit ? String(hit.data || "") : "";
  }
  function gotQr(raw) {
    var wanted = state.info && state.info.real ? /^\s*CREDITRACK:CUSTOMER:/i : /^\s*CREDITRACK:LINK:/i;
    if (!wanted.test(raw)) { scanMessage(state.info && state.info.real ? "That QR code is not a CrediTrack Customer Code." : "That QR code is not a CrediTrack linking code."); return; }
    stopScan();
    els.scan.classList.remove("is-live");
    verify(raw, "scan");
  }
  function scanTick() {
    if (scan.busy || !els.video.videoWidth) return;
    if (!scan.detector) {                                   // jsQR fallback
      scan.busy = true;
      var text = "";
      try { text = readFrameWithJsQr(); } catch (e) { text = ""; }
      scan.busy = false;
      if (text && scan.timer) gotQr(text);
      return;
    }
    scan.busy = true;
    scan.detector.detect(els.video).then(function (found) {
      scan.busy = false;
      if (!found.length || !scan.timer) return;
      gotQr(String(found[0].rawValue || ""));
    }).catch(function () { scan.busy = false; });
  }

  // ---------- Upload a QR photo (screenshot or picture from the gallery) ----------
  // Same codes as the camera. BarcodeDetector reads the picture where the browser has it; otherwise the bundled jsQR does.
  function uploadFail(message) { stopScan(); els.scan.classList.remove("is-live"); showViewfinder(false); setScanError(message, true); }
  function decodePicture(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    function viaJsQr() {
      if (!window.jsQR || !w || !h) return "";
      var k = Math.min(1, 900 / Math.max(w, h)), canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var hit = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
      return hit && hit.data ? String(hit.data) : "";
    }
    function safeJsQr() { try { return viaJsQr(); } catch (e) { return ""; } }
    if (window.BarcodeDetector) {
      var detector = null;
      try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
      if (detector) return detector.detect(img).then(function (found) { return found.length ? String(found[0].rawValue || "") : safeJsQr(); }, safeJsQr);
    }
    return Promise.resolve(safeJsQr());
  }
  function readPhoto(file) {
    if (!file || state.busy) return;
    if (!/^image\//.test(file.type)) { uploadFail("Choose a picture (JPG or PNG) of the QR code."); return; }
    stopScan(); els.scan.classList.remove("is-live"); setScanError("");
    showViewfinder(true); scanMessage("Reading the picture\u2026");
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      decodePicture(img).then(function (raw) {
        URL.revokeObjectURL(url); scanMessage("");
        if (!raw) { uploadFail("No QR code was found in that picture. Try a clearer, closer picture, or use Enter Code instead."); return; }
        var real = state.info && state.info.real;
        if (!(real ? /^\s*CREDITRACK:CUSTOMER:/i : /^\s*CREDITRACK:LINK:/i).test(raw)) {
          uploadFail(real ? "That QR code is not a CrediTrack Customer Code." : "That QR code is not a CrediTrack linking code.");
          return;
        }
        showViewfinder(false);
        verify(raw, "scan");
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); uploadFail("That picture could not be opened. Try another one."); };
    img.src = url;
  }

  // ---------- Step 2: confirm the account ----------
  function renderConfirm() {
    var a = state.result.account;
    els["a-avatar"].textContent = initials(a.name);
    els["a-name"].textContent = a.name;
    els["a-id"].textContent = a.accountId;
    els["a-email"].textContent = a.email;
    els["a-phone"].textContent = a.phone;
    els["a-since"].textContent = longDate(a.memberSince);
    els["a-email-row"].hidden = !a.email;
    els["a-phone-row"].hidden = !a.phone;
    els["a-since-row"].hidden = !a.memberSince;
    els["a-customer"].textContent = state.customerName;
    var similar = sameName(a.name, state.customerName);
    var merge = state.result && state.result.willMerge ? "<strong>An empty record will be removed.</strong> When this person joined your store, an empty record (\u201C" + esc(state.result.emptyRecordName || a.name) + "\u201D, no utang or payments) was made for them. Linking will remove that empty record and connect the account to \u201C" + esc(state.customerName) + "\u201D instead." : "";
    var names = similar ? "" : "<strong>The names are different.</strong> This account is under \u201C" + esc(a.name) + "\u201D, but the customer record is \u201C" + esc(state.customerName) + "\u201D. Only link it if this is the same person.";
    els["a-warn"].hidden = !(merge || names);
    els["a-warn"].innerHTML = names + (names && merge ? "<br><br>" : "") + merge;
  }
  function confirmLink() {
    if (state.saving || !state.result) return;
    state.saving = true;
    els["save-error"].hidden = true;
    renderFoot();
    api.linkCustomerAccount(state.customerId, state.code).then(function (res) {
      state.saving = false;
      state.linked = true;
      state.doneAt = Date.now();
      state.linkedAccount = res.linkedAccount;
      state.requested = !!res.requested;
      setStep("done");
    }).catch(function (err) {
      state.saving = false;
      els["save-error"].textContent = (err && err.message) || "The account could not be linked. Please try again.";
      els["save-error"].hidden = false;
      renderFoot();
    });
  }

  // ---------- Step 3: done ----------
  function renderDone() {
    var acct = state.linkedAccount || (state.result && state.result.account) || { name: "" };
    els["d-title"].textContent = state.requested ? "Request sent" : "Account linked";
    els["d-text"].textContent = state.requested
      ? "We asked " + (acct.name || "the customer") + " to accept the link. Nothing is linked until they accept it in their CrediTrack app (Stores > Requests). The request expires in 14 days."
      : state.customerName + "\u2019s CrediTrack account is now connected to this customer record.";
    els["d-customer"].textContent = state.customerName;
    els["d-account"].textContent = acct.name + (acct.accountId ? " \u00B7 " + acct.accountId : "");
  }

  // ---------- Closing ----------
  function requestClose() {
    if (state.saving) return;
    if (state.step === "confirm") showConfirm(); else close();
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
    var items = Array.prototype.filter.call(scope.querySelectorAll("button, a[href], input, textarea"), function (el) { return !el.disabled && !el.hidden && el.getClientRects().length > 0 && el.tabIndex !== -1; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === els.dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  // options: { customerId, customerName, onLinked }  onLinked() runs when the modal closes after an account was linked.
  function open(options) {
    options = options || {};
    build();
    if (!root.hidden) return Promise.resolve();
    opener = document.activeElement;
    state = blank();
    state.customerId = options.customerId;
    state.customerName = options.customerName || "this customer";
    state.onLinked = typeof options.onLinked === "function" ? options.onLinked : null;
    els.code.value = "";
    setCodeError("");
    setScanError("");
    scanMessage("");
    showViewfinder(true);
    els.dialog.setAttribute("data-step", "code");
    hideConfirm();
    return api.getLinkingInfo().then(function (info) {
      state.info = info;
      root.hidden = false;
      document.documentElement.classList.add("ru-lock");
      setTab("enter", false);
      setStep("code");
    });
  }

  function close() {
    if (!root || root.hidden) return;
    stopScan();
    root.hidden = true;
    document.documentElement.classList.remove("ru-lock");
    hideConfirm();
    var linked = state.linked, callback = state.onLinked;
    state = blank();
    if (linked) {
      // An account was linked: Customer Details redraws itself; any other page behind it reloads so it is up to date.
      if (callback) callback(); else window.location.reload();
    }
    if (opener && document.body.contains(opener) && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
    opener = null;
  }

  window.LinkAccount = { open: open, close: close };
})();
