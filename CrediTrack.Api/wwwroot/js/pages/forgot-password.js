/* Forgot Password: asks the API to email a password reset link.
   POST /api/auth/forgot-password  { email }  ->  200 { message }
   The server answers the same way whether or not the email is registered, so this page
   never says whether an account exists. */
(function () {
  "use strict";

  var panel = document.getElementById("forgot-panel");
  var form = document.getElementById("forgot-form");
  var email = document.getElementById("email");
  var submit = document.getElementById("forgot-submit");
  var message = document.getElementById("forgot-message");
  if (!form || !email || !submit || !message) return;

  var COOLDOWN_SECONDS = 30;
  var idleLabel = submit.textContent;
  var busy = false;          // a request is running
  var cooldownLeft = 0;      // seconds until the button can be used again
  var timer = null;

  function setFieldError(text) {
    var box = document.getElementById("email-error");
    box.textContent = text;                       // textContent, never innerHTML
    box.hidden = !text;
    if (text) email.setAttribute("aria-invalid", "true");
    else email.removeAttribute("aria-invalid");
    return !text;
  }

  function checkEmail() {
    var value = email.value.trim();
    if (!value) return setFieldError("Enter your email address.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setFieldError("Enter a valid email address.");
    return setFieldError("");
  }

  function showMessage(text, isError) {
    message.textContent = text;
    message.classList.toggle("is-error", !!isError);
    message.classList.toggle("is-success", !isError);
    message.hidden = !text;
  }

  function updateButton() {
    submit.disabled = busy || cooldownLeft > 0;
    email.readOnly = busy;
    panel.setAttribute("aria-busy", busy ? "true" : "false");
    if (busy) submit.textContent = "Sending...";
    else if (cooldownLeft > 0) submit.textContent = "Send again in " + cooldownLeft + "s";
    else submit.textContent = idleLabel;
  }

  // After a request finishes the button stays off for a short time, so it cannot be hammered.
  function startCooldown() {
    clearInterval(timer);
    cooldownLeft = COOLDOWN_SECONDS;
    updateButton();
    timer = setInterval(function () {
      cooldownLeft -= 1;
      if (cooldownLeft <= 0) { cooldownLeft = 0; clearInterval(timer); }
      updateButton();
    }, 1000);
  }

  email.addEventListener("blur", function () { if (email.value) checkEmail(); });
  email.addEventListener("input", function () { if (email.hasAttribute("aria-invalid")) checkEmail(); });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy || cooldownLeft > 0) return;         // ignore repeated submits
    showMessage("", false);
    if (!checkEmail()) { email.focus(); return; }

    busy = true;
    updateButton();

    window.CrediTrackHttp("/auth/forgot-password", {
      method: "POST",
      body: { email: email.value.trim() }
    }).then(function (result) {
      busy = false;
      showMessage((result && result.message) ||
        "If your email is registered, you will receive a password reset link.", false);
      startCooldown();
    }).catch(function (error) {
      busy = false;
      var tooMany = error.status === 429;
      showMessage(tooMany ? "Too many attempts. Please wait a moment and try again." : error.message, true);
      if (tooMany) startCooldown(); else updateButton();
    });
  });
})();
