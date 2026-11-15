/* Customer Portal > Profile > Personal Information (personal-info). Read only: the customer's photo, name, email address,
   contact number, Customer Code and the date the account was made. Changes are made on Edit Profile (the button at the bottom).
   Data comes from js/api/customer-api.js: getPersonalInfo() (GET /auth/me for a real account). Every value is put on the page
   with textContent, never as HTML. A missing detail shows "Not added yet" in a quiet style, like the Profile page. */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  function initials(name) {   // same rule as the Profile page and the header avatar
    return String(name || "").trim().split(/\s+/).map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }
  function paintAvatar(el, url, name) {
    el.textContent = "";
    if (url) {
      var img = document.createElement("img");
      img.src = url; img.alt = "";
      el.appendChild(img);
    } else el.textContent = initials(name) || "C";
  }
  function setValue(id, value) {
    var el = $(id), has = !!value;
    el.textContent = has ? value : "Not added yet";
    el.classList.toggle("is-empty", !has);
  }
  function longDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
  }

  function render(info) {
    paintAvatar($("pi-avatar"), info.photo, info.fullName);
    $("pi-name").textContent = info.fullName || "Customer";
    setValue("pi-fullName", info.fullName);
    setValue("pi-email", info.email);
    setValue("pi-contactNumber", info.contactNumber ? api.formatPhone(info.contactNumber) : "");
    setValue("pi-customerCode", info.customerCode);
    setValue("pi-memberSince", info.memberSince ? longDate(info.memberSince) : "");
    $("pi-verified").hidden = !info.emailVerified;
    $("pi-card").removeAttribute("aria-busy");
  }

  function load() {
    Promise.resolve().then(function () { return api.getPersonalInfo(); }).then(render).catch(function () {
      $("pi-card").removeAttribute("aria-busy");
      toast("We could not load your details. Please refresh the page.");
    });
  }
  load();

  // Coming back from Edit Profile (back/forward cache) shows the saved details
  window.addEventListener("pageshow", function (event) { if (event.persisted) load(); });
})();
