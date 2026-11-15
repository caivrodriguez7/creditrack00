/* Customer Portal > Profile > Security (security). Real accounts use the API.
   Change Password: Current, New and Confirm New password with show/hide, the same live rules as sign-up and the Store Owner's
   Security page, Save Changes / Cancel, field messages and a success message.
   The rules and the final check live in js/api/customer-api.js (passwordRulesMet, validatePasswordChange, changePassword), the only
   place that decides. The server checks the current password and no password is ever stored in the browser. Show/hide is the shared data-toggle-password handler in js/main.js. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var form = $("pw-form"), IDS = ["pw-current", "pw-new", "pw-confirm"];
  var FIELD = { "pw-current": "currentPassword", "pw-new": "newPassword", "pw-confirm": "confirmPassword" };
  var saving = false;

  function values() { return { currentPassword: $("pw-current").value, newPassword: $("pw-new").value, confirmPassword: $("pw-confirm").value }; }
  function setError(id, message) {
    var el = $(id), box = $(id + "-error");
    box.textContent = message || "";
    box.hidden = !message;
    if (message) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
    return !message;
  }
  // Checks one field with the shared rules (the other fields are only read, never flagged)
  function check(id) { return setError(id, api.validatePasswordChange(values()).errors[FIELD[id]] || ""); }

  function renderRules() {
    var met = api.passwordRulesMet($("pw-new").value);
    document.querySelectorAll("#pw-rules [data-rule]").forEach(function (li) { li.classList.toggle("is-met", !!met[li.getAttribute("data-rule")]); });
  }

  IDS.forEach(function (id) {
    var el = $(id);
    el.addEventListener("blur", function () { if (el.value || el.hasAttribute("aria-invalid")) check(id); });
    el.addEventListener("input", function () {
      hideSuccess();
      if (el.hasAttribute("aria-invalid")) check(id);
      if (id === "pw-new") { renderRules(); if ($("pw-confirm").value) check("pw-confirm"); }
      if (id === "pw-current" && $("pw-new").hasAttribute("aria-invalid")) check("pw-new");   // "same as current" may no longer apply
    });
  });

  function hideSuccess() { $("pw-success").hidden = true; }
  function reset() {
    IDS.forEach(function (id) { $(id).value = ""; setError(id, ""); });
    form.querySelectorAll("[data-toggle-password]").forEach(function (button) {   // back to hidden
      $(button.getAttribute("data-toggle-password")).type = "password";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Show password");
    });
    renderRules();
  }

  function whenText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }) + " at " + d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  }
  function showLast(iso) {
    var text = iso ? whenText(iso) : "";
    $("pw-last").textContent = text ? "Password last changed: " + text : "";
    $("pw-last").hidden = !text;
  }

  // Keep the focus on the field while a button is pressed: an error appearing under the field (on blur) must not move the
  // buttons away before the tap finishes (same approach as Edit Profile).
  [$("pw-cancel"), $("pw-save")].forEach(function (button) { button.addEventListener("mousedown", function (event) { event.preventDefault(); }); });

  $("pw-cancel").addEventListener("click", function () { reset(); hideSuccess(); toast("Password change cancelled."); });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (saving) return;
    hideSuccess();
    var first = null;
    IDS.forEach(function (id) { if (!check(id) && !first) first = id; });
    if (first) { $(first).focus(); toast("Please fix the highlighted fields."); return; }
    saving = true; $("pw-save").disabled = true; $("pw-save").textContent = "Saving...";
    api.changePassword(values()).then(function (result) {
      reset();
      showLast(result.changedAt);
      $("pw-success-text").textContent = "Your password was changed on " + whenText(result.changedAt) + ".";
      $("pw-success").hidden = false;
      $("pw-success").focus();
      toast("Password updated.");
    }).catch(function (error) {
      if (error && error.errors) {   // the shared check found a field problem the form had not caught
        var firstBad = null;
        IDS.forEach(function (id) { var msg = error.errors[FIELD[id]]; setError(id, msg || ""); if (msg && !firstBad) firstBad = id; });
        if (firstBad) $(firstBad).focus();
        toast("Please fix the highlighted fields.");
      } else toast((error && error.message) || "Something went wrong. Please try again.");
    }).then(function () { saving = false; $("pw-save").disabled = false; $("pw-save").textContent = "Save Changes"; });
  });

  renderRules();
  api.getSecurityInfo().then(function (info) { showLast(info.passwordChangedAt); });
  window.addEventListener("pageshow", function (event) { if (event.persisted) api.getSecurityInfo().then(function (info) { showLast(info.passwordChangedAt); }); });
})();
