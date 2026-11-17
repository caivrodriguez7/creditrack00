/* Customer Portal > Profile (profile), the main screen. Mock data only, no backend.
   Shows the profile card (avatar or initials, name, email, Customer / Account Active, Edit Profile), the Customer Code with
   Copy Code and View My QR, and the menu (Personal Information, Connected Stores, Security, Notifications, Help & Support)
   and Log Out. The menu items are plain links to their own pages (routes in js/main.js); Log Out ends the session through
   js/session.js like the sidebar's Log Out does.
   Data comes from js/api/customer-api.js: getProfile() (photo, name, email, contact number, customer code; changed on Edit Profile) and getHome() (joined stores).
   The QR code is drawn offline with js/vendor/qrcode.js (the same library as the Store Owner's Store QR). It holds
   "CREDITRACK:CUSTOMER:<customer code>". After a page opened from here saves something, it leaves a one-time message
   (sessionStorage "creditrack.flash") that this page shows as a toast. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };
  var code = "", fullName = "", modules = null;

  function initials(name) {   // same rule as the header avatar (js/components/customer-shell.js)
    return String(name || "").trim().split(/\s+/).map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }
  // Shows the photo inside the avatar circle, or the initials when there is no photo.
  function paintAvatar(el, url, name) {
    el.textContent = "";
    if (url) {
      var img = document.createElement("img");
      img.src = url; img.alt = "";
      el.appendChild(img);
    } else el.textContent = initials(name) || "C";
  }

  // ---------- QR code ----------
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

  function openQr() {
    if (!code || !window.qrcode) { toast("Your QR code is not available yet."); return; }
    if (!modules) { modules = build(api.customerQrText(code)); drawSvg(modules); }
    $("qr-frame").setAttribute("aria-label", "QR code for customer code " + code);
    var dialog = $("qr-dialog");
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    $("qr-close").focus();
  }
  function closeQr() {
    var dialog = $("qr-dialog");
    if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
  }

  // ---------- Download QR ----------
  // PNG to save or print: the customer's name above and the Customer Code below the QR (same image as Customer Code & QR).
  function fit(ctx, text, max) {   // shortens a long name with "..." so it fits the image
    if (ctx.measureText(text).width <= max) return text;
    while (text.length > 1 && ctx.measureText(text + "...").width > max) text = text.slice(0, -1);
    return text + "...";
  }
  function downloadQr() {
    if (!code || !window.qrcode) { toast("Your QR code is not available yet."); return; }
    if (!modules) { modules = build(api.customerQrText(code)); drawSvg(modules); }
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
      toast("QR code downloaded.");
    }, "image/png");
  }

  // ---------- Copy Code ----------
  function copyCode() {
    function done() {
      toast("Customer code copied.");
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

  // ---------- Render ----------
  function render(profile, home) {
    code = profile.customerCode || "";
    fullName = profile.fullName || "";


    paintAvatar($("pf-avatar"), profile.photo, fullName);
    $("pf-name").textContent = fullName || "Customer";

    var codeEl = $("cc-code");
    codeEl.textContent = code || "Not available yet";
    codeEl.classList.toggle("is-empty", !code);
    $("cc-copy").disabled = $("cc-qr").disabled = !code;
    $("qr-name").textContent = fullName || "Customer";
    $("qr-code").textContent = code;

    var n = home.stores.length;
    var card = document.querySelector(".st-identity");   // loaded: remove the placeholder state
    if (card) card.removeAttribute("aria-busy");
    $("stores-desc").textContent = n === 0 ? "No store joined yet" : n + (n === 1 ? " store connected" : " stores connected");
  }

  Promise.all([api.getProfile(), api.getHome()]).then(function (r) { render(r[0], r[1]); }).catch(function () {
    var card = document.querySelector(".st-identity");
    if (card) card.removeAttribute("aria-busy");
    toast("We could not load your profile. Please refresh the page.");
  });

  $("cc-copy").addEventListener("click", function () { if (code) copyCode(); });
  $("cc-qr").addEventListener("click", openQr);
  $("qr-download").addEventListener("click", downloadQr);
  $("qr-close").addEventListener("click", closeQr);
  $("qr-dialog").addEventListener("click", function (event) { if (event.target === $("qr-dialog")) closeQr(); });   // click outside the card
  $("qr-dialog").addEventListener("close", function () { $("cc-qr").focus(); });

  // ---- Log Out: ask first (error prevention). The dialog's Log Out link carries data-logout, so js/main.js ends the session as before. ----
  (function () {
    var open = $("logout-open"), dialog = $("logout-dialog");
    if (!open || !dialog) return;
    open.addEventListener("click", function () {
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
      $("logout-cancel").focus();
    });
    function close() { if (dialog.close) dialog.close(); else dialog.removeAttribute("open"); }
    $("logout-cancel").addEventListener("click", close);
    dialog.addEventListener("click", function (event) { if (event.target === dialog) close(); });   // click outside the card
    dialog.addEventListener("close", function () { open.focus(); });
  })();

  // A message left by a page opened from here (for example "Profile updated.")
  try {
    var flash = window.sessionStorage.getItem("creditrack.flash");
    if (flash) {
      window.sessionStorage.removeItem("creditrack.flash");
      toast(flash);
    }
  } catch (e) { /* storage blocked: no message */ }

  // Coming Back to this page (back/forward cache) shows the current stores and details
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) Promise.all([api.getProfile(), api.getHome()]).then(function (r) { render(r[0], r[1]); });
  });
})();
