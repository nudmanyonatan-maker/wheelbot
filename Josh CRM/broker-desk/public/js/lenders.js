/* Lenders: the funders a brokerage sends files to, each with its rules (minimum revenue, time in
 * business, positions, maximum amount, industries it will not fund, provinces it covers) and how
 * it has done: files sent, approval rate, how fast it answers, what it funded. */
(function () {
  'use strict';
  var BD = window.BD, S = BD.S, esc = BD.esc, ICON = BD.ICON;
  var LN = { list: [], stats: {} };
  BD.views.lenders = {
    render: function () {
      return Promise.all([BD.api('/api/lenders'), BD.api('/api/dash?days=90')]).then(function (r) {
        LN.list = r[0].lenders; LN.stats = {}; (r[1].lenders || []).forEach(function (s) { LN.stats[s.id] = s; });
        return page();
      });
    }
  };
  function page() {
    var mgr = BD.isMgr();
    var head = '<div class="page-head"><div><h1>Lenders</h1><p>Who you send files to and what each one takes. The deal page uses these rules to show which lenders fit a file, and why the others do not.</p></div>' +
      (mgr ? '<div class="filters"><button class="btn primary" data-act="lender-edit">' + ICON.plus + 'Add lender</button></div>' : '') + '</div>';
    var rows = LN.list.map(function (l) {
      var s = LN.stats[l.id] || {};
      return '<div class="row lnrow' + (l.active ? '' : ' off') + '"' + (mgr ? ' data-act="lender-edit" data-v="' + esc(l.id) + '"' : '') + '><div class="main"><b>' + esc(l.name) + '</b>' + (l.active ? '' : ' <span class="pill">Paused</span>') + '<div class="sub">' + esc(BD.lenderRules(l.rules)) + (l.rules.restricted && l.rules.restricted.length ? '. No ' + esc(l.rules.restricted.slice(0, 3).join(', ').toLowerCase()) + (l.rules.restricted.length > 3 ? ' and more' : '') : '') + '</div></div>' +
        '<div class="num right">' + BD.num(s.sent || 0) + '<span class="sub">files</span></div><div class="num right">' + (s.rate == null ? '–' : BD.pct(s.rate)) + '<span class="sub">approved</span></div>' +
        '<div class="num right">' + (s.hours == null ? '–' : s.hours < 48 ? Math.round(s.hours) + 'h' : Math.round(s.hours / 24) + 'd') + '<span class="sub">to answer</span></div><div class="num right money-sm">' + BD.moneyK(s.volume || 0) + '<span class="sub">funded</span></div>' +
        '<div class="num right">' + (l.points != null ? l.points + ' pts' : '–') + '<span class="sub">usual points</span></div></div>';
    }).join('');
    return '<div class="page page-lenders">' + head + '<div class="panel"><div class="thead lnrow"><span>Lender and rules</span><span class="right">Last 90 days</span><span></span><span></span><span></span><span></span></div><div class="rows">' +
      (rows || '<div class="empty-sec"><b>No lenders yet.</b><span>Add the funders you work with and their rules.</span></div>') + '</div></div></div>';
  }
  BD.on('lender-edit', function (el) {
    var id = el.getAttribute('data-v'), l = LN.list.filter(function (x) { return x.id === id; })[0] || { rules: {}, contacts: [], active: true };
    var r = l.rules || {}, c = (l.contacts || [])[0] || {};
    var num = function (n, label, v, step) { return '<label class="field"><span>' + label + '</span><input name="' + n + '" type="number" min="0"' + (step ? ' step="' + step + '"' : '') + ' value="' + esc(v == null ? '' : v) + '"></label>'; };
    BD.modal({ title: id ? l.name : 'Add a lender', wide: true,
      body: '<div class="grid3"><label class="field span2"><span>Name</span><input name="name" required value="' + esc(l.name || '') + '"></label><label class="field"><span>Submissions email</span><input name="email" type="email" value="' + esc(l.email || '') + '"></label>' +
        '<label class="field"><span>Rep</span><input name="cname" value="' + esc(c.name || '') + '"></label><label class="field"><span>Rep phone</span><input name="cphone" value="' + esc(c.phone || '') + '"></label>' + num('points', 'Usual points you get', l.points) +
        '<div class="form-sec span3">What they take</div>' + num('minRevenue', 'Minimum monthly revenue', r.minRevenue, 5000) + num('minMonths', 'Minimum months trading', r.minMonths) + num('minScore', 'Minimum credit score', r.minScore) +
        num('maxPositions', 'Most other funders allowed', r.maxPositions) + num('maxAmount', 'Largest deal', r.maxAmount, 10000) + '<span></span>' +
        '<div class="field span3"><span>Will not fund</span><div class="checks">' + S.INDUSTRIES.map(function (i) { return '<label class="checkline"><input type="checkbox" name="restricted" data-multi="1" value="' + esc(i) + '"' + ((r.restricted || []).indexOf(i) >= 0 ? ' checked' : '') + '>' + esc(i) + '</label>'; }).join('') + '</div></div>' +
        '<div class="field span3"><span>Provinces they fund (leave all clear for all of Canada)</span><div class="checks">' + S.PROVINCES.map(function (p) { return '<label class="checkline"><input type="checkbox" name="provinces" data-multi="1" value="' + p.id + '"' + ((r.provinces || []).indexOf(p.id) >= 0 ? ' checked' : '') + '>' + p.id + '</label>'; }).join('') + '</div></div>' +
        '<label class="field span3"><span>Notes</span><textarea name="notes" rows="2">' + esc(l.notes || '') + '</textarea></label><label class="checkline"><input type="checkbox" name="active"' + (l.active ? ' checked' : '') + '> Sending files to them</label></div>',
      submit: 'Save lender', onSubmit: function (f) {
        var v = BD.formData(f);
        return BD.api('/api/lenders', { body: { id: id || null, name: v.name, email: v.email, points: v.points, notes: v.notes, active: v.active, contacts: [{ name: v.cname, phone: v.cphone }],
          rules: { minRevenue: v.minRevenue, minMonths: v.minMonths, minScore: v.minScore, maxPositions: v.maxPositions, maxAmount: v.maxAmount, restricted: v.restricted, provinces: v.provinces } } })
          .then(function () { BD.toast('Lender saved'); BD.render(); });
      } });
  });
})();
