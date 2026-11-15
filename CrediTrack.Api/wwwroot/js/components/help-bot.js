/* Help assistant for Help & Support (customer and owner). No AI service and no cost: it finds the best answer
   in (1) the FAQs written on the same Help page and (2) the built-in guides below, and falls back to the
   support contact details of the page when it is not sure. Understands English and common Tagalog words.

   How it works
   - Words are normalised (lowercase, Tagalog / English synonyms such as bayad = payment, utang = credit, simple plurals).
   - Each answer has a question + keywords (strong match) and an answer text (weak match). Rare words count more (IDF).
   - The best answer is shown when enough of the question's words are covered; the next best ones are offered as buttons.
   - Nothing is sent anywhere and nothing is stored: the chat disappears when the page is closed.
   To teach it more, add an item to COMMON, OWNER or CUSTOMER below: { q: "question", k: "extra keywords", a: "answer" }. */
(function () {
  "use strict";

  var root = document.getElementById("help-bot");
  if (!root) return;
  var log = document.getElementById("hbot-log");
  var chipsBox = document.getElementById("hbot-chips");
  var form = document.getElementById("hbot-form");
  var input = document.getElementById("hbot-input");
  var role = document.body.classList.contains("customer") ? "customer" : "owner";

  /* ---------- Built-in guides ---------- */
  var COMMON = [
    { q: "I forgot my password", k: "forgot password reset login cannot log in nakalimutan",
      a: "On the Log In page tap Forgot password and enter your email. We send a reset link that works for 30 minutes. If you are already logged in, use \"Forgot your current password?\" under Change Password in Security." },
    { q: "I did not get the verification email", k: "verify verification email resend spam check account",
      a: "Open the Check Your Email page (you are taken there after registering) and use the resend option. Check your spam folder too. You must verify your email before you can log in." },
    { q: "Can I pay through CrediTrack?", k: "online pay gcash maya money bank transfer",
      a: "No. CrediTrack only keeps records: it does not hold or move money. Customers pay the store in cash or by GCash, Maya or bank transfer, then send a payment request so the store owner can confirm it." },
    { q: "The camera will not open", k: "camera kamera open scan qr permission blocked black screen",
      a: "Allow camera access when the browser asks (tap the lock icon next to the address if you blocked it). The camera only works on https:// or on localhost, not on a plain http address. Close other apps that use the camera. If it still fails, use \"Upload a QR photo\" or type the code instead." }
  ];

  var OWNER = [
    { q: "How do I set a due date for a credit?", k: "due date deadline petsa takdang utang record",
      a: "When you record utang, look below the items for Payment due date. It is optional: leave it on No due date, or press Set due date and pick a date (today or later). A credit with no due date can never become overdue." },
    { q: "What is an overdue account?", k: "overdue late lampas huli due accounts notify",
      a: "A credit is overdue when its due date has passed and something is still unpaid. You can see them on the Overdue Accounts page, where you can search by customer and filter by how many days late. Customers with a linked account are notified automatically when a credit becomes overdue." },
    { q: "How do I void a transaction?", k: "void cancel wrong mali delete burahin undo",
      a: "Open the transaction and choose Void, then pick a reason. The record is not deleted: it stays in the history marked Voided with the date, the reason and who voided it, and the balance is corrected." },
    { q: "How do I confirm or reject a customer's payment request?", k: "payment request confirm reject approve review pending customer paid",
      a: "Open Payment Requests and tap a request to review it. Confirm records the payment and lowers the customer's balance. Reject keeps the balance as it was and lets you give a reason. Reviewed requests can be archived and restored later." },
    { q: "How do I link a customer to their CrediTrack account?", k: "link customer account code qr scan record connect",
      a: "Open the customer's details and choose Link Customer Account. Enter the customer's Customer Code, scan their QR code with the camera, or upload a picture of their QR. Once linked, the customer sees their records in their own app and gets reminders." },
    { q: "How do I archive a customer?", k: "archive restore customer hide remove delete",
      a: "Use the archive option on the customer's page. Archived customers can be restored. Their credits, payments and balance stay in the history, Overdue Accounts and Reports." },
    { q: "How do I see my reports and export them?", k: "reports export pdf csv week month year summary download",
      a: "Open Reports and choose a period: this week, this month, last month, this year or a custom range. You can export the detailed transactions as PDF or CSV." }
  ];

  var CUSTOMER = [
    { q: "Where do I see how much I owe?", k: "balance total owe utang magkano home outstanding",
      a: "Home shows your Total Outstanding Balance across your stores, with each store's own balance and status below it. Tap a store to see its details." },
    { q: "How do I join a store?", k: "join store code qr scan sumali connect",
      a: "Tap Join a Store on Home. Type the Store Code or scan the store's QR (you can also upload a picture of it), check the store details and confirm. Ask the store owner for the code if you don't have it." },
    { q: "How do I send a payment request?", k: "pay payment request bayad send submit gcash maya proof",
      a: "Tap the PAY button on Home, choose the store, enter the amount, pick how you paid and add the reference number if asked. Review and submit. It stays Pending until the store owner confirms it, and only then does your balance go down." },
    { q: "What are the payment reminders on Home?", k: "reminder due overdue date today notification paalala",
      a: "Home shows a Payment reminders card at the top for credits that are overdue, due today or due within the next 7 days, with the store, what is left to pay and the due date. Tap one to open it. Credits with no due date, or already paid, never appear." },
    { q: "How do I see my transaction history?", k: "history transactions credits payments",
      a: "Open History in the bottom bar (or the side menu on a computer). Filter by All, Credits or Payments, by store, or search. Tap a transaction for its details. Voided records stay in the list with a Voided badge." },
    { q: "How do I link my existing record at a store?", k: "link record code CUS existing connect",
      a: "While joining a store, enter the record code the store gave you (like CUS-014) on the Link Existing Record step. If the store has none for you, tap I don't have a code." },
    { q: "Why is a transaction marked Voided?", k: "voided void cancelled strikethrough",
      a: "The store voided it. It stays in your history so nothing disappears, but it no longer counts toward your balance. The details show when and why it was voided." }
  ];

  var DEFAULT_CHIPS = role === "customer"
    ? ["What do I owe?", "Join a store", "Send a payment request", "Payment reminders", "Contact support"]
    : ["Record utang", "Set a due date", "Overdue accounts", "Payment requests", "Contact support"];

  /* ---------- Words ---------- */
  var STOP = {};
  ("a an the to of in on for and or is are am be do does did i my me you your we it its this that what how why when where can could " +
   "should would will if with at by from as there so not please ang ng sa na ko ako mo ba po ay mga ito yan yung iyong ano paano pano " +
   "bakit saan kailan pwede puwede maaari lang din rin nga naman kasi may meron mag nag pag ma ipa ka ni nina kay namin natin nila").split(" ")
    .forEach(function (w) { STOP[w] = true; });

  var GROUPS = {
    credit: "utang credit credits loan pautang uutang inutang hiram",
    payment: "bayad bayaran magbayad binayad pay paid payment payments pagbabayad hulog",
    balance: "balance balanse owe owed natitira remaining magkano kulang tira",
    store: "store tindahan tindera shop",
    customer: "customer kustomer suki costumer buyer mamimili",
    add: "add idagdag dagdag magdagdag create gumawa new bago",
    record: "record irecord itala magtala log enter ilagay",
    due: "due deadline takdang duedate petsa",
    overdue: "overdue late lampas atrasado delayed delay huli lapsed",
    void: "void voided cancel cancelled canceled burahin kanselahin mali wrong undo",
    reject: "reject rejected tinanggihan denied deny decline declined",
    confirm: "confirm confirmed approve approved kumpirmahin tanggapin accept",
    join: "join sumali sumama connect",
    leave: "leave umalis alis disconnect",
    code: "code kodigo",
    qr: "qr scan scanner iscan",
    password: "password pasword passcode sandi",
    forgot: "forgot forget forgotten nakalimutan nawala lost reset",
    verify: "verify verification verified beripika",
    history: "history nakaraan",
    report: "report reports ulat summary export download",
    reminder: "reminder reminders paalala notification notifications notify abiso alert",
    request: "request requests hiling hiniling",
    archive: "archive archived restore itago",
    link: "link linked ikonekta iugnay",
    camera: "camera kamera cam",
    change: "change edit update baguhin palitan palit ayusin",
    not: "not hindi di ayaw cant cannot couldnt wont dont doesnt didnt",
    down: "down bumaba bababa baba bawas nabawasan nabawas lower decrease reduce",
    open: "open bukas buksan bumukas mabuksan magbukas",
    see: "see makita makikita tingnan view show ipakita",
    get: "get got receive received natanggap nakatanggap dumating nakuha",
    more: "more sobra higit labis exceed",
    email: "email gmail"
  };
  var SYN = {};
  Object.keys(GROUPS).forEach(function (canon) {
    GROUPS[canon].split(" ").forEach(function (w) { SYN[w] = canon; });
  });
  var PREFIXES = ["mag", "nag", "pag", "ipa", "ika", "ma", "na", "i"];

  function norm(t) {
    if (!t || STOP[t]) return "";
    if (SYN[t]) return SYN[t];
    var s = t;
    if (s.length > 4 && /ing$/.test(s)) s = s.slice(0, -3);
    else if (s.length > 4 && /ed$/.test(s)) s = s.slice(0, -2);
    else if (s.length > 3 && /s$/.test(s) && !/ss$/.test(s)) s = s.slice(0, -1);
    if (SYN[s]) return SYN[s];
    for (var i = 0; i < PREFIXES.length; i++) {
      var p = PREFIXES[i];
      if (s.indexOf(p) === 0 && s.length - p.length >= 3 && SYN[s.slice(p.length)]) return SYN[s.slice(p.length)];
    }
    return STOP[s] ? "" : s;
  }
  function tokens(text) {
    var out = [];
    String(text || "").toLowerCase().replace(/[\u2019']/g, "").split(/[^a-z0-9\u00f1]+/).forEach(function (w) {
      var n = norm(w);
      if (n && out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }

  /* ---------- Knowledge base: page FAQs + built-in guides ---------- */
  var entries = [];
  var seen = {};
  function addEntry(q, a, k) {
    q = (q || "").replace(/\s+/g, " ").trim();
    a = (a || "").replace(/\s+/g, " ").trim();
    var key = tokens(q).join(" ");
    if (!q || !a || seen[key]) return;
    seen[key] = true;
    entries.push({ q: q, a: a, qlen: tokens(q).length, strong: tokens(q + " " + (k || "")), weak: tokens(a) });
  }
  // FAQs already written on this page (owner: .st-faq__item, customer: details.hs-faq)
  Array.prototype.forEach.call(document.querySelectorAll(".st-faq__item"), function (li) {
    var q = li.querySelector(".st-faq__q"), a = li.querySelector(".st-faq__a");
    if (q && a) addEntry(q.textContent, a.textContent);
  });
  Array.prototype.forEach.call(document.querySelectorAll("details.hs-faq"), function (d) {
    var q = d.querySelector(".hs-faq__q span"), a = d.querySelector(".hs-faq__a");
    if (q && a) addEntry(q.textContent, a.textContent);
  });
  (role === "customer" ? CUSTOMER : OWNER).concat(COMMON).forEach(function (e) { addEntry(e.q, e.a, e.k); });

  // Rare words count more
  var df = {};
  entries.forEach(function (e) {
    var seenHere = {};
    e.strong.concat(e.weak).forEach(function (t) { if (!seenHere[t]) { seenHere[t] = true; df[t] = (df[t] || 0) + 1; } });
  });
  function idf(t) { return Math.log(1 + entries.length / (df[t] || 0.5)); }

  function search(text) {
    var q = tokens(text);
    if (!q.length) return [];
    var max = 0;
    q.forEach(function (t) { max += idf(t) * 3; });
    var scored = entries.map(function (e) {
      var score = 0, strongHit = false;
      q.forEach(function (t) {
        if (e.strong.indexOf(t) !== -1) { score += idf(t) * 3; strongHit = true; }
        else if (e.weak.indexOf(t) !== -1) score += idf(t);
      });
      return { e: e, cover: score / max, strongHit: strongHit };
    }).filter(function (r) { return r.strongHit && r.cover > 0; });
    // best coverage first; on a tie the more specific (shorter) question wins
    scored.sort(function (a, b) { return (b.cover - a.cover) || (a.e.qlen - b.e.qlen); });
    return scored;
  }

  /* ---------- Contact details (read from the Contact Support section of this page) ---------- */
  function contactNodes() {
    var scope = document.getElementById("contact") || document;
    var mail = scope.querySelector('a[href^="mailto:"]');
    var tel = scope.querySelector('a[href^="tel:"]');
    var hours = "";
    Array.prototype.forEach.call(scope.querySelectorAll("dt"), function (dt) {
      if (/hours/i.test(dt.textContent) && dt.nextElementSibling) hours = dt.nextElementSibling.textContent.trim();
    });
    var box = document.createElement("div");
    var p = document.createElement("p");
    p.textContent = "You can reach CrediTrack support here:";
    box.appendChild(p);
    var list = document.createElement("p");
    if (mail) { list.appendChild(document.createTextNode("Email: ")); list.appendChild(link(mail.textContent, mail.getAttribute("href"))); list.appendChild(document.createElement("br")); }
    if (tel) { list.appendChild(document.createTextNode("Phone: ")); list.appendChild(link(tel.textContent, tel.getAttribute("href"))); list.appendChild(document.createElement("br")); }
    if (hours) list.appendChild(document.createTextNode("Hours: " + hours));
    box.appendChild(list);
    if (role === "customer") {
      var tip = document.createElement("p");
      tip.textContent = "For a problem with a balance or a record, ask the store owner too: the store keeps those records. Never send your password.";
      box.appendChild(tip);
    }
    return box;
  }
  function link(text, href) {
    var a = document.createElement("a");
    a.href = href; a.textContent = text;
    return a;
  }

  /* ---------- Chat ---------- */
  function addMsg(kind, content) {
    var div = document.createElement("div");
    div.className = "hbot__msg hbot__msg--" + kind;
    if (typeof content === "string") {
      content.split("\n").forEach(function (line) {
        var p = document.createElement("p");
        p.textContent = line;
        div.appendChild(p);
      });
    } else div.appendChild(content);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
  function setChips(labels) {
    chipsBox.textContent = "";
    labels.forEach(function (label) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "hbot__chip"; b.textContent = label;
      b.addEventListener("click", function () { ask(label); });
      chipsBox.appendChild(b);
    });
  }

  function reply(text) {
    var t = text.toLowerCase();
    if (/^\s*(hi|hello|hey|hoy|uy|kumusta|musta|good (morning|afternoon|evening)|magandang)\b/.test(t) && t.split(/\s+/).length <= 4)
      return { body: "Hi! What would you like help with?", chips: DEFAULT_CHIPS };
    if (/\b(thanks|thank you|salamat|tnx|thx)\b/.test(t))
      return { body: "You're welcome! Ask me anything else about CrediTrack.", chips: DEFAULT_CHIPS };
    if (/(contact (support|us)|customer service|support (email|number|hours|team)|hotline|talk to|speak to|human|makipag-?ugnayan|^\s*support\s*$)/.test(t))
      return { body: contactNodes(), chips: DEFAULT_CHIPS };

    var results = search(text);
    var best = results[0];
    if (best && best.cover >= 0.34) {
      var related = results.slice(1, 4).filter(function (r) { return r.cover >= 0.2; }).map(function (r) { return r.e.q; });
      return { body: best.e.a, title: best.e.q, chips: related.length ? related : DEFAULT_CHIPS };
    }
    if (/\b(email|phone|call|tawag|hours|oras|number)\b/.test(t))
      return { body: contactNodes(), chips: DEFAULT_CHIPS };
    var box = document.createElement("div");
    var p = document.createElement("p");
    p.textContent = "I'm not sure about that one. Try asking it another way, pick one of the questions below, or contact support.";
    box.appendChild(p);
    box.appendChild(contactNodes());
    var suggestions = results.slice(0, 3).map(function (r) { return r.e.q; });
    return { body: box, chips: suggestions.length ? suggestions : DEFAULT_CHIPS };
  }

  var busy = false;
  function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    addMsg("me", text);
    var typing = document.createElement("span");
    typing.className = "hbot__typing"; typing.setAttribute("aria-label", "Assistant is typing");
    typing.innerHTML = "<i></i><i></i><i></i>";
    var bubble = addMsg("bot", typing);
    var res = reply(text);
    setTimeout(function () {
      bubble.textContent = "";
      if (res.title && typeof res.body === "string") {
        var h = document.createElement("p");
        var s = document.createElement("strong"); s.textContent = res.title;
        h.appendChild(s); bubble.appendChild(h);
      }
      if (typeof res.body === "string") { var p = document.createElement("p"); p.textContent = res.body; bubble.appendChild(p); }
      else bubble.appendChild(res.body);
      setChips(res.chips || DEFAULT_CHIPS);
      log.scrollTop = log.scrollHeight;
      busy = false;
    }, 350);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var v = input.value;
    input.value = "";
    ask(v);
    input.focus();
  });

  addMsg("bot", role === "customer"
    ? "Hi! I'm the CrediTrack Assistant. Ask me about joining a store, your balance, payment requests or reminders."
    : "Hi! I'm the CrediTrack Assistant. Ask me about recording utang and bayad, customers, due dates, overdue accounts or payment requests.");
  setChips(DEFAULT_CHIPS);

  // Used by the tests below (node) and handy in the browser console: window.CrediTrackHelpBot.search("...")
  window.CrediTrackHelpBot = { search: function (t) { return search(t).map(function (r) { return { q: r.e.q, cover: Math.round(r.cover * 100) / 100 }; }); } };
})();
