/* Settings. Phone is the big one, and works like GoHighLevel's: buy numbers by area code, send in
 * the texting registration, keep a wallet that calls and texts draw from, and set voicemail,
 * forwarding and recording, all without leaving the desk. Also email, team, contact rules,
 * statuses, templates, the application form, brand, import, account and the change log. */
(function () {
  'use strict';
  var BD = window.BD, S = BD.S, esc = BD.esc, ICON = BD.ICON;
  var TABS = [['phone', 'Phone'], ['email', 'Email'], ['team', 'Team'], ['rules', 'Contact rules'], ['statuses', 'Lead statuses'], ['templates', 'Templates'], ['form', 'Application form'], ['brand', 'Brand'], ['import', 'Import'], ['account', 'Your account'], ['feedback', 'Feedback'], ['log', 'Change log']];
  var ST = { tab: 'phone', ph: null, search: null, imp: null };
  BD.views.settings = {
    render: function (arg, q) {
      ST.tab = (arg || 'phone').split('/')[0];
      var t = ST.tab, body = { phone: phoneTab, email: emailTab, team: teamTab, rules: rulesTab, statuses: statusesTab, templates: templatesTab, form: formTab, brand: brandTab, import: importTab, account: accountTab, feedback: feedbackTab, log: logTab }[t] || phoneTab;
      return Promise.resolve(body(q)).then(function (html) { return shell(html); });
    }
  };
  function shell(html) {
    var mgr = BD.isMgr();
    return '<div class="page page-settings"><div class="page-head"><div><h1>Settings</h1></div></div><div class="set-wrap"><nav class="set-nav">' +
      TABS.filter(function (t) { return mgr || ['phone', 'email', 'templates', 'account', 'import'].indexOf(t[0]) >= 0; }).map(function (t) { return '<a href="#/settings/' + t[0] + '" class="' + (ST.tab === t[0] ? 'on' : '') + '">' + esc(t[1]) + '</a>'; }).join('') +
      '</nav><div class="set-body">' + html + '</div></div></div>';
  }
  function sec(title, lead, inner, id) { return '<section class="panel set-panel"' + (id ? ' data-spec-id="' + id + '"' : '') + '><div class="sp-h"><h2>' + esc(title) + '</h2>' + (lead ? '<p>' + lead + '</p>' : '') + '</div><div class="sp-b">' + inner + '</div></section>'; }
  function redraw() { BD.render({ soft: true, keepScroll: true }); }
  function saveKey(key, data, msg) { return BD.api('/api/settings', { body: { key: key, data: data } }).then(function () { BD.state.me.settings[key] = data; if (msg) BD.toast(msg); }, BD.fail); }

  // ---------- phone ----------
  function phoneTab() {
    return BD.api('/api/phone/account').then(function (a) {
      ST.ph = a;
      var mgr = BD.isMgr(), me = BD.state.me, sim = a.provider === 'sim';
      var intro = '<div class="carrier ' + (sim ? 'sim' : 'live') + '"><div>' + ICON.phone + '</div><div><b>' + (sim ? 'Demo line' : 'Twilio, through your desk') + '</b><span>' +
        (sim ? 'Everything here works the same as the real line, but calls and texts are acted out and nothing is dialed. It switches to Twilio as soon as the platform keys are set, and your numbers, wallet and settings carry over.' : 'Your brokerage has its own Twilio account inside the desk. You never need to log in to Twilio.') + '</span></div></div>';
      var nums = a.numbers.map(function (n) {
        return '<div class="row numrow2"><span class="main"><b>' + esc(BD.fmtPhone(n.e164)) + '</b> <span class="muted">' + esc(n.label || '') + '</span><div class="sub">' + BD.cents(n.monthlyCents) + ' a month, since ' + BD.fmtDay(n.createdAt) + '</div></span>' +
          '<span>' + (mgr ? '<select data-change="num-member" data-v="' + esc(n.id) + '" aria-label="Who uses it">' + me.team.filter(function (p) { return p.active; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === n.member ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' : esc(BD.pname(n.member))) + '</span>' +
          (mgr ? '<button class="link danger" data-act="num-release" data-v="' + esc(n.id) + '" data-n="' + esc(n.e164) + '">Release</button>' : '<span></span>') + '</div>';
      }).join('');
      var buy = mgr ? '<div class="buybox"><label class="field inline-field"><span>Area code</span><input id="ac" inputmode="numeric" maxlength="3" placeholder="416" value="' + esc(ST.ac || '416') + '"></label><button class="btn" data-act="num-search">' + ICON.search + 'Find numbers</button><span class="muted small">' + BD.cents(Math.round(a.prices.number * 100)) + ' a month each. Local numbers get picked up more often.</span></div>' +
        (ST.search ? '<div class="numpick">' + (ST.search.length ? ST.search.map(function (n) { return '<button class="numopt" data-act="num-buy" data-v="' + esc(n.e164) + '"><b>' + esc(BD.fmtPhone(n.e164)) + '</b><span>' + esc([n.locality, n.region].filter(Boolean).join(', ')) + '</span><span class="link">Buy</span></button>'; }).join('') : '<p class="muted">No numbers left in that area code. Try another.</p>') + '</div>' : '') : '';
      var ar = a.autoRecharge || {}, used = a.usage.reduce(function (t, u) { return t + u.cents; }, 0);
      var wallet = '<div class="wallet"><div class="bal"><span>Balance</span><b class="money">' + BD.cents(a.balanceCents) + '</b><span class="muted small">' + BD.cents(used) + ' used this month</span></div>' +
        (mgr ? '<div class="topup"><span>Add funds</span><div class="btn-row">' + [2500, 5000, 10000].map(function (c) { return '<button class="btn sm" data-act="wallet-top" data-v="' + c + '">' + BD.cents(c) + '</button>'; }).join('') + '</div>' + (sim ? '<span class="muted small">Demo credit. On the real line this charges the card on file.</span>' : '') + '</div>' +
        '<div class="auto"><label class="checkline"><input type="checkbox" data-change="wallet-auto"' + (ar.on ? ' checked' : '') + '> Top up automatically</label><span class="muted small">Adds ' + BD.cents(ar.amount || 2500) + ' when the balance drops under ' + BD.cents(ar.below || 500) + ', so calls never stop mid-day.</span>' +
        '<label class="field inline-field"><span>Monthly spending cap</span><input type="number" min="10" step="10" placeholder="No cap" value="' + (a.spendCapCents ? a.spendCapCents / 100 : '') + '" data-change="wallet-cap"></label></div>' : '') + '</div>' +
        '<div class="usage">' + (a.usage.length ? a.usage.map(function (u) { return '<div><span>' + esc({ call: 'Calls', sms: 'Texts', number: 'Numbers', amd: 'Voicemail detection', recording: 'Recordings' }[u.kind] || u.kind) + '</span><b>' + BD.cents(u.cents) + '</b><span class="muted small">' + BD.num(u.n) + '</span></div>'; }).join('') : '<span class="muted">No usage yet this month.</span>') + '</div>' +
        '<details class="rates"><summary>Rates (CAD)</summary><div class="rgrid">' + [['Local number', a.prices.number, 'a month'], ['Outgoing call', a.prices.callOutMin, 'a minute'], ['Incoming call', a.prices.callInMin, 'a minute'], ['Text', a.prices.sms, 'each'], ['Picture text', a.prices.mms, 'each'], ['Voicemail detection', a.prices.amd, 'a call'], ['Recording', a.prices.recordingMin, 'a minute']].map(function (r) { return '<span>' + r[0] + '</span><b>$' + r[1].toFixed(r[1] < 1 ? 3 : 2) + '</b><span class="muted">' + r[2] + '</span>'; }).join('') + '</div></details>' +
        '<details class="rates"><summary>Recent charges</summary><div class="ledger">' + a.ledger.map(function (l) { return '<div><span>' + esc(BD.when(l.at)) + '</span><span class="trunc">' + esc(l.note || l.kind) + '</span><b class="' + (l.cents > 0 ? 'good' : '') + '">' + BD.cents(l.cents) + '</b></div>'; }).join('') + '</div></details>';
      var reg = a.registration || {}, rs = reg.status || 'draft';
      var regHtml = rs === 'approved' ? '<div class="match-box good"><b>Texting is on.</b><span>' + esc(reg.legalName || '') + ' is registered with the carriers.</span></div>' +
          '<details class="rates"><summary>What was sent in</summary><div class="rgrid wide">' + [['Legal name', reg.legalName], ['Business number', reg.businessNumber], ['Address', reg.address], ['Website', reg.website], ['What the texts are for', reg.useCase || 'Updates to business owners about their funding application'], ['How people opt in', reg.optIn || 'Application form checkbox, or yes on a call']].map(function (x) { return '<span>' + esc(x[0]) + '</span><b>' + esc(x[1] || '') + '</b>'; }).join('') + '</div></details>'
        : rs === 'review' ? '<div class="match-box"><b>With the carriers for review.</b><span>Sent in ' + esc(BD.when(reg.submittedAt).toLowerCase()) + '. It usually takes 1 to 3 weeks' + (sim ? ' (the demo line approves it in a minute)' : '') + '. Calls work in the meantime.</span></div>'
        : regForm(reg, mgr);
      var me2 = me.mine, comp = me.settings.compliance, phs = me.settings.phone;
      var calls = '<div class="grid2"><label class="field"><span>Ring my cell too (forwarding)</span><input id="fwd" inputmode="tel" placeholder="(416) 555-0199" value="' + esc(me2.forwardTo ? BD.fmtPhone(me2.forwardTo) : '') + '"></label><div class="field"><span>&nbsp;</span><button class="btn" data-act="fwd-save">Save</button></div></div>' +
        (mgr ? '<label class="field"><span>Voicemail greeting (read out when nobody answers)</span><textarea id="greet" rows="2">' + esc(phs.greeting) + '</textarea></label>' +
        '<label class="checkline" style="margin-top:12px"><input type="checkbox" id="rec"' + (comp.recording ? ' checked' : '') + '> Record calls</label><label class="field" style="margin-top:6px"><span>Notice played before recorded calls</span><input id="recn" value="' + esc(comp.recordingNotice) + '"></label>' +
        '<label class="field" style="margin-top:10px"><span>Voicemail the dialer leaves (use {rep}, {company}, {business}, {number})</span><textarea id="vmd" rows="2">' + esc(comp.voicemailMessage) + '</textarea></label>' +
        '<label class="field" style="margin-top:10px"><span>Message when someone answers and every rep is busy</span><input id="abm" value="' + esc(comp.abandonMessage) + '"></label><div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="calls-save">Save call settings</button></div>' : '');
      return intro + sec('Phone numbers', 'Each rep calls and texts from their own number.', (nums ? '<div class="rows">' + nums + '</div>' : '<p class="muted">No numbers yet.</p>') + buy, 'phone-numbers') +
        sec('Wallet', 'Calls, texts and numbers come out of this balance at the rates below.', wallet, 'phone-wallet') +
        sec('Texting registration', 'Canadian carriers want to know who is texting and why before they let business texts through.', regHtml, 'phone-registration') +
        sec('Calls', 'Forwarding, voicemail, recording and the dialer.', calls);
    });
  }
  function regForm(r, mgr) {
    if (!mgr) return '<p class="muted">A manager needs to send this in.</p>';
    var f = function (k, label, ph, wide) { return '<label class="field' + (wide ? ' span2' : '') + '"><span>' + label + '</span><input name="' + k + '" value="' + esc(r[k] || '') + '" placeholder="' + esc(ph || '') + '"></label>'; };
    return '<form class="regform" data-form="reg"><div class="grid2">' + f('legalName', 'Legal business name', 'Crown Merchant Funding Inc.') + f('businessNumber', 'Business number (BN)', '123456789RC0001') + f('address', 'Business address', '100 King St W, Toronto ON', true) +
      f('website', 'Website', 'cmfunding.ca') + f('volume', 'Texts a month, roughly', '2,000') + f('contactName', 'Contact name') + f('contactEmail', 'Contact email') + f('contactPhone', 'Contact phone') +
      '<label class="field span2"><span>What the texts are for</span><input name="useCase" value="' + esc(r.useCase || 'Updates to business owners about their funding application: documents we need, status, and appointment reminders.') + '"></label>' +
      '<label class="field span2"><span>How people agree to get texts</span><input name="optIn" value="' + esc(r.optIn || 'They tick a box on our application form, or say yes on a call. Every first text says how to stop (reply STOP).') + '"></label>' +
      '<label class="field span2"><span>Sample text 1</span><input name="sample1" value="' + esc(r.sample1 || 'Hi Elena, this is Nathan at Crown Merchant Funding. Your bank statements came through, thanks. Reply STOP to opt out.') + '"></label>' +
      '<label class="field span2"><span>Sample text 2</span><input name="sample2" value="' + esc(r.sample2 || 'Hi Elena, quick reminder of our call at 2 pm today about your application. Reply STOP to opt out.') + '"></label></div>' +
      '<p class="muted small">Write the samples as updates, not offers. Carriers turn down texts that read like loan ads ("you are approved for $50k").</p><div class="btn-row"><button class="btn primary" type="submit">Send for review</button></div></form>';
  }
  document.addEventListener('submit', function (e) {
    if (e.target.getAttribute('data-form') !== 'reg') return;
    e.preventDefault();
    BD.api('/api/phone/registration', { body: { profile: BD.formData(e.target) } }).then(function (r) { BD.toast(r.status === 'approved' ? 'Texting is on' : 'Sent to the carriers'); BD.state.me.phone.registration = r.status; redraw(); }, BD.fail);
  });
  BD.on('num-search', function () {
    var ac = (document.getElementById('ac') || {}).value || '416'; ST.ac = ac;
    BD.api('/api/phone/numbers?areaCode=' + encodeURIComponent(ac)).then(function (r) { ST.search = r.numbers; redraw(); }, BD.fail);
  });
  BD.on('num-buy', function (el) {
    var n = el.getAttribute('data-v');
    BD.confirm('Buy ' + BD.fmtPhone(n) + '?', 'It costs ' + BD.cents(Math.round(ST.ph.prices.number * 100)) + ' a month from the wallet, starting today. It is yours to call and text from right away.', 'Buy number', function () {
      return BD.api('/api/phone/numbers', { body: { e164: n, member: BD.state.me.user.member } }).then(function () { ST.search = null; BD.toast('Number bought'); return BD.reloadMe(); }).then(redraw);
    });
  });
  BD.on('num-member', function (el) { BD.api('/api/phone/numbers', { method: 'PATCH', body: { id: el.getAttribute('data-v'), member: el.value } }).then(function () { BD.toast('Number given to ' + BD.pname(el.value)); BD.reloadMe(); }, BD.fail); });
  BD.on('num-release', function (el) {
    BD.confirm('Release ' + BD.fmtPhone(el.getAttribute('data-n')) + '?', 'Calls and texts to it stop reaching you, and someone else can buy it. Past calls stay on file.', 'Release', function () {
      return BD.api('/api/phone/numbers?id=' + el.getAttribute('data-v'), { method: 'DELETE' }).then(function () { BD.toast('Released'); return BD.reloadMe(); }).then(redraw);
    }, true);
  });
  BD.on('wallet-top', function (el) { BD.api('/api/phone/account', { body: { action: 'topup', cents: +el.getAttribute('data-v') } }).then(function () { BD.toast('Added ' + BD.cents(+el.getAttribute('data-v'))); redraw(); }, BD.fail); });
  BD.on('wallet-auto', function (el) { var ar = ST.ph.autoRecharge || {}; BD.api('/api/phone/account', { body: { action: 'auto', on: el.checked, below: ar.below || 500, amount: ar.amount || 2500 } }).then(function () { BD.toast(el.checked ? 'Auto top-up on' : 'Auto top-up off'); }, BD.fail); });
  BD.on('wallet-cap', function (el) { BD.api('/api/phone/account', { body: { action: 'cap', cents: el.value ? Math.round(+el.value * 100) : null } }).then(function () { BD.toast(el.value ? 'Cap set' : 'No cap'); }, BD.fail); });
  BD.on('fwd-save', function () { BD.saveMine({ forwardTo: document.getElementById('fwd').value }).then(function () { BD.toast('Saved'); }); });
  BD.on('calls-save', function () {
    var c = Object.assign({}, BD.state.me.settings.compliance, { recording: document.getElementById('rec').checked, recordingNotice: document.getElementById('recn').value, voicemailMessage: document.getElementById('vmd').value, abandonMessage: document.getElementById('abm').value });
    Promise.all([saveKey('compliance', c), saveKey('phone', Object.assign({}, BD.state.me.settings.phone, { greeting: document.getElementById('greet').value }))]).then(function () { BD.toast('Call settings saved'); });
  });

  // ---------- email ----------
  function emailTab(q) {
    return BD.api('/api/email').then(function (r) {
      var b = r.box, mgr = BD.isMgr(), comp = BD.state.me.settings.compliance, s = comp.sender || {};
      if (q && q.mail === 'ok') BD.toast('Mailbox connected');
      var box = b ? '<div class="match-box good"><b>' + esc(b.address) + '</b><span>' + (b.provider === 'sim' ? 'Demo mailbox: emails are logged, not sent.' : 'Connected through ' + esc(b.provider === 'nylas' ? 'Google or Microsoft' : b.provider)) + '. ' + BD.num(r.sentToday) + ' sent today, limit ' + BD.num(b.dailyCap) + '.</span><span class="acts"><button class="btn sm ghost" data-act="mail-off">Disconnect</button></span></div>' +
          '<div class="grid2" style="margin-top:12px"><label class="field"><span>Daily sending limit</span><input type="number" min="20" max="2000" id="cap" value="' + b.dailyCap + '"></label><div class="field"><span>&nbsp;</span><button class="btn" data-act="mail-cap">Save</button></div></div>'
        : '<p>Connect your work mailbox so emails go out from your own address and replies land on the lead.</p><div class="btn-row"><button class="btn primary" data-act="mail-on" data-v="google">Connect Gmail</button><button class="btn" data-act="mail-on" data-v="microsoft">Connect Outlook</button></div>' + (r.mode === 'sim' ? '<p class="muted small">On this demo, connecting makes a demo mailbox that logs emails instead of sending them.</p>' : '');
      return sec('Your mailbox', '', box, 'email-connect') +
        sec('Signature', 'Added to emails you write from a lead.', '<textarea id="sig" rows="3" class="w100">' + esc(BD.state.me.mine.signature || '') + '</textarea><div class="btn-row"><button class="btn" data-act="sig-save">Save signature</button></div>') +
        (mgr ? sec('Who the email is from (CASL)', 'Every bulk email and sequence email ends with these details and an unsubscribe link. Canada\'s anti-spam law requires both.',
          '<div class="grid2"><label class="field"><span>Company</span><input id="s-co" value="' + esc(s.company || BD.state.me.ws.name) + '"></label><label class="field"><span>Mailing address</span><input id="s-ad" value="' + esc(s.address) + '" placeholder="100 King St W, Suite 500, Toronto ON M5X 1A9"></label>' +
          '<label class="field"><span>Phone</span><input id="s-ph" value="' + esc(s.phone) + '"></label><label class="field"><span>Email</span><input id="s-em" value="' + esc(s.email) + '"></label></div><div class="btn-row"><button class="btn primary" data-act="sender-save">Save</button></div>') : '');
    });
  }
  BD.on('mail-on', function (el) { BD.api('/api/email', { body: { action: 'connect', provider: el.getAttribute('data-v') } }).then(function (r) { if (r.url) location.href = r.url; else { BD.toast('Mailbox connected'); BD.reloadMe().then(redraw); } }, BD.fail); });
  BD.on('mail-off', function () { BD.api('/api/email', { body: { action: 'disconnect' } }).then(function () { BD.toast('Disconnected'); BD.reloadMe().then(redraw); }, BD.fail); });
  BD.on('mail-cap', function () { BD.api('/api/email', { body: { action: 'cap', cap: +document.getElementById('cap').value } }).then(function () { BD.toast('Saved'); redraw(); }, BD.fail); });
  BD.on('sig-save', function () { BD.saveMine({ signature: document.getElementById('sig').value }).then(function () { BD.toast('Signature saved'); }); });
  BD.on('sender-save', function () { var c = Object.assign({}, BD.state.me.settings.compliance, { sender: { company: document.getElementById('s-co').value, address: document.getElementById('s-ad').value, phone: document.getElementById('s-ph').value, email: document.getElementById('s-em').value } }); saveKey('compliance', c, 'Saved'); });

  // ---------- team ----------
  function teamTab() {
    return BD.api('/api/team').then(function (r) {
      var route = BD.state.me.settings.routing, inRR = route.members && route.members.length ? route.members : r.people.filter(function (p) { return p.active; }).map(function (p) { return p.member; });
      var people = r.people.map(function (p) {
        return '<div class="row team-row' + (p.active ? '' : ' off') + '"><span class="main"><b>' + esc(p.name) + '</b> <span class="muted">' + esc(p.email) + '</span><div class="sub">' + (p.active ? (p.lastSignIn ? 'Last signed in ' + BD.when(p.lastSignIn).toLowerCase() : 'Not signed in yet') : 'Removed') + '</div></span>' +
          '<span><select data-change="team-role" data-v="' + esc(p.member) + '"' + (p.active ? '' : ' disabled') + '><option value="manager"' + (p.role === 'manager' ? ' selected' : '') + '>Manager: sees every lead</option><option value="rep"' + (p.role === 'rep' ? ' selected' : '') + '>Rep: sees their own leads</option></select></span>' +
          '<span class="acts"><label class="checkline small" data-tip="Gets new website leads in turn"><input type="checkbox" data-change="team-rr" value="' + esc(p.member) + '"' + (inRR.indexOf(p.member) >= 0 ? ' checked' : '') + (p.active ? '' : ' disabled') + '> New leads</label>' +
          (p.active ? '<button class="btn sm ghost" data-act="team-link" data-email="' + esc(p.email) + '" data-name="' + esc(p.name) + '">Reset link</button><button class="btn sm ghost danger" data-act="team-remove" data-v="' + esc(p.member) + '" data-name="' + esc(p.name) + '">Remove</button>' : '<button class="btn sm" data-act="team-link" data-email="' + esc(p.email) + '" data-name="' + esc(p.name) + '">Bring back</button>') + '</span></div>';
      }).join('');
      return sec('People', 'Website leads go to the people ticked under New leads, one after another.', '<div class="rows">' + people + '</div>', 'team') +
        sec('Add someone', 'They get a link to pick a password. It works once and lasts 7 days.', '<form data-form="invite" class="grid3"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Email</span><input name="email" type="email" required></label><label class="field"><span>Role</span><select name="role"><option value="rep">Rep</option><option value="manager">Manager</option></select></label><div class="btn-row span3"><button class="btn primary" type="submit">Make their link</button></div></form>' + (ST.link ? '<div class="match-box good" style="margin-top:12px"><b>Link for ' + esc(ST.link.name) + '</b><span class="trunc">' + esc(ST.link.url) + '</span><span class="acts"><button class="btn sm" data-act="copy-text" data-v="' + esc(ST.link.url) + '">Copy</button></span></div>' : ''));
    });
  }
  document.addEventListener('submit', function (e) {
    if (e.target.getAttribute('data-form') !== 'invite') return;
    e.preventDefault(); var d = BD.formData(e.target);
    BD.api('/api/team', { body: { action: 'invite', name: d.name, email: d.email, role: d.role } }).then(function (r) { ST.link = { name: d.name, url: r.link }; BD.reloadMe().then(redraw); }, BD.fail);
  });
  BD.on('team-link', function (el) { BD.api('/api/team', { body: { action: 'invite', name: el.getAttribute('data-name'), email: el.getAttribute('data-email') } }).then(function (r) { ST.link = { name: el.getAttribute('data-name'), url: r.link }; redraw(); }, BD.fail); });
  BD.on('team-role', function (el) { BD.api('/api/team', { body: { action: 'role', member: el.getAttribute('data-v'), role: el.value } }).then(function () { BD.toast('Role changed'); BD.reloadMe(); }, function (e) { BD.fail(e); redraw(); }); });
  BD.on('team-remove', function (el) { BD.confirm('Remove ' + el.getAttribute('data-name') + '?', 'They are signed out everywhere and cannot sign in. Their leads stay where they are until you give them to someone.', 'Remove', function () { return BD.api('/api/team', { body: { action: 'remove', member: el.getAttribute('data-v') } }).then(function () { BD.toast('Removed'); return BD.reloadMe(); }).then(redraw); }, true); });
  BD.on('team-rr', function () { var ms = Array.prototype.map.call(document.querySelectorAll('[data-change="team-rr"]:checked'), function (x) { return x.value; }); saveKey('routing', Object.assign({}, BD.state.me.settings.routing, { members: ms }), 'Lead routing saved'); });
  BD.on('copy-text', function (el) { var v = el.getAttribute('data-v'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { BD.toast('Copied'); }, function () { BD.toast(v, { long: true }); }); });

  // ---------- contact rules ----------
  function rulesTab() {
    return BD.api('/api/compliance').then(function (r) {
      var c = BD.state.me.settings.compliance, h = c.hours || S.HOURS, g = r.guard;
      var hours = '<div class="grid4"><label class="field"><span>Weekdays from</span><input type="time" id="h-wd0" value="' + h.weekday[0] + '"></label><label class="field"><span>to</span><input type="time" id="h-wd1" value="' + h.weekday[1] + '"></label>' +
        '<label class="field"><span>Weekends from</span><input type="time" id="h-we0" value="' + h.weekend[0] + '"></label><label class="field"><span>to</span><input type="time" id="h-we1" value="' + h.weekend[1] + '"></label></div><div class="btn-row"><button class="btn" data-act="hours-save">Save hours</button></div>';
      var dnc = '<form data-form="dnc"><label class="field"><span>Add numbers (one per line, or paste a list)</span><textarea name="numbers" rows="3"></textarea></label><div class="btn-row"><button class="btn" type="submit">Add to the list</button></div></form>' +
        '<div class="rows dnclist">' + (r.dnc.length ? r.dnc.map(function (d) { return '<div class="row brow"><span class="main"><b>' + esc(d.phone) + '</b> <span class="muted small">' + esc(d.reason || '') + ', ' + esc(BD.fmtDay(d.at)) + '</span></span><button class="link danger" data-act="dnc-rm" data-v="' + esc(d.phone) + '">Remove</button></div>'; }).join('') : '<p class="muted">Nobody on it yet.</p>') + '</div>';
      var unsub = r.suppress.length ? '<div class="rows dnclist">' + r.suppress.map(function (s) { return '<div class="row brow"><span class="main"><b>' + esc(s.email) + '</b> <span class="muted small">' + esc(s.reason || '') + ', ' + esc(BD.fmtDay(s.at)) + '</span></span></div>'; }).join('') + '</div>' : '<p class="muted">Nobody has unsubscribed yet.</p>';
      return sec('Calling hours', 'No calls outside these hours in the lead\'s own time zone. The dialer holds those leads until it is time. These follow the CRTC\'s telemarketing hours.', hours, 'rules-hours') +
        sec('Do-not-call list (' + BD.num(r.counts.dnc) + ')', 'The CRTC requires your own do-not-call list, even for business calls. Numbers here can\'t be called or texted from the desk.', dnc, 'rules-dnc') +
        sec('Unsubscribed from email (' + BD.num(r.counts.sup) + ')', 'People who clicked unsubscribe. CASL says to stop within 10 business days; the desk stops at once. These can\'t be undone here.', unsub) +
        sec('Dialer abandoned calls', '', '<div class="guard"><div><b>' + BD.pct(g.rate) + ' this month</b><span>' + BD.num(g.abandoned) + ' of ' + BD.num(g.placed) + ' multi-line calls. The limit is 5%. Lines are capped at ' + g.maxLines + ' right now.</span></div><div class="meter' + (g.rate / g.cap > 0.7 ? ' warn' : '') + '"><i style="width:' + Math.min(100, g.rate / g.cap * 100) + '%"></i></div></div>') +
        sec('Personal information (Quebec Law 25, PIPEDA)', '', '<p>Anyone can ask for everything you hold about them, or to be forgotten. On the lead, use More, then <b>Download everything on file</b> or <b>Erase this business</b>. Every view, export and erase is in the change log.</p>');
    });
  }
  BD.on('hours-save', function () { var v = function (id) { return document.getElementById(id).value; }; saveKey('compliance', Object.assign({}, BD.state.me.settings.compliance, { hours: { weekday: [v('h-wd0'), v('h-wd1')], weekend: [v('h-we0'), v('h-we1')] } }), 'Calling hours saved'); });
  document.addEventListener('submit', function (e) {
    if (e.target.getAttribute('data-form') !== 'dnc') return;
    e.preventDefault();
    BD.api('/api/compliance', { body: { action: 'dnc-add', numbers: BD.formData(e.target).numbers } }).then(function (r) { BD.toast(BD.plural(r.added, 'number') + ' added'); redraw(); }, BD.fail);
  });
  BD.on('dnc-rm', function (el) { BD.api('/api/compliance', { body: { action: 'dnc-remove', phone: el.getAttribute('data-v') } }).then(function () { BD.toast('Removed'); redraw(); }, BD.fail); });

  // ---------- statuses, templates ----------
  function statusesTab() {
    var list = BD.statuses();
    return sec('Lead statuses', 'Rename them, add your own, or change the order. Leads keep their status if you rename it.', '<div class="stlist">' + list.map(function (s, i) {
      return '<div class="strow"><input data-i="' + i + '" data-k="label" value="' + esc(s.label) + '"><select data-i="' + i + '" data-k="tone">' + [['', 'Grey'], ['accent', 'Blue'], ['good', 'Green'], ['warn', 'Amber'], ['bad', 'Red'], ['muted', 'Faded']].map(function (t) { return '<option value="' + t[0] + '"' + ((s.tone || '') === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>' +
        '<button class="ib sm" data-act="st-up" data-v="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="Up">' + ICON.up + '</button>' + BD.statusPill(s.id) + '</div>';
    }).join('') + '</div><div class="btn-row"><button class="btn" data-act="st-add">' + ICON.plus + 'Add a status</button><button class="btn primary" data-act="st-save">Save statuses</button></div>');
  }
  function stRead() { var list = JSON.parse(JSON.stringify(BD.statuses())); document.querySelectorAll('.strow [data-i]').forEach(function (el) { list[+el.getAttribute('data-i')][el.getAttribute('data-k')] = el.value; }); return list; }
  BD.on('st-up', function (el) { var l = stRead(), i = +el.getAttribute('data-v'); var t = l[i]; l[i] = l[i - 1]; l[i - 1] = t; BD.state.me.settings.statuses = l; redraw(); });
  BD.on('st-add', function () { var l = stRead(); l.push({ id: 's' + Date.now().toString(36), label: 'New status', tone: '' }); BD.state.me.settings.statuses = l; redraw(); });
  BD.on('st-save', function () { saveKey('statuses', stRead(), 'Statuses saved'); });
  function templatesTab() {
    var t = BD.state.me.settings.templates;
    var sms = t.sms.map(function (x, i) { return '<div class="tpl-edit"><input data-g="sms" data-i="' + i + '" data-k="name" value="' + esc(x.name) + '"><textarea rows="2" data-g="sms" data-i="' + i + '" data-k="body">' + esc(x.body) + '</textarea><button class="x" data-act="tpl-rm" data-g="sms" data-v="' + i + '" aria-label="Remove">' + ICON.x + '</button></div>'; }).join('');
    var em = t.email.map(function (x, i) { return '<div class="tpl-edit em"><input data-g="email" data-i="' + i + '" data-k="name" value="' + esc(x.name) + '"><div><input data-g="email" data-i="' + i + '" data-k="subject" value="' + esc(x.subject) + '" placeholder="Subject"><textarea rows="4" data-g="email" data-i="' + i + '" data-k="body">' + esc(x.body) + '</textarea></div><button class="x" data-act="tpl-rm" data-g="email" data-v="' + i + '" aria-label="Remove">' + ICON.x + '</button></div>'; }).join('');
    return sec('Text templates', 'Fill-ins: {first}, {business}, {rep}, {company}, {apply} (your form link), {number}.', sms + '<div class="btn-row"><button class="btn sm" data-act="tpl-add" data-g="sms">' + ICON.plus + 'Add</button></div>') +
      sec('Email templates', '', em + '<div class="btn-row"><button class="btn sm" data-act="tpl-add" data-g="email">' + ICON.plus + 'Add</button><button class="btn primary" data-act="tpl-save">Save templates</button></div>');
  }
  function tplRead() { var t = JSON.parse(JSON.stringify(BD.state.me.settings.templates)); document.querySelectorAll('[data-g][data-k]').forEach(function (el) { t[el.getAttribute('data-g')][+el.getAttribute('data-i')][el.getAttribute('data-k')] = el.value; }); return t; }
  BD.on('tpl-add', function (el) { var t = tplRead(), g = el.getAttribute('data-g'); t[g].push(g === 'sms' ? { id: 't' + Date.now().toString(36), name: 'New', body: '' } : { id: 'e' + Date.now().toString(36), name: 'New', subject: '', body: '' }); BD.state.me.settings.templates = t; redraw(); });
  BD.on('tpl-rm', function (el) { var t = tplRead(); t[el.getAttribute('data-g')].splice(+el.getAttribute('data-v'), 1); BD.state.me.settings.templates = t; redraw(); });
  BD.on('tpl-save', function () { saveKey('templates', tplRead(), 'Templates saved'); });

  // ---------- form, brand ----------
  function formTab() {
    var f = BD.state.me.settings.form, url = location.origin + '/apply/' + (BD.state.me.ws.slug || '');
    return sec('Your application form', 'Put this link on your website, in your email signature and in texts. Applications land in the inbox and go to the next rep in turn, with consent recorded.',
      '<div class="match-box"><b class="trunc">' + esc(url) + '</b><span class="acts"><button class="btn sm" data-act="copy-text" data-v="' + esc(url) + '">Copy</button><a class="btn sm" href="' + esc(url) + '" target="_blank" rel="noopener">Open it</a></span></div>', 'form-link') +
      sec('Wording', '', '<label class="field"><span>Title</span><input id="f-t" value="' + esc(f.title) + '"></label><label class="field" style="margin-top:10px"><span>Intro</span><input id="f-i" value="' + esc(f.intro) + '"></label>' +
        '<label class="field" style="margin-top:10px"><span>Consent box (CASL express consent)</span><textarea id="f-c" rows="2">' + esc(f.consentText) + '</textarea></label><label class="field" style="margin-top:10px"><span>After they send it</span><textarea id="f-th" rows="2">' + esc(f.thanks) + '</textarea></label>' +
        '<label class="checkline" style="margin-top:10px"><input type="checkbox" id="f-st"' + (f.askStatements ? ' checked' : '') + '> Let them upload bank statements with the form</label><div class="btn-row"><button class="btn primary" data-act="form-save">Save</button></div>');
  }
  BD.on('form-save', function () { var v = function (id) { return document.getElementById(id).value; }; saveKey('form', { title: v('f-t'), intro: v('f-i'), consentText: v('f-c'), thanks: v('f-th'), askStatements: document.getElementById('f-st').checked }, 'Form saved'); });
  function brandTab() {
    var w = BD.state.me.ws, b = w.brand || {};
    return sec('Brand', 'Shown in the desk and on your application form.', '<div class="grid3"><label class="field"><span>Company name</span><input id="b-n" value="' + esc(w.name) + '"></label><label class="field"><span>Short name for the header</span><input id="b-l" value="' + esc(b.logoText || '') + '"></label><label class="field"><span>Colour</span><input type="color" id="b-c" value="' + esc(b.color || '#1f3fae') + '"></label></div><div class="btn-row"><button class="btn primary" data-act="brand-save">Save</button></div>');
  }
  BD.on('brand-save', function () { BD.api('/api/settings', { body: { key: 'brand', data: { name: document.getElementById('b-n').value, logoText: document.getElementById('b-l').value, color: document.getElementById('b-c').value } } }).then(function () { BD.toast('Saved'); return BD.reloadMe(); }).then(redraw, BD.fail); });

  // ---------- import ----------
  function importTab() {
    var I = ST.imp;
    if (!I) return sec('Import leads', 'From Close (Leads, Export, CSV), SmartMCA, or any spreadsheet saved as CSV. Duplicates are matched by phone, email or business name.',
      '<label class="drop"><b>Choose a CSV file</b><span>or drop it here</span><input type="file" class="file-in" accept=".csv,text/csv" data-change="imp-file"></label>' +
      '<div class="howto"><div><b>From Close</b><span>Leads, pick the Smart View, the export button, CSV. Leads and contacts both work.</span></div><div><b>From a spreadsheet</b><span>File, Save as, CSV. The first row should have the column names.</span></div><div><b>Statuses come over</b><span>"LEADS TO CALL" becomes Leads to call. Others you can set below.</span></div></div>', 'import');
    var mapRows = BD.importer.FIELDS.map(function (f) {
      return '<label class="field"><span>' + esc(f[1]) + '</span><select data-change="imp-map" data-k="' + f[0] + '"><option value="">Not in the file</option>' + I.headers.map(function (h, i) { return '<option value="' + i + '"' + (I.map[f[0]] === i ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') + '</select></label>';
    }).join('');
    var sm = BD.importer.statusMap(I.rows, I.map), sample = I.rows.slice(0, 5).map(function (r) { return BD.importer.toLead(r, I.map, sm); });
    var mgr = BD.isMgr();
    return sec('Import ' + BD.plural(I.rows.length, 'row') + ' from ' + I.name, 'Check the columns, then import.',
      '<details class="mapping" open><summary>Columns</summary><div class="grid3">' + mapRows + '</div></details>' +
      '<div class="preview-list">' + sample.map(function (l) { return '<div class="pv"><b>' + esc(l.name || '(no name)') + '</b><div><span class="tag">' + esc(l.contactName || 'no contact') + '</span><span class="tag">' + esc(l.phone || 'no phone') + '</span><span class="tag">' + esc(l.email || 'no email') + '</span>' + (l.province ? '<span class="tag">' + l.province + '</span>' : '') + (l.status ? '<span class="tag good">' + esc(BD.status(l.status).label) + '</span>' : '') + '</div></div>'; }).join('') + '</div>' +
      '<div class="grid3" style="margin-top:14px"><label class="field"><span>Put them in the list</span><input id="i-list" value="' + esc(I.list) + '"></label>' +
      '<label class="field"><span>Status if the file has none</span><select id="i-st">' + BD.statuses().map(function (s) { return '<option value="' + s.id + '"' + (s.id === 'to-call' ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select></label>' +
      (mgr ? '<label class="field"><span>Who gets them</span><select id="i-own"><option value="me">Me</option><option value="round">Spread across the team</option><option value="">Nobody yet</option>' + BD.state.me.team.filter(function (p) { return p.active && p.id !== BD.state.me.user.member; }).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="field"><span>If a lead is already here</span><select id="i-dup"><option value="skip">Skip it</option><option value="update">Update it</option><option value="allow">Add it again</option></select></label>' +
      '<label class="field span2"><span>Email and text consent (CASL)</span><select id="i-con"><option value="none">No consent: calls and one-to-one messages only</option><option value="implied">Implied: existing business relationship or published contact</option><option value="express">Express: they opted in</option></select></label></div>' +
      (I.progress != null ? '<div class="progress"><i style="width:' + I.progress + '%"></i></div><p class="muted">' + esc(I.msg || '') + '</p>' : '<div class="btn-row"><button class="btn ghost" data-act="imp-cancel">Start over</button><button class="btn primary" data-act="imp-go">Import ' + BD.plural(I.rows.length, 'lead') + '</button></div>'));
  }
  BD.on('imp-file', function (el) {
    var f = el.files && el.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var p = BD.importer.parse(txt);
      if (!p.rows.length) return BD.toast('That file has no rows.', { bad: true });
      ST.imp = { name: f.name, headers: p.headers, rows: p.rows, map: BD.importer.guess(p.headers), list: f.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').slice(0, 60) };
      redraw();
    });
  });
  BD.on('imp-map', function (el) { ST.imp.map[el.getAttribute('data-k')] = el.value === '' ? undefined : +el.value; redraw(); });
  BD.on('imp-cancel', function () { ST.imp = null; redraw(); });
  BD.on('imp-go', function () {
    var I = ST.imp, sm = BD.importer.statusMap(I.rows, I.map), leads = I.rows.map(function (r) { return BD.importer.toLead(r, I.map, sm); });
    var opts = { list: document.getElementById('i-list').value.trim() || null, status: document.getElementById('i-st').value, dedupe: document.getElementById('i-dup').value,
      consent: { type: document.getElementById('i-con').value, source: 'Imported from ' + I.name }, source: /close/i.test(I.name) ? 'close' : 'import' };
    var own = document.getElementById('i-own'); if (own) opts.owner = own.value === 'me' ? BD.state.me.user.member : own.value === 'round' ? 'round' : own.value || null;
    var tot = { added: 0, updated: 0, skipped: 0 }, i = 0, size = 250;
    I.progress = 0; I.msg = 'Starting...'; redraw();
    var step = function () {
      if (i >= leads.length) { I.progress = 100; BD.toast('Imported ' + BD.num(tot.added) + ', updated ' + BD.num(tot.updated) + ', skipped ' + BD.num(tot.skipped), { long: true }); ST.imp = null; BD.loadListCounts(); BD.go('#/leads?f=' + encodeURIComponent(JSON.stringify(opts.list ? { list: opts.list } : {}))); return; }
      var chunk = leads.slice(i, i + size);
      BD.api('/api/leads/import', { body: Object.assign({ rows: chunk, last: i + size >= leads.length, total: leads.length }, opts) }).then(function (r) {
        tot.added += r.added; tot.updated += r.updated; tot.skipped += r.skipped; i += size;
        I.progress = Math.round(Math.min(1, i / leads.length) * 100); I.msg = BD.num(Math.min(i, leads.length)) + ' of ' + BD.num(leads.length) + ' done'; redraw(); step();
      }, function (e) { I.progress = null; BD.fail(e); redraw(); });
    };
    step();
  });

  // ---------- account, log ----------
  function accountTab() {
    var u = BD.state.me.user;
    return sec('Your account', esc(u.name) + ', ' + esc(u.email) + ', ' + (u.role === 'rep' ? 'rep' : 'manager') + '.', '<form data-form="pw" class="grid3"><label class="field"><span>Current password</span><input type="password" name="cur" autocomplete="current-password"></label><label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password"></label><div class="field"><span>&nbsp;</span><button class="btn primary" type="submit">Change password</button></div></form>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn" data-act="notify-on">Turn on desktop alerts for calls and texts</button></div>');
  }
  document.addEventListener('submit', function (e) {
    if (e.target.getAttribute('data-form') !== 'pw') return;
    e.preventDefault(); var d = BD.formData(e.target), email = BD.state.me.user.email;
    if ((d.next || '').length < 8) return BD.toast('Use at least 8 characters.', { bad: true });
    Promise.all([BD.deriveKey(email, d.cur), BD.deriveKey(email, d.next)]).then(function (k) { return BD.api('/api/auth/password', { body: { current: k[0], next: k[1] } }); }).then(function () { BD.toast('Password changed. Other devices are signed out.'); e.target.reset(); }, BD.fail);
  });
  BD.on('notify-on', function () { if (!window.Notification) return BD.toast('This browser cannot show alerts.', { bad: true }); Notification.requestPermission().then(function (p) { BD.toast(p === 'granted' ? 'Alerts on' : 'Alerts are blocked in this browser\'s settings.', { bad: p !== 'granted' }); }); });
  // ---------- feedback ----------
  function feedbackTab() {
    return BD.api('/api/feedback').then(function (r) {
      var open = r.feedback.filter(function (f) { return !f.done; }).length;
      var rows = r.feedback.length ? r.feedback.map(function (f) {
        return '<div class="row brow fb-row' + (f.done ? ' done' : '') + '"><span class="main"><b>' + esc(f.who || 'Someone') + '</b> <span class="muted small">' + esc(BD.when(f.at)) + (f.route ? ', on ' + esc(f.route) : '') + '</span>' +
          '<div class="fb-text">' + esc(f.text) + '</div></span><button class="btn sm' + (f.done ? ' ghost' : '') + '" data-act="fb-done" data-v="' + f.id + '"' + (f.done ? ' data-undo="1"' : '') + '>' + (f.done ? 'Reopen' : 'Done') + '</button></div>';
      }).join('') : '<div class="empty-line">No feedback yet. Notes sent from the Send feedback button land here.</div>';
      return sec('Feedback', open ? BD.plural(open, 'open note') + '. Newest first, with the screen each one came from.' : 'Notes people send from inside the desk, newest first.', '<div class="rows">' + rows + '</div>', 'feedback');
    });
  }
  BD.on('fb-done', function (el) {
    BD.api('/api/feedback', { body: { action: 'done', id: +el.getAttribute('data-v'), undo: !!el.getAttribute('data-undo') } }).then(redraw, BD.fail);
  });

  function logTab() {
    return BD.api('/api/audit').then(function (r) {
      return sec('Change log', 'Who did what, newest first.', '<div class="rows log-list">' + r.rows.map(function (x) { return '<div class="row brow"><span class="main"><b>' + esc(x.who || 'System') + '</b> ' + esc(x.action) + ' ' + esc(x.kind || '') + ' <span class="muted">' + esc(x.label || '') + '</span>' + (x.changes ? '<div class="sub">' + esc(x.changes.map(function (c) { return c.f + (c.from !== undefined ? ': ' + c.from + ' to ' + c.to : c.to !== undefined ? ': ' + c.to : ''); }).join('; ')) + '</div>' : '') + '</span><span class="muted small">' + esc(BD.when(x.at)) + '</span></div>'; }).join('') + '</div>');
    });
  }
})();
