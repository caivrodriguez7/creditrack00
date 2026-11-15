/* Store Owner > Profile & Settings > Store Information (store-information). Saved to the server (PUT /api/owner/store).
   Shows the store details; Edit swaps the view for a form (store name, store contact number, business type, store hours,
   address) with validation, Save Changes and Cancel. Saves through CrediTrackApi.updateStoreInformation.
   The store code is shown but cannot be edited. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  if (!api) return;
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (message) { window.CrediTrack.showToast(message); };

  var FIELDS = ["storeName", "storePhone", "businessType", "storeHours", "storeAddress"];
  var PHONE_FIELDS = ["storePhone"];
  var profile = null, saving = false;
  var form = $("store-form"), view = $("store-view"), openBtn = $("store-edit-open"), saveBtn = $("store-save");

  function setValue(id, value, format) {
    var el = $(id), has = !!value;
    el.textContent = has ? (format ? format(value) : value) : "Not added yet";
    el.classList.toggle("is-empty", !has);
  }
  function render(p) {
    profile = p;
    setValue("pf-storeName", p.storeName);
    setValue("pf-storePhone", p.storePhone, api.formatPhone);
    setValue("pf-businessType", p.businessType);
    setValue("pf-storeHours", p.storeHours);
    setValue("pf-storeAddress", p.storeAddress);
    setValue("pf-storeCode", p.storeCode);
    $("sf-code").textContent = p.storeCode || "";
  }

  // Business types come from the data layer
  api.BUSINESS_TYPES.forEach(function (type) {
    var option = document.createElement("option");
    option.value = type; option.textContent = type;
    $("sf-businessType").appendChild(option);
  });

  function input(name) { return $("sf-" + name); }
  function setError(name, message) {
    var el = input(name), box = $("sf-" + name + "-error");
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
  function checkAll() {
    var result = api.validateOwnerProfile(currentValues(), FIELDS), first = null;
    FIELDS.forEach(function (name) {
      setError(name, result.errors[name] || "");
      if (result.errors[name] && !first) first = name;
    });
    if (first) input(first).focus();
    return result;
  }

  function openEdit() {
    FIELDS.forEach(function (name) {
      var value = profile[name] || "";
      input(name).value = PHONE_FIELDS.indexOf(name) !== -1 ? api.formatPhone(value) : value;
      setError(name, "");
    });
    view.hidden = true;
    form.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    input("storeName").focus();
  }
  function closeEdit() {
    form.hidden = true;
    view.hidden = false;
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function unchanged(values) {
    var before = api.validateOwnerProfile(profile, FIELDS).values;
    return FIELDS.every(function (name) { return before[name] === values[name]; });
  }

  openBtn.addEventListener("click", openEdit);
  $("store-cancel").addEventListener("click", closeEdit);   // nothing is saved

  FIELDS.forEach(function (name) {
    var el = input(name);
    el.addEventListener("blur", function () {
      if (el.value || el.hasAttribute("aria-invalid")) checkField(name);
      if (PHONE_FIELDS.indexOf(name) !== -1) { var ok = api.parsePhone(el.value); if (ok) el.value = api.formatPhone(ok); }
    });
    el.addEventListener(name === "businessType" ? "change" : "input", function () { if (el.hasAttribute("aria-invalid")) checkField(name); });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (saving || !profile) return;
    var result = checkAll();
    if (!result.valid) { toast("Please fix the highlighted fields."); return; }
    if (unchanged(result.values)) { closeEdit(); toast("No changes to save."); return; }

    saving = true; saveBtn.disabled = true;
    api.updateStoreInformation(result.values).then(function (saved) {
      render(saved);
      closeEdit();
      toast("Store information updated.");
    }).catch(function (err) {
      if (err && err.errors) {
        var first = null;
        Object.keys(err.errors).forEach(function (name) { if (FIELDS.indexOf(name) !== -1) { setError(name, err.errors[name]); if (!first) first = name; } });
        if (first) input(first).focus();
        toast("Please fix the highlighted fields.");
      } else toast("Something went wrong. Please try again.");
    }).then(function () { saving = false; saveBtn.disabled = false; });
  });

  api.getOwnerProfile().then(render);
})();
