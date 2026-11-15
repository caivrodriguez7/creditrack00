/* Verify Email: reads the token from the link in the verification email and sends it to the API
   once, as soon as the page opens. The token is never shown, stored, or written to the console. */
(function () {
  "use strict";

  var panel = document.getElementById("verify-panel");
  var title = document.getElementById("verify-title");
  var message = document.getElementById("verify-message");
  var loginBtn = document.getElementById("verify-login-btn");
  var backBtn = document.getElementById("verify-back-btn");
  if (!panel) return;

  // Titles and messages for every state. The server text is not shown directly: the status code decides.
  var STATES = {
    loading: { title: "Verifying Your Email", message: "Please wait while we confirm your email address." },
    success: { title: "Email Verified", message: "Your email has been verified. You can now log in to CrediTrack." },
    missing: { title: "Invalid Verification Link", message: "This link is missing its verification token. Please open the link from your email again." },
    invalid: { title: "Invalid Verification Link", message: "This verification link is not valid. Please check that you opened the full link from your email." },
    expired: { title: "Link Expired", message: "This verification link has expired. Please log in to request a new verification email." },
    used: { title: "Link Already Used", message: "This verification link has already been used. If your email is verified, you can log in now." },
    busy: { title: "Please Wait", message: "Too many attempts. Please wait a moment, then open the link from your email again." },
    error: { title: "Could Not Verify", message: "" }
  };

  function setState(name, customMessage) {
    var state = STATES[name];
    panel.setAttribute("data-state", name);
    panel.setAttribute("aria-busy", name === "loading" ? "true" : "false");
    title.textContent = state.title;                       // textContent, never innerHTML
    message.textContent = customMessage || state.message;
    loginBtn.hidden = name !== "success";
    backBtn.hidden = name === "loading" || name === "success";
  }

  // The token is read once, then removed from the address bar so it does not stay in history or get shared.
  var params = new URLSearchParams(window.location.search);
  var token = (params.get("token") || "").trim();
  if (params.has("token") && window.history.replaceState) {
    params.delete("token");
    var rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
  }

  if (!token) {
    setState("missing");
    return;
  }

  setState("loading");

  window.CrediTrackHttp("/auth/verify", {
    method: "POST",
    body: { token: token }
  }).then(function () {
    setState("success");
  }).catch(function (error) {
    switch (error.status) {
      case 400: setState("invalid"); break;      // unknown or empty token
      case 409: setState("used"); break;         // already used
      case 410: setState("expired"); break;      // past its 30 minutes
      case 429: setState("busy"); break;         // rate limited
      default:
        // Network failure or server error: CrediTrackHttp already gives a readable message.
        setState("error", error.message);
    }
  });
})();
