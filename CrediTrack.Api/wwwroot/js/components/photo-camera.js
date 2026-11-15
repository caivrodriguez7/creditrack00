/* "Take Photo" for the Edit Profile pages (Store Owner and Customer).
   Adds a button next to "Change Photo". It opens the camera in a small dialog (live preview, Capture, Switch camera) and hands the
   captured picture to the same file input that "Change Photo" uses, so the page's own code checks, crops, shrinks and saves it.
   Where the live camera cannot be opened (no camera API, or the page is not on https / localhost) it falls back to the phone's
   camera app (an input with capture="user"). Nothing is uploaded until Save Changes. */
(function () {
  "use strict";
  var input = document.getElementById("ef-photo");
  var actions = document.querySelector(".st-photo__actions");
  if (!input || !actions) return;

  var liveCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

  // Gives a File to the page's own photo input, as if it had been picked from the device
  function handOver(file) {
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { /* very old browser: the normal Change Photo still works */ }
  }

  var button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--secondary st-photo__btn";
  button.id = "ef-photo-camera";
  button.textContent = "Take Photo";
  var remove = document.getElementById("ef-photo-remove");
  actions.insertBefore(button, remove || null);

  // Fallback: the phone's camera app
  var capture = document.createElement("input");
  capture.type = "file"; capture.accept = "image/*"; capture.setAttribute("capture", "user");
  capture.className = "visually-hidden"; capture.tabIndex = -1; capture.setAttribute("aria-hidden", "true");
  actions.appendChild(capture);
  capture.addEventListener("change", function () {
    var file = capture.files && capture.files[0];
    capture.value = "";
    if (file) handOver(file);
  });

  if (!liveCamera) {
    button.addEventListener("click", function () { capture.click(); });
    return;
  }

  // ---- Live camera dialog ----
  var dialog = document.createElement("dialog");
  dialog.className = "st-dialog pc-dialog";
  dialog.setAttribute("aria-labelledby", "pc-title");
  dialog.innerHTML =
    '<div class="st-dialog__body">' +
      '<h2 class="st-dialog__title" id="pc-title">Take a photo</h2>' +
      '<div class="pc-stage"><video class="pc-video" autoplay playsinline muted></video></div>' +
      '<p class="field__error pc-error" role="alert" hidden></p>' +
      '<button class="btn btn--ghost pc-switch" type="button" hidden>Switch camera</button>' +
    '</div>' +
    '<div class="st-dialog__actions">' +
      '<button class="btn btn--secondary pc-cancel" type="button">Cancel</button>' +
      '<button class="btn btn--primary pc-snap" type="button">Capture</button>' +
    '</div>';
  document.body.appendChild(dialog);

  var video = dialog.querySelector(".pc-video"), errorBox = dialog.querySelector(".pc-error");
  var snap = dialog.querySelector(".pc-snap"), cancel = dialog.querySelector(".pc-cancel"), switcher = dialog.querySelector(".pc-switch");
  var stream = null, facing = "user";

  function stop() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    video.srcObject = null;
  }
  function showError(message) { errorBox.textContent = message; errorBox.hidden = !message; snap.disabled = !!message; }

  function start() {
    stop(); showError("");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then(function (s) {
        if (!dialog.open) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        video.classList.toggle("pc-video--mirror", facing === "user");   // a selfie preview is mirrored, like a mirror
        return navigator.mediaDevices.enumerateDevices().then(function (list) {
          switcher.hidden = list.filter(function (d) { return d.kind === "videoinput"; }).length < 2;
        });
      })
      .catch(function (err) {
        var name = err && err.name;
        if (name === "NotAllowedError" || name === "SecurityError") showError("Camera access is blocked. Allow the camera in your browser settings, or use Change Photo instead.");
        else if (name === "NotFoundError" || name === "OverconstrainedError") showError("No camera was found on this device. Use Change Photo instead.");
        else showError("The camera could not be opened. Use Change Photo instead.");
      });
  }

  button.addEventListener("click", function () {
    dialog.showModal();
    start();
  });
  switcher.addEventListener("click", function () { facing = facing === "user" ? "environment" : "user"; start(); });
  cancel.addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("close", function () { stop(); button.focus(); });

  snap.addEventListener("click", function () {
    if (!video.videoWidth) return;
    var canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(function (blob) {
      dialog.close();
      if (blob) handOver(new File([blob], "camera-photo.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  });
})();
