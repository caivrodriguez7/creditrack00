/* Account type page: pick Store Owner or Customer, then continue to
   that sign-up page (a placeholder until registration is built). */
(function () {
  "use strict";

  var form = document.getElementById("type-form");
  var error = document.getElementById("type-error");
  if (!form) return;

  form.addEventListener("change", function () { error.hidden = true; });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var chosen = form.querySelector('input[name="account-type"]:checked');
    if (!chosen) {
      error.hidden = false;
      form.querySelector(".choice__input").focus();
      return;
    }
    window.CrediTrack.goTo(chosen.value === "store-owner" ? "register-owner" : "register-customer");
  });
})();
