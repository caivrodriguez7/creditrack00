/* Login page: basic field checks and the mock (frontend-only) sign-in. */
(function () {
  "use strict";

  var form = document.getElementById("login-form");
  var email = document.getElementById("email");
  var password = document.getElementById("password");
  var rememberMe = document.getElementById("remember-me");
  if (!form) return;

  function setError(input, message) {
    var box = document.getElementById(input.id + "-error");
    box.textContent = message;
    box.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !message;
  }

  function checkEmail() {
    var value = email.value.trim();
    if (!value) return setError(email, "Enter your email address.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setError(email, "Enter a valid email address.");
    return setError(email, "");
  }
  function checkPassword() {
    return setError(password, password.value ? "" : "Enter your password.");
  }

  // ---- Unverified email: shown when the server answers 403 with requiresEmailVerification ----
  var verifyNotice = document.getElementById("verify-notice");
  var resendBtn = document.getElementById("resend-verification-btn");
  var resendStatus = document.getElementById("resend-status");
  var RESEND_COOLDOWN_SECONDS = 30;
  var resendIdleLabel = resendBtn ? resendBtn.textContent : "";
  var resendBusy = false;       // a resend request is running
  var cooldownLeft = 0;         // seconds until the button can be used again
  var cooldownTimer = null;

  function updateResendButton() {
    if (!resendBtn) return;
    resendBtn.disabled = resendBusy || cooldownLeft > 0;
    if (resendBusy) resendBtn.textContent = "Sending...";
    else if (cooldownLeft > 0) resendBtn.textContent = "Resend again in " + cooldownLeft + "s";
    else resendBtn.textContent = resendIdleLabel;
  }

  function startCooldown() {
    clearInterval(cooldownTimer);
    cooldownLeft = RESEND_COOLDOWN_SECONDS;
    updateResendButton();
    cooldownTimer = setInterval(function () {
      cooldownLeft -= 1;
      if (cooldownLeft <= 0) { cooldownLeft = 0; clearInterval(cooldownTimer); }
      updateResendButton();
    }, 1000);
  }

  function showResendStatus(text, isError) {
    resendStatus.textContent = text;          // textContent, never innerHTML
    resendStatus.classList.toggle("is-error", !!isError);
    resendStatus.hidden = !text;
  }

  function showVerifyNotice() {
    if (!verifyNotice) return;
    setError(password, "");
    showResendStatus("", false);
    verifyNotice.hidden = false;
    updateResendButton();
  }

  function hideVerifyNotice() {
    if (!verifyNotice) return;
    verifyNotice.hidden = true;
    showResendStatus("", false);
  }

  if (resendBtn) resendBtn.addEventListener("click", function () {
    if (resendBusy || cooldownLeft > 0) return;   // ignore repeated clicks
    var value = email.value.trim();
    if (!checkEmail()) { email.focus(); return; }
    resendBusy = true;
    updateResendButton();
    showResendStatus("", false);

    // The reply is generic on purpose, so this page never says whether the email was delivered.
    window.CrediTrackHttp("/auth/resend-verification", {
      method: "POST",
      body: { email: value }
    }).then(function () {
      resendBusy = false;
      showResendStatus("If this email address is registered and not yet verified, a verification email will be sent. " +
        "Please check your inbox and spam folder.", false);
      startCooldown();
    }).catch(function (error) {
      resendBusy = false;
      var tooMany = error.status === 429;
      showResendStatus(tooMany ? "Too many attempts. Please wait a moment and try again." : error.message, true);
      if (tooMany) startCooldown(); else updateResendButton();
    });
  });

  email.addEventListener("blur", function () { if (email.value) checkEmail(); });
  email.addEventListener("input", function () {
    if (email.hasAttribute("aria-invalid")) checkEmail();
    hideVerifyNotice();
  });
  password.addEventListener("input", function () { if (password.hasAttribute("aria-invalid")) checkPassword(); });

  // Sign in: the server checks the email and password (POST /auth/login).
  var api = window.CrediTrackApi, Session = window.CrediTrackSession, customerApi = window.CrediTrackCustomerApi;

  function signIn() {
    var value = email.value.trim();
    // Real account: ask the backend
    var remember = !!(rememberMe && rememberMe.checked);
    hideVerifyNotice();
    window.CrediTrackHttp("/auth/login", {
      method: "POST",
      body: { email: value, password: password.value, rememberMe: remember }
    }).then(function (user) {
      Session.start({ role: user.role, name: user.fullName, remember: remember });
      // Coming back from a password reset that started in Settings: ?returnTo=/owner/security (or /customer/security).
      // Only that one page for the role that just logged in is accepted, so this can never be used as an open redirect.
      var back = new URLSearchParams(window.location.search).get("returnTo");
      if (back === (user.role === "owner" ? "/owner/security" : "/customer/security")) { window.location.href = back; return; }
      window.CrediTrack.goTo(user.role === "owner" ? "store-dashboard" : "customer-dashboard");
    }).catch(function (error) {
      // Correct password but unverified email: no session was created, so stay here and offer a resend.
      if (error.status === 403 && error.requiresEmailVerification) {
        showVerifyNotice();
        return;
      }
      setError(password, error.message);
      password.focus();
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var okEmail = checkEmail();
    var okPassword = checkPassword();
    if (!okEmail) { email.focus(); return; }
    if (!okPassword) { password.focus(); return; }
    signIn();
  });
})();
