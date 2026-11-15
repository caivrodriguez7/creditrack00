/* "Forgot your current password?" on the Security (Change Password) pages, for the Store Owner and the Customer.
   The person is already signed in, so there is nothing to type: one tap emails a reset link to the account's own email
   through the same endpoint as the Log In page's Forgot Password (POST /api/auth/forgot-password { email }).
   Sending ReturnTo "settings" makes the emailed link open THIS Security page (not the Reset Password page); js/components/security-reset.js
   then shows only the new-password fields, finishes the reset with the same token and keeps the person signed in.
   Needs on the page: #pw-forgot (button) and #pw-forgot-msg (status text). */
(function () {
  "use strict";

  var button = document.getElementById("pw-forgot");
  var message = document.getElementById("pw-forgot-msg");
  if (!button || !message) return;

  var COOLDOWN_SECONDS = 30;   // the same pause as the Forgot Password page, so the button cannot be hammered
  var idleLabel = button.textContent;
  var busy = false, cooldownLeft = 0, timer = null;

  // The signed-in account's email: the customer API calls it getProfile, the owner API getOwnerProfile
  function loadEmail() {
    var customer = window.CrediTrackCustomerApi, owner = window.CrediTrackApi;
    var request = customer && customer.getProfile ? customer.getProfile()
      : owner && owner.getOwnerProfile ? owner.getOwnerProfile() : null;
    if (!request) return Promise.reject(new Error("We could not find your account. Please log in again."));
    return request.then(function (profile) {
      var email = profile && profile.email ? String(profile.email).trim() : "";
      if (!email) throw new Error("We could not find your email address. Use Forgot Password on the Log In page.");
      return email;
    });
  }

  function show(text, isError) {
    message.textContent = text;                       // textContent, never innerHTML
    message.classList.toggle("is-error", !!isError);
    message.hidden = !text;
  }

  function update() {
    button.disabled = busy || cooldownLeft > 0;
    if (busy) button.textContent = "Sending...";
    else if (cooldownLeft > 0) button.textContent = "Send again in " + cooldownLeft + "s";
    else button.textContent = idleLabel;
  }

  function startCooldown() {
    clearInterval(timer);
    cooldownLeft = COOLDOWN_SECONDS;
    update();
    timer = setInterval(function () {
      cooldownLeft -= 1;
      if (cooldownLeft <= 0) { cooldownLeft = 0; clearInterval(timer); }
      update();
    }, 1000);
  }

  button.addEventListener("click", function () {
    if (busy || cooldownLeft > 0) return;
    show("", false);
    busy = true; update();
    var sentTo = "";
    loadEmail().then(function (email) {
      sentTo = email;
      return window.CrediTrackHttp("/auth/forgot-password", { method: "POST", body: { email: email, returnTo: "settings" } });
    }).then(function () {
      show("We sent a password reset link to " + sentTo + ". It works for 30 minutes. Open it to choose your new password here in Settings. You will stay logged in.", false);
    }).catch(function (error) {
      show((error && error.message) || "Something went wrong. Please try again.", true);
    }).then(function () { busy = false; startCooldown(); });
  });
})();
