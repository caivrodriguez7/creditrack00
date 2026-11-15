/* Store Owner > Profile & Settings (settings), the main page. Mock data only, no backend.
   Shows the profile card (photo, name, store, role, account status) and Personal Information. The menu items are plain
   links to their own subpages (profile-edit, store-information, store-qr, security, settings-notifications, help-support, about).
   Data comes from js/api/owner-api.js (CrediTrackApi). After a subpage saves, it leaves a one-time message
   (sessionStorage "creditrack.flash") that this page shows as a toast. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };

  function initials(name) {   // same rule as the header avatar (js/components/owner-shell.js)
    return String(name || "").split(" ").map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("");
  }
  // Shows the photo inside an avatar circle, or the initials when there is no photo.
  function paintAvatar(el, url, name, fallback) {
    el.textContent = "";
    if (url) {
      var img = document.createElement("img");
      img.src = url; img.alt = "";
      el.appendChild(img);
    } else el.textContent = initials(name) || fallback;
  }
  function setValue(id, value, format) {
    var el = $(id), has = !!value;
    el.textContent = has ? (format ? format(value) : value) : "Not added yet";
    el.classList.toggle("is-empty", !has);
  }
  // The header (store name and initials) is filled by owner-shell.js: keep it in step. (Subpages have no header, so this does nothing there.)

  function renderProfile(p) {
    paintAvatar($("pf-avatar"), p.photo, p.fullName, "SO");
    $("pf-name").textContent = p.fullName || "Store Owner";
    $("pf-store").textContent = p.storeName || "Your Store";
    setValue("pf-fullName", p.fullName);
    setValue("pf-email", p.email);
    setValue("pf-contactNumber", p.contactNumber, api.formatPhone);
    var card = document.querySelector(".st-identity");   // loaded: remove the placeholder state
    if (card) card.removeAttribute("aria-busy");
  }

  api.getOwnerProfile().then(renderProfile).catch(function () {
    var card = document.querySelector(".st-identity");
    if (card) card.removeAttribute("aria-busy");
    window.CrediTrack.showToast("We could not load your profile. Please refresh the page.");
  });

  // A message left by a subpage after Save Changes ("Profile updated.")
  try {
    var flash = window.sessionStorage.getItem("creditrack.flash");
    if (flash) {
      window.sessionStorage.removeItem("creditrack.flash");
      window.CrediTrack.showToast(flash);
    }
  } catch (e) { /* storage blocked: no message */ }
  // Appearance and Language rows (open / close and the current-mode chip) are handled for both Settings pages by js/components/theme-picker.js and js/language.js.

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

})();
