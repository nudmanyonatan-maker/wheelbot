/* Dashboard: how the floor is doing. Dials, conversations and talk time per rep and per day, the
 * funnel from lead to funded with commission, lenders, lead lists, phone-number health (a number
 * whose answer rate drops is probably being marked as spam), renewals coming due, and the dialer's
 * abandoned-call rate. Managers can look at anyone; reps see themselves. */
(function () {
  'use strict';
  var BD = window.BD, esc = BD.esc, ICON = BD.ICON;
  var DS = { days: 7, member: '' };
  BD.views.dash = { render: function () { return BD.api('/api/dash?days=' + DS.days + '&member=' + encodeURIComponent(DS.member)).then(page); } };
  function delta(cur, prev) {
    if (!prev && !cur) return '';
    if (!prev) return '<span class="up">new</span>';
    var p = Math.round((cur - prev) / prev * 100);
    return '<span class="' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '+' : '') + p + '%</span>';
  }
  function tile(label, value, sub, d) { return '<div class="tile"><span class="l">' + label + '</span><b>' + value + '</b><span class="s">' + (sub || '') + (d ? ' ' + d : '') + '</span></div>'; }
  function chart(series) {
    var W = 720, H = 180, pad = 26, n = series.length, max = Math.max(10, Math.max.apply(null, series.map(function (s) { return s.dials; })));
    var bw = Math.max(4, Math.min(38, (W - pad * 2) / n * 0.62)), step = (W - pad * 2) / n;
    var y = function (v) { return H - 22 - (v / max) * (H - 40); };
    var bars = series.map(function (s, i) {
      var x = pad + i * step + (step - bw) / 2, dh = H - 22 - y(s.dials), th = H - 22 - y(s.talks);
      var lab = n <= 14 ? new Date(s.at).toLocaleDateString('en-CA', n <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }) : i % Math.ceil(n / 10) === 0 ? new Date(s.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';
      return '<g><title>' + new Date(s.at).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) + ': ' + s.dials + ' dials, ' + s.talks + ' conversations</title>' +
        '<rect x="' + x + '" y="' + y(s.dials) + '" width="' + bw + '" height="' + Math.max(0, dh) + '" rx="3" class="b-dial"/>' +
        '<rect x="' + x + '" y="' + y(s.talks) + '" width="' + bw + '" height="' + Math.max(0, th) + '" rx="3" class="b-talk"/>' +
        (lab ? '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(lab) + '</text>' : '') + '</g>';
    }).join('');
    var grid = [0.5, 1].map(function (f) { var v = Math.round(max * f); return '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (pad - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Dials and conversations per day">' + grid + bars + '</svg>';
  }
  function page(r) {
    var t = r.totals, f = r.funnel, mgr = BD.isMgr(), g = r.guard;
    var head = '<div class="page-head"><div><h1>Dashboard</h1><p>' + (r.member ? esc(BD.pname(r.member)) : mgr ? 'The whole team' : 'You') + ', ' + ({ 1: 'today', 7: 'the last 7 days', 30: 'the last 30 days', 90: 'the last 90 days' }[r.days]) + '.</p></div>' +
      '<div class="filters">' + (mgr ? '<select class="ms" data-change="dash-member" aria-label="Who"><option value="">Everyone</option>' + BD.state.me.team.filter(function (p) { return p.active; }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (DS.member === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' : '') +
      '<div class="seg">' + [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']].map(function (x) { return '<button class="' + (DS.days === x[0] ? 'on' : '') + '" data-act="dash-days" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div></div>';
    var tiles = '<div class="tiles" data-spec-id="dash-tiles">' + tile('Dials', BD.num(t.dials), 'vs before', delta(t.dials, r.prev.dials)) + tile('Conversations', BD.num(t.talks), BD.pct(t.dials ? t.talks / t.dials : 0) + ' of dials', delta(t.talks, r.prev.talks)) +
      tile('Talk time', BD.talkTime(t.talk), t.talks ? 'about ' + BD.dur(Math.round(t.talk / Math.max(1, t.talks))) + ' each' : '') + tile('Texts sent', BD.num(t.texts), '', delta(t.texts, r.prev.texts)) + tile('Emails sent', BD.num(t.emails), '', delta(t.emails, r.prev.emails)) +
      tile('Funded', BD.money(f.volume), BD.plural(f.funded, 'deal') + ', ' + BD.money(f.commission) + ' commission') + '</div>';
    var act = '<div class="panel dsec wide"><div class="panel-head"><h2>Calls per day</h2><span class="legend"><i class="b-dial"></i>Dials <i class="b-talk"></i>Conversations</span></div><div class="pad">' + chart(r.series) + '</div></div>';
    var reps = '<div class="panel dsec wide"><div class="panel-head"><h2>Reps</h2></div><div class="thead reprow"><span>Rep</span><span class="right">Dials</span><span class="right">Conversations</span><span class="right">Rate</span><span class="right">Talk time</span><span class="right">Texts</span><span class="right">Emails</span></div><div class="rows">' +
      (r.reps.length ? r.reps.map(function (p, i) { return '<div class="row reprow"><span class="main"><span class="av sm">' + esc(BD.initials(p.name)) + '</span> <b>' + esc(p.name) + '</b>' + (i === 0 && r.reps.length > 1 && p.dials ? ' <span class="pill good">Top</span>' : '') + '</span><span class="right num">' + BD.num(p.dials) + '</span><span class="right num">' + BD.num(p.talks) + '</span><span class="right num">' + BD.pct(p.rate) + '</span><span class="right num">' + BD.talkTime(p.talk) + '</span><span class="right num">' + BD.num(p.texts) + '</span><span class="right num">' + BD.num(p.emails) + '</span></div>'; }).join('') : '<div class="empty-line">No calls yet in this period.</div>') + '</div></div>';
    var steps = [['Leads added', f.leads], ['Contacted', f.contacted], ['Applications', f.apps], ['Sent to lenders', f.submitted], ['Approved', f.approved], ['Funded', f.funded]], top = Math.max(1, steps[0][1], steps[2][1]);
    var funnel = '<div class="panel dsec"><div class="panel-head"><h2>From lead to funded</h2><span class="muted small">' + (f.owed ? BD.money(f.owed) + ' commission still owed' : '') + '</span></div><div class="funnel2">' + steps.map(function (s, i) {
      var prev = i ? steps[i - 1][1] : null;
      return '<div class="fs"><span class="l">' + s[0] + '</span><div class="fbar"><i style="width:' + Math.max(1.5, s[1] / top * 100) + '%"></i></div><b>' + BD.num(s[1]) + '</b><span class="muted small">' + (prev ? BD.pct(prev ? s[1] / prev : 0) : '') + '</span></div>';
    }).join('') + '</div></div>';
    var lenders = '<div class="panel dsec"><div class="panel-head"><h2>Lenders</h2><span class="muted small">All files on record</span></div><div class="thead lrow2"><span>Lender</span><span class="right">Files</span><span class="right">Approved</span><span class="right">Answers in</span><span class="right">Funded</span></div><div class="rows">' +
      (r.lenders.length ? r.lenders.slice(0, 8).map(function (l) { return '<div class="row lrow2"><span class="main"><b>' + esc(l.name) + '</b></span><span class="right num">' + l.sent + '</span><span class="right num">' + (l.rate == null ? '–' : BD.pct(l.rate)) + '</span><span class="right num">' + (l.hours == null ? '–' : l.hours < 48 ? Math.round(l.hours) + 'h' : Math.round(l.hours / 24) + 'd') + '</span><span class="right money-sm">' + BD.moneyK(l.volume) + '</span></div>'; }).join('') : '<div class="empty-line">No files sent yet.</div>') + '</div></div>';
    var nums = '<div class="panel dsec"><div class="panel-head"><h2>Phone numbers</h2><span class="muted small">Answer rate by the number you called from</span></div><div class="rows">' +
      (r.numbers.length ? r.numbers.map(function (n) { return '<div class="row numrow' + (n.flag ? ' flag' : '') + '"><span class="main"><b>' + esc(BD.fmtPhone(n.number)) + '</b>' + (n.member ? ' <span class="muted">' + esc(BD.first(BD.pname(n.member))) + '</span>' : '') + (n.flag ? '<div class="sub bad">' + esc(n.flag) + '</div>' : '') + '</span><span class="right num">' + BD.num(n.calls) + ' calls</span><span class="right num ' + (n.flag ? 'bad' : '') + '">' + BD.pct(n.rate) + ' answered</span></div>'; }).join('') : '<div class="empty-line">No calls yet.</div>') + '</div></div>';
    var lists = '<div class="panel dsec"><div class="panel-head"><h2>Lead lists</h2></div><div class="thead lrow2"><span>List</span><span class="right">Leads</span><span class="right">Contacted</span><span class="right">Applied</span><span class="right">Funded</span></div><div class="rows">' +
      (r.lists.length ? r.lists.map(function (l) { return '<div class="row lrow2"><span class="main"><b class="trunc">' + esc(l.list) + '</b></span><span class="right num">' + BD.num(l.leads) + '</span><span class="right num">' + BD.pct(l.leads ? l.contacted / l.leads : 0) + '</span><span class="right num">' + BD.num(l.apps) + '</span><span class="right num">' + BD.num(l.funded) + '</span></div>'; }).join('') : '<div class="empty-line">Import a list to see how it converts.</div>') + '</div></div>';
    var ren = '<div class="panel dsec"><div class="panel-head"><h2>Renewals coming up</h2></div><div class="rows">' + (r.renewals.length ? r.renewals.map(function (x) {
      return '<a class="row renrow" href="#/deal/' + esc(x.id) + '"><span class="main"><b>' + esc(x.business) + '</b><div class="sub">' + BD.money(x.amount) + ' funded</div></span><span class="bar' + (x.ready ? ' good' : '') + '"><i style="width:' + Math.max(3, x.pct * 100) + '%"></i><span class="half"></span></span><span class="right">' + (x.ready ? '<span class="pill good">Ready now</span>' : esc(BD.fmtDay(x.halfAt))) + '</span></a>';
    }).join('') : '<div class="empty-line">No funded deals yet.</div>') + '</div></div>';
    var guard = '<div class="panel dsec"><div class="panel-head"><h2>Dialer: abandoned calls this month</h2></div><div class="pad"><div class="guard big"><div><b>' + BD.pct(g.rate) + '</b><span>' + BD.num(g.abandoned) + ' of ' + BD.num(g.placed) + ' multi-line calls. The CRTC limit is ' + Math.round(g.cap * 100) + '%. ' + (g.maxLines < 5 ? 'The dialer is holding lines at ' + g.maxLines + ' to stay under it.' : 'Plenty of room.') + '</span></div><div class="meter' + (g.rate / g.cap > 0.7 ? ' warn' : '') + '"><i style="width:' + Math.min(100, g.rate / g.cap * 100) + '%"></i></div></div></div></div>';
    return '<div class="page page-dash">' + head + tiles + '<div class="dgrid">' + act + reps + funnel + lenders + nums + guard + lists + ren + '</div></div>';
  }
  BD.on('dash-days', function (el) { DS.days = +el.getAttribute('data-v'); BD.render({ keepScroll: true }); });
  BD.on('dash-member', function (el) { DS.member = el.value; BD.render({ keepScroll: true }); });
})();
