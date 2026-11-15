/* Reset Password: sets a new password from the link in the reset email.
   POST /api/auth/reset-password  { token, newPassword, confirmPassword }
     -> 200 { message }                        password changed
     -> 400 { message }                        "Invalid or expired reset link." (unknown, expired or used token),
                                               "Passwords do not match." or the password rules message
     -> 429 { message }                        rate limited
   The token comes from ?token= in the email link (the backend builds it with AddQueryString(url, "token", ...)).
   It is read once, removed from the address bar, and kept only in memory. It is never shown, stored or logged. */
(function () {
  "use strict";

  var panel = document.getElementById("reset-panel");
  var form = document.getElementById("reset-form");
  var formWrap = document.getElementById("reset-form-wrap");
  var title = document.getElementById("reset-title");
  var intro = document.getElementById("reset-intro");
  var newPassword = document.getElementById("newPassword");
  var confirmPassword = document.getElementById("confirmPassword");
  var submit = document.getElementById("reset-submit");
  var message = document.getElementById("reset-message");
  var successBox = document.getElementById("reset-success");
  var invalidBox = document.getElementById("reset-invalid");
  var backLink = document.getElementById("reset-back");
  if (!panel || !form || !newPassword || !confirmPassword || !submit || !message) return;

  // The exact text the backend sends when the token is unknown, expired or already used.
  var LINK_ERROR_MESSAGE = "Invalid or expired reset link.";

  // ---- Token: read once, then remove it from the address bar (memory only from here on) ----
  var params = new URLSearchParams(window.location.search);
  var token = (params.get("token") || "").trim();
  if (params.has("token") && window.history.replaceState) {
    params.delete("token");
    var rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
  }

  // ---- Screen states: form | success | invalid ----
  function setState(name, text) {
    formWrap.hidden = name !== "form";
    successBox.hidden = name !== "success";
    invalidBox.hidden = name !== "invalid";
    backLink.hidden = name === "success";   // "Go to Log In" already leads back
    panel.setAttribute("data-state", name);
    if (name === "success") {
      title.textContent = "Password reset";                       // textContent, never innerHTML
      intro.textContent = text || "Your password has been reset successfully. You can now log in with your new password.";
    } else if (name === "invalid") {
      title.textContent = "Reset link not valid";
      intro.textContent = text || "This reset link is invalid, has expired, or has already been used. Request a new link to continue.";
    }
  }

  if (!token) { setState("invalid", "This page needs the link from your password reset email. Open the full link from the email, or request a new one."); return; }
  setState("form");

  // ---- Password rules (same rules as Register and the backend) ----
  var PW_RULES = {
    length: function (v) { return v.length >= 8; },
    upper: function (v) { return /[A-Z]/.test(v); },
    lower: function (v) { return /[a-z]/.test(v); },
    number: function (v) { return /\d/.test(v); },
    special: function (v) { return /[^A-Za-z0-9\s]/.test(v); }
  };
  function allRulesMet(v) {
    return Object.keys(PW_RULES).every(function (k) { return PW_RULES[k](v); });
  }
  function renderRules() {
    var v = newPassword.value;
    document.querySelectorAll("#password-rules [data-rule]").forEach(function (li) {
      li.classList.toggle("is-met", !!PW_RULES[li.getAttribute("data-rule")](v));
    });
  }

  // ---- Field errors ----
  function setError(input, text) {
    var box = document.getElementById(input.id + "-error");
    box.textContent = text;
    box.hidden = !text;
    if (text) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !text;
  }
  function checkNew() {
    if (!newPassword.value) return setError(newPassword, "Enter your new password.");
    if (!allRulesMet(newPassword.value)) return setError(newPassword, "Password does not meet all the requirements.");
    return setError(newPassword, "");
  }
  function checkConfirm() {
    if (!confirmPassword.value) return setError(confirmPassword, "Re-enter your new password.");
    if (confirmPassword.value !== newPassword.value) return setError(confirmPassword, "Passwords do not match.");
    return setError(confirmPassword, "");
  }

  function showMessage(text) {
    message.textContent = text;
    message.classList.add("is-error");
    message.hidden = !text;
  }

  // ---- Loading ----
  var idleLabel = submit.textContent;
  var busy = false;
  function setBusy(on) {
    busy = on;
    submit.disabled = on;
    newPassword.readOnly = on;
    confirmPassword.readOnly = on;
    panel.setAttribute("aria-busy", on ? "true" : "false");
    submit.textContent = on ? "Resetting..." : idleLabel;
  }

  newPassword.addEventListener("input", function () {
    renderRules();
    if (newPassword.hasAttribute("aria-invalid")) checkNew();
    if (confirmPassword.value) checkConfirm();
  });
  newPassword.addEventListener("blur", function () { if (newPassword.value) checkNew(); });
  confirmPassword.addEventListener("input", function () { if (confirmPassword.hasAttribute("aria-invalid")) checkConfirm(); });
  confirmPassword.addEventListener("blur", function () { if (confirmPassword.value) checkConfirm(); });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;                              // ignore repeated submits
    showMessage("");
    var okNew = checkNew();
    var okConfirm = checkConfirm();
    if (!okNew) { newPassword.focus(); return; }
    if (!okConfirm) { confirmPassword.focus(); return; }

    setBusy(true);
    window.CrediTrackHttp("/auth/reset-password", {
      method: "POST",
      body: { token: token, newPassword: newPassword.value, confirmPassword: confirmPassword.value }
    }).then(function (result) {
      setBusy(false);
      token = "";                                  // the token is used up; drop it from memory
      newPassword.value = "";
      confirmPassword.value = "";
      setState("success", result && result.message
        ? result.message + " You can now log in with your new password."
        : "");
      // A reset requested from Settings (the server says so with returnTo) comes back to Settings > Security after Log In.
      // A Log In reset has no returnTo, so this does nothing and "Go to Log In" works as before.
      if (result && result.returnTo) {
        var oldBtn = document.getElementById("reset-login-btn");
        var loginBtn = oldBtn.cloneNode(true);          // a copy has no click handler, so the plain link below is followed
        loginBtn.removeAttribute("data-route");
        loginBtn.setAttribute("href", "/login?returnTo=" + encodeURIComponent(result.returnTo));
        oldBtn.parentNode.replaceChild(loginBtn, oldBtn);
        intro.textContent = (result.message || "Your password has been reset successfully.") +
          " Log in with your new password to go back to Security in Settings.";
      }
    }).catch(function (error) {
      setBusy(false);
      if (error.status === 400 && error.message === LINK_ERROR_MESSAGE) {
        // The API does not say whether the token was unknown, expired or used, so one message covers all three.
        token = "";
        newPassword.value = "";
        confirmPassword.value = "";
        setState("invalid");
        return;
      }
      if (error.status === 429) {
        showMessage("Too many attempts. Please wait a moment and try again.");
        return;
      }
      // Other 400s (password rules, mismatch), 500s and network failures: CrediTrackHttp gives a readable message.
      showMessage(error.message);
    });
  });
})();
