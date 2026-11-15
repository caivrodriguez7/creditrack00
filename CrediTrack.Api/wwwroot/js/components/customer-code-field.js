/* Customer Code field for Owner > Customers > Add Customer: "Does the customer already use CrediTrack?"
   The owner either types the customer's Customer Code (CT-CUS-123456) or scans the customer's Customer Code QR
   (text CREDITRACK:CUSTOMER:<code>) with the camera or from a photo. The code is checked with the server
   (api.verifyCustomerCode) and the account it belongs to is shown (name, ID, partly hidden email), so the owner can make
   sure it is the right person. Nothing is saved here: the Add Customer page sends the checked code together with the new
   customer, and the server then asks the customer to accept the link.

   window.CustomerCodeField.init({ root, onFound(account, code), onClear() })  ->  { showError(message), clear() }
   The markup lives in Pages/Owner/CustomerForm.cshtml (ids start with ccf-). Styles: css/components/link-account.css (tabs and
   camera frame, shared with Link Customer Account) and css/components/customer-code-field.css.
   The camera reads QR codes with BarcodeDetector where the browser has it, otherwise with the bundled js/vendor/jsqr.js. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;

  var $ = function (id) { return document.getElementById(id); };
  var PREFIX = /^\s*CREDITRACK:CUSTOMER:/i;

  function init(opts) {
    var root = opts.root;
    var tab = "enter", busy = false, current = null;
    var scan = { stream: null, timer: null, detector: null, busy: false };
    var canvas = null;
    var els = {
      find: $("ccf-find"), enter: $("ccf-pane-enter"), scanPane: $("ccf-pane-scan"),
      tabEnter: $("ccf-tab-enter"), tabScan: $("ccf-tab-scan"),
      code: $("ccf-code"), check: $("ccf-check"), error: $("ccf-error"),
      frame: $("ccf-scan"), video: $("ccf-video"), msg: $("ccf-scan-msg"), hint: $("ccf-scan-hint"),
      actions: $("ccf-scan-actions"), rescan: $("ccf-rescan"), upload: $("ccf-upload"), file: $("ccf-file"),
      found: $("ccf-found"), avatar: $("ccf-avatar"), name: $("ccf-name"), id: $("ccf-id"), email: $("ccf-email"), remove: $("ccf-remove")
    };

    function initials(name) {
      return String(name || "?").split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase();
    }

    // ---------- Messages ----------
    function setError(message) {
      els.error.textContent = message || "";
      els.error.hidden = !message;
      els.code.setAttribute("aria-invalid", message ? "true" : "false");
      els.code.classList.toggle("is-invalid", !!message && tab === "enter");
    }
    function scanMessage(text) { els.msg.textContent = text || ""; els.msg.hidden = !text; }
    function showViewfinder(on) { els.frame.hidden = !on; els.hint.hidden = !on; }
    // After a scan problem: the viewfinder goes away and Scan Again appears (when trying again can help)
    function scanProblem(message, canRetry) {
      stopScan(); els.frame.classList.remove("is-live"); showViewfinder(false); scanMessage("");
      setError(message);
      els.actions.hidden = !canRetry;
    }

    // ---------- Tabs ----------
    function formatCode(raw) {
      var s = String(raw).toUpperCase().replace(PREFIX, "").replace(/[^A-Z0-9]/g, ""), prefix = "CTCUS";
      if (prefix.indexOf(s) === 0) return s;                                         // still typing the CT-CUS part
      var digits = (s.indexOf(prefix) === 0 ? s.slice(prefix.length) : s).replace(/\D/g, "").slice(0, 6);
      return "CT-CUS-" + digits;
    }
    function setTab(next, focus) {
      if (next !== "enter" && next !== "scan") return;
      tab = next;
      var isEnter = next === "enter";
      els.tabEnter.setAttribute("aria-selected", isEnter ? "true" : "false"); els.tabEnter.tabIndex = isEnter ? 0 : -1;
      els.tabScan.setAttribute("aria-selected", isEnter ? "false" : "true"); els.tabScan.tabIndex = isEnter ? -1 : 0;
      els.enter.hidden = !isEnter; els.scanPane.hidden = isEnter;
      setError("");
      if (isEnter) { stopScan(); if (focus) els.code.focus(); }
      else { startScan(); if (focus) els.tabScan.focus({ preventScroll: true }); }
    }
    function onTabKey(event) {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(event.key) < 0) return;
      event.preventDefault();
      setTab(event.key === "Home" ? "enter" : event.key === "End" ? "scan" : tab === "enter" ? "scan" : "enter", true);
    }

    // ---------- Check the code with the server ----------
    function verify(raw, source) {
      if (busy) return;
      var wanted = String(raw || "").trim();
      if (!wanted) { setError("Enter the customer’s Customer Code."); els.code.focus(); return; }
      busy = true; els.check.disabled = true; setError("");
      if (source === "scan") scanMessage("Checking the code…");
      api.verifyCustomerCode(wanted).then(function (r) {
        busy = false; els.check.disabled = false; scanMessage("");
        var code = r.account.accountId;
        show(r.account, code);
        if (opts.onFound) opts.onFound(r.account, code);
      }, function (err) {
        busy = false; els.check.disabled = false; scanMessage("");
        var message = (err && err.message) || "We could not check this code. Please try again.";
        if (source === "scan") scanProblem(message, true);
        else { setError(message); els.code.focus(); }
      });
    }

    // ---------- Show the account that was found ----------
    function show(account, code) {
      current = { account: account, code: code };
      stopScan();
      els.find.hidden = true; els.found.hidden = false;
      els.avatar.textContent = initials(account.name);
      els.name.textContent = account.name;
      els.id.textContent = account.accountId;
      els.email.textContent = account.email || "";
      els.email.hidden = !account.email;
    }
    function clear(silent) {
      current = null;
      els.found.hidden = true; els.find.hidden = false;
      els.code.value = ""; setError(""); els.actions.hidden = true;
      if (tab === "scan") startScan();
      if (!silent && opts.onClear) opts.onClear();
    }

    // ---------- Scan QR ----------
    function stopScan() {
      if (scan.timer) clearInterval(scan.timer);
      scan.timer = null; scan.busy = false;
      if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
      scan.stream = null;
      try { els.video.pause(); } catch (e) { /* ignore */ }
      els.video.srcObject = null;
    }
    function startScan() {
      stopScan(); setError(""); els.actions.hidden = true;
      els.frame.classList.remove("is-live");
      showViewfinder(true);
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.BarcodeDetector || window.jsQR))) {
        scanProblem("This browser cannot scan QR codes here. Use Enter Code, or upload a QR photo.", false);
        return;
      }
      var detector = null;
      if (window.BarcodeDetector) { try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; } }
      scanMessage("Starting camera…");
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then(function (stream) {
        if (tab !== "scan" || current) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        scan.stream = stream;
        els.video.srcObject = stream;
        var played = els.video.play();
        if (played && played.catch) played.catch(function () { /* autoplay refused: the frame stays blank */ });
        els.frame.classList.add("is-live");
        scanMessage("");
        scan.detector = detector;
        scan.timer = setInterval(scanTick, 250);
      }).catch(function (err) {
        var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
        var none = err && (err.name === "NotFoundError" || err.name === "OverconstrainedError");
        scanProblem(denied ? "Camera access was blocked. Allow the camera in your browser, or use Enter Code."
          : none ? "No camera was found on this device. Use Enter Code, or upload a QR photo."
          : "The camera could not start. Use Enter Code, or upload a QR photo.", !none);
      });
    }
    function readFrame() {
      var w = els.video.videoWidth, h = els.video.videoHeight;
      if (!w || !h) return "";
      var k = Math.min(1, 640 / Math.max(w, h));
      if (!canvas) canvas = document.createElement("canvas");
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var hit = window.jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
      return hit ? String(hit.data || "") : "";
    }
    function gotQr(raw) {
      if (!PREFIX.test(raw)) { scanMessage("That QR code is not a CrediTrack Customer Code."); return; }   // keep looking
      stopScan(); els.frame.classList.remove("is-live");
      verify(raw, "scan");
    }
    function scanTick() {
      if (scan.busy || !els.video.videoWidth) return;
      if (!scan.detector) {                                   // jsQR fallback
        scan.busy = true;
        var text = "";
        try { text = readFrame(); } catch (e) { text = ""; }
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

    // ---------- Upload a QR photo (a screenshot the customer sent, or a picture from the gallery) ----------
    function decodePicture(img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      function viaJsQr() {
        if (!window.jsQR || !w || !h) return "";
        var k = Math.min(1, 900 / Math.max(w, h)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        var ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var data = ctx.getImageData(0, 0, c.width, c.height);
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
      if (!file || busy) return;
      if (!/^image\//.test(file.type)) { scanProblem("Choose a picture (JPG or PNG) of the QR code.", true); return; }
      stopScan(); els.frame.classList.remove("is-live"); setError(""); els.actions.hidden = true;
      showViewfinder(true); scanMessage("Reading the picture…");
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        decodePicture(img).then(function (raw) {
          URL.revokeObjectURL(url);
          if (!raw) { scanProblem("No QR code was found in that picture. Try a clearer, closer picture, or use Enter Code.", true); return; }
          if (!PREFIX.test(raw)) { scanProblem("That QR code is not a CrediTrack Customer Code.", true); return; }
          showViewfinder(false); scanMessage("");
          verify(raw, "scan");
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); scanProblem("That picture could not be opened. Try another one.", true); };
      img.src = url;
    }

    // ---------- Wire up ----------
    els.tabEnter.addEventListener("click", function () { setTab("enter", true); });
    els.tabScan.addEventListener("click", function () { setTab("scan", true); });
    els.tabEnter.addEventListener("keydown", onTabKey);
    els.tabScan.addEventListener("keydown", onTabKey);
    els.code.addEventListener("input", function () {
      var formatted = formatCode(els.code.value);
      if (formatted !== els.code.value) els.code.value = formatted;
      setError("");
    });
    els.code.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); verify(els.code.value, "enter"); }   // Enter checks the code, it does not save the customer
    });
    els.check.addEventListener("click", function () { verify(els.code.value, "enter"); });
    els.rescan.addEventListener("click", startScan);
    els.upload.addEventListener("click", function () { els.file.click(); });
    els.file.addEventListener("change", function () { var f = els.file.files && els.file.files[0]; els.file.value = ""; readPhoto(f); });
    els.remove.addEventListener("click", function () { clear(false); els.code.focus(); });
    window.addEventListener("pagehide", stopScan);
    document.addEventListener("visibilitychange", function () { if (document.hidden) stopScan(); else if (tab === "scan" && !current && !busy) startScan(); });

    setTab("enter", false);
    return {
      // The server refused the code while saving: show why and let the owner fix or remove it
      showError: function (message) { clear(true); setTab("enter", false); setError(message); els.code.focus(); },
      clear: function () { clear(true); }
    };
  }

  window.CustomerCodeField = { init: init };
})();
