/* CrediTrack language support: English / natural Filipino. Preference is stored on this device. */
(function () {
  'use strict';
  var KEY = 'creditrack.language';
  var translations = {
    'Manage your account and preferences.':'Pamahalaan ang iyong account at mga preference.',
    'Store Owner':'May-ari ng Tindahan','Account Active':'Aktibo ang Account','Full Name':'Buong Pangalan','Email Address':'Email Address','Contact Number':'Contact Number','Edit Profile':'I-edit ang Profile',
    'Store Management':'Pamamahala ng Tindahan','Store Information':'Impormasyon ng Tindahan','Store name, address, contact number':'Pangalan, address, at contact number ng tindahan','Store QR Code & Store Code':'QR Code at Store Code ng Tindahan','Let customers find and join your store':'Para mahanap at maidagdag ng mga customer ang iyong tindahan',
    'Name, address, contact number':'Pangalan, address, at contact number','Help customers find your store':'Tulungang mahanap ng mga customer ang iyong tindahan','Your joined stores':'Mga tindahang sinalihan mo','Password and account protection':'Password at proteksyon ng account',
    'Appearance':'Hitsura','Language':'Wika','App Language':'Wika ng App','English or Filipino':'English o Filipino','Light or dark mode':'Light o dark mode','Choose the language CrediTrack uses on this device.':'Piliin ang wikang gagamitin ng CrediTrack sa device na ito.','Choose light or dark mode':'Pumili ng light o dark mode','Choose how CrediTrack looks on this device. "Follow device" switches between light and dark with your phone or computer.':'Piliin kung paano ipapakita ang CrediTrack sa device na ito. Awtomatikong susunod ang “Follow device” sa light o dark mode ng iyong phone o computer.',
    'Account':'Account','Account Security':'Seguridad ng Account','Keep your account safe and secure':'Panatilihing ligtas at secure ang iyong account','Notifications':'Mga Notification','Manage how you receive notifications':'Pamahalaan kung paano ka makakatanggap ng mga notification',
    'Support':'Tulong','Help & Support':'Tulong at Suporta','FAQs and contact support':'Mga FAQ at paraan para makipag-ugnayan sa support','About CrediTrack':'Tungkol sa CrediTrack','App version and system information':'Bersyon ng app at impormasyon ng system','Log Out':'Mag-log Out','Log out of CrediTrack?':'Mag-log out sa CrediTrack?','You will need to sign in again to see your account.':'Kailangan mong mag-sign in muli para makita ang iyong account.','Cancel':'Kanselahin','Light':'Light','Dark':'Dark','Auto':'Awtomatiko','Not added yet':'Wala pang nailalagay',
    'Manage your details, stores and account.':'Pamahalaan ang iyong impormasyon, mga tindahan, at account.','Profile':'Profile','Customer':'Customer','Customer Code':'Customer Code','Your unique CrediTrack customer ID':'Ang natatangi mong CrediTrack customer ID','Copy Code':'Kopyahin ang Code','View My QR':'Tingnan ang Aking QR','Customer Code & QR details':'Mga detalye ng Customer Code at QR','My Account':'Aking Account','Personal Information':'Personal na Impormasyon','Name, email, phone number':'Pangalan, email, at phone number','Connected Stores':'Mga Konektadong Tindahan','Your joined stores and store accounts':'Mga tindahang sinalihan mo at ang iyong mga store account','Security & Preferences':'Seguridad at Mga Preference','Security':'Seguridad','Change password, account protection':'Palitan ang password at protektahan ang account','Manage notification preferences':'Pamahalaan ang mga preference sa notification','App version and information':'Bersyon at impormasyon ng app','My QR Code':'Aking QR Code','Close':'Isara','Your customer QR code':'Iyong customer QR code','Show this QR code to the store owner. It holds your customer code.':'Ipakita ang QR code na ito sa may-ari ng tindahan. Nakalagay dito ang iyong customer code.','Download QR':'I-download ang QR','Customer Code':'Customer Code',
    'Dashboard':'Dashboard','Settings':'Settings','Search':'Maghanap','Save Changes':'I-save ang Mga Pagbabago','Save':'I-save','Back':'Bumalik','Continue':'Magpatuloy','Submit':'Isumite','Add':'Magdagdag','Edit':'I-edit','Delete':'Tanggalin','View':'Tingnan','View Details':'Tingnan ang Detalye','Update':'I-update','Loading...':'Naglo-load...','No results found':'Walang nahanap na resulta','No data available':'Walang available na data','Try again':'Subukan Muli','Yes':'Oo','No':'Hindi','Confirm':'Kumpirmahin','Done':'Tapos na','Success':'Matagumpay','Error':'May Error','Required':'Kailangan itong sagutan','Optional':'Opsyonal',
    'Outstanding Balance':'Natitirang Utang','Remaining Balance':'Natitirang Balanse','Record Payment':'Mag-record ng Bayad','Payment History':'Kasaysayan ng Bayad','Add Customer':'Magdagdag ng Customer','Due Date':'Takdang Petsa ng Bayad','Transaction Details':'Detalye ng Transaksyon','Credit Transactions':'Mga Utang','Payments':'Mga Bayad','Customers':'Mga Customer','Reports':'Mga Ulat','Store':'Tindahan','Amount':'Halaga','Date':'Petsa','Status':'Status','Total':'Kabuuan','Name':'Pangalan','Phone Number':'Phone Number','Email':'Email','Address':'Address','Notes':'Mga Tala','Description':'Paglalarawan','Payment Method':'Paraan ng Pagbabayad','Reference Number':'Reference Number','Pending':'Nakabinbin','Approved':'Naaprubahan','Rejected':'Tinanggihan','Paid':'Bayad na','Unpaid':'Hindi pa bayad','Overdue':'Lampas na sa takdang petsa'
  };
  var reverse = {}; Object.keys(translations).forEach(function (k) { reverse[translations[k]] = k; });
  var originals = new WeakMap();
  function getLang(){ try { return localStorage.getItem(KEY) === 'fil' ? 'fil' : 'en'; } catch(e){ return 'en'; } }
  function translateText(node, lang) {
    if (!node || node.nodeType !== 3) return;
    if (!originals.has(node)) originals.set(node, node.nodeValue);
    var raw = originals.get(node);
    var original = raw.trim();
    if (!original) return;
    var english = reverse[original] || original;
    var replacement = lang === 'fil' ? (translations[english] || original) : english;
    var leading = raw.match(/^\s*/)[0], trailing = raw.match(/\s*$/)[0];
    node.nodeValue = leading + replacement + trailing;
  }
  function translateElement(el, lang) {
    if (!el || el.nodeType !== 1 || el.closest('[data-language-control]')) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(n){ translateText(n, lang); });
    ['placeholder','title','aria-label'].forEach(function(attr){
      if (!el.hasAttribute(attr)) return;
      var key = 'attr:'+attr;
      var current = el.getAttribute(attr);
      if (!el.dataset[key.replace(':','')]) el.dataset[key.replace(':','')] = current;
      var original = el.dataset[key.replace(':','')];
      el.setAttribute(attr, lang === 'fil' ? (translations[original] || original) : original);
    });
  }
  function apply(lang) {
    document.documentElement.lang = lang === 'fil' ? 'fil' : 'en';
    translateElement(document.body, lang);
    paintControl(lang);
    window.dispatchEvent(new CustomEvent('creditrack:languagechange', { detail:{ language:lang } }));
  }
  // Language row: built the same way as the Appearance row (icon tile, title, description, current-value chip, chevron,
  // then the choice opens in place), so both look and behave alike on the Store Owner and Customer settings pages.
  var OPTIONS = [{ id: 'en', code: 'EN', label: 'English' }, { id: 'fil', code: 'FIL', label: 'Filipino' }];
  function addControl() {
    if (document.querySelector('[data-language-control]')) return;
    var page = document.querySelector('[data-page="settings"]') || document.querySelector('[data-page="profile"]');
    if (!page) return;
    // Only the main Profile & Settings (owner) / Profile (customer) screen gets this row, not Store Information, About or other sub pages
    var target = page.querySelector('#appearance-title') && page.querySelector('#appearance-title').closest('.st-group');
    if (!target) target = page.querySelector('#settings-title') && page.querySelector('#settings-title').closest('.st-group');
    if (!target || !target.parentNode) return;
    var section = document.createElement('section'); section.className = 'st-group'; section.setAttribute('data-language-control', '');
    section.setAttribute('aria-labelledby', 'language-title');
    section.innerHTML =
      '<h2 class="st-heading" id="language-title">Language</h2>' +
      '<div class="panel st-appearance st-appearance--row">' +
        '<button class="st-menu__item st-appearance__toggle" type="button" id="language-toggle" data-st-toggle aria-expanded="false" aria-controls="language-panel">' +
          '<span class="st-menu__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg></span>' +
          '<span class="st-menu__text"><span class="st-menu__title">App Language</span><span class="st-menu__desc">English or Filipino</span></span>' +
          '<span class="st-chip" data-language-current aria-live="polite">English</span>' +
          '<svg class="st-menu__chev st-appearance__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        '</button>' +
        '<div class="st-appearance__panel" id="language-panel" hidden>' +
          '<p class="st-appearance__desc">Choose the language CrediTrack uses on this device.</p>' +
          '<div class="theme-picker theme-picker--2" role="radiogroup" aria-label="Language">' +
            OPTIONS.map(function (o) {
              return '<button type="button" class="theme-picker__btn" role="radio" data-language-option="' + o.id + '">' +
                '<span class="theme-picker__code" aria-hidden="true">' + o.code + '</span><span>' + o.label + '</span></button>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
    target.parentNode.insertBefore(section, target.nextSibling);

    var holder = section.querySelector('[role="radiogroup"]');
    var buttons = Array.prototype.slice.call(holder.querySelectorAll('[data-language-option]'));
    function choose(lang) {
      try { localStorage.setItem(KEY, lang); } catch (e) {}
      apply(lang);
    }
    holder.addEventListener('click', function (e) {
      var b = e.target.closest('[data-language-option]');
      if (b) choose(b.getAttribute('data-language-option') === 'fil' ? 'fil' : 'en');
    });
    // Radio group: arrow keys move the choice, like the Appearance picker
    holder.addEventListener('keydown', function (e) {
      var i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = buttons[(i + 1) % buttons.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = buttons[(i + buttons.length - 1) % buttons.length];
      if (!next) return;
      e.preventDefault(); next.focus(); next.click();
    });
  }
  function paintControl(lang) {
    document.querySelectorAll('[data-language-option]').forEach(function (b) {
      var on = b.getAttribute('data-language-option') === lang;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;   // one tab stop for the group
    });
    document.querySelectorAll('[data-language-current]').forEach(function (c) { c.textContent = lang === 'fil' ? 'Filipino' : 'English'; });
  }
  function init(){ addControl(); apply(getLang()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  var queued = false;
  new MutationObserver(function(records){
    if (queued) return; queued = true;
    requestAnimationFrame(function(){ queued = false; var lang=getLang(); records.forEach(function(r){ r.addedNodes.forEach(function(n){ if(n.nodeType===1) translateElement(n,lang); else if(n.nodeType===3) translateText(n,lang); }); }); addControl(); });
  }).observe(document.documentElement,{childList:true,subtree:true});
})();
