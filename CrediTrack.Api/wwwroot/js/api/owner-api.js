/* Store Owner data layer.

   There is NO backend or database yet. This file is the only place that knows
   where data comes from, so pages never read storage or sample data directly.
   When the ASP.NET Core API exists, replace the body of each function with a
   fetch() call, for example:
     return fetch("/api/owner/dashboard").then(function (r) { return r.json(); });

   Two kinds of data, kept apart on purpose:
   1. RECORDS  The owner's own customers, transactions and payment requests.
               Nothing creates records yet, so a new owner always has none.
   2. SAMPLE   Fictional data for demonstrations, shown only while demo mode is
               on. It is never merged with or saved as records. While demo mode is on,
               the Customers pages can add and edit sample customers, but those changes live
               only in a temporary working copy (sessionStorage) that is thrown away when
               demo mode is switched off or the demo owner logs out. */
(function () {
  "use strict";

  var KEY_OWNER = "creditrack.owner";     // mock sign-up profile (never the password)
  var KEY_RECORDS = "creditrack.records"; // { customers: [], transactions: [], paymentRequests: [] }
  var KEY_DEMO = "creditrack.demo";       // "1" while sample data is shown
  var KEY_DEMO_DATA = "creditrack.demo.data"; // temporary working copy of the sample data (sessionStorage)
  var KEY_SETTINGS = "creditrack.owner.settings";       // real owner's settings: { notifications: {...} } (localStorage)
  var KEY_DEMO_SETTINGS = "creditrack.demo.settings";   // demo owner's profile edits + settings (sessionStorage, thrown away with the demo)

  // localStorage can be blocked (private windows), so fall back to memory.
  var memory = {};
  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return memory[key] || null; }
  }
  function write(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value);
    } catch (e) { if (value === null) delete memory[key]; else memory[key] = value; }
  }
  function readJson(key, fallback) {
    try { return JSON.parse(read(key)) || fallback; } catch (e) { return fallback; }
  }

  // The demo working copy is session-only: it is gone when the tab closes.
  var demoMemory = null;
  function readDemoData() {
    try { return JSON.parse(window.sessionStorage.getItem(KEY_DEMO_DATA)); } catch (e) { return demoMemory; }
  }
  function writeDemoData(records) {
    try {
      if (records === null) window.sessionStorage.removeItem(KEY_DEMO_DATA);
      else window.sessionStorage.setItem(KEY_DEMO_DATA, JSON.stringify(records));
    } catch (e) { demoMemory = records; }
    if (records === null) writeDemoSettings(null);   // a fresh sample copy also forgets the demo owner's profile edits
  }

  // The demo owner's profile edits and settings: session-only, like the sample data. Only read while signed in
  // with the demo account (demoSession), so they can never show up in a real account.
  var demoSettingsMemory = null;
  function readDemoSettings() {
    try { return JSON.parse(window.sessionStorage.getItem(KEY_DEMO_SETTINGS)) || {}; } catch (e) { return demoSettingsMemory || {}; }
  }
  function writeDemoSettings(settings) {
    try {
      if (settings === null) window.sessionStorage.removeItem(KEY_DEMO_SETTINGS);
      else window.sessionStorage.setItem(KEY_DEMO_SETTINGS, JSON.stringify(settings));
    } catch (e) { demoSettingsMemory = settings; }
  }

  // ---------- Owner profile ----------
  var DEMO_OWNER = {
    fullName: "Demo Store Owner", firstName: "Demo", storeName: "Demo Store (Sample)", email: "demo@creditrack.test", isDemo: true,
    contactNumber: "09170001234", storePhone: "09170005678", storeAddress: "Sample Street, Barangay Sample, Sample City"   // fictional
  };
  var DEMO_EMAIL = "demo@creditrack.test";

  function registerOwner(profile) {
    var fullName = (profile.fullName || "").trim();
    write(KEY_OWNER, JSON.stringify({
      fullName: fullName,
      firstName: fullName.split(" ")[0] || "",
      storeName: (profile.storeName || "").trim(),
      email: (profile.email || "").trim(),
      contactNumber: normalizePhone(profile.contactNumber),
      storePhone: normalizePhone(profile.storePhone),
      storeAddress: (profile.storeAddress || "").trim()
    }));
    write(KEY_SETTINGS, null); // and with default settings
    write(KEY_RECORDS, null); // a brand-new owner starts with no records
    write(KEY_DEMO, null);    // and with sample data off
    writeDemoData(null);
    return Promise.resolve();
  }
  function demoSession() {
    var s = window.CrediTrackSession && window.CrediTrackSession.get();
    return !!(s && s.demo);
  }
  function getOwner() {
    if (demoSession()) {                                      // demo login never shows (or touches) a real profile
      var edits = readDemoSettings().profile || {};
      var demo = Object.assign({}, DEMO_OWNER, edits);
      demo.firstName = String(demo.fullName || "").split(" ")[0];
      return Promise.resolve(demo);
    }
    var o = readJson(KEY_OWNER, null);
    return Promise.resolve(o || { fullName: "Store Owner", firstName: "", storeName: "Your Store" });
  }
  // Login helpers (mock: there is no password check until the backend exists)
  function isDemoEmail(email) { return String(email || "").trim().toLowerCase() === DEMO_EMAIL; }
  function matchesRegisteredOwner(email) {
    var o = readJson(KEY_OWNER, null);
    return !!(o && o.email && o.email.toLowerCase() === String(email || "").trim().toLowerCase());
  }
  function startDemoLogin() { write(KEY_DEMO, "1"); writeDemoData(null); }   // always a fresh sample copy
  function getRegisteredOwner() { return readJson(KEY_OWNER, null); }

  // ---------- Demo mode ----------
  function isDemo() { return read(KEY_DEMO) === "1"; }
  function setDemo(on) { write(KEY_DEMO, on ? "1" : null); writeDemoData(null); return Promise.resolve(); }

  // ---------- Sample data (fictional) ----------
  function minutesAgo(n) { return new Date(Date.now() - n * 60000).toISOString(); }
  function daysAgo(n, hour, minute) {
    var d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, minute, 0, 0); return d.toISOString();
  }
  function pad3(n) { return ("00" + n).slice(-3); }
  function codeFor(id) { return "CUS-" + pad3(id); }

  // Sample purchase lines for a credit. The note ("Rice, canned goods") is split into items and the amount is shared
  // between them so quantity x price always adds up to the credit's total.
  function sampleItems(note, amount, seed) {
    var names = String(note).split(",").map(function (n) { return n.trim(); }).filter(Boolean);
    var count = names.length, base = Math.floor(amount / count / 5) * 5, left = amount, qtys = [2, 3, 5, 1];
    return names.map(function (name, i) {
      var sub = i === count - 1 ? left : base;
      left -= sub;
      var qty = 1;
      for (var k = 0; k < qtys.length; k++) {
        var q = qtys[(seed + i + k) % qtys.length];
        if (sub % q === 0) { qty = q; break; }
      }
      return { name: name.charAt(0).toUpperCase() + name.slice(1), qty: qty, unit: /rice|sugar/i.test(name) ? "kg" : "pcs", price: sub / qty };
    });
  }
  function sampleReference(seed) {
    var digits = ("000000000000" + ((seed * 987654321) % 1000000000000)).slice(-12);
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  }

  // 34 customers: 12 with balances, 22 fully paid. Every balance equals credits minus payments of the
  // customer's own sample history, so the Customer Details page always adds up.
  function sampleRecords() {
    var debtors = [
      ["Jun Reyes", 2350, 12], ["Rosa Dizon", 1850, 8], ["Ben Torres", 1500, 5], ["Juan Dela Cruz", 1180, 0],
      ["Carla Bautista", 1100, 0], ["Lito Mendoza", 920, 0], ["Ana Cruz", 850, 0], ["Pedro Reyes", 780, 0],
      ["Maria Santos", 650, 0], ["Nora Villanueva", 520, 0], ["Eddie Ramos", 445, 0], ["Tess Aquino", 200, 0]
    ];
    var paid = ["Lorna Castillo", "Mario Pascual", "Gina Flores", "Dante Navarro", "Elena Soriano", "Rico Manalo",
      "Cora Bernardo", "Victor Salazar", "Liza Domingo", "Nestor Aguilar", "Fe Magno", "Romy Santiago",
      "Imelda Padilla", "Arnel Cortez", "Josie Valdez", "Boy Mercado", "Mila Francisco", "Totoy Enriquez",
      "Linda Gonzales", "Ramon Pineda", "Susan Lim", "Danilo Ocampo"];
    var customers = [];
    function addCustomer(name, balance, overdue, i) {
      var id = customers.length + 1;
      customers.push({
        id: id, code: codeFor(id), name: name, balance: balance, overdueDays: overdue,
        phone: "",
        createdAt: daysAgo(60 + i, 10, 0)
      });
    }
    debtors.forEach(function (d, i) { addCustomer(d[0], d[1], d[2], i); });
    paid.forEach(function (n, i) { addCustomer(n, 0, 0, i + 12); });
    // Fictional phone numbers (every third customer has none, to show the "Not provided" state)
    customers.forEach(function (c, i) { c.phone = i % 3 === 2 ? "" : "0917" + ("000" + (100 + i * 37)).slice(-3) + ("0000" + (4000 + i * 91)).slice(-4); });

    var transactions = [];
    function tx(customerId, type, amount, date, extra) {
      var t = { id: transactions.length + 1, customerId: customerId, type: type, amount: amount, date: date };
      if (type === "credit") { t.note = extra; t.items = sampleItems(extra, amount, t.id); }
      else {
        t.method = extra;
        if (extra !== "Cash") t.reference = sampleReference(t.id);   // e-wallet payments carry a (fictional) reference number
      }
      transactions.push(t);
    }
    // Newest activity (shown on the dashboard)
    tx(7, "payment", 500, daysAgo(0, 9, 42), "GCash");
    tx(1, "credit", 340, daysAgo(0, 8, 15), "Rice, canned goods");
    tx(6, "payment", 250, daysAgo(1, 17, 30), "Cash");
    tx(2, "credit", 185, daysAgo(1, 11, 5), "Cooking oil, eggs");
    tx(5, "payment", 1000, daysAgo(2, 15, 20), "Maya");
    // Older history that brings each debtor to the exact balance
    var notes = ["Rice, canned goods", "Cooking oil, noodles", "Eggs, coffee, sugar", "Soap, shampoo sachets", "Sardines, bread", "Load and snacks"];
    var featuredNet = { 1: 340, 2: 185, 5: -1000, 6: -250, 7: -500 };
    debtors.forEach(function (d, i) {
      var id = i + 1, remaining = d[1] - (featuredNet[id] || 0);
      if (remaining >= 400) {
        var first = Math.round(remaining * 0.6 / 5) * 5;
        tx(id, "credit", first, daysAgo(20 + i, 10 + (i % 6), 20), notes[i % notes.length]);
        tx(id, "credit", remaining - first, daysAgo(6 + i, 14, 5 + i), notes[(i + 2) % notes.length]);
      } else {
        tx(id, "credit", remaining, daysAgo(8 + i, 13, 40), notes[i % notes.length]);
      }
    });
    // Fully paid customers: one credit, settled later. Every seventh has no history at all (empty state).
    var methods = ["Cash", "GCash", "Maya"];
    paid.forEach(function (n, j) {
      if (j % 7 === 6) return;
      var id = 13 + j, amount = 60 + ((j * 35) % 440);
      amount = Math.round(amount / 5) * 5;
      tx(id, "credit", amount, daysAgo(30 + j, 9 + (j % 8), 15), notes[j % notes.length]);
      tx(id, "payment", amount, daysAgo(25 + j, 16, 30), methods[j % 3]);
    });

    var data = {
      customers: customers,
      transactions: transactions,
      paymentRequests: [
        { id: 1, customerId: 4, customer: "Juan Dela Cruz", method: "GCash", amount: 300, submittedAt: minutesAgo(5), status: "pending" },
        { id: 2, customerId: 9, customer: "Maria Santos", method: "GCash", amount: 150, submittedAt: minutesAgo(12), status: "pending" }
      ]
    };
    applySampleDueDates(data);
    enrichSampleRequests(data);
    applySampleAccounts(data);
    data.notifications = sampleNotifications(data);
    return data;
  }

  // ---------- Sample payment requests (fictional) ----------
  // A payment request is what a customer sends after paying outside the app (GCash, Maya, bank transfer ...):
  //   { id, customerId, customer, method, amount, submittedAt, status: "pending" | "approved" | "rejected",
  //     reference (the payment's reference number, may be ""), proof (a picture of the receipt as a data URL, or ""), note (message from the customer),
  //     reviewedAt, rejectionReason (rejected only), transactionId (approved only: the payment it created) }
  // Only an APPROVED request creates a payment transaction and lowers the customer's balance (approvePaymentRequest). Rejected ones never do.
  function sampleProof(request) {   // a plain, fictional receipt picture (no real brand), so "uploaded proof" can be shown without any upload
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="400" viewBox="0 0 360 400"><rect width="360" height="400" fill="#f3f8f8"/>' +
      '<rect x="20" y="20" width="320" height="360" rx="18" fill="#fff" stroke="#d6e4e6"/>' +
      '<circle cx="180" cy="92" r="30" fill="#086B70"/><path d="M165 92l11 11 20-22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="180" y="156" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#071A52">Payment Sent</text>' +
      '<text x="180" y="204" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#071A52">' + pesoText(request.amount).replace("\u20B1", "PHP ") + '</text>' +
      '<line x1="48" y1="240" x2="312" y2="240" stroke="#d6e4e6"/>' +
      '<text x="48" y="278" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Sent via</text><text x="312" y="278" text-anchor="end" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#071A52">' + request.method + '</text>' +
      '<text x="48" y="316" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Ref. No.</text><text x="312" y="316" text-anchor="end" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#071A52">' + request.reference + '</text>' +
      '<text x="48" y="354" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Sample receipt</text><text x="312" y="354" text-anchor="end" font-family="Arial,sans-serif" font-size="14" fill="#52627e">Not a real payment</text>' +
      '</svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function enrichSampleRequests(records) {
    var reqs = records.paymentRequests;
    function byId(id) { return reqs.filter(function (r) { return r.id === id; })[0]; }
    function customerNamed(name) { return records.customers.filter(function (c) { return c.name === name; })[0]; }
    var one = byId(1), two = byId(2);
    if (one) { one.reference = one.reference || "4821 573 906 112"; one.note = one.note || "Pambayad po sa utang ko. Salamat!"; one.proof = one.proof || sampleProof(one); }
    if (two) { two.reference = two.reference || "7305 118 442 690"; two.note = two.note || ""; two.proof = two.proof || ""; }   // no proof uploaded: shows that state
    var carla = customerNamed("Carla Bautista"), rosa = customerNamed("Rosa Dizon");
    var carlaPay = carla ? records.transactions.filter(function (t) { return t.customerId === carla.id && t.type === "payment"; })[0] : null;
    if (carla && carlaPay && !byId(3)) {
      var r3 = { id: 3, customerId: carla.id, customer: carla.name, method: carlaPay.method, amount: carlaPay.amount, submittedAt: daysAgo(2, 15, 5), status: "approved",
        reference: carlaPay.reference || "9012 664 310 275", note: "", reviewedAt: daysAgo(2, 15, 20), transactionId: carlaPay.id };
      r3.proof = sampleProof(r3);
      reqs.push(r3);
    }
    if (rosa && !byId(4)) {
      reqs.push({ id: 4, customerId: rosa.id, customer: rosa.name, method: "GCash", amount: 50, submittedAt: daysAgo(1, 14, 0), status: "rejected",
        reference: "5530 281 007 943", proof: "", note: "Bayad ko po ito kahapon.", reviewedAt: daysAgo(1, 14, 10), rejectionReason: "We could not find this payment in our GCash account. Please check the reference number and send it again." });
    }
    records.requestDetails = true;   // marks the copy as having its sample request details
  }

  // ---------- Sample due dates (fictional) ----------
  // A credit may carry an agreed payment date: dueDate "YYYY-MM-DD". Credits without one have "no fixed date" and can never be overdue.
  // The sample customers who are overdue (Jun Reyes 12 days, Rosa Dizon 8, Ben Torres 5) get due dates that match their overdueDays,
  // so the Dashboard, Customer Details and the Overdue Accounts page agree. A few others get future dates, and one fully paid credit has a
  // past date (paid, so it is not overdue). Offsets are days from today (negative = in the past), one per credit, oldest credit first; null = no fixed date.
  var SAMPLE_DUE_OFFSETS = {
    "Jun Reyes": [-12, -2, null],
    "Rosa Dizon": [-8, 14, null],
    "Ben Torres": [-5, 3],
    "Carla Bautista": [5, 20],
    "Lito Mendoza": [7, 21],
    "Lorna Castillo": [-20]
  };
  function applySampleDueDates(records) {
    var now = new Date();
    Object.keys(SAMPLE_DUE_OFFSETS).forEach(function (name) {
      var customer = records.customers.filter(function (c) { return c.name === name; })[0];
      if (!customer) return;
      var credits = records.transactions.filter(function (t) { return t.customerId === customer.id && t.type === "credit"; })
        .sort(function (a, b) { return new Date(a.date) - new Date(b.date) || a.id - b.id; });
      SAMPLE_DUE_OFFSETS[name].forEach(function (offset, i) {
        if (credits[i] && offset !== null) credits[i].dueDate = localISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
      });
    });
    records.dueDates = true;   // marks the copy as having its sample due dates
  }

  // ---------- Sample customer accounts and linking codes (fictional) ----------
  // A CrediTrack CUSTOMER ACCOUNT is what a customer creates in the customer app. The owner connects it to the customer record
  // in this store (Customer Details > Customer Account > Link Customer Account). The customer makes a temporary LINKING CODE
  // (shown as XXXX-XXXX, also as a QR code holding CREDITRACK:LINK:<code>, the same style as the store's CREDITRACK:JOIN:<store code>).
  //   customerAccounts: [{ id, code (CA-1001), fullName, email, phone, memberSince, status: "active" | "closed" }]
  //   linkCodes:        [{ code (8 characters), accountId, createdAt, expiresAt (null = sample code that does not run out), usedAt }]
  //   customer.linkedAccount: { accountId, linkedAt, status: "connected" }   (absent = no account linked)
  // There is no customer app yet, so a real account has no customer accounts or codes; only sample data does.
  var SAMPLE_ACCOUNTS = [
    // [customer record name, account full name, email, phone, link now?, link code, code state]
    ["Ana Cruz",        "Ana Cruz",          "ana.cruz@creditrack.test",     "09171004091", true,  "R4TM-8XKQ", "fresh"],     // already linked; a fresh code for it shows the "already linked" message
    ["Juan Dela Cruz",  "Juan Dela Cruz",    "juan.delacruz@creditrack.test", "09171007781", true,  "",          ""],
    ["Maria Santos",    "Maria Santos",      "maria.santos@creditrack.test", "09171011481", true,  "",          ""],
    ["Carla Bautista",  "Carla Bautista",    "carla.b@creditrack.test",      "09171015181", true,  "",          ""],
    ["Rosa Dizon",      "Rosa Dizon",        "rosa.dizon@creditrack.test",   "09171018881", true,  "",          ""],
    ["Pedro Reyes",     "Pedro Reyes",       "pedro.reyes@creditrack.test",  "09171022581", false, "H7K2-M9QX", "fresh"],     // not linked yet: try this code on Pedro Reyes
    ["Lito Mendoza",    "Lito M. Mendoza",   "lito.mendoza@creditrack.test", "09171026281", false, "W3CN-5TJD", "fresh"],     // name is a little different: the owner checks it before linking
    ["Tess Aquino",     "Tess Aquino",       "tess.aquino@creditrack.test",  "09171029981", false, "P6VB-2YFE", "expired"]    // expired code
  ];
  function applySampleAccounts(records) {
    records.customerAccounts = [];
    records.linkCodes = [];
    SAMPLE_ACCOUNTS.forEach(function (row, i) {
      var customer = records.customers.filter(function (c) { return c.name === row[0]; })[0];
      var account = { id: "ca" + (i + 1), code: "CA-" + (1001 + i), fullName: row[1], email: row[2], phone: row[3], memberSince: daysAgo(90 + i * 7, 9, 0), status: "active" };
      records.customerAccounts.push(account);
      if (customer && row[4]) customer.linkedAccount = { accountId: account.id, linkedAt: daysAgo(3 + i, 10, 30), status: "connected" };
      if (row[5]) records.linkCodes.push({ code: row[5].replace("-", ""), accountId: account.id, createdAt: row[6] === "expired" ? daysAgo(1, 9, 0) : minutesAgo(2), expiresAt: row[6] === "expired" ? daysAgo(1, 9, 10) : null, usedAt: null, sample: true });
    });
    records.linking = true;   // marks the copy as having its sample customer accounts
  }

  // ---------- Sample notifications (fictional) ----------
  // Built from the sample records so the names and amounts always agree with the Dashboard, Customers and Transactions pages.
  // Shape: { id, type, title, message, createdAt, read, target }
  //   type:   payment_request | payment_approved | payment_rejected | overdue | customer_joined | customer_linked | credit_recorded | payment_recorded
  //   target: { kind: "customer", id } | { kind: "transaction", id } | { kind: "route", route }   (where tapping it goes)
  // Times are relative to "now" so the list always looks current. Real accounts start with none.
  function pesoText(n) { return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function sampleNotifications(records) {
    var list = [];
    function customerNamed(name) { return records.customers.filter(function (c) { return c.name === name; })[0] || null; }
    function txOf(name, type) {
      var c = customerNamed(name);
      return c ? records.transactions.filter(function (t) { return t.customerId === c.id && t.type === type; })[0] || null : null;
    }
    function add(type, title, message, createdAt, read, target) {
      list.push({ id: "n" + (list.length + 1), type: type, title: title, message: message, createdAt: createdAt, read: !!read, target: target });
    }
    function customerTarget(name) { var c = customerNamed(name); return c ? { kind: "customer", id: c.id } : null; }
    var REQUESTS = { kind: "route", route: "owner-payment-requests" };
    function requestTarget(id) { return { kind: "route", route: "owner-payment-request?id=" + id }; }

    // Today: new payment requests (same two as the Dashboard's Pending Payments)
    records.paymentRequests.filter(function (p) { return p.status === "pending"; }).forEach(function (p) {
      add("payment_request", "New Payment Request", p.customer + " submitted a " + p.method + " payment request of " + pesoText(p.amount) + ".", p.submittedAt, false, requestTarget(p.id));
      list[list.length - 1].requestId = p.id;
    });
    var joined = customerNamed("Nora Villanueva"), jun = customerNamed("Jun Reyes"), rosa = customerNamed("Rosa Dizon"), ben = customerNamed("Ben Torres");
    if (joined) add("customer_joined", "New Customer Joined", joined.name + " joined your store on CrediTrack.", minutesAgo(30), false, customerTarget(joined.name));
    if (jun) add("overdue", "Account Overdue", jun.name + "\u2019s account is overdue. Unpaid balance: " + pesoText(jun.balance) + ".", minutesAgo(95), false, customerTarget(jun.name));
    var annaLink = customerNamed("Ana Cruz");
    if (annaLink) add("customer_linked", "Customer Account Linked", annaLink.name + " linked her CrediTrack account to her customer record.", minutesAgo(150), true, customerTarget(annaLink.name));

    // Yesterday
    var pedro = customerNamed("Pedro Reyes"), pedroPay = txOf("Pedro Reyes", "payment");
    if (pedro) add("payment_approved", "Payment Request Approved", "You confirmed " + pedro.name + "\u2019s GCash payment of " + pesoText(150) + ". Their balance was updated.", daysAgo(1, 16, 30), true, pedroPay ? { kind: "transaction", id: pedroPay.id } : customerTarget(pedro.name));
    if (rosa) add("payment_rejected", "Payment Request Rejected", "You rejected " + rosa.name + "\u2019s GCash payment request of " + pesoText(50) + ". Their balance was not changed.", daysAgo(1, 14, 10), true, records.paymentRequests.some(function (r) { return r.id === 4; }) ? requestTarget(4) : REQUESTS);
    var lito = customerNamed("Lito Mendoza"), litoPay = txOf("Lito Mendoza", "payment");
    if (lito && litoPay) add("payment_recorded", "Payment Recorded", lito.name + "\u2019s " + litoPay.method.toLowerCase() + " payment of " + pesoText(litoPay.amount) + " was recorded.", daysAgo(1, 17, 30), true, { kind: "transaction", id: litoPay.id });
    var rosaCredit = txOf("Rosa Dizon", "credit");
    if (rosa && rosaCredit) add("credit_recorded", "Credit Recorded", "A credit of " + pesoText(rosaCredit.amount) + " for " + rosa.name + " was saved.", daysAgo(1, 11, 5), true, { kind: "transaction", id: rosaCredit.id });
    if (rosa) add("overdue", "Account Overdue", rosa.name + "\u2019s account is overdue. Unpaid balance: " + pesoText(rosa.balance) + ".", daysAgo(1, 8, 0), true, customerTarget(rosa.name));

    // Earlier
    var carla = customerNamed("Carla Bautista"), carlaPay = txOf("Carla Bautista", "payment");
    if (carla && carlaPay) add("payment_approved", "Payment Request Approved", "You confirmed " + carla.name + "\u2019s " + carlaPay.method + " payment of " + pesoText(carlaPay.amount) + ". Their balance was updated.", daysAgo(2, 15, 20), true, { kind: "transaction", id: carlaPay.id });
    if (ben) add("overdue", "Account Overdue", ben.name + "\u2019s account is overdue. Unpaid balance: " + pesoText(ben.balance) + ".", daysAgo(3, 8, 0), true, customerTarget(ben.name));
    var eddie = customerNamed("Eddie Ramos");
    if (eddie) add("customer_joined", "New Customer Joined", eddie.name + " joined your store on CrediTrack.", daysAgo(4, 10, 45), true, customerTarget(eddie.name));

    // A target that points at a customer or transaction that no longer exists is dropped (the notification stays, it just is not tappable)
    list.forEach(function (n) { if (!n.target) delete n.target; });
    list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    list.forEach(function (n, i) { n.id = "n" + (i + 1); });
    return list;
  }

  // ---------- Records (real data in localStorage; sample data in a temporary working copy) ----------
  function recordsFromStorage() {
    var r = readJson(KEY_RECORDS, {});
    return { customers: r.customers || [], transactions: r.transactions || [], paymentRequests: r.paymentRequests || [], notifications: r.notifications || [], customerAccounts: r.customerAccounts || [], linkCodes: r.linkCodes || [] };
  }
  function loadRecords() {
    if (!isDemo()) return recordsFromStorage();
    var copy = readDemoData();
    if (!copy || !copy.customers) { copy = sampleRecords(); writeDemoData(copy); }
    // A working copy made before due dates existed gets the sample due dates once
    if (!copy.dueDates) { applySampleDueDates(copy); writeDemoData(copy); }
    // A working copy made before payment request details existed gets them once
    if (!copy.requestDetails) { enrichSampleRequests(copy); writeDemoData(copy); }
    // A working copy made before customer accounts existed gets the sample accounts and linking codes once
    if (!copy.linking) { applySampleAccounts(copy); writeDemoData(copy); }
    // A working copy made before notifications existed gets sample notifications once
    if (!Array.isArray(copy.notifications)) { copy.notifications = sampleNotifications(copy); writeDemoData(copy); }
    return copy;
  }
  function saveRecords(records) {
    if (isDemo()) writeDemoData(records);
    else write(KEY_RECORDS, JSON.stringify(records));
  }
  // Customer names are looked up by id, so renaming a customer updates every transaction and request.
  function withNames(records) {
    var byId = {};
    records.customers.forEach(function (c) { byId[c.id] = c; });
    function name(item) { return item.customerId && byId[item.customerId] ? byId[item.customerId].name : item.customer; }
    return {
      customers: records.customers,
      transactions: records.transactions.map(function (t) { return Object.assign({}, t, { customer: name(t) }); }),
      paymentRequests: records.paymentRequests.map(function (p) { return Object.assign({}, p, { customer: name(p) }); })
    };
  }

  // ---------- Dashboard (same calculation for records and sample data) ----------
  function summarize(records, isSample) {
    var sum = 0, withDebt = 0, overdue = computeOverdue(records).length;   // same overdue rule as the Overdue Accounts page
    records.customers.forEach(function (c) {
      sum += c.balance || 0;
      if (c.balance > 0) withDebt++;
    });
    return {
      isSample: isSample,
      outstandingBalance: sum,
      totalCustomers: records.customers.length,
      customersWithDebt: withDebt,
      overdueCount: overdue,
      pendingPayments: records.paymentRequests.filter(function (p) { return p.status === "pending"; })
        .sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); }),
      recentReviewed: records.paymentRequests.filter(function (p) { return p.status !== "pending"; })
        .map(function (p) { return Object.assign({}, p, { paymentStatus: p.status === "approved" ? "confirmed" : p.status }); })
        .sort(function (a, b) { return new Date(b.reviewedAt || b.submittedAt) - new Date(a.reviewedAt || a.submittedAt); }).slice(0, 5),
      archivedRequestCount: 0,
      recentTransactions: records.transactions.slice()
        .sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, 5)
    };
  }
  function getOwnerDashboard() {
    // Real accounts: everything comes from GET /api/owner/dashboard (one request, filtered by the owner's store)
    if (!isDemo()) {
      return window.CrediTrackHttp("/owner/dashboard").then(function (d) {
        d.isSample = false;
        d.pendingPayments = d.pendingPayments || [];
        d.recentReviewed = d.recentReviewed || [];
        d.recentTransactions = d.recentTransactions || [];
        return d;
      });
    }
    return Promise.resolve(summarize(withNames(loadRecords()), isDemo()));
  }

  // ---------- Customers ----------
  // Accepts 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes allowed). Returns "09XXXXXXXXX" or null.
  function parsePhone(raw) {
    var v = String(raw || "").replace(/[\s-]/g, "");
    if (/^\+639\d{9}$/.test(v)) v = "0" + v.slice(3);
    return /^09\d{9}$/.test(v) ? v : null;
  }
  function normalizePhone(raw) { return parsePhone(raw) || String(raw || "").trim(); }   // 09XXXXXXXXX when valid, otherwise as typed
  function formatPhone(p) { return p && /^\d{11}$/.test(p) ? p.slice(0, 4) + " " + p.slice(4, 7) + " " + p.slice(7) : (p || ""); }

  function sortByName(list) {
    return list.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "en", { sensitivity: "base" }); });
  }
  // customerId -> days overdue, from computeOverdue (a customer who is not overdue is simply missing)
  function overdueDaysById(records) {
    var map = {};
    computeOverdue(records).forEach(function (x) { map[x.customerId] = x.daysOverdue; });
    return map;
  }
    // Real accounts: the customer list comes from the database through the API
  function getCustomersFromApi() {
    return window.CrediTrackHttp("/owner/customers").then(function (list) {
      list = sortByName(list);
      var withDebt = list.filter(function (c) { return c.balance > 0; }).length;
      var archived = list.filter(function (c) { return c.archived; }).length;
      return { isSample: false, customers: list, total: list.length, withDebt: withDebt, paid: list.length - withDebt,
        activeCount: list.length - archived, archivedCount: archived };
    });
  }
  function getCustomers() {
    if (!isDemo()) return getCustomersFromApi();
    var records = loadRecords();
    var overdue = overdueDaysById(records);
    var list = sortByName(records.customers).map(function (c) { return Object.assign({}, c, { overdueDays: overdue[c.id] || 0 }); });   // overdue comes from the one shared rule
    var withDebt = list.filter(function (c) { return c.balance > 0; }).length;
    // customers holds EVERYONE (active and archived, an archived customer has archived: true). The Customers page splits
    // them into its Active and Archived views; the Record Utang pickers leave archived customers out.
    var archived = list.filter(function (c) { return c.archived; }).length;
    return Promise.resolve({ isSample: isDemo(), customers: list, total: list.length, withDebt: withDebt, paid: list.length - withDebt,
      activeCount: list.length - archived, archivedCount: archived });
  }
  // ---------- Customers: filtered, paginated list ----------
  // BACKEND CONTRACT (future: GET /api/customers)
  //   query    { search, status: "active" | "archived", balance: "all" | "debt" | "paid", page, pageSize }
  //   response { isSample, items, totalCount, page, pageSize, totalPages, hasMore,
  //              counts: { active, archived, all, debt, paid }, totalAll }
  //   search matches name, customer code or mobile number. counts.all / debt / paid cover the chosen status (Active or
  //   Archived) and ignore the search and balance filter, so the chips can show how many each one would list.
  //   totalAll is every customer, active and archived (0 means the store has no customers at all).
  // This body reads the local records through getCustomers() (the demo working copy in demo mode). Replace ONLY this body
  // with a fetch to the API later; the Customers page does not change.
  function queryCustomers(query) {
    var Q = window.CrediTrackQuery;
    query = query || {};
    var status = Q.pick(query.status, ["active", "archived"], "active");
    var balance = Q.pick(query.balance, ["all", "debt", "paid"], "all");
    var search = Q.text(query.search), digits = search.replace(/[\s-]/g, "");
    return getCustomers().then(function (data) {
      var pool = data.customers.filter(function (c) { return status === "archived" ? !!c.archived : !c.archived; });
      var debt = pool.filter(function (c) { return c.balance > 0; }).length;
      var matches = pool.filter(function (c) {
        if (balance === "debt" && !(c.balance > 0)) return false;
        if (balance === "paid" && c.balance > 0) return false;
        if (!search) return true;
        return c.name.toLowerCase().indexOf(search) !== -1 ||
          c.code.toLowerCase().indexOf(search) !== -1 ||
          (digits.length > 1 && (c.phone || "").indexOf(digits) !== -1);
      });
      return Object.assign({
        isSample: data.isSample,
        counts: { active: data.activeCount, archived: data.archivedCount, all: pool.length, debt: debt, paid: pool.length - debt },
        totalAll: data.total
      }, Q.paginate(matches, query));   // already sorted by name
    });
  }
  // Archiving only hides a customer from new credit; their records, payments and balance are never changed or deleted.
  function setArchived(id, archived) {
        if (!isDemo()) return window.CrediTrackHttp("/owner/customers/" + id + (archived ? "/archive" : "/restore"), { method: "POST" });
    var records = loadRecords();
    var customer = records.customers.filter(function (c) { return String(c.id) === String(id); })[0];
    if (!customer) return Promise.reject(new Error("Customer not found."));
    if (!!customer.archived !== archived) {
      if (archived) { customer.archived = true; customer.archivedAt = new Date().toISOString(); }
      else { delete customer.archived; delete customer.archivedAt; }
      saveRecords(records);
    }
    return Promise.resolve(customer);
  }
  function archiveCustomer(id) { return setArchived(id, true); }
  function restoreCustomer(id) { return setArchived(id, false); }
  function getCustomer(id) {
            if (!isDemo()) {
      var empty = { isSample: false, customer: null, history: [], totalCredit: 0, totalPayments: 0, linkedAccount: null };
      return Promise.all([
        window.CrediTrackHttp("/owner/customers/" + id),
        window.CrediTrackHttp("/owner/transactions"),
        window.CrediTrackHttp("/owner/customers/" + id + "/account").catch(function () { return null; })
      ]).then(function (r) {
        var customer = r[0];
        var history = r[1].filter(function (t) { return String(t.customerId) === String(customer.id); });   // newest first
        var credit = 0, paid = 0;
        history.forEach(function (t) {
          if (t.voided) return;
          if (t.type === "credit") credit += t.amount; else paid += t.amount;
        });
        var acc = r[2], linkedAccount = null, pendingLink = null;
        if (acc && acc.account) linkedAccount = realAccountFor(acc.account, acc.linkedAt, acc.linked ? "connected" : "disconnected");
        // A link request the customer has not answered yet (nothing is linked until they accept)
        if (acc && acc.pendingLink && acc.pendingLink.account) {
          pendingLink = { id: acc.pendingLink.id, createdAt: acc.pendingLink.createdAt, expiresAt: acc.pendingLink.expiresAt,
            account: realAccountFor(acc.pendingLink.account, null, "pending") };
        }
        return Object.assign({}, empty, { customer: customer, history: history, totalCredit: round2(credit), totalPayments: round2(paid), linkedAccount: linkedAccount, pendingLink: pendingLink });
      }, function (error) {
        if (error.status === 404) return empty;     // the page shows "not found"
        throw error;
      });
    }
    var records = withNames(loadRecords());
    var customer = records.customers.filter(function (c) { return String(c.id) === String(id); })[0] || null;
    if (customer) customer = Object.assign({}, customer, { overdueDays: overdueDaysById(loadRecords())[customer.id] || 0 });
    var history = customer ? records.transactions.filter(function (t) { return t.customerId === customer.id; })
      .sort(function (a, b) { return new Date(b.date) - new Date(a.date); }) : [];
    var credit = 0, paid = 0;
    history.forEach(function (t) { if (t.voided) return; if (t.type === "credit") credit += t.amount; else paid += t.amount; });   // voided ones are kept in the history but do not count
    return Promise.resolve({ isSample: isDemo(), customer: customer, history: history, totalCredit: credit, totalPayments: paid,
      linkedAccount: customer ? resolveLinkedAccount(loadRecords(), customer) : null });
  }
  // data: { name, phone }. The page validates first; these checks are the safety net (and the rules a real API will enforce).
  // Rejects with an Error whose .code / .field is "name" or "phone" (the form field to highlight):
  //   name   required, 2-60 characters, at least one letter, and not the same as another customer's name (archived customers count too)
  //   phone  optional, a valid Philippine mobile number, and not the same as another customer's number
  function customerError(field, message) { var e = new Error(message); e.code = field; e.field = field; return e; }
  function checkCustomer(records, data, ownId) {
    data = data || {};
    var name = String(data.name || "").trim().replace(/\s+/g, " ");
    if (!name) throw customerError("name", "Enter the customer's full name.");
    if (name.length < 2 || !/[A-Za-z\u00C0-\u024F]/.test(name)) throw customerError("name", "Enter a valid name.");
    if (name.length > 60) throw customerError("name", "Name is too long (60 characters at most).");
    var rawPhone = String(data.phone || "").trim(), phone = "";
    if (rawPhone) {
      phone = parsePhone(rawPhone);
      if (!phone) throw customerError("phone", "Enter a valid mobile number, like 0917 123 4567.");
    }
    records.customers.forEach(function (c) {
      if (ownId !== undefined && String(c.id) === String(ownId)) return;
      if (String(c.name).toLowerCase() === name.toLowerCase()) throw customerError("name", "A customer with this name already exists" + (c.archived ? " (archived)" : "") + ". Add a last name or nickname to tell them apart.");
      if (phone && c.phone === phone) throw customerError("phone", "This number already belongs to " + c.name + (c.archived ? " (archived)" : "") + ".");
    });
    return { name: name, phone: phone };
  }
  // data: { name, phone, customerCode? }. A real account may add a customerCode (CT-CUS-123456, or the text of the customer's QR):
  // the server then also sends that account a link request. The result is the new customer, with linkRequested + linkedAccount added.
  function addCustomer(data) {
    if (!isDemo()) {
      return window.CrediTrackHttp("/owner/customers", { method: "POST", body: data }).then(function (r) {
        if (!r || !r.linkRequested) return r;
        var saved = r.customer || {};
        saved.linkRequested = true;
        saved.linkedAccount = realAccountFor(r.account, null, "pending");
        return saved;
      }, function (err) { throw linkHttpError(err); });
    }
    var records = loadRecords(), clean;
    try { clean = checkCustomer(records, data); } catch (e) { return Promise.reject(e); }
    var id = records.customers.reduce(function (m, c) { return Math.max(m, c.id); }, 0) + 1;
    var customer = { id: id, code: codeFor(id), name: clean.name, phone: clean.phone, balance: 0, overdueDays: 0, createdAt: new Date().toISOString() };
    records.customers.push(customer);
    saveRecords(records);
    return Promise.resolve(customer);
  }
  function updateCustomer(id, data) {
        if (!isDemo()) return window.CrediTrackHttp("/owner/customers/" + id, { method: "PUT", body: data });
    var records = loadRecords();
    var customer = records.customers.filter(function (c) { return String(c.id) === String(id); })[0];
    if (!customer) return Promise.reject(new Error("Customer not found."));
    var clean;
    try { clean = checkCustomer(records, data, id); } catch (e) { return Promise.reject(e); }
    customer.name = clean.name;
    customer.phone = clean.phone;
    customer.updatedAt = new Date().toISOString();
    saveRecords(records);
    return Promise.resolve(customer);
  }

  // ---------- Customer account linking ----------
  // The owner connects a customer record to the account the customer made in the customer app, using the customer's temporary
  // linking code (typed, or read from their QR code). Two steps, so the owner can check the account first:
  //   verifyLinkCode(customerId, input)           -> { code, account, expiresAt }   (nothing is changed)
  //   linkCustomerAccount(customerId, input)      -> { customer, linkedAccount, duplicate }   (verifies again, then links)
  // Both reject with an Error that has .code: empty | format | not_found | expired | used | account_linked | customer_linked | customer_missing.
  // Everything about a linked account is read through resolveLinkedAccount(), the only place that masks contact details.
  var LINK_CODE_CHARS = /^[2-9A-HJKMNP-Z]{8}$/;
  function linkError(code, message, extra) { var e = new Error(message); e.code = code; if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); return e; }
  // Accepts "R4TM-8XKQ", "r4tm 8xkq" or the QR text "CREDITRACK:LINK:R4TM8XKQ". Returns the 8 characters, or "" when it is empty.
  function normalizeLinkCode(input) {
    var v = String(input || "").trim().toUpperCase();
    var m = v.match(/^CREDITRACK:LINK:(.*)$/);
    if (m) v = m[1];
    return v.replace(/[\s-]/g, "");
  }
  function maskEmail(email) {
    var at = String(email || "").indexOf("@");
    return at > 0 ? email.charAt(0) + "\u2022\u2022\u2022" + email.slice(at) : "";
  }
  function maskPhone(phone) {
    var p = String(phone || "");
    return /^\d{11}$/.test(p) ? p.slice(0, 4) + " \u2022\u2022\u2022 \u2022\u2022" + p.slice(9) : "";
  }
  function publicAccount(account) {
    return { id: account.id, accountId: account.code, name: account.fullName, email: maskEmail(account.email), phone: maskPhone(account.phone), memberSince: account.memberSince };
  }
  function accountById(records, id) { return (records.customerAccounts || []).filter(function (a) { return a.id === id; })[0] || null; }
  // The linked account shown on Customer Details: { accountId, name, email, phone, memberSince, linkedAt, status: "connected" | "disconnected" } or null.
  function resolveLinkedAccount(records, customer) {
    var link = customer && customer.linkedAccount;
    if (!link) return null;
    var account = accountById(records, link.accountId);
    if (!account) return { accountId: "", name: "", email: "", phone: "", memberSince: null, linkedAt: link.linkedAt, status: "disconnected" };
    var out = publicAccount(account);
    out.linkedAt = link.linkedAt;
    out.status = account.status === "active" && link.status !== "disconnected" ? "connected" : "disconnected";
    return out;
  }
  function checkLinkCode(records, customerId, input) {
    var customer = records.customers.filter(function (c) { return String(c.id) === String(customerId); })[0];
    if (!customer) throw linkError("customer_missing", "Customer not found.");
    if (customer.linkedAccount) throw linkError("customer_linked", "This customer already has a linked account.");
    var code = normalizeLinkCode(input);
    if (!code) throw linkError("empty", "Enter the linking code from the customer.");
    if (!LINK_CODE_CHARS.test(code)) throw linkError("format", "That code does not look right. It has 8 letters and numbers, like H7K2-M9QX.");
    var entry = (records.linkCodes || []).filter(function (l) { return l.code === code; })[0];
    var account = entry ? accountById(records, entry.accountId) : null;
    if (!entry || !account) throw linkError("not_found", "We could not find this code. Check it, or ask the customer for a new one.");
    if (entry.usedAt) throw linkError("used", "This code was already used. Ask the customer for a new one.");
    if (entry.expiresAt && new Date(entry.expiresAt) <= new Date()) throw linkError("expired", "This code has expired. Ask the customer to make a new one in their app.");
    var other = records.customers.filter(function (c) { return c.linkedAccount && c.linkedAccount.accountId === account.id; })[0];
    if (other) throw linkError("account_linked", "This account is already linked to " + other.name + ".", { customerName: other.name });
    return { customer: customer, entry: entry, account: account, code: code };
  }
  // Real account: the customer's Customer Code (CT-CUS-123456, or the text of their QR) is checked and linked by the server.
  function realAccountFor(a, linkedAt, status) {
    return { id: a.customerCode, accountId: a.customerCode, name: a.fullName, email: a.email || "", phone: maskPhone(a.contactNumber), memberSince: a.memberSince || null, linkedAt: linkedAt || null, status: status || "connected" };
  }
  function linkHttpError(err) {                            // the server names the field ("code"); the modal reads .code
    if (err && err.field) err.code = err.field;
    return err;
  }
  function verifyLinkCode(customerId, input) {
    if (!isDemo()) {
      return window.CrediTrackHttp("/owner/customers/" + customerId + "/link/verify", { method: "POST", body: { customerCode: String(input || "") } }).then(function (r) {
        return { code: r.account.customerCode, account: realAccountFor(r.account), willMerge: !!r.willMerge, emptyRecordName: r.emptyRecordName || "" };
      }, function (err) { throw linkHttpError(err); });
    }
    try {
      var found = checkLinkCode(loadRecords(), customerId, input);
      return Promise.resolve({ code: found.code, account: publicAccount(found.account), expiresAt: found.entry.expiresAt });
    } catch (e) { return Promise.reject(e); }
  }
  function linkCustomerAccount(customerId, input) {
    if (!isDemo()) {
      return window.CrediTrackHttp("/owner/customers/" + customerId + "/link", { method: "POST", body: { customerCode: String(input || "") } }).then(function (r) {
        // The server only SENDS a request: the customer has to accept it before the record is linked
        return { requested: true, customer: r.customer, linkedAccount: realAccountFor(r.account, null, "pending"),
          expiresAt: r.request ? r.request.expiresAt : "", duplicate: false, merged: false };
      }, function (err) { throw linkHttpError(err); });
    }
    var records = loadRecords();
    var found;
    try { found = checkLinkCode(records, customerId, input); }
    catch (e) {
      // Pressing Confirm twice: the second call finds this customer already linked with this very code, so it is a repeat, not an error.
      var again = e.code === "customer_linked" ? records.customers.filter(function (c) { return String(c.id) === String(customerId); })[0] : null;
      var usedBy = again ? (records.linkCodes || []).filter(function (l) { return l.code === normalizeLinkCode(input) && l.usedAt && l.customerId === again.id; })[0] : null;
      if (usedBy) return Promise.resolve({ customer: again, linkedAccount: resolveLinkedAccount(records, again), duplicate: true });
      return Promise.reject(e);
    }
    var now = new Date().toISOString();
    found.customer.linkedAccount = { accountId: found.account.id, linkedAt: now, status: "connected" };
    found.entry.usedAt = now;
    found.entry.customerId = found.customer.id;
    addNotification(records, "customer_linked", "Customer Account Linked", found.customer.name + " linked their CrediTrack account to their customer record.", { kind: "customer", id: found.customer.id });
    saveRecords(records);
    return Promise.resolve({ customer: found.customer, linkedAccount: resolveLinkedAccount(records, found.customer), duplicate: false });
  }
  // Add Customer page: which CrediTrack account does this Customer Code (typed, or the text of the customer's QR) belong to?
  // Nothing is saved. Resolves to the account (email and mobile partly hidden). Rejects with .code "code" and the server's reason
  // (no such account, already in this store, a request already waiting ...). Real accounts only: the demo has no customer accounts.
  function canAddByCode() { return !isDemo(); }
  function verifyCustomerCode(input) {
    if (isDemo()) return Promise.reject(new Error("Looking up a customer account is not available in the demo."));
    return window.CrediTrackHttp("/owner/customers/account/verify", { method: "POST", body: { customerCode: String(input || "") } }).then(function (r) {
      return { account: realAccountFor(r.account) };
    }, function (err) { throw linkHttpError(err); });
  }
  // Take back a link request the customer has not answered yet (real accounts only)
  function cancelLinkRequest(customerId) {
    if (isDemo()) return Promise.resolve({ cancelled: true });
    return window.CrediTrackHttp("/owner/customers/" + encodeURIComponent(customerId) + "/link/cancel", { method: "POST" });
  }
  // Join requests: customers who asked to join my store (found with the store code) and wait for my yes (real accounts only)
  function getJoinRequests() {
    if (isDemo()) return Promise.resolve({ requests: [] });
    return window.CrediTrackHttp("/owner/customers/join-requests").then(function (d) {
      // records: the store's own unlinked records a join can be attached to ({ id, code, name })
      return { requests: (d.requests || []).map(function (r) {
        return { id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt, account: realAccountFor(r.account, null, "pending") };
      }), records: d.records || [] };
    });
  }
  function answerJoinRequest(id, action) {
    if (isDemo()) return Promise.reject(new Error("Join requests are not available in the demo."));
    return window.CrediTrackHttp("/owner/customers/join-requests/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
  }
  // customerId (optional): attach the approved account to that existing record of the store instead of making a new one
  function approveJoinRequest(id, customerId) {
    if (isDemo()) return Promise.reject(new Error("Join requests are not available in the demo."));
    return window.CrediTrackHttp("/owner/customers/join-requests/" + encodeURIComponent(id) + "/approve",
      { method: "POST", body: { customerId: customerId ? Number(customerId) : null } });
  }
  function declineJoinRequest(id) { return answerJoinRequest(id, "decline"); }
  // Auto-approve: when ON, a customer who enters the store code joins at once instead of waiting for Approve (real accounts only).
  function getJoinSettings() {
    if (isDemo()) return Promise.resolve({ available: false, autoApproveJoins: false });
    return window.CrediTrackHttp("/owner/store").then(function (s) { return { available: true, autoApproveJoins: !!s.autoApproveJoins }; });
  }
  function setAutoApproveJoins(enabled) {
    if (isDemo()) return Promise.reject(new Error("Auto-approve is not available in the demo."));
    return window.CrediTrackHttp("/owner/store/auto-approve", { method: "PUT", body: { enabled: !!enabled } }).then(function (r) { return { autoApproveJoins: !!r.autoApproveJoins }; });
  }
  // Demo mode: sample codes the owner can try. A real account types the customer's Customer Code instead.
  function getLinkingInfo() {
    if (!isDemo()) return Promise.resolve({ isSample: false, real: true, samples: [] });
    var records = loadRecords();
    var samples = (records.linkCodes || []).filter(function (l) { return l.sample && !l.usedAt; }).map(function (l) {
      var account = accountById(records, l.accountId);
      return { code: l.code, display: l.code.slice(0, 4) + "-" + l.code.slice(4), name: account ? account.fullName : "", expired: !!(l.expiresAt && new Date(l.expiresAt) <= new Date()) };
    });
    return Promise.resolve({ isSample: true, samples: samples });
  }

  // ---------- Transactions ----------
  // Adds what the Transaction History and Transaction Details pages need to every transaction:
  // code (TRX-0001), customer name and code, status, and for credits how much has been paid toward them.
  // A customer's payments are applied to their oldest credits first, so Unpaid / Partially paid / Paid always
  // agrees with the customer's balance. Record Utang (addCredit below) stores credits this way; Record Bayad only needs to store
  // { customerId, type, amount, date, items | note, method, reference }.
  function trxCode(id) { return "TRX-" + ("000" + id).slice(-4); }
  function decorateTransactions(records) {
    var byId = {};
    records.customers.forEach(function (c) { byId[c.id] = c; });
    var pool = {};   // customerId -> payment money still to apply (voided payments are not money received, so they are left out)
    records.transactions.forEach(function (t) { if (t.type === "payment" && !t.voided) pool[t.customerId] = (pool[t.customerId] || 0) + t.amount; });
    var paidToward = {};
    records.transactions.filter(function (t) { return t.type === "credit" && !t.voided; })   // a voided credit is not owed, so no payment is applied to it
      .sort(function (a, b) { return new Date(a.date) - new Date(b.date) || a.id - b.id; })
      .forEach(function (t) {
        var applied = Math.min(t.amount, pool[t.customerId] || 0);
        pool[t.customerId] = (pool[t.customerId] || 0) - applied;
        paidToward[t.id] = applied;
      });
    return records.transactions.map(function (t) {
      var c = byId[t.customerId];
      var out = Object.assign({}, t, {
        code: trxCode(t.id),
        customer: c ? c.name : t.customer,
        customerCode: c ? c.code : ""
      });
      if (t.type === "credit") {
        out.paidAmount = paidToward[t.id] || 0;
        out.remaining = t.voided ? 0 : t.amount - out.paidAmount;
        out.status = t.voided ? "voided" : out.remaining <= 0 ? "paid" : out.paidAmount > 0 ? "partial" : "unpaid";
        out.items = (t.items && t.items.length) ? t.items
          : [{ name: t.note || "Credit", qty: 1, unit: "", price: t.amount }];
      } else {
        // A payment in the transactions is always a CONFIRMED one (pending and rejected requests never become transactions); a voided one says so.
        out.status = t.voided ? "voided" : "confirmed";
        out.paymentStatus = out.status;
      }
      out.voided = !!t.voided;
      return out;
    }).sort(function (a, b) { return new Date(b.date) - new Date(a.date) || b.id - a.id; });
  }
  function getTransactions() {
        if (!isDemo()) {
      return Promise.all([window.CrediTrackHttp("/owner/transactions"), getCustomersFromApi()]).then(function (r) {
        return { isSample: false, transactions: r[0], customerCount: r[1].total };
      });
    }
    var records = loadRecords();
    return Promise.resolve({ isSample: isDemo(), transactions: decorateTransactions(records), customerCount: records.customers.length });
  }
  // ---------- Transactions: filtered, paginated list ----------
  // BACKEND CONTRACT (future: GET /api/transactions)
  //   query    { search (customer name), type: "all" | "credit" | "payment",
  //              status: "all" | "unpaid" | "partial" | "paid" | "confirmed" | "voided",
  //              dateRange: "all" | "today" | "7" | "30" | "month" | "custom", from, to (YYYY-MM-DD, for custom), page, pageSize }
  //   response { isSample, items (newest first), totalCount, page, pageSize, totalPages, hasMore,
  //              totals: { credit, creditCount, payment, paymentCount }   (all matching rows, voided ones left out),
  //              totalAll, invalidRange }
  //   Credits are unpaid / partial / paid / voided; payments are confirmed / voided (a payment is only a transaction once it is confirmed).
  //   invalidRange = a custom range that starts after it ends: nothing is returned and the page says so.
  // Replace ONLY this body with a fetch to the API later; the Transactions page does not change.
  var TRANSACTION_STATUSES = ["all", "unpaid", "partial", "paid", "confirmed", "voided"];
  function queryTransactions(query) {
    var Q = window.CrediTrackQuery;
    query = query || {};
    var type = Q.pick(query.type, ["all", "credit", "payment"], "all");
    var status = Q.pick(query.status, TRANSACTION_STATUSES, "all");
    var search = Q.text(query.search), win = Q.dateWindow(query);
    return getTransactions().then(function (data) {
      var matches = win.invalid ? [] : data.transactions.filter(function (t) {
        if (type !== "all" && t.type !== type) return false;
        if (status !== "all" && t.status !== status) return false;
        if (query.customerId && String(t.customerId) !== String(query.customerId)) return false;   // one customer's transactions only
        if (search && (t.customer || "").toLowerCase().indexOf(search) === -1) return false;
        return Q.inWindow(t.date, win);
      });   // already newest first
      var totals = { credit: 0, creditCount: 0, payment: 0, paymentCount: 0 };
      matches.forEach(function (t) {
        if (t.voided) return;
        if (t.type === "credit") { totals.credit += t.amount; totals.creditCount++; } else { totals.payment += t.amount; totals.paymentCount++; }
      });
      totals.credit = round2(totals.credit); totals.payment = round2(totals.payment);
      return Object.assign({ isSample: data.isSample, totals: totals, totalAll: data.transactions.length, invalidRange: win.invalid }, Q.paginate(matches, query));
    });
  }
  // Real accounts: GET /api/owner/transactions/{id}/history (oldest first) -> the entry shape Transaction Details already shows:
  // { id, action: "edited" | "voided", at, by: { name, role }, changes: [{ field, label, before, after }], reasonLabel }.
  // If the history cannot be loaded the page still opens, just without the list.
  function getHistoryFromApi(id) {
    return window.CrediTrackHttp("/owner/transactions/" + encodeURIComponent(id) + "/history").then(function (rows) {
      return (rows || []).map(function (h) {
        var voided = h.kind === "void";
        var entry = {
          id: "h" + h.id, action: voided ? "voided" : "edited", at: h.at,
          by: h.actor ? { name: h.actor, role: h.role || "Store Owner" } : null,
          changes: (h.changes || []).map(function (c) { return { field: c.field, label: c.field, before: c.from, after: c.to }; })
        };
        if (voided) entry.reasonLabel = String(h.summary || "").replace(/^Voided:\s*/, "");
        return entry;
      });
    }).catch(function () { return []; });
  }
  function getTransaction(id) {
        if (!isDemo()) {
      return window.CrediTrackHttp("/owner/transactions/" + id).then(function (transaction) {
        return Promise.all([window.CrediTrackHttp("/owner/customers/" + transaction.customerId), getOwner(), getHistoryFromApi(id)]).then(function (r) {
          return { isSample: false, transaction: transaction, customer: r[0], owner: r[1], history: r[2] };
        });
      }, function (error) {
        if (error.status !== 404) throw error;
        return getOwner().then(function (owner) {
          return { isSample: false, transaction: null, customer: null, owner: owner, history: [] };   // the page shows "not found"
        });
      });
    }
    var records = loadRecords();
    var transaction = decorateTransactions(records).filter(function (t) { return String(t.id) === String(id); })[0] || null;
    var customer = transaction ? records.customers.filter(function (c) { return c.id === transaction.customerId; })[0] || null : null;
    var history = transaction ? changeHistory(transaction) : [];   // Change History: edits and the void, oldest first ([] when nothing changed)
    return getOwner().then(function (owner) {
      return { isSample: isDemo(), transaction: transaction, customer: customer, owner: owner, history: history };
    });
  }

  // ---------- Record Utang: save a credit ----------
  // data: { customerId, items: [{ name, qty, qtyText, unit, price }], dueDate, requestId }   (qtyText = quantity as entered, e.g. "1/2"; unit optional)
  //   dueDate (optional): "YYYY-MM-DD", today or later and within 5 years. Missing, null or "" = "No due date" (the credit can never be overdue);
  //   the saved transaction then has no dueDate field at all. The API (POST /api/owner/transactions/credits) applies the same rules.
  // Saves ONE credit transaction (mock data only), adds its total to the customer's outstanding balance and returns
  // { transaction (with code TRX-0001 style), customer, duplicate }. requestId makes saving safe to repeat: a second
  // call with the same requestId returns the transaction already saved instead of creating another.
  function round2(n) { return Math.round(n * 100) / 100; }
  function addCredit(data) {
        if (!isDemo()) return window.CrediTrackHttp("/owner/transactions/credits", { method: "POST", body: data });
    data = data || {};
    var list = Array.isArray(data.items) ? data.items : [];
    if (!list.length) return Promise.reject(new Error("Add at least one item."));
    var items = [];
    for (var i = 0; i < list.length; i++) {
      var name = String(list[i].name || "").trim().replace(/\s+/g, " ");
      var qty = Number(list[i].qty), price = Number(list[i].price);
      if (!name || !(qty > 0) || !(price > 0) || !isFinite(qty) || !isFinite(price)) return Promise.reject(new Error("One of the items is not valid. Check the name, quantity and price."));
      var unit = String(list[i].unit || "").trim().replace(/\s+/g, " ").slice(0, 20);
      var qtyText = String(list[i].qtyText || "").trim().slice(0, 12);
      var item = { name: name, qty: Math.round(qty * 1000000) / 1000000, unit: unit, price: round2(price) };   // qty keeps fractions exact (1/8 = 0.125)
      if (qtyText) item.qtyText = qtyText;
      items.push(item);
    }
    var records = loadRecords();
    if (data.requestId) {
      var saved = records.transactions.filter(function (t) { return t.requestId === data.requestId; })[0];
      if (saved) {
        var owner = records.customers.filter(function (c) { return c.id === saved.customerId; })[0];
        return Promise.resolve({ transaction: Object.assign({ code: trxCode(saved.id) }, saved), customer: owner, duplicate: true });
      }
    }
    var customer = records.customers.filter(function (c) { return String(c.id) === String(data.customerId); })[0];
    if (!customer) return Promise.reject(new Error("Customer not found."));
    if (customer.archived) return Promise.reject(new Error("This customer is archived. Restore the customer before recording new utang."));
    var dueDate = null;
    if (data.dueDate !== undefined && data.dueDate !== null && String(data.dueDate).trim() !== "") {
      dueDate = String(data.dueDate).trim();
      var dueDay = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? new Date(Number(dueDate.slice(0, 4)), Number(dueDate.slice(5, 7)) - 1, Number(dueDate.slice(8, 10))) : null;
      var nowDay = new Date();
      if (!dueDay || isNaN(dueDay.getTime()) || localISODate(dueDay) !== dueDate) return Promise.reject(new Error("Enter a valid due date."));
      if (dueDate < localISODate(nowDay)) return Promise.reject(new Error("The due date cannot be in the past."));
      if (dueDate > localISODate(new Date(nowDay.getFullYear() + 5, nowDay.getMonth(), nowDay.getDate()))) return Promise.reject(new Error("That due date is too far away. Choose a date within 5 years."));
    }
    var amount = round2(items.reduce(function (sum, it) { return sum + round2(it.qty * it.price); }, 0));
    var id = records.transactions.reduce(function (m, t) { return Math.max(m, t.id); }, 0) + 1;
    var tx = {
      id: id, customerId: customer.id, type: "credit", amount: amount, date: new Date().toISOString(),
      note: items.map(function (it) { return it.name; }).join(", "), items: items
    };
    if (dueDate) tx.dueDate = dueDate;
    if (data.requestId) tx.requestId = String(data.requestId);
    customer.balance = round2((customer.balance || 0) + amount);
    records.transactions.push(tx);
    saveRecords(records);
    return Promise.resolve({ transaction: Object.assign({ code: trxCode(id) }, tx), customer: customer, duplicate: false });
  }

  // ---------- Record Bayad: save a payment ----------
  // data: { customerId, amount, date: "YYYY-MM-DD", method, reference, notes, requestId }
  // Validates again, then saves ONE payment transaction { customerId, type: "payment", amount, date, method, reference, note }
  // (mock data only), deducts the amount from the customer's outstanding balance and returns
  // { transaction (with code TRX-0001 style), customer, balanceBefore, duplicate }. Nothing is changed when validation fails.
  // requestId makes saving safe to repeat: a second call with the same requestId returns the payment already saved.
  var PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Bank Transfer", "Other"];
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function localISODate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function addPayment(data) {
        if (!isDemo()) return window.CrediTrackHttp("/owner/transactions/payments", { method: "POST", body: data });
    data = data || {};
    var records = loadRecords();
    if (data.requestId) {
      var saved = records.transactions.filter(function (t) { return t.requestId === data.requestId; })[0];
      if (saved) {
        var owner = records.customers.filter(function (c) { return c.id === saved.customerId; })[0];
        return Promise.resolve({ transaction: Object.assign({ code: trxCode(saved.id) }, saved), customer: owner, balanceBefore: saved.balanceBefore, duplicate: true });
      }
    }
    var customer = records.customers.filter(function (c) { return String(c.id) === String(data.customerId); })[0];
    if (!customer) return Promise.reject(new Error("Customer not found."));
    var balance = round2(customer.balance || 0);
    if (!(balance > 0)) return Promise.reject(new Error("This customer has no outstanding balance to pay."));
    var raw = String(data.amount === undefined || data.amount === null ? "" : data.amount).replace(/,/g, "").trim();
    var amount = Number(raw);
    if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw) || !(amount > 0)) return Promise.reject(new Error("Enter a payment amount greater than \u20B10.00."));
    amount = round2(amount);
    if (amount > balance) return Promise.reject(new Error("The payment cannot be more than the outstanding balance of \u20B1" + balance.toLocaleString("en-PH", { minimumFractionDigits: 2 }) + "."));
    var method = String(data.method || "");
    if (PAYMENT_METHODS.indexOf(method) === -1) return Promise.reject(new Error("Choose how the customer paid."));
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data.date || ""));
    if (!m) return Promise.reject(new Error("Choose the payment date."));
    var day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    var now = new Date();
    if (isNaN(day.getTime()) || localISODate(day) !== data.date) return Promise.reject(new Error("Choose a valid payment date."));
    if (data.date > localISODate(now)) return Promise.reject(new Error("The payment date cannot be in the future."));
    var reference = String(data.reference || "").trim().replace(/\s+/g, " ");
    var notes = String(data.notes || "").trim();
    if (reference.length > 40) return Promise.reject(new Error("Use a reference number of 40 characters or fewer."));
    if (notes.length > 200) return Promise.reject(new Error("Use notes of 200 characters or fewer."));

    var id = records.transactions.reduce(function (mx, t) { return Math.max(mx, t.id); }, 0) + 1;
    // Today's payments keep the actual time; an earlier date is recorded at noon of that day.
    var when = data.date === localISODate(now) ? now : day;
    var tx = { id: id, customerId: customer.id, type: "payment", amount: amount, date: when.toISOString(), method: method, balanceBefore: balance };
    if (reference) tx.reference = reference;
    if (notes) tx.note = notes;
    if (data.requestId) tx.requestId = String(data.requestId);
    customer.balance = round2(balance - amount);
    if (customer.balance <= 0) { customer.balance = 0; customer.overdueDays = 0; }   // fully paid: nothing is overdue any more
    records.transactions.push(tx);                                                    // existing records are kept as they are
    saveRecords(records);
    return Promise.resolve({ transaction: Object.assign({ code: trxCode(id) }, tx), customer: customer, balanceBefore: balance, duplicate: false });
  }

  // ---------- Edit Transaction (Transaction Details > Edit) ----------
  // updateTransaction(id, data) changes ONE existing transaction in place. Mock data only; when the API exists this becomes
  // PUT /transactions/{id}. The rules:
  //   - The transaction keeps its id (and so its TRX-0001 code), type, requestId and due date. Nothing else is created or deleted.
  //   - Credit  data: { customerId, date: "YYYY-MM-DD", items: [{ name, qty, qtyText, unit, price }] }
  //             the amount is recalculated from the items (quantity x unit price) and the note from the item names.
  //   - Payment data: { customerId, date, amount, method, reference, notes }
  //             the amount may not be more than what the customer owed just before this payment.
  //   - The customer's balance is corrected by the DIFFERENCE: the old effect of the transaction is taken out (a credit added to the
  //     balance, a payment took from it) and the new effect is put in. When the customer is changed, the old customer is corrected
  //     and so is the new one. A change that would make any balance negative (payments would then be more than credits) is refused.
  //   - Every other number (Dashboard, Customers, Customer Details, Overdue Accounts, Reports, the Paid / Partially paid / Unpaid
  //     status of credits) is calculated from the same records, so it follows by itself. Overdue days are refreshed for a customer
  //     whose credits have due dates; a customer with no balance is never overdue.
  // Rejects with an Error whose .code is: missing | customer | date | items | amount | method | reference | notes | balance
  // (.field names the form field to highlight). Resolves { transaction (decorated, with code), customer, previousCustomer, unchanged }.
  function editError(code, message, field) { var e = new Error(message); e.code = code; e.field = field || code; return e; }
  function pesoPlain(n) { return "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dayOf(iso) { return localISODate(new Date(iso)); }

  // The stored date-time for a chosen day: unchanged day keeps its time, today uses the current time, any other day is noon.
  function whenFor(day, oldIso) {
    if (oldIso && dayOf(oldIso) === day) return oldIso;
    var now = new Date();
    if (day === localISODate(now)) return now.toISOString();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).toISOString();
  }
  function checkDay(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return "Choose the date.";
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    if (isNaN(d.getTime()) || localISODate(d) !== value) return "Choose a valid date.";
    if (value > localISODate(new Date())) return "The date cannot be in the future.";
    if (Number(m[1]) < 2000) return "Choose a date from the year 2000 or later.";
    return "";
  }
  // A customer with credits that have due dates: overdue days come from the oldest unpaid credit that is past due (the Overdue Accounts rule).
  function refreshOverdue(records, customer) {
    if (!customer) return;
    if (!((customer.balance || 0) > 0)) { customer.overdueDays = 0; return; }
    var dated = records.transactions.some(function (t) { return t.customerId === customer.id && t.type === "credit" && t.dueDate; });
    if (!dated) return;   // no fixed dates: leave the stored value as it is
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), oldest = null;
    decorateTransactions(records).forEach(function (t) {
      if (t.customerId !== customer.id || t.type !== "credit" || !t.dueDate || !(t.remaining > 0)) return;
      var due = parseDay(t.dueDate);
      if (due && due < today && (!oldest || due < oldest)) oldest = due;
    });
    customer.overdueDays = oldest ? Math.round((today - oldest) / 86400000) : 0;
  }

  function cleanEditItems(list) {
    if (!Array.isArray(list) || !list.length) throw editError("items", "Add at least one item.", "items");
    return list.map(function (raw, i) {
      var label = "Item " + (i + 1) + ": ";
      var name = String(raw.name || "").trim().replace(/\s+/g, " ");
      var qty = Number(raw.qty), price = Number(raw.price);
      var unit = String(raw.unit || "").trim().replace(/\s+/g, " ");
      if (!name) throw editError("items", label + "enter the item name.", "item-" + i + "-name");
      if (name.length > 60) throw editError("items", label + "use 60 characters or fewer for the name.", "item-" + i + "-name");
      if (!isFinite(qty) || !(qty > 0)) throw editError("items", label + "the quantity must be more than 0.", "item-" + i + "-qty");
      if (qty > 9999) throw editError("items", label + "that quantity is too large.", "item-" + i + "-qty");
      if (unit.length > 20) throw editError("items", label + "use 20 characters or fewer for the unit.", "item-" + i + "-unit");
      if (!isFinite(price) || !(price > 0)) throw editError("items", label + "the unit price must be more than \u20B10.00.", "item-" + i + "-price");
      if (price > 100000) throw editError("items", label + "that unit price is too high.", "item-" + i + "-price");
      var item = { name: name, qty: Math.round(qty * 1000000) / 1000000, unit: unit.slice(0, 20), price: round2(price) };
      var qtyText = String(raw.qtyText || "").trim().slice(0, 12);
      if (qtyText) item.qtyText = qtyText;
      return item;
    });
  }

  // ---------- Change History (Transaction Details > Change History) ----------
  // Every successful Edit or Void adds ONE entry to the transaction's own `history` list (mock data only; when the API exists this
  // becomes GET /transactions/{id}/history, written by the server). The list is append-only: addHistory only adds, and nothing in this
  // file edits or removes an earlier entry, so the history cannot be rewritten by editing or voiding again.
  //   Edited: { id, action: "edited", at, by, changes: [{ field, label, before, after }] }   before / after are text as the owner saw
  //           them (or a list of lines for a changed item list), so the record stays readable even if the app changes later.
  //   Voided: { id, action: "voided", at, by, reason, reasonLabel, remarks, balanceBefore, balanceAfter }
  //   by: { name, role: "Store Owner" } for the person who did it, or null when that is not available.
  // An edit that changes no value adds no entry. A transaction voided before history existed has voidInfo but no entry: it is shown
  // as a Voided entry when read (changeHistory) and nothing is written for it.
  function actorName() {
    if (demoSession()) { var edits = readDemoSettings().profile || {}; return String(edits.fullName || DEMO_OWNER.fullName || "").trim(); }
    var owner = readJson(KEY_OWNER, null);
    return owner && owner.fullName ? String(owner.fullName).trim() : "";
  }
  function actor() { var name = actorName(); return name ? { name: name, role: "Store Owner" } : null; }
  function addHistory(tx, entry) {
    var list = Array.isArray(tx.history) ? tx.history : [];
    entry.id = "h" + (list.length + 1);
    tx.history = list.concat([entry]);   // a new list with the new entry last; earlier entries are never touched
  }
  // A due date as shown in Change History: "Nov 20, 2026" (read as a calendar day, never shifted by time zone) or "No due date"
  function dueShown(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "No due date";
  }
  function shortDay(iso) { return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); }
  function qtyShown(i) { return (i.qtyText || i.qty) + (i.unit ? " " + i.unit : ""); }
  function itemLine(i) { return i.name + " \u00B7 " + qtyShown(i) + " \u00D7 " + pesoPlain(i.price); }
  function sameQty(a, b) { return Number(a.qty) === Number(b.qty) && String(a.unit || "") === String(b.unit || ""); }

  // The values that really changed, old and new, in the order the Edit form shows them. `old` is the transaction before saving and
  // `next` the cleaned new values ({ amount, items | method, reference, notes }).
  function describeChanges(old, oldCustomer, customer, next, newIso, isCredit) {
    var changes = [];
    function add(field, label, before, after) {
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field: field, label: label, before: before, after: after });
    }
    if (!oldCustomer || oldCustomer.id !== customer.id) add("customer", "Customer", oldCustomer ? oldCustomer.name : (old.customer || "Unknown customer"), customer.name);
    if (dayOf(old.date) !== dayOf(newIso)) add("date", "Date", shortDay(old.date), shortDay(newIso));
    if (isCredit) {
      var was = (old.items && old.items.length) ? old.items : [{ name: old.note || "Credit", qty: 1, unit: "", price: old.amount }];
      var now = next.items;
      if (was.length === now.length) {   // same number of items: show exactly which part of which item changed
        now.forEach(function (item, n) {
          var before = was[n], tag = "Item " + (n + 1) + " (" + item.name + ")";
          if (before.name !== item.name) add("item-" + n + "-name", "Item " + (n + 1) + " name", before.name, item.name);
          if (!sameQty(before, item)) add("item-" + n + "-qty", tag + " quantity", qtyShown(before), qtyShown(item));
          if (round2(before.price) !== round2(item.price)) add("item-" + n + "-price", tag + " unit price", pesoPlain(before.price), pesoPlain(item.price));
        });
      } else {   // items were added or removed: show the whole list before and after
        add("items", "Items", was.map(itemLine), now.map(itemLine));
      }
      add("amount", "Total amount", pesoPlain(old.amount), pesoPlain(next.amount));
    } else {
      add("amount", "Payment amount", pesoPlain(old.amount), pesoPlain(next.amount));
      add("method", "Payment method", old.method || "Not specified", next.method);
      add("reference", "Reference number", old.reference || "Not provided", next.reference || "Not provided");
      add("notes", "Notes", old.note || "None", next.notes || "None");
    }
    return changes;
  }

  // The history to show: every recorded entry (oldest first by time; entries added in the same moment keep the order they were added in),
  // plus a Voided entry built from voidInfo for a transaction that was voided before history existed. Returns copies.
  function changeHistory(tx) {
    var list = (Array.isArray(tx.history) ? tx.history : []).map(function (e) { return JSON.parse(JSON.stringify(e)); });
    var v = tx.voidInfo;
    if (tx.voided && v && !list.some(function (e) { return e.action === "voided"; })) {
      list.push({ id: "void", action: "voided", at: v.at, by: v.by || null, reason: v.reason, reasonLabel: v.reasonLabel, remarks: v.remarks || "", balanceBefore: v.balanceBefore, balanceAfter: v.balanceAfter });
    }
    return list.map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return new Date(a.e.at) - new Date(b.e.at) || a.i - b.i; })
      .map(function (x) { return x.e; });
  }

  function getEditableTransaction(id) {
    // Real accounts: the transaction and the customer list come from the database through the API
    if (!isDemo()) {
      return window.CrediTrackHttp("/owner/transactions/" + encodeURIComponent(id)).then(function (transaction) {
        return getCustomersFromApi().then(function (list) {
          var customers = list.customers.map(function (c) { return { id: c.id, code: c.code, name: c.name, balance: round2(c.balance || 0), archived: !!c.archived }; });
          return { isSample: false, transaction: transaction, customers: customers, methods: PAYMENT_METHODS.slice(), today: localISODate(new Date()) };
        });
      }, function (error) {
        if (error.status !== 404) throw error;
        return { isSample: false, transaction: null, customers: [], methods: PAYMENT_METHODS.slice(), today: localISODate(new Date()) };   // the page shows "not found"
      });
    }
    var records = loadRecords();
    var transaction = decorateTransactions(records).filter(function (t) { return String(t.id) === String(id); })[0] || null;
    var customers = records.customers.map(function (c) { return { id: c.id, code: c.code, name: c.name, balance: round2(c.balance || 0), archived: !!c.archived }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "en", { sensitivity: "base" }); });
    return Promise.resolve({ isSample: isDemo(), transaction: transaction, customers: customers, methods: PAYMENT_METHODS.slice(), today: localISODate(new Date()) });
  }

  // Real accounts: PUT /api/owner/transactions/{id}. Credit { customerId, date, items, dueDate? }, payment { customerId, date, amount, method, reference, notes }.
  //   dueDate ("YYYY-MM-DD") is sent only to SET or CHANGE a credit's due date. removeDueDate: true REMOVES it (the API saves DueDate as NULL).
  //   -> { transaction, customer, unchanged }
  function updateTransactionViaApi(id, data) {
    var body = { customerId: Number(data.customerId), date: data.date };
    if (data.items) body.items = data.items;
    if (data.dueDate) body.dueDate = String(data.dueDate);
    if (data.removeDueDate) body.removeDueDate = true;
    if (data.amount !== undefined && data.amount !== null && data.amount !== "") body.amount = Number(String(data.amount).replace(/,/g, ""));
    if (data.method !== undefined) body.method = data.method;
    if (data.reference !== undefined) body.reference = data.reference;
    if (data.notes !== undefined) body.notes = data.notes;
    return window.CrediTrackHttp("/owner/transactions/" + encodeURIComponent(id), { method: "PUT", body: body }).then(function (r) {
      return { transaction: r.transaction, customer: r.customer, unchanged: r.changed === false };
    });
  }

  function updateTransaction(id, data) {
    data = data || {};
    if (!isDemo()) return updateTransactionViaApi(id, data);
    return new Promise(function (resolve) {
      var records = loadRecords();
      var tx = records.transactions.filter(function (t) { return String(t.id) === String(id); })[0];
      if (!tx || (tx.type !== "credit" && tx.type !== "payment")) throw editError("missing", "This transaction could not be found.", "");
      if (tx.voided) throw editError("voided", "This transaction has been voided and can no longer be edited.", "");
      var isCredit = tx.type === "credit";
      var oldCustomer = records.customers.filter(function (c) { return c.id === tx.customerId; })[0] || null;
      var customer = records.customers.filter(function (c) { return String(c.id) === String(data.customerId); })[0];
      if (!customer) throw editError("customer", "Choose the customer.", "customer");
      if (isCredit && customer.archived && customer.id !== tx.customerId) throw editError("customer", customer.name + " is archived. Restore the customer before moving credit to them.", "customer");
      var dayError = checkDay(data.date);
      if (dayError) throw editError("date", dayError, "date");

      // Due date: a credit can receive one or change it (today or later, within 5 years). Sending the date it already has changes nothing.
      // An empty dueDate is ignored: only removeDueDate: true removes the due date (credit only).
      var dueText = data.dueDate === undefined || data.dueDate === null ? "" : String(data.dueDate).trim(), newDue = null;
      if (dueText) {
        if (!isCredit) throw editError("dueDate", "Only a credit can have a due date.", "dueDate");
        if (tx.dueDate !== dueText) {
          var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueText), dd = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : null, nowDay = new Date();
          nowDay = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate());
          if (!dd || isNaN(dd.getTime()) || localISODate(dd) !== dueText) throw editError("dueDate", "Enter a valid due date.", "dueDate");
          if (dueText < localISODate(nowDay)) throw editError("dueDate", "The due date cannot be in the past.", "dueDate");
          if (dueText > localISODate(new Date(nowDay.getFullYear() + 5, nowDay.getMonth(), nowDay.getDate()))) throw editError("dueDate", "That due date is too far away. Choose a date within 5 years.", "dueDate");
          newDue = dueText;
        }
      }
      var removeDue = false;
      if (data.removeDueDate) {
        if (!isCredit) throw editError("dueDate", "Only a credit can have a due date.", "dueDate");
        if (dueText) throw editError("dueDate", "Choose either a due date or remove it, not both.", "dueDate");
        removeDue = !!tx.dueDate;
      }

      var next = { amount: 0 }, available = 0;
      if (isCredit) {
        next.items = cleanEditItems(data.items);
        next.amount = round2(next.items.reduce(function (sum, it) { return sum + round2(it.qty * it.price); }, 0));
        next.note = next.items.map(function (it) { return it.name; }).join(", ");
      } else {
        var raw = String(data.amount === undefined || data.amount === null ? "" : data.amount).replace(/,/g, "").replace(/^\u20B1/, "").trim();
        if (!raw) throw editError("amount", "Enter the payment amount.", "amount");
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) throw editError("amount", "Enter an amount greater than \u20B10.00, like 250 or 250.50.", "amount");
        next.amount = round2(Number(raw));
        // What the customer owed just before this payment: their balance, plus this payment when it already counts for them.
        available = round2((customer.balance || 0) + (oldCustomer && oldCustomer.id === customer.id ? tx.amount : 0));
        if (!(available > 0)) throw editError("amount", customer.name + " has no outstanding balance to pay.", "amount");
        if (next.amount > available) throw editError("amount", "The payment cannot be more than the outstanding balance of " + pesoPlain(available) + " before this payment.", "amount");
        next.method = String(data.method || "");
        if (PAYMENT_METHODS.indexOf(next.method) === -1) throw editError("method", "Choose how the customer paid.", "method");
        next.reference = String(data.reference || "").trim().replace(/\s+/g, " ");
        if (next.reference.length > 40) throw editError("reference", "Use a reference number of 40 characters or fewer.", "reference");
        next.notes = String(data.notes || "").trim();
        if (next.notes.length > 200) throw editError("notes", "Use notes of 200 characters or fewer.", "notes");
      }

      // Nothing to save when no value changed
      var same = !newDue && !removeDue && customer.id === tx.customerId && data.date === dayOf(tx.date) && next.amount === round2(tx.amount) &&
        (isCredit ? JSON.stringify(next.items.map(function (i) { return [i.name, i.qty, i.unit, i.price]; })) === JSON.stringify((tx.items || []).map(function (i) { return [i.name, i.qty, i.unit || "", i.price]; }))
                  : next.method === tx.method && next.reference === (tx.reference || "") && next.notes === (tx.note || ""));
      if (same) {
        var current = decorateTransactions(records).filter(function (t) { return t.id === tx.id; })[0];
        return resolve({ transaction: current, customer: customer, previousCustomer: oldCustomer, unchanged: true });
      }

      // The customer's balance changes by the difference (a credit adds to it, a payment takes from it)
      var sign = isCredit ? 1 : -1, newBalance, oldNewBalance = null;
      if (oldCustomer && oldCustomer.id === customer.id) {
        newBalance = round2((customer.balance || 0) - sign * tx.amount + sign * next.amount);
      } else {
        newBalance = round2((customer.balance || 0) + sign * next.amount);
        if (oldCustomer) oldNewBalance = round2((oldCustomer.balance || 0) - sign * tx.amount);
      }
      if (newBalance < 0) throw editError("balance", customer.name + "\u2019s balance would drop below \u20B10.00: the payments recorded for this customer would be more than their credits. Check the amounts, or edit the payment first.", isCredit ? "items" : "amount");
      if (oldNewBalance !== null && oldNewBalance < 0) throw editError("balance", oldCustomer.name + "\u2019s balance would drop below \u20B10.00 without this credit: they have already paid more than their remaining credits. Keep this credit with " + oldCustomer.name + ", or edit their payments first.", "customer");

      // Change History: note what is about to change (old value -> new value) before the record is overwritten
      var newWhen = whenFor(data.date, tx.date);
      var changes = describeChanges(tx, oldCustomer, customer, next, newWhen, isCredit);
      // Due date added (No due date -> date), changed (date -> date) or removed (date -> No due date): same entry, same shape
      if (newDue || removeDue) changes.push({ field: "dueDate", label: "Due date", before: dueShown(tx.dueDate), after: dueShown(newDue || "") });
      var editedAt = new Date().toISOString();

      // Save: the id, type and requestId stay as they are; the due date stays too, unless one was just set or changed
      if (newDue) tx.dueDate = newDue;
      if (removeDue) delete tx.dueDate;   // no due date: the field is gone, so the credit can never be overdue
      tx.customerId = customer.id;
      if ("customer" in tx) tx.customer = customer.name;
      tx.amount = next.amount;
      tx.date = newWhen;
      if (isCredit) { tx.items = next.items; tx.note = next.note; }
      else {
        tx.method = next.method;
        if (next.reference) tx.reference = next.reference; else delete tx.reference;
        if (next.notes) tx.note = next.notes; else delete tx.note;
        tx.balanceBefore = available;
      }
      customer.balance = newBalance <= 0 ? 0 : newBalance;
      if (oldNewBalance !== null) oldCustomer.balance = oldNewBalance <= 0 ? 0 : oldNewBalance;
      refreshOverdue(records, customer);
      if (oldNewBalance !== null) refreshOverdue(records, oldCustomer);
      if (changes.length) addHistory(tx, { action: "edited", at: editedAt, by: actor(), changes: changes });   // saved together with the edit below
      saveRecords(records);
      var saved = decorateTransactions(records).filter(function (t) { return t.id === tx.id; })[0];
      resolve({ transaction: saved, customer: customer, previousCustomer: oldCustomer, unchanged: false });
    });
  }

  // ---------- Void Transaction (Transaction Details > Void Transaction) ----------
  // A transaction is never deleted. Voiding keeps the original record exactly as it was (customer, items or payment details, amount,
  // date, id and TRX code) and marks it { voided: true, voidInfo: { at, reason, remarks, balanceBefore, balanceAfter } }. Mock data only;
  // when the API exists this becomes POST /transactions/{id}/void.
  //   - The effect on the customer's outstanding balance is reversed: a voided credit takes its amount off the balance, a voided
  //     payment puts its amount back on it. Overdue days are refreshed (the same rule as Edit Transaction).
  //   - A voided transaction no longer counts anywhere: the Dashboard totals (they add up customer balances), Customers, Overdue
  //     Accounts, Reports (cards, chart, recent, table, export) and the Paid / Partially paid / Unpaid status of credits are all worked out
  //     from the same records, and decorateTransactions / isReportable / getCustomer skip voided rows. It stays visible in lists as "Voided".
  //   - It cannot be voided twice, and a voided transaction cannot be edited (updateTransaction refuses it).
  //   - A credit cannot be voided when that would make the balance negative (the customer has already paid more than their other credits):
  //     void or edit those payments first. This mirrors the rule in Edit Transaction.
  // The reason is one of VOID_REASONS; "other" needs remarks (5-200 characters), the others may not have any.
  var VOID_REASONS = { duplicate: "Duplicate transaction", incorrect: "Incorrect entry", other: "Other" };
  var VOID_REMARKS_MIN = 5, VOID_REMARKS_MAX = 200;
  function voidError(code, message, field) { var e = new Error(message); e.code = code; e.field = field || code; return e; }

  // What voiding would do, without changing anything (the confirmation dialog shows this).
  // Resolves { canVoid, code ("" | missing | voided | balance), message, transaction (decorated), customer, balanceBefore, balanceAfter }
  // Real account: GET /owner/transactions/{id}/void-preview, plus the transaction and customer the dialog shows
  function getVoidPreviewApi(id) {
    var enc = encodeURIComponent(id);
    return window.CrediTrackHttp("/owner/transactions/" + enc).then(function (tx) {
      return Promise.all([
        window.CrediTrackHttp("/owner/transactions/" + enc + "/void-preview"),
        window.CrediTrackHttp("/owner/customers/" + tx.customerId)
      ]).then(function (r) {
        var pv = r[0];
        return { canVoid: !!pv.canVoid, code: tx.voided ? "voided" : (pv.canVoid ? "" : "balance"), message: pv.blockReason || "",
          transaction: tx, customer: r[1], balanceBefore: pv.balanceBefore, balanceAfter: pv.balanceAfter };
      });
    }, function (error) {
      if (error.status !== 404) throw error;
      return { canVoid: false, code: "missing", message: "This transaction could not be found.", transaction: null, customer: null, balanceBefore: 0, balanceAfter: 0 };
    });
  }

  // Real account: POST /owner/transactions/{id}/void { reason: "Duplicate transaction" | "Incorrect entry" | "Other", remarks }
  function voidTransactionViaApi(id, data) {
    var label = VOID_REASONS[String(data.reason || "")];
    return window.CrediTrackHttp("/owner/transactions/" + encodeURIComponent(id) + "/void",
      { method: "POST", body: { reason: label || "", remarks: String(data.remarks || "").trim() } }).then(function (r) {
      return { transaction: r.transaction, customer: r.customer, balanceBefore: r.balanceBefore, balanceAfter: r.balanceAfter };
    }, function (error) {
      if (error.status === 409) error.code = "voided";   // already voided (second tab or double tap)
      throw error;
    });
  }

  function getVoidPreview(id) {
    if (!isDemo()) return getVoidPreviewApi(id);
    var records = loadRecords();
    var tx = records.transactions.filter(function (t) { return String(t.id) === String(id); })[0];
    var decorated = tx ? decorateTransactions(records).filter(function (t) { return t.id === tx.id; })[0] : null;
    if (!tx || (tx.type !== "credit" && tx.type !== "payment")) return Promise.resolve({ canVoid: false, code: "missing", message: "This transaction could not be found.", transaction: null, customer: null, balanceBefore: 0, balanceAfter: 0 });
    var customer = records.customers.filter(function (c) { return c.id === tx.customerId; })[0] || null;
    var before = round2(customer ? customer.balance || 0 : 0);
    var after = round2(tx.type === "credit" ? before - tx.amount : before + tx.amount);
    var out = { canVoid: true, code: "", message: "", transaction: decorated, customer: customer, balanceBefore: before, balanceAfter: after };
    if (tx.voided) { out.canVoid = false; out.code = "voided"; out.message = "This transaction has already been voided."; out.balanceAfter = before; }
    else if (!customer) { out.canVoid = false; out.code = "missing"; out.message = "The customer for this transaction could not be found."; }
    else if (after < 0) {
      out.canVoid = false; out.code = "balance";
      out.message = "This credit can\u2019t be voided yet. Voiding it would take " + customer.name + "\u2019s balance below \u20B10.00, because the payments recorded for them are more than their other credits. Void or edit those payments first.";
    }
    return Promise.resolve(out);
  }

  // data: { reason: "duplicate" | "incorrect" | "other", remarks }
  // Rejects with an Error whose .code is: missing | voided | reason | remarks | balance (.field names the form field).
  // Resolves { transaction (decorated), customer, balanceBefore, balanceAfter }. Nothing is changed when it rejects.
  function voidTransaction(id, data) {
    data = data || {};
    if (!isDemo()) return voidTransactionViaApi(id, data);
    return new Promise(function (resolve) {
      var records = loadRecords();
      var tx = records.transactions.filter(function (t) { return String(t.id) === String(id); })[0];
      if (!tx || (tx.type !== "credit" && tx.type !== "payment")) throw voidError("missing", "This transaction could not be found.", "");
      if (tx.voided) throw voidError("voided", "This transaction has already been voided.", "");   // safe to call twice (double tap, second tab)
      var customer = records.customers.filter(function (c) { return c.id === tx.customerId; })[0];
      if (!customer) throw voidError("missing", "The customer for this transaction could not be found.", "");

      var reason = String(data.reason || "");
      if (!VOID_REASONS[reason]) throw voidError("reason", "Choose why this transaction is being voided.", "reason");
      var remarks = String(data.remarks || "").trim().replace(/\s+/g, " ");
      if (reason === "other") {
        if (!remarks) throw voidError("remarks", "Tell us why you are voiding this transaction.", "remarks");
        if (remarks.length < VOID_REMARKS_MIN) throw voidError("remarks", "Add a little more detail (at least " + VOID_REMARKS_MIN + " characters).", "remarks");
        if (remarks.length > VOID_REMARKS_MAX) throw voidError("remarks", "Use " + VOID_REMARKS_MAX + " characters or fewer.", "remarks");
      } else remarks = "";

      // Reverse the effect on the balance
      var before = round2(customer.balance || 0);
      var after = round2(tx.type === "credit" ? before - tx.amount : before + tx.amount);
      if (after < 0) throw voidError("balance", "This credit can\u2019t be voided yet. Voiding it would take " + customer.name + "\u2019s balance below \u20B10.00, because the payments recorded for them are more than their other credits. Void or edit those payments first.", "");

      // Mark it voided. Everything else about the record stays exactly as it was.
      var voidedAt = new Date().toISOString();
      tx.voided = true;
      // by = the person who voided it ({ name, role }), kept on the record itself so it always shows who was responsible
      tx.voidInfo = { at: voidedAt, by: actor(), reason: reason, reasonLabel: VOID_REASONS[reason], remarks: remarks, balanceBefore: before, balanceAfter: after };
      addHistory(tx, { action: "voided", at: voidedAt, by: actor(), reason: reason, reasonLabel: VOID_REASONS[reason], remarks: remarks, balanceBefore: before, balanceAfter: after });   // Change History
      customer.balance = after;
      refreshOverdue(records, customer);
      saveRecords(records);
      var saved = decorateTransactions(records).filter(function (t) { return t.id === tx.id; })[0];
      resolve({ transaction: saved, customer: customer, balanceBefore: before, balanceAfter: after });
    });
  }

  // ---------- Payment Requests (Review Payment) ----------
  // The owner reviews payments that customers say they made. Mock data only; when the API exists these become
  // GET /payment-requests, GET /payment-requests/{id}, POST /payment-requests/{id}/approve and POST /payment-requests/{id}/reject.
  //   approve  creates ONE payment transaction (through addPayment, so the customer's balance is lowered by the same rules as Record Bayad),
  //            marks the request approved and records a notification. Safe to repeat: a request that is no longer pending is refused, and the
  //            payment is tagged with the request (requestId "payreq-<id>") so a second one can never be created for it.
  //   reject   needs a reason (5-200 characters), marks the request rejected and records a notification. It never touches transactions or balances.
  var REASON_MIN = 5, REASON_MAX = 200;
  function requestKey(id) { return "payreq-" + id; }
  function findRequest(records, id) { return records.paymentRequests.filter(function (r) { return String(r.id) === String(id); })[0] || null; }
  // The four payment statuses used everywhere: Pending (waiting for the owner), Confirmed (a payment was recorded and lowered the
  // balance), Rejected (never touches the balance) and Voided (a confirmed payment that was voided: its effect on the balance is reversed).
  // Only Confirmed payments affect outstanding balances.
  var PAYMENT_STATUS = { pending: "Pending", confirmed: "Confirmed", rejected: "Rejected", voided: "Voided" };
  function requestPaymentStatus(records, r) {
    if (r.status === "pending") return "pending";
    if (r.status === "rejected") return "rejected";
    var tx = records.transactions.filter(function (t) { return t.requestId === requestKey(r.id) || (r.transactionId && t.id === r.transactionId); })[0];
    return tx && tx.voided ? "voided" : "confirmed";
  }
  function decorateRequest(records, r) {
    var customer = records.customers.filter(function (c) { return c.id === r.customerId; })[0] || null;
    var paymentStatus = requestPaymentStatus(records, r);
    var vtx = paymentStatus === "voided" ? records.transactions.filter(function (t) { return t.requestId === requestKey(r.id) || (r.transactionId && t.id === r.transactionId); })[0] : null;
    return Object.assign({}, r, {
      paymentStatus: paymentStatus,
      voidInfo: vtx && vtx.voidInfo ? vtx.voidInfo : null,
      transactionId: r.transactionId || (vtx ? vtx.id : r.transactionId),
      customer: customer ? customer.name : r.customer,
      customerCode: customer ? customer.code : "",
      customerBalance: customer ? round2(customer.balance || 0) : 0,
      balanceAfter: customer ? Math.max(0, round2((customer.balance || 0) - r.amount)) : 0,
      exceedsBalance: customer ? round2(r.amount) > round2(customer.balance || 0) : true,
      reference: r.reference || "", proof: r.proof || "", note: r.note || "",
      archived: !!r.archived, archivedAt: r.archivedAt || ""
    });
  }
  function reviewTime(r) { return new Date(r.reviewedAt || r.submittedAt).getTime(); }
  // -> { isSample, requests (pending first, oldest waiting first... newest first within each status), counts: { pending, approved, rejected, all } }
  function getPaymentRequests() {
    var records = loadRecords();
    var list = records.paymentRequests.map(function (r) { return decorateRequest(records, r); });
    // Archived requests (reviewed ones the owner tidied away) are counted only under "archived"; the status tabs and All leave them out.
    var counts = { pending: 0, confirmed: 0, rejected: 0, voided: 0, all: 0, archived: 0 };
    list.forEach(function (r) { if (r.archived) counts.archived++; else { counts[r.paymentStatus]++; counts.all++; } });
    counts.approved = counts.confirmed;   // older name for Confirmed
    list.sort(function (a, b) {
      if ((a.status === "pending") !== (b.status === "pending")) return a.status === "pending" ? -1 : 1;
      return (a.status === "pending" ? new Date(b.submittedAt) - new Date(a.submittedAt) : reviewTime(b) - reviewTime(a));
    });
    return Promise.resolve({ isSample: isDemo(), requests: list, counts: counts });
  }
  // ---------- Payment Requests: filtered, paginated list ----------
  // BACKEND CONTRACT (future: GET /api/payment-requests)
  //   query    { status: "pending" | "confirmed" | "rejected" | "voided" | "all" | "archived", page, pageSize }
  //   response { isSample, items, totalCount, page, pageSize, totalPages, hasMore,
  //              counts: { pending, confirmed, rejected, voided, all, archived } }
  //   "all" leaves archived requests out and "archived" shows only them (same rule as before). Pending first-come order is
  //   unchanged: pending ones newest first, reviewed ones by review time, newest first.
  //   counts always cover every request (not the page and not the chosen status), so the chips can show their numbers.
  // Replace ONLY this body with a fetch to the API later; the Payment Requests page does not change.
  var REQUEST_STATUS_FILTERS = ["pending", "confirmed", "rejected", "voided", "all", "archived"];
  // ---- Real accounts: payment requests come from /api/owner/payment-requests (only the signed-in owner's store) ----
  // The API names a few fields differently from the screens (message / rejectReason / proof picture), so this renames them once, here.
  function requestFromApi(r) {
    return Object.assign({}, r, {
      note: r.message || "", rejectionReason: r.rejectReason || "", reference: r.reference || "", proof: r.proof || "",
      archived: !!r.archived, voidInfo: null
    });
  }
  function requestUrl(id, action) { return "/owner/payment-requests/" + encodeURIComponent(id) + (action ? "/" + action : ""); }
  function queryPaymentRequestsApi(query) {
    var Q = window.CrediTrackQuery;
    query = query || {};
    var status = Q.pick(query.status, REQUEST_STATUS_FILTERS, "pending");
    var paging = Q.normalizePaging ? Q.normalizePaging(query) : { page: query.page || 1, pageSize: query.pageSize || 20 };
    var url = "/owner/payment-requests?status=" + encodeURIComponent(status) + "&page=" + paging.page + "&pageSize=" + paging.pageSize;
    return window.CrediTrackHttp(url).then(function (d) {
      var counts = Object.assign({ pending: 0, confirmed: 0, rejected: 0, voided: 0, all: 0, archived: 0 }, d.counts || {});
      counts.approved = counts.confirmed;   // older name for Confirmed
      d.items = (d.items || []).map(requestFromApi);
      d.counts = counts;
      d.isSample = false;
      return d;
    });
  }
  function queryPaymentRequests(query) {
    if (!isDemo()) return queryPaymentRequestsApi(query);
    var Q = window.CrediTrackQuery;
    query = query || {};
    var status = Q.pick(query.status, REQUEST_STATUS_FILTERS, "pending");
    return getPaymentRequests().then(function (data) {
      var matches = data.requests.filter(function (r) {
        if (status === "archived") return r.archived;
        return !r.archived && (status === "all" || r.paymentStatus === status);
      });
      return Object.assign({ isSample: data.isSample, counts: data.counts }, Q.paginate(matches, query));
    });
  }
  // -> { isSample, request (or null), transaction (the payment an approved request created, or null) }
  function getPaymentRequest(id) {
    if (!isDemo()) {
      return window.CrediTrackHttp(requestUrl(id)).then(function (d) {
        var r = requestFromApi(d.request), balance = Number(d.customerBalance) || 0;
        r.customerBalance = balance;
        r.balanceAfter = Math.max(0, round2(balance - r.amount));
        r.exceedsBalance = round2(r.amount) > round2(balance);
        r.voidInfo = d.voidInfo || null;
        var tx = r.transactionId ? { id: r.transactionId, code: r.transactionCode } : null;
        return { isSample: false, request: r, transaction: tx };
      }, function (err) {
        if (err && err.status === 404) return { isSample: false, request: null, transaction: null };   // the page shows "not found"
        throw err;
      });
    }
    var records = loadRecords(), found = findRequest(records, id);
    var request = found ? decorateRequest(records, found) : null;
    var tx = request && request.transactionId ? records.transactions.filter(function (t) { return t.id === request.transactionId; })[0] : null;
    return Promise.resolve({ isSample: isDemo(), request: request, transaction: tx ? Object.assign({ code: trxCode(tx.id) }, tx) : null });
  }
  function addNotification(records, type, title, message, target) {
    var next = (records.notifications || []).reduce(function (mx, n) { return Math.max(mx, parseInt(String(n.id).replace(/\D/g, ""), 10) || 0); }, 0) + 1;
    records.notifications = records.notifications || [];
    records.notifications.push({ id: "n" + next, type: type, title: title, message: message, createdAt: new Date().toISOString(), read: true, target: target });   // the owner did this just now, so it is already read
  }
  // The "New Payment Request" notification for a reviewed request is done with: mark it read
  function settleRequestNotifications(records, requestId) {
    (records.notifications || []).forEach(function (n) { if (n.type === "payment_request" && String(n.requestId) === String(requestId)) n.read = true; });
  }
  function alreadyReviewed(r, records) {
    var done = records ? requestPaymentStatus(records, r) : (r.status === "approved" ? "confirmed" : r.status);   // confirmed | rejected | voided
    var err = new Error("This payment was already " + done + " and cannot be reviewed again.");
    err.code = "reviewed";
    return err;
  }
  // -> { request, transaction, customer, balanceBefore, duplicate }   (rejects with an Error when it cannot be approved)
  function approvePaymentRequest(id) {
    if (!isDemo()) {
      // The server records the payment and confirms the request together (or neither), and refuses a second approval
      return window.CrediTrackHttp(requestUrl(id, "approve"), { method: "POST" }).then(function (d) {
        var request = requestFromApi(d.request);
        return { request: request, transaction: { id: d.transactionId, code: request.transactionCode }, customer: { balance: d.balanceAfter },
          balanceBefore: d.balanceBefore, duplicate: false };
      });
    }
    var records = loadRecords(), r = findRequest(records, id);
    if (!r) return Promise.reject(new Error("Payment request not found."));
    var existing = records.transactions.filter(function (t) { return t.requestId === requestKey(r.id); })[0];
    if (r.status !== "pending") return Promise.reject(alreadyReviewed(r, records));   // confirmed, rejected or voided already: never a second payment
    if (existing && existing.voided) return Promise.reject(alreadyReviewed(Object.assign({}, r, { status: "approved" }), records));
    var customer = records.customers.filter(function (c) { return c.id === r.customerId; })[0];
    if (!customer) return Promise.reject(new Error("This customer is no longer in your records."));
    // The same reference number (same customer and method) must not be recorded twice: that would be the same payment counted twice.
    var ref = String(r.reference || "").trim().toLowerCase();
    var sameRef = ref && records.transactions.filter(function (t) {
      return t.type === "payment" && !t.voided && t.customerId === r.customerId && t.method === r.method && String(t.reference || "").trim().toLowerCase() === ref && t.requestId !== requestKey(r.id);
    })[0];
    if (sameRef && !existing) { var dup = new Error("A payment with reference number " + r.reference + " was already recorded for " + customer.name + " (" + trxCode(sameRef.id) + "). Reject this request, or void that payment first."); dup.code = "duplicate"; return Promise.reject(dup); }
    var payment = existing
      ? Promise.resolve({ transaction: Object.assign({ code: trxCode(existing.id) }, existing), customer: customer, balanceBefore: existing.balanceBefore, duplicate: true })
      : addPayment({ customerId: r.customerId, amount: r.amount, method: r.method, date: localISODate(new Date()), reference: r.reference, notes: "Approved payment request", requestId: requestKey(r.id) });
    return payment.then(function (result) {
      var fresh = loadRecords(), req = findRequest(fresh, id);       // addPayment saved the records, so read them again
      req.status = "approved";
      req.reviewedAt = new Date().toISOString();
      req.transactionId = result.transaction.id;
      delete req.rejectionReason;
      settleRequestNotifications(fresh, req.id);
      var who = (fresh.customers.filter(function (c) { return c.id === req.customerId; })[0] || {}).name || req.customer;
      if (!result.duplicate) addNotification(fresh, "payment_approved", "Payment Request Approved", "You confirmed " + who + "\u2019s " + req.method + " payment of " + pesoText(req.amount) + ". Their balance was updated.", { kind: "transaction", id: result.transaction.id });
      saveRecords(fresh);
      return { request: decorateRequest(fresh, req), transaction: result.transaction, customer: result.customer, balanceBefore: result.balanceBefore, duplicate: result.duplicate };
    });
  }
  // -> { request }   (rejects with an Error, and .errors = { reason } when the reason is missing or too long)
  function rejectPaymentRequest(id, reason) {
    var demo = isDemo();
    var records = demo ? loadRecords() : null, r = demo ? findRequest(records, id) : null;
    if (demo && !r) return Promise.reject(new Error("Payment request not found."));
    if (demo && r.status !== "pending") return Promise.reject(alreadyReviewed(r, records));
    var text = cleanText(reason), message = "";
    if (!text) message = "Enter a reason for rejecting this payment.";
    else if (text.length < REASON_MIN) message = "Please give a little more detail (at least " + REASON_MIN + " characters).";
    else if (text.length > REASON_MAX) message = "The reason is too long (" + REASON_MAX + " characters at most).";
    if (message) { var err = new Error(message); err.errors = { reason: message }; return Promise.reject(err); }
    if (!demo) {
      return window.CrediTrackHttp(requestUrl(id, "reject"), { method: "POST", body: { reason: text } }).then(function (d) {
        return { request: requestFromApi(d) };
      }, function (e) {
        if (e && e.field === "reason") e.errors = { reason: e.message };   // the page shows it under the reason box
        throw e;
      });
    }
    r.status = "rejected";
    r.reviewedAt = new Date().toISOString();
    r.rejectionReason = text;
    settleRequestNotifications(records, r.id);
    var who = (records.customers.filter(function (c) { return c.id === r.customerId; })[0] || {}).name || r.customer;
    addNotification(records, "payment_rejected", "Payment Request Rejected", "You rejected " + who + "\u2019s " + r.method + " payment request of " + pesoText(r.amount) + ". Their balance was not changed.", { kind: "route", route: "owner-payment-request?id=" + r.id });
    saveRecords(records);
    return Promise.resolve({ request: decorateRequest(records, r) });
  }

  // Archive / Restore a payment request. Only a REVIEWED request (confirmed, rejected or voided) can be archived: a pending one still needs
  // a decision. Archiving only hides it from the status tabs; the request, its payment transaction and every balance are not touched.
  // -> { request } or an Error with .code: missing | pending | already
  function setRequestArchived(id, archived) {
    if (!isDemo()) {
      return window.CrediTrackHttp(requestUrl(id, archived ? "archive" : "restore"), { method: "POST" }).then(function (d) { return { request: requestFromApi(d) }; });
    }
    var records = loadRecords(), r = findRequest(records, id);
    if (!r) { var m = new Error("Payment request not found."); m.code = "missing"; return Promise.reject(m); }
    if (archived && r.status === "pending") { var p = new Error("A pending payment request must be confirmed or rejected before it can be archived."); p.code = "pending"; return Promise.reject(p); }
    if (!!r.archived === archived) { var a = new Error(archived ? "This payment request is already archived." : "This payment request is not archived."); a.code = "already"; return Promise.reject(a); }
    if (archived) { r.archived = true; r.archivedAt = new Date().toISOString(); } else { delete r.archived; delete r.archivedAt; }
    saveRecords(records);
    return Promise.resolve({ request: decorateRequest(records, r) });
  }
  function archivePaymentRequest(id) { return setRequestArchived(id, true); }
  function restorePaymentRequest(id) { return setRequestArchived(id, false); }

  // ---------- Notifications ----------
  // Real accounts: the server makes the notifications (a customer sent a payment request, a customer joined ...) and keeps
  // which ones were read: GET /notifications, GET /notifications/unread-count, POST /notifications/{id}/read, POST /notifications/read-all.
  // Demo mode keeps its sample notifications in the browser (see sampleNotifications).
  // A server notification points at a record: customer / transaction go to that page, a payment request opens its Review page.
  function ownerNotificationFromApi(n) {
    var t = n.target, target = null;
    if (t && t.kind === "customer") target = { kind: "customer", id: t.id };
    else if (t && t.kind === "transaction") target = { kind: "transaction", id: t.id };
    else if (t && t.kind === "request") target = { kind: "route", route: "owner-payment-request?id=" + t.id };
    else if (t && t.kind === "join_request") target = { kind: "route", route: "owner-customers" };   // the Join requests card sits at the top of Customers
    return { id: n.id, type: n.type, title: n.title, message: n.message, createdAt: n.createdAt, read: !!n.read, target: target };
  }
  function notificationList(records) {
    return (records.notifications || []).slice()
      .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }
  function unreadIn(list) { return list.filter(function (n) { return !n.read; }).length; }
  // -> { isSample, notifications (newest first), total, unread }
  function getNotifications() {
    if (!isDemo()) {
      return window.CrediTrackHttp("/notifications").then(function (r) {
        var list = (r.notifications || []).map(ownerNotificationFromApi);
        return { isSample: false, notifications: list, total: r.total || list.length, unread: r.unread || 0 };
      });
    }
    var list = notificationList(loadRecords());
    return Promise.resolve({ isSample: isDemo(), notifications: list, total: list.length, unread: unreadIn(list) });
  }
  function getUnreadNotificationCount() {
    if (!isDemo()) return window.CrediTrackHttp ? window.CrediTrackHttp("/notifications/unread-count").then(function (r) { return (r && r.unread) || 0; }, function () { return 0; }) : Promise.resolve(0);
    return Promise.resolve(unreadIn(loadRecords().notifications || []));
  }
  // -> { notification, unread }   (marking one that is already read changes nothing)
  function markNotificationRead(id) {
    if (!isDemo()) return window.CrediTrackHttp("/notifications/" + encodeURIComponent(id) + "/read", { method: "POST" });
    var records = loadRecords();
    var found = (records.notifications || []).filter(function (n) { return String(n.id) === String(id); })[0];
    if (!found) return Promise.reject(new Error("Notification not found."));
    if (!found.read) { found.read = true; saveRecords(records); }
    return Promise.resolve({ notification: found, unread: unreadIn(records.notifications) });
  }
  // -> { changed (how many were unread), unread (always 0 afterwards) }
  function markAllNotificationsRead() {
    if (!isDemo()) return window.CrediTrackHttp("/notifications/read-all", { method: "POST" });
    var records = loadRecords();
    var changed = 0;
    (records.notifications || []).forEach(function (n) { if (!n.read) { n.read = true; changed++; } });
    if (changed) saveRecords(records);
    return Promise.resolve({ changed: changed, unread: 0 });
  }

  // ---------- Overdue Accounts ----------
  // An account is overdue only when ALL of this is true (mock data, same records as every other page):
  //   - the customer still owes money (balance > 0),
  //   - they have a credit with an agreed due date (dueDate) that is BEFORE today (due today is not overdue yet),
  //   - and that credit is still unpaid. Payments are applied to a customer's oldest credits first (decorateTransactions),
  //     the same rule Transaction History uses, so a credit that has been paid off never counts.
  // A credit with no dueDate ("no fixed date") is never overdue, so a customer who only has those is not listed.
  // Per account: outstanding = the customer's whole balance; overdueAmount = what is still unpaid on the credits that are past due
  // (never more than the balance); dueDate = the OLDEST past-due date; daysOverdue = days since that date.
  // -> { isSample, hasRecords, count, total (sum of overdue amounts), accounts: [...] } sorted by days overdue (most first), then amount.
  // The ONE place that decides who is overdue and by how much. The Overdue Accounts page, the Dashboard, Customers and Reports all use it.
  function computeOverdue(records) {
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var byCustomer = {};
    decorateTransactions(records).forEach(function (t) {
      if (t.type !== "credit" || !t.dueDate || !(t.remaining > 0)) return;
      var due = parseDay(t.dueDate);
      if (!due || due >= today) return;
      (byCustomer[t.customerId] = byCustomer[t.customerId] || []).push({ due: due, remaining: t.remaining });
    });
    var accounts = [];
    records.customers.forEach(function (c) {
      var late = byCustomer[c.id];
      if (!late || !((c.balance || 0) > 0)) return;
      late.sort(function (a, b) { return a.due - b.due; });
      var sum = round2(late.reduce(function (n, x) { return n + x.remaining; }, 0));
      accounts.push({
        customerId: c.id, code: c.code, name: c.name,
        balance: round2(c.balance), overdueAmount: Math.min(sum, round2(c.balance)),
        dueDate: localISODate(late[0].due), daysOverdue: Math.round((today - late[0].due) / 86400000),
        overdueCredits: late.length
      });
    });
    accounts.sort(function (a, b) { return b.daysOverdue - a.daysOverdue || b.overdueAmount - a.overdueAmount || a.name.localeCompare(b.name, "en", { sensitivity: "base" }); });
    return accounts;
  }
  function getOverdueAccounts() {
    var records = loadRecords();
    var accounts = computeOverdue(records);
    return Promise.resolve({
      isSample: isDemo(),
      hasRecords: records.customers.length > 0,
      count: accounts.length,
      total: round2(accounts.reduce(function (n, a) { return n + a.overdueAmount; }, 0)),
      accounts: accounts
    });
  }

  // ---------- Overdue Accounts: filtered, sorted, paginated list ----------
  // BACKEND CONTRACT (future: GET /api/overdue-accounts)
  //   query    { search (customer name), overdueRange: "all" | "1-7" | "8-30" | "30+" (days overdue),
  //              sortBy: "due-asc" | "due-desc" | "amount-desc" | "amount-asc", page, pageSize }
  //   response { isSample, hasRecords, items, totalCount, page, pageSize, totalPages, hasMore,
  //              summary: { count, total }          (every matching account, not just this page),
  //              chipCounts: { "all", "1-7", "8-30", "30+" }   (follow the search, ignore the range),
  //              totalAll }                        (every overdue account, before any search or filter)
  // Real accounts call the API (queryOverdueAccountsApi above). Demo (sample) data is still filtered here from computeOverdue().
  var OVERDUE_RANGES = {
    "all": function () { return true; },
    "1-7": function (a) { return a.daysOverdue >= 1 && a.daysOverdue <= 7; },
    "8-30": function (a) { return a.daysOverdue >= 8 && a.daysOverdue <= 30; },
    "30+": function (a) { return a.daysOverdue > 30; }
  };
  var OVERDUE_SORTS = {
    "amount-desc": function (a, b) { return b.overdueAmount - a.overdueAmount; },
    "amount-asc": function (a, b) { return a.overdueAmount - b.overdueAmount; },
    "due-asc": function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0; },
    "due-desc": function (a, b) { return a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0; }
  };
  // ---- Real accounts: GET /api/owner/overdue-accounts (Part 5A). The SERVER decides who is overdue (OverdueRule), searches,
  // filters, sorts and cuts the page; nothing is calculated here. The response already has the shape the page draws. ----
  function queryOverdueAccountsApi(query) {
    var Q = window.CrediTrackQuery;
    query = query || {};
    var range = Q.pick(query.overdueRange, Object.keys(OVERDUE_RANGES), "all");
    var sortBy = Q.pick(query.sortBy, Object.keys(OVERDUE_SORTS), "due-asc");
    var paging = Q.normalizePaging(query);
    var url = "/owner/overdue-accounts?overdueRange=" + encodeURIComponent(range) +   // "30+" is sent as 30%2B
      "&sortBy=" + encodeURIComponent(sortBy) +
      "&page=" + paging.page + "&pageSize=" + paging.pageSize;
    var search = String(query.search == null ? "" : query.search).trim();
    if (search) url += "&search=" + encodeURIComponent(search);
    return window.CrediTrackHttp(url).then(function (d) {
      d = d || {};
      d.isSample = false;
      d.items = d.items || [];
      d.chipCounts = Object.assign({ "all": 0, "1-7": 0, "8-30": 0, "30+": 0 }, d.chipCounts || {});
      d.summary = d.summary || { count: d.totalCount || 0, total: 0 };
      d.totalAll = d.totalAll || 0;
      return d;
    });
  }
  function queryOverdueAccounts(query) {
    if (!isDemo()) return queryOverdueAccountsApi(query);
    var Q = window.CrediTrackQuery;
    query = query || {};
    var range = Q.pick(query.overdueRange, Object.keys(OVERDUE_RANGES), "all");
    var sortBy = Q.pick(query.sortBy, Object.keys(OVERDUE_SORTS), "due-asc");
    var search = Q.text(query.search);
    return getOverdueAccounts().then(function (data) {
      var named = data.accounts.filter(function (a) { return !search || a.name.toLowerCase().indexOf(search) !== -1; });
      var chipCounts = {};
      Object.keys(OVERDUE_RANGES).forEach(function (k) { chipCounts[k] = named.filter(OVERDUE_RANGES[k]).length; });
      var matches = named.filter(OVERDUE_RANGES[range]).sort(function (a, b) {
        return OVERDUE_SORTS[sortBy](a, b) || b.overdueAmount - a.overdueAmount || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
      });
      return Object.assign({
        isSample: data.isSample, hasRecords: data.hasRecords, totalAll: data.count, chipCounts: chipCounts,
        summary: { count: matches.length, total: round2(matches.reduce(function (n, a) { return n + a.overdueAmount; }, 0)) }
      }, Q.paginate(matches, query));
    });
  }

  // ---------- Reports: overview ----------
  // Everything on the Reports overview is calculated here from the same records the Customers, Transactions and
  // Dashboard pages use, so the numbers always agree with them. Nothing is hard-coded per filter.
  // getReportsOverview(spec) takes the reporting period:
  //   { key: "week" | "month" | "last-month" | "year" }       (default "month")
  //   { key: "custom", start: "YYYY-MM-DD", end: "YYYY-MM-DD" }   (both days included; rejects when the dates are not valid)
  // Weeks run Monday to Sunday. The calculation rules:
  //   Total Utang         = credit transactions dated inside the period
  //   Total Bayad         = CONFIRMED payments inside the period. A payment only becomes a "payment" transaction
  //                         once it has been recorded or confirmed, so pending and rejected payment requests
  //                         (records.paymentRequests) are never counted.
  //   Outstanding Balance = sum of every customer's CURRENT unpaid balance (not limited to the period; same figure as the Dashboard)
  //   Overdue Balance     = what is still unpaid on the OVERDUE credits only (computeOverdue; as of today, not limited to the period).
  //                         Not-yet-due, no-due-date and fully paid credits add nothing. Real accounts: OverdueRule.Totals on the server.
  //   months (chart)      = every calendar month the period touches, up to this month (at most 12, the latest ones),
  //                         each counting only the transactions that fall inside the period
  //   recent              = the 5 newest transactions inside the period
  //   table               = EVERY transaction inside the period, newest first (the Detailed Transaction Table), as
  //                         { id, code, date, customer, type: "credit" | "payment", amount }
  //   Only recorded credits and confirmed payments are ever reported (see isReportable): a payment request that is
  //   still pending, or was rejected, is not a transaction, so it is not in the cards, the chart, Recent or the table.
  var PERIOD_LABELS = { week: "This Week", month: "This Month", "last-month": "Last Month", year: "This Year", custom: "Custom Range" };
  var MAX_CHART_MONTHS = 12;
  // Pending, rejected (declined, cancelled) payment requests are not transactions. They are kept in records.paymentRequests, so
  // they never reach records.transactions today; this guard keeps it that way if a status is ever stored on a transaction.
  var NOT_REPORTED = ["pending", "rejected", "declined", "cancelled"];
  function isReportable(t) {
    return (t.type === "credit" || t.type === "payment") && !t.voided && NOT_REPORTED.indexOf(String(t.status || "").toLowerCase()) === -1;   // voided: kept as a record, but not part of any total
  }
  function sumOf(list) { return round2(list.reduce(function (sum, t) { return sum + t.amount; }, 0)); }
  function parseDay(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return !isNaN(d.getTime()) && localISODate(d) === text ? d : null;
  }
  // Returns { key, label, start (Date), end (Date, exclusive) } or { error: "message" }
  function resolvePeriod(spec, now) {
    var key = spec && spec.key ? spec.key : "month", y = now.getFullYear(), mo = now.getMonth(), d = now.getDate(), start, end;
    if (key === "week") { var back = (now.getDay() + 6) % 7; start = new Date(y, mo, d - back); end = new Date(y, mo, d - back + 7); }
    else if (key === "month") { start = new Date(y, mo, 1); end = new Date(y, mo + 1, 1); }
    else if (key === "last-month") { start = new Date(y, mo - 1, 1); end = new Date(y, mo, 1); }
    else if (key === "year") { start = new Date(y, 0, 1); end = new Date(y + 1, 0, 1); }
    else if (key === "custom") {
      var from = parseDay(spec.start), to = parseDay(spec.end);
      if (!from || !to) return { error: "Choose both a start date and an end date." };
      if (to < from) return { error: "The end date cannot be earlier than the start date." };
      start = from; end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
    } else return { error: "Unknown reporting period." };
    return { key: key, label: PERIOD_LABELS[key], start: start, end: end };
  }
  // Real accounts read the report from GET /api/owner/reports (see getReportsOverview below); this is the sample-data (demo) version.
  function getLocalReportsOverview(spec) {
    var now = new Date();
    var period = resolvePeriod(spec || { key: "month" }, now);
    if (period.error) return Promise.reject(new Error(period.error));

    var records = loadRecords();
    var notReported = {};
    records.transactions.forEach(function (t) { if (!isReportable(t)) notReported[t.id] = true; });
    var transactions = decorateTransactions(records).filter(function (t) { return !notReported[t.id]; });   // newest first, with customer names
    function between(t, from, to) { var d = new Date(t.date); return d >= from && d < to; }
    function ofType(list, type) { return list.filter(function (t) { return t.type === type; }); }

    var inPeriod = transactions.filter(function (t) { return between(t, period.start, period.end); });
    var credits = ofType(inPeriod, "credit"), payments = ofType(inPeriod, "payment");

    var owing = records.customers.filter(function (c) { return (c.balance || 0) > 0; });
    var overdueAccounts = computeOverdue(records);   // same figures as the Overdue Accounts page
    function balances(list) { return round2(list.reduce(function (sum, c) { return sum + c.balance; }, 0)); }

    // Chart: one group per calendar month the period touches (never later than this month)
    var months = [], lastDay = new Date(Math.min(period.end.getTime() - 1, now.getTime()));
    var cursor = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
    var lastMonth = new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);
    while (cursor <= lastMonth) {
      var from = new Date(Math.max(cursor.getTime(), period.start.getTime()));
      var next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      var to = new Date(Math.min(next.getTime(), period.end.getTime()));
      var rows = transactions.filter(function (t) { return between(t, from, to); });
      months.push({
        key: cursor.getFullYear() + "-" + pad2(cursor.getMonth() + 1),
        year: cursor.getFullYear(), month: cursor.getMonth() + 1,
        label: cursor.toLocaleDateString("en-PH", { month: "short" }),
        title: cursor.toLocaleDateString("en-PH", { month: "long", year: "numeric" }),
        utang: sumOf(ofType(rows, "credit")),
        bayad: sumOf(ofType(rows, "payment")),
        current: cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()
      });
      cursor = next;
    }
    var truncated = months.length > MAX_CHART_MONTHS;
    if (truncated) months = months.slice(-MAX_CHART_MONTHS);

    return Promise.resolve({
      isSample: isDemo(),
      hasRecords: records.customers.length > 0 || records.transactions.length > 0,
      period: { key: period.key, label: period.label, start: period.start.toISOString(), end: new Date(period.end.getTime() - 1).toISOString() },
      utang: { total: sumOf(credits), count: credits.length },
      bayad: { total: sumOf(payments), count: payments.length },
      outstanding: { total: balances(owing), customers: owing.length },
      overdue: { total: round2(overdueAccounts.reduce(function (n, x) { return n + x.overdueAmount; }, 0)), accounts: overdueAccounts.length },
      months: months,
      monthsTruncated: truncated,
      recent: inPeriod.slice(0, 5),
      table: inPeriod.slice()
        .sort(function (a, b) { return new Date(b.date) - new Date(a.date) || b.id - a.id; })   // newest first
        .map(function (t) { return { id: t.id, code: t.code, date: t.date, customer: t.customer, type: t.type, amount: t.amount }; })
    });
  }

  // The Reports overview. Real accounts: GET /api/owner/reports (same shape as the sample version, plus
  // page, pageSize, totalCount, totalPages, hasMore for the table). Demo / sample data stays local.
  //   spec.page given  -> just that page of the table (the Reports page loads 20 at a time)
  //   spec.page absent -> every page is fetched and joined, so Export Report always gets ALL rows of the period
  function getReportsOverview(spec) {
    if (isDemo()) return getLocalReportsOverview(spec);
    spec = spec || { key: "month" };
    var key = spec.key || "month";
    var base = "/owner/reports?period=" + encodeURIComponent(key);
    if (key === "custom") base += "&startDate=" + encodeURIComponent(spec.start || "") + "&endDate=" + encodeURIComponent(spec.end || "");
    if (spec.page) return window.CrediTrackHttp(base + "&page=" + spec.page + "&pageSize=" + (spec.pageSize || 20));
    var rows = [];
    function next(page) {
      return window.CrediTrackHttp(base + "&page=" + page + "&pageSize=100").then(function (d) {
        rows = rows.concat(d.table || []);
        if (d.hasMore && page < 500) return next(page + 1);
        d.table = rows; d.hasMore = false; d.page = 1; d.pageSize = rows.length;
        return d;
      });
    }
    return next(1);
  }

  // ---------- Profile and Settings (Store Owner > Settings page) ----------
  // The profile is the owner's own details: they belong to the signed-in owner, NOT to the sample data, so
  // "Preview sample data" never changes them. The demo account (demoSession) shows a fictional profile and
  // edits to it are temporary (readDemoSettings), exactly like the other demo changes.
  // When the API exists these become GET/PUT /owner/profile, GET/PUT /owner/settings/notifications and POST /owner/password.
  var BUSINESS_TYPES = ["Sari-sari store", "Grocery / mini-mart", "Eatery / carinderia", "Hardware", "Pharmacy / drugstore", "Other"];
  var PERSONAL_FIELDS = ["fullName", "email", "contactNumber"];
  var STORE_FIELDS = ["storeName", "storePhone", "storeAddress", "businessType", "storeHours"];
  function cleanText(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }

  // Checks the profile form. Pure (nothing is saved), so the page can use it field by field while typing.
  // -> { valid, errors: { fieldName: "message" }, values: the cleaned values (phones as 09XXXXXXXXX) }
  function validateOwnerProfile(data, only) {
    data = data || {};
    var values = {
      fullName: cleanText(data.fullName),
      email: String(data.email == null ? "" : data.email).trim(),
      contactNumber: String(data.contactNumber == null ? "" : data.contactNumber).trim(),
      storeName: cleanText(data.storeName),
      storePhone: String(data.storePhone == null ? "" : data.storePhone).trim(),
      storeAddress: cleanText(data.storeAddress),
      businessType: cleanText(data.businessType),
      storeHours: cleanText(data.storeHours)
    };
    var errors = {};

    if (!values.fullName) errors.fullName = "Enter your full name.";
    else if (values.fullName.length > 60) errors.fullName = "Name is too long (60 characters at most).";
    else if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\u2019-]*$/.test(values.fullName) || values.fullName.length < 2) errors.fullName = "Enter a valid name. Use letters, spaces, and . ' - only.";

    if (!values.email) errors.email = "Enter your email address.";
    else if (values.email.length > 100) errors.email = "Email address is too long (100 characters at most).";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = "Enter a valid email address.";

    var mobile = "Use a valid mobile number, like 09XX XXX XXXX.";
    if (!values.contactNumber) errors.contactNumber = "Enter your contact number.";
    else if (!parsePhone(values.contactNumber)) errors.contactNumber = mobile;
    else values.contactNumber = parsePhone(values.contactNumber);

    if (!values.storeName) errors.storeName = "Enter your store name.";
    else if (values.storeName.length < 2) errors.storeName = "Store name is too short.";
    else if (values.storeName.length > 60) errors.storeName = "Store name is too long (60 characters at most).";

    if (!values.storePhone) errors.storePhone = "Enter your store contact number.";
    else if (!parsePhone(values.storePhone)) errors.storePhone = mobile;
    else values.storePhone = parsePhone(values.storePhone);

    if (!values.storeAddress) errors.storeAddress = "Enter your store address.";
    else if (values.storeAddress.length < 5) errors.storeAddress = "Enter the complete store address.";
    else if (values.storeAddress.length > 160) errors.storeAddress = "Address is too long (160 characters at most).";

    // Optional store details
    if (values.businessType && BUSINESS_TYPES.indexOf(values.businessType) === -1) errors.businessType = "Choose a business type from the list.";
    if (values.storeHours.length > 60) errors.storeHours = "Store hours are too long (60 characters at most).";

    // `only` limits the check (and the returned values) to some fields, so Edit Profile and Edit Store Information each validate their own part.
    if (only) {
      Object.keys(errors).forEach(function (k) { if (only.indexOf(k) === -1) delete errors[k]; });
      Object.keys(values).forEach(function (k) { if (only.indexOf(k) === -1) delete values[k]; });
    }
    return { valid: Object.keys(errors).length === 0, errors: errors, values: values };
  }

  // The profile photo: a small data URL while it is being uploaded (the page shrinks it first), or the /api/files/profiles/... address of the saved file. "" means no photo.
  function cleanPhoto(v) { return typeof v === "string" && /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+|\/api\/files\/profiles\/[0-9a-f]{32}\.(jpg|png|webp))$/.test(v) ? v : ""; }   // a new picture (data URL) or the saved one (its /api/files URL)

  // -> { fullName, email, contactNumber, storeName, storePhone, storeAddress, photo, isDemo }   (missing details come back as "")
  // Real account: the store name, details and Store Code come from the server (GET /owner/store), because the Store Code
  // is made by the API and customers look it up there. The rest of the profile is still kept in this browser for now.
  function getOwnerProfile() {
    return getOwner().then(function (o) {
      var profile = {
        fullName: o.fullName || "", email: o.email || "", contactNumber: o.contactNumber || "",
        storeName: o.storeName || "", storePhone: o.storePhone || "", storeAddress: o.storeAddress || "",
        photo: cleanPhoto(o.photo),
        businessType: o.businessType || "", storeHours: o.storeHours || "",
        storeCode: ensureStoreCode(o),
        role: "Store Owner", status: "Active",
        isDemo: demoSession()
      };
      if (demoSession() || !window.CrediTrackHttp) return profile;
      return Promise.all([
        window.CrediTrackHttp("/owner/store"),
        window.CrediTrackHttp("/auth/me").catch(function () { return null; })
      ]).then(function (r) {
        var s = r[0], me = r[1];
        profile.storeName = s.name || "";
        profile.storePhone = s.phone || "";
        profile.storeAddress = s.address || "";
        profile.businessType = s.businessType || "";
        profile.storeHours = s.storeHours || "";
        profile.storeCode = s.storeCode || "";           // never show a made-up code: only the real one
        if (me) {                                         // the account itself comes from the server too
          profile.fullName = me.fullName || profile.fullName;
          profile.email = me.email || profile.email;
          profile.contactNumber = me.contactNumber || profile.contactNumber;
          profile.photo = cleanPhoto(me.photo);          // the photo is saved on the server, so the customers' side can show it
        }
        cacheOwner(profile);
        return profile;
      }, function (err) {
        profile.storeCode = "";                          // the server could not be reached: do not show a fake code
        profile.loadError = (err && err.message) || "Could not load the store information.";
        return profile;
      });
    });
  }

  // Other parts of this file read the owner from the browser copy (receipts, exports), so keep it matching the server.
  // The photo is saved on the server; the copy here only lets the header show it quickly.
  function cacheOwner(p) {
    var o = readJson(KEY_OWNER, {}) || {};
    ["fullName", "email", "contactNumber", "storeName", "storePhone", "storeAddress", "businessType", "storeHours"].forEach(function (k) { o[k] = p[k] || ""; });
    if (p.photo !== undefined) { if (p.photo) o.photo = p.photo; else delete o.photo; }
    o.firstName = String(o.fullName || "").split(" ")[0];
    delete o.storeCode;                                   // the code is always asked from the server
    write(KEY_OWNER, JSON.stringify(o));
  }

  // The store code customers type in to find and join the store. Made once, then kept (it does not change when the
  // owner edits the store name or email). Demo owner: a fixed fictional code.
  function ensureStoreCode(o) {
    return demoSession() ? "CT-DEMO01" : "";               // a real account's code only ever comes from the server
  }

  // Body of PUT /account/profile. The photo is sent only when it was changed (undefined keeps the saved one, "" removes it).
  // currentPassword is sent only when there is one (the server asks for it when the email is changed).
  function personalBody(v, withPhoto, currentPassword) {
    var body = { fullName: v.fullName, email: v.email, contactNumber: v.contactNumber };
    if (withPhoto && v.photo !== undefined) body.photo = v.photo;
    if (currentPassword) body.currentPassword = String(currentPassword);
    return body;
  }
  // A changed email waits for its confirmation link: the saved profile keeps the old email, and says so here.
  function withPendingEmail(profile, res) {
    return res && res.emailChangePending
      ? Object.assign({}, profile, { emailChangePending: true, pendingEmail: res.pendingEmail, pendingEmailSent: !!res.pendingEmailSent })
      : profile;
  }

  // The header avatar: asks the server for the saved photo (GET /auth/me) and keeps a quick copy here. A photo that an earlier
  // version kept only in this browser is uploaded once, then. Resolves to the photo ("" = none). Demo owner: its own temporary photo.
  function refreshOwnerPhoto() {
    if (demoSession()) return getOwner().then(function (o) { return cleanPhoto(o.photo); });
    if (!window.CrediTrackHttp) return Promise.resolve("");
    return window.CrediTrackHttp("/auth/me").then(function (me) {
      var o = readJson(KEY_OWNER, {}) || {};
      var serverPhoto = cleanPhoto(me.photo), localPhoto = cleanPhoto(o.photo);
      if (serverPhoto || !localPhoto) {
        if (serverPhoto) o.photo = serverPhoto; else delete o.photo;
        write(KEY_OWNER, JSON.stringify(o));
        return serverPhoto;
      }
      window.CrediTrackHttp("/account/profile", {   // the server has none yet: upload the old browser-only photo
        method: "PUT", body: { fullName: me.fullName, email: me.email, contactNumber: me.contactNumber, photo: localPhoto }
      }).catch(function () {});
      return localPhoto;
    }, function () { return getOwner().then(function (o) { return cleanPhoto(o.photo); }); });
  }

  // Saves some profile fields. Rejects with an Error that has .errors ({ field: message }) when something is invalid.
  function saveProfileFields(data, fields, withPhoto) {
    var result = validateOwnerProfile(data, fields);
    if (!result.valid) {
      var err = new Error("Please check the highlighted fields.");
      err.errors = result.errors;
      return Promise.reject(err);
    }
    var v = result.values;
    if (withPhoto && data.photo !== undefined) v.photo = cleanPhoto(data.photo);   // undefined keeps the saved photo, "" removes it
    if (demoSession()) {                                      // temporary: gone with the demo
      var settings = readDemoSettings();
      settings.profile = Object.assign({}, settings.profile, v);
      writeDemoSettings(settings);
      return getOwnerProfile();
    }
    if (!window.CrediTrackHttp) return Promise.reject(new Error("Cannot reach the server. Is the API running?"));
    var isStore = fields === STORE_FIELDS;
    var request = isStore
      ? window.CrediTrackHttp("/owner/store", { method: "PUT", body: { name: v.storeName, phone: v.storePhone, address: v.storeAddress, businessType: v.businessType, storeHours: v.storeHours } })
      : window.CrediTrackHttp("/account/profile", { method: "PUT", body: personalBody(v, withPhoto, data.currentPassword) });
    return request.then(function (res) {
      if (withPhoto && v.photo !== undefined) {           // keep the header's quick copy in step with what the server now has
        var owner = readJson(KEY_OWNER, {}) || {};
        if (v.photo) owner.photo = v.photo; else delete owner.photo;
        write(KEY_OWNER, JSON.stringify(owner));
      }
      // The login cookie was renewed by the server; keep the saved session name in step.
      var session = window.CrediTrackSession && window.CrediTrackSession.get();
      if (v.fullName && session && !session.demo) window.CrediTrackSession.start({ role: session.role, name: v.fullName, remember: !session.temporary });
      return Promise.resolve(getOwnerProfile()).then(function (p) { return withPendingEmail(p, res); });
    }, function (err) {
      var map = { name: "storeName", phone: "storePhone", address: "storeAddress" };   // server field -> form field
      var field = isStore ? (map[err.field] || err.field) : err.field;
      if (field && err.status !== 401) { var e = new Error(err.message); e.errors = {}; e.errors[field] = err.message; throw e; }
      throw err;
    });
  }
  // Edit Profile: photo, full name, email, contact number.
  function updateOwnerProfile(data) { return saveProfileFields(data, PERSONAL_FIELDS, true); }
  // Edit Store Information: store name, store contact number, address, business type, store hours.
  function updateStoreInformation(data) { return saveProfileFields(data, STORE_FIELDS, false); }

  // ---------- Payment Accounts (Settings > Store Information > Payment Accounts) ----------
  // The GCash / Maya / Bank details and QR picture the owner shows to customers when they pay. One account per method.
  // CrediTrack only records payments, it never moves money.
  //   account: { method, configured, accountName, accountNumber, bankName, qrUrl, updatedAt }   (always the three methods, in this order)
  // Real account: GET / PUT / DELETE /owner/store/payment-accounts. The demo owner (demoSession) keeps them in its temporary
  // settings (readDemoSettings), so they are gone with the demo and never show up in a real account.
  var PAYMENT_METHODS = ["gcash", "maya", "bank"];
  var QR_MAX_LENGTH = 1500000;   // characters of the QR data URL, the same limit as the server
  function emptyPaymentAccount(method) {
    return { method: method, configured: false, accountName: "", accountNumber: "", bankName: "", qrUrl: "", updatedAt: null };
  }
  // The new QR picture: a small jpg / png / webp data URL (the page shrinks it first). Anything else is not accepted.
  function cleanQr(v) { return typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(v) ? v : ""; }

  // Checks one payment account form with the same rules as the server. Pure (nothing is saved), so the page can use it field by field.
  // -> { valid, errors: { accountName, accountNumber, bankName: "message" }, values: the cleaned values }
  function validatePaymentAccount(method, data) {
    data = data || {};
    var isBank = method === "bank";
    var values = {
      accountName: cleanText(data.accountName),
      accountNumber: String(data.accountNumber == null ? "" : data.accountNumber).trim(),
      bankName: isBank ? cleanText(data.bankName) : ""
    };
    var errors = {};
    function plain(text) { return !/[<>\u0000-\u001f\u007f-\u009f]/.test(text); }   // no < or > and no control characters

    if (!values.accountName) errors.accountName = "Enter the account name.";
    else if (values.accountName.length < 2 || values.accountName.length > 60 || !plain(values.accountName)) errors.accountName = "Enter the account name (2 to 60 characters, no < or > symbols).";

    // Digits, spaces, "-" and "+" only, with 7 to 20 digits (a GCash / Maya mobile number or a bank account number)
    var digits = values.accountNumber.replace(/\D/g, "").length;
    if (!values.accountNumber) errors.accountNumber = "Enter the account number.";
    else if (values.accountNumber.length > 30 || !/^[0-9 +\-]+$/.test(values.accountNumber) || digits < 7 || digits > 20) errors.accountNumber = "Enter the account number (7 to 20 digits; spaces and - are fine).";

    if (isBank) {
      if (!values.bankName) errors.bankName = "Enter the bank name.";
      else if (values.bankName.length < 2 || values.bankName.length > 40 || !plain(values.bankName)) errors.bankName = "Enter the bank name (2 to 40 characters, no < or > symbols).";
    }
    return { valid: Object.keys(errors).length === 0, errors: errors, values: values };
  }

  // A server error for one field ({ field, message }) becomes an Error with .errors, like the profile forms.
  function paymentAccountError(err) {
    if (err && err.field && err.status !== 401) { var e = new Error(err.message); e.errors = {}; e.errors[err.field] = err.message; throw e; }
    throw err;
  }
  function checkPaymentMethod(method) {
    return PAYMENT_METHODS.indexOf(method) === -1 ? new Error("Unknown payment method.") : null;
  }

  // -> [gcash, maya, bank] accounts (configured = false when not set up yet)
  function getPaymentAccounts() {
    function inOrder(list) {
      return PAYMENT_METHODS.map(function (m) {
        var found = (list || []).filter(function (a) { return a && a.method === m; })[0];
        return Object.assign(emptyPaymentAccount(m), found || {});
      });
    }
    if (demoSession()) return Promise.resolve(inOrder(PAYMENT_METHODS.map(function (m) { return (readDemoSettings().paymentAccounts || {})[m]; })));
    if (!window.CrediTrackHttp) return Promise.reject(new Error("Cannot reach the server. Is the API running?"));
    return window.CrediTrackHttp("/owner/store/payment-accounts").then(function (r) { return inOrder(r && r.accounts); });
  }

  // Creates the account or replaces its details. data: { accountName, accountNumber, bankName, qr, removeQr }
  //   qr: a new picture (data URL). Leave it out to keep the saved QR. removeQr: true deletes the saved QR.
  // Rejects with an Error that has .errors ({ accountName | accountNumber | bankName | qr: message }) when something is invalid.
  function savePaymentAccount(method, data) {
    method = String(method || "").toLowerCase();
    var unknown = checkPaymentMethod(method);
    if (unknown) return Promise.reject(unknown);
    data = data || {};
    var result = validatePaymentAccount(method, data);
    var qr = cleanQr(data.qr);
    if (data.qr && !qr) result.errors.qr = "Choose a JPG, PNG or WebP picture of your QR code.";
    else if (qr.length > QR_MAX_LENGTH) result.errors.qr = "The QR picture is too large. Choose a smaller picture.";
    if (Object.keys(result.errors).length) {
      var err = new Error("Please check the highlighted fields.");
      err.errors = result.errors;
      return Promise.reject(err);
    }
    var v = result.values, removeQr = !qr && !!data.removeQr;
    if (demoSession()) {                                      // temporary: gone with the demo
      var settings = readDemoSettings(), saved = Object.assign({}, settings.paymentAccounts);
      var before = saved[method] || emptyPaymentAccount(method);
      saved[method] = {
        method: method, configured: true, accountName: v.accountName, accountNumber: v.accountNumber, bankName: v.bankName,
        qrUrl: qr || (removeQr ? "" : before.qrUrl || ""), updatedAt: new Date().toISOString()
      };
      settings.paymentAccounts = saved;
      writeDemoSettings(settings);
      return Promise.resolve(Object.assign({}, saved[method]));
    }
    if (!window.CrediTrackHttp) return Promise.reject(new Error("Cannot reach the server. Is the API running?"));
    var body = { accountName: v.accountName, accountNumber: v.accountNumber, bankName: v.bankName, removeQr: removeQr };
    if (qr) body.qr = qr;
    return window.CrediTrackHttp("/owner/store/payment-accounts/" + method, { method: "PUT", body: body })
      .then(function (a) { return Object.assign(emptyPaymentAccount(method), a); }, paymentAccountError);
  }

  // Removes the account and its QR picture. -> the empty account (configured = false)
  function removePaymentAccount(method) {
    method = String(method || "").toLowerCase();
    var unknown = checkPaymentMethod(method);
    if (unknown) return Promise.reject(unknown);
    if (demoSession()) {
      var settings = readDemoSettings(), saved = Object.assign({}, settings.paymentAccounts);
      delete saved[method];
      settings.paymentAccounts = saved;
      writeDemoSettings(settings);
      return Promise.resolve(emptyPaymentAccount(method));
    }
    if (!window.CrediTrackHttp) return Promise.reject(new Error("Cannot reach the server. Is the API running?"));
    return window.CrediTrackHttp("/owner/store/payment-accounts/" + method, { method: "DELETE" })
      .then(function (a) { return Object.assign(emptyPaymentAccount(method), a); });
  }

  // Notification preferences: one on/off switch per kind of notification (all on by default).
  //   payments   payment requests, and approving or rejecting them
  //   overdue    an account becomes overdue
  //   customers  a customer joins the store or links their account
  //   activity   utang or bayad recorded
  // The Notifications page does not filter by these yet; they are only stored for now.
  var NOTIFICATION_PREF_IDS = ["payments", "overdue", "customers", "activity"];
  function getNotificationPreferences() {
    function fill(stored) {
      var prefs = {};
      NOTIFICATION_PREF_IDS.forEach(function (id) { prefs[id] = !stored || stored[id] !== false; });
      return prefs;
    }
    if (demoSession()) return Promise.resolve(fill(readDemoSettings().notifications));
    return window.CrediTrackHttp("/account/notification-preferences").then(function (r) { return fill(r && r.preferences); });
  }
  function saveNotificationPreferences(prefs) {
    var clean = {};
    NOTIFICATION_PREF_IDS.forEach(function (id) { clean[id] = !prefs || prefs[id] !== false; });
    if (demoSession()) {
      var settings = readDemoSettings();
      settings.notifications = clean;
      writeDemoSettings(settings);
      return Promise.resolve(clean);
    }
    return window.CrediTrackHttp("/account/notification-preferences", { method: "PUT", body: clean }).then(function () { return clean; });
  }

  // Change password. Real account: POST /account/change-password (the server checks the current password).
  // The demo account has no password, so nothing changes there.
  // Rejects with .errors ({ field: message }) when the server points at a field (for example a wrong current password).
  function changePassword(data) {
    if (demoSession()) return Promise.resolve({ changed: false, mock: true });
    data = data || {};
    var next = String(data.newPassword || "");
    return window.CrediTrackHttp("/account/change-password", {
      method: "POST",
      body: { currentPassword: data.currentPassword, newPassword: next, confirmPassword: data.confirmPassword == null ? next : data.confirmPassword }
    }).catch(function (err) {
      if (err && err.field && err.status !== 401) { var e = new Error(err.message); e.errors = {}; e.errors[err.field] = err.message; throw e; }
      throw err;
    });
  }

  // About CrediTrack
  var APP_INFO = { name: "CrediTrack", version: "1.0.0", tagline: "Every Credit, On Track." };
  function getAppInfo() { return Promise.resolve(Object.assign({}, APP_INFO)); }


  window.CrediTrackApi = {
    registerOwner: registerOwner,
    getOwner: getOwner,
    getOwnerDashboard: getOwnerDashboard,
    isDemo: isDemo,
    setDemo: setDemo,
    isDemoLogin: demoSession,
    isDemoEmail: isDemoEmail,
    matchesRegisteredOwner: matchesRegisteredOwner,
    getRegisteredOwner: getRegisteredOwner,
    startDemoLogin: startDemoLogin,
    DEMO_EMAIL: DEMO_EMAIL,
    parsePhone: parsePhone,
    formatPhone: formatPhone,
    getCustomers: getCustomers,
    queryCustomers: queryCustomers,
    getCustomer: getCustomer,
    addCustomer: addCustomer,
    updateCustomer: updateCustomer,
    archiveCustomer: archiveCustomer,
    restoreCustomer: restoreCustomer,
    verifyLinkCode: verifyLinkCode,
    linkCustomerAccount: linkCustomerAccount,
    cancelLinkRequest: cancelLinkRequest,
    getJoinRequests: getJoinRequests,
    approveJoinRequest: approveJoinRequest,
    canAddByCode: canAddByCode,
    verifyCustomerCode: verifyCustomerCode,
    getJoinSettings: getJoinSettings,
    setAutoApproveJoins: setAutoApproveJoins,
    declineJoinRequest: declineJoinRequest,
    getLinkingInfo: getLinkingInfo,
    normalizeLinkCode: normalizeLinkCode,
    getTransactions: getTransactions,
    queryTransactions: queryTransactions,
    getTransaction: getTransaction,
    addCredit: addCredit,
    addPayment: addPayment,
    getEditableTransaction: getEditableTransaction,
    updateTransaction: updateTransaction, getVoidPreview: getVoidPreview, voidTransaction: voidTransaction, voidReasons: VOID_REASONS,
    getReportsOverview: getReportsOverview,
    paymentStatuses: PAYMENT_STATUS,
    getOverdueAccounts: getOverdueAccounts,
    queryOverdueAccounts: queryOverdueAccounts,
    getPaymentRequests: getPaymentRequests,
    queryPaymentRequests: queryPaymentRequests,
    getPaymentRequest: getPaymentRequest,
    approvePaymentRequest: approvePaymentRequest,
    rejectPaymentRequest: rejectPaymentRequest,
    archivePaymentRequest: archivePaymentRequest,
    restorePaymentRequest: restorePaymentRequest,
    REASON_MIN: REASON_MIN, REASON_MAX: REASON_MAX,
    getNotifications: getNotifications,
    getUnreadNotificationCount: getUnreadNotificationCount,
    markNotificationRead: markNotificationRead,
    markAllNotificationsRead: markAllNotificationsRead,
    validateOwnerProfile: validateOwnerProfile,
    getOwnerProfile: getOwnerProfile,
    refreshOwnerPhoto: refreshOwnerPhoto,
    updateOwnerProfile: updateOwnerProfile,
    updateStoreInformation: updateStoreInformation,
    PAYMENT_METHODS: PAYMENT_METHODS,
    validatePaymentAccount: validatePaymentAccount,
    getPaymentAccounts: getPaymentAccounts,
    savePaymentAccount: savePaymentAccount,
    removePaymentAccount: removePaymentAccount,
    BUSINESS_TYPES: BUSINESS_TYPES,
    getNotificationPreferences: getNotificationPreferences,
    saveNotificationPreferences: saveNotificationPreferences,
    changePassword: changePassword,
    getAppInfo: getAppInfo
  };
})();
