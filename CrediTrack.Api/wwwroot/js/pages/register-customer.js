/* Customer registration: 2 steps (personal information, account security).
   All fields live in one form and steps are only shown or hidden, so entered
   values are kept when moving Back and Continue. */
(function () {
  "use strict";

  var form = document.getElementById("register-customer-form");
  if (!form) return;

  var $ = function (id) { return document.getElementById(id); };
  var TOTAL = 2;
  var STEP_NAMES = ["Personal Information", "Account Security"];
  var STEP_FIELDS = { 1: ["fullName", "contactNumber"], 2: ["email", "password", "confirmPassword", "agreeTerms"] };
  var draft;   // keeps the form while the Terms / Privacy pages are open (set up at the bottom)
  // Registration no longer signs anyone in. The server creates the account and emails a verification link.
  // sent === true  -> the Check Your Email screen; sent === false -> account created, but the email failed.
  function handleRegistered(result, email) {
    result = result || {};
    var target = result.email || email;
    if (result.requiresEmailVerification === true) draft.clear();   // account created: the saved answers are no longer needed
    if (result.requiresEmailVerification === true && result.emailSent === true) {
      window.CrediTrack.goTo("check-email?email=" + encodeURIComponent(target));
      return;
    }
    if (result.requiresEmailVerification === true && result.emailSent === false) {
      showEmailNotSent(target);
      return;
    }
    // Unexpected reply (for example an older server): never pretend the user is signed in.
    nextBtn.disabled = false;
    var box = $("email-error");
    box.textContent = "Something unexpected happened. If your account was created, try logging in.";
    box.hidden = false;
  }

  // Account exists but the verification email could not be sent: explain and point to the resend option.
  function showEmailNotSent(email) {
    var title = $("reg-title");
    if (title) title.textContent = "Account created";
    var intro = document.querySelector(".auth__heading p");
    if (intro) intro.textContent = "One more thing before you can log in.";
    var stepper = $("stepper");
    if (stepper) stepper.hidden = true;
    form.hidden = true;

    var notice = document.createElement("div");
    notice.className = "reg-notice";
    notice.setAttribute("role", "status");
    var text = document.createElement("p");
    text.textContent = "Your account was created, but we could not send the verification email. " +
      "You can request a new verification email later from the Check Your Email page.";
    var resend = document.createElement("a");
    resend.className = "btn btn--primary btn--lg btn--block";
    resend.href = "check-email?email=" + encodeURIComponent(email);
    resend.textContent = "Go to Resend Verification";
    var login = document.createElement("a");
    login.className = "btn btn--secondary btn--lg btn--block";
    login.href = "login";
    login.textContent = "Back to Log In";
    notice.appendChild(text);
    notice.appendChild(resend);
    notice.appendChild(login);
    form.parentNode.insertBefore(notice, form.nextSibling);
    resend.focus();
  }

  // Password rules, shown live under the field and enforced on submit.
  var PW_RULES = {
    length: function (v) { return v.length >= 8; },
    upper: function (v) { return /[A-Z]/.test(v); },
    lower: function (v) { return /[a-z]/.test(v); },
    number: function (v) { return /\d/.test(v); },
    special: function (v) { return /[^A-Za-z0-9\s]/.test(v); }
  };
  function passwordStatus(v) {
    var met = {};
    Object.keys(PW_RULES).forEach(function (k) { met[k] = PW_RULES[k](v); });
    return met;
  }
  function renderRules() {
    var met = passwordStatus($("password").value);
    document.querySelectorAll("#password-rules [data-rule]").forEach(function (li) {
      li.classList.toggle("is-met", !!met[li.getAttribute("data-rule")]);
    });
  }

  // Field id -> validator returning an error message ("" when valid).
  var rules = {
    fullName: function (v) {
      v = v.trim();
      if (!v) return "Enter your full name.";
      return v.length < 2 ? "Full name is too short." : "";
    },
    contactNumber: function (v) {
      var n = v.replace(/[\s-]/g, "");
      if (!n) return "Enter your contact number.";
      return /^(09\d{9}|\+639\d{9})$/.test(n) ? "" : "Use a valid mobile number, like 09XX XXX XXXX.";
    },
    email: function (v) {
      v = v.trim();
      if (!v) return "Enter your email address.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter a valid email address.";
    },
    password: function (v) {
      if (!v) return "Create a password.";
      var met = passwordStatus(v);
      return Object.keys(met).every(function (k) { return met[k]; }) ? "" : "Password does not meet all the requirements.";
    },
    confirmPassword: function (v) {
      if (!v) return "Re-enter your password.";
      return v === $("password").value ? "" : "Passwords do not match.";
    },
    // Checkbox: the value is ignored, only whether it is ticked matters
    agreeTerms: function () { return $("agreeTerms").checked ? "" : "Please agree to the Terms and Conditions and Privacy Policy to create your account."; }
  };
  var ids = Object.keys(rules);
  var current = 1;
  var nextBtn;

  function syncConsentButton() {
    if (nextBtn) nextBtn.disabled = current === TOTAL && !$("agreeTerms").checked;
  }

  function check(id) {
    var input = $(id);
    var message = rules[id](input.value);
    var box = $(id + "-error");
    box.textContent = message;
    box.hidden = !message;
    if (message) { input.setAttribute("aria-invalid", "true"); input.removeAttribute("data-valid"); }
    else { input.removeAttribute("aria-invalid"); input.setAttribute("data-valid", "true"); }
    return !message;
  }

  ids.forEach(function (id) {
    var input = $(id);
    // Validate when leaving a field; after an error, re-check as the person types.
    input.addEventListener("blur", function () { if (input.type !== "checkbox" && (input.value || input.hasAttribute("aria-invalid"))) check(id); });
    if (input.type === "checkbox") input.addEventListener("change", function () {
      if (input.hasAttribute("aria-invalid")) check(id);
      if (id === "agreeTerms") syncConsentButton();
    });
    input.addEventListener("input", function () {
      if (input.hasAttribute("aria-invalid")) check(id);
      if (id === "password") {
        renderRules();
        if ($("confirmPassword").value) check("confirmPassword");
      }
    });
  });

  // Validates every field of one step; focuses the first invalid one.
  function validateStep(n) {
    var firstBad = null;
    STEP_FIELDS[n].forEach(function (id) { if (!check(id) && !firstBad) firstBad = $(id); });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  var panels = form.querySelectorAll(".form-step");
  var segs = document.querySelectorAll("[data-step-seg]");
  var backBtn = $("btn-back");
  nextBtn = $("btn-next");
  var actions = form.querySelector(".reg-actions");

  function showStep(n, moveFocus) {
    current = n;
    panels.forEach(function (p) { p.hidden = Number(p.getAttribute("data-step")) !== n; });
    segs.forEach(function (s) {
      var i = Number(s.getAttribute("data-step-seg"));
      s.classList.toggle("is-done", i < n);
      s.classList.toggle("is-current", i === n);
      if (i === n) s.setAttribute("aria-current", "step"); else s.removeAttribute("aria-current");
    });
    $("stepper-status").textContent = "Step " + n + " of " + TOTAL + " \u00b7 " + STEP_NAMES[n - 1];
    backBtn.hidden = n === 1;
    actions.classList.toggle("has-back", n > 1);
    nextBtn.textContent = n === TOTAL ? "Create Account" : "Continue";
    syncConsentButton();
    if (moveFocus) {
      var title = form.querySelector('.form-step[data-step="' + n + '"] .form-step__title');
      if (title) title.focus({ preventScroll: true });
      var panel = document.querySelector(".auth__panel");
      if (panel) panel.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  backBtn.addEventListener("click", function () { if (current > 1) showStep(current - 1, true); });
  form.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && current === TOTAL && !$("agreeTerms").checked && event.target.tagName !== "A") {
      event.preventDefault();
      validateStep(current);
    }
  });

  // Continue (and Enter key) moves ahead after the current step is valid.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!validateStep(current)) return;
    if (current < TOTAL) { showStep(current + 1, true); return; }

    // Registration payload; never log or store the password in the browser.
    var account = {
      fullName: $("fullName").value.trim(),
      contactNumber: $("contactNumber").value.replace(/[\s-]/g, ""),
      email: $("email").value.trim(),
      password: $("password").value
    };
        nextBtn.disabled = true;   // no double submit while waiting for the server
    window.CrediTrackHttp("/auth/register", {
      method: "POST",
      body: {
        role: "customer",
        fullName: account.fullName,
        email: account.email,
        contactNumber: account.contactNumber,
        password: account.password,
        acceptedTerms: $("agreeTerms").checked
      }
    }).then(function (result) {
      handleRegistered(result, account.email);
    }).catch(function (error) {
      syncConsentButton();
      if (error.field === "acceptedTerms") {
        var consentError = $("agreeTerms-error");
        consentError.textContent = error.message;
        consentError.hidden = false;
        $("agreeTerms").setAttribute("aria-invalid", "true");
        $("agreeTerms").focus();
        return;
      }
      nextBtn.disabled = false;
      var box = $("email-error");               // e.g. "This email is already registered."
      box.textContent = error.message;
      box.hidden = false;
      $("email").setAttribute("aria-invalid", "true");
      $("email").focus();
    });    
  });

  // Terms / Privacy are opened in this tab; the form (never the passwords) is saved first and refilled on return.
  var startStep = 1;
  draft = window.CrediTrackDraft.init({
    key: "customer",
    form: form,
    getStep: function () { return current; },
    apply: function (values, step) {
      ids.forEach(function (id) {
        if (!(id in values)) return;
        if ($(id).type === "checkbox") $(id).checked = !!values[id]; else $(id).value = values[id];
      });
      if (step >= 1 && step <= TOTAL) startStep = step;
    }
  });

  renderRules();
  showStep(startStep, false);
})();
