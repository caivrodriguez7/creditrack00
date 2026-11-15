/* CrediTrack: Customer data layer. Real accounts use the API; the demo account and sample data stay in this browser.
   Same idea as js/api/owner-api.js: pages never read storage themselves, they call these functions,
   so only this file changes when the ASP.NET Core API exists.

   Two things are kept apart:
   - RECORDS  (stores the customer has joined, and their activity): a new customer has none, so the
              dashboard shows the "No Store Joined" state. The join flow (a later step) will save here.
   - SAMPLE   fictional data shown only while "Preview sample data" is on. Labelled "Sample" on screen,
              never saved as records, and thrown away when the customer logs out of the preview.

   A store's balance is never stored: it is always totalCredit - totalPaid, so it can never disagree
   with the credits and payments that make it up. */
(function () {
  "use strict";

  var KEY_RECORDS = "creditrack.customer.records"; // { stores: [], activity: [] }   (localStorage)
  var KEY_DEMO = "creditrack.customer.demo";       // "1" = sample preview, "login" = signed in with the demo customer account (localStorage)
  var KEY_DEMO_JOINED = "creditrack.customer.demo.joined"; // stores joined while sample data / the demo account is on (thrown away with the demo)
  var KEY_PROFILE = "creditrack.customer.profile";       // { fullName, email, contactNumber, customerCode, photo } from sign-up and Edit Profile (never the password)
  var KEY_DEMO_PROFILE = "creditrack.customer.demo.profile"; // temporary Edit Profile changes made while signed in with the demo account (thrown away on log out)
  var KEY_SETTINGS = "creditrack.customer.settings";         // { notifications: {...}, notificationsUpdatedAt } saved from Profile > Notifications (localStorage)
  var KEY_DEMO_SETTINGS = "creditrack.customer.demo.settings"; // the demo account's notification choices (temporary: thrown away on log out, like its other edits)
  var KEY_OWNER = "creditrack.owner";                    // the Store Owner's sign-up profile (read only: lets a customer find a real store)
  var KEY_OWNER_RECORDS = "creditrack.records";          // the Store Owner's customers and transactions (read only)
  var DEMO_EMAIL = "democustomer@creditrack.test";
  var DEMO_NAME = "Demo Customer";

  // localStorage can be blocked (private windows), so fall back to memory.
  var memory = {};
  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return memory[key] || null; }
  }
  function write(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value);
    } catch (e) { memory[key] = value; }
  }
  function readJson(key, fallback) {
    try { return JSON.parse(read(key)) || fallback; } catch (e) { return fallback; }
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  // "YYYY-MM-DD" for n days from today (local calendar day). Only used for the demo credits' due dates.
  function dayFromNow(n) {
    var d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function minutesAgo(n) { return new Date(Date.now() - n * 60000).toISOString(); }
  function daysAgo(n, hour, minute) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, minute || 0, 0, 0);
    return d.toISOString();
  }

  // ---- The signed-in customer ----
  function getCustomer() {
    var session = window.CrediTrackSession && window.CrediTrackSession.get();
    var fullName = session && session.role === "customer" ? session.name : "";
    var firstName = fullName ? fullName.split(/\s+/)[0] : "";
    return Promise.resolve({ fullName: fullName, firstName: firstName });
  }

  // Customer account details shown when joining a store. Sign-up saves them (saveProfile); the demo account has fixed ones.
  var DEMO_PROFILE = { fullName: "Demo Customer", email: DEMO_EMAIL, contactNumber: "09171234567", customerCode: "CT-CUS-000123" };
  function saveProfile(details) {
        var code = details.customerCode || ("CT-CUS-" + ("000000" + Math.floor(Math.random() * 900000 + 100000)).slice(-6));
    write(KEY_PROFILE, JSON.stringify({
      fullName: String(details.fullName || "").trim(), email: String(details.email || "").trim(),
      contactNumber: String(details.contactNumber || "").trim(), customerCode: code
    }));
  }
  // The profile photo is stored as a small data URL (the Edit Profile page shrinks it first). "" means no photo.
  function cleanPhoto(v) { return typeof v === "string" && /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+|\/api\/files\/profiles\/[0-9a-f]{32}\.(jpg|png|webp))$/.test(v) ? v : ""; }   // a new picture (data URL) or the saved one (its /api/files URL)

  // -> { fullName, email, contactNumber, customerCode, photo, isDemo }   (missing details come back as "")
  // The demo account has fixed details; its Edit Profile changes are layered on top and are temporary (KEY_DEMO_PROFILE).
  function getProfile() {
    var session = window.CrediTrackSession && window.CrediTrackSession.get();
    if (isDemoLogin()) {
      var edits = readJson(KEY_DEMO_PROFILE, {});
      var demo = Object.assign({ photo: "" }, DEMO_PROFILE, edits);
      demo.photo = cleanPhoto(demo.photo);
      demo.isDemo = true;
      return Promise.resolve(demo);
    }
    var p = readJson(KEY_PROFILE, null) || {};
    var name = (session && session.role === "customer" && session.name) || p.fullName || "";
    var fallback = { fullName: name, email: p.email || "", contactNumber: p.contactNumber || "", customerCode: "", photo: cleanPhoto(p.photo), isDemo: false };
    if (!window.CrediTrackHttp) return Promise.resolve(fallback);
    // Real account: the name, email, contact number and Customer Code come from the server (GET /auth/me). The Customer Code
    // is made by the server and is what the store owner types to link this account, so it is never made up in the browser.
    // The photo comes from the server too (GET /auth/me), so the store owner can see it. A photo that an earlier version kept only in
    // this browser is uploaded once, the first time the profile is read, and then removed from the browser.
    return window.CrediTrackHttp("/auth/me").then(function (me) {
      var rec = readJson(KEY_PROFILE, null) || {};
      rec.fullName = me.fullName || ""; rec.email = me.email || ""; rec.contactNumber = me.contactNumber || ""; rec.customerCode = me.customerCode || "";
      var serverPhoto = cleanPhoto(me.photo), localPhoto = cleanPhoto(rec.photo);
      delete rec.photo;                                   // the server is the only copy now
      write(KEY_PROFILE, JSON.stringify(rec));
      var result = { fullName: rec.fullName || name, email: rec.email, contactNumber: rec.contactNumber, customerCode: rec.customerCode, photo: serverPhoto, isDemo: false };
      if (serverPhoto || !localPhoto) return result;
      result.photo = localPhoto;                          // show it now; upload it in the background
      window.CrediTrackHttp("/account/profile", {
        method: "PUT", body: { fullName: rec.fullName, email: rec.email, contactNumber: rec.contactNumber, photo: localPhoto }
      }).catch(function () {
        var again = readJson(KEY_PROFILE, null) || {};    // the upload failed: keep it here and try again next time
        again.photo = localPhoto; write(KEY_PROFILE, JSON.stringify(again));
      });
      return result;
    }, function () { return fallback; });
  }

  // =====================  Customer Code & QR (mock data only)  =====================
  // The Customer Code (CT-CUS-000123) identifies the customer's CrediTrack ACCOUNT. It is NOT a Store Code (STR-001 / CT-AB12CD,
  // which identifies a store), NOT a store's own record number (CUS-014), and NOT the Store Owner's temporary linking code (XXXX-XXXX,
  // QR text CREDITRACK:LINK:<code>). The personal QR holds CREDITRACK:CUSTOMER:<customer code>, so the QR and the code always
  // name the same customer. Profile and the Customer Code & QR page both read this one function.
  var CUSTOMER_ACCOUNT_CODE = /^CT-CUS-\d{6}$/;
  var CUSTOMER_QR_PREFIX = "CREDITRACK:CUSTOMER:";
  function customerQrText(code) { return CUSTOMER_QR_PREFIX + code; }
  // Reads a personal QR text or a typed code back to the Customer Code, or "" when it is not one (a store QR or linking QR gives "").
  function parseCustomerCode(input) {
    var v = String(input || "").trim().toUpperCase().replace(/\s+/g, "");
    if (v.indexOf(CUSTOMER_QR_PREFIX) === 0) v = v.slice(CUSTOMER_QR_PREFIX.length);
    return CUSTOMER_ACCOUNT_CODE.test(v) ? v : "";
  }
  // -> { fullName, customerCode, qrText, isDemo, available }   (available = false when the account has no valid code yet)
  function getCustomerIdentity() {
    return getProfile().then(function (p) {
      var code = parseCustomerCode(p.customerCode);
      return { fullName: p.fullName, customerCode: code, qrText: code ? customerQrText(code) : "", isDemo: p.isDemo, available: !!code };
    });
  }

  // =====================  Edit Profile  =====================
  // Same rules as the Store Owner's Edit Profile (js/api/owner-api.js, validateOwnerProfile) so both roles behave alike.
  // Accepts 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes allowed). Returns "09XXXXXXXXX" or null.
  function parsePhone(raw) {
    var v = String(raw || "").replace(/[\s-]/g, "");
    if (/^\+639\d{9}$/.test(v)) v = "0" + v.slice(3);
    return /^09\d{9}$/.test(v) ? v : null;
  }
  // "09171234567" or "+639171234567" -> "0917 123 4567" (anything else is returned as typed)
  function formatPhone(raw) { var n = parsePhone(raw); return n ? n.slice(0, 4) + " " + n.slice(4, 7) + " " + n.slice(7) : String(raw || ""); }
  function cleanText(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }
  var PROFILE_FIELDS = ["fullName", "email", "contactNumber"];

  // Checks the Edit Profile form. Pure (nothing is saved), so the page can use it field by field while typing.
  // -> { valid, errors: { fieldName: "message" }, values: the cleaned values (phone as 09XXXXXXXXX) }
  function validateProfile(data, only) {
    data = data || {};
    var values = {
      fullName: cleanText(data.fullName),
      email: String(data.email == null ? "" : data.email).trim(),
      contactNumber: String(data.contactNumber == null ? "" : data.contactNumber).trim()
    };
    var errors = {};

    if (!values.fullName) errors.fullName = "Enter your full name.";
    else if (values.fullName.length > 60) errors.fullName = "Name is too long (60 characters at most).";
    else if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\u2019-]*$/.test(values.fullName) || values.fullName.length < 2) errors.fullName = "Enter a valid name. Use letters, spaces, and . ' - only.";

    if (!values.email) errors.email = "Enter your email address.";
    else if (values.email.length > 100) errors.email = "Email address is too long (100 characters at most).";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = "Enter a valid email address.";

    if (!values.contactNumber) errors.contactNumber = "Enter your contact number.";
    else if (!parsePhone(values.contactNumber)) errors.contactNumber = "Use a valid mobile number, like 09XX XXX XXXX.";
    else values.contactNumber = parsePhone(values.contactNumber);

    // `only` limits the check (and the returned values) to some fields
    if (only) {
      Object.keys(errors).forEach(function (k) { if (only.indexOf(k) === -1) delete errors[k]; });
      Object.keys(values).forEach(function (k) { if (only.indexOf(k) === -1) delete values[k]; });
    }
    return { valid: Object.keys(errors).length === 0, errors: errors, values: values };
  }

  // Writes one storage record and checks it really was stored (a full or blocked storage must not look like a success).
  function saveVerified(key, json) {
    write(key, json);
    var ok = read(key) === json;
    if (!ok) delete memory[key];
    return ok;
  }

  // data: { fullName, email, contactNumber, photo }   photo: a data URL, "" removes it, undefined keeps the saved one.
  // Rejects with an Error that has .errors ({ field: message }) when something is invalid (the form, or the server for a real account).
  // Real customer: name, email, contact number and photo are saved on the server (the store owner sees the photo).
  // Demo account: temporary, thrown away on log out.
  function updateProfile(data) {
    data = data || {};
    var result = validateProfile(data, PROFILE_FIELDS);
    if (!result.valid) {
      var err = new Error("Please check the highlighted fields.");
      err.errors = result.errors;
      return Promise.reject(err);
    }
    var v = result.values;
    var photo = data.photo === undefined ? undefined : cleanPhoto(data.photo);
    if (!isDemoLogin()) return updateProfileApi(v, photo, data.currentPassword);
    var edits = readJson(KEY_DEMO_PROFILE, {});
    Object.keys(v).forEach(function (k) { edits[k] = v[k]; });
    if (photo !== undefined) edits.photo = photo;
    if (!saveVerified(KEY_DEMO_PROFILE, JSON.stringify(edits))) {
      var failure = new Error("We could not save your changes. Your device storage may be full or blocked.");
      failure.code = "storage";
      return Promise.reject(failure);
    }
    var session = window.CrediTrackSession && window.CrediTrackSession.get();
    if (session && session.role === "customer" && session.name !== v.fullName) {
      window.CrediTrackSession.start({ role: "customer", name: v.fullName, demo: session.demo });
    }
    return getProfile();
  }

  // Real account: PUT /account/profile saves the name, email and contact number on the server, so they stay on any browser
  // or device. A problem the server points at (for example "This email is already registered.") is shown under that field.
  // The photo is saved with the rest of the profile: undefined keeps the saved one, "" removes it.
  // A changed email needs the current password and is not switched at once: the server sends a confirmation link to the new
  // address and keeps the old email until it is opened. The result then carries emailChangePending / pendingEmailSent.
  function updateProfileApi(v, photo, currentPassword) {
    var body = { fullName: v.fullName, email: v.email, contactNumber: v.contactNumber };
    if (photo !== undefined) body.photo = photo;
    if (currentPassword) body.currentPassword = String(currentPassword);
    return window.CrediTrackHttp("/account/profile", { method: "PUT", body: body }).then(function (res) {
      // The server renewed the login cookie; keep the saved session name in step (keeps "Remember me" as it was).
      var session = window.CrediTrackSession && window.CrediTrackSession.get();
      if (session && session.role === "customer" && !session.demo) {
        window.CrediTrackSession.start({ role: "customer", name: v.fullName, remember: !session.temporary });
      }
      return Promise.resolve(getProfile()).then(function (p) {   // reads the saved details back from the server
        return res && res.emailChangePending
          ? Object.assign({}, p, { emailChangePending: true, pendingEmail: res.pendingEmail, pendingEmailSent: !!res.pendingEmailSent })
          : p;
      });
    }, function (err) {
      if (err && err.field && err.status !== 401) {
        var e = new Error(err.message);
        e.errors = {};
        e.errors[err.field] = err.message;
        throw e;
      }
      throw err;
    });
  }

  // =====================  Security: Change Password  =====================
  // Same password rules as sign-up and the Store Owner's Security page. Real account: the server checks the current password
  // (POST /account/change-password). The browser never stores a password.
  var PASSWORD_RULES = {
    length: function (v) { return v.length >= 8; },
    upper: function (v) { return /[A-Z]/.test(v); },
    lower: function (v) { return /[a-z]/.test(v); },
    number: function (v) { return /\d/.test(v); },
    special: function (v) { return /[^A-Za-z0-9\s]/.test(v); }
  };
  function passwordRulesMet(v) { var met = {}; Object.keys(PASSWORD_RULES).forEach(function (k) { met[k] = PASSWORD_RULES[k](String(v || "")); }); return met; }
  // Pure check of the Change Password form -> { valid, errors: { currentPassword, newPassword, confirmPassword } }
  function validatePasswordChange(d) {
    d = d || {};
    var cur = String(d.currentPassword || ""), next = String(d.newPassword || ""), conf = String(d.confirmPassword == null ? next : d.confirmPassword), errors = {};
    if (!cur) errors.currentPassword = "Enter your current password.";
    if (!next) errors.newPassword = "Enter a new password.";
    else if (!Object.keys(PASSWORD_RULES).every(function (k) { return PASSWORD_RULES[k](next); })) errors.newPassword = "Password does not meet all the requirements.";
    else if (next === cur) errors.newPassword = "Your new password must be different from your current password.";
    if (!conf) errors.confirmPassword = "Re-enter your new password.";
    else if (conf !== next) errors.confirmPassword = "Passwords do not match.";
    return { valid: Object.keys(errors).length === 0, errors: errors };
  }
  function passwordChangedKey() { return isDemoLogin() ? KEY_DEMO_PROFILE : KEY_PROFILE; }
  // -> { passwordChangedAt: ISO string or "" }
  function getSecurityInfo() {
    if (!isDemoLogin() && window.CrediTrackHttp) {
      return window.CrediTrackHttp("/auth/me").then(function (me) {
        return { passwordChangedAt: me && typeof me.passwordChangedAt === "string" ? me.passwordChangedAt : "", isDemo: false };
      }, function () { return { passwordChangedAt: "", isDemo: false }; });
    }
    var rec = readJson(passwordChangedKey(), {}) || {};
    return Promise.resolve({ passwordChangedAt: typeof rec.passwordChangedAt === "string" ? rec.passwordChangedAt : "", isDemo: isDemoLogin() });
  }
  // Personal Information page (read only) -> { fullName, email, contactNumber, customerCode, photo, memberSince, emailVerified, isDemo }
  // Real account: GET /auth/me (the server is the only source). memberSince is an ISO date text or "".
  function getPersonalInfo() {
    return getProfile().then(function (p) {
      var info = { fullName: p.fullName, email: p.email, contactNumber: p.contactNumber, customerCode: p.customerCode, photo: p.photo,
        memberSince: "", emailVerified: false, isDemo: !!p.isDemo };
      if (isDemoLogin() || !window.CrediTrackHttp) return info;
      return window.CrediTrackHttp("/auth/me").then(function (me) {
        info.memberSince = me && typeof me.memberSince === "string" ? me.memberSince : "";
        info.emailVerified = !!(me && me.emailVerified);
        return info;
      }, function () { return info; });
    });
  }
  // data: { currentPassword, newPassword, confirmPassword } -> { changed: true, changedAt }  (demo account: { changed: false, mock: true })
  // Rejects with .errors ({ field: message }) for a field problem. Real account: POST /account/change-password, where the SERVER
  // checks the current password (for example "Your current password is incorrect."). The passwords are never saved in the browser.
  // The demo account has no password, so nothing changes there.
  function changePassword(data) {
    var result = validatePasswordChange(data);
    if (!result.valid) { var err = new Error("Please check the highlighted fields."); err.errors = result.errors; return Promise.reject(err); }
    if (isDemoLogin()) return Promise.resolve({ changed: false, mock: true, changedAt: new Date().toISOString() });
    data = data || {};
    var next = String(data.newPassword || "");
    return window.CrediTrackHttp("/account/change-password", {
      method: "POST",
      body: { currentPassword: data.currentPassword, newPassword: next, confirmPassword: data.confirmPassword == null ? next : data.confirmPassword }
    }).then(function (r) {
      return { changed: true, changedAt: (r && r.passwordChangedAt) || new Date().toISOString() };
    }, function (err) {
      if (err && err.field && err.status !== 401) { var e = new Error(err.message); e.errors = {}; e.errors[err.field] = err.message; throw e; }
      throw err;
    });
  }

  // =====================  Notification preferences  =====================
  // One on/off choice per kind of notification the customer can receive:
  //   payments  payment request updates (pending, approved, rejected)
  //   activity  credit and payment activity (credits and payments a store records, balance reminders, overdue)
  //   stores    store-related updates (joining or leaving a store, store connection changes)
  //   account   account and security alerts (password changes, sign-in and account protection)
  // Everything is ON until the customer turns something off. Only the choices are saved: they stay after leaving the page,
  // closing the app or logging out and back in (the demo account's choices are temporary, like its other edits).
  // The real API replaces these two functions with GET/PUT /customer/settings/notifications; the page does not change.
  var NOTIFICATION_PREF_KEYS = ["payments", "activity", "stores", "account"];
  function settingsKey() { return isDemoLogin() ? KEY_DEMO_SETTINGS : KEY_SETTINGS; }
  // Anything missing or not a real true/false counts as ON, and unknown names are dropped
  function cleanNotificationPrefs(input) {
    var source = input && typeof input === "object" ? input : {}, clean = {};
    NOTIFICATION_PREF_KEYS.forEach(function (key) { clean[key] = source[key] !== false; });
    return clean;
  }
  // -> { preferences: { payments, activity, stores, account }, updatedAt: ISO string or "", isDemo }
  function getNotificationPreferences() {
    if (!isDemoLogin() && window.CrediTrackHttp) {
      return window.CrediTrackHttp("/account/notification-preferences").then(function (r) {
        return { preferences: cleanNotificationPrefs(r && r.preferences), updatedAt: "", isDemo: false };
      });
    }
    var rec = readJson(settingsKey(), {}) || {};
    return Promise.resolve({
      preferences: cleanNotificationPrefs(rec.notifications),
      updatedAt: typeof rec.notificationsUpdatedAt === "string" ? rec.notificationsUpdatedAt : "",
      isDemo: isDemoLogin()
    });
  }
  // prefs: { payments, activity, stores, account } (each true/false) -> { preferences, updatedAt }
  // Real account: PUT /account/notification-preferences, so the choices stay after logging out and on any device.
  // Demo account: kept in the browser, and rejects with .code "storage" when they could not be saved (nothing changes then).
  function saveNotificationPreferences(prefs) {
    var clean = cleanNotificationPrefs(prefs), now = new Date().toISOString();
    if (!isDemoLogin() && window.CrediTrackHttp) {
      return window.CrediTrackHttp("/account/notification-preferences", { method: "PUT", body: clean }).then(function (r) {
        return { preferences: cleanNotificationPrefs(r && r.preferences), updatedAt: now };
      });
    }
    var key = settingsKey(), rec = readJson(key, {}) || {};
    rec.notifications = clean;
    rec.notificationsUpdatedAt = now;
    if (!saveVerified(key, JSON.stringify(rec))) {
      var failure = new Error("We could not save your preferences. Your device storage may be full or blocked.");
      failure.code = "storage";
      return Promise.reject(failure);
    }
    return Promise.resolve({ preferences: rec.notifications, updatedAt: now });
  }

  // About CrediTrack: the same app details as the Store Owner's About page (APP_INFO in owner-api.js). Both are one product,
  // so change the version in BOTH places until a shared config exists.
  var APP_INFO = { name: "CrediTrack", version: "1.0.0", tagline: "Every Credit, On Track." };
  function getAppInfo() { return Promise.resolve(Object.assign({}, APP_INFO)); }

  // A plain, fictional receipt picture (no real brand) so "uploaded proof" can be shown without any upload.
  function sampleProof(amount, method, reference) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="400" viewBox="0 0 360 400"><rect width="360" height="400" fill="#f3f8f8"/>' +
      '<rect x="20" y="20" width="320" height="360" rx="18" fill="#fff" stroke="#d6e4e6"/>' +
      '<circle cx="180" cy="92" r="30" fill="#086B70"/><path d="M165 92l11 11 20-22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="180" y="156" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#071A52">Payment Sent</text>' +
      '<text x="180" y="204" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#071A52">PHP ' + Number(amount).toFixed(2) + '</text>' +
      '<line x1="48" y1="240" x2="312" y2="240" stroke="#d6e4e6"/>' +
      '<text x="48" y="278" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Sent via</text><text x="312" y="278" text-anchor="end" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#071A52">' + method + '</text>' +
      '<text x="48" y="316" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Ref. No.</text><text x="312" y="316" text-anchor="end" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#071A52">' + reference + '</text>' +
      '<text x="48" y="354" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Sample receipt</text><text x="312" y="354" text-anchor="end" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Not a real payment</text>' +
      '</svg>';
    return { name: "receipt-sample.svg", type: "image/svg+xml", dataUrl: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) };
  }

  // ---- Sample data (fictional; follows the prototype: Aling Nena's Store + Mang Tony's Store) ----
  // Totals: credits 1,400.00, payments 650.00, balance 750.00 (300.00 + 450.00).
  function sampleRecords() {
    return {
      stores: [
        { id: "str-001", code: "STR-001", name: "Aling Nena's Store", type: "Sari-Sari Store", location: "Brgy. Poblacion, Lipa City, Batangas", owner: "Nena Reyes", linkedRecord: "CUS-001", joinedAt: daysAgo(40, 9), totalCredit: 500, totalPaid: 200, overdueAmount: 0 },
        { id: "str-002", code: "STR-002", name: "Mang Tony's Store", type: "Sari-Sari Store", location: "Brgy. Sabang, Lipa City, Batangas", owner: "Tony Mercado", linkedRecord: "CUS-004", joinedAt: daysAgo(21, 9), totalCredit: 900, totalPaid: 450, overdueAmount: 0 }
      ],
      // type: credit | payment | request. status: unpaid | recorded | pending | rejected
      activity: [
        { id: "act-1", storeId: "str-002", type: "request", title: "GCash payment request", method: "GCash", amount: 100, date: minutesAgo(35), status: "pending", reference: "5019 2284 7733", note: "Pa-verify po muna. Salamat!", proof: sampleProof(100, "GCash", "5019 2284 7733") },
        { id: "act-2", storeId: "str-001", type: "credit", title: "Cooking oil, noodles", amount: 120, date: daysAgo(1, 15, 20), status: "unpaid", dueDate: dayFromNow(6),   // demo: one credit with a due date, the rest have none
          items: [{ name: "Cooking oil", qty: 1, unit: "bottle", price: 70 }, { name: "Instant noodles", qty: 5, unit: "pcs", price: 10 }] },
        { id: "act-3", storeId: "str-002", type: "payment", title: "Cash payment", method: "Cash", amount: 150, date: daysAgo(1, 11, 10), status: "recorded", reference: "" },
        { id: "act-4", storeId: "str-001", type: "credit", title: "Rice, canned goods", amount: 180, date: daysAgo(2, 10, 15), status: "unpaid",
          items: [{ name: "Rice", qty: 2, unit: "kg", price: 50 }, { name: "Canned sardines", qty: 4, unit: "pcs", price: 20 }] },
        { id: "act-5", storeId: "str-001", type: "payment", title: "GCash payment", method: "GCash", amount: 200, date: daysAgo(3, 16, 30), status: "recorded", reference: "7842 3159 0261", reviewedAt: daysAgo(3, 16, 45),
          viaRequest: true, proof: sampleProof(200, "GCash", "7842 3159 0261") },   // a payment request the store approved
        { id: "act-6", storeId: "str-002", type: "credit", title: "Grocery items", amount: 300, date: daysAgo(5, 14, 5), status: "unpaid",
          items: [{ name: "Rice", qty: 3, unit: "kg", price: 50 }, { name: "Sugar", qty: 1, unit: "kg", price: 80 }, { name: "Cooking oil", qty: 1, unit: "bottle", price: 70 }] },
        { id: "act-7", storeId: "str-002", type: "payment", title: "Cash payment", method: "Cash", amount: 300, date: daysAgo(8, 9, 40), status: "recorded", reference: "" },
        { id: "act-8", storeId: "str-002", type: "request", title: "GCash payment request", method: "GCash", amount: 50, date: daysAgo(10, 13, 5), status: "rejected", reference: "3306 4127 8850", note: "Bayad ko po ito kahapon.",
          proof: sampleProof(50, "GCash", "3306 4127 8850"), reviewedAt: daysAgo(10, 13, 20),
          rejectionReason: "We could not find this payment in our GCash account. Please check the reference number and send it again." },
        { id: "act-9", storeId: "str-002", type: "credit", title: "Cooking oil, sugar, coffee", amount: 300, date: daysAgo(12, 17, 45), status: "unpaid",
          items: [{ name: "Cooking oil", qty: 2, unit: "bottle", price: 70 }, { name: "Sugar", qty: 1, unit: "kg", price: 80 }, { name: "Coffee 3-in-1", qty: 8, unit: "pcs", price: 10 }] },
        { id: "act-10", storeId: "str-001", type: "credit", title: "Rice, eggs", amount: 200, date: daysAgo(15, 8, 30), status: "unpaid",
          items: [{ name: "Rice", qty: 2, unit: "kg", price: 50 }, { name: "Eggs", qty: 10, unit: "pcs", price: 10 }] },
        { id: "act-11", storeId: "str-002", type: "credit", title: "Canned goods, noodles", amount: 300, date: daysAgo(20, 10, 0), status: "unpaid",
          items: [{ name: "Canned sardines", qty: 6, unit: "pcs", price: 20 }, { name: "Corned beef", qty: 3, unit: "pcs", price: 40 }, { name: "Instant noodles", qty: 6, unit: "pcs", price: 10 }] }
      ]
    };
  }

  // Stores joined during the demo / sample preview live in their own list, so they can never end up in real records.
  function demoJoined() {
    var r = readJson(KEY_DEMO_JOINED, null);
    return { stores: (r && r.stores) || [], activity: (r && r.activity) || [], read: (r && r.read) || [], disconnected: (r && r.disconnected) || {} };
  }
  function recordsFromStorage() {
    var r = readJson(KEY_RECORDS, null);
    return { stores: (r && r.stores) || [], activity: (r && r.activity) || [], read: (r && r.read) || [] };
  }

  function isDemo() { var v = read(KEY_DEMO); return v === "1" || v === "login"; }
  function isDemoLogin() { return read(KEY_DEMO) === "login"; }   // the demo account: leaving the demo means logging out
  function setDemo(on) { write(KEY_DEMO, on ? "1" : null); write(KEY_DEMO_JOINED, null); return Promise.resolve(); }
  // Login helpers (mock: there is no password check until the backend exists)
  function isDemoEmail(email) { return String(email || "").trim().toLowerCase() === DEMO_EMAIL; }
  function startDemoLogin() { write(KEY_DEMO, "login"); write(KEY_DEMO_JOINED, null); write(KEY_DEMO_PROFILE, null); }

  // ---- Status rules (the only place that decides them) ----
  //   Fully Paid     nothing owed
  //   Overdue        something owed is past its due date
  //   Partially Paid owes something, but has already paid part of it
  //   Unpaid         owes everything, nothing paid yet
  function statusFor(balance, totalPaid, overdueAmount) {
    if (balance <= 0) return { key: "paid", label: "Fully Paid", tone: "success" };
    if (overdueAmount > 0) return { key: "overdue", label: "Overdue", tone: "danger" };
    if (totalPaid > 0) return { key: "partial", label: "Partially Paid", tone: "warning" };
    return { key: "unpaid", label: "Unpaid", tone: "warning" };
  }

  function pendingOf(activity, storeId) {
    var pending = activity.filter(function (a) { return a.type === "request" && a.status === "pending" && (!storeId || a.storeId === storeId); });
    return { count: pending.length, amount: round2(pending.reduce(function (sum, a) { return sum + a.amount; }, 0)) };
  }

  // Leaving a store only marks the connection. Credits, payments and activity are never removed or changed, so a
  // store's balance and records stay exactly as they were and can be read again (History, Payments, Reconnect).
  //   real stores / stores joined in the demo: the entry's own `disconnectedAt`
  //   the fixed sample stores: the demo's `disconnected` map (thrown away with the demo)
  function decorate(records) {
    var names = {}, gone = isDemo() ? demoJoined().disconnected : {};
    var stores = records.stores.map(function (s) {
      var balance = Math.max(0, round2(s.totalCredit - s.totalPaid));
      var pending = pendingOf(records.activity, s.id);
      var mine = records.activity.filter(function (a) { return a.storeId === s.id; });
      var last = mine.reduce(function (t, a) { return !t || new Date(a.date) > new Date(t) ? a.date : t; }, "");
      var off = s.disconnectedAt || gone[s.id] || "";
      names[s.id] = s.name;
      return {
        id: s.id, code: s.code, name: s.name, joinedAt: s.joinedAt,
        type: s.type || "Sari-Sari Store", location: s.location || "", owner: s.owner || "", linkedRecord: s.linkedRecord || "",
        connected: !off, disconnectedAt: off, transactionCount: mine.length, lastActivityAt: last,
        totalCredit: round2(s.totalCredit), totalPaid: round2(s.totalPaid), balance: balance,
        overdueAmount: round2(s.overdueAmount || 0),
        status: s.totalCredit <= 0 ? { key: "none", label: "No Balance", tone: "success" } : statusFor(balance, s.totalPaid, s.overdueAmount || 0),
        pendingCount: pending.count, pendingAmount: pending.amount
      };
    });
    var activity = records.activity.map(function (a) {
      return Object.assign({}, a, { storeName: names[a.storeId] || "" });
    }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return { stores: stores, activity: activity };
  }

  // Every store the customer ever joined (connected or not) with all of its records.
  function loadAll() {
    var sample = isDemo();
    var base = sample ? sampleRecords() : recordsFromStorage();
    if (sample) { var extra = demoJoined(); base = { stores: base.stores.concat(extra.stores), activity: base.activity.concat(extra.activity) }; }
    var data = decorate(base);
    return { isSample: sample, stores: data.stores, activity: data.activity };
  }

  // Everything the Home dashboard needs.
  //   isSample  true while sample data is on (the page shows a "Sample" tag and a notice)
  //   stores    the stores the customer has joined, each with its own separate balance and status
  //   activity  credits, recorded payments and payment requests, newest first
  function getHome() {
    if (!isDemo()) return getHomeApi();
    var all = loadAll(), on = {};
    all.stores.forEach(function (st) { if (st.connected) on[st.id] = true; });
    return Promise.resolve({ isSample: all.isSample, stores: all.stores.filter(function (st) { return st.connected; }),
      activity: all.activity.filter(function (act) { return on[act.storeId]; }) });
  }
  // Everything the customer has on record, including stores they have since left. History, Payments and the detail
  // screens read this, so leaving a store never hides or deletes a transaction.
  function getRecords() { return isDemo() ? Promise.resolve(loadAll()) : getRecordsApi(); }
  // Real account: everything comes from the store owner's records on the server (GET /customer/stores, /customer/history and
  // /customer/payment-requests), only for the records linked to my account. Stores I left are included, so leaving never hides history.
  // Credits and payments the owner records show up here by themselves; a payment request shows as its own line until the owner approves it
  // (an approved request is already the payment the owner recorded, so it is not listed twice).
  function activityFromApi(r) {
    var credit = r.type === "credit", names = (r.items || []).map(function (i) { return i.name; });
    return { id: "tx-" + r.id, transactionId: r.id, remaining: credit ? round2(r.remaining) : 0,
      code: r.code || "", storeId: String(r.customerId), storeName: r.storeName, type: r.type, amount: round2(r.amount), date: r.date,
      dueDate: credit && r.dueDate ? r.dueDate : "",   // the store's agreed payment date, "YYYY-MM-DD" ("" = no due date). Display only.
      title: credit ? (names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "") : "Credit") : (r.method || "Payment") + " payment",
      status: r.voided ? "voided" : credit ? r.status : "recorded", method: r.method || "", reference: r.reference || "", note: r.note || "", voided: !!r.voided, voidInfo: r.voided && r.voidInfo ? { at: r.voidInfo.at, reason: r.voidInfo.reasonLabel || "", remarks: r.voidInfo.remarks || "" } : null,
      items: (r.items || []).map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit || "", price: i.price }; }) };
  }
  function historyPages(page, items) {
    return window.CrediTrackHttp("/customer/history?type=all&page=" + page + "&pageSize=100").then(function (d) {
      items = items.concat(d.items || []);
      return d.hasMore && page < 30 ? historyPages(page + 1, items) : items;   // the server sends at most 100 at a time
    });
  }
  function getRecordsApi() {
    return Promise.all([storesFromApi(), historyPages(1, []), window.CrediTrackHttp("/customer/payment-requests?status=all&page=1&pageSize=100")]).then(function (res) {
      var stores = res[0];
      var activity = res[1].map(activityFromApi).concat((res[2].items || []).filter(function (r) { return r.customerStatus !== "completed"; }).map(function (r) {
        return { id: "req-" + r.id, storeId: String(r.customerId), storeName: r.storeName, type: "request", amount: round2(r.amount), date: r.submittedAt,
          title: (r.method || "Payment") + " payment request", status: r.customerStatus, method: r.method || "", reference: r.reference || "", note: r.message || "",
          reviewedAt: r.reviewedAt || "", rejectionReason: r.customerStatus === "rejected" ? (r.rejectReason || "") : "" };
      })).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      return { isSample: false, stores: stores, activity: activity };
    });
  }
  function tagged(stores) {   // a left store stays pickable in filters, clearly labelled
    return stores.map(function (st) { return st.connected ? st : Object.assign({}, st, { name: st.name + " (Disconnected)" }); });
  }

  // The full transaction history (newest first), for all stores or one. The History page (a later step) reads this.
  function getHistory(storeId) {
    return getRecords().then(function (home) {
      return { isSample: home.isSample, stores: tagged(home.stores), transactions: home.activity.filter(function (a) { return !storeId || a.storeId === storeId; }) };
    });
  }

  // The Payments screen (customer/payments): every payment the customer made or the store recorded, newest first.
  //   status  pending   a payment request the store has not verified yet (balance not changed)
  //           completed a payment the store recorded (a verified request, or a payment recorded at the store)
  //           rejected  a payment request the store did not accept (balance not changed)
  // Payments imported from a linked customer record (ids "join-...") are history, not payment requests, so they are left out.
  // The summary is worked out here (never on the page): pending count and amount, completed amount in the last 30 days,
  // and a count per status for the tabs. storeName comes from the joined store, so it always matches My Stores.
  var RECENT_DAYS = 30;
  // The summary cards and tab counts, worked out from a list of payments (newest first). Used by the demo and the real account.
  function paymentsResult(isSample, stores, payments) {
    var since = Date.now() - RECENT_DAYS * 86400000;
    var sum = function (list) { return round2(list.reduce(function (t, p) { return t + p.amount; }, 0)); };
    var by = function (status) { return payments.filter(function (p) { return p.status === status; }); };
    var pending = by("pending"), completed = by("completed"), rejected = by("rejected");
    var recent = completed.filter(function (p) { return new Date(p.date).getTime() >= since; });
    return {
      isSample: isSample, hasStores: stores.length > 0, stores: tagged(stores).map(function (s) { return { id: s.id, name: s.name }; }), payments: payments,
      summary: { pendingCount: pending.length, pendingAmount: sum(pending), recordedAmount: sum(recent), recordedCount: recent.length, recentDays: RECENT_DAYS },
      counts: { all: payments.length, pending: pending.length, completed: completed.length, rejected: rejected.length }
    };
  }

  // ---- Real accounts: GET /api/customer/stores and /api/customer/payment-requests (only my own records) ----
  // A store is identified by my record id there (customerId), as a text, so it matches the filters and the store picker.
  function storeFromApi(s) {
    var credit = round2(s.totalCredit), paid = round2(s.totalPaid), balance = Math.max(0, round2(s.balance));
    return { id: String(s.customerId), code: s.storeCode, name: s.storeName, joinedAt: s.joinedAt, type: s.businessType || "Sari-Sari Store",
      location: s.address || "", owner: s.ownerName || "", ownerPhoto: s.ownerPhoto || "", linkedRecord: s.recordCode || "", connected: !!s.connected,
      disconnectedAt: s.connected ? "" : (s.disconnectedAt || ""), transactionCount: s.transactionCount || 0, lastActivityAt: s.lastActivity || "",
      totalCredit: credit, totalPaid: paid, balance: balance, overdueAmount: 0,
      status: credit <= 0 ? { key: "none", label: "No Balance", tone: "success" } : statusFor(balance, paid, 0),
      pendingCount: s.pendingCount || 0, pendingAmount: round2(s.pendingAmount) };
  }
  function storesFromApi() {
    return window.CrediTrackHttp("/customer/stores").then(function (d) { return (d.stores || []).map(storeFromApi); });
  }
  // Home: my connected stores with their own balances, the latest credits and payments, and the requests still waiting or rejected
  // (an approved request already shows as the payment the store recorded). Voided records are left out here; History shows them.
  function getHomeApi() {
    return Promise.all([storesFromApi(), window.CrediTrackHttp("/customer/home"), window.CrediTrackHttp("/customer/payment-requests?status=all&page=1&pageSize=100")]).then(function (res) {
      var stores = res[0].filter(function (s) { return s.connected; }), on = {};
      stores.forEach(function (s) { on[s.id] = true; });
      var activity = (res[1].recentActivity || []).filter(function (r) { return !r.voided; }).map(function (r) {
        var credit = r.type === "credit", names = (r.items || []).map(function (i) { return i.name; });
        return { id: "tx-" + r.id, storeId: String(r.customerId), storeName: r.storeName, type: r.type, amount: round2(r.amount), date: r.date,
          title: credit ? (names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "") : "Credit") : (r.method || "Payment") + " payment",
          status: credit ? r.status : "recorded", method: r.method || "", reference: r.reference || "" };
      }).concat((res[2].items || []).filter(function (r) { return r.customerStatus !== "completed"; }).map(function (r) {
        return { id: "req-" + r.id, storeId: String(r.customerId), storeName: r.storeName, type: "request", amount: round2(r.amount), date: r.submittedAt,
          title: (r.method || "Payment") + " payment request", status: r.customerStatus, method: r.method || "", reference: r.reference || "" };
      })).filter(function (a) { return on[a.storeId]; }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      // Credits that are overdue, due today or due within a week (decided on the server by OverdueRule)
      var due = (res[1].dueReminders || []).filter(function (d) { return on[String(d.customerId)]; }).map(function (d) {
        return { id: "tx-" + d.transactionId, code: d.code, storeId: String(d.customerId), storeName: d.storeName, dueDate: d.dueDate,
          outstanding: round2(d.outstanding), status: d.status, days: d.days };
      });
      return { isSample: false, stores: stores, activity: activity, dueReminders: due, dueReminderCount: res[1].dueReminderCount || due.length };
    });
  }
  function getConnectedStoresApi() {
    return storesFromApi().then(function (all) {
      return { isSample: false, connected: all.filter(function (s) { return s.connected; }), disconnected: all.filter(function (s) { return !s.connected; }) };
    });
  }
  // Leave or reconnect: only the connection flag changes on the server, no record is deleted
  function setConnectionApi(id, connect) {
    return window.CrediTrackHttp("/customer/stores/" + encodeURIComponent(id) + "/" + (connect ? "reconnect" : "leave"), { method: "POST" }).then(function (d) {
      var st = storeFromApi(d);
      return { store: { id: st.id, name: st.name, balance: st.balance }, recordsKept: st.transactionCount };
    });
  }
  // Join: look the store up by its code first (so the customer can check it is the right one), then join.
  // A new record always starts at 0.00. An EXISTING record is linked by the store owner (with my customer code), never from here.
  function findStoreApi(input) {
    var code = normalizeStoreCode(input);
    if (!code) return Promise.reject(joinError("empty", "Enter the store code."));
    return window.CrediTrackHttp("/customer/stores/lookup", { method: "POST", body: { storeCode: code } }).then(function (d) {
      if (d.alreadyJoined) throw joinError("joined", d.storeName + " is already in your My Stores.");
      if (d.wasConnected) throw joinError("joined", d.storeName + " is in your Connected Stores as disconnected. Reconnect it from Profile > Connected Stores.");
      if (d.requestPending) throw joinError("joined", "You already asked to join " + d.storeName + ". Wait for the owner to approve it (see My Stores > Requests).");
      return { code: d.storeCode, name: d.storeName, type: d.businessType || "Sari-Sari Store", location: d.address || "", owner: d.ownerName || "" };
    });
  }
  function joinStoreApi(data) {
    return window.CrediTrackHttp("/customer/stores/join", { method: "POST", body: { storeCode: normalizeStoreCode(data.storeCode) } }).then(function (d) {
      // A new join is only a REQUEST: the store owner has to approve it before I become their customer
      if (d.joined === "requested") {
        var rq = d.request || {};
        return { pending: true, requestId: rq.id, expiresAt: rq.expiresAt || "",
          store: { id: "", code: rq.storeCode || "", name: rq.storeName || "", type: rq.businessType || "Sari-Sari Store", location: rq.address || "", owner: rq.ownerName || "" },
          linked: false, linkedRecord: "", balance: 0 };
      }
      var st = storeFromApi(d.store), again = d.joined === "reconnected";
      return { store: { id: st.id, code: st.code, name: st.name, type: st.type, location: st.location, owner: st.owner },
        linked: again && !!st.linkedRecord, linkedRecord: again ? st.linkedRecord : "", balance: st.balance };
    });
  }
  // ---- Requests (consent) ----
  // incoming: a store asked to link my account to its record of me (I accept or decline).
  // outgoing: join requests I sent that the store owner has not answered yet (I can cancel).
  // Demo mode has none of these: joining there is instant on this device.
  function requestFromApi(row) {
    var r = row.request || {}, rec = row.record || null;
    return { id: r.id, kind: r.kind, storeName: r.storeName, storeCode: r.storeCode, ownerName: r.ownerName || "", type: r.businessType || "",
      address: r.address || "", createdAt: r.createdAt, expiresAt: r.expiresAt,
      record: rec ? { name: rec.name, code: rec.code, balance: round2(rec.balance), creditCount: rec.creditCount || 0 } : null };
  }
  function getRequests() {
    if (isDemo()) return Promise.resolve({ incoming: [], outgoing: [] });
    return window.CrediTrackHttp("/customer/requests").then(function (d) {
      var all = (d.requests || []).map(requestFromApi);
      return { incoming: all.filter(function (r) { return r.kind === "link"; }), outgoing: all.filter(function (r) { return r.kind === "join"; }) };
    });
  }
  function answerRequest(id, action) {
    if (isDemo()) return Promise.reject(new Error("Requests are not available in the demo."));
    return window.CrediTrackHttp("/customer/requests/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
  }
  function acceptRequest(id) { return answerRequest(id, "accept"); }
  function declineRequest(id) { return answerRequest(id, "decline"); }
  function cancelRequest(id) { return answerRequest(id, "cancel"); }

  // My Payments lists the payment requests I sent (the latest 100; the API's page size limit). Filters and paging then
  // work on that list here, exactly as in the demo. Payments the store recorded itself appear in History, not here.
  function getPaymentsApi() {
    return Promise.all([storesFromApi(), window.CrediTrackHttp("/customer/payment-requests?status=all&page=1&pageSize=100")]).then(function (res) {
      var payments = (res[1].items || []).map(function (r) {
        return { id: String(r.id), storeId: String(r.customerId), storeName: r.storeName, method: r.method || "", amount: round2(r.amount),
          date: r.submittedAt, status: r.customerStatus, reference: r.reference || "", fromRequest: true,
          rejectionReason: r.customerStatus === "rejected" ? (r.rejectReason || "") : "" };
      });
      return paymentsResult(false, res[0], payments);
    });
  }
  function getPayments() {
    if (!isDemo()) return getPaymentsApi();
    return getRecords().then(function (home) {
      var payments = home.activity.filter(function (a) {
        return (a.type === "request" || a.type === "payment") && String(a.id).indexOf("join-") !== 0;
      }).map(function (a) {
        var status = a.type === "request" && (a.status === "pending" || a.status === "rejected") ? a.status : "completed";
        return { id: a.id, storeId: a.storeId, storeName: a.storeName, method: a.method || "", amount: round2(a.amount), date: a.date,
          status: status, reference: a.reference || "", fromRequest: a.type === "request" || !!a.viaRequest,
          rejectionReason: status === "rejected" ? (a.rejectionReason || "") : "" };
      });   // activity is already newest first
      return paymentsResult(home.isSample, home.stores, payments);
    });
  }

  // ---- My Payments: filtered, paginated list ----
  // BACKEND CONTRACT (future: GET /api/customer/payments)
  //   query    { status: "all" | "pending" | "completed" | "rejected",
  //              method: "all" | "cash" | "gcash" | "maya" | "bank" | "other",
  //              storeId: "all" | <store id>,
  //              dateRange: "all" | "today" | "7" | "30" | "month" | "custom", from, to (YYYY-MM-DD, for custom), page, pageSize }
  //   response { isSample, hasStores, stores, methods: [{ id, label }], summary (same as getPayments), items (newest first),
  //              totalCount, page, pageSize, totalPages, hasMore,
  //              counts: { all, pending, completed, rejected }   (follow store, method and date, ignore the chosen status),
  //              totalAll (every payment of this customer, 0 = none yet), invalidRange }
  //   The date filter looks at the date the payment was sent or recorded. The summary cards are NOT filtered.
  // This body reads the local records through getPayments(). Replace ONLY this body with a fetch later; the page does not change.
  function methodMatches(payment, methodId) {
    if (methodId === "all") return true;
    var label = String(payment.method || "").toLowerCase();
    if (methodId === "other") {   // anything that is not one of the named methods (including no method)
      return !PAYMENT_METHODS.some(function (m) { return m.id !== "other" && m.label.toLowerCase() === label; });
    }
    var m = methodById(methodId);
    return !!m && m.label.toLowerCase() === label;
  }
  function queryPayments(query) {
    var Q = window.CrediTrackQuery;
    query = query || {};
    var status = Q.pick(query.status, ["all", "pending", "completed", "rejected"], "all");
    var method = Q.pick(query.method, ["all"].concat(PAYMENT_METHODS.map(function (m) { return m.id; })), "all");
    var storeId = String(query.storeId || "all"), win = Q.dateWindow(query);
    return getPayments().then(function (data) {
      // Everything except the status, so the tab counts show what each tab would list
      var scoped = win.invalid ? [] : data.payments.filter(function (p) {
        return (storeId === "all" || p.storeId === storeId) && methodMatches(p, method) && Q.inWindow(p.date, win);
      });
      var counts = { all: scoped.length };
      ["pending", "completed", "rejected"].forEach(function (t) { counts[t] = scoped.filter(function (p) { return p.status === t; }).length; });
      var matches = status === "all" ? scoped : scoped.filter(function (p) { return p.status === status; });   // already newest first
      return Object.assign({
        isSample: data.isSample, hasStores: data.hasStores, stores: data.stores, summary: data.summary,
        methods: PAYMENT_METHODS.map(function (m) { return { id: m.id, label: m.label }; }),
        counts: counts, totalAll: data.payments.length, invalidRange: win.invalid
      }, Q.paginate(matches, query));
    });
  }

  // =====================  Request a Payment (mock data only)  =====================
  // A payment request is what the customer sends after paying outside the app (GCash, Maya, bank transfer, cash ...).
  // It is saved as an activity record { type: "request", status: "pending" } and shown on Payments, History and Home.
  //
  // IMPORTANT: submitting a request NEVER changes a store's totalPaid, so the balance (totalCredit - totalPaid) stays exactly
  // as it was. Only the Store Owner's approval may record the payment and lower the balance (a later step: the owner side will
  // turn the request into a "payment" with status "recorded" and add its amount to the store's totalPaid; a rejection sets
  // status "rejected" and changes nothing else).
  //   proof      "required" = a picture of the receipt must be attached (every method except cash), "optional" = may be attached
  //   reference  "required" = must be entered, "optional" = may be entered, "none" = the field is not shown
  var PAYMENT_METHODS = [
    { id: "cash",     label: "Cash",          reference: "none",     proof: "optional", hint: "" },
    { id: "gcash",    label: "GCash",         reference: "required", proof: "required", hint: "Find the reference number on your GCash receipt." },
    { id: "maya",     label: "Maya",          reference: "required", proof: "required", hint: "Find the reference number on your Maya receipt." },
    { id: "bank",     label: "Bank Transfer", reference: "required", proof: "required", hint: "Use the reference or transaction number from your bank." },
    { id: "other",    label: "Other",         reference: "optional", proof: "required", hint: "Add a reference number if you have one." }
  ];
  var REFERENCE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9 \-]{4,28}[A-Za-z0-9]$/;   // 6 to 30 letters, digits, spaces or dashes
  var NOTE_MAX = 200;
  var PROOF_MAX_CHARS = 700000;   // a stored receipt picture (data URL) larger than this is dropped; the file name is kept

  function requestError(code, message) { var e = new Error(message); e.code = code; return e; }
  function methodById(id) { return PAYMENT_METHODS.filter(function (m) { return m.id === id; })[0] || null; }
  function newRequestId() { return "req-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // The stores this customer can pay right now: each with its balance and what is already waiting for verification.
  // -> { isSample, stores: [{ id, name, balance, pendingCount, pendingAmount, canPay }] }
  function getPayableStores() {
    if (!isDemo()) {
      return storesFromApi().then(function (stores) {
        // A store I left cannot be paid until I reconnect it, so only connected stores are listed
        return { isSample: false, stores: stores.filter(function (s) { return s.connected; }).map(function (s) {
          return { id: s.id, name: s.name, balance: s.balance, pendingCount: s.pendingCount, pendingAmount: s.pendingAmount, canPay: s.balance > 0 };
        }) };
      });
    }
    return getHome().then(function (home) {
      return {
        isSample: home.isSample,
        stores: home.stores.map(function (s) {
          return { id: s.id, name: s.name, balance: s.balance, pendingCount: s.pendingCount, pendingAmount: s.pendingAmount, canPay: s.balance > 0 };
        })
      };
    });
  }

  // The GCash / Maya / Bank details a store shows for paying it (only the methods the owner has set up), so the customer can copy the
  // number or save the QR. CrediTrack only records payments, it never moves money.
  // -> { storeName, accounts: [{ method: "gcash" | "maya" | "bank", accountName, accountNumber, bankName, qrUrl }] }
  // Real account: GET /customer/stores/{my record id}/payment-accounts (the store id is that record id). Demo: fictional sample details.
  var SAMPLE_PAYMENT_ACCOUNTS = {   // fictional (no real numbers, no QR picture)
    "str-001": [
      { method: "gcash", accountName: "Nena Reyes", accountNumber: "0917 000 1234", bankName: "", qrUrl: "" },
      { method: "bank", accountName: "Nena Reyes", accountNumber: "0000 1111 2222", bankName: "Sample Bank", qrUrl: "" }
    ],
    "str-002": [
      { method: "maya", accountName: "Tony Mercado", accountNumber: "0917 000 5678", bankName: "", qrUrl: "" }
    ]
  };
  function getStorePaymentAccounts(storeId) {
    if (isDemo()) return Promise.resolve({ storeName: "", accounts: (SAMPLE_PAYMENT_ACCOUNTS[String(storeId)] || []).map(function (a) { return Object.assign({}, a); }) });
    return window.CrediTrackHttp("/customer/stores/" + encodeURIComponent(storeId) + "/payment-accounts").then(function (d) {
      return {
        storeName: (d && d.storeName) || "",
        accounts: ((d && d.accounts) || []).map(function (a) {
          return { method: a.method, accountName: a.accountName || "", accountNumber: a.accountNumber || "", bankName: a.bankName || "", qrUrl: a.qrUrl || "" };
        })
      };
    });
  }

  // data: { storeId, amount, method (id), reference, note, proof: { name, type, dataUrl } | null, requestId }
  // -> { request, store: { id, name, balance }, duplicate }   (balance is the store balance AFTER saving: always unchanged)
  // Rejects with an Error whose .code is: store | amount | over | method | reference | note
  // requestId makes saving safe to repeat: a second call with the same requestId returns the request already saved.
  function submitPaymentRequestApi(data) {
    var method = methodById(data.method);
    if (!method) return Promise.reject(requestError("method", "Choose a payment method."));
    var reference = String(data.reference || "").trim().replace(/\s+/g, " ");
    if (method.reference === "none") reference = "";
    else if (method.reference === "required" && !reference) return Promise.reject(requestError("reference", "Enter the reference number."));
    else if (reference && !REFERENCE_FORMAT.test(reference)) return Promise.reject(requestError("reference", "The reference number should be 6 to 30 letters or numbers."));
    var note = String(data.note || "").trim();
    if (note.length > NOTE_MAX) return Promise.reject(requestError("note", "Keep your message to " + NOTE_MAX + " characters or fewer."));
    var proof = data.proof && data.proof.dataUrl ? String(data.proof.dataUrl) : null;
    if (method.proof === "required" && !proof) return Promise.reject(requestError("proof", "Attach a picture of your " + method.label + " receipt."));
    // The server checks everything again (my store, the balance, pending requests, a repeated reference) and saves it as pending.
    // The balance does not change until the store owner approves.
    return window.CrediTrackHttp("/customer/payment-requests", { method: "POST", body: {
      customerId: Number(data.storeId), transactionId: data.transactionId || undefined,
      amount: round2(Number(data.amount)), method: method.label, reference: reference, message: note, proof: proof
    } }).then(function (r) {
      return { request: Object.assign({}, r, { id: String(r.id), note: r.message || "", reference: r.reference || "" }),
        store: { id: String(r.customerId), name: r.storeName, balance: null }, duplicate: false };
    }, function (err) {
      if (err && err.field === "proof") err.code = "proof";
      if (err && err.field === "message") err.code = "note";   // the screen calls the message field "note"
      if (err && err.status === 409 && err.field === "reference") err.code = "duplicate";   // shown above the Submit button
      throw err;
    });
  }
  function submitPaymentRequest(data) {
    data = data || {};
    if (!isDemo()) return submitPaymentRequestApi(data);
    return getHome().then(function (home) {
      var existing = data.requestId && home.activity.filter(function (a) { return a.requestId === data.requestId; })[0];
      var store = home.stores.filter(function (s) { return s.id === data.storeId; })[0];
      if (existing) {
        var was = home.stores.filter(function (s) { return s.id === existing.storeId; })[0] || store;
        return { request: existing, store: { id: was.id, name: was.name, balance: was.balance }, duplicate: true };
      }
      if (!store) throw requestError("store", "Choose the store you are paying.");
      if (store.balance <= 0) throw requestError("store", store.name + " has no balance to pay.");
      var amount = round2(Number(data.amount));
      if (!isFinite(amount) || amount <= 0) throw requestError("amount", "Enter the amount you paid.");
      if (amount > store.balance) throw requestError("over", "The amount is more than your balance of " + store.balance.toFixed(2) + " at " + store.name + ".");
      var method = methodById(data.method);
      if (!method) throw requestError("method", "Choose a payment method.");
      var reference = String(data.reference || "").trim().replace(/\s+/g, " ");
      if (method.reference === "none") reference = "";
      else if (method.reference === "required" && !reference) throw requestError("reference", "Enter the reference number.");
      if (reference && !REFERENCE_FORMAT.test(reference)) throw requestError("reference", "The reference number should be 6 to 30 letters or numbers.");
      var note = String(data.note || "").trim();
      if (note.length > NOTE_MAX) throw requestError("note", "Keep your message to " + NOTE_MAX + " characters or fewer.");

      // The same request must not be sent twice while the first is still waiting (same store, amount, method and reference).
      var twin = home.activity.filter(function (a) {
        return a.type === "request" && a.status === "pending" && a.storeId === store.id && round2(a.amount) === amount && a.method === method.label && String(a.reference || "").toLowerCase() === reference.toLowerCase();
      })[0];
      if (twin) throw requestError("duplicate", "You already sent this payment request to " + store.name + " and it is waiting for review. Check My Payments before sending it again.");

      var proof = null;
      if (data.proof && data.proof.name) {
        var url = String(data.proof.dataUrl || "");
        proof = { name: String(data.proof.name).slice(0, 80), type: data.proof.type || "image/jpeg", dataUrl: url.length <= PROOF_MAX_CHARS ? url : "" };
      }
      var request = { id: newRequestId(), requestId: data.requestId || "", storeId: store.id, type: "request", status: "pending",
        title: method.label + " payment request", method: method.label, amount: amount, date: new Date().toISOString(),
        reference: reference, note: note, proof: proof };

      // Saved with the stores joined in the demo (thrown away with it) or with the real records, never into both.
      function save(withProof) {
        var entry = Object.assign({}, request, withProof ? {} : { proof: proof ? { name: proof.name, type: proof.type, dataUrl: "" } : null });
        if (isDemo()) { var d = demoJoined(); d.activity = d.activity.concat([entry]); write(KEY_DEMO_JOINED, JSON.stringify(d)); return read(KEY_DEMO_JOINED) === JSON.stringify(d); }
        var r = recordsFromStorage(); r.activity = r.activity.concat([entry]); write(KEY_RECORDS, JSON.stringify(r)); return read(KEY_RECORDS) === JSON.stringify(r);
      }
      // If storage is full, keep the request and leave the receipt picture out.
      if (!save(true)) { request.proof = proof ? { name: proof.name, type: proof.type, dataUrl: "" } : null; save(false); }
      return { request: request, store: { id: store.id, name: store.name, balance: store.balance }, duplicate: false };
    });
  }

  // One transaction for the Transaction Details screen, found by its record id (the History list links with ?id=).
  // Resolves { isSample, transaction } where transaction is null when the id is unknown. Credits carry `items`
  // (empty when the record has none, for example a credit record linked from a store); payments carry method,
  // reference and note. `code` is the display Transaction ID (act-2 -> TRX-0002).
  function transactionCode(id) {
    var m = /^act-(\d+)$/.exec(String(id));
    if (m) return "TRX-" + ("0000" + m[1]).slice(-4);
    var h = 0, text = String(id);
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 9000;
    return "TRX-" + (1000 + h);
  }
  function getTransaction(id) {
    return getRecords().then(function (home) {
      var a = home.activity.filter(function (x) { return x.id === id; })[0];
      if (!a) return { isSample: home.isSample, transaction: null };
      var items = (a.items || []).map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit || "", price: i.price, amount: round2(i.qty * i.price) }; });
      return { isSample: home.isSample, transaction: Object.assign({}, a, { code: a.code || transactionCode(a.id), items: items, reference: a.reference || "", note: a.note || "", dueDate: a.dueDate || "" }) };
    });
  }

  // One payment for the Payment Request Details screen (customer/payment-request-details?id=), found by its record id.
  // Resolves { isSample, request } where request is null when the id is unknown or is not a payment (credits and
  // payments imported from a linked record are not payment requests). The status is worked out with the same rule as
  // getPayments(), so the list and this screen can never disagree:
  //   pending    submitted, the store has not reviewed it (balance unchanged)
  //   completed  the store approved the request, or recorded the payment itself (balance lowered)
  //   rejected   the store did not accept it (balance unchanged); rejectionReason is the store's reason
  // request: { id, code, storeId, storeName, method, amount, reference, note, proof ({ name, dataUrl } or null), submittedAt,
  //            status, reviewedAt (approval / rejection date, "" when pending), rejectionReason, fromRequest, confirmationCode }
  function getPaymentRequest(id) {
    if (!isDemo()) {
      return window.CrediTrackHttp("/customer/payment-requests/" + encodeURIComponent(id)).then(function (r) {
        var status = r.customerStatus;
        return { isSample: false, request: {
          id: String(r.id), code: r.code, storeId: String(r.customerId), storeName: r.storeName, method: r.method || "", amount: round2(r.amount),
          reference: r.reference || "", note: r.message || "",
          proof: r.proof ? { name: "Proof of payment", dataUrl: r.proof } : (r.hasProof ? { name: "Proof of payment", dataUrl: "" } : null),
          submittedAt: r.submittedAt, status: status, reviewedAt: status === "pending" ? "" : (r.reviewedAt || ""),
          rejectionReason: status === "rejected" ? (r.rejectReason || "") : "", fromRequest: true,
          confirmationCode: status === "completed" ? (r.transactionCode || "") : ""
        } };
      }, function (err) {
        if (err && err.status === 404) return { isSample: false, request: null };   // the page shows "not found"
        throw err;
      });
    }
    return getRecords().then(function (home) {
      var a = home.activity.filter(function (x) { return x.id === id && (x.type === "request" || x.type === "payment") && String(x.id).indexOf("join-") !== 0; })[0];
      if (!a) return { isSample: home.isSample, request: null };
      var status = a.type === "request" && (a.status === "pending" || a.status === "rejected") ? a.status : "completed";
      var proof = a.proof && a.proof.name ? { name: a.proof.name, dataUrl: a.proof.dataUrl || "" } : null;
      return { isSample: home.isSample, request: {
        id: a.id, code: transactionCode(a.id), storeId: a.storeId, storeName: a.storeName, method: a.method || "", amount: round2(a.amount),
        reference: a.reference || "", note: a.note || "", proof: proof, submittedAt: a.date, status: status,
        reviewedAt: status === "pending" ? "" : (a.reviewedAt || (status === "completed" ? a.date : "")),
        rejectionReason: status === "rejected" ? (a.rejectionReason || "") : "",
        fromRequest: a.type === "request" || !!a.viaRequest, confirmationCode: status === "completed" ? transactionCode(a.id) : ""
      } };
    });
  }

  // =====================  Notifications  =====================
  // The Notifications screen (customer/notifications). Nothing extra is stored except which ones were read:
  // every notification is worked out from the same records as Home, History and Payments, so it can never disagree with them.
  //   payment_pending / payment_approved / payment_rejected   updates on the customer's payment requests
  //   payment_recorded / credit_recorded                      store activity: a payment or credit the store recorded
  //   store_joined / welcome / balance_reminder / overdue     account alerts (welcome and balance reminders are sample-only)
  // Shape: { id, type, title, message, createdAt, read, target }
  //   target: { kind: "request", id } | { kind: "transaction", id } | { kind: "history", storeId } | null (where tapping it goes)
  // Read marks live with the records (the demo's marks are thrown away with the demo on log out). A notification older than
  // NOTIF_NEW_DAYS calendar days counts as already seen, so a long history does not all show up as unread.
  var NOTIF_NEW_DAYS = 2;
  function pesoText(n) { return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function calendarDaysAgo(iso) {
    var a = new Date(), b = new Date(iso);
    return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
  }
  function readMarks() { return (isDemo() ? demoJoined() : recordsFromStorage()).read; }
  function writeReadMarks(ids) {
    if (isDemo()) { var d = demoJoined(); d.read = ids; write(KEY_DEMO_JOINED, JSON.stringify(d)); }
    else { var r = recordsFromStorage(); r.read = ids; write(KEY_RECORDS, JSON.stringify(r)); }
  }

  // Real account: the server makes the notifications (the store approved or rejected a payment request, recorded a credit or
  // a payment, linked the account) and keeps which ones were read. A server notification points at a record:
  // request -> "<id>" (a plain number, like the Payments list), transaction -> "tx-<id>", history -> the store's customer id (the same ids the other pages use).
  function customerNotificationFromApi(n) {
    var t = n.target, target = null;
    if (t && t.kind === "request") target = { kind: "request", id: String(t.id) };   // the plain number: GET /customer/payment-requests/{id} only accepts a number (same id the Payments list uses)
    else if (t && t.kind === "transaction") target = { kind: "transaction", id: "tx-" + t.id };
    else if (t && t.kind === "history") target = { kind: "history", storeId: String(t.id) };
    else if (t && t.kind === "link_request") target = { kind: "stores" };   // a store asks to link my account: answer it under My Stores > Requests
    return { id: n.id, type: n.type, title: n.title, message: n.message, createdAt: n.createdAt, read: !!n.read, target: target };
  }
  function getNotificationsApi() {
    return Promise.all([window.CrediTrackHttp("/notifications"), storesFromApi().catch(function () { return []; })]).then(function (res) {
      var list = (res[0].notifications || []).map(customerNotificationFromApi);
      var hasStores = res[1].some(function (s) { return s.connected; });
      return { isSample: false, hasStores: hasStores, notifications: list, total: res[0].total || list.length, unread: res[0].unread || 0 };
    });
  }
  function getUnreadNotificationCount() {
    if (isDemo()) return getNotifications().then(function (d) { return d.unread; }, function () { return 0; });
    return window.CrediTrackHttp("/notifications/unread-count").then(function (r) { return (r && r.unread) || 0; }, function () { return 0; });
  }

  function getNotifications() {
    if (!isDemo()) return getNotificationsApi();
    return getHome().then(function (home) {
      var list = [], methodWord = function (a) { return a.method ? a.method + " " : ""; };
      function add(id, type, title, message, createdAt, target) { list.push({ id: id, type: type, title: title, message: message, createdAt: createdAt, target: target || null }); }

      home.activity.forEach(function (a) {
        if (String(a.id).indexOf("join-") === 0) return;   // imported from a linked record: covered by "Store Joined"
        var store = a.storeName || "the store", when = a.reviewedAt || a.date;
        if (a.type === "request" && a.status === "pending") {
          add("pay-" + a.id, "payment_pending", "Payment Request Pending", "Your " + methodWord(a) + "payment request of " + pesoText(a.amount) + " to " + store + " is waiting for the store owner\u2019s review. Your balance has not changed yet.", a.date, { kind: "request", id: a.id });
        } else if (a.type === "request" && a.status === "rejected") {
          add("pay-" + a.id, "payment_rejected", "Payment Request Rejected", store + " did not accept your " + methodWord(a) + "payment request of " + pesoText(a.amount) + "." + (a.rejectionReason ? " Reason: " + a.rejectionReason : "") + " Your balance was not changed.", when, { kind: "request", id: a.id });
        } else if (a.type === "request" || (a.type === "payment" && a.viaRequest)) {
          add("pay-" + a.id, "payment_approved", "Payment Request Approved", store + " approved your " + methodWord(a) + "payment of " + pesoText(a.amount) + ". It was deducted from your balance.", when, { kind: "request", id: a.id });
        } else if (a.type === "payment") {
          add("pay-" + a.id, "payment_recorded", "Payment Recorded", store + " recorded your " + (a.method ? a.method.toLowerCase() + " " : "") + "payment of " + pesoText(a.amount) + ".", a.date, { kind: "transaction", id: a.id });
        } else if (a.type === "credit") {
          add("credit-" + a.id, "credit_recorded", "Credit Recorded", store + " recorded a credit of " + pesoText(a.amount) + " for you" + (a.title ? " (" + a.title + ")" : "") + ".", a.date, { kind: "transaction", id: a.id });
        }
      });

      home.stores.forEach(function (s) {
        add("joined-" + s.id, "store_joined", "Store Joined", "You joined " + s.name + ". Your credits, payments and balance there now show in CrediTrack.", s.joinedAt, { kind: "history", storeId: s.id });
        if (s.overdueAmount > 0) {
          var last = home.activity.filter(function (a) { return a.storeId === s.id; })[0];
          add("overdue-" + s.id, "overdue", "Account Overdue", "Your account at " + s.name + " is overdue. Overdue amount: " + pesoText(s.overdueAmount) + ".", last ? last.date : s.joinedAt, { kind: "history", storeId: s.id });
        }
        if (home.isSample && s.balance > 0) {
          add("balance-" + s.id, "balance_reminder", "Balance Reminder", "You have an unpaid balance of " + pesoText(s.balance) + " at " + s.name + ".", daysAgo(1, 8, 0), { kind: "history", storeId: s.id });
        }
      });
      if (home.isSample) add("welcome", "welcome", "Welcome to CrediTrack", "Your demo customer account is ready. Join stores, check your credits and send payment requests.", daysAgo(40, 8, 0), null);

      var marks = readMarks();
      list.forEach(function (n) { n.read = marks.indexOf(n.id) !== -1 || calendarDaysAgo(n.createdAt) > NOTIF_NEW_DAYS; });
      list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      return { isSample: home.isSample, hasStores: home.stores.length > 0, notifications: list, total: list.length, unread: list.filter(function (n) { return !n.read; }).length };
    });
  }

  // Saved straight away (not after a lookup), so opening a notification marks it read before the next page loads.
  function markNotificationRead(id) {
    if (!isDemo()) return window.CrediTrackHttp("/notifications/" + encodeURIComponent(id) + "/read", { method: "POST" }).then(function () { return { id: id }; });
    var marks = readMarks().slice();
    if (marks.indexOf(id) === -1) { marks.push(id); writeReadMarks(marks); }
    return Promise.resolve({ id: id });
  }
  function markAllNotificationsRead() {
    if (!isDemo()) return window.CrediTrackHttp("/notifications/read-all", { method: "POST" }).then(function (r) { return { changed: (r && r.changed) || 0 }; });
    return getNotifications().then(function (data) {
      var marks = readMarks().slice(), changed = 0;
      data.notifications.forEach(function (n) { if (!n.read && marks.indexOf(n.id) === -1) { marks.push(n.id); changed++; } });
      if (changed) writeReadMarks(marks);
      return { changed: changed };
    });
  }

  // Totals for "all stores" (storeId empty) or for one store. Pure: works on what getHome() returned,
  // so the page never adds money up itself and the History and Payments pages can reuse it.
  function summarize(home, storeId) {
    var stores = storeId ? home.stores.filter(function (s) { return s.id === storeId; }) : home.stores;
    var sum = function (key) { return round2(stores.reduce(function (t, s) { return t + s[key]; }, 0)); };
    var balance = sum("balance"), paid = sum("totalPaid"), overdue = sum("overdueAmount");
    var pending = pendingOf(home.activity, storeId || "");
    return {
      storeCount: stores.length, balance: balance, totalCredit: sum("totalCredit"), totalPaid: paid,
      overdueAmount: overdue, status: statusFor(balance, paid, overdue),
      pendingCount: pending.count, pendingAmount: pending.amount
    };
  }

  // =====================  Join a Store (mock data only)  =====================
  // A store is found by its Store Code (typed, or read from the store's QR code, which holds CREDITRACK:JOIN:<store code>).
  // Where stores come from:
  //   - the Store Owner who signed up in this browser (real, read from the owner's own records)
  //   - fictional sample stores, only while the demo account / sample preview is on (never mixed into a real account)
  // customerRecords are the credit records a store already keeps for its customers, so a customer can link one by customer code.
  function sampleDirectory() {
    return [
      { code: "STR-001", name: "Aling Nena's Store", type: "Sari-Sari Store", location: "Brgy. Poblacion, Lipa City, Batangas", owner: "Nena Reyes",
        customerRecords: [{ code: "CUS-001", name: "Ana Santos", totalCredit: 500, totalPaid: 200, overdueAmount: 0 }] },
      { code: "STR-002", name: "Mang Tony's Store", type: "Sari-Sari Store", location: "Brgy. Sabang, Lipa City, Batangas", owner: "Tony Mercado",
        customerRecords: [{ code: "CUS-004", name: "Ana Santos", totalCredit: 900, totalPaid: 450, overdueAmount: 0 }] },
      { code: "STR-003", name: "Kuya Ben's Mini Mart", type: "Mini Mart", location: "Brgy. Marawoy, Lipa City, Batangas", owner: "Benjie Santos",
        customerRecords: [
          { code: "CUS-014", name: "Ana Santos", totalCredit: 800, totalPaid: 300, overdueAmount: 0 },
          { code: "CUS-021", name: "Rico Dela Peña", totalCredit: 300, totalPaid: 300, overdueAmount: 0 },
          { code: "CUS-030", name: "Lita Gomez", totalCredit: 250, totalPaid: 0, overdueAmount: 250, linkedToAnother: true }   // already linked to another account
        ] },
      { code: "STR-004", name: "Ate Lorna's Sari-Sari", type: "Sari-Sari Store", location: "Brgy. Antipolo del Norte, Lipa City, Batangas", owner: "Lorna Dizon",
        customerRecords: [{ code: "CUS-007", name: "Mario Cruz", totalCredit: 450, totalPaid: 100, overdueAmount: 0 }] },
      { code: "CT-DEMO01", name: "Demo Store (Sample)", type: "Sari-Sari Store", location: "Sample Street, Barangay Sample, Sample City", owner: "Demo Store Owner",
        customerRecords: [{ code: "CUS-002", name: "Juan Dela Cruz", totalCredit: 655, totalPaid: 0, overdueAmount: 0 }] }
    ];
  }
  // The Store Owner who signed up in this browser, as a store customers can join (needs the store code the owner's Store QR page makes).
  function ownerStore() {
    var o = readJson(KEY_OWNER, null);
    if (!o || !o.storeCode || !o.storeName) return null;
    var recs = readJson(KEY_OWNER_RECORDS, null) || { customers: [], transactions: [] };
    var customerRecords = (recs.customers || []).map(function (c) {
      var credit = 0, paid = 0;
      (recs.transactions || []).forEach(function (t) { if (t.customerId === c.id) { if (t.type === "credit") credit += t.amount; else if (t.type === "payment") paid += t.amount; } });
      return { code: c.code, name: c.name, totalCredit: round2(credit), totalPaid: round2(paid), overdueAmount: 0, linkedToAnother: !!c.linkedAccount };
    });
    return { code: o.storeCode, name: o.storeName, type: o.businessType || "Sari-Sari Store", location: o.storeAddress || "Address not provided", owner: o.fullName || "Store Owner", customerRecords: customerRecords };
  }
  function directory() {
    var list = isDemo() ? sampleDirectory() : [];
    var real = ownerStore();
    if (real) list.push(real);
    return list;
  }
  function joinedStores() {
    var r = isDemo() ? sampleRecords() : recordsFromStorage();
    var all = r.stores.slice();
    if (isDemo()) all = all.concat(demoJoined().stores);
    return all;
  }

  function wasLeft(store) { return loadAll().stores.some(function (s) { return s.code === store.code && !s.connected; }); }
  function joinError(code, message) { var e = new Error(message); e.code = code; return e; }
  // "str-001", "STR 001", "creditrack:join:str-001" -> "STR-001"
  function normalizeStoreCode(input) {
    var v = String(input || "").trim().toUpperCase().replace(/^CREDITRACK:JOIN:/, "").replace(/\s+/g, "");
    return v.replace(/^(STR|CT)-?([A-Z0-9]{3,8})$/, "$1-$2");   // "STR004" and "STR 004" work too
  }
  var STORE_CODE_FORMAT = /^[A-Z]{2,3}-[A-Z0-9]{3,8}$/;
  var CUSTOMER_CODE_FORMAT = /^CUS-\d{3,6}$/;
  function normalizeCustomerCode(input) { return String(input || "").trim().toUpperCase().replace(/\s+/g, ""); }
  function storeId(code) { return String(code).toLowerCase(); }
  function maskName(name) {     // "Ana Santos" -> "Ana S." (the customer confirms it is theirs without the whole name being shown)
    var parts = String(name || "").trim().split(/\s+/);
    return parts.length > 1 ? parts[0] + " " + parts[parts.length - 1].charAt(0) + "." : parts[0] || "";
  }

  // Step: Enter Store Code / Scan Store QR -> the store, or an Error with .code: empty | format | not_found | joined
  function findStore(input) {
    if (!isDemo()) return findStoreApi(input);
    var code = normalizeStoreCode(input);
    if (!code) return Promise.reject(joinError("empty", "Enter the store code."));
    if (!STORE_CODE_FORMAT.test(code)) return Promise.reject(joinError("format", "That code does not look right. Store codes look like STR-001 or CT-AB12CD."));
    var found = directory().filter(function (s) { return s.code === code; })[0];
    if (!found) return Promise.reject(joinError("not_found", "We could not find a store with this code. Check it with the store owner."));
    var joined = joinedStores().some(function (s) { return s.id === storeId(found.code) || s.code === found.code; });
    if (joined) return Promise.reject(joinError("joined", wasLeft(found) ? found.name + " is in your Connected Stores as disconnected. Reconnect it from Profile > Connected Stores." : found.name + " is already in your My Stores."));
    return Promise.resolve({ code: found.code, name: found.name, type: found.type, location: found.location, owner: found.owner });
  }

  // Step: Link Existing Customer Record -> what the store has on file for that customer code, or an Error with
  // .code: empty | format | not_found | linked.  Nothing is saved here.
  function lookupRecord(storeCode, customerCode) {
    if (!isDemo()) return Promise.reject(joinError("owner_link", "To link an existing record, ask the store owner to enter your customer code."));
    var store = directory().filter(function (s) { return s.code === normalizeStoreCode(storeCode); })[0];
    if (!store) return Promise.reject(joinError("store_missing", "That store could not be found. Go back and enter the store code again."));
    var code = normalizeCustomerCode(customerCode);
    if (!code) return Promise.reject(joinError("empty", "Enter your customer code, or choose \u201CI don\u2019t have a code\u201D."));
    if (!CUSTOMER_CODE_FORMAT.test(code)) return Promise.reject(joinError("format", "That does not look like a customer code. It looks like CUS-014."));
    var rec = store.customerRecords.filter(function (r) { return r.code === code; })[0];
    if (!rec) return Promise.reject(joinError("not_found", "This store has no customer record with that code. Check the code with the store owner."));
    if (rec.linkedToAnother) return Promise.reject(joinError("linked", "This record is already linked to another CrediTrack account. Ask the store owner for help."));
    var balance = Math.max(0, round2(rec.totalCredit - rec.totalPaid));
    return Promise.resolve({ code: rec.code, nameHint: maskName(rec.name), totalCredit: round2(rec.totalCredit), totalPaid: round2(rec.totalPaid), balance: balance });
  }

  // Step: Join Success. Saves the store (and the linked record, if any). Rejects with .code joined | store_missing | plus lookupRecord's.
  // Without a linked record the customer starts with no credit at this store (balance 0.00), kept apart from every other store.
  function joinStore(data) {
    data = data || {};
    if (!isDemo()) return joinStoreApi(data);
    var store = directory().filter(function (s) { return s.code === normalizeStoreCode(data.storeCode); })[0];
    if (!store) return Promise.reject(joinError("store_missing", "That store could not be found. Go back and enter the store code again."));
    if (joinedStores().some(function (s) { return s.id === storeId(store.code) || s.code === store.code; })) return Promise.reject(joinError("joined", wasLeft(store) ? store.name + " is in your Connected Stores as disconnected. Reconnect it from Profile > Connected Stores." : store.name + " is already in your My Stores."));
    var link = data.customerCode ? lookupRecord(store.code, data.customerCode) : Promise.resolve(null);
    return link.then(function (rec) {
      var now = new Date().toISOString();
      var entry = { id: storeId(store.code), code: store.code, name: store.name, type: store.type, location: store.location, owner: store.owner, joinedAt: now,
        totalCredit: rec ? rec.totalCredit : 0, totalPaid: rec ? rec.totalPaid : 0, overdueAmount: rec ? (store.customerRecords.filter(function (r) { return r.code === rec.code; })[0].overdueAmount || 0) : 0,
        linkedRecord: rec ? rec.code : "" };
      // The linked record's credit and payments show up in Recent Activity, so the activity always adds up to the store's totals.
      var activity = [];
      if (rec && rec.totalCredit > 0) activity.push({ id: "join-" + entry.id + "-c", storeId: entry.id, type: "credit", title: "Existing credit record (" + rec.code + ")", amount: rec.totalCredit, date: now, status: "unpaid" });
      if (rec && rec.totalPaid > 0) activity.push({ id: "join-" + entry.id + "-p", storeId: entry.id, type: "payment", title: "Payments on your existing record", amount: rec.totalPaid, date: new Date(Date.now() - 1000).toISOString(), status: "recorded" });
      if (isDemo()) {
        var d = demoJoined();
        d.stores.push(entry); d.activity = d.activity.concat(activity);
        write(KEY_DEMO_JOINED, JSON.stringify(d));
      } else {
        var r = recordsFromStorage();
        r.stores.push(entry); r.activity = r.activity.concat(activity);
        write(KEY_RECORDS, JSON.stringify(r));
      }
      var balance = Math.max(0, round2(entry.totalCredit - entry.totalPaid));
      return { store: { id: entry.id, code: entry.code, name: entry.name, type: entry.type, location: entry.location, owner: entry.owner }, linked: !!rec, linkedRecord: entry.linkedRecord, balance: balance };
    });
  }

  // =====================  Connected Stores (mock data only)  =====================
  // The Connected Stores screen (customer/stores, opened from Profile). Every store keeps its OWN balance and
  // records: nothing here adds stores together.
  //   connected     stores the customer is connected to (the ones Home, Pay and My Stores use)
  //   disconnected  stores the customer left. They keep their balance and every transaction (History and Payments still
  //                 list them); they just stop appearing in My Stores and cannot be paid from the app until reconnected.
  // Each store: { id, code, name, type, location, owner, linkedRecord, joinedAt, connected, disconnectedAt, balance, totalCredit,
  //               totalPaid, status, pendingCount, pendingAmount, transactionCount, lastActivityAt }
  function getConnectedStores() {
    if (!isDemo()) return getConnectedStoresApi();
    return getRecords().then(function (all) {
      return { isSample: all.isSample, connected: all.stores.filter(function (s) { return s.connected; }),
        disconnected: all.stores.filter(function (s) { return !s.connected; }) };
    });
  }

  // Leave a store. Only the connection changes: the store's credits, payments, requests and balance are NOT touched.
  // -> { store: { id, name, balance }, recordsKept } or an Error with .code: store | already | storage
  function setConnection(id, connect) {
    if (!isDemo()) return setConnectionApi(id, connect);
    var all = loadAll();
    var store = all.stores.filter(function (s) { return s.id === id; })[0];
    if (!store) return Promise.reject(joinError("store", "That store could not be found."));
    if (store.connected === connect) return Promise.reject(joinError("already", connect ? store.name + " is already connected." : "You already left " + store.name + "."));
    var now = connect ? "" : new Date().toISOString();
    var saved;
    if (isDemo()) {
      var d = demoJoined();
      if (connect) delete d.disconnected[id]; else d.disconnected[id] = now;
      d.stores.forEach(function (e) { if (e.id === id) { if (connect) delete e.disconnectedAt; else e.disconnectedAt = now; } });
      write(KEY_DEMO_JOINED, JSON.stringify(d));
      saved = read(KEY_DEMO_JOINED) === JSON.stringify(d);
    } else {
      var r = recordsFromStorage();
      r.stores.forEach(function (e) { if (e.id === id) { if (connect) delete e.disconnectedAt; else e.disconnectedAt = now; } });
      write(KEY_RECORDS, JSON.stringify(r));
      saved = read(KEY_RECORDS) === JSON.stringify(r);
    }
    if (!saved) return Promise.reject(joinError("storage", "We could not save this change. Check that your browser allows storage and try again."));
    return Promise.resolve({ store: { id: store.id, name: store.name, balance: store.balance }, recordsKept: store.transactionCount });
  }
  function disconnectStore(id) { return setConnection(id, false); }
  function reconnectStore(id) { return setConnection(id, true); }

  // Sample store codes the customer can try (demo / sample preview only; a real account has none).
  function getSampleStoreCodes() {
    if (!isDemo()) return [];
    var joined = joinedStores();
    return sampleDirectory().filter(function (s) { return !joined.some(function (j) { return j.code === s.code; }); })
      .map(function (s) { return { code: s.code, name: s.name, records: s.customerRecords.filter(function (r) { return !r.linkedToAnother; }).map(function (r) { return r.code; }) }; });
  }

  window.CrediTrackCustomerApi = {
    getProfile: getProfile, getPersonalInfo: getPersonalInfo, getAppInfo: getAppInfo, getNotificationPreferences: getNotificationPreferences, saveNotificationPreferences: saveNotificationPreferences, NOTIFICATION_PREF_KEYS: NOTIFICATION_PREF_KEYS, changePassword: changePassword, getSecurityInfo: getSecurityInfo, validatePasswordChange: validatePasswordChange, passwordRulesMet: passwordRulesMet, getCustomerIdentity: getCustomerIdentity, parseCustomerCode: parseCustomerCode, customerQrText: customerQrText, saveProfile: saveProfile, updateProfile: updateProfile, validateProfile: validateProfile, parsePhone: parsePhone, formatPhone: formatPhone,
    getRequests: getRequests, acceptRequest: acceptRequest, declineRequest: declineRequest, cancelRequest: cancelRequest,
    findStore: findStore, lookupRecord: lookupRecord, joinStore: joinStore, getSampleStoreCodes: getSampleStoreCodes, normalizeStoreCode: normalizeStoreCode,
    getCustomer: getCustomer, getHome: getHome, getHistory: getHistory, getConnectedStores: getConnectedStores, disconnectStore: disconnectStore, reconnectStore: reconnectStore, getPayments: getPayments, queryPayments: queryPayments, getPaymentRequest: getPaymentRequest, getNotifications: getNotifications, markNotificationRead: markNotificationRead, markAllNotificationsRead: markAllNotificationsRead, getUnreadNotificationCount: getUnreadNotificationCount, getPayableStores: getPayableStores, getStorePaymentAccounts: getStorePaymentAccounts, submitPaymentRequest: submitPaymentRequest, PAYMENT_METHODS: PAYMENT_METHODS, NOTE_MAX: NOTE_MAX, getTransaction: getTransaction, summarize: summarize,
    isDemo: isDemo, isDemoLogin: isDemoLogin, setDemo: setDemo,
    isDemoEmail: isDemoEmail, startDemoLogin: startDemoLogin, DEMO_EMAIL: DEMO_EMAIL, DEMO_NAME: DEMO_NAME
  };
})();
