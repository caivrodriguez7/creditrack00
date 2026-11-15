(function () {
  "use strict";

  var STATE_KEY = "creditrackRegistration";

  function getCurrentStep(form) {
    var activeStep = form.querySelector(".form-step:not([hidden])");
    return activeStep ? Number(activeStep.getAttribute("data-step")) : 1;
  }

  function capture(form) {
    var fields = {};
    form.querySelectorAll("input, select, textarea").forEach(function (input) {
      if (!input.id || input.type === "file") return;
      fields[input.id] = input.type === "checkbox" || input.type === "radio"
        ? input.checked
        : input.value;
    });

    return {
      formId: form.id,
      step: getCurrentStep(form),
      fields: fields
    };
  }

  function showSaveError() {
    var message = "We couldn't preserve your registration details. Please try the policy link again.";
    if (window.CrediTrack && window.CrediTrack.showToast) window.CrediTrack.showToast(message);
    else console.error(message);
  }

  function save(form) {
    try {
      var current = window.history.state;
      var next = current && typeof current === "object" ? Object.assign({}, current) : {};
      next[STATE_KEY] = capture(form);
      window.history.replaceState(next, "", window.location.href);
      return true;
    } catch (error) {
      console.error("Could not save registration state to the current history entry.", error);
      return false;
    }
  }

  function restoreAddress(fields) {
    if (!fields.addrRegion) return;

    var region = document.getElementById("addrRegion");
    var province = document.getElementById("addrProvince");
    var city = document.getElementById("addrCity");
    var barangay = document.getElementById("addrBarangay");
    if (!region || !province || !city || !barangay) return;

    function dispatchChange(select) {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function selectWhenReady(select, value, callback, attempts) {
      if (!value) {
        callback();
        return;
      }
      if (Array.prototype.some.call(select.options, function (option) { return option.value === value; })) {
        select.value = value;
        callback();
        return;
      }
      if (attempts > 0) window.setTimeout(function () {
        selectWhenReady(select, value, callback, attempts - 1);
      }, 50);
    }

    selectWhenReady(region, fields.addrRegion, function () {
      dispatchChange(region);
      selectWhenReady(province, fields.addrProvince, function () {
        if (fields.addrProvince && fields.addrProvince !== "na") dispatchChange(province);
        selectWhenReady(city, fields.addrCity, function () {
          if (fields.addrCity) dispatchChange(city);
          selectWhenReady(barangay, fields.addrBarangay, function () {});
        }, 200);
      }, 200);
    }, 200);
  }

  function restore(form) {
    var state = window.history.state && window.history.state[STATE_KEY];
    if (!state || state.formId !== form.id || !state.fields) return null;

    Object.keys(state.fields).forEach(function (id) {
      var input = document.getElementById(id);
      if (!input || input.type === "file" || /^addr(Region|Province|City|Barangay)$/.test(id)) return;
      if (input.type === "checkbox" || input.type === "radio") input.checked = !!state.fields[id];
      else input.value = state.fields[id];
    });
    restoreAddress(state.fields);
    return state;
  }

  function clear(form) {
    try {
      var current = window.history.state;
      var state = current && current[STATE_KEY];
      if (!state || state.formId !== form.id) return;
      var next = Object.assign({}, current);
      delete next[STATE_KEY];
      window.history.replaceState(Object.keys(next).length ? next : null, "", window.location.href);
    } catch (error) {
      console.error("Could not clear registration state from the current history entry.", error);
    }
  }

  window.CrediTrackRegistrationState = {
    restore: restore,
    clear: clear
  };

  document.querySelectorAll(".reg-form").forEach(function (form) {
    form.querySelectorAll(".consent__label a").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (!save(form)) {
          event.preventDefault();
          showSaveError();
        }
      });
    });

    var cancelLink = document.querySelector(".auth__back");
    if (cancelLink) cancelLink.addEventListener("click", function () { clear(form); });
  });
})();
