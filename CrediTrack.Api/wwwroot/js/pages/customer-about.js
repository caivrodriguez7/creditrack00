/* Customer Portal > Profile > About CrediTrack (about), a subpage. 
   Fills the app name, tagline and version from CrediTrackCustomerApi.getAppInfo(), and shows the browser and screen size.
   If the details cannot be read, the page keeps its built-in name and tagline and shows the version as "Not available". */
(function () {
  "use strict";

  var api = window.CrediTrackCustomerApi;
  var $ = function (id) { return document.getElementById(id); };

  if (api && api.getAppInfo) api.getAppInfo().then(function (info) {
    if (info.name) { $("about-name").textContent = info.name; $("app-name").textContent = info.name; }
    if (info.tagline) $("about-tagline").textContent = info.tagline;
    if (info.version) $("app-version").textContent = info.version;
  });

  var ua = navigator.userAgent, browser = "Unknown";
  if (/Edg\//.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  $("sys-browser").textContent = browser;
  function screenSize() { $("sys-screen").textContent = window.innerWidth + " x " + window.innerHeight; }
  screenSize();
  window.addEventListener("resize", screenSize);

})();
