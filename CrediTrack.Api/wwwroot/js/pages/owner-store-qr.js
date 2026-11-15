/* Store Owner > Profile & Settings > Store QR Code & Store Code (store-qr). Real accounts get the Store Code from the API (GET /owner/store).
   Draws a QR code for the store code (js/vendor/qrcode.js, MIT, runs offline), and offers Copy Code and Download QR (PNG).
   The QR holds "CREDITRACK:JOIN:<store code>"; customers join by scanning it (Join Store) or typing the code. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api || !window.qrcode) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };
  var code = "", storeName = "", modules = null;

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

  // PNG for printing or sharing: the QR code with the store name above and the store code below, so the image is self-explaining.
  function downloadPng() {
    var n = modules.length, quiet = 4, scale = 12, qrSize = (n + quiet * 2) * scale, pad = 48, head = 70, foot = 90;
    var canvas = document.createElement("canvas");
    canvas.width = qrSize + pad * 2; canvas.height = qrSize + head + foot;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#071A52"; ctx.textAlign = "center";
    ctx.font = "700 34px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
    ctx.fillText(fit(ctx, storeName, canvas.width - pad * 2), canvas.width / 2, 48);
    modules.forEach(function (row, r) {
      row.forEach(function (dark, c) { if (dark) ctx.fillRect(pad + (c + quiet) * scale, head + (r + quiet) * scale, scale, scale); });
    });
    ctx.font = "700 40px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
    ctx.fillText(code, canvas.width / 2, head + qrSize + 28);
    ctx.font = "400 18px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif"; ctx.fillStyle = "#52627e";
    ctx.fillText("Scan with CrediTrack or enter this Store Code", canvas.width / 2, head + qrSize + 66);
    canvas.toBlob(function (blob) {
      if (!blob) { toast("Could not create the image. Please try again."); return; }
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "creditrack-store-qr-" + code + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      feedback("QR code downloaded.");
    }, "image/png");
  }
  function fit(ctx, text, max) {   // shortens a long store name with "..." so it fits the image
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(text + "...").width > max) text = text.slice(0, -1);
    return text + "...";
  }

  // Success message: a toast and a line under the buttons (read out by screen readers)
  var statusTimer;
  function feedback(message) {
    toast(message);
    $("qr-status").textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { $("qr-status").textContent = ""; }, 3000);
  }

  function copyCode() {
    function done() {
      feedback("Store code copied.");
      var btn = $("qr-copy");
      btn.textContent = "Copied!"; btn.classList.add("is-done");
      setTimeout(function () { btn.textContent = "Copy Code"; btn.classList.remove("is-done"); }, 2000);
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

  api.getOwnerProfile().then(function (p) {
    code = p.storeCode;
    if (p.loadError) toast(p.loadError);
    storeName = p.storeName || "Your Store";
    $("qr-store").textContent = storeName;
    $("qr-code").textContent = code || (p.loadError ? "Could not load" : "Not available yet");
    if (!code) { $("qr-copy").disabled = $("qr-download").disabled = $("qr-zoom").disabled = true; return; }
    modules = build("CREDITRACK:JOIN:" + code);
    drawSvg(modules);
    $("qr-frame").setAttribute("aria-label", "QR code for store code " + code);
  }).catch(function (err) { toast((err && err.message) || "Could not load the store code."); });
  $("qr-zoom").addEventListener("click", function () {
    var large = !$("qr-zoom").classList.contains("is-on");
    $("qr-zoom").classList.toggle("is-on", large);
    $("qr-zoom").setAttribute("aria-pressed", String(large));
    $("qr-zoom-text").textContent = large ? "View Smaller" : "View Larger";
    $("qr-zoom").closest(".st-qr").classList.toggle("is-large", large);
    if (large) $("qr-frame").scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  // Auto-approve switch (real accounts; the demo has no join requests). The server decides what happens on the next join.
  var aa = $("aa-toggle"), aaStatus = $("aa-status"), aaWarn = $("aa-warn");
  function showAutoApprove(on) { aa.checked = on; aaWarn.hidden = !on; }
  api.getJoinSettings().then(function (s) {
    if (!s.available) { aaStatus.textContent = "Not available in the demo."; return; }
    aa.disabled = false;
    showAutoApprove(s.autoApproveJoins);
  }, function () { aaStatus.textContent = "Could not load this setting. Reload the page to try again."; });
  aa.addEventListener("change", function () {
    var wanted = aa.checked;
    aa.disabled = true; aaStatus.textContent = "";
    api.setAutoApproveJoins(wanted).then(function (r) {
      showAutoApprove(r.autoApproveJoins);
      feedback(r.autoApproveJoins ? "Auto-approve is on. New customers join right away." : "Auto-approve is off. You approve each new customer.");
    }, function (err) {
      showAutoApprove(!wanted);                         // the server did not save it: put the switch back
      toast((err && err.message) || "Could not save this setting. Please try again.");
    }).then(function () { aa.disabled = false; });
  });
  $("qr-copy").addEventListener("click", function () { if (code) copyCode(); });
  $("qr-download").addEventListener("click", function () { if (modules) downloadPng(); });
})();
