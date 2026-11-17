/* Make a Payment as a floating modal (Customer Portal). Same idea as Record Utang / Record Bayad on the Store Owner side:
   it opens centered above the current page, the page behind it is blurred, and the navigation stays hidden.
   The form itself is the page /customer/request-payment (js/pages/customer-request-payment.js). It is shown inside this
   modal with "?modal=1", so the form, review and success screens are not written twice.
   Opened by js/main.js: goTo("customer-payment?store=3") calls window.MakePayment.open({ store: "3" }).
   The page inside talks back with postMessage: "close", "submitted" (a request was sent) and "navigate" (go to another page). */
(function () {
  "use strict";

  var root = null, frame = null, opener = null, submitted = false;

  function build() {
    root = document.createElement("div");
    root.className = "mp";
    root.hidden = true;
    root.innerHTML =
      '<div class="mp__backdrop" data-mp-close></div>' +
      '<div class="mp__dialog" role="dialog" aria-modal="true" aria-label="Make a Payment"></div>';
    document.body.appendChild(root);
    root.querySelector("[data-mp-close]").addEventListener("click", close);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !root.hidden) close();
    });
    // Messages from the page inside the modal (same site only)
    window.addEventListener("message", function (event) {
      if (event.origin !== window.location.origin || !frame || event.source !== frame.contentWindow) return;
      var msg = event.data || {};
      if (msg.type === "close") close();
      else if (msg.type === "submitted") submitted = true;
      else if (msg.type === "navigate" && msg.route) { close(true); window.CrediTrack.goTo(msg.route); }
    });
  }

  function open(options) {
    options = options || {};
    if (!root) build();
    opener = document.activeElement;
    submitted = false;
    var query = "modal=1" + (options.store ? "&store=" + encodeURIComponent(options.store) : "");
    var dialog = root.querySelector(".mp__dialog");
    dialog.innerHTML = "";
    frame = document.createElement("iframe");
    frame.className = "mp__frame";
    frame.title = "Make a Payment";
    frame.setAttribute("allow", "camera");   // the proof-of-payment photo uses the camera
    frame.src = "/customer/request-payment?" + query;
    dialog.appendChild(frame);
    root.hidden = false;
    document.documentElement.classList.add("mp-lock");
    frame.addEventListener("load", function () { try { frame.contentWindow.focus(); } catch (e) { /* ignore */ } });
  }

  // Closes the modal. After a request was sent the page behind is reloaded so it shows the new request.
  function close(skipReload) {
    if (!root || root.hidden) return;
    root.hidden = true;
    root.querySelector(".mp__dialog").innerHTML = "";
    frame = null;
    document.documentElement.classList.remove("mp-lock");
    if (opener && document.body.contains(opener)) opener.focus();
    if (submitted && skipReload !== true) window.location.reload();
  }

  window.MakePayment = { open: open, close: close };
})();
