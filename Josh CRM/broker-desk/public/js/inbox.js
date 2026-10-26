/* Inbox: everything waiting on you, newest first, in one place. Missed calls and voicemails, texts,
 * emails, new applications, lender replies, and tasks due today. Each item can be handled right
 * here (call back, reply, open, done, snooze) and drops off when it is. */
(function () {
  'use strict';
  var BD = window.BD, esc = BD.esc, ICON = BD.ICON;
  var X = { team: false, only: '', d: null };
  var KINDS = [['', 'Everything'], ['call', 'Calls'], ['sms', 'Texts'], ['email', 'Email'], ['form', 'Applications'], ['task', 'Tasks']];

  function load() { return BD.api('/api/inbox' + (X.team ? '?team=1' : '')).then(function (r) { X.d = r; return r; }); }
  BD.views.inbox = {
    render: function (a, q, o) { if (o.soft && X.d) return load().then(page); return load().then(page); },
    mounted: function () { BD.refreshInboxCount(); }
  };
  function group(acts) {
    var g = { calls: [], texts: {}, emails: [], forms: [], lenders: [] };
    acts.forEach(function (a) {
      if (a.kind === 'call') g.calls.push(a);
      else if (a.kind === 'sms') { var k = a.leadId || a.other; (g.texts[k] = g.texts[k] || []).push(a); }
      else if (a.kind === 'email') g.emails.push(a);
      else if (a.kind === 'form') g.forms.push(a);
      else if (a.kind === 'submission') g.lenders.push(a);
    });
    g.textList = Object.keys(g.texts).map(function (k) { return g.texts[k]; }).sort(function (a, b) { return b[0].at - a[0].at; });
    return g;
  }
  function page() {
    var d = X.d, g = group(d.activities), n = d.activities.length - (d.activities.length - g.calls.length - g.emails.length - g.forms.length - g.lenders.length - Object.keys(g.texts).reduce(function (t, k) { return t + g.texts[k].length; }, 0));
    var total = g.calls.length + g.textList.length + g.emails.length + g.forms.length + g.lenders.length + d.tasks.length;
    var head = '<div class="page-head"><div><h1>Inbox</h1><p>' + esc(BD.fmtDay(Date.now(), true)) + '. ' + (total ? BD.plural(total, 'thing') + ' waiting on ' + (X.team ? 'the team' : 'you') + '.' : 'Nothing waiting. Nice.') + '</p></div>' +
      '<div class="filters"><div class="seg">' + KINDS.map(function (k) { return '<button class="' + (X.only === k[0] ? 'on' : '') + '" data-act="ix-only" data-v="' + k[0] + '">' + k[1] + '</button>'; }).join('') + '</div>' +
      (BD.isMgr() ? '<div class="seg"><button class="' + (!X.team ? 'on' : '') + '" data-act="ix-team" data-v="0">Mine</button><button class="' + (X.team ? 'on' : '') + '" data-act="ix-team" data-v="1">Team</button></div>' : '') + '</div></div>';
    var show = function (k) { return !X.only || X.only === k; }, out = '';
    if (show('call') && g.calls.length) out += section('Calls', g.calls.length, g.calls.map(callRow).join(''), 'ix-calls');
    if (show('sms') && g.textList.length) out += section('Texts', g.textList.length, g.textList.map(textRow).join(''), 'ix-texts');
    if (show('email') && g.emails.length) out += section('Email', g.emails.length, g.emails.map(emailRow).join(''), 'ix-email');
    if (show('form') && (g.forms.length || g.lenders.length)) out += section('Applications and lenders', g.forms.length + g.lenders.length, g.forms.map(formRow).join('') + g.lenders.map(lenderRow).join(''), 'ix-apps');
    if (show('task') && d.tasks.length) out += section('Tasks due today', d.tasks.length, d.tasks.map(taskRow).join(''), 'ix-tasks');
    if (!out) out = '<div class="panel"><div class="empty-sec zen"><b>' + (X.only ? 'Nothing here right now.' : 'You are all caught up.') + '</b><span>New calls, texts, emails and applications land here the moment they come in.</span><button class="btn" data-act="go" data-v="#/leads?list=l-to-call">Call your leads</button></div></div>';
    return '<div class="page page-inbox">' + head + out + '</div>';
  }
  function section(title, n, body, id) { return '<section class="panel tsec" id="' + id + '" data-spec-id="' + id + '"><div class="panel-head"><h2>' + esc(title) + '<span class="cnt">' + n + '</span></h2></div><div class="rows">' + body + '</div></section>'; }
  function whoLine(a) { return '<b class="trunc">' + esc(a.leadName || BD.fmtPhone(a.other)) + '</b>' + (X.team && a.member ? ' <span class="muted">for ' + esc(BD.first(BD.pname(a.member))) + '</span>' : ''); }
  function open(a) { return a.leadId ? ' data-act="ix-open" data-lead="' + esc(a.leadId) + '"' : ''; }
  function done(id) { return '<button class="btn sm done-btn" data-act="ix-done" data-v="' + esc(id) + '">' + ICON.check + 'Done</button>'; }
  function callRow(a) {
    var vm = a.status === 'voicemail', missed = !vm;
    return '<div class="row trow click"' + open(a) + '><div class="when due">' + esc(BD.when(a.at)) + '</div><div class="main">' + whoLine(a) +
      '<div class="sub">' + (vm ? '<span class="bad">Voicemail</span>' + (a.duration ? ' ' + BD.dur(a.duration) : '') + (a.data.voicemail ? ': "' + esc(a.data.voicemail) + '"' : '') : '<span class="bad">Missed call</span> from ' + esc(BD.fmtPhone(a.other))) + '</div>' +
      (a.data.recordingUrl ? '<audio controls preload="none" src="' + esc(a.data.recordingUrl) + '.mp3"></audio>' : '') + '</div>' +
      '<div class="acts"><button class="btn sm" data-act="ix-call" data-lead="' + esc(a.leadId || '') + '" data-to="' + esc(a.other) + '" data-name="' + esc(a.leadName || '') + '">' + ICON.phone + 'Call back</button>' + done(a.id) + '</div></div>';
  }
  function textRow(list) {
    var a = list[0];
    return '<div class="row trow click"' + open(a) + '><div class="when due">' + esc(BD.when(a.at)) + '</div><div class="main">' + whoLine(a) + (list.length > 1 ? ' <span class="cnt">' + list.length + '</span>' : '') +
      '<div class="bub in mini"><div class="b">' + esc(a.body) + '</div></div></div><div class="acts"><button class="btn sm" data-act="ix-reply" data-lead="' + esc(a.leadId || '') + '" data-v="sms">' + ICON.msg + 'Reply</button>' +
      '<button class="btn sm done-btn" data-act="ix-done" data-v="' + esc(list.map(function (x) { return x.id; }).join(',')) + '">' + ICON.check + 'Done</button></div></div>';
  }
  function emailRow(a) {
    return '<div class="row trow click"' + open(a) + '><div class="when due">' + esc(BD.when(a.at)) + '</div><div class="main">' + whoLine(a) + '<div class="sub"><b>' + esc(a.subject || '(no subject)') + '</b> ' + esc(String(a.body || '').slice(0, 140)) + '</div></div>' +
      '<div class="acts"><button class="btn sm" data-act="ix-reply" data-lead="' + esc(a.leadId || '') + '" data-v="email">' + ICON.mail + 'Reply</button>' + done(a.id) + '</div></div>';
  }
  function formRow(a) {
    return '<div class="row trow click"' + open(a) + '><div class="when due">' + esc(BD.when(a.at)) + '</div><div class="main">' + whoLine(a) + ' <span class="pill good">New application</span><div class="sub">' + esc(a.body) + '</div></div>' +
      '<div class="acts"><button class="btn sm" data-act="ix-call" data-lead="' + esc(a.leadId || '') + '" data-name="' + esc(a.leadName || '') + '">' + ICON.phone + 'Call</button>' + (a.dealId ? '<a class="btn sm" href="#/deal/' + esc(a.dealId) + '">Open file</a>' : '') + done(a.id) + '</div></div>';
  }
  function lenderRow(a) {
    var bad = /declined/i.test(a.body);
    return '<div class="row trow click"' + (a.dealId ? ' data-act="go" data-v="#/deal/' + esc(a.dealId) + '"' : open(a)) + '><div class="when">' + esc(BD.when(a.at)) + '</div><div class="main">' + whoLine(a) + ' <span class="pill ' + (bad ? 'bad' : 'good') + '">' + (bad ? 'Declined' : 'Approved') + '</span><div class="sub">' + esc(a.body) + '</div></div>' +
      '<div class="acts">' + (a.dealId ? '<a class="btn sm" href="#/deal/' + esc(a.dealId) + '">Open file</a>' : '') + done(a.id) + '</div></div>';
  }
  function taskRow(t) {
    var d = BD.due(t.dueAt);
    return '<div class="row trow click"' + (t.leadId ? ' data-act="ix-open" data-lead="' + esc(t.leadId) + '"' : '') + '><div class="when' + (d.late ? ' due' : '') + '">' + esc(d.text) + '</div><div class="main"><b class="trunc">' + esc(t.leadName || 'No lead') + '</b>' + (X.team && t.member ? ' <span class="muted">for ' + esc(BD.first(BD.pname(t.member))) + '</span>' : '') + '<div class="sub">' + esc(t.note || 'Follow up') + '</div></div>' +
      '<div class="acts">' + (t.leadId ? '<button class="btn sm" data-act="ix-call" data-lead="' + esc(t.leadId) + '" data-name="' + esc(t.leadName || '') + '">' + ICON.phone + 'Call</button>' : '') +
      '<button class="btn sm ghost" data-act="ix-snooze" data-v="' + esc(t.id) + '">Later</button><button class="btn sm done-btn" data-act="task-done" data-v="' + esc(t.id) + '">' + ICON.check + 'Done</button></div></div>';
  }
  BD.on('ix-only', function (el) { X.only = el.getAttribute('data-v'); document.getElementById('main').innerHTML = page(); });
  BD.on('ix-team', function (el) { X.team = el.getAttribute('data-v') === '1'; load().then(function () { document.getElementById('main').innerHTML = page(); }, BD.fail); });
  BD.on('ix-open', function (el, e) { if (e.target.closest('button, a, audio')) return; BD.go('#/lead/' + el.getAttribute('data-lead') + '?from=' + encodeURIComponent('#/inbox')); });
  BD.on('ix-done', function (el) {
    var ids = el.getAttribute('data-v').split(','), row = el.closest('.row');
    if (row) row.classList.add('leaving');
    BD.api('/api/inbox', { body: { done: ids } }).then(function () { return load(); }).then(function () { document.getElementById('main').innerHTML = page(); BD.refreshInboxCount(); }, BD.fail);
  });
  BD.on('ix-call', function (el) {
    var leadId = el.getAttribute('data-lead');
    var go = function (to, name, contact) { BD.phone.call({ leadId: leadId || null, to: to, name: name, contact: contact }); };
    if (el.getAttribute('data-to')) return go(el.getAttribute('data-to'), el.getAttribute('data-name'));
    BD.api('/api/leads/' + leadId + '?read=0').then(function (r) { go(r.lead.phone, r.lead.name, r.lead.contactName); }, BD.fail);
  });
  BD.on('ix-reply', function (el) { BD.leadPage.tab = el.getAttribute('data-v'); BD.leadPage.focus = true; BD.go('#/lead/' + el.getAttribute('data-lead') + '?from=' + encodeURIComponent('#/inbox') + '&tab=' + el.getAttribute('data-v')); });
  BD.on('ix-snooze', function (el) {
    BD.menu(el, [{ v: 36e5, label: 'In an hour' }, { v: 'tm', label: 'Tomorrow 9:30' }, { v: 'wk', label: 'Next week' }], function (v) {
      var due = v === 'tm' ? BD.quickTimes()[1][1] : v === 'wk' ? BD.quickTimes()[3][1] : Date.now() + 36e5;
      BD.api('/api/tasks', { method: 'PATCH', body: { id: el.getAttribute('data-v'), dueAt: due } }).then(function () { BD.toast('Moved to ' + BD.due(due).text.toLowerCase()); return load(); }).then(function () { document.getElementById('main').innerHTML = page(); BD.refreshInboxCount(); }, BD.fail);
    });
  });
})();
