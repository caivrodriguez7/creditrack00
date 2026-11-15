/* Store Owner > Profile & Settings > Notifications (settings-notifications). Saved to the account (the demo account is temporary).
   One switch per kind of notification, saved as it changes (CrediTrackApi.saveNotificationPreferences). */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var switches = Array.prototype.slice.call(document.querySelectorAll("[data-pref]"));
  function currentPrefs() {
    var prefs = {};
    switches.forEach(function (el) { prefs[el.getAttribute("data-pref")] = el.checked; });
    return prefs;
  }
  switches.forEach(function (el) {
    el.addEventListener("change", function () {
      var label = $(el.getAttribute("aria-labelledby")).textContent.toLowerCase();
      api.saveNotificationPreferences(currentPrefs()).then(function () {
        toast("Notifications for " + label + " turned " + (el.checked ? "on" : "off") + ".");
      }).catch(function () {
        el.checked = !el.checked;                       // could not save: put the switch back
        toast("Could not save your preference. Please try again.");
      });
    });
  });
  api.getNotificationPreferences().then(function (prefs) {
    switches.forEach(function (el) { el.checked = prefs[el.getAttribute("data-pref")] !== false; });
  });


  api.getOwnerProfile().then(function (p) {
  });
})();
