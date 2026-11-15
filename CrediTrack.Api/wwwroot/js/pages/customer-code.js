/* Customer Portal > Profile > Customer Code & QR (customer-code). Mock data only, no backend.
   Shows the customer's unique Customer Code (Copy Code) and their personal QR code (View Larger, Download QR).
   Both come from ONE call, getCustomerIdentity() in js/api/customer-api.js, so the QR always holds the same code that is shown:
   "CREDITRACK:CUSTOMER:<customer code>" (the same text the Profile's View My QR dialog draws).
   This is the customer's account ID. It is not a Store Code (CREDITRACK:JOIN:<store code>) and not the Store Owner's temporary
   linking code (CREDITRACK:LINK:<code>), so the Store Owner's Link Customer Account workflow is not touched or confused.
   The QR is drawn offline with js/vendor/qrcode.js, the same library the Store Owner's Store QR page uses. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  if (!api || !window.qrcode) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };
  var code = "", fullName = "", modules = null;

  function build(text) {
    var qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount(), grid = [];
    for (var r = 0; r < n; r++) { grid.push([]); for (var c = 0; c < n; c++) grid[r].push(qr.isDark(r, c)); }
    return grid;
  }
  function drawSvg(grid) {
    var n = grid.length, quiet = 2, size = n + quiet * 2, d = "";
    grid.forEach(function (row, r) {
      row.forEach(function (dark, c) { if (dark) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z"; });
    });
    $("qr-frame").innerHTML = '<svg viewBox="0 0 ' + size + " " + size + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#071A52"/></svg>';
  }

  // Success message: a toast and a line under the buttons (read out by screen readers)
  var statusTimer;
  function feedback(message) {
    toast(message);
    $("qr-status").textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { $("qr-status").textContent = ""; }, 3000);
  }

  // PNG to save or print: the customer's name above and the Customer Code below the QR, so the image explains itself.
  function downloadPng() {
    var n = modules.length, quiet = 4, scale = 12, qrSize = (n + quiet * 2) * scale, pad = 48, head = 70, foot = 90;
    var canvas = document.createElement("canvas");
    canvas.width = qrSize + pad * 2; canvas.height = qrSize + head + foot;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#071A52"; ctx.textAlign = "center";
    ctx.font = "700 34px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
    ctx.fillText(fit(ctx, fullName || "CrediTrack Customer", canvas.width - pad * 2), canvas.width / 2, 48);
    modules.forEach(function (row, r) {
      row.forEach(function (dark, c) { if (dark) ctx.fillRect(pad + (c + quiet) * scale, head + (r + quiet) * scale, scale, scale); });
    });
    ctx.font = "700 40px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
    ctx.fillText(code, canvas.width / 2, head + qrSize + 28);
    ctx.font = "400 18px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif"; ctx.fillStyle = "#52627e";
    ctx.fillText("CrediTrack Customer Code (not a Store Code)", canvas.width / 2, head + qrSize + 66);
    canvas.toBlob(function (blob) {
      if (!blob) { toast("Could not create the image. Please try again."); return; }
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "creditrack-customer-qr-" + code + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      feedback("QR code downloaded.");
    }, "image/png");
  }
  function fit(ctx, text, max) {   // shortens a long name with "..." so it fits the image
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(text + "...").width > max) text = text.slice(0, -1);
    return text + "...";
  }

  function copyCode() {
    function done() {
      feedback("Customer code copied.");
      var btn = $("cc-copy");
      $("cc-copy-text").textContent = "Copied!"; btn.classList.add("is-done");
      setTimeout(function () { $("cc-copy-text").textContent = "Copy Code"; btn.classList.remove("is-done"); }, 2000);
    }
    function fallback() {
      var box = document.createElement("textarea");
      box.value = code; box.setAttribute("readonly", ""); box.style.position = "fixed"; box.style.opacity = "0";
      document.body.appendChild(box); box.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* ignore */ }
      box.remove();
      if (ok) done(); else toast("Could not copy. Select the code and copy it by hand.");
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(done, fallback);
    else fallback();
  }

  function render(identity) {
    code = identity.customerCode;
    fullName = identity.fullName || "";
    modules = null;

    $("cc-name").textContent = fullName || "Customer";

    var codeEl = $("cc-code");
    codeEl.textContent = code || "Not available yet";
    codeEl.classList.toggle("is-empty", !code);
    $("qr-code").textContent = code;
    $("cc-copy").disabled = $("qr-zoom").disabled = $("qr-download").disabled = !code;
    document.querySelector(".st-qr").classList.toggle("is-empty", !code);

    if (!code) {
      $("qr-frame").textContent = "Your QR code is not available yet.";
      $("qr-frame").setAttribute("aria-label", "QR code not available");
      return;
    }
    modules = build(identity.qrText);
    drawSvg(modules);
    $("qr-frame").setAttribute("aria-label", "QR code for customer code " + code);
  }

  api.getCustomerIdentity().then(render);

  $("cc-copy").addEventListener("click", function () { if (code) copyCode(); });
  $("qr-download").addEventListener("click", function () { if (modules) downloadPng(); });
  $("qr-zoom").addEventListener("click", function () {
    var large = !$("qr-zoom").classList.contains("is-on");
    $("qr-zoom").classList.toggle("is-on", large);
    $("qr-zoom").setAttribute("aria-pressed", String(large));
    $("qr-zoom-text").textContent = large ? "View Smaller" : "View Larger";
    $("qr-zoom").closest(".st-qr").classList.toggle("is-large", large);
    if (large) $("qr-frame").scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  // Coming Back to this page (back/forward cache) shows the current details
  window.addEventListener("pageshow", function (event) { if (event.persisted) api.getCustomerIdentity().then(render); });
})();
