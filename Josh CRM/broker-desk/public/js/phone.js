/* The phone: calls from the browser, incoming calls, and the wrap-up after every call.
 * Two drivers with the same shape. TwilioDriver uses Twilio's Voice SDK (served from /vendor once the
 * real line is on). SimDriver is the demo line: it acts out ringing and answering so every screen
 * can be used and filmed before the carrier account exists. Either way the server logs the call
 * when it starts, and the wrap-up saves how it went.
 *
 * Incoming calls and texts are picked up by asking /api/phone/events every few seconds. */
(function () {
  'use strict';
  var BD = window.BD, esc = BD.esc, ICON = BD.ICON;
  var P = BD.phone = { call: call, init: init, busy: function () { return !!C; }, drivers: {} };
  var C = null; // the call on screen: { id, lead, name, contact, to, from, state, start, dur, muted, dir, voicemail }

  // ---------- drivers ----------
  // A driver places one call: dial(info, on) where on = { ringing, answered(by), ended(reason) }.
  // answered(by) passes 'human' or 'machine'. hangup() ends it.
  P.drivers.sim = {
    dial: function (info, on) {
      var plan = info.plan || simPlan(info), t1, t2;
      t1 = setTimeout(function () { on.ringing(); }, 700);
      t2 = setTimeout(function () { if (plan === 'no-answer') on.ended('no-answer'); else on.answered(plan === 'voicemail' ? 'machine' : 'human'); }, 700 + (info.ringMs || (plan === 'no-answer' ? 9000 : 2600 + Math.random() * 1600)));
      return { hangup: function () { clearTimeout(t1); clearTimeout(t2); }, mute: function () {}, digits: function () {} };
    }
  };
  // Demo answers: most single calls are picked up, so the screen can be shown. A lead can carry
  // custom.demoAnswer (human, voicemail, no-answer) to script it.
  function simPlan(info) {
    var c = (info.lead && info.lead.custom) || {};
    if (c.demoAnswer) return c.demoAnswer;
    var r = Math.random(); return r < 0.7 ? 'human' : r < 0.85 ? 'voicemail' : 'no-answer';
  }
  P.simPlan = simPlan;
  P.drivers.twilio = {
    device: null,
    ready: function () {
      var self = this;
      if (self.device) return Promise.resolve(self.device);
      return loadSdk().then(function () { return BD.api('/api/phone/token'); }).then(function (t) {
        self.device = new window.Twilio.Device(t.token, { codecPreferences: ['opus', 'pcmu'], closeProtection: true });
        self.device.on('incoming', function (call) { incomingTwilio(call); });
        self.device.on('tokenWillExpire', function () { BD.api('/api/phone/token').then(function (n) { self.device.updateToken(n.token); }); });
        self.device.register();
        return self.device;
      });
    },
    dial: function (info, on) {
      var handle = { call: null, hangup: function () { if (handle.call) handle.call.disconnect(); }, mute: function (m) { if (handle.call) handle.call.mute(m); }, digits: function (d) { if (handle.call) handle.call.sendDigits(d); } };
      this.ready().then(function (dev) {
        return dev.connect({ params: { To: info.to, ActivityId: info.id } });
      }).then(function (call) {
        handle.call = call;
        call.on('ringing', function () { on.ringing(); });
        call.on('accept', function () { on.answered('human'); });
        call.on('disconnect', function () { on.ended('completed'); });
        call.on('cancel', function () { on.ended('no-answer'); });
        call.on('error', function (e) { BD.toast('Call failed: ' + (e && e.message || 'unknown error'), { bad: true }); on.ended('failed'); });
      }, function (e) { BD.fail(e); on.ended('failed'); });
      return handle;
    }
  };
  function loadSdk() {
    if (window.Twilio && window.Twilio.Device) return Promise.resolve();
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '/vendor/twilio.min.js'; s.onload = ok; s.onerror = function () { no(new Error('The calling library did not load.')); }; document.head.appendChild(s); });
  }
  P.driver = function () { var p = BD.state.me && BD.state.me.phone; return p && p.provider === 'twilio' ? P.drivers.twilio : P.drivers.sim; };

  // ---------- placing a call ----------
  function call(o) {
    if (C) { BD.toast('Finish the call you are on first.', { bad: true }); return; }
    if (BD.dialer && BD.dialer.active()) { BD.toast('You are in a dial session. End it to call someone else.', { bad: true }); return; }
    var me = BD.state.me;
    if (!me.phone.mine) { BD.toast('Get a phone number first.', { bad: true, action: { label: 'Phone settings', fn: function () { BD.go('#/settings/phone'); } } }); return; }
    C = { dir: 'out', lead: null, leadId: o.leadId, name: o.name, contact: o.contact, to: o.to, state: 'connecting', start: null, dur: 0 };
    draw();
    BD.api('/api/phone/call', { body: { leadId: o.leadId, to: o.to } }).then(function (r) {
      if (!C) return;
      C.id = r.activityId; C.from = r.from; C.record = r.record; C.notice = r.notice;
      var lead = BD.leadPage && BD.leadPage.d && BD.leadPage.d.lead && BD.leadPage.d.lead.id === o.leadId ? BD.leadPage.d.lead : null;
      C.handle = P.driver().dial({ id: r.activityId, to: r.to, lead: lead, plan: r.plan || null, ringMs: r.ringMs || null }, handlers());
      draw();
    }, function (e) { C = null; draw(); BD.fail(e); });
  }
  function handlers() {
    return {
      ringing: function () { if (C && C.state === 'connecting') { C.state = 'ringing'; draw(); } },
      answered: function (by) {
        if (!C) return;
        if (by === 'machine') { C.state = 'voicemail'; C.start = Date.now(); tick(); draw(); return; }
        C.state = 'live'; C.start = Date.now(); tick(); draw();
      },
      ended: function (reason) { if (!C) return; endCall(reason); }
    };
  }
  var timer = null;
  function tick() { clearInterval(timer); timer = setInterval(function () { if (!C || !C.start) return; C.dur = Math.round((Date.now() - C.start) / 1000); var t = document.getElementById('cb-time'); if (t) t.textContent = BD.dur(C.dur); }, 500); }
  function endCall(reason) {
    clearInterval(timer);
    if (C.handle) C.handle.hangup();
    C.dur = C.start ? Math.round((Date.now() - C.start) / 1000) : 0;
    C.result = reason === 'no-answer' ? 'no-answer' : reason === 'failed' ? 'failed' : C.state === 'voicemail' ? 'voicemail' : 'completed';
    C.outcome = C.result === 'no-answer' ? 'No answer' : C.result === 'voicemail' ? (C.vmDropped ? 'Left voicemail' : 'Reached voicemail') : C.dur >= 15 ? 'Talked' : null;
    C.state = 'wrap';
    draw();
  }
  BD.on('cb-hang', function () { if (!C) return; if (C.state === 'connecting' || C.state === 'ringing') endCall('no-answer'); else endCall('completed'); });
  BD.on('cb-mute', function () { if (!C) return; C.muted = !C.muted; if (C.handle) C.handle.mute(C.muted); draw(); });
  // Voicemail drop: the rep's recorded message plays to the machine and the rep moves on.
  BD.on('cb-drop', function () {
    if (!C) return;
    C.vmDropped = true; C.state = 'voicemail';
    BD.toast('Voicemail left. Moving on.');
    setTimeout(function () { if (C) endCall('completed'); }, 600);
  });
  BD.on('cb-outcome', function (el) { C.outcome = el.getAttribute('data-v'); draw(); var t = document.querySelector('.callbar textarea'); if (t) t.focus(); });
  BD.on('cb-task', function (el) { C.task = C.task === +el.getAttribute('data-v') ? null : +el.getAttribute('data-v'); draw(); });
  BD.on('cb-status', function (el) {
    BD.menu(el, BD.statuses().map(function (s) { return { v: s.id, label: s.label, sel: C.leadStatus === s.id }; }), function (v) { C.leadStatus = v; draw(); });
  });
  BD.on('cb-note', function (el) { if (C) C.note = el.value; });
  BD.on('cb-save', function () { save(false); });
  BD.on('cb-skip', function () { save(true); });
  function save(skip) {
    var c = C, note = c ? c.note || (document.querySelector('.callbar textarea') || {}).value || '' : '';
    if (!c) return;
    var body = { id: c.id, status: c.result === 'completed' && c.dir === 'in' ? 'completed' : c.result, duration: c.dur, outcome: skip ? null : c.outcome, note: skip ? null : note.trim(), voicemailDropped: !!c.vmDropped, leadStatus: skip ? null : c.leadStatus };
    if (c.outcome === 'Bad number' && !skip) body.leadStatus = 'bad-number';
    if (c.outcome === 'Send application' && !skip && !body.leadStatus) body.leadStatus = 'app-sent';
    C = null; draw();
    var p = c.id ? BD.api('/api/phone/call', { method: 'PATCH', body: body }) : Promise.resolve();
    p.then(function () {
      var t = !skip && c.task && c.leadId ? BD.api('/api/tasks', { body: { leadId: c.leadId, dueAt: c.task, note: c.outcome === 'Left voicemail' || c.outcome === 'No answer' ? 'Try again' : 'Follow up' } }) : null;
      return t;
    }).then(function () {
      if (!skip) BD.toast('Call saved' + (c.task ? '. Follow-up ' + BD.due(c.task).text.toLowerCase() : ''));
      if (!skip && c.outcome === 'Send application' && c.leadId) BD.sendApplication(c.lead || { id: c.leadId, name: c.name, contactName: c.contact });
      if (BD.route.name === 'lead' && BD.leadPage.id === c.leadId) BD.reloadLead();
      if (BD.route.name === 'inbox') BD.render({ keepScroll: true });
      BD.refreshInboxCount();
    }, BD.fail);
  }

  // ---------- drawing ----------
  function draw() {
    var root = document.getElementById('phone-root');
    if (!C) { root.innerHTML = ''; return; }
    var who = '<div class="cb-who"><b>' + esc(C.name || BD.fmtPhone(C.to)) + '</b><span>' + esc([C.contact, BD.fmtPhone(C.to)].filter(Boolean).join(', ')) + '</span></div>';
    if (C.state === 'wrap') {
      var outs = C.dir === 'in' ? ['Talked', 'Call back later', 'Not interested', 'Wrong number'] : ['Talked', 'Send application', 'Left voicemail', 'No answer', 'Call back later', 'Not interested', 'Bad number'];
      root.innerHTML = '<div class="callbar wrap enter" data-spec-id="call-wrap"><div class="cb-top"><span class="av">' + esc(BD.initials(C.contact || C.name)) + '</span>' + who +
        '<div class="cb-state">' + (C.dur ? BD.dur(C.dur) : '') + '<small>' + esc(C.result === 'no-answer' ? 'No answer' : C.result === 'voicemail' ? 'Voicemail' : C.result === 'failed' ? 'Did not connect' : 'Call ended') + '</small></div></div>' +
        '<div class="chips">' + outs.map(function (o) { return '<button class="chip' + (C.outcome === o ? ' on' : '') + '" data-act="cb-outcome" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>' +
        '<textarea rows="2" placeholder="Notes from the call" data-input="cb-note">' + esc(C.note || '') + '</textarea>' +
        '<div class="cb-fu"><span>Follow up</span>' + BD.quickTimes().map(function (x) { return '<button class="chip' + (C.task === x[1] ? ' on' : '') + '" data-act="cb-task" data-v="' + x[1] + '">' + x[0] + '</button>'; }).join('') + '</div>' +
        '<div class="cb-f">' + (C.leadId ? '<button class="btn sm ghost" data-act="cb-status">' + (C.leadStatus ? 'Status: ' + esc(BD.status(C.leadStatus).label) : 'Change status') + '</button>' : '') + '<span class="sp"></span><button class="btn sm ghost" data-act="cb-skip">Skip</button><button class="btn sm primary" data-act="cb-save">Save</button></div></div>';
      var ta = root.querySelector('textarea'); if (ta) setTimeout(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
      return;
    }
    var label = { connecting: 'Connecting', ringing: 'Ringing', live: '', voicemail: 'Voicemail' }[C.state];
    root.innerHTML = '<div class="callbar enter ' + C.state + '" data-spec-id="call-bar"><span class="av' + (C.state === 'ringing' || C.state === 'connecting' ? ' pulse' : '') + '">' + esc(BD.initials(C.contact || C.name)) + '</span>' + who +
      '<div class="cb-state"><span id="cb-time">' + (C.start ? BD.dur(C.dur) : '') + '</span><small>' + esc(label || (C.record ? 'Recording' : 'On the call')) + '</small></div>' +
      (C.state === 'voicemail' || C.state === 'live' ? '<button class="ib on-dark" data-act="cb-mute" data-tip="' + (C.muted ? 'Unmute' : 'Mute') + '" aria-label="Mute">' + (C.muted ? ICON.mute : ICON.mic) + '</button>' : '') +
      (C.dir === 'out' && (C.state === 'voicemail' || C.state === 'live') ? '<button class="btn sm vm-btn" data-act="cb-drop" data-tip="Leave your recorded voicemail and hang up">' + ICON.vm + 'Drop voicemail</button>' : '') +
      '<button class="hang" data-act="cb-hang" aria-label="Hang up">' + ICON.hang + '</button></div>' +
      (C.record && C.state === 'live' ? '<div class="cb-note">The recording notice played before the call connected.</div>' : '');
  }
  BD.onEscape = function () { };

  // ---------- incoming ----------
  var seen = {}, since = Date.now() - 15000, ringing = null;
  function poll() {
    if (!BD.state.me) return;
    BD.api('/api/phone/events?since=' + since).then(function (r) {
      since = Math.max(since, r.now - 3000);
      var newOnes = r.events.filter(function (e) { return !seen[e.id]; });
      newOnes.forEach(function (e) { seen[e.id] = 1; });
      newOnes.forEach(function (e) {
        if (e.kind === 'call' && e.status === 'ringing' && e.data.sim && Date.now() - e.at < 30000) ring(e);
        else if (e.kind === 'sms') notify('Text from ' + (e.leadName || BD.fmtPhone(e.other)), e.body, e.leadId);
        else if (e.kind === 'email') notify('Email from ' + (e.leadName || e.other), e.subject, e.leadId);
      });
      if (newOnes.length) {
        BD.refreshInboxCount();
        if (BD.route.name === 'inbox') BD.render({ keepScroll: true });
        if (BD.route.name === 'lead' && newOnes.some(function (e) { return e.leadId === BD.leadPage.id; })) BD.reloadLead();
      }
    }, function () {});
  }
  function notify(title, body, leadId) {
    BD.toast(title + ': ' + String(body || '').slice(0, 80), { action: leadId ? { label: 'Open', fn: function () { BD.go('#/lead/' + leadId); } } : null });
    if (document.hidden && window.Notification && Notification.permission === 'granted') { try { new Notification(title, { body: String(body || '').slice(0, 140), tag: leadId || title }); } catch (e) { /* ignore */ } }
  }
  function ring(e) {
    if (C || ringing) return;
    ringing = { id: e.id, leadId: e.leadId, name: e.leadName, to: e.other, voicemail: e.data.voicemail, at: e.at };
    drawRing();
    ringing.timer = setTimeout(function () { missed(); }, 20000);
    if (document.hidden && window.Notification && Notification.permission === 'granted') { try { new Notification('Incoming call', { body: e.leadName || BD.fmtPhone(e.other), tag: e.id }); } catch (x) { /* ignore */ } }
  }
  function drawRing() {
    var root = document.getElementById('ring-root');
    if (!ringing) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="ringer" data-spec-id="incoming-call"><div class="rg-h">' + ICON.phone + '<span>Incoming call</span></div><div class="rg-b"><b>' + esc(ringing.name || 'Unknown caller') + '</b><span>' + esc(BD.fmtPhone(ringing.to)) + '</span></div>' +
      '<div class="rg-acts"><button class="btn sm" data-act="ring-vm">Send to voicemail</button><button class="btn sm answer" data-act="ring-answer">' + ICON.phone + 'Answer</button></div></div>';
  }
  BD.on('ring-answer', function () {
    var r = ringing; if (!r) return;
    clearTimeout(r.timer); ringing = null; drawRing();
    C = { dir: 'in', id: r.id, leadId: r.leadId, name: r.name, to: r.to, state: 'live', start: Date.now(), dur: 0 };
    if (r.handle) { r.handle.accept(); C.handle = { hangup: function () { r.handle.disconnect(); }, mute: function (m) { r.handle.mute(m); } }; }
    tick(); draw();
    if (r.leadId) BD.go('#/lead/' + r.leadId);
  });
  BD.on('ring-vm', function () { missed(); });
  function missed() {
    var r = ringing; if (!r) return;
    clearTimeout(r.timer); ringing = null; drawRing();
    if (r.handle) { r.handle.reject(); return; }
    BD.api('/api/phone/call', { method: 'PATCH', body: { id: r.id, status: r.voicemail ? 'voicemail' : 'missed', duration: r.voicemail ? 18 : 0 } }).then(function () { BD.refreshInboxCount(); if (BD.route.name === 'inbox') BD.render({ keepScroll: true }); }, function () {});
  }
  function incomingTwilio(call) {
    var from = call.parameters && call.parameters.From;
    BD.api('/api/leads?limit=1&f=' + encodeURIComponent(JSON.stringify({ q: from }))).then(function (r) {
      var l = r.leads[0];
      ringing = { id: null, leadId: l && l.id, name: l && l.name, to: from, handle: call };
      call.on('cancel', function () { ringing = null; drawRing(); });
      drawRing();
    });
  }

  // After sending a text, look for the reply a little sooner than the usual 4 seconds.
  P.pollSoon = function () { [1500, 3000, 5000, 8000].forEach(function (ms) { setTimeout(poll, ms); }); };
  function init() {
    clearInterval(P._poll);
    P._poll = setInterval(poll, 4000);
    poll();
    if (BD.state.me.phone.provider === 'twilio') P.drivers.twilio.ready().catch(function () {});
  }
  window.addEventListener('beforeunload', function (e) { if (C && C.state !== 'wrap') { e.preventDefault(); e.returnValue = ''; } });
})();
