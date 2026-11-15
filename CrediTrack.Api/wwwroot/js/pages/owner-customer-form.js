/* Store Owner > Customers > Add Customer / Edit Customer (customer-form, customer-form?id=...).
   Fields: Full Name (required) and Contact Number (optional, Philippine mobile number).
   This is a subpage: it has no header or navigation, only the Back button and title from owner-shell.js.
   Add only: an optional "CrediTrack account" block (js/components/customer-code-field.js). The owner types the customer's Customer
   Code or scans their QR; the account is checked, the name is filled in from it, and saving sends the code with the new customer so
   the customer gets a link request (nothing is linked until they accept).
   Saving and Cancel both go back to the page the person came from (the Customers list when adding,
   Customer Details when editing). All data goes through js/api/owner-api.js. */
(function () {
  "use strict";

  var api = window.CrediTrackApi;
  var $ = function (id) { return document.getElementById(id); };

  // The Customers list remembers its search and filter under this key (see owner-customers.js).
  var VIEW_KEY = "creditrack.customers.view";

  var params = new URLSearchParams(window.location.search);
  var editId = params.get("id");
  // Opened from the Record Utang modal ("Add New Customer"): after saving, Back / Cancel / Save return to the page the
  // modal was opened on, and the modal reopens with the new customer chosen (see js/components/record-utang.js).
  var fromRecordCredit = params.get("from") === "record-credit" && editId === null;
  var ADDED_KEY = "creditrack.recordCredit.added";
  var editing = editId !== null;
  var customer = null;       // the customer being edited
  var saving = false;
  var accountCode = "";      // the checked Customer Code of the CrediTrack account to link ("" = none)
  var codeField = null;

  var form = $("cform"), nameInput = $("cf-name"), phoneInput = $("cf-phone");
  var nameError = $("cf-name-error"), phoneError = $("cf-phone-error"), saveBtn = $("cf-save");

  // Where Back goes when there is no earlier page to return to (a bookmarked link, a new tab).
  var parentUrl = editing ? "customer-details?id=" + encodeURIComponent(editId) : fromRecordCredit ? "dashboard" : "customers";
  document.body.setAttribute("data-back", parentUrl);

  function setError(input, box, message) {
    box.textContent = message;
    box.hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    return !message;
  }

  function validate(existing) {
    var name = nameInput.value.trim().replace(/\s+/g, " ");
    var okName = true, okPhone = true;
    if (!name) okName = setError(nameInput, nameError, "Enter the customer's full name.");
    else if (name.length < 2 || !/[A-Za-zÑñ]/.test(name)) okName = setError(nameInput, nameError, "Enter a valid name.");
    else if (existing.some(function (c) {
      return c.name.toLowerCase() === name.toLowerCase() && (!customer || c.id !== customer.id);
    })) okName = setError(nameInput, nameError, "A customer with this name already exists. Add a last name or nickname to tell them apart.");
    else setError(nameInput, nameError, "");

    var phone = phoneInput.value.trim();
    var phoneOwner = phone && api.parsePhone(phone) ? existing.filter(function (c) { return c.phone === api.parsePhone(phone) && (!customer || c.id !== customer.id); })[0] : null;
    if (phone && !api.parsePhone(phone)) okPhone = setError(phoneInput, phoneError, "Enter a valid mobile number, like 0917 123 4567.");
    else if (phoneOwner) okPhone = setError(phoneInput, phoneError, "This number already belongs to " + phoneOwner.name + (phoneOwner.archived ? " (archived)" : "") + ".");
    else setError(phoneInput, phoneError, "");

    if (!okName) nameInput.focus(); else if (!okPhone) phoneInput.focus();
    return okName && okPhone;
  }

  function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    api.getCustomers().then(function (data) {
      if (!validate(data.customers)) return;
      saving = true; saveBtn.disabled = true;
      var values = { name: nameInput.value, phone: phoneInput.value };
      if (accountCode) values.customerCode = accountCode;
      var request = editing ? api.updateCustomer(customer.id, values) : api.addCustomer(values);
      return request.then(function (saved) {
        if (fromRecordCredit && saved) {
          try { window.sessionStorage.setItem(ADDED_KEY, String(saved.id)); } catch (e) { /* ignore */ }
        }
        if (!editing) {
          // Show everyone again on the Customers list so the new customer is not hidden by an old search or filter.
          try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ query: "", filter: "all" })); } catch (e) { /* ignore */ }
        }
        var done = editing ? "Customer updated." : "Customer added.";
        if (saved && saved.linkRequested) done = "Customer added. A link request was sent to " + (saved.linkedAccount && saved.linkedAccount.name ? saved.linkedAccount.name : "the customer") + ".";
        window.CrediTrack.flash(done);
        window.CrediTrack.goBack(parentUrl);
      }).catch(function (err) {
        saving = false; saveBtn.disabled = false;
        var message = err && err.message ? err.message : "Something went wrong. Please try again.";
        if (err && err.field === "code" && codeField) { accountCode = ""; $("ccf-found-note").hidden = true; codeField.showError(message); }
        else if (err && err.field === "phone") { setError(phoneInput, phoneError, message); phoneInput.focus(); }
        else { setError(nameInput, nameError, message); nameInput.focus(); }
        window.CrediTrack.showToast("Please fix the highlighted field.");
      });
    });
  }

  function show(c) {
    customer = c;
    $("cform").hidden = false;
    $("missing").hidden = true;
    if (editing) {
      nameInput.value = c.name;
      phoneInput.value = c.phone ? api.formatPhone(c.phone) : "";
    }
  }

  // Page text for the mode
  if (editing) {
    document.title = "Edit Customer | CrediTrack";
    $("subbar-title").textContent = "Edit Customer";
    $("form-intro").textContent = "Update this customer's information.";
    saveBtn.textContent = "Save Changes";
    $("form-note").hidden = true;
  }

  form.addEventListener("submit", onSubmit);
  $("cf-cancel").addEventListener("click", function () { window.CrediTrack.goBack(parentUrl); });
  nameInput.addEventListener("input", function () { if (nameInput.hasAttribute("aria-invalid")) setError(nameInput, nameError, ""); });
  phoneInput.addEventListener("input", function () { if (phoneInput.hasAttribute("aria-invalid")) setError(phoneInput, phoneError, ""); });
  phoneInput.addEventListener("blur", function () {
    var ok = api.parsePhone(phoneInput.value);
    if (ok) phoneInput.value = api.formatPhone(ok);
  });


  // Add only, real accounts only (the demo has no customer accounts): the Customer Code / QR block
  if (!editing && window.CustomerCodeField && api.canAddByCode && api.canAddByCode()) {
    $("ccf").hidden = false;
    codeField = window.CustomerCodeField.init({
      root: $("ccf"),
      onFound: function (account, code) {
        accountCode = code;
        $("ccf-found-note").hidden = false;
        if (!nameInput.value.trim()) nameInput.value = account.name;   // the account's name is the default; a nickname the store uses can replace it
        if (nameInput.hasAttribute("aria-invalid")) setError(nameInput, nameError, "");
      },
      onClear: function () { accountCode = ""; $("ccf-found-note").hidden = true; }
    });
  }

  if (editing) {
    api.getCustomer(editId).then(function (data) {
      if (!data.customer) { $("missing").hidden = false; return; }
      show(data.customer);
      nameInput.focus();
    });
  } else {
    show(null);
    // From Record Credit the owner may have typed the name in the search: fill it in (they still press Save).
    var prefill = fromRecordCredit ? (params.get("name") || "").trim().slice(0, 60) : "";
    if (prefill) nameInput.value = prefill;
    nameInput.focus();
  }
})();
