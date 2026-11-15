/* Store Owner > Profile & Settings > Store Information (store-information). Saved to the server (PUT /api/owner/store).
   Shows the store details; Edit swaps the view for a form (store name, store contact number, business type, store hours,
   address) with validation, Save Changes and Cancel. Saves through CrediTrackApi.updateStoreInformation.
   The store code is shown but cannot be edited.
   Below the store details sits the Payment Accounts panel (GCash / Maya / Bank tabs, each with account details and a QR picture),
   saved through CrediTrackApi.savePaymentAccount / removePaymentAccount. */
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

  // ---------- Payment Accounts (GCash / Maya / Bank) ----------
  // One account per method (api.PAYMENT_METHODS), each tab with its own form. A newly chosen QR picture is shrunk in the browser
  // and kept in drafts[method] until Save. Remove QR only marks the saved picture for removal; Save sends it.
  var METHODS = api.PAYMENT_METHODS;
  var LABELS = { gcash: "GCash", maya: "Maya", bank: "Bank" };
  var FIELD_IDS = { accountName: "name", accountNumber: "number", bankName: "bank", qr: "qr" };   // field -> the part used in the element ids
  var QR_SIDE = 600;                         // longest side of the shrunk QR picture, in pixels
  var QR_PICK_MAX_BYTES = 10 * 1024 * 1024;  // a picked file up to 10 MB is shrunk before it is sent
  var QR_TARGET_LENGTH = 400000;             // characters of the data URL we aim for, well under the server's 1,500,000 limit
  var QR_FIND_SIDE = 1600;                   // longest side of the working copy used to look for the QR code inside a bigger picture
  var accounts = {}, drafts = {}, busy = {};

  function fieldsOf(method) { return method === "bank" ? ["accountName", "accountNumber", "bankName"] : ["accountName", "accountNumber"]; }
  function fieldEl(method, field) { return $("pa-" + FIELD_IDS[field] + "-" + method); }
  function setFieldError(method, field, message) {
    var el = fieldEl(method, field), box = $("pa-" + FIELD_IDS[field] + "-" + method + "-error");
    box.textContent = message;
    box.hidden = !message;
    if (message) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  }
  function formValues(method) {
    var values = {};
    fieldsOf(method).forEach(function (field) { values[field] = fieldEl(method, field).value; });
    return values;
  }
  function checkField(method, field) {
    var message = api.validatePaymentAccount(method, formValues(method)).errors[field] || "";
    setFieldError(method, field, message);
    return !message;
  }

  // Preview, Upload / Replace and Remove QR follow what will be saved: the new picture, nothing (marked for removal) or the saved one
  function showQr(method) {
    var draft = drafts[method], saved = (accounts[method] && accounts[method].qrUrl) || "";
    var url = draft.qr || (draft.removeQr ? "" : saved);
    var img = $("pa-qr-img-" + method), note = $("pa-qr-note-" + method);
    if (url) img.src = url; else img.removeAttribute("src");
    img.hidden = !url;
    $("pa-qr-empty-" + method).hidden = !!url;
    $("pa-qr-remove-" + method).hidden = !url;
    $("pa-qr-pick-" + method).textContent = url ? "Replace QR" : "Upload QR";
    var message = draft.qr ? "New QR picture chosen." + (draft.info ? " " + draft.info : "") + " Press Save to keep it." : (draft.removeQr ? "The QR picture will be removed when you press Save." : "");
    note.textContent = message;
    note.hidden = !message;
  }

  // Puts an account (from the server) into its form and resets everything that was typed or chosen
  function fillAccount(method) {
    var account = accounts[method], configured = !!account.configured, status = $("pa-status-" + method);
    drafts[method] = { qr: "", removeQr: false };
    fieldsOf(method).forEach(function (field) {
      fieldEl(method, field).value = account[field] || "";
      setFieldError(method, field, "");
    });
    setFieldError(method, "qr", "");
    status.textContent = configured ? "Set up" : "Not set up yet";
    status.classList.toggle("badge--success", configured);
    status.classList.toggle("badge--warning", !configured);
    $("pa-dot-" + method).hidden = !configured;
    $("pa-remove-" + method).hidden = !configured;
    showQr(method);
  }

  // Disables the buttons of one form while it saves (or removes), so nothing is sent twice
  function setBusy(method, on, what) {
    busy[method] = on;
    $("pa-form-" + method).setAttribute("aria-busy", on ? "true" : "false");
    $("pa-save-" + method).disabled = on;
    $("pa-remove-" + method).disabled = on;
    $("pa-qr-remove-" + method).disabled = on;
    $("pa-qr-" + method).disabled = on;
    $("pa-save-" + method).textContent = on && what !== "remove" ? "Saving\u2026" : "Save";
    $("pa-remove-" + method).textContent = on && what === "remove" ? "Removing\u2026" : "Remove account";
  }

  // ---------- Finding the QR code inside a bigger picture ----------
  // A full phone screenshot (say 1080 x 2400) shrunk to 600 pixels on its longest side leaves the QR code only about 130 pixels wide, which
  // is too small to scan reliably. So the QR code is looked for first and the picture is cropped to it (with its white margin) before it is
  // shrunk, and the shrunk picture keeps the 600 pixel limit. No library: every QR code has three big square "finder" marks in its corners.
  // Along any line through the middle of one, the pixels run dark, light, dark, light, dark in the proportion 1 : 1 : 3 : 1 : 1. Such marks
  // are found by scanning the rows, confirmed by scanning the column through the same spot, and three that form a right-angled triangle
  // give the place and size of the QR code. Picture of just a QR code (no margin at all) or an unusual one: nothing is found, nothing is cropped.
  function looksLikeFinder(c) {
    var module = (c[0] + c[1] + c[2] + c[3] + c[4]) / 7, slack = module / 2;
    return module >= 1 && Math.abs(c[0] - module) < slack && Math.abs(c[1] - module) < slack && Math.abs(c[2] - 3 * module) < 3 * slack &&
      Math.abs(c[3] - module) < slack && Math.abs(c[4] - module) < slack;
  }
  // Returns { x, y, size } (a square, in pixels of the original picture) around the QR code, or null when none was found
  function findQrBox(img, width, height) {
    try {
      var scale = Math.min(1, QR_FIND_SIDE / Math.max(width, height));
      var w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);   // transparent parts count as white, as they are in the saved picture
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      var pixels = ctx.getImageData(0, 0, w, h).data, total = w * h, gray = new Uint8Array(total), histogram = [], i, g;
      for (i = 0; i < 256; i++) histogram.push(0);
      for (i = 0; i < total; i++) { g = (pixels[i * 4] * 299 + pixels[i * 4 + 1] * 587 + pixels[i * 4 + 2] * 114) / 1000 | 0; gray[i] = g; histogram[g]++; }

      // Dark / light split at the level that separates the two groups best (Otsu's method)
      var sumAll = 0, sumBack = 0, weightBack = 0, bestScore = -1, level = 128;
      for (i = 0; i < 256; i++) sumAll += i * histogram[i];
      for (i = 0; i < 256; i++) {
        weightBack += histogram[i];
        if (!weightBack) continue;
        var weightFront = total - weightBack;
        if (!weightFront) break;
        sumBack += i * histogram[i];
        var gap = sumBack / weightBack - (sumAll - sumBack) / weightFront, score = weightBack * weightFront * gap * gap;
        if (score > bestScore) { bestScore = score; level = i; }
      }
      var dark = new Uint8Array(total);
      for (i = 0; i < total; i++) dark[i] = gray[i] <= level ? 1 : 0;

      // The five runs (dark, light, dark, light, dark) of the line through the dark pixel (x, y) in direction (dx, dy), (x, y) being inside
      // the middle run. { counts, middle } where middle is the position of the centre of the middle run along that line; null when the line
      // reaches the edge of the picture before the five runs are complete (a real QR code always has a light margin around it).
      function five(x, y, dx, dy) {
        var counts = [0, 0, 0, 0, 0], run, px = x, py = y, colour, back = 0;
        for (run = 2; run >= 0; run--) {
          colour = run % 2 === 0 ? 1 : 0;
          while (px >= 0 && py >= 0 && px < w && py < h && dark[py * w + px] === colour) { counts[run]++; px -= dx; py -= dy; }
          if (run === 2) back = counts[2];
          if (px < 0 || py < 0 || px >= w || py >= h) return null;
        }
        px = x + dx; py = y + dy;
        for (run = 2; run <= 4; run++) {
          colour = run % 2 === 0 ? 1 : 0;
          while (px >= 0 && py >= 0 && px < w && py < h && dark[py * w + px] === colour) { counts[run]++; px += dx; py += dy; }
          if (px < 0 || py < 0 || px >= w || py >= h) return null;
        }
        return { counts: counts, middle: (dx ? x : y) - (back - 1) + (counts[2] - 1) / 2, length: counts[0] + counts[1] + counts[2] + counts[3] + counts[4] };
      }

      var marks = [];                                        // finder marks found: { x, y, size (module size), hits }
      function addMark(x, y, size) {
        for (var k = 0; k < marks.length; k++) {
          var m = marks[k];
          if (Math.abs(m.x - x) <= m.size && Math.abs(m.y - y) <= m.size && Math.abs(m.size - size) <= m.size * 0.5) {
            m.x = (m.x * m.hits + x) / (m.hits + 1); m.y = (m.y * m.hits + y) / (m.hits + 1); m.size = (m.size * m.hits + size) / (m.hits + 1); m.hits++;
            return;
          }
        }
        marks.push({ x: x, y: y, size: size, hits: 1 });
      }
      var y, x, row, start, run, runs, from, cx, sideways, down, guess;
      for (y = 0; y < h; y++) {
        row = y * w; runs = []; start = 0;
        for (x = 1; x <= w; x++) {                           // the runs of this row: [first x, length, dark?]
          if (x === w || dark[row + x] !== dark[row + start]) { runs.push([start, x - start, dark[row + start]]); start = x; }
        }
        for (run = 2; run + 3 < runs.length; run++) {        // run = the middle (wide) dark run; the first and the last run of a row touch the edge and may be cut
          if (!runs[run][2]) continue;
          from = run - 2;
          if (!runs[from][2] || from === 0) continue;
          if (!looksLikeFinder([runs[from][1], runs[from + 1][1], runs[from + 2][1], runs[from + 3][1], runs[from + 4][1]])) continue;
          cx = Math.round(runs[run][0] + (runs[run][1] - 1) / 2);
          guess = runs[from][1] + runs[from + 1][1] + runs[from + 2][1] + runs[from + 3][1] + runs[from + 4][1];
          down = five(cx, y, 0, 1);                          // the column through the same spot must show the same proportion
          if (!down || !looksLikeFinder(down.counts) || Math.abs(down.length - guess) * 5 >= guess * 2) continue;
          sideways = five(cx, Math.round(down.middle), 1, 0);   // and the row through the true middle, to find the middle more exactly
          if (!sideways || !looksLikeFinder(sideways.counts) || Math.abs(sideways.length - down.length) * 5 >= down.length * 2) continue;
          addMark(sideways.middle, down.middle, (sideways.length + down.length) / 14);
        }
      }

      // The three marks that make the best right-angled triangle (two equal sides, one corner of 90 degrees, same size of module)
      var found = marks.filter(function (m) { return m.hits >= 3; }).sort(function (a, b) { return b.hits - a.hits; }).slice(0, 12);
      var pick = null, bestFit = 1e9, a, b, c, corner, p, q, r, ux, uy, vx, vy, lenU, lenV, fit, module, sizes;
      for (a = 0; a < found.length; a++) for (b = a + 1; b < found.length; b++) for (c = b + 1; c < found.length; c++) {
        sizes = [found[a].size, found[b].size, found[c].size];
        if (Math.max.apply(null, sizes) > Math.min.apply(null, sizes) * 1.6) continue;
        for (corner = 0; corner < 3; corner++) {
          p = [found[a], found[b], found[c]][corner]; q = [found[a], found[b], found[c]][(corner + 1) % 3]; r = [found[a], found[b], found[c]][(corner + 2) % 3];
          ux = q.x - p.x; uy = q.y - p.y; vx = r.x - p.x; vy = r.y - p.y;
          lenU = Math.sqrt(ux * ux + uy * uy); lenV = Math.sqrt(vx * vx + vy * vy);
          module = (sizes[0] + sizes[1] + sizes[2]) / 3;
          if (!lenU || !lenV || lenU < 12 * module || lenU > 190 * module || lenV < 12 * module || lenV > 190 * module) continue;   // QR versions 1 to 40
          fit = Math.abs(lenU / lenV - 1) + Math.abs((ux * vx + uy * vy) / (lenU * lenV));
          if (Math.abs(lenU / lenV - 1) < 0.2 && Math.abs((ux * vx + uy * vy) / (lenU * lenV)) < 0.2 && fit < bestFit) { bestFit = fit; pick = { p: p, q: q, r: r, module: module }; }
        }
      }
      if (!pick) return null;

      // The fourth corner is the one that completes the square. The QR code reaches 3.5 modules past the middle of each mark, its light margin
      // is 4 modules more; 9 modules in all leaves a little room, also when the picture is a bit turned.
      var xs = [pick.p.x, pick.q.x, pick.r.x, pick.q.x + pick.r.x - pick.p.x], ys = [pick.p.y, pick.q.y, pick.r.y, pick.q.y + pick.r.y - pick.p.y];
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      var half = Math.max(maxX - minX, maxY - minY) / 2 + 9 * pick.module, middleX = (minX + maxX) / 2 + 0.5, middleY = (minY + maxY) / 2 + 0.5;
      return { x: Math.round((middleX - half) / scale), y: Math.round((middleY - half) / scale), size: Math.round(half * 2 / scale) };
    } catch (e) { return null; }                             // never stop the upload because the search failed: the picture is just shrunk as it is
  }

  // Reads the picked picture, crops it to the QR code when it can find one, and shrinks it to at most QR_SIDE pixels on its longest side
  // (never enlarged). It is drawn on white, so a transparent PNG still scans. PNG keeps the edges of a QR code sharp; a busy picture that is
  // still big is saved as JPEG instead. Resolves { url, cropped, notFound }: notFound is true when a long, big picture (a screenshot, probably)
  // had to be made much smaller without finding the QR code in it, so the owner can be told it may not scan.
  function shrinkQr(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
          if (!width || !height) { reject(new Error("empty picture")); return; }
          var box = findQrBox(img, width, height);
          var sx = box ? box.x : 0, sy = box ? box.y : 0, sw = box ? box.size : width, sh = box ? box.size : height;   // the part that is kept
          var scale = Math.min(1, QR_SIDE / Math.max(sw, sh));
          var w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
          ctx.imageSmoothingQuality = "high";
          // Only the part that really lies inside the picture is drawn; where a crop reaches past the edge it stays white (the light margin)
          var left = Math.max(0, sx), top = Math.max(0, sy), right = Math.min(width, sx + sw), bottom = Math.min(height, sy + sh);
          ctx.drawImage(img, left, top, right - left, bottom - top, (left - sx) * scale, (top - sy) * scale, (right - left) * scale, (bottom - top) * scale);
          var url = canvas.toDataURL("image/png"), qualities = [0.92, 0.85, 0.75], i = 0;
          while (url.length > QR_TARGET_LENGTH && i < qualities.length) { url = canvas.toDataURL("image/jpeg", qualities[i]); i++; }
          var longSide = Math.max(width, height), shortSide = Math.min(width, height);
          resolve({ url: url, cropped: !!box, notFound: !box && longSide > QR_SIDE * 2 && longSide / shortSide >= 1.25 });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function onQrPicked(method) {
    var input = $("pa-qr-" + method), file = input.files && input.files[0];
    input.value = "";                                    // lets the same file be picked again later
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setFieldError(method, "qr", "Choose a JPG, PNG or WebP picture of your QR code."); return; }
    if (file.size > QR_PICK_MAX_BYTES) { setFieldError(method, "qr", "That picture is too large. Choose one up to 10 MB."); return; }
    shrinkQr(file).then(function (result) {
      var info = result.cropped ? "We cropped it to the QR code." :
        (result.notFound ? "We couldn't find the QR code in it, so it was only made smaller. If this was a full screenshot, crop it to just the QR code or it may not scan." : "");
      drafts[method] = { qr: result.url, removeQr: false, info: info };
      setFieldError(method, "qr", "");
      showQr(method);
      if (result.notFound) toast("We couldn't find the QR code in that picture. Crop it to just the QR code if it won't scan.");
    }).catch(function () { setFieldError(method, "qr", "We couldn't read that picture. Try a different one."); });
  }
  function onQrRemoved(method) {
    setFieldError(method, "qr", "");
    drafts[method] = { qr: "", removeQr: !!(accounts[method] && accounts[method].qrUrl) };   // the saved picture is deleted when Save is pressed
    showQr(method);
    $("pa-qr-" + method).focus();                        // the Remove QR button is hidden now
  }

  function saveAccount(method) {
    if (busy[method]) return;
    var result = api.validatePaymentAccount(method, formValues(method)), first = null;
    fieldsOf(method).forEach(function (field) {
      setFieldError(method, field, result.errors[field] || "");
      if (result.errors[field] && !first) first = field;
    });
    if (first) { fieldEl(method, first).focus(); toast("Please fix the highlighted fields."); return; }

    var draft = drafts[method], body = {
      accountName: result.values.accountName, accountNumber: result.values.accountNumber, bankName: result.values.bankName, removeQr: draft.removeQr
    };
    if (draft.qr) body.qr = draft.qr;                    // not sent = the saved QR is kept
    setBusy(method, true, "save");
    api.savePaymentAccount(method, body).then(function (saved) {
      accounts[method] = saved;
      fillAccount(method);
      toast(LABELS[method] + " account saved.");
    }).catch(function (err) {
      if (err && err.errors) {
        var firstError = null;
        Object.keys(err.errors).forEach(function (field) {
          if (!FIELD_IDS[field] || (field === "bankName" && method !== "bank")) return;
          setFieldError(method, field, err.errors[field]);
          if (!firstError) firstError = field;
        });
        if (firstError) fieldEl(method, firstError).focus();
        toast("Please fix the highlighted fields.");
      } else toast((err && err.message) || "Something went wrong. Please try again.");
    }).then(function () { setBusy(method, false, "save"); });
  }

  function removeAccount(method) {
    if (busy[method]) return;
    if (!window.confirm("Remove your " + LABELS[method] + " account details and QR picture? This can't be undone.")) return;
    setBusy(method, true, "remove");
    api.removePaymentAccount(method).then(function (empty) {
      accounts[method] = empty;
      fillAccount(method);
      toast(LABELS[method] + " account removed.");
      $("pa-name-" + method).focus();                    // the Remove account button is hidden now
    }).catch(function (err) {
      toast((err && err.message) || "Something went wrong. Please try again.");
    }).then(function () { setBusy(method, false, "remove"); });
  }

  // Tabs: only the chosen tab is in the Tab order; the arrow keys, Home and End move between the three tabs
  function selectTab(method, focus) {
    METHODS.forEach(function (m) {
      var on = m === method;
      $("pa-tab-" + m).setAttribute("aria-selected", on ? "true" : "false");
      $("pa-tab-" + m).tabIndex = on ? 0 : -1;
      $("pa-panel-" + m).hidden = !on;
    });
    if (focus) $("pa-tab-" + method).focus();
  }
  $("pa-tablist").addEventListener("keydown", function (event) {
    var current = event.target.getAttribute && event.target.getAttribute("data-method"), index = METHODS.indexOf(current), next = -1;
    if (index === -1) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % METHODS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + METHODS.length - 1) % METHODS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = METHODS.length - 1;
    if (next === -1) return;
    event.preventDefault();
    selectTab(METHODS[next], true);
  });

  METHODS.forEach(function (method) {
    drafts[method] = { qr: "", removeQr: false };
    busy[method] = false;
    $("pa-tab-" + method).addEventListener("click", function () { selectTab(method, false); });
    fieldsOf(method).forEach(function (field) {
      var el = fieldEl(method, field);
      el.addEventListener("blur", function () { if (el.value || el.hasAttribute("aria-invalid")) checkField(method, field); });
      el.addEventListener("input", function () { if (el.hasAttribute("aria-invalid")) checkField(method, field); });
    });
    $("pa-qr-" + method).addEventListener("change", function () { onQrPicked(method); });
    $("pa-qr-remove-" + method).addEventListener("click", function () { onQrRemoved(method); });
    $("pa-form-" + method).addEventListener("submit", function (event) { event.preventDefault(); saveAccount(method); });
    $("pa-remove-" + method).addEventListener("click", function () { removeAccount(method); });
  });

  function loadAccounts() {
    $("pa-loading").hidden = false;
    $("pa-load-error").hidden = true;
    api.getPaymentAccounts().then(function (list) {
      list.forEach(function (account) { accounts[account.method] = account; fillAccount(account.method); });
      $("pa-loading").hidden = true;
      $("pa-body").hidden = false;
    }).catch(function () {
      $("pa-loading").hidden = true;
      $("pa-load-error").hidden = false;
    });
  }
  $("pa-retry").addEventListener("click", loadAccounts);

  api.getOwnerProfile().then(render);
  loadAccounts();
})();
