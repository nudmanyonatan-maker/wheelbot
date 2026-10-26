/* Sequences and bulk email. A sequence is a few steps (email, text or task) spaced out in days.
 * Leads join from a list; a reply, an unsubscribe or a STOP takes them out. Bulk email sends one
 * message to a list, spread out, from each rep's own mailbox. Both only reach leads with CASL
 * consent on file, and every email carries the sender's details and an unsubscribe link. */
(function () {
  'use strict';
  var BD = window.BD, esc = BD.esc, ICON = BD.ICON;
  var Q = { list: [] };
  BD.views.sequences = { render: function () { return BD.api('/api/sequences').then(function (r) { Q.list = r.sequences; return page(); }); } };
  function stepLine(s) { return (s.wait ? 'Day ' + s.wait : 'Right away') + ': ' + (s.kind === 'email' ? 'email "' + (s.subject || '') + '"' : s.kind === 'sms' ? 'text' : 'task'); }
  function page() {
    var seqs = Q.list.filter(function (s) { return !s.oneOff; }), bulks = Q.list.filter(function (s) { return s.oneOff; });
    var head = '<div class="page-head"><div><h1>Sequences</h1><p>Follow-ups that send themselves. Anyone who replies, unsubscribes or texts STOP comes out right away.</p></div><div class="filters"><button class="btn primary" data-act="seq-edit">' + ICON.plus + 'New sequence</button></div></div>';
    var card = function (s) {
      var c = s.counts || {};
      return '<div class="panel seqcard"><div class="sq-h"><div><h3>' + esc(s.name) + (s.active ? '' : ' <span class="pill">Paused</span>') + '</h3><p class="muted small">' + BD.plural(s.steps.length, 'step') + '</p></div>' +
        '<div class="acts"><button class="btn sm" data-act="seq-enroll" data-v="' + esc(s.id) + '">' + ICON.leads + 'Add leads</button><button class="btn sm ghost" data-act="seq-edit" data-v="' + esc(s.id) + '">Edit</button></div></div>' +
        '<ol class="steps-list">' + s.steps.map(function (st) { return '<li><span class="ic ' + (st.kind === 'email' ? 'mail' : st.kind === 'sms' ? 'text' : '') + '">' + (st.kind === 'email' ? ICON.mail : st.kind === 'sms' ? ICON.msg : ICON.task) + '</span>' + esc(stepLine(st)) + '</li>'; }).join('') + '</ol>' +
        '<div class="sq-stats">' + [['In it now', c.active], ['Replied', c.replied], ['Finished', c.done], ['Stopped', (c.stopped || 0) + (c.unsubscribed || 0)]].map(function (x) { return '<div><b>' + BD.num(x[1] || 0) + '</b><span>' + x[0] + '</span></div>'; }).join('') + '</div></div>';
    };
    return '<div class="page page-seq">' + head + '<div class="seqgrid">' + (seqs.length ? seqs.map(card).join('') : '<div class="panel"><div class="empty-sec"><b>No sequences yet.</b><span>A good first one: an intro email, a text two days later, a call task on day four.</span></div></div>') + '</div>' +
      (bulks.length ? '<h2 class="h2">Bulk emails</h2><div class="panel"><div class="rows">' + bulks.slice(0, 12).map(function (s) { var c = s.counts || {}; return '<div class="row brow"><div class="main"><b>' + esc(s.name.replace(/^Bulk email: /, '')) + '</b><div class="sub">' + BD.fmtDay(s.createdAt) + '</div></div><div class="muted small">' + BD.num((c.done || 0) + (c.replied || 0)) + ' sent, ' + BD.num(c.active || 0) + ' going out, ' + BD.num(c.replied || 0) + ' replied</div></div>'; }).join('') + '</div></div>' : '') + '</div>';
  }
  BD.on('seq-edit', function (el) {
    var id = el.getAttribute('data-v'), s = Q.list.filter(function (x) { return x.id === id; })[0] || { name: '', active: true, steps: [{ wait: 0, kind: 'email', subject: 'Working capital for {business}', body: '' }, { wait: 2, kind: 'sms', body: '' }, { wait: 4, kind: 'task', body: 'Call {first}' }] };
    var steps = JSON.parse(JSON.stringify(s.steps));
    var draw = function (m) {
      m.querySelector('#seq-steps').innerHTML = steps.map(function (st, i) {
        return '<div class="seqstep"><div class="ss-h"><span class="n">' + (i + 1) + '</span><select data-i="' + i + '" data-k="kind"><option value="email"' + (st.kind === 'email' ? ' selected' : '') + '>Email</option><option value="sms"' + (st.kind === 'sms' ? ' selected' : '') + '>Text</option><option value="task"' + (st.kind === 'task' ? ' selected' : '') + '>Task for the rep</option></select>' +
          '<label class="inl">after <input type="number" min="0" max="90" data-i="' + i + '" data-k="wait" value="' + st.wait + '"> days</label><span class="sp"></span><button type="button" class="link danger" data-act="seq-step-rm" data-v="' + i + '">Remove</button></div>' +
          (st.kind === 'email' ? '<input data-i="' + i + '" data-k="subject" placeholder="Subject" value="' + esc(st.subject || '') + '">' : '') +
          '<textarea rows="' + (st.kind === 'email' ? 4 : 2) + '" data-i="' + i + '" data-k="body" placeholder="' + (st.kind === 'task' ? 'What should the rep do?' : 'Message. Use {first}, {business}, {rep}, {company}, {apply}') + '">' + esc(st.body || '') + '</textarea></div>';
      }).join('');
    };
    var m = BD.modal({ title: id ? 'Edit sequence' : 'New sequence', wide: true, body: '<label class="field"><span>Name</span><input name="name" value="' + esc(s.name) + '" placeholder="New lead follow-up"></label><div id="seq-steps"></div><button type="button" class="btn sm" data-act="seq-step-add">' + ICON.plus + 'Add a step</button>' +
      '<label class="checkline" style="margin-top:12px"><input type="checkbox" name="active"' + (s.active ? ' checked' : '') + '> On</label><p class="muted small">Emails and texts only go to leads with consent on file (CASL). Each email gets your company details and an unsubscribe link at the bottom.</p>',
      left: id && BD.isMgr() ? '<button type="button" class="link danger" data-act="seq-del" data-v="' + esc(id) + '">Delete</button>' : '',
      submit: 'Save sequence', onSubmit: function (f) {
        var v = BD.formData(f);
        return BD.api('/api/sequences', { body: { action: 'save', id: id || null, name: v.name, active: v.active, steps: steps } }).then(function () { BD.toast('Sequence saved'); BD.render(); });
      }, mount: function (mm) {
        mm.addEventListener('input', function (e) { var i = e.target.getAttribute('data-i'); if (i == null) return; var k = e.target.getAttribute('data-k'); steps[+i][k] = k === 'wait' ? +e.target.value : e.target.value; });
        mm.addEventListener('change', function (e) { if (e.target.getAttribute('data-k') === 'kind') { steps[+e.target.getAttribute('data-i')].kind = e.target.value; draw(mm); } });
      } });
    m._steps = steps; m._draw = function () { draw(m); };
    draw(m);
  });
  BD.on('seq-step-add', function (el) { var m = el.closest('.modal'); m._steps.push({ wait: (m._steps[m._steps.length - 1] || { wait: 0 }).wait + 2, kind: 'email', subject: '', body: '' }); m._draw(); });
  BD.on('seq-step-rm', function (el) { var m = el.closest('.modal'); m._steps.splice(+el.getAttribute('data-v'), 1); m._draw(); });
  BD.on('seq-del', function (el) { BD.api('/api/sequences', { body: { action: 'delete', id: el.getAttribute('data-v') } }).then(function () { BD.closeModal(); BD.toast('Deleted'); BD.render(); }, BD.fail); });
  BD.on('seq-enroll', function (el) {
    var id = el.getAttribute('data-v'), s = Q.list.filter(function (x) { return x.id === id; })[0];
    BD.modal({ title: 'Add leads to "' + s.name + '"', body: '<label class="field"><span>From the list</span><select name="list">' + BD.lists().map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.name) + '</option>'; }).join('') + '</select></label><p class="muted small">Leads already in it are skipped. Leads without consent, without an email, or on do-not-call are skipped when their step comes up.</p>',
      submit: 'Add them', onSubmit: function (f) { return BD.api('/api/sequences', { body: { action: 'enroll', id: id, listId: BD.formData(f).list } }).then(function (r) { BD.toast(BD.plural(r.enrolled, 'lead') + ' added'); BD.render(); }); } });
  });
  // From the Leads screen or a lead: pick a sequence for the selection.
  BD.enrollPicker = function (sel, then) {
    BD.api('/api/sequences').then(function (r) {
      var seqs = r.sequences.filter(function (s) { return !s.oneOff && s.active; });
      if (!seqs.length) return BD.toast('Make a sequence first.', { action: { label: 'Sequences', fn: function () { BD.go('#/sequences'); } } });
      BD.modal({ title: 'Add ' + BD.plural(sel.count, 'lead') + ' to a sequence', body: '<div class="reasons">' + seqs.map(function (s, i) { return '<label class="' + (i ? '' : 'on') + '"><input type="radio" name="seq" value="' + esc(s.id) + '"' + (i ? '' : ' checked') + '><span><b>' + esc(s.name) + '</b><br><span class="muted small">' + esc(s.steps.map(stepLine).join(', then ')) + '</span></span></label>'; }).join('') + '</div>',
        submit: 'Add', onSubmit: function (f) { return BD.api('/api/sequences', { body: { action: 'enroll', id: BD.formData(f).seq, ids: sel.ids, filter: sel.ids ? undefined : sel.filter } }).then(function (x) { BD.toast(BD.plural(x.enrolled, 'lead') + ' added' + (x.skipped ? ', ' + x.skipped + ' already in it' : '')); if (then) then(); }); } });
    }, BD.fail);
  };
  BD.on('bulk-seq', function () { BD.enrollPicker(BD.leadSelection()); });
  BD.on('bulk-email', function () {
    var sel = BD.leadSelection(), me = BD.state.me;
    if (!me.mail.box) return BD.toast('Connect your mailbox first.', { action: { label: 'Connect', fn: function () { BD.go('#/settings/email'); } } });
    var filter = sel.ids ? { ids: sel.ids } : sel.filter;
    BD.api('/api/leads?limit=1&f=' + encodeURIComponent(JSON.stringify(Object.assign({}, filter, { consent: 'ok', hasEmail: true })))).then(function (ok) {
      BD.modal({ title: 'Email ' + BD.plural(sel.count, 'lead'), wide: true, sub: '<b>' + BD.num(ok.total) + '</b> of them have an email and consent on file, so they will get it. Sent from ' + esc(me.mail.box.address) + ', a few seconds apart, within your daily limit.',
        body: '<div class="comp-row"><select data-change="bulk-tpl" aria-label="Template"><option value="">Start from a template</option>' + me.settings.templates.email.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
          '<label class="field"><span>Subject</span><input name="subject" required></label><label class="field" style="margin-top:10px"><span>Message</span><textarea name="body" rows="9" placeholder="Use {first}, {business}, {rep}, {company}, {apply}"></textarea></label>' +
          '<p class="muted small">Your company name, address and an unsubscribe link are added at the bottom, as CASL requires. Anyone who replies is taken off any follow-ups.</p>',
        submit: 'Send to ' + BD.num(ok.total), onSubmit: function (f) {
          var v = BD.formData(f); if (!v.subject.trim() || !v.body.trim()) throw new Error('Write a subject and a message.');
          if (!ok.total) throw new Error('Nobody here has consent on file and an email.');
          return BD.api('/api/sequences', { body: { action: 'bulk', subject: v.subject, body: v.body, ids: sel.ids, filter: sel.ids ? undefined : sel.filter } }).then(function (r) { BD.toast('Sending to ' + BD.plural(r.enrolled, 'lead') + '. It goes out over the next few minutes.', { long: true }); });
        } });
    }, BD.fail);
  });
  BD.on('bulk-tpl', function (el) {
    var t = BD.state.me.settings.templates.email.filter(function (x) { return x.id === el.value; })[0], m = el.closest('.modal'); if (!t) return;
    m.querySelector('input[name=subject]').value = t.subject; m.querySelector('textarea[name=body]').value = t.body;
  });
})();
