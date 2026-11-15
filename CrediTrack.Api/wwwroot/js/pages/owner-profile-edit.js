/* Store Owner > Profile & Settings > Edit Profile (profile-edit). Mock data only, no backend.
   Edits the photo, full name, email and contact number. Save Changes validates (js/api/owner-api.js, validateOwnerProfile),
   saves through CrediTrackApi.updateOwnerProfile and returns to the Profile page, which shows a "Profile updated." message.
   Cancel (or Back) leaves without saving. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var FIELDS = ["fullName", "email", "contactNumber"];
  var PHONE_FIELDS = ["contactNumber"];
  var profile = null;      // the saved profile, as last loaded
  var saving = false;
  var photo = "";          // the photo shown in the form ("" = none); saved only with Save Changes
  var PHOTO_MAX_BYTES = 5 * 1024 * 1024, PHOTO_SIZE = 256;   // picked files up to 5 MB are shrunk to 256 px for storage

  var form = $("profile-form"), saveBtn = $("edit-save");

  function initials(name) {   // same rule as the header avatar (js/components/owner-shell.js)
    return String(name || "").split(" ").map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("");
  }
  // Shows the photo inside an avatar circle, or the initials when there is no photo.
  function paintAvatar(el, url, name, fallback) {
    el.textContent = "";
    if (url) {
      var img = document.createElement("img");
      img.src = url; img.alt = "";
      el.appendChild(img);
    } else el.textContent = initials(name) || fallback;
  }
  function setValue(id, value, format) {
    var el = $(id), has = !!value;
    el.textContent = has ? (format ? format(value) : value) : "Not added yet";
    el.classList.toggle("is-empty", !has);
  }
  // The header (store name and initials) is filled by owner-shell.js: keep it in step. (Subpages have no header, so this does nothing there.)

  // ---- Field errors ----
  function input(name) { return $("ef-" + name); }
  function setError(name, message) {
    var el = input(name), box = $("ef-" + name + "-error");
    box.textContent = message;
    box.hidden = !message;
    if (message) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  }
  function currentValues() {
    var values = {};
    FIELDS.forEach(function (name) { values[name] = input(name).value; });
    return values;
  }
  function checkField(name) {
    var message = api.validateOwnerProfile(currentValues(), FIELDS).errors[name] || "";
    setError(name, message);
    return !message;
  }
  // Checks everything, shows every error and focuses the first invalid field.
  function checkAll() {
    var result = api.validateOwnerProfile(currentValues(), FIELDS);
    var first = null;
    FIELDS.forEach(function (name) {
      setError(name, result.errors[name] || "");
      if (result.errors[name] && !first) first = name;
    });
    if (first) input(first).focus();
    return result;
  }

  // ---- Profile photo ----
  var photoInput = $("ef-photo"), photoRemove = $("ef-photo-remove");
  function setPhotoError(message) { $("ef-photo-error").textContent = message; $("ef-photo-error").hidden = !message; }
  function showPhoto(url) {
    photo = url;
    paintAvatar($("ef-photo-preview"), url, input("fullName").value, "SO");
    photoRemove.hidden = !url;
  }
  // Reads the picked image, crops it to a centered square and shrinks it, so it fits comfortably in browser storage.
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var side = Math.min(img.width, img.height), canvas = document.createElement("canvas");
          canvas.width = canvas.height = PHOTO_SIZE;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  photoInput.addEventListener("change", function () {
    var file = photoInput.files && photoInput.files[0];
    photoInput.value = "";                               // lets the same file be picked again later
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setPhotoError("Choose a JPG, PNG or WebP image."); return; }
    if (file.size > PHOTO_MAX_BYTES) { setPhotoError("That image is too large. Choose one up to 5 MB."); return; }
    shrinkImage(file).then(function (url) { setPhotoError(""); showPhoto(url); })
      .catch(function () { setPhotoError("We couldn't read that image. Try a different one."); });
  });
  photoRemove.addEventListener("click", function () { setPhotoError(""); showPhoto(""); $("ef-photo").focus(); });
  input("fullName").addEventListener("input", function () { if (!photo) showPhoto(""); });   // initials follow the name



  // ---- Current password: asked only when the email address is being changed ----
  // A new email is not switched at once: the server sends a confirmation link to it and the old email keeps working until then.
  function emailChanged() {
    return !!profile && String(input("email").value || "").trim().toLowerCase() !== String(profile.email || "").trim().toLowerCase();
  }
  function syncPasswordField() {
    var show = emailChanged(), box = $("ef-currentPassword-field");
    box.hidden = !show;
    box.style.display = show ? "" : "none";      // .field is display:grid, which would otherwise ignore [hidden]
    if (!show) { $("ef-currentPassword").value = ""; setError("currentPassword", ""); }
  }
  input("email").addEventListener("input", syncPasswordField);
  $("ef-currentPassword").addEventListener("input", function () { setError("currentPassword", ""); });
  function savedMessage(saved) {
    if (saved && saved.emailChangePending) {
      return saved.pendingEmailSent === false
        ? "Profile updated, but we could not send the confirmation email. Try changing your email again later."
        : "Profile updated. We sent a confirmation link to your new email. Your current email stays active until you confirm it.";
    }
    return "Profile updated.";
  }

  // ---- Fill the form with the saved values ----
  function fill(p) {
    profile = p;
    $("ef-currentPassword").value = "";
    syncPasswordField();
    FIELDS.forEach(function (name) {
      var value = p[name] || "";
      input(name).value = PHONE_FIELDS.indexOf(name) !== -1 ? api.formatPhone(value) : value;
      setError(name, "");
    });
    setPhotoError("");
    showPhoto(p.photo || "");
  }

  function leave(message) {
    if (message) { try { window.sessionStorage.setItem("creditrack.flash", message); } catch (e) { /* ignore */ } }
    window.CrediTrack.goBack("settings");
  }
  function unchanged(values) {
    var before = api.validateOwnerProfile(profile, FIELDS).values;   // the saved profile, cleaned the same way
    return photo === (profile.photo || "") && FIELDS.every(function (name) { return before[name] === values[name]; });
  }

  $("edit-cancel").addEventListener("click", function () {   // nothing is saved
    // Unsaved edits: ask before throwing them away
    if (profile && !unchanged(api.validateOwnerProfile(currentValues(), FIELDS).values) && !window.confirm("Discard your changes?")) return;
    leave("");
  });

  FIELDS.forEach(function (name) {
    var el = input(name);
    // Check when leaving a field; after an error, re-check as the person types.
    el.addEventListener("blur", function () {
      if (el.value || el.hasAttribute("aria-invalid")) checkField(name);
      if (PHONE_FIELDS.indexOf(name) !== -1) { var ok = api.parsePhone(el.value); if (ok) el.value = api.formatPhone(ok); }
    });
    el.addEventListener("input", function () { if (el.hasAttribute("aria-invalid")) checkField(name); });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (saving || !profile) return;
    var result = checkAll();
    if (!result.valid) { toast("Please fix the highlighted fields."); return; }
    if (unchanged(result.values)) { leave("No changes to save."); return; }

    var password = $("ef-currentPassword").value;
    if (emailChanged() && !password) {
      setError("currentPassword", "Enter your current password to change your email address.");
      $("ef-currentPassword").focus();
      toast("Please fix the highlighted fields.");
      return;
    }

    saving = true; saveBtn.disabled = true; saveBtn.textContent = "Saving\u2026";
    api.updateOwnerProfile(Object.assign({}, result.values, { photo: photo, currentPassword: password })).then(function (saved) {
      leave(savedMessage(saved));
    }).catch(function (err) {
      if (err && err.errors) {                          // the data layer found a problem the form did not
        var first = null;
        Object.keys(err.errors).forEach(function (name) { if (FIELDS.indexOf(name) !== -1 || name === "currentPassword") { setError(name, err.errors[name]); if (!first) first = name; } });
        if (first) input(first).focus();
        toast("Please fix the highlighted fields.");
      } else toast("Something went wrong. Please try again.");
      saving = false; saveBtn.disabled = false; saveBtn.textContent = "Save Changes";
    });
  });

  api.getOwnerProfile().then(fill);
})();
