/* Check Your Email: shows the address used at registration and lets the user ask for another
   verification email. The reply is always generic, so the page never says whether the account exists. */
(function () {
  "use strict";

  var resendBtn = document.getElementById("resend-btn");
  var message = document.getElementById("check-message");
  var addressBox = document.getElementById("check-address");
  if (!resendBtn) return;

  var email = (new URLSearchParams(window.location.search).get("email") || "").trim();

  if (email) {
    addressBox.textContent = email;   // textContent, never innerHTML
    addressBox.hidden = false;
  } else {
    resendBtn.disabled = true;
    show("We could not find your email address. Please register again or log in.", true);
  }

  function show(text, isError) {
    message.textContent = text;
    message.classList.toggle("is-error", !!isError);
    message.classList.toggle("is-success", !isError);
    message.hidden = false;
  }

  var COOLDOWN_SECONDS = 30;
  var idleLabel = resendBtn.textContent;
  var timer = null;

  // After a request finishes the button stays off for a short time, so it cannot be hammered.
  function startCooldown() {
    var left = COOLDOWN_SECONDS;
    resendBtn.textContent = "Resend again in " + left + "s";
    timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        resendBtn.disabled = false;
        resendBtn.textContent = idleLabel;
      } else {
        resendBtn.textContent = "Resend again in " + left + "s";
      }
    }, 1000);
  }

  resendBtn.addEventListener("click", function () {
    if (resendBtn.disabled || !email) return;   // ignore repeated clicks while a request is running
    resendBtn.disabled = true;
    resendBtn.textContent = "Sending...";
    message.hidden = true;

    window.CrediTrackHttp("/auth/resend-verification", {
      method: "POST",
      body: { email: email }
    }).then(function (result) {
      show((result && result.message) ||
        "If your email is registered and not yet verified, we have sent a new verification email.", false);
      startCooldown();
    }).catch(function (error) {
      var tooMany = error.status === 429;
      show(tooMany ? "Too many attempts. Please wait a moment and try again." : error.message, true);
      if (tooMany) startCooldown();
      else { resendBtn.disabled = false; resendBtn.textContent = idleLabel; }
    });
  });
})();
