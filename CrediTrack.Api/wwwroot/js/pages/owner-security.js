/* Store Owner > Profile & Settings > Security (security). Change Password calls POST /api/account/change-password
   It uses the same rules as the sign-up form. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var pwForm = $("pw-form");
  var PW_IDS = ["pw-current", "pw-new", "pw-confirm"];
  var pwSaving = false;
  // Same rules as the sign-up form (js/pages/register-owner.js)
  var PW_RULES = {
    length: function (v) { return v.length >= 8; },
    upper: function (v) { return /[A-Z]/.test(v); },
    lower: function (v) { return /[a-z]/.test(v); },
    number: function (v) { return /\d/.test(v); },
    special: function (v) { return /[^A-Za-z0-9\s]/.test(v); }
  };
  function allRulesMet(v) { return Object.keys(PW_RULES).every(function (k) { return PW_RULES[k](v); }); }
  function renderRules() {
    var value = $("pw-new").value;
    document.querySelectorAll("#pw-rules [data-rule]").forEach(function (li) {
      li.classList.toggle("is-met", !!PW_RULES[li.getAttribute("data-rule")](value));
    });
  }

  var PW_CHECKS = {
    "pw-current": function (v) { return v ? "" : "Enter your current password."; },
    "pw-new": function (v) {
      if (!v) return "Enter a new password.";
      if (!allRulesMet(v)) return "Password does not meet all the requirements.";
      if (v === $("pw-current").value) return "Your new password must be different from your current password.";
      return "";
    },
    "pw-confirm": function (v) {
      if (!v) return "Re-enter your new password.";
      return v === $("pw-new").value ? "" : "Passwords do not match.";
    }
  };
  function pwSetError(id, message) {
    var el = $(id), box = $(id + "-error");
    box.textContent = message;
    box.hidden = !message;
    if (message) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
    return !message;
  }
  function pwCheck(id) { return pwSetError(id, PW_CHECKS[id]($(id).value)); }

  PW_IDS.forEach(function (id) {
    var el = $(id);
    el.addEventListener("blur", function () { if (el.value || el.hasAttribute("aria-invalid")) pwCheck(id); });
    el.addEventListener("input", function () {
      if (el.hasAttribute("aria-invalid")) pwCheck(id);
      if (id === "pw-new") { renderRules(); if ($("pw-confirm").value) pwCheck("pw-confirm"); }
      if (id === "pw-current" && $("pw-new").hasAttribute("aria-invalid")) pwCheck("pw-new");   // "same as current" may no longer apply
    });
  });


  function resetPassword() {
    PW_IDS.forEach(function (id) { $(id).value = ""; pwSetError(id, ""); });
    pwForm.querySelectorAll("[data-toggle-password]").forEach(function (button) {   // back to hidden
      $(button.getAttribute("data-toggle-password")).type = "password";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Show password");
    });
    renderRules();
  }

  $("pw-cancel").addEventListener("click", function () { resetPassword(); toast("Password change cancelled."); });
  pwForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (pwSaving) return;
    var first = null;
    PW_IDS.forEach(function (id) { if (!pwCheck(id) && !first) first = id; });
    if (first) { $(first).focus(); toast("Please fix the highlighted fields."); return; }
    pwSaving = true; $("pw-save").disabled = true;
    api.changePassword({ currentPassword: $("pw-current").value, newPassword: $("pw-new").value, confirmPassword: $("pw-confirm").value }).then(function (result) {
      resetPassword();
      toast("Password updated.");
    }).catch(function (err) {
      var ids = { currentPassword: "pw-current", newPassword: "pw-new", confirmPassword: "pw-confirm" }, firstId = null;
      if (err && err.errors) {
        Object.keys(err.errors).forEach(function (name) { if (ids[name]) { pwSetError(ids[name], err.errors[name]); if (!firstId) firstId = ids[name]; } });
      }
      if (firstId) { $(firstId).focus(); toast("Please fix the highlighted fields."); }
      else toast((err && err.message) || "Something went wrong. Please try again.");
    }).then(function () { pwSaving = false; $("pw-save").disabled = false; });
  });
  renderRules();
})();
