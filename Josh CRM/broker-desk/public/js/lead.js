/* The lead page: everything about one business on one screen. Details, people and consent on the
 * left; a composer (note, text, email, logged call) and the full history in the middle; tasks, the
 * deal, sequences and files on the right. */
(function () {
  'use strict';
  var BD = window.BD, S = BD.S, esc = BD.esc, ICON = BD.ICON;
  var LD = { id: null, d: null, tab: 'note', draft: {} };
  BD.leadPage = LD;

  function load(id) { return BD.api('/api/leads/' + encodeURIComponent(id)).then(function (r) { LD.id = id; LD.d = r; return r; }); }
  BD.views.lead = {
    render: function (id, q, o) {
      if (o.soft && LD.id === id && LD.d) return page();
      if (LD.id !== id) { LD.tab = q.tab || 'note'; LD.draft = {}; }
      return load(id).then(function () { BD.refreshInboxCount(); return page(); });
    },
    mounted: function () { var t = document.querySelector('.comp textarea'); if (t && LD.focus) { t.focus(); LD.focus = false; } }
  };
  BD.reloadLead = function () { if (!LD.id) return Promise.resolve(); return load(LD.id).then(function () { if (BD.route.name === 'lead' && BD.route.arg === LD.id) redraw(); }); };
  function redraw() { var keep = document.querySelector('.comp textarea'), val = keep ? keep.value : null; document.getElementById('main').innerHTML = page(); if (val != null) { var t = document.querySelector('.comp textarea'); if (t && !t.value) t.value = val; } }

  function vars(l) {
    var me = BD.state.me, c = (l.contacts || [])[0] || {};
    return { first: BD.first(c.name || l.contactName) || 'there', business: l.name, rep: BD.first(me.user.name), company: me.ws.name, apply: location.origin + '/apply/' + (me.ws.slug || ''), number: me.phone.mine ? BD.fmtPhone(me.phone.mine.e164) : '' };
  }
  // "Send application" after a call: texts the lead the form link with the Application link
  // template and marks them Application sent, so nobody has to remember to do it after hanging up.
  BD.sendApplication = function (l) {
    var tpls = BD.state.me.settings.templates.sms, t = tpls.filter(function (x) { return x.id === 't-app'; })[0] || tpls.filter(function (x) { return /\{apply\}/.test(x.body); })[0];
    var v = vars(l), body = t ? BD.fillVars(t.body, v) : 'Hi ' + v.first + ', here is the application: ' + v.apply;
    return BD.api('/api/phone/sms', { body: { leadId: l.id, body: body } }).then(function () {
      BD.toast('Application link texted to ' + (v.first === 'there' ? l.name : v.first));
      if (BD.route.name === 'lead' && LD.id === l.id) BD.reloadLead();
    }, function (e) { BD.toast('Could not text the application: ' + ((e && e.message) || 'try again from the lead'), { bad: true, long: true }); });
  };
  BD.fillVars = function (t, v) { return String(t || '').replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); };

  function page() {
    var d = LD.d, l = d.lead, mgr = BD.isMgr();
    var back = BD.route.query.from ? decodeURIComponent(BD.route.query.from) : '#/leads';
    var callable = l.phone && !l.dnc && l.status !== 'dnc';
    var head = '<div class="lp-head"><a class="backlink" href="' + esc(back) + '">' + ICON.back + 'Leads</a>' +
      '<div class="lp-top"><div class="lp-title"><h1>' + esc(l.name) + '</h1><div class="who">' +
        '<button class="pillbtn" data-act="lead-status">' + BD.statusPill(l.status) + ICON.down + '</button>' +
        (l.contactName ? '<span>' + esc(l.contactName) + '</span>' : '') + (l.city || l.province ? '<span>' + esc([l.city, l.province].filter(Boolean).join(', ')) + '</span>' : '') +
        (l.industry ? '<span>' + esc(l.industry) + '</span>' : '') +
        '<span>' + (mgr ? '<button class="link" data-act="lead-owner">' + esc(l.owner ? BD.pname(l.owner) : 'Nobody') + '</button>' : esc(BD.pname(l.owner))) + '</span>' +
        (l.dnc ? '<span class="pill bad">Do not call</span>' : '') + '</div></div>' +
      '<div class="d-actions">' + (callable ? '<button class="btn primary" data-act="lead-call" data-spec-id="call-button">' + ICON.phone + 'Call</button>' : '<button class="btn" disabled data-tip="' + esc(l.dnc ? 'On the do-not-call list' : 'No phone number') + '">' + ICON.phone + 'Call</button>') +
        '<button class="btn" data-act="comp-tab" data-v="sms">' + ICON.msg + 'Text</button><button class="btn" data-act="comp-tab" data-v="email">' + ICON.mail + 'Email</button>' +
        '<button class="btn" data-act="task-new">' + ICON.clock + 'Task</button><button class="ib" data-act="lead-more" aria-label="More">' + ICON.dots + '</button></div></div></div>';
    return '<div class="page page-lead">' + head + '<div class="lp">' + '<div class="lp-left">' + details(l) + contacts(l) + consent(l) + '</div>' +
      '<div class="lp-mid">' + composer(l) + timeline(d.activities, l) + '</div>' + '<div class="lp-right">' + tasks(d.tasks) + dealCard(d.deals, l) + seqCard(d.sequences) + filesCard(d.files) + '</div></div></div>';
  }
  function fact(k, v) { return '<div class="kv"><span>' + esc(k) + '</span><b>' + (v == null || v === '' ? '<span class="muted">–</span>' : esc(v)) + '</b></div>'; }
  function details(l) {
    return '<div class="card-s"><div class="cs-h"><h3>Business</h3><button class="link" data-act="lead-edit">Edit</button></div>' +
      fact('Monthly revenue', l.monthlyRevenue ? BD.money(l.monthlyRevenue) : '') + fact('Wants', l.requested ? BD.money(l.requested) : '') +
      fact('Trading for', l.months ? (l.months >= 24 ? Math.floor(l.months / 12) + ' years' : l.months + ' months') : '') + fact('Credit score', l.score) +
      fact('Other funders', l.positions == null ? '' : l.positions === 0 ? 'None' : l.positions) + fact('Province', l.province ? S.PROV[l.province].name : '') +
      fact('Website', l.website) + fact('Source', l.source ? BD.cap(l.source) : '') + fact('List', l.list) + fact('Added', BD.fmtDay(l.createdAt)) +
      fact('Calls', BD.num(l.calls) + (l.lastCallAt ? ', last ' + BD.when(l.lastCallAt).toLowerCase() : '')) +
      (l.notes ? '<div class="about-s">' + esc(l.notes) + '</div>' : '') + '</div>';
  }
  function contacts(l) {
    var cs = l.contacts || [];
    return '<div class="card-s"><div class="cs-h"><h3>People</h3><button class="link" data-act="lead-edit" data-v="contacts">Edit</button></div>' + (cs.length ? cs.map(function (c, i) {
      return '<div class="person"><div class="pn"><b>' + esc(c.name || 'No name') + '</b>' + (c.title ? '<span class="muted"> ' + esc(c.title) + '</span>' : '') + '</div>' +
        [c.phone, c.phone2].filter(Boolean).map(function (p) { return '<div class="pl"><span>' + esc(BD.fmtPhone(p)) + '</span><span class="acts"><button class="ib sm" data-act="lead-call" data-v="' + esc(p) + '" aria-label="Call">' + ICON.phone + '</button><button class="ib sm" data-act="comp-tab" data-v="sms" data-to="' + esc(p) + '" aria-label="Text">' + ICON.msg + '</button></span></div>'; }).join('') +
        (c.email ? '<div class="pl"><span class="trunc">' + esc(c.email) + '</span><span class="acts"><button class="ib sm" data-act="comp-tab" data-v="email" data-to="' + esc(c.email) + '" aria-label="Email">' + ICON.mail + '</button></span></div>' : '') + '</div>';
    }).join('') : '<p class="muted pad-s">No contact yet.</p>') + '</div>';
  }
  function consent(l) {
    var c = l.consent || {}, t = c.type || 'none';
    var label = t === 'express' ? 'Opted in' : t === 'implied' ? 'Implied consent' : 'No consent on file';
    return '<div class="card-s"><div class="cs-h"><h3>' + ICON.shield + ' Contact rules</h3><button class="link" data-act="consent-edit">Change</button></div>' +
      '<div class="kv"><span>Email and texts (CASL)</span><b class="' + (t === 'none' ? 'warn' : 'good') + '">' + label + '</b></div>' +
      (c.source ? '<p class="muted small">' + esc(c.source) + (c.at ? ', ' + BD.fmtDay(c.at) : '') + '</p>' : t === 'none' ? '<p class="muted small">One-to-one messages are fine. Bulk email and texts skip them until consent is on file.</p>' : '') +
      (l.smsOptOut ? '<div class="kv"><span>Texts</span><b class="bad">Replied STOP</b></div>' : '') + (l.emailOptOut ? '<div class="kv"><span>Email</span><b class="bad">Unsubscribed</b></div>' : '') +
      '<label class="checkline dnc"><input type="checkbox" data-change="lead-dnc"' + (l.dnc ? ' checked' : '') + '> Do not call this business</label></div>';
  }

  // ---------- composer ----------
  var TABS = [['note', 'Note', 'note'], ['sms', 'Text', 'msg'], ['email', 'Email', 'mail'], ['call', 'Log a call', 'phone']];
  function composer(l) {
    var me = BD.state.me, t = LD.tab, v = vars(l), body = '';
    if (t === 'note') body = '<textarea name="body" placeholder="What happened? Only your team sees notes." data-input="comp-draft">' + esc(LD.draft.note || '') + '</textarea><div class="comp-f"><span class="muted small"></span><button class="btn primary sm" data-act="comp-send">Save note</button></div>';
    if (t === 'sms') {
      var to = LD.draft.smsTo || l.phone, reg = me.phone.registration, blocked = !to ? 'No phone number on file.' : l.smsOptOut ? 'They replied STOP, so texts are off.' : l.dnc ? 'This business is on your do-not-call list.' : !me.phone.mine ? 'Get a phone number first in Settings, Phone.' : reg !== 'approved' ? (reg === 'review' ? 'Texting is waiting on carrier approval.' : 'Turn on texting in Settings, Phone.') : '';
      body = '<div class="tpls">' + me.settings.templates.sms.map(function (x) { return '<button class="chip" data-act="comp-tpl" data-v="' + esc(x.id) + '">' + esc(x.name) + '</button>'; }).join('') + '</div>' +
        '<textarea name="body" placeholder="Write a text" data-input="comp-draft"' + (blocked ? ' disabled' : '') + '>' + esc(LD.draft.sms || '') + '</textarea>' +
        '<div class="comp-f"><span class="muted small">' + (blocked ? '<span class="warn">' + esc(blocked) + '</span>' : 'To ' + esc(BD.fmtPhone(to)) + ' from ' + esc(BD.fmtPhone(me.phone.mine.e164)) + '<span class="cnt-chars" id="sms-len"></span>') + '</span>' +
        '<button class="btn primary sm" data-act="comp-send"' + (blocked ? ' disabled' : '') + '>' + ICON.msg + 'Send text</button></div>';
    }
    if (t === 'email') {
      var box = me.mail.box, eto = LD.draft.emailTo || l.email;
      body = !box ? '<div class="empty-sec"><b>Connect your mailbox to email from here.</b><span>Emails go out from your own address and replies land on the lead.</span><button class="btn primary" data-act="go" data-v="#/settings/email">Connect mailbox</button></div>' :
        '<div class="comp-row"><select data-change="comp-etpl" aria-label="Template"><option value="">Template</option>' + me.settings.templates.email.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') + '</select>' +
        '<input name="subject" placeholder="Subject" value="' + esc(LD.draft.subject || '') + '" data-input="comp-subj"></div>' +
        '<textarea name="body" class="tall" placeholder="Write an email" data-input="comp-draft"' + (!eto || l.emailOptOut ? ' disabled' : '') + '>' + esc(LD.draft.email || '') + '</textarea>' +
        '<div class="comp-f"><span class="muted small">' + (!eto ? '<span class="warn">No email address on file.</span>' : l.emailOptOut ? '<span class="warn">They unsubscribed from email.</span>' : 'To ' + esc(eto) + ' from ' + esc(box.address)) + '</span><button class="btn primary sm" data-act="comp-send"' + (!eto || l.emailOptOut ? ' disabled' : '') + '>' + ICON.mail + 'Send email</button></div>';
    }
    if (t === 'call') body = '<div class="chips">' + ['Talked', 'Left voicemail', 'No answer', 'Bad number', 'Not interested'].map(function (o) { return '<button class="chip' + (LD.draft.outcome === o ? ' on' : '') + '" data-act="comp-outcome" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>' +
      '<textarea name="body" placeholder="Notes from the call" data-input="comp-draft">' + esc(LD.draft.call || '') + '</textarea><div class="comp-f"><span class="muted small">For calls made outside the desk, like from your cell.</span><button class="btn primary sm" data-act="comp-send">Log call</button></div>';
    return '<div class="panel comp" data-spec-id="composer"><div class="tabs">' + TABS.map(function (x) { return '<button class="' + (t === x[0] ? 'on' : '') + '" data-act="comp-tab" data-v="' + x[0] + '">' + ICON[x[2]] + x[1] + '</button>'; }).join('') + '</div><div class="comp-b">' + body + '</div></div>';
  }
  BD.on('comp-tab', function (el) {
    LD.tab = el.getAttribute('data-v');
    if (el.getAttribute('data-to')) { if (LD.tab === 'sms') LD.draft.smsTo = el.getAttribute('data-to'); else LD.draft.emailTo = el.getAttribute('data-to'); }
    LD.focus = true; redraw(); var t = document.querySelector('.comp textarea'); if (t && !t.disabled) t.focus();
  });
  BD.on('comp-draft', function (el) { LD.draft[LD.tab] = el.value; if (LD.tab === 'sms') { var n = document.getElementById('sms-len'); if (n) n.textContent = el.value.length > 140 ? ', ' + el.value.length + ' characters' + (el.value.length > 160 ? ' (' + Math.ceil(el.value.length / 153) + ' texts)' : '') : ''; } });
  BD.on('comp-subj', function (el) { LD.draft.subject = el.value; });
  BD.on('comp-outcome', function (el) { LD.draft.outcome = el.getAttribute('data-v'); redraw(); });
  BD.on('comp-tpl', function (el) {
    var t = BD.state.me.settings.templates.sms.filter(function (x) { return x.id === el.getAttribute('data-v'); })[0]; if (!t) return;
    LD.draft.sms = BD.fillVars(t.body, vars(LD.d.lead)); redraw(); var ta = document.querySelector('.comp textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  });
  BD.on('comp-etpl', function (el) {
    var t = BD.state.me.settings.templates.email.filter(function (x) { return x.id === el.value; })[0]; if (!t) return;
    var v = vars(LD.d.lead); LD.draft.subject = BD.fillVars(t.subject, v); LD.draft.email = BD.fillVars(t.body, v) + (BD.state.me.mine.signature ? '\n\n' + BD.state.me.mine.signature : ''); redraw();
  });
  BD.on('comp-send', function (el) {
    var l = LD.d.lead, t = LD.tab, ta = document.querySelector('.comp textarea'), text = ta ? ta.value.trim() : '';
    var done = function (msg) { LD.draft[t] = ''; document.querySelectorAll('.comp textarea, .comp input[name=subject]').forEach(function (x) { x.value = ''; }); if (t === 'email') LD.draft.subject = ''; if (t === 'call') LD.draft.outcome = null; BD.toast(msg); return BD.reloadLead(); };
    el.disabled = true;
    var p;
    if (t === 'note') { if (!text) { el.disabled = false; return BD.toast('Write the note first.', { bad: true }); } p = BD.api('/api/activities', { body: { leadId: l.id, kind: 'note', body: text } }).then(function () { return done('Note saved'); }); }
    if (t === 'sms') p = BD.api('/api/phone/sms', { body: { leadId: l.id, to: LD.draft.smsTo || l.phone, body: text } }).then(function () { BD.phone.pollSoon(); return done('Text sent'); });
    if (t === 'email') p = BD.api('/api/email', { body: { action: 'send', leadId: l.id, to: LD.draft.emailTo || l.email, subject: (document.querySelector('.comp input[name=subject]') || {}).value, body: text } }).then(function () { return done('Email sent'); });
    if (t === 'call') { if (!LD.draft.outcome) { el.disabled = false; return BD.toast('Pick how the call went.', { bad: true }); } p = BD.api('/api/activities', { body: { leadId: l.id, kind: 'call', outcome: LD.draft.outcome, body: text } }).then(function () { return done('Call logged'); }); }
    if (p) p.catch(function (e) { el.disabled = false; BD.fail(e); });
  });

  // ---------- timeline ----------
  function timeline(acts, l) {
    if (!acts.length) return '<div class="panel tl-p"><div class="empty-line">Nothing yet. Calls, texts, emails and notes show up here.</div></div>';
    return '<div class="panel tl-p" data-spec-id="timeline"><ul class="tl">' + acts.map(function (a) { return item(a, l); }).join('') + '</ul></div>';
  }
  BD.activityLine = function (a) { return item(a, LD.d ? LD.d.lead : {}); };
  function item(a, l) {
    var who = a.member ? BD.first(BD.pname(a.member)) : '', at = '<span>' + esc(BD.when(a.at)) + '</span>', ic = 'sys', head = '', body = '';
    if (a.kind === 'call') {
      ic = 'call' + (a.status === 'missed' || a.status === 'voicemail' && a.dir === 'in' ? ' bad' : '');
      var st = a.dir === 'in' ? (a.status === 'completed' ? 'Call from ' + BD.fmtPhone(a.other) : a.status === 'voicemail' ? 'Voicemail' : a.status === 'ringing' ? 'Calling now' : 'Missed call')
        : (a.status === 'completed' ? (a.duration >= 30 ? 'Talked' : 'Call') : a.status === 'voicemail' ? (a.data.voicemailDropped ? 'Left a voicemail' : 'Reached voicemail') : a.status === 'no-answer' ? 'No answer' : a.status === 'busy' ? 'Busy' : a.status === 'abandoned' ? 'Answered, no rep free' : a.status === 'ringing' ? 'Calling' : BD.cap(a.status || 'Call'));
      head = '<b>' + esc(st) + '</b>' + (a.duration ? ' <span class="muted">' + BD.dur(a.duration) + '</span>' : '') + (a.outcome && a.outcome !== st && !(st === 'Left a voicemail' && a.outcome === 'Left voicemail') ? ' <span class="pill">' + esc(a.outcome) + '</span>' : '') + (a.data.sessionId ? ' <span class="pill accent" data-tip="Placed by the dialer">Dialer</span>' : '');
      body = (a.body ? '<div class="txt">' + esc(a.body) + '</div>' : '') + (a.data.recordingUrl ? '<audio controls preload="none" src="' + esc(a.data.recordingUrl) + '.mp3"></audio>' : '') + (a.data.voicemail ? '<div class="txt vm">"' + esc(a.data.voicemail) + '"</div>' : '');
    } else if (a.kind === 'sms') {
      ic = 'text';
      return '<li class="bubble-li ' + a.dir + '"><div class="bub ' + a.dir + '"><div class="b">' + esc(a.body) + '</div><div class="t">' + (a.dir === 'in' ? esc(l.contactName || BD.fmtPhone(a.other)) : esc(who)) + ', ' + esc(BD.when(a.at)) + (a.status === 'failed' || a.status === 'undelivered' ? ' <span class="bad">Not delivered</span>' : '') + (a.data.bulk ? ' <span class="muted">from a sequence</span>' : '') + '</div></div></li>';
    } else if (a.kind === 'email') {
      ic = 'mail';
      head = '<b>' + esc(a.subject || '(no subject)') + '</b> <span class="muted">' + (a.dir === 'in' ? 'from ' + esc(a.other) : 'to ' + esc(a.other)) + '</span>' + (a.data.bulk ? ' <span class="pill" data-tip="Sent by a sequence or bulk email">Sequence</span>' : '');
      body = '<details class="mail"><summary>' + esc(String(a.body || '').replace(/^(hi|hello|hey)[^\n]*\n+/i, '').replace(/\s+/g, ' ').slice(0, 150)) + '</summary><div class="txt">' + esc(a.body) + '</div></details>';
    } else if (a.kind === 'note') { ic = 'note'; head = '<b>Note</b>'; body = '<div class="txt">' + esc(a.body) + '</div>'; }
    else if (a.kind === 'status') { head = 'Status: ' + esc(BD.status(a.data.from).label) + ' to <b>' + esc(BD.status(a.body).label) + '</b>'; }
    else if (a.kind === 'form') { ic = 'form'; head = '<b>Application</b>'; body = '<div class="txt">' + esc(a.body) + '</div>'; }
    else if (a.kind === 'submission') { ic = 'bank'; head = esc(a.body); }
    else head = '<span class="muted">' + esc(a.body) + '</span>';
    return '<li class="' + (a.kind === 'system' || a.kind === 'status' ? 'sys' : '') + '"><span class="ic ' + ic + '">' + (ICON[{ call: 'phone', text: 'msg', mail: 'mail', note: 'note', form: 'form', bank: 'bank' }[ic.split(' ')[0]]] || '') + '</span><div><div class="meta">' + head + '<span class="sp"></span>' + (who && a.kind !== 'system' ? '<span>' + esc(who) + '</span>' : '') + at + '</div>' + body + '</div></li>';
  }

  // ---------- right column ----------
  function tasks(list) {
    return '<div class="card-s"><div class="cs-h"><h3>Tasks</h3><button class="link" data-act="task-new">Add</button></div>' + (list.length ? list.map(function (t) {
      var d = BD.due(t.dueAt);
      return '<div class="task' + (d.late ? ' late' : '') + '"><button class="tick" data-act="task-done" data-v="' + esc(t.id) + '" aria-label="Done">' + ICON.check + '</button><div><b>' + esc(t.note || 'Follow up') + '</b><span>' + esc(d.text) + (t.member !== BD.state.me.user.member ? ', ' + esc(BD.pname(t.member)) : '') + '</span></div></div>';
    }).join('') : '<div class="chips pad-s">' + quick().map(function (x) { return '<button class="chip" data-act="task-quick" data-v="' + x[1] + '">' + x[0] + '</button>'; }).join('') + '</div>') + '</div>';
  }
  function quick() {
    var d = new Date(), t15 = new Date(); t15.setHours(15, 0, 0, 0); var tm = new Date(); tm.setDate(tm.getDate() + 1); tm.setHours(9, 30, 0, 0); var d3 = new Date(); d3.setDate(d3.getDate() + 3); d3.setHours(10, 0, 0, 0);
    var wk = new Date(); wk.setDate(wk.getDate() + 7); wk.setHours(10, 0, 0, 0);
    return [[t15 > d ? 'Today 3 pm' : 'In 2 hours', (t15 > d ? t15 : new Date(Date.now() + 2 * 36e5)).getTime()], ['Tomorrow 9:30', tm.getTime()], ['In 3 days', d3.getTime()], ['Next week', wk.getTime()]];
  }
  BD.quickTimes = quick;
  BD.on('task-quick', function (el) { BD.api('/api/tasks', { body: { leadId: LD.id, dueAt: +el.getAttribute('data-v'), note: 'Follow up' } }).then(function () { BD.toast('Task set for ' + BD.due(+el.getAttribute('data-v')).text.toLowerCase()); BD.reloadLead(); }, BD.fail); });
  BD.taskForm = function (leadId, then) {
    BD.modal({ title: 'New task', body: '<label class="field"><span>What</span><input name="note" placeholder="Call back about statements" value="Follow up"></label>' +
      '<div class="chips" style="margin:12px 0 4px">' + quick().map(function (x, i) { return '<label class="chip' + (i === 1 ? ' on' : '') + '"><input type="radio" name="when" value="' + x[1] + '"' + (i === 1 ? ' checked' : '') + ' hidden>' + x[0] + '</label>'; }).join('') + '</div>' +
      '<div class="grid2"><label class="field"><span>Or pick a day</span><input type="date" name="day"></label><label class="field"><span>Time</span><input type="time" name="time" value="09:30"></label></div>',
      submit: 'Add task', mount: function (m) { m.addEventListener('change', function (e) { if (e.target.name === 'when') { m.querySelectorAll('.chips .chip').forEach(function (c) { c.classList.toggle('on', c.querySelector('input').checked); }); } }); },
      onSubmit: function (f) {
        var d = BD.formData(f), due = +d.when;
        if (d.day) { var p = d.day.split('-'), t = (d.time || '09:30').split(':'); due = new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1]).getTime(); }
        return BD.api('/api/tasks', { body: { leadId: leadId, dueAt: due, note: d.note } }).then(function () { BD.toast('Task added'); if (then) then(); });
      } });
  };
  BD.on('task-new', function () { BD.taskForm(LD.id, BD.reloadLead); });
  BD.on('task-done', function (el) { BD.api('/api/tasks', { method: 'PATCH', body: { id: el.getAttribute('data-v'), done: true } }).then(function () { BD.toast('Done'); if (BD.route.name === 'lead') BD.reloadLead(); else BD.render({ keepScroll: true }); BD.refreshInboxCount(); }, BD.fail); });
  function dealCard(deals, l) {
    var d = deals.filter(function (x) { return x.stage !== 'dead'; })[0] || deals[0];
    if (!d) return '<div class="card-s"><div class="cs-h"><h3>Deal</h3></div><p class="muted pad-s">No application yet.</p><div class="pad-s"><button class="btn sm" data-act="deal-start">' + ICON.plus + 'Start an application</button><button class="link" data-act="copy-apply" style="margin-left:10px">Copy form link</button></div></div>';
    var subs = d.submissions || [], appr = subs.filter(function (s) { return s.status === 'approved'; }).length;
    return '<div class="card-s"><div class="cs-h"><h3>Deal</h3><a class="link" href="#/deal/' + esc(d.id) + '">Open</a></div><a class="dealmini" href="#/deal/' + esc(d.id) + '"><span class="money">' + (d.fundedAmount ? BD.money(d.fundedAmount) : d.requested ? BD.money(d.requested) : 'Amount not set') + '</span>' +
      '<span class="pill ' + (d.stage === 'funded' ? 'good' : d.stage === 'dead' ? 'bad' : 'accent') + '">' + esc(S.STAGES[S.STAGE_INDEX[d.stage]].label) + '</span>' +
      '<span class="muted small">' + (subs.length ? subs.length + ' lender' + (subs.length > 1 ? 's' : '') + (appr ? ', ' + appr + ' approved' : '') : 'Not sent to lenders yet') + '</span></a></div>';
  }
  BD.on('deal-start', function () { BD.api('/api/deals', { body: { leadId: LD.id } }).then(function (r) { BD.toast('Application started'); BD.go('#/deal/' + r.deal.id); }, BD.fail); });
  BD.on('copy-apply', function () { var u = location.origin + '/apply/' + BD.state.me.ws.slug; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { BD.toast('Form link copied'); }, function () { BD.toast(u, { long: true }); }); });
  function seqCard(list) {
    var active = list.filter(function (s) { return s.status === 'active'; });
    return '<div class="card-s"><div class="cs-h"><h3>Sequences</h3><button class="link" data-act="lead-enroll">Add</button></div>' + (list.length ? list.slice(0, 4).map(function (s) {
      return '<div class="kv"><span class="trunc">' + esc(s.name) + '</span><b class="' + (s.status === 'active' ? 'good' : 'muted') + '">' + (s.status === 'active' ? 'Step ' + (s.step + 1) + (s.nextAt ? ', ' + BD.when(s.nextAt).toLowerCase() : '') : BD.cap(s.status)) + '</b></div>' +
        (s.status === 'active' ? '<div class="right"><button class="link small" data-act="seq-stop" data-v="' + esc(s.id) + '">Stop</button></div>' : '');
    }).join('') : '<p class="muted pad-s">Not in any sequence.</p>') + '</div>';
  }
  BD.on('lead-enroll', function () { BD.enrollPicker({ ids: [LD.id], count: 1 }, BD.reloadLead); });
  BD.on('seq-stop', function (el) { BD.api('/api/sequences', { body: { action: 'stop', enrollmentId: el.getAttribute('data-v') } }).then(function () { BD.toast('Sequence stopped for this lead'); BD.reloadLead(); }, BD.fail); });
  function filesCard(files) {
    return '<div class="card-s"><div class="cs-h"><h3>Files</h3><label class="link" style="cursor:pointer">Upload<input type="file" class="file-in" data-change="file-up" multiple accept="application/pdf,image/*,.csv,.xlsx"></label></div>' +
      (files.length ? files.map(function (f) { return '<a class="file" href="/api/files/' + esc(f.id) + '" target="_blank" rel="noopener">' + ICON.file + '<span class="trunc">' + esc(f.name) + '</span><span class="muted small">' + Math.max(1, Math.round(f.size / 1024)) + ' KB</span></a>'; }).join('') : '<p class="muted pad-s">Bank statements, ID and signed papers go here.</p>') + '</div>';
  }
  BD.on('file-up', function (el) {
    var files = Array.prototype.slice.call(el.files || []); if (!files.length) return;
    var dealId = (LD.d.deals[0] || {}).id || '';
    Promise.all(files.map(function (f) { var fd = new FormData(); fd.append('file', f); fd.append('leadId', LD.id); fd.append('dealId', dealId); fd.append('kind', /statement|bank/i.test(f.name) ? 'statement' : 'other'); return BD.api('/api/files', { body: fd }); }))
      .then(function () { BD.toast(BD.plural(files.length, 'file') + ' added'); BD.reloadLead(); }, BD.fail);
  });

  // ---------- header actions ----------
  BD.on('lead-call', function (el) { var l = LD.d.lead; BD.phone.call({ leadId: l.id, to: el.getAttribute('data-v') || l.phone, name: l.name, contact: l.contactName }); });
  function patch(body, msg) { return BD.api('/api/leads/' + LD.id, { method: 'PATCH', body: body }).then(function (r) { LD.d.lead = r.lead; if (msg) BD.toast(msg); return BD.reloadLead(); }, BD.fail); }
  BD.patchLead = patch;
  BD.on('lead-status', function (el) { BD.menu(el, BD.statuses().map(function (s) { return { v: s.id, label: s.label, sel: s.id === LD.d.lead.status }; }), function (v) { patch({ status: v }, 'Status: ' + BD.status(v).label); }); });
  BD.on('lead-owner', function (el) { BD.menu(el, BD.state.me.team.filter(function (p) { return p.active; }).map(function (p) { return { v: p.id, label: p.name, sel: p.id === LD.d.lead.owner }; }).concat([{ sep: true }, { v: '', label: 'Nobody' }]), function (v) { patch({ owner: v || null }, v ? 'Given to ' + BD.pname(v) : 'Unassigned'); }); });
  BD.on('lead-dnc', function (el) { patch({ dnc: el.checked }, el.checked ? 'On the do-not-call list' : 'Off the do-not-call list'); });
  BD.on('consent-edit', function () {
    var c = LD.d.lead.consent || {};
    BD.modal({ title: 'Email and text consent', sub: 'Canada\'s anti-spam law (CASL) needs consent before bulk email or texts. One-to-one messages about their application are fine without it.',
      body: '<div class="reasons">' + [['express', 'They opted in', 'They asked to hear from you: ticked the box on your form, said yes on a call, or replied to opt in.'], ['implied', 'Implied consent', 'An existing business relationship in the last 2 years, or they published this address for business contact.'], ['none', 'No consent', 'Only one-to-one messages. Bulk email and texts skip them.']].map(function (o) {
        return '<label class="' + (c.type === o[0] ? 'on' : '') + '"><input type="radio" name="type" value="' + o[0] + '"' + (c.type === o[0] || (!c.type && o[0] === 'none') ? ' checked' : '') + '><span><b>' + o[1] + '</b><br><span class="muted small">' + o[2] + '</span></span></label>';
      }).join('') + '</div><label class="field"><span>How you got it</span><input name="source" value="' + esc(c.source || '') + '" placeholder="e.g. Said yes on the call with Nathan, Oct 15"></label>',
      submit: 'Save', onSubmit: function (f) { var d = BD.formData(f); return patch({ consent: { type: d.type, source: d.source } }, 'Consent saved'); } });
  });
  BD.on('lead-more', function (el) {
    var l = LD.d.lead, items = [{ v: 'deal', label: LD.d.deals.length ? 'Open the deal' : 'Start an application' }, { v: 'seq', label: 'Add to a sequence' }, { v: 'edit', label: 'Edit details' }, { sep: true }, { v: 'export', label: 'Download everything on file' }];
    if (BD.isMgr()) items.push({ v: 'erase', label: 'Erase this business', danger: true });
    BD.menu(el, items, function (v) {
      if (v === 'deal') { if (LD.d.deals.length) BD.go('#/deal/' + LD.d.deals[0].id); else BD.acts['deal-start'](); }
      if (v === 'seq') BD.acts['lead-enroll']();
      if (v === 'edit') BD.leadForm(l);
      if (v === 'export') location.href = '/api/leads/' + l.id + '?export=1';
      if (v === 'erase') BD.confirm('Erase ' + l.name + '?', 'This deletes the business, its people, every call, text, email, note, deal and file. Use it when someone asks to be forgotten. It cannot be undone.', 'Erase for good', function () {
        return BD.api('/api/leads/' + l.id, { method: 'DELETE' }).then(function () { BD.toast('Erased'); BD.go('#/leads'); });
      }, true);
    }, { right: true });
  });
  BD.on('lead-edit', function () { BD.leadForm(LD.d.lead); });

  // ---------- create / edit form ----------
  BD.leadForm = function (l) {
    var x = l || {}, c = (x.contacts || [])[0] || {}, more = (x.contacts || []).slice(1);
    var sel = function (name, items, cur, empty) { return '<select name="' + name + '">' + (empty ? '<option value="">' + empty + '</option>' : '') + items.map(function (it) { return '<option value="' + esc(it[0]) + '"' + (it[0] === cur ? ' selected' : '') + '>' + esc(it[1]) + '</option>'; }).join('') + '</select>'; };
    var mgr = BD.isMgr();
    BD.modal({ title: l ? 'Edit ' + l.name : 'Add a lead', wide: true,
      body: '<div class="grid3"><label class="field span2"><span>Business name</span><input name="name" required value="' + esc(x.name || '') + '"></label>' +
        '<label class="field"><span>Status</span>' + sel('status', BD.statuses().map(function (s) { return [s.id, s.label]; }), x.status || 'new') + '</label>' +
        '<label class="field"><span>Contact name</span><input name="cname" value="' + esc(c.name || '') + '"></label><label class="field"><span>Phone</span><input name="cphone" inputmode="tel" value="' + esc(c.phone || '') + '"></label>' +
        '<label class="field"><span>Email</span><input name="cemail" type="email" value="' + esc(c.email || '') + '"></label>' +
        '<label class="field"><span>Province</span>' + sel('province', S.PROVINCES.map(function (p) { return [p.id, p.name]; }), x.province, 'Pick one') + '</label><label class="field"><span>City</span><input name="city" value="' + esc(x.city || '') + '"></label>' +
        '<label class="field"><span>Industry</span>' + sel('industry', S.INDUSTRIES.map(function (i) { return [i, i]; }), x.industry, 'Pick one') + '</label>' +
        '<label class="field"><span>Monthly revenue</span><input name="monthlyRevenue" type="number" min="0" step="1000" value="' + esc(x.monthlyRevenue || '') + '" placeholder="$"></label><label class="field"><span>Wants</span><input name="requested" type="number" min="0" step="5000" value="' + esc(x.requested || '') + '" placeholder="$"></label>' +
        '<label class="field"><span>Months trading</span><input name="months" type="number" min="0" value="' + esc(x.months || '') + '"></label><label class="field"><span>Credit score</span><input name="score" type="number" min="300" max="900" value="' + esc(x.score || '') + '"></label>' +
        '<label class="field"><span>Other funders now</span><input name="positions" type="number" min="0" max="20" value="' + esc(x.positions == null ? '' : x.positions) + '"></label><label class="field"><span>Website</span><input name="website" value="' + esc(x.website || '') + '"></label>' +
        '<label class="field"><span>List</span><input name="list" value="' + esc(x.list || '') + '"></label>' + (mgr ? '<label class="field"><span>Owner</span>' + sel('owner', BD.state.me.team.filter(function (p) { return p.active; }).map(function (p) { return [p.id, p.name]; }), x.owner || (l ? '' : BD.state.me.user.member), 'Nobody') + '</label>' : '') +
        '<label class="field span3"><span>Notes</span><textarea name="notes" rows="3">' + esc(x.notes || '') + '</textarea></label></div>' +
        (more.length ? '<p class="muted small" style="margin-top:10px">' + BD.plural(more.length, 'more person', 'more people') + ' on file are kept as they are.</p>' : ''),
      submit: l ? 'Save' : 'Add lead', onSubmit: function (f) {
        var d = BD.formData(f); if (!d.name.trim()) throw new Error('Write the business name.');
        var body = { name: d.name, status: d.status, province: d.province, city: d.city, industry: d.industry, monthlyRevenue: d.monthlyRevenue, requested: d.requested, months: d.months, score: d.score, positions: d.positions, website: d.website, list: d.list, notes: d.notes,
          contacts: [{ id: c.id, name: d.cname, title: c.title, phone: d.cphone, phone2: c.phone2, email: d.cemail }].concat(more) };
        if (mgr) body.owner = d.owner || null;
        if (l) return BD.api('/api/leads/' + l.id, { method: 'PATCH', body: body }).then(function () { BD.toast('Saved'); return BD.reloadLead(); });
        return BD.api('/api/leads', { body: body }).then(function (r) { BD.toast('Lead added'); BD.go('#/lead/' + r.lead.id); });
      } });
  };
})();
