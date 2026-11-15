/* Customer Portal > Profile > Notifications (settings-notifications), a subpage. Real accounts use the API.
   Four switches: payment request updates, credit and payment activity, store updates, account and security alerts.
   Switching only changes a DRAFT on this page. Save Changes saves it (CrediTrackCustomerApi.saveNotificationPreferences, the only
   place that stores it) and shows a message; Cancel throws the draft away and returns to Profile. The saved choices are read
   again every time the page opens, so they are still there after leaving and coming back (or reloading, or logging back in).
   Leaving with unsaved changes (Back, a link, closing the tab) asks the browser to confirm first. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var KEYS = api.NOTIFICATION_PREF_KEYS;
  var switches = Array.prototype.slice.call(document.querySelectorAll("[data-pref]"));
  var form = $("np-form"), saveBtn = $("np-save"), cancelBtn = $("np-cancel"), status = $("np-status");
  var saved = null;          // the choices as last saved (null until they are loaded)
  var saving = false, leaving = false;

  function draft() {
    var prefs = {};
    switches.forEach(function (el) { prefs[el.getAttribute("data-pref")] = el.checked; });
    return prefs;
  }
  function isDirty() { return !!saved && KEYS.some(function (key) { return draft()[key] !== saved[key]; }); }
  function render(prefs) {
    switches.forEach(function (el) { el.checked = prefs[el.getAttribute("data-pref")] !== false; });
    refresh();
  }
  // Buttons, status line and the account-alerts warning always follow the switches
  function refresh() {
    var dirty = isDirty();
    saveBtn.disabled = !saved || !dirty || saving;
    status.textContent = !saved ? "" : dirty ? "You have unsaved changes." : "No changes to save.";
    status.classList.toggle("is-dirty", dirty);
    var account = document.querySelector('[data-pref="account"]');
    $("np-account-warn").hidden = !account || account.checked;
  }

  function whenText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }) + " at " + d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  }
  function showSuccess(iso) {
    var when = iso ? whenText(iso) : "";
    $("np-success-text").textContent = when ? "Your notification preferences were saved on " + when + "." : "Your notification preferences were saved.";
    $("np-success").hidden = false;
  }
  function hideSuccess() { $("np-success").hidden = true; }

  switches.forEach(function (el) {
    el.addEventListener("change", function () { hideSuccess(); refresh(); });
  });

  // Cancel and Save keep focus where it is while pressed (same approach as Security and Edit Profile)
  [cancelBtn, saveBtn].forEach(function (button) { button.addEventListener("mousedown", function (event) { event.preventDefault(); }); });

  // ---- Leaving the page ----
  // Back goes to the Customer Portal page the person came from, otherwise to Profile.
  function cameFromCustomerPage() {
    try {
      var from = new URL(document.referrer);
      return window.history.length > 1 && from.origin === window.location.origin && /^\/customer\/[^/]+$/.test(from.pathname);
    } catch (e) { return false; }
  }
  function leave(message) {
    leaving = true;           // no "unsaved changes" prompt: the draft was thrown away on purpose
    if (message) window.CrediTrack.flash(message);
    if (cameFromCustomerPage()) window.history.back();
    else window.location.href = "profile";
  }
  window.addEventListener("beforeunload", function (event) {
    if (leaving || !isDirty()) return;
    event.preventDefault();
    event.returnValue = "";   // the browser shows its own "leave this page?" message
  });

  cancelBtn.addEventListener("click", function () {
    var hadChanges = isDirty();
    if (saved) render(saved);                        // the draft is thrown away
    leave(hadChanges ? "Changes discarded." : "");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (saving || !saved) return;
    if (!isDirty()) { toast("No changes to save."); return; }
    saving = true; refresh(); saveBtn.textContent = "Saving\u2026"; form.setAttribute("aria-busy", "true");
    api.saveNotificationPreferences(draft()).then(function (result) {
      saved = result.preferences;
      render(saved);
      showSuccess(result.updatedAt);
      $("np-success").focus();
      toast("Notification preferences saved.");
    }).catch(function (error) {
      // Nothing was saved: the switches stay as the person set them so they can try again
      toast((error && error.message) || "Could not save your preferences. Please try again.");
    }).then(function () {
      saving = false; saveBtn.textContent = "Save Changes"; form.removeAttribute("aria-busy"); refresh();
    });
  });

  // ---- Load the saved choices (also when the page comes back from the back/forward cache) ----
  function load() {
    return api.getNotificationPreferences().then(function (info) {
      saved = info.preferences;
      render(saved);
    });
  }
  load();
  window.addEventListener("pageshow", function (event) { if (event.persisted) { hideSuccess(); load(); } });
})();
