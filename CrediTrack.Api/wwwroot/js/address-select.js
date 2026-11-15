/* Cascading Philippine address dropdowns (Region > Province > City/Municipality > Barangay).
   Data comes from the PSGC (Philippine Standard Geographic Code, PSA) via the public
   PSGC API at psgc.gitlab.io. Responses are cached for the session.
   Metro Manila (no provinces) and cities that do not belong to a province are handled:
   - A region with no provinces sets Province to "Not applicable" and lists its cities directly.
   - A region that has provinces AND province-less cities adds a "Cities without a province" option.
   To use your own copy of the data, change PSGC_API below (same URL shape). */
(function () {
  "use strict";

  var PSGC_API = "https://psgc.gitlab.io/api";
  var NONE = "__none__";   // Province option: cities that belong to no province
  var NA = "na";           // Province value when the region has no provinces (e.g. NCR)
  var CACHE_PREFIX = "ct-psgc-v1:";

  var el = {
    region: document.getElementById("addrRegion"),
    province: document.getElementById("addrProvince"),
    city: document.getElementById("addrCity"),
    barangay: document.getElementById("addrBarangay"),
    street: document.getElementById("addrStreet"),
    full: document.getElementById("storeAddress"),
    status: document.getElementById("addr-status"),
    retry: document.getElementById("addr-retry"),
    statusText: document.getElementById("addr-status-text")
  };
  if (!el.region || !el.province || !el.city || !el.barangay) return;

  var memory = {};          // path -> Promise
  var state = { regionCities: [], orphanCities: [] };
  var seq = { region: 0, province: 0, city: 0 };   // ignore stale responses
  var lastAction = null;

  /* ---------- data ---------- */
  function readCache(path) {
    try { var raw = sessionStorage.getItem(CACHE_PREFIX + path); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeCache(path, data) {
    try { sessionStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
  }
  function getList(path) {
    if (memory[path]) return memory[path];
    var cached = readCache(path);
    if (cached) { memory[path] = Promise.resolve(cached); return memory[path]; }
    var p = fetch(PSGC_API + path, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) throw new Error("Unexpected response");
        var list = data.map(function (d) {
          return { code: String(d.code), name: d.name, regionName: d.regionName || "" };
        });
        writeCache(path, list);
        return list;
      });
    memory[path] = p;
    p.catch(function () { delete memory[path]; });
    return p;
  }
  function byName(a, b) { return a.name.localeCompare(b.name, "en", { sensitivity: "base" }); }
  function byCode(a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; }

  // Province part of a PSGC code (9 digits: RRPPMMBBB, 10 digits: RRPPPMMBBB).
  function provincePrefix(code) { return code.slice(0, code.length === 10 ? 5 : 4); }

  /* ---------- UI helpers ---------- */
  function clearValidation(select) {
    select.removeAttribute("aria-invalid");
    select.removeAttribute("data-valid");
    var box = document.getElementById(select.id + "-error");
    if (box) { box.textContent = ""; box.hidden = true; }
  }
  function setOptions(select, placeholder, items, opts) {
    opts = opts || {};
    var frag = document.createDocumentFragment();
    var first = document.createElement("option");
    first.value = ""; first.textContent = placeholder;
    frag.appendChild(first);
    items.forEach(function (it) {
      var o = document.createElement("option");
      o.value = it.code; o.textContent = it.label || it.name;
      frag.appendChild(o);
    });
    if (opts.extra) {
      var g = document.createElement("optgroup");
      g.label = opts.extra.label;
      var o2 = document.createElement("option");
      o2.value = opts.extra.value; o2.textContent = opts.extra.text;
      g.appendChild(o2);
      frag.appendChild(g);
    }
    select.innerHTML = "";
    select.appendChild(frag);
    select.value = "";
    select.disabled = !!opts.disabled;
    clearValidation(select);
  }
  function reset(select, placeholder) { setOptions(select, placeholder, [], { disabled: true }); }
  function loading(select) { setOptions(select, "Loading\u2026", [], { disabled: true }); }

  function showError(retryFn) {
    lastAction = retryFn;
    el.statusText.textContent = "We could not load the location list. Check your internet connection and try again.";
    el.status.hidden = false;
  }
  function hideError() { el.status.hidden = true; lastAction = null; }

  function selectedText(select) {
    var o = select.options[select.selectedIndex];
    return o && select.value ? o.textContent : "";
  }

  function updateFull() {
    var parts = [];
    var street = el.street ? el.street.value.trim() : "";
    if (street) parts.push(street);
    if (el.barangay.value) parts.push("Barangay " + selectedText(el.barangay));
    if (el.city.value) parts.push(selectedText(el.city));
    if (el.province.value && el.province.value !== NA && el.province.value !== NONE) parts.push(selectedText(el.province));
    if (el.region.value) parts.push(selectedText(el.region));
    if (el.full) el.full.value = parts.join(", ");
  }

  /* ---------- loaders (each level) ---------- */
  function loadRegions() {
    var id = ++seq.region;
    loading(el.region);
    getList("/regions/").then(function (list) {
      if (id !== seq.region) return;
      hideError();
      list = list.slice().sort(byCode).map(function (r) {
        var label = r.regionName && r.regionName !== r.name ? r.regionName + " (" + r.name + ")" : r.name;
        return { code: r.code, name: r.name, label: label };
      });
      setOptions(el.region, "Select region", list);
    }).catch(function () {
      if (id !== seq.region) return;
      setOptions(el.region, "Could not load regions", [], { disabled: true });
      showError(loadRegions);
    });
  }

  function onRegionChange() {
    var code = el.region.value;
    ++seq.province; ++seq.city;
    state.regionCities = []; state.orphanCities = [];
    reset(el.city, "Select province first");
    reset(el.barangay, "Select city or municipality first");
    if (!code) { reset(el.province, "Select region first"); updateFull(); return; }

    var id = seq.province;
    loading(el.province);
    Promise.all([
      getList("/regions/" + code + "/provinces/"),
      getList("/regions/" + code + "/cities-municipalities/")
    ]).then(function (res) {
      if (id !== seq.province) return;
      hideError();
      var provinces = res[0].slice().sort(byName);
      var cities = res[1].slice().sort(byName);
      state.regionCities = cities;

      if (!provinces.length) {
        // Region with no provinces (e.g. National Capital Region): cities sit directly under the region.
        setOptions(el.province, "Not applicable", [{ code: NA, name: "Not applicable (no province)" }], { disabled: true });
        setOptions(el.city, "Select city or municipality", cities);
        el.province.value = NA;
        el.province.setAttribute("data-valid", "true");
        updateFull();
        return;
      }
      var prefixes = {};
      provinces.forEach(function (p) { prefixes[provincePrefix(p.code)] = true; });
      state.orphanCities = cities.filter(function (c) { return !prefixes[provincePrefix(c.code)]; });
      setOptions(el.province, "Select province", provinces,
        state.orphanCities.length ? { extra: { label: "Not in any province", value: NONE, text: "Cities without a province" } } : null);
      reset(el.city, "Select province first");
      updateFull();
    }).catch(function () {
      if (id !== seq.province) return;
      setOptions(el.province, "Could not load provinces", [], { disabled: true });
      showError(onRegionChange);
    });
  }

  function onProvinceChange() {
    var code = el.province.value;
    ++seq.city;
    reset(el.barangay, "Select city or municipality first");
    if (!code) { reset(el.city, "Select province first"); updateFull(); return; }
    if (code === NONE) {
      setOptions(el.city, "Select city or municipality", state.orphanCities);
      updateFull();
      return;
    }
    var id = seq.city;
    loading(el.city);
    getList("/provinces/" + code + "/cities-municipalities/").then(function (list) {
      if (id !== seq.city) return;
      hideError();
      setOptions(el.city, "Select city or municipality", list.slice().sort(byName));
      updateFull();
    }).catch(function () {
      if (id !== seq.city) return;
      setOptions(el.city, "Could not load cities", [], { disabled: true });
      showError(onProvinceChange);
    });
  }

  function onCityChange() {
    var code = el.city.value;
    var id = ++seq.city;
    if (!code) { reset(el.barangay, "Select city or municipality first"); updateFull(); return; }
    loading(el.barangay);
    getList("/cities-municipalities/" + code + "/barangays/").then(function (list) {
      if (list.length) return list;
      // Some cities (e.g. City of Manila) list barangays under sub-municipalities (districts).
      return getList("/cities-municipalities/" + code + "/sub-municipalities/").then(function (subs) {
        return Promise.all(subs.map(function (s) { return getList("/sub-municipalities/" + s.code + "/barangays/"); }))
          .then(function (groups) { return [].concat.apply([], groups); });
      }).catch(function () { return []; });
    }).then(function (list) {
      if (id !== seq.city) return;
      hideError();
      if (!list.length) { setOptions(el.barangay, "No barangays found", [], { disabled: true }); return; }
      setOptions(el.barangay, "Select barangay", list.slice().sort(byName));
      updateFull();
    }).catch(function () {
      if (id !== seq.city) return;
      setOptions(el.barangay, "Could not load barangays", [], { disabled: true });
      showError(onCityChange);
    });
  }

  /* ---------- wiring ---------- */
  el.region.addEventListener("change", onRegionChange);
  el.province.addEventListener("change", onProvinceChange);
  el.city.addEventListener("change", onCityChange);
  el.barangay.addEventListener("change", updateFull);
  if (el.street) el.street.addEventListener("input", updateFull);
  if (el.retry) el.retry.addEventListener("click", function () { var fn = lastAction; hideError(); if (fn) fn(); });

  function pick(select, nullable) {
    if (!select.value || (nullable && (select.value === NA || select.value === NONE))) return null;
    return { code: select.value, name: selectedText(select) };
  }
  // Waits until a dropdown (filled from the PSGC list) offers the wanted value, then picks it.
  function waitAndSelect(select, value, timeoutMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      (function poll() {
        var found = !select.disabled && Array.prototype.some.call(select.options, function (o) { return o.value === value; });
        if (found) { select.value = value; resolve(true); return; }
        if (Date.now() - started > timeoutMs) { resolve(false); return; }
        setTimeout(poll, 40);
      })();
    });
  }
  // Puts a saved address back, level by level (each level loads the next one's list).
  // codes: { region, province, city, barangay } as the dropdown values. Resolves when done or when a level cannot be restored.
  function restore(codes) {
    codes = codes || {};
    var wait = 8000;
    return waitAndSelect(el.region, codes.region || "", wait).then(function (ok) {
      if (!ok) return false;
      onRegionChange();
      // A region without provinces fills the Province box with "Not applicable" by itself.
      var provinceStep = codes.province && codes.province !== NA
        ? waitAndSelect(el.province, codes.province, wait).then(function (okP) { if (okP) onProvinceChange(); return okP; })
        : waitAndSelect(el.city, codes.city || "", wait).then(function (okC) { if (okC) onCityChange(); return "city-done:" + okC; });
      return provinceStep;
    }).then(function (prev) {
      if (prev === false) return false;
      if (typeof prev === "string") return prev === "city-done:true";
      return waitAndSelect(el.city, codes.city || "", wait).then(function (okC) { if (okC) onCityChange(); return okC; });
    }).then(function (okCity) {
      if (!okCity || !codes.barangay) return false;
      return waitAndSelect(el.barangay, codes.barangay, wait);
    }).then(function () { updateFull(); });
  }

  window.CrediTrack = window.CrediTrack || {};
  window.CrediTrack.address = {
    restore: restore,
    getValue: function () {
      updateFull();
      return {
        region: pick(el.region), province: pick(el.province, true), city: pick(el.city),
        barangay: pick(el.barangay), street: el.street ? el.street.value.trim() : "",
        full: el.full ? el.full.value : ""
      };
    }
  };

  reset(el.province, "Select region first");
  reset(el.city, "Select province first");
  reset(el.barangay, "Select city or municipality first");
  loadRegions();
})();
