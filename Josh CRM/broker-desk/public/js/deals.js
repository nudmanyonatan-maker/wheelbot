/* Deals: the board (one column per stage) and the deal page. A deal moves from application, to
 * statements, to lenders, to offers, to contracts, to funded. The deal page shows what to do next,
 * the file checklist, which lenders fit and why, every submission and offer, closing, funding, the
 * commission owed, and when the business can renew. */
(function () {
  'use strict';
  var BD = window.BD, S = BD.S, esc = BD.esc, ICON = BD.ICON;
  var B = { d: null, owner: '', q: '' }, DP = { id: null, d: null };
  var OPEN = ['app', 'statements', 'submitted', 'offers', 'contracts'];
  function lenderName(id, lenders) { var l = (lenders || []).filter(function (x) { return x.id === id; })[0]; return l ? l.name : 'Lender'; }
  function stageLabel(s) { return S.STAGES[S.STAGE_INDEX[s]].label; }
  function days(t) { return Math.max(0, BD.daysAgo(t)); }

  // ---------- board ----------
  BD.views.deals = { render: function () { return BD.api('/api/deals' + (B.owner ? '?owner=' + B.owner : '')).then(function (r) { B.d = r; return board(); }); } };
  function board() {
    var deals = B.d.deals.filter(function (d) { return !B.q || d.business.toLowerCase().indexOf(B.q.toLowerCase()) >= 0; });
    var month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    var funded = deals.filter(function (d) { return d.stage === 'funded' && d.fundedAt >= month.getTime(); });
    var owed = deals.filter(function (d) { return d.stage === 'funded' && !d.commissionPaidAt && d.commission; });
    var head = '<div class="page-head"><div><h1>Deals</h1><p>' + BD.plural(deals.filter(function (d) { return OPEN.indexOf(d.stage) >= 0; }).length, 'open file') +
      '. Funded this month: <b>' + BD.money(funded.reduce(function (t, d) { return t + (d.fundedAmount || 0); }, 0)) + '</b> across ' + BD.plural(funded.length, 'deal') +
      '. Commission still owed: <b>' + BD.money(owed.reduce(function (t, d) { return t + d.commission; }, 0)) + '</b>.</p></div>' +
      '<div class="filters"><input class="inline-search" placeholder="Find a business" value="' + esc(B.q) + '" data-input="deals-q">' +
      (BD.isMgr() ? '<div class="seg"><button class="' + (!B.owner ? 'on' : '') + '" data-act="deals-owner" data-v="">Everyone</button><button class="' + (B.owner === 'me' ? 'on' : '') + '" data-act="deals-owner" data-v="me">Mine</button></div>' : '') + '</div></div>';
    var cols = S.STAGES.map(function (st) {
      var list = deals.filter(function (d) { return d.stage === st.id; });
      if (st.id === 'funded') list = list.filter(function (d) { return days(d.fundedAt) <= 120; });
      if (st.id === 'dead') list = list.filter(function (d) { return days(d.stageAt) <= 30; });
      var sum = list.reduce(function (t, d) { return t + (d.fundedAmount || d.requested || 0); }, 0);
      return '<div class="col' + (st.id === 'dead' ? ' dead' : '') + '" data-stage="' + st.id + '"><div class="col-head"><div class="t">' + esc(st.label) + '<span>' + list.length + '</span></div><div class="sum">' + (sum ? BD.money(sum) : '&nbsp;') + '</div></div>' +
        '<div class="col-body">' + (list.length ? list.map(function (d) { return card(d); }).join('') : '<div class="col-empty">Nothing here</div>') + '</div></div>';
    }).join('');
    return '<div class="page page-deals">' + head + '<div class="board">' + cols + '</div></div>';
  }
  function card(d) {
    var subs = d.submissions || [], appr = subs.filter(function (s) { return s.status === 'approved'; }).length, dec = subs.filter(function (s) { return s.status === 'declined'; }).length;
    var flag = d.stage === 'statements' ? '<span class="flag warn">' + (S.PAPERWORK.filter(function (p) { return p.statement && !p.optional && !d.paperwork[p.id]; }).length) + ' statements missing</span>'
      : d.stage === 'submitted' ? '<span class="flag">' + subs.length + ' lenders, ' + (subs.length - appr - dec) + ' waiting</span>'
      : d.stage === 'offers' ? '<span class="flag good">' + appr + ' approved</span>'
      : d.stage === 'contracts' ? '<span class="flag">' + (S.CLOSING.filter(function (c) { return !d.closing[c.id]; }).length || 'Ready to fund') + (S.CLOSING.filter(function (c) { return !d.closing[c.id]; }).length ? ' left to fund' : '') + '</span>'
      : d.stage === 'funded' ? '<span class="flag">' + (d.commissionPaidAt ? 'Commission in' : 'Commission ' + BD.moneyK(d.commission || 0) + ' owed') + '</span>'
      : d.stage === 'dead' ? '<span class="flag">' + esc(d.closed ? d.closed.reason : '') + '</span>' : '<span class="flag">File complete</span>';
    var age = days(d.stageAt), stale = OPEN.indexOf(d.stage) >= 0 && age >= 3;
    return '<a class="card" href="#/deal/' + esc(d.id) + '"><div class="biz">' + esc(d.business) + '</div><div class="owner">' + esc(BD.pname(d.owner)) + (d.renewalOf ? ' <span class="pill accent">Renewal</span>' : '') + '</div>' +
      '<div class="amt"><span class="money">' + (d.fundedAmount ? BD.money(d.fundedAmount) : d.requested ? BD.money(d.requested) : '–') + '</span></div><div class="foot">' + flag + (OPEN.indexOf(d.stage) >= 0 ? '<span class="age' + (stale ? ' stale' : '') + '">' + (age ? age + 'd' : 'today') + '</span>' : '') + '</div></a>';
  }
  BD.on('deals-owner', function (el) { B.owner = el.getAttribute('data-v'); BD.render(); });
  BD.on('deals-q', BD.debounce(function (el) { B.q = el.value; document.getElementById('main').innerHTML = board(); var i = document.querySelector('.inline-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200));

  // ---------- deal page ----------
  function loadDeal(id) { return BD.api('/api/deals/' + encodeURIComponent(id)).then(function (r) { DP.id = id; DP.d = r; return r; }); }
  BD.views.deal = { render: function (id) { return loadDeal(id).then(dealPage); } };
  function act(body, msg) { return BD.api('/api/deals/' + DP.id, { body: body }).then(function () { if (msg) BD.toast(msg); return loadDeal(DP.id); }).then(function () { document.getElementById('main').innerHTML = dealPage(); }, BD.fail); }
  BD.dealAct = act;
  function dealPage() {
    var r = DP.d, d = r.deal, l = r.lead || {}, cur = S.STAGE_INDEX[d.stage];
    var head = '<div class="lp-head"><a class="backlink" href="#/deals">' + ICON.back + 'Deals</a><div class="lp-top"><div class="lp-title"><h1>' + esc(d.business) + (d.renewalOf ? ' <span class="pill accent">Renewal</span>' : '') + '</h1><div class="who">' +
      '<span class="pill ' + (d.stage === 'funded' ? 'good' : d.stage === 'dead' ? 'bad' : 'accent') + '">' + esc(stageLabel(d.stage)) + '</span>' + (l.contactName ? '<span>' + esc(l.contactName) + '</span>' : '') +
      '<span>Wants ' + (d.requested ? BD.money(d.requested) : 'an amount not set') + '</span><span>' + esc(BD.pname(d.owner)) + '</span><a class="link" href="#/lead/' + esc(d.leadId) + '">Open the lead</a></div></div>' +
      '<div class="d-actions">' + (l.phone ? '<button class="btn" data-act="deal-call">' + ICON.phone + 'Call</button>' : '') + '<button class="btn" data-act="deal-edit">Edit</button>' +
      (d.stage === 'dead' ? '<button class="btn" data-act="deal-reopen">Reopen</button>' : d.stage !== 'funded' ? '<button class="btn ghost" data-act="deal-close">Close</button>' : '') + '</div></div>' +
      '<div class="track">' + S.STAGES.filter(function (s) { return s.id !== 'dead'; }).map(function (s, i) { return '<span class="' + (d.stage === 'dead' ? '' : i < cur ? 'done' : i === cur ? 'cur' : '') + '"><span>' + esc(s.label) + '</span></span>'; }).join('') + '</div></div>';
    var body = nextStep(r) + facts(d) + '<div class="dp">' + '<div>' + lendersSec(r) + (d.accepted || d.stage === 'contracts' || d.stage === 'funded' ? closingSec(d) : '') + (d.stage === 'funded' ? fundedSec(r) : '') + '</div>' +
      '<div>' + fileSec(r) + actSec(r) + '</div></div>';
    return '<div class="page page-deal">' + head + body + '</div>';
  }
  function facts(d) {
    var m = d.merchant || {};
    var f = function (k, v) { return '<div class="fact"><div class="l">' + k + '</div><div class="v">' + (v == null || v === '' ? '<span class="muted">–</span>' : esc(v)) + '</div></div>'; };
    return '<div class="facts">' + f('Monthly revenue', m.monthlyRevenue ? BD.money(m.monthlyRevenue) : '') + f('Trading for', m.months ? m.months + ' months' : '') + f('Credit score', m.score) +
      f('Other funders', m.positions == null ? '' : m.positions) + f('Industry', m.industry) + f('Province', m.province) + '</div>';
  }
  function nextStep(r) {
    var d = r.deal, subs = d.submissions, t = '', sub = '', btn = '', tone = '';
    var missing = S.PAPERWORK.filter(function (p) { return !p.optional && !d.paperwork[p.id]; }), stm = missing.filter(function (p) { return p.statement; });
    if (d.stage === 'dead') { t = (d.closed && d.closed.kind === 'declined' ? 'Declined: ' : 'Lost: ') + (d.closed ? d.closed.reason : ''); sub = (d.closed && d.closed.note) || 'Reopen it if they come back.'; tone = 'bad'; }
    else if (d.stage === 'statements' || (d.stage === 'app' && stm.length)) { t = 'Waiting on ' + BD.plural(stm.length, 'bank statement') + '.'; sub = 'Lenders will not look at the file without the last 3 months.'; btn = '<button class="btn primary" data-act="deal-ask-statements">' + ICON.msg + 'Text them for statements</button>'; tone = 'warn'; }
    else if (d.stage === 'app') { t = 'The file is complete.'; sub = 'Send it to the lenders that fit.'; btn = '<button class="btn primary" data-act="deal-submit">' + ICON.send2 + 'Send to lenders</button>'; }
    else if (d.stage === 'submitted') { var w = subs.filter(function (s) { return s.status === 'sent'; }).length; t = 'With ' + BD.plural(subs.length, 'lender') + '. ' + (w ? w + ' still deciding.' : 'Everyone has answered.'); sub = 'Record each answer as it comes in.'; btn = '<button class="btn" data-act="deal-submit">Send to more lenders</button>'; }
    else if (d.stage === 'offers') { var o = []; subs.forEach(function (s) { (s.offers || []).forEach(function (x) { o.push(x); }); }); var best = o.sort(function (a, b) { return b.amount - a.amount; })[0];
      t = BD.plural(o.length, 'offer') + ' in' + (best ? ', best ' + BD.money(best.amount) : '') + '.'; sub = 'Go over them with the business, then mark the one they take.'; tone = 'good'; }
    else if (d.stage === 'contracts') { var left = S.CLOSING.filter(function (c) { return !d.closing[c.id]; }); t = left.length ? BD.plural(left.length, 'thing') + ' left before it funds.' : 'Everything is in.'; sub = left.length ? left.map(function (c) { return c.label; }).join(', ') + '.' : 'Mark it funded when the money lands.'; btn = left.length ? '' : '<button class="btn primary" data-act="deal-fund">Mark funded</button>'; tone = left.length ? '' : 'good'; }
    else if (d.stage === 'funded') { var p = payback(d); t = 'Funded ' + BD.money(d.fundedAmount) + ' on ' + BD.fmtDay(d.fundedAt) + '.'; tone = 'good';
      sub = (d.commissionPaidAt ? 'Commission of ' + BD.money(d.commission) + ' received. ' : 'Commission of ' + BD.money(d.commission) + ' owed by ' + lenderName(d.lenderId, r.lenders) + '. ') + (p ? (p.pct >= 0.5 ? 'Past halfway paid back, so they can renew.' : 'Can renew at 50%, around ' + BD.fmtDay(p.halfAt) + '.') : '');
      btn = p && p.pct >= 0.5 ? '<button class="btn primary" data-act="deal-renew">Start renewal</button>' : ''; }
    return '<div class="next ' + tone + '" data-spec-id="next-step"><div class="txt"><b>' + esc(t) + '</b><span>' + esc(sub) + '</span></div><div class="next-acts">' + btn + '</div></div>';
  }
  function payback(d) {
    if (!d.fundedAt || !d.terms) return null;
    var t = d.terms, n = t.freq === 'weekly' ? Math.round(t.termMonths * 52 / 12) : Math.round(t.termMonths * 21), per = t.freq === 'weekly' ? 7 * S.DAY : S.DAY * 7 / 5;
    var made = Math.max(0, Math.min(n, Math.floor((Date.now() - d.fundedAt) / per)));
    return { made: made, total: n, pct: n ? made / n : 0, halfAt: d.fundedAt + Math.ceil(n / 2) * per };
  }
  function fileSec(r) {
    var d = r.deal;
    return '<div class="sec" data-spec-id="deal-file"><div class="sec-h"><div><h3>The file</h3><p>Lenders need the application, the last 3 months of statements, ID and a void cheque.</p></div><label class="btn sm" style="cursor:pointer">' + ICON.up + 'Upload<input type="file" class="file-in" data-change="deal-file-up" multiple accept="application/pdf,image/*"></label></div>' +
      S.PAPERWORK.map(function (p) { var at = d.paperwork[p.id]; return '<button class="chk' + (at ? ' ok' : '') + '" data-act="deal-paper" data-v="' + p.id + '"><span class="box">' + (at ? ICON.check : '') + '</span><span>' + esc(p.label) + (p.optional ? ' <span class="muted">(if a lender asks)</span>' : '') + '</span><span class="meta">' + (at ? 'In ' + esc(BD.when(at).toLowerCase()) : 'Missing') + '</span></button>'; }).join('') +
      (r.files.length ? '<div class="files">' + r.files.map(function (f) { return '<a class="file" href="/api/files/' + esc(f.id) + '" target="_blank" rel="noopener">' + ICON.file + '<span class="trunc">' + esc(f.name) + '</span><span class="muted small">' + esc(BD.when(f.at)) + '</span></a>'; }).join('') + '</div>' : '') + '</div>';
  }
  function lendersSec(r) {
    var d = r.deal, subs = d.submissions;
    var rows = subs.map(function (s) {
      var name = lenderName(s.lenderId, r.lenders), hrs = s.respondedAt ? Math.max(1, Math.round((s.respondedAt - s.sentAt) / 36e5)) : null;
      var status = s.status === 'approved' ? '<span class="pill good">Approved</span>' : s.status === 'declined' ? '<span class="pill bad">Declined</span>' : '<span class="pill">Waiting, ' + esc(BD.when(s.sentAt).toLowerCase()) + '</span>';
      var offers = (s.offers || []).map(function (o) {
        var n = o.freq === 'weekly' ? Math.round(o.termMonths * 52 / 12) : Math.round(o.termMonths * 21), back = Math.round(o.amount * o.factor), pay = Math.round(back / n), comm = S.commission(o.amount, o.points);
        var taken = d.accepted && d.accepted.offerId === o.id;
        return '<div class="offer2' + (taken ? ' chosen' : '') + '"><span class="money big">' + BD.money(o.amount) + '</span><div class="od"><span><b>' + o.factor.toFixed(2) + '</b> factor, ' + o.termMonths + ' months</span>' +
          '<span>' + BD.money(pay) + ' ' + (o.freq === 'weekly' ? 'a week' : 'a business day') + '</span><span>pays back ' + BD.money(back) + '</span><span class="good">your commission <b>' + BD.money(comm) + '</b> (' + o.points + ' pts)</span></div>' +
          (taken ? '<span class="pill accent">They took this</span>' : d.stage === 'offers' || d.stage === 'submitted' ? '<button class="btn sm primary" data-act="deal-accept" data-s="' + esc(s.id) + '" data-o="' + esc(o.id) + '">They took this</button>' : '') + '</div>';
      }).join('');
      return '<div class="subrow"><div class="sr-top"><b>' + esc(name) + '</b>' + status + (hrs ? '<span class="muted small">answered in ' + (hrs < 48 ? hrs + 'h' : Math.round(hrs / 24) + 'd') + '</span>' : '') + (s.reason ? '<span class="muted small">' + esc(s.reason) + '</span>' : '') +
        '<span class="sp"></span>' + (s.status === 'sent' ? '<button class="btn sm" data-act="deal-response" data-v="' + esc(s.id) + '">Record answer</button>' : '') + '</div>' + offers + '</div>';
    }).join('');
    return '<div class="sec" data-spec-id="deal-lenders"><div class="sec-h"><div><h3>Lenders</h3><p>' + (subs.length ? 'Where this file went and what came back.' : 'Not sent anywhere yet.') + '</p></div>' + (d.stage !== 'dead' && d.stage !== 'funded' ? '<button class="btn sm" data-act="deal-submit">' + ICON.plus + 'Send to lenders</button>' : '') + '</div>' + rows + '</div>';
  }
  function closingSec(d) {
    return '<div class="sec"><div class="sec-h"><div><h3>Before it funds</h3></div>' + (d.stage === 'contracts' ? '<button class="btn sm primary" data-act="deal-fund">Mark funded</button>' : '') + '</div>' + S.CLOSING.map(function (c) {
      var at = d.closing[c.id]; return '<button class="chk' + (at ? ' ok' : '') + '" data-act="deal-closing" data-v="' + c.id + '"' + (d.stage === 'funded' ? ' disabled' : '') + '><span class="box">' + (at ? ICON.check : '') + '</span><span>' + esc(c.label) + '</span><span class="meta">' + (at ? 'Done ' + esc(BD.when(at).toLowerCase()) : 'Not yet') + '</span></button>';
    }).join('') + '</div>';
  }
  function fundedSec(r) {
    var d = r.deal, p = payback(d);
    return '<div class="sec"><div class="sec-h"><div><h3>Funded</h3><p>' + BD.money(d.fundedAmount) + ' by ' + esc(lenderName(d.lenderId, r.lenders)) + ' on ' + BD.fmtDay(d.fundedAt) + '.</p></div></div>' +
      '<button class="chk' + (d.commissionPaidAt ? ' ok' : '') + '" data-act="deal-comm"><span class="box">' + (d.commissionPaidAt ? ICON.check : '') + '</span><span>Commission of ' + BD.money(d.commission) + ' received</span><span class="meta">' + (d.commissionPaidAt ? BD.fmtDay(d.commissionPaidAt) : 'Not yet') + '</span></button>' +
      (p ? '<div class="pad"><div class="kv"><span>Paid back so far (estimated from the terms)</span><b>' + BD.pct(p.pct) + '</b></div><div class="bar big' + (p.pct >= 0.5 ? ' good' : '') + '"><i style="width:' + Math.max(2, p.pct * 100) + '%"></i><span class="half"></span></div><p class="muted small">' + (p.pct >= 0.5 ? 'They can renew now.' : 'Renewal opens at 50%, around ' + BD.fmtDay(p.halfAt) + '.') + '</p></div>' : '') + '</div>';
  }
  function actSec(r) {
    return '<div class="sec"><div class="sec-h"><div><h3>History</h3></div></div><ul class="tl">' + (r.activities.length ? r.activities.map(function (a) { return BD.activityLine(a); }).join('') : '<li class="sys"><span></span><div class="muted">Nothing yet.</div></li>') + '</ul></div>';
  }

  // ---------- actions ----------
  BD.on('deal-paper', function (el) { var on = !DP.d.deal.paperwork[el.getAttribute('data-v')]; act({ action: 'paper', item: el.getAttribute('data-v'), on: on }); });
  BD.on('deal-closing', function (el) { var on = !DP.d.deal.closing[el.getAttribute('data-v')]; act({ action: 'closing', item: el.getAttribute('data-v'), on: on }).then(function () { if (!S.CLOSING.some(function (c) { return !DP.d.deal.closing[c.id]; })) BD.toast('Everything is in. Mark it funded when the money lands.'); }); });
  BD.on('deal-comm', function () { act({ action: 'commission', on: !DP.d.deal.commissionPaidAt }, DP.d.deal.commissionPaidAt ? 'Marked unpaid' : 'Commission received'); });
  BD.on('deal-call', function () { var l = DP.d.lead; BD.phone.call({ leadId: l.id, to: l.phone, name: l.name, contact: l.contactName }); });
  BD.on('deal-reopen', function () { act({ action: 'reopen' }, 'Reopened'); });
  BD.on('deal-renew', function () { BD.api('/api/deals', { body: { leadId: DP.d.deal.leadId, requested: Math.round((DP.d.deal.fundedAmount || 0) * 1.2 / 5000) * 5000, renewalOf: DP.d.deal.id } }).then(function (r) { BD.toast('Renewal started'); BD.go('#/deal/' + r.deal.id); }, BD.fail); });
  BD.on('deal-ask-statements', function () {
    var t = BD.state.me.settings.templates.sms.filter(function (x) { return x.id === 't-statements'; })[0];
    BD.leadPage.tab = 'sms'; BD.leadPage.focus = true; BD.go('#/lead/' + DP.d.deal.leadId + '?tab=sms&from=' + encodeURIComponent('#/deal/' + DP.id));
    if (t) setTimeout(function () { var b = document.querySelector('.tpls [data-v="t-statements"]'); if (b) b.click(); }, 400);
  });
  BD.on('deal-file-up', function (el) {
    var files = Array.prototype.slice.call(el.files || []); if (!files.length) return;
    Promise.all(files.map(function (f) { var fd = new FormData(); fd.append('file', f); fd.append('leadId', DP.d.deal.leadId); fd.append('dealId', DP.id); fd.append('kind', 'statement'); return BD.api('/api/files', { body: fd }); }))
      .then(function () { BD.toast(BD.plural(files.length, 'file') + ' added. Tick the statements they cover.'); return loadDeal(DP.id); }).then(function () { document.getElementById('main').innerHTML = dealPage(); }, BD.fail);
  });
  BD.on('deal-submit', function () {
    var r = DP.d, d = r.deal, sent = {}; d.submissions.forEach(function (s) { if (s.status !== 'declined') sent[s.lenderId] = 1; });
    var ls = r.lenders.filter(function (l) { return l.active; }).sort(function (a, b) { return (b.fit.fits ? 1 : 0) - (a.fit.fits ? 1 : 0); });
    BD.modal({ title: 'Send to lenders', sub: 'Ticked lenders get the file. Ones whose rules this file does not meet are marked, with the reason.', wide: true,
      body: '<div class="lpick">' + ls.map(function (l) {
        var already = sent[l.id];
        return '<label class="lp-row' + (l.fit.fits ? '' : ' nofit') + (already ? ' off' : '') + '"><input type="checkbox" name="lenders" data-multi="1" value="' + esc(l.id) + '"' + (l.fit.fits && !already ? ' checked' : '') + (already ? ' disabled' : '') + '>' +
          '<span class="main"><b>' + esc(l.name) + '</b><span class="sub">' + (already ? 'Already has this file' : l.fit.fits ? 'Fits: ' + rulesLine(l.rules) + (l.fit.check.length ? '. Not on file yet: ' + esc(l.fit.check.join(', ')) : '') : esc(l.fit.why.join(', '))) + '</span></span>' + (l.fit.fits ? '<span class="pill good">Fits</span>' : '<span class="pill warn">Outside their rules</span>') + '</label>';
      }).join('') + '</div>' + (ls.length ? '' : '<p class="muted">No lenders yet. Add them under Lenders.</p>'),
      submit: 'Send the file', onSubmit: function (f) { var ids = BD.formData(f).lenders || []; if (!ids.length) throw new Error('Tick at least one lender.'); return act({ action: 'submit', lenderIds: ids }, 'Sent to ' + BD.plural(ids.length, 'lender')); } });
  });
  function rulesLine(r) { return [r.minRevenue ? BD.moneyK(r.minRevenue) + '+/mo' : '', r.minMonths ? r.minMonths + '+ months' : '', r.maxPositions != null ? (r.maxPositions ? 'up to ' + r.maxPositions + (r.maxPositions === 1 ? ' position' : ' positions') : '1st position') : '', r.maxAmount ? 'to ' + BD.moneyK(r.maxAmount) : ''].filter(Boolean).join(', ') || 'no set rules'; }
  BD.lenderRules = rulesLine;
  BD.on('deal-response', function (el) {
    var sid = el.getAttribute('data-v'), s = DP.d.deal.submissions.filter(function (x) { return x.id === sid; })[0], name = lenderName(s.lenderId, DP.d.lenders), L = DP.d.lenders.filter(function (x) { return x.id === s.lenderId; })[0] || {};
    var row = function (i) { return '<div class="offer-in"><input name="a' + i + '" type="number" step="1000" placeholder="Amount $"><input name="f' + i + '" type="number" step="0.01" placeholder="Factor 1.30"><input name="t' + i + '" type="number" placeholder="Months"><select name="q' + i + '"><option value="daily">Daily</option><option value="weekly">Weekly</option></select><input name="p' + i + '" type="number" step="1" placeholder="Points" value="' + (L.points || '') + '"></div>'; };
    BD.modal({ title: name + ' answered', wide: true, body: '<div class="seg wide-seg"><button type="button" class="on" data-act="resp-kind" data-v="approved">Approved</button><button type="button" data-act="resp-kind" data-v="declined">Declined</button></div><input type="hidden" name="status" value="approved">' +
      '<div id="resp-ok"><p class="muted small" style="margin:12px 0 6px">Their offers. Points are your commission, as a percent of the amount.</p>' + row(0) + row(1) + row(2) + '</div>' +
      '<div id="resp-no" hidden><label class="field" style="margin-top:12px"><span>Why</span><select name="reason">' + S.DECLINE_REASONS.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label></div>',
      submit: 'Save', onSubmit: function (f) {
        var v = BD.formData(f), offers = [];
        for (var i = 0; i < 3; i++) if (+v['a' + i] > 0) offers.push({ amount: +v['a' + i], factor: +v['f' + i] || 1.3, termMonths: +v['t' + i] || 6, freq: v['q' + i], points: +v['p' + i] || 0 });
        if (v.status === 'approved' && !offers.length) throw new Error('Add at least one offer, or pick Declined.');
        return act({ action: 'response', submissionId: sid, status: v.status, reason: v.reason, offers: offers }, v.status === 'approved' ? 'Offers saved' : 'Decline saved');
      } });
  });
  BD.on('resp-kind', function (el) { var m = el.closest('.modal'), v = el.getAttribute('data-v'); m.querySelectorAll('.wide-seg button').forEach(function (b) { b.classList.toggle('on', b === el); }); m.querySelector('input[name=status]').value = v; m.querySelector('#resp-ok').hidden = v !== 'approved'; m.querySelector('#resp-no').hidden = v === 'approved'; });
  BD.on('deal-accept', function (el) { act({ action: 'accept', submissionId: el.getAttribute('data-s'), offerId: el.getAttribute('data-o') }, 'Contracts out'); });
  BD.on('deal-fund', function () {
    var d = DP.d.deal, amt = d.terms ? d.terms.amount : d.requested;
    BD.modal({ title: 'Mark funded', body: '<div class="grid2"><label class="field"><span>Amount funded</span><input name="amount" type="number" value="' + esc(amt || '') + '"></label><label class="field"><span>Date</span><input name="day" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></label></div>',
      submit: 'Mark funded', onSubmit: function (f) { var v = BD.formData(f), p = v.day.split('-'); return act({ action: 'fund', amount: +v.amount, at: new Date(+p[0], +p[1] - 1, +p[2], 12).getTime() }, 'Funded. Nice work.'); } });
  });
  BD.on('deal-close', function () {
    var d = DP.d.deal;
    BD.modal({ title: 'Close this file', body: '<div class="seg wide-seg"><button type="button" class="on" data-act="close-kind" data-v="declined">Every lender declined</button><button type="button" data-act="close-kind" data-v="lost">Lost the business</button></div><input type="hidden" name="kind" value="declined">' +
      '<label class="field" style="margin-top:12px"><span>Why</span><select name="reason" id="close-reason">' + S.DECLINE_REASONS.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label><label class="field" style="margin-top:10px"><span>Note</span><input name="note"></label>',
      submit: 'Close file', onSubmit: function (f) { var v = BD.formData(f); return act({ action: 'close', kind: v.kind, reason: v.reason, note: v.note }, 'Closed'); } });
  });
  BD.on('close-kind', function (el) {
    var m = el.closest('.modal'), v = el.getAttribute('data-v'); m.querySelectorAll('.wide-seg button').forEach(function (b) { b.classList.toggle('on', b === el); }); m.querySelector('input[name=kind]').value = v;
    m.querySelector('#close-reason').innerHTML = (v === 'declined' ? S.DECLINE_REASONS : S.LOST_REASONS).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
  });
  BD.on('deal-edit', function () {
    var d = DP.d.deal, m = d.merchant || {};
    BD.modal({ title: 'Edit the file', body: '<div class="grid3"><label class="field"><span>Wants</span><input name="requested" type="number" value="' + esc(d.requested || '') + '"></label><label class="field"><span>Monthly revenue</span><input name="monthlyRevenue" type="number" value="' + esc(m.monthlyRevenue || '') + '"></label><label class="field"><span>Months trading</span><input name="months" type="number" value="' + esc(m.months || '') + '"></label>' +
      '<label class="field"><span>Credit score</span><input name="score" type="number" value="' + esc(m.score || '') + '"></label><label class="field"><span>Other funders</span><input name="positions" type="number" value="' + esc(m.positions == null ? '' : m.positions) + '"></label></div><label class="field" style="margin-top:12px"><span>Notes</span><textarea name="notes" rows="3">' + esc(d.notes || '') + '</textarea></label>',
      submit: 'Save', onSubmit: function (f) { var v = BD.formData(f); return act({ action: 'edit', requested: v.requested, notes: v.notes, merchant: { monthlyRevenue: v.monthlyRevenue, months: v.months, score: v.score, positions: v.positions } }, 'Saved'); } });
  });
  BD.ICON.send2 = BD.ICON.up;
})();
