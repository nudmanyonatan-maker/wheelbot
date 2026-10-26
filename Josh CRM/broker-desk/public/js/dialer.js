/* The dialer screen. Pick a saved list and how many lines to dial at once (1 is a power dialer:
 * one call at a time, back to back). Each round dials that many leads; the first person to pick up
 * is put through, the others hang up, voicemails get the recorded drop, and the next round starts
 * when the rep saves the call. The abandoned-call guard from the server caps the line count.
 *
 * On the demo line the legs are acted out here (about 1 in 5 picks up, 1 in 4 is voicemail). On
 * Twilio the server places the legs and reports back. */
(function () {
  'use strict';
  var BD = window.BD, esc = BD.esc, ICON = BD.ICON;
  var D = null; // { session, lines, legs: [...], live, wrap, paused, auto, guard, from, round }
  BD.dialer = { active: function () { return !!D && D.session.status !== 'done'; } };

  // ---------- start ----------
  BD.on('dialer-open', function () {
    var sel = BD.leadSelection ? BD.leadSelection() : { filter: {} }, listId = BD.route.query.list || null;
    var title = listId ? ((BD.lists().filter(function (l) { return l.id === listId; })[0] || {}).name || 'Dial session') : 'Leads';
    BD.api('/api/dialer').then(function (r) {
      var g = r.guard, mine = BD.state.me.mine, want = Math.min(mine.lines || 2, g.maxLines);
      BD.modal({ title: 'Start the dialer', sub: esc(title) + (sel.count ? ', up to ' + BD.plural(sel.count, 'lead') : '') + '. Leads on do-not-call or with no number are skipped, and anyone outside calling hours where they are is held for later.',
        body: '<div class="field"><span>Lines at once</span><div class="seg lines-seg" role="radiogroup">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<button type="button" role="radio" class="' + (n === want ? 'on' : '') + '" data-act="dl-lines-pick" data-v="' + n + '"' + (n > g.maxLines ? ' disabled data-tip="Held back to stay under the 5% abandoned-call limit"' : '') + '>' + n + '</button>';
        }).join('') + '</div><input type="hidden" name="lines" value="' + want + '"></div>' +
        '<p class="muted small" id="lines-help">' + linesHelp(want) + '</p>' +
        '<div class="guard"><div><b>Abandoned calls this month: ' + BD.pct(g.rate) + '</b><span>The limit is ' + Math.round(g.cap * 100) + '%. A call is abandoned when someone answers and no rep is free within 2 seconds. ' + (g.maxLines < 5 ? 'Lines are held at ' + g.maxLines + ' to stay under it.' : 'You have room.') + '</span></div>' + meter(g) + '</div>' +
        '<label class="checkline" style="margin-top:12px"><input type="checkbox" name="vm"' + (mine.voicemailDrop !== false ? ' checked' : '') + '> Leave my recorded voicemail when a machine answers</label>',
        submit: 'Start dialing', onSubmit: function (f) {
          var d = BD.formData(f), lines = +d.lines || 1;
          BD.saveMine({ voicemailDrop: !!d.vm });
          var body = { lines: lines, title: title, filter: sel.ids ? { ids: sel.ids } : (BD.leadFilter ? BD.leadFilter() : {}) };
          return BD.api('/api/dialer', { body: body }).then(function (r2) {
            var s = r2.session; D = { session: { id: s.id, title: s.title, status: 'active', total: s.total }, lines: s.lines, legs: [], live: null, wrap: null, paused: false, auto: true, guard: s.guard, round: 0, stats: { dialed: 0, connected: 0, voicemail: 0, noAnswer: 0, abandoned: 0, talk: 0 }, vm: !!d.vm, back: location.hash };
            if (s.capped) BD.toast('Lines set to ' + s.lines + ' to stay under the abandoned-call limit.');
            BD.go('#/dialer/' + s.id);
            if (BD.state.me.phone.provider === 'twilio') joinConference(s.id);
            setTimeout(next, 600);
          });
        } });
    }, BD.fail);
  });
  function linesHelp(n) { return n === 1 ? 'Power dialer: one call at a time, the next one the moment you finish.' : 'Calls ' + n + ' leads at once. The first one who answers comes through to you and the rest hang up. More lines, more conversations per hour, and a little more risk of an answered call with nobody free.'; }
  function meter(g) { var w = Math.min(100, g.cap ? g.rate / g.cap * 100 : 0); return '<div class="meter' + (w > 70 ? ' warn' : '') + '"><i style="width:' + w + '%"></i></div>'; }
  BD.on('dl-lines-pick', function (el) {
    var m = el.closest('.modal'); m.querySelectorAll('.lines-seg button').forEach(function (b) { b.classList.toggle('on', b === el); });
    m.querySelector('input[name=lines]').value = el.getAttribute('data-v'); m.querySelector('#lines-help').textContent = linesHelp(+el.getAttribute('data-v'));
  });

  // ---------- rounds ----------
  function next() {
    if (!D || D.paused || D.live || D.wrap || D.session.status === 'done') return;
    D.round++;
    BD.api('/api/dialer/' + D.session.id, { body: { action: 'next', lines: D.lines } }).then(function (r) {
      D.guard = r.guard; D.from = r.from; D.left = r.left;
      if (r.lines < D.lines) { D.lines = r.lines; BD.toast('Lines lowered to ' + r.lines + ' to stay under the abandoned-call limit.'); }
      if (!r.calls.length) { D.session.status = 'done'; draw(); return finish(); }
      D.legs = r.calls.map(function (c) { return { id: c.activityId, lead: c.lead, state: 'dialing', t0: Date.now() }; });
      D.stats.dialed += D.legs.length;
      draw();
      if (r.provider === 'twilio') pollLegs(); else D.legs.forEach(function (leg, i) { setTimeout(function () { dialLeg(leg); }, i * 180); });
    }, function (e) { BD.fail(e); D.paused = true; draw(); });
  }
  // One leg on the demo line: rings, then nobody, a machine, or a person.
  function dialLeg(leg) {
    var multi = D.lines > 1, c = leg.lead.custom || {};
    var r = Math.random(), plan = c.demoAnswer || (multi ? (r < 0.2 ? 'human' : r < 0.47 ? 'voicemail' : 'no-answer') : (r < 0.3 ? 'human' : r < 0.6 ? 'voicemail' : 'no-answer'));
    if (leg.lead.demoAnswer) plan = leg.lead.demoAnswer;
    setTimeout(function () { if (leg.state === 'dialing') { leg.state = 'ringing'; draw(); } }, 600);
    var ringFor = leg.lead.demoRing || (plan === 'no-answer' ? 7000 + Math.random() * 3000 : 2200 + Math.random() * 3200);
    leg.timer = setTimeout(function () {
      if (leg.state !== 'ringing' && leg.state !== 'dialing') return;
      if (plan === 'no-answer') return settle(leg, 'no-answer');
      if (plan === 'voicemail') { leg.state = 'machine'; draw(); return setTimeout(function () { settle(leg, 'voicemail'); }, D.vm ? 1800 : 400); }
      // A person answered. If the rep is free, they get the call; if not, this one is abandoned.
      if (!D.live && !D.wrap) connect(leg); else settle(leg, 'abandoned');
    }, ringFor);
  }
  // ---------- the real line ----------
  // The rep's browser sits in the session's conference; the server dials the legs and Twilio puts
  // the first live answer into the conference. Here we only follow along.
  function joinConference(id) {
    BD.phone.drivers.twilio.ready().then(function (dev) { return dev.connect({ params: { Conference: id } }); }).then(function (call) { if (D) D.conf = call; }, BD.fail);
  }
  function pollLegs() {
    clearInterval(D.poll);
    D.poll = setInterval(function () {
      if (!D || !D.legs.length) return clearInterval(D.poll);
      var open = D.legs.filter(function (l) { return !l.done; });
      if (!open.length) { clearInterval(D.poll); return; }
      BD.api('/api/dialer/' + D.session.id + '?legs=' + open.map(function (l) { return l.id; }).join(',')).then(function (r) {
        r.legs.forEach(function (x) {
          var leg = D.legs.filter(function (l) { return l.id === x.id; })[0]; if (!leg || leg.done) return;
          if (x.status === 'ringing' && leg.state === 'dialing') { leg.state = 'ringing'; draw(); }
          else if (x.status === 'answered' && x.answeredBy === 'human' && leg.state !== 'connected') { if (!D.live && !D.wrap) connect(leg); }
          else if (x.status === 'voicemail') settle(leg, 'voicemail');
          else if (x.status === 'abandoned') settle(leg, 'abandoned');
          else if (['no-answer', 'busy', 'failed', 'canceled'].indexOf(x.status) >= 0 || (x.status === 'completed' && leg.state !== 'connected')) settle(leg, 'no-answer');
        });
      }, function () {});
    }, 1000);
  }
  function settle(leg, result) {
    clearTimeout(leg.timer);
    if (leg.done) return; leg.done = true;
    leg.state = result === 'voicemail' && D.vm ? 'vm-dropped' : result;
    var k = { 'no-answer': 'noAnswer', voicemail: 'voicemail', abandoned: 'abandoned' }[result]; if (k) D.stats[k]++;
    BD.api('/api/dialer/' + D.session.id, { body: { action: 'result', activityId: leg.id, result: result, voicemailDropped: result === 'voicemail' && D.vm } }).catch(function () {});
    draw(); roundOver();
  }
  function connect(leg) {
    leg.state = 'connected'; D.live = { leg: leg, start: Date.now(), dur: 0 }; D.stats.connected++;
    // The other lines hang up now that someone is through.
    D.legs.forEach(function (o) { if (o !== leg && !o.done && (o.state === 'dialing' || o.state === 'ringing')) settle(o, 'no-answer'); });
    BD.api('/api/leads/' + leg.lead.id + '?read=0').then(function (r) { if (D && D.live && D.live.leg === leg) { D.live.full = r; draw(); } }, function () {});
    clearInterval(D.timer); D.timer = setInterval(function () { if (!D || !D.live) return; D.live.dur = Math.round((Date.now() - D.live.start) / 1000); var t = document.getElementById('dl-time'); if (t) t.textContent = BD.dur(D.live.dur); }, 500);
    draw();
  }
  function roundOver() {
    if (!D || D.live || D.wrap) return;
    if (D.legs.every(function (l) { return l.done; })) { draw(); if (D.auto && !D.paused) setTimeout(next, 900); }
  }
  BD.on('dl-hang', function () {
    if (!D || !D.live) return;
    clearInterval(D.timer);
    var lv = D.live; lv.dur = Math.round((Date.now() - lv.start) / 1000);
    D.wrap = { leg: lv.leg, dur: lv.dur, full: lv.full, outcome: lv.dur >= 15 ? 'Talked' : null, task: null, status: null }; D.live = null; D.stats.talk += lv.dur;
    draw();
  });
  BD.on('dl-outcome', function (el) { D.wrap.outcome = el.getAttribute('data-v'); draw(); var t = document.querySelector('.dl-wrap textarea'); if (t) t.focus(); });
  BD.on('dl-task', function (el) { var v = +el.getAttribute('data-v'); D.wrap.task = D.wrap.task === v ? null : v; draw(); });
  BD.on('dl-status', function (el) { BD.menu(el, BD.statuses().map(function (s) { return { v: s.id, label: s.label, sel: D.wrap.status === s.id }; }), function (v) { D.wrap.status = v; draw(); }); });
  BD.on('dl-note', function (el) { if (D && D.wrap) D.wrap.note = el.value; });
  BD.on('dl-save', function () {
    var w = D.wrap, note = w.note || (document.querySelector('.dl-wrap textarea') || {}).value || '';
    w.leg.done = true; D.wrap = null;
    var st = w.outcome === 'Not interested' ? 'not-interested' : w.outcome === 'Bad number' ? 'bad-number' : w.outcome === 'Send application' && !w.status ? 'app-sent' : w.status;
    BD.api('/api/dialer/' + D.session.id, { body: { action: 'result', activityId: w.leg.id, result: 'connected', duration: w.dur, outcome: w.outcome, note: note.trim(), leadStatus: st || (w.outcome === 'Talked' ? 'contacted' : null) } })
      .then(function () { if (w.outcome === 'Send application') BD.sendApplication(w.full ? w.full.lead : w.leg.lead); if (w.task) return BD.api('/api/tasks', { body: { leadId: w.leg.lead.id, dueAt: w.task, note: 'Follow up' } }); }).catch(BD.fail);
    draw();
    if (D.legs.every(function (l) { return l.done; }) && D.auto && !D.paused) setTimeout(next, 700); else roundOver();
  });
  BD.on('dl-pause', function () { if (!D) return; D.paused = !D.paused; draw(); if (!D.paused) roundOver(), (!D.legs.length || D.legs.every(function (l) { return l.done; })) && next(); });
  BD.on('dl-lines', function (el) {
    var n = +el.getAttribute('data-v');
    BD.api('/api/dialer/' + D.session.id, { body: { action: 'lines', lines: n } }).then(function (r) { D.lines = r.lines; D.guard = r.guard; BD.saveMine({ lines: n }); draw(); if (r.lines < n) BD.toast('Held at ' + r.lines + ' to stay under the abandoned-call limit.'); }, BD.fail);
  });
  BD.on('dl-end', function () {
    if (!D) return;
    if (D.live) return BD.toast('Hang up first.', { bad: true });
    D.paused = true; D.legs.forEach(function (l) { if (!l.done) settle(l, 'no-answer'); });
    finish();
  });
  function finish() {
    var s = D.stats, back = D.back || '#/leads';
    clearInterval(D.poll); if (D.conf) { try { D.conf.disconnect(); } catch (e) { /* gone */ } }
    BD.api('/api/dialer/' + D.session.id, { body: { action: 'end' } }).catch(function () {});
    BD.modal({ title: 'Dial session done', body: '<div class="sumgrid">' + [['Dialed', s.dialed], ['Conversations', s.connected], ['Voicemails', s.voicemail], ['No answer', s.noAnswer], ['Abandoned', s.abandoned], ['Talk time', BD.talkTime(s.talk)]].map(function (x) {
      return '<div><span>' + x[0] + '</span><b>' + (typeof x[1] === 'number' ? BD.num(x[1]) : x[1]) + '</b></div>'; }).join('') + '</div>', submit: 'Back to the list', cancel: 'Stay here',
      onSubmit: function () { D = null; BD.go(back); } });
    if (D) D.session.status = 'done';
    draw();
  }

  // ---------- screen ----------
  BD.views.dialer = {
    render: function (id) {
      if (!D || D.session.id !== id) return '<div class="page"><div class="empty-sec"><b>This dial session is over.</b><span>Start a new one from any list.</span><button class="btn primary" data-act="go" data-v="#/leads">Go to leads</button></div></div>';
      return screen();
    },
    // Leaving the dialer mid-round pauses it and hangs up the lines still ringing, so nobody
    // answers to silence. A call already in progress carries on.
    leave: function () {
      if (!D || D.live || D.paused) return;
      D.paused = true;
      var open = D.legs.filter(function (l) { return !l.done; });
      open.forEach(function (l) { settle(l, 'no-answer'); });
      if (open.length || !D.wrap) BD.toast('Dialer paused. Go back to it any time.');
    }
  };
  function draw() { if (BD.route.name === 'dialer' && D && BD.route.arg === D.session.id) { var keep = document.querySelector('.dl-wrap textarea'), v = keep ? keep.value : null; document.getElementById('main').innerHTML = screen(); if (v) { var t = document.querySelector('.dl-wrap textarea'); if (t) t.value = v; } } }
  function legCard(l) {
    var lab = { dialing: 'Dialing', ringing: 'Ringing', machine: D.vm ? 'Voicemail: leaving message' : 'Voicemail', 'vm-dropped': 'Voicemail left', voicemail: 'Voicemail, hung up', 'no-answer': 'No answer', abandoned: 'Answered, you were busy', connected: 'Connected' }[l.state] || l.state;
    var tone = l.state === 'connected' ? 'good' : l.state === 'abandoned' ? 'bad' : l.state === 'ringing' || l.state === 'dialing' ? 'live' : l.state === 'machine' ? 'warn' : '';
    return '<div class="leg ' + tone + '"><div class="lg-top"><span class="lg-dot"></span><span class="lg-st">' + esc(lab) + '</span></div><b class="trunc">' + esc(l.lead.name) + '</b><span class="muted trunc">' + esc([l.lead.contactName, l.lead.phone].filter(Boolean).join(', ')) + '</span></div>';
  }
  function screen() {
    var s = D.stats, g = D.guard || { rate: 0, cap: 0.05, maxLines: 5 };
    var head = '<div class="page-head"><div><h1>Dialer: ' + esc(D.session.title) + '</h1><p>' + (D.session.status === 'done' ? 'Session over.' : D.paused ? 'Paused.' : D.live ? 'On a call.' : D.wrap ? 'Save the call to keep going.' : 'Dialing ' + BD.plural(D.lines, 'line') + ' at a time.') + (D.left != null ? ' ' + BD.plural(D.left, 'lead') + ' left in the list.' : '') + '</p></div>' +
      '<div class="filters"><div class="seg" data-tip="Lines at once">' + [1, 2, 3, 4, 5].map(function (n) { return '<button class="' + (D.lines === n ? 'on' : '') + '" data-act="dl-lines" data-v="' + n + '"' + (n > g.maxLines ? ' disabled' : '') + '>' + n + '</button>'; }).join('') + '</div>' +
      '<button class="btn" data-act="dl-pause">' + (D.paused ? ICON.play + 'Resume' : ICON.pause + 'Pause') + '</button><button class="btn danger" data-act="dl-end">End session</button></div></div>';
    var stats = '<div class="dl-stats">' + [['Dialed', s.dialed], ['Conversations', s.connected], ['Voicemails', s.voicemail], ['No answer', s.noAnswer], ['Abandoned', s.abandoned], ['Talk time', BD.talkTime(s.talk)]].map(function (x) { return '<div><span>' + x[0] + '</span><b>' + (typeof x[1] === 'number' ? BD.num(x[1]) : x[1]) + '</b></div>'; }).join('') +
      '<div class="dl-guard" data-tip="Abandoned calls this month across the team. The limit is 5%."><span>Abandoned this month</span><b>' + BD.pct(g.rate) + '</b>' + meter(g) + '</div></div>';
    var legs = '<div class="legs" data-spec-id="dialer-lines">' + (D.legs.length ? D.legs.map(legCard).join('') : '<div class="leg">Starting...</div>') + '</div>';
    var center = '';
    if (D.live) center = liveCard(D.live.leg, D.live.full, false);
    else if (D.wrap) center = liveCard(D.wrap.leg, D.wrap.full, true);
    else center = '<div class="panel dl-idle"><div class="empty-sec"><b>' + (D.paused ? 'Paused' : 'Waiting for someone to pick up') + '</b><span>When a person answers, their file opens here and you are connected.</span></div></div>';
    return '<div class="page page-dialer">' + head + stats + legs + center + '</div>';
  }
  function liveCard(leg, full, wrap) {
    var l = full ? full.lead : leg.lead, acts = full ? full.activities.filter(function (a) { return a.id !== leg.id; }).slice(0, 3) : [];
    var info = '<div class="dl-lead"><div><h2>' + esc(l.name) + '</h2><div class="who"><span>' + esc(l.contactName || '') + '</span><span>' + esc(l.phone || '') + '</span><span>' + esc([l.city, l.province].filter(Boolean).join(', ')) + '</span>' + (l.industry ? '<span>' + esc(l.industry) + '</span>' : '') + BD.statusPill(l.status) + '</div></div>' +
      '<div class="kvrow"><div><span>Revenue</span><b>' + (l.monthlyRevenue ? BD.money(l.monthlyRevenue) + '/mo' : '–') + '</b></div><div><span>Wants</span><b>' + (l.requested ? BD.money(l.requested) : '–') + '</b></div><div><span>Calls before</span><b>' + Math.max(0, (l.calls || 1) - 1) + '</b></div></div></div>';
    var notes = l.notes ? '<div class="dl-notes"><b>Notes</b><span>' + esc(l.notes) + '</span></div>' : '';
    var hist = acts.length ? '<ul class="tl mini">' + acts.map(function (a) { return BD.activityLine ? BD.activityLine(a) : ''; }).join('') + '</ul>' : '';
    if (!wrap) return '<div class="panel dl-live" data-spec-id="dialer-connected"><div class="dl-bar"><span class="live-dot"></span><b>Connected</b><span id="dl-time">' + BD.dur(D.live.dur) + '</span><span class="sp"></span><a class="btn sm" href="#/lead/' + esc(l.id) + '" target="_blank" rel="noopener">Open file</a><button class="hang" data-act="dl-hang" aria-label="Hang up">' + ICON.hang + '</button></div>' + info + notes + hist + '</div>';
    var w = D.wrap;
    return '<div class="panel dl-live dl-wrap" data-spec-id="dialer-wrap"><div class="dl-bar"><b>Call ended</b><span>' + BD.dur(w.dur) + '</span></div>' + info +
      notes + '<div class="pad"><div class="chips">' + ['Talked', 'Call back later', 'Send application', 'Not interested', 'Bad number'].map(function (o) { return '<button class="chip' + (w.outcome === o ? ' on' : '') + '" data-act="dl-outcome" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div>' +
      '<textarea rows="3" placeholder="Notes from the call" data-input="dl-note">' + esc(w.note || '') + '</textarea><div class="cb-fu"><span>Follow up</span>' + BD.quickTimes().map(function (x) { return '<button class="chip' + (w.task === x[1] ? ' on' : '') + '" data-act="dl-task" data-v="' + x[1] + '">' + x[0] + '</button>'; }).join('') + '</div>' +
      '<div class="cb-f"><button class="btn sm ghost" data-act="dl-status">' + (w.status ? 'Status: ' + esc(BD.status(w.status).label) : 'Change status') + '</button><span class="sp"></span><button class="btn primary" data-act="dl-save">Save and keep dialing</button></div></div></div>';
  }
})();
