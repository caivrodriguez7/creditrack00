/* Store Owner > Profile & Settings > About CrediTrack (about): app details and basic system information. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };

  api.getAppInfo().then(function (info) {
    $("about-name").textContent = info.name;
    $("about-version").textContent = info.version;
    $("about-tagline").textContent = info.tagline;
  });

  var ua = navigator.userAgent, browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  $("sys-browser").textContent = browser;
  $("sys-screen").textContent = window.innerWidth + " x " + window.innerHeight;
})();
