/* Finishes a password reset on the Security page (Settings), for the Store Owner and the Customer.
   How a person gets here: Security > "Forgot your current password?" (js/components/security-forgot.js) emails the usual reset link,
   but with ReturnTo "settings", so the link opens THIS page with ?token=... instead of the Reset Password page.
   Opening that link from the email is the identity check. The token is validated by the existing backend, nothing new:
     POST /api/auth/reset-password  { token, newPassword, confirmPassword }   (the same call the Reset Password page makes)
       -> 200 { message, signedIn, returnTo }
                                      password changed. The server knows from the token itself that the request started in Settings
                                      (the browser never says so). signedIn true: it renewed this browser's login cookie.
                                      signedIn false: the session had ended, so the person logs in with the NEW password and
                                      is sent back here (returnTo)
       -> 400 { message }             "Invalid or expired reset link.", "Passwords do not match." or the password rules message
       -> 429 { message }             rate limited
   While a token is present the page shows ONLY New password and Confirm new password (Current password and the forgot link are hidden).
   The token is read once, removed from the address bar and kept only in memory. It is never shown, stored or logged.
   Without ?token= this file does nothing, so the normal Change Password form works as before.
   Needs on the page (already there): #pw-form, #pw-title, .st-intro, #pw-current, #pw-new, #pw-confirm, #pw-cancel, #pw-save,
   the *-error lines, #pw-rules, and #pw-reset-msg (status line). */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var form = $("pw-form"), current = $("pw-current"), next = $("pw-new"), confirm = $("pw-confirm");
  var save = $("pw-save"), cancel = $("pw-cancel"), msg = $("pw-reset-msg"), title = $("pw-title");
  if (!form || !current || !next || !confirm || !save || !cancel || !msg || !window.CrediTrackHttp) return;

  var LINK_ERROR_MESSAGE = "Invalid or expired reset link.";   // exact text the backend sends for an unknown, expired or used token

  // ---- Token: read once, then removed from the address bar ----
  var params = new URLSearchParams(window.location.search);
  var token = (params.get("token") || "").trim();
  if (params.has("token") && window.history.replaceState) {
    params.delete("token");
    var rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
  }
  if (!token) return;

  var intro = document.querySelector(".st-intro");
  var currentField = current.closest ? current.closest(".field") : null;
  var forgotLine = document.querySelector(".pw-forgot"), forgotMsg = $("pw-forgot-msg");
  var originalTitle = title ? title.textContent : "", originalIntro = intro ? intro.textContent : "";
  var active = false, busy = false;

  // The same five rules as sign-up and the Reset Password page (the backend checks them again)
  var RULES = {
    length: function (v) { return v.length >= 8; },
    upper: function (v) { return /[A-Z]/.test(v); },
    lower: function (v) { return /[a-z]/.test(v); },
    number: function (v) { return /\d/.test(v); },
    special: function (v) { return /[^A-Za-z0-9\s]/.test(v); }
  };
  function allRulesMet(v) { return Object.keys(RULES).every(function (k) { return RULES[k](v); }); }

  function toast(text) { if (window.CrediTrack && window.CrediTrack.showToast) window.CrediTrack.showToast(text); }
  function show(text, isError) {
    msg.textContent = text;                              // textContent, never innerHTML
    msg.classList.toggle("is-error", !!isError);
    msg.classList.toggle("is-success", !isError);
    msg.hidden = !text;
  }
  function setError(input, text) {
    var box = $(input.id + "-error");
    if (box) { box.textContent = text; box.hidden = !text; }
    if (text) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    return !text;
  }
  function checkNew() {
    if (!next.value) return setError(next, "Enter a new password.");
    if (!allRulesMet(next.value)) return setError(next, "Password does not meet all the requirements.");
    return setError(next, "");
  }
  function checkConfirm() {
    if (!confirm.value) return setError(confirm, "Re-enter your new password.");
    if (confirm.value !== next.value) return setError(confirm, "Passwords do not match.");
    return setError(confirm, "");
  }

  // Empties the fields and puts the show/hide buttons back to hidden
  function clearFields() {
    [current, next, confirm].forEach(function (el) { el.value = ""; setError(el, ""); });
    form.querySelectorAll("[data-toggle-password]").forEach(function (button) {
      var target = $(button.getAttribute("data-toggle-password"));
      if (target) target.type = "password";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Show password");
    });
    next.dispatchEvent(new Event("input", { bubbles: true }));   // redraws the requirement ticks
  }

  // ---- Two looks of the same form: reset mode (New + Confirm only) and the normal Change Password form ----
  function enterResetMode() {
    active = true;
    if (currentField) { currentField.hidden = true; currentField.style.display = "none"; }
    current.required = false;
    if (forgotLine) forgotLine.hidden = true;
    if (forgotMsg) forgotMsg.hidden = true;
    if (title) title.textContent = "Set a New Password";
    if (intro) intro.textContent = "Your email link is confirmed. Enter your new password and re-enter it to finish.";
    show("", false);
    next.focus();
  }
  function leaveResetMode() {
    active = false;
    token = "";                                         // used up (or abandoned): drop it from memory
    if (currentField) { currentField.hidden = false; currentField.style.display = ""; }
    current.required = true;
    if (forgotLine) forgotLine.hidden = false;
    if (title) title.textContent = originalTitle;
    if (intro) intro.textContent = originalIntro;
    clearFields();
  }

  // "Password last changed" line (Customer page only)
  function refreshLastChanged() {
    var line = $("pw-last");
    if (!line) return;
    window.CrediTrackHttp("/auth/me").then(function (me) {
      var d = new Date(me && me.passwordChangedAt);
      if (isNaN(d.getTime())) return;
      line.textContent = "Password last changed: " + d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
        + " at " + d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
      line.hidden = false;
    }).catch(function () { /* the line is only a convenience */ });
  }

  function setBusy(on) {
    busy = on;
    save.disabled = on;
    next.readOnly = on; confirm.readOnly = on;
    form.setAttribute("aria-busy", on ? "true" : "false");
  }

  function finish() {
    if (busy) return;
    var okNew = checkNew(), okConfirm = checkConfirm();
    if (!okNew) { next.focus(); return; }
    if (!okConfirm) { confirm.focus(); return; }

    var idle = save.textContent;
    setBusy(true); save.textContent = "Saving...";
    window.CrediTrackHttp("/auth/reset-password", {
      method: "POST",
      body: { token: token, newPassword: next.value, confirmPassword: confirm.value }
    }).then(function (result) {
      setBusy(false); save.textContent = idle;
      leaveResetMode();
      if (!result || result.signedIn !== true) {
        // The session ended while the page was open (or this was a Log In reset token): the password IS changed, but the
        // person must log in again. Log In sends them back to Security only for a Settings reset (returnTo from the server).
        var back = result && result.returnTo ? "?returnTo=" + encodeURIComponent(result.returnTo) : "";
        show("Your password was changed. Please log in with your new password" + (back ? " to return to Security." : "."), false);
        window.setTimeout(function () { window.location.href = "/login" + back; }, 2500);
        return;
      }
      show("Your password was changed. You are still logged in.", false);
      toast("Password updated.");
      refreshLastChanged();
      msg.focus();
    }).catch(function (error) {
      setBusy(false); save.textContent = idle;
      if (error.status === 400 && error.message === LINK_ERROR_MESSAGE) {
        // unknown, expired or already used: back to the normal form, where Forgot Password can send a new link
        leaveResetMode();
        show("This reset link is invalid, has expired, or was already used. Select “Forgot your current password?” to get a new link.", true);
        msg.focus();
        return;
      }
      if (error.status === 429) { show("Too many attempts. Please wait a moment and try again.", true); return; }
      show(error.message || "Something went wrong. Please try again.", true);   // password rules, mismatch, network
    });
  }

  // These run first (capture phase on document) so the page's own Change Password handlers, which need the Current password,
  // do not run while the form is in reset mode.
  document.addEventListener("submit", function (event) {
    if (!active || event.target !== form) return;
    event.preventDefault(); event.stopImmediatePropagation();
    finish();
  }, true);
  document.addEventListener("click", function (event) {
    if (!active || event.target !== cancel) return;
    event.stopImmediatePropagation();
    leaveResetMode();
    show("", false);
    toast("Password change cancelled.");
  }, true);

  next.addEventListener("input", function () { if (active && next.hasAttribute("aria-invalid")) checkNew(); });
  confirm.addEventListener("input", function () { if (active && confirm.hasAttribute("aria-invalid")) checkConfirm(); });

  enterResetMode();
})();
