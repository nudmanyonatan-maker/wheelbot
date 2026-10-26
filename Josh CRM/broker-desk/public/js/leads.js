/* Leads: a saved list or a search, paged from the server 50 at a time. Filters, sorting, saved
 * lists (Close's Smart Views), selection with "all matching", and bulk actions: dialer, bulk email,
 * sequence, assign, status, do-not-call, export. */
(function () {
  'use strict';
  var BD = window.BD, S = BD.S, esc = BD.esc, ICON = BD.ICON;
  var L = { key: '', filter: {}, sort: 'created', rows: [], total: 0, sel: {}, all: false, list: null, q: '' };
  var SORTS = [['created', 'Newest first'], ['calls', 'Fewest calls first'], ['contacted', 'Longest since contact'], ['recent', 'Recently contacted'], ['name', 'Business name'], ['revenue', 'Highest revenue']];
  var CONTACTED = [['', 'Any time'], ['never', 'Never contacted'], ['today', 'Contacted today'], ['7d+', 'Not in 7 days'], ['30d+', 'Not in 30 days']];
  var CREATED = [['', 'Any time'], ['1d', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']];

  function listById(id) { return BD.lists().filter(function (l) { return l.id === id; })[0] || null; }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function same(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }
  function norm(f) { var o = {}; Object.keys(f || {}).sort().forEach(function (k) { var v = f[k]; if (v === '' || v == null || (Array.isArray(v) && !v.length)) return; o[k] = v; }); return o; }
  BD.leadFilter = function () { return L.filter; };

  function load(more) {
    var qs = '/api/leads?limit=50&sort=' + L.sort + '&offset=' + (more ? L.rows.length : 0) + '&f=' + encodeURIComponent(JSON.stringify(L.filter));
    return BD.api(qs).then(function (r) { L.rows = more ? L.rows.concat(r.leads) : r.leads; L.total = r.total; return r; });
  }
  BD.views.leads = {
    render: function (arg, q, o) {
      var key = JSON.stringify(q);
      if (o.soft && key === L.key) return page();
      L.key = key; L.sel = {}; L.all = false; L.q = q.q || '';
      L.list = q.list ? listById(q.list) : null;
      L.filter = L.list ? clone(L.list.filter) : q.f ? JSON.parse(q.f) : q.q ? { q: q.q } : {};
      L.sort = (L.list && L.list.sort) || (q.q ? 'recent' : 'created');
      return load(false).then(page);
    }
  };
  BD.reloadLeads = function () { return load(false).then(function () { if (BD.route.name === 'leads') document.getElementById('main').innerHTML = page(); }); };

  function title() { return L.list ? L.list.name : L.q ? 'Search: ' + L.q : 'All leads'; }
  function changed() { return L.list ? !same(L.filter, L.list.filter) || L.sort !== (L.list.sort || 'created') : Object.keys(norm(L.filter)).length > 0; }
  function nSel() { return L.all ? L.total : Object.keys(L.sel).length; }
  function page() {
    var mgr = BD.isMgr(), sel = nSel();
    var head = '<div class="page-head"><div><h1>' + esc(title()) + '</h1><p>' + BD.plural(L.total, 'lead') + (L.list && L.list.shared === false ? ', just yours' : '') + '</p></div>' +
      '<div class="filters"><button class="btn" data-act="leads-more">' + ICON.dots + '<span>More</span></button><button class="btn" data-act="lead-new">' + ICON.plus + 'Add lead</button>' +
      '<button class="btn" data-act="bulk-email">' + ICON.mail + 'Email list</button><button class="btn primary" data-act="dialer-open" data-spec-id="start-dialer">' + ICON.dialer + 'Start dialer</button></div></div>';
    var f = L.filter, chip = function (act, label, val, on) { return '<button class="ms' + (on ? ' on' : '') + '" data-act="' + act + '">' + label + (val ? ': <b>' + esc(val) + '</b>' : '') + ICON.down + '</button>'; };
    var st = f.status && f.status.length ? (f.status.length === 1 ? BD.status(f.status[0]).label : f.status.length + ' statuses') : '';
    var bar = '<div class="fbar">' +
      '<div class="fsearch">' + ICON.search + '<input value="' + esc(f.q || '') + '" placeholder="Search this list" data-input="leads-q" aria-label="Search this list"></div>' +
      chip('f-status', 'Status', st, !!st) + (mgr ? chip('f-owner', 'Owner', f.owner === 'me' ? 'Me' : f.owner === 'none' ? 'Nobody' : f.owner ? BD.pname(f.owner) : '', !!f.owner) : '') +
      chip('f-contacted', 'Contacted', (CONTACTED.filter(function (c) { return c[0] === (f.contacted || ''); })[0] || [, ''])[1].replace('Any time', ''), !!f.contacted) +
      chip('f-created', 'Added', (CREATED.filter(function (c) { return c[0] === (f.created || ''); })[0] || [, ''])[1].replace('Any time', ''), !!f.created) +
      chip('f-province', 'Province', f.province && f.province.length ? f.province.join(', ') : '', !!(f.province && f.province.length)) +
      chip('f-more', 'More', [f.list ? 'list' : '', f.source ? 'source' : '', f.consent ? 'consent' : '', f.minRevenue ? 'revenue' : ''].filter(Boolean).join(', '), !!(f.list || f.source || f.consent || f.minRevenue)) +
      '<span class="sp"></span>' + chip('f-sort', 'Sort', SORTS.filter(function (s) { return s[0] === L.sort; })[0][1], false) +
      (changed() ? '<button class="btn sm" data-act="list-save">' + (L.list ? 'Save list' : 'Save as list') + '</button>' : '') + '</div>';
    var bulk = sel ? '<div class="bulkbar"><b>' + BD.plural(sel, 'lead') + ' selected</b>' +
      (L.all ? '' : Object.keys(L.sel).length === L.rows.length && L.total > L.rows.length ? '<button class="link" data-act="sel-all-matching">Select all ' + BD.num(L.total) + '</button>' : '') +
      '<span class="sp"></span><button class="btn sm" data-act="bulk-seq">' + ICON.seq + 'Add to sequence</button><button class="btn sm" data-act="bulk-status">Change status</button>' +
      (mgr ? '<button class="btn sm" data-act="bulk-assign">Assign</button>' : '') + '<button class="btn sm" data-act="bulk-dnc">Do not call</button>' +
      '<button class="btn sm ghost" data-act="sel-clear">Clear</button></div>' : '';
    var rows = L.rows.map(row).join('');
    var table = '<div class="panel ltable"><div class="lrow lhead"><label class="cb"><input type="checkbox" data-change="sel-page"' + (L.rows.length && Object.keys(L.sel).length === L.rows.length ? ' checked' : '') + ' aria-label="Select this page"></label>' +
      '<span>Business</span><span>Status</span><span>Phone</span><span>Last contact</span><span class="right">Calls</span><span class="right">Revenue</span><span>Owner</span></div>' +
      (rows || '<div class="empty-sec"><b>' + (L.q || changed() ? 'No leads match.' : 'No leads here yet.') + '</b><span>' + (L.q || changed() ? 'Try a different filter.' : 'Import a list from Close or a spreadsheet, or add one by hand.') + '</span>' +
        '<div class="btn-row"><button class="btn primary" data-act="go" data-v="#/settings/import">Import leads</button><button class="btn" data-act="lead-new">Add one</button></div></div>') +
      (L.rows.length < L.total ? '<button class="more-line" data-act="leads-load-more">Show 50 more of ' + BD.num(L.total - L.rows.length) + '</button>' : '') + '</div>';
    return '<div class="page page-leads">' + head + bar + bulk + table + '</div>';
  }
  function row(l) {
    var on = L.all || L.sel[l.id], last = l.lastContactAt ? BD.when(l.lastContactAt) : 'Never';
    return '<div class="lrow' + (on ? ' sel' : '') + '" data-act="lead-open" data-v="' + esc(l.id) + '">' +
      '<label class="cb" data-act="noop"><input type="checkbox" data-change="sel-one" value="' + esc(l.id) + '"' + (on ? ' checked' : '') + (L.all ? ' disabled' : '') + ' aria-label="Select"></label>' +
      '<span class="main"><b class="trunc">' + esc(l.name) + '</b><span class="sub trunc">' + esc([l.contactName, l.city || l.province, l.industry].filter(Boolean).join(', ')) + '</span></span>' +
      '<span>' + BD.statusPill(l.status) + (l.dnc ? ' <span class="pill bad" data-tip="On the do-not-call list">DNC</span>' : '') + '</span>' +
      '<span class="ph">' + (l.phone ? esc(l.phone) : '<span class="muted">No number</span>') + '</span>' +
      '<span class="' + (l.lastContactAt ? '' : 'muted') + '">' + esc(last) + '</span>' +
      '<span class="right num">' + (l.calls || 0) + '</span>' +
      '<span class="right money-sm">' + (l.monthlyRevenue ? BD.moneyK(l.monthlyRevenue) + '/mo' : '<span class="muted">–</span>') + '</span>' +
      '<span>' + (l.owner ? '<span class="av sm" data-tip="' + esc(BD.pname(l.owner)) + '">' + esc(BD.initials(BD.pname(l.owner))) + '</span>' : '<span class="muted">Nobody</span>') + '</span></div>';
  }
  function redraw() { if (BD.route.name === 'leads') document.getElementById('main').innerHTML = page(); }
  function reload() { L.sel = {}; L.all = false; return load(false).then(redraw, BD.fail); }
  BD.on('noop', function () {});
  BD.on('lead-open', function (el, e) { if (e.target.closest('.cb')) return; BD.go('#/lead/' + el.getAttribute('data-v')); });
  BD.on('sel-one', function (el) { if (el.checked) L.sel[el.value] = 1; else delete L.sel[el.value]; L.all = false; redraw(); });
  BD.on('sel-page', function (el) { L.sel = {}; L.all = false; if (el.checked) L.rows.forEach(function (r) { L.sel[r.id] = 1; }); redraw(); });
  BD.on('sel-all-matching', function () { L.all = true; redraw(); });
  BD.on('sel-clear', function () { L.sel = {}; L.all = false; redraw(); });
  BD.on('leads-load-more', function () { load(true).then(redraw, BD.fail); });
  BD.on('leads-q', BD.debounce(function (el) { L.filter.q = el.value.trim(); if (!L.filter.q) delete L.filter.q; load(false).then(function () { redraw(); var i = document.querySelector('.fsearch input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, BD.fail); }, 280));

  // ---------- filter popovers ----------
  function checks(name, items, cur) {
    return items.map(function (it) { return '<label><input type="checkbox" data-change="' + name + '" value="' + esc(it[0]) + '"' + (cur.indexOf(it[0]) >= 0 ? ' checked' : '') + '><span>' + esc(it[1]) + '</span>' + (it[2] != null ? '<span class="muted sp-r">' + BD.num(it[2]) + '</span>' : '') + '</label>'; }).join('');
  }
  BD.on('f-status', function (el) {
    BD.api('/api/leads?facets=1').then(function (fc) {
      BD.pop(el, '<div class="head">Status</div>' + checks('f-status-set', BD.statuses().map(function (s) { return [s.id, s.label, fc.status[s.id] || 0]; }), L.filter.status || []) +
        '<div class="sep"></div><button class="opt" data-act="f-clear" data-v="status">Any status</button>', { keepOpen: true });
    }, BD.fail);
  });
  BD.on('f-status-set', function (el) { var s = (L.filter.status || []).filter(function (x) { return x !== el.value; }); if (el.checked) s.push(el.value); L.filter.status = s; reload(); });
  BD.on('f-province', function (el) { BD.pop(el, '<div class="head">Province</div>' + checks('f-prov-set', S.PROVINCES.map(function (p) { return [p.id, p.name]; }), L.filter.province || []) + '<div class="sep"></div><button class="opt" data-act="f-clear" data-v="province">Anywhere</button>'); });
  BD.on('f-prov-set', function (el) { var s = (L.filter.province || []).filter(function (x) { return x !== el.value; }); if (el.checked) s.push(el.value); L.filter.province = s; reload(); });
  BD.on('f-clear', function (el) { delete L.filter[el.getAttribute('data-v')]; BD.closePop(); reload(); });
  function single(el, key, items) {
    BD.menu(el, items.map(function (it) { return { v: it[0], label: it[1], sel: (L.filter[key] || '') === it[0] }; }), function (v) { if (v) L.filter[key] = v; else delete L.filter[key]; reload(); });
  }
  BD.on('f-contacted', function (el) { single(el, 'contacted', CONTACTED); });
  BD.on('f-created', function (el) { single(el, 'created', CREATED); });
  BD.on('f-owner', function (el) {
    single(el, 'owner', [['', 'Anyone'], ['me', 'Me']].concat(BD.state.me.team.filter(function (p) { return p.active && p.id !== BD.state.me.user.member; }).map(function (p) { return [p.id, p.name]; }), [['none', 'Nobody yet']]));
  });
  BD.on('f-sort', function (el) { BD.menu(el, SORTS.map(function (s) { return { v: s[0], label: s[1], sel: L.sort === s[0] }; }), function (v) { L.sort = v; reload(); }); });
  BD.on('f-more', function (el) {
    BD.api('/api/leads?facets=1').then(function (fc) {
      var f = L.filter;
      BD.pop(el, '<div class="fu-pop"><label class="field"><span>Imported list</span><select data-change="f-set" data-k="list"><option value="">Any list</option>' + fc.lists.map(function (x) { return '<option' + (f.list === x.list ? ' selected' : '') + '>' + esc(x.list) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>Source</span><select data-change="f-set" data-k="source"><option value="">Any source</option>' + ['website', 'import', 'referral', 'manual', 'close'].map(function (x) { return '<option value="' + x + '"' + (f.source === x ? ' selected' : '') + '>' + BD.cap(x) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>Email and text consent (CASL)</span><select data-change="f-set" data-k="consent"><option value="">Anyone</option><option value="ok"' + (f.consent === 'ok' ? ' selected' : '') + '>Has consent</option><option value="none"' + (f.consent === 'none' ? ' selected' : '') + '>No consent on file</option></select></label>' +
        '<label class="field"><span>Monthly revenue at least</span><input type="number" step="5000" min="0" data-change="f-set" data-k="minRevenue" value="' + esc(f.minRevenue || '') + '" placeholder="$"></label></div>', { wide: true, noFocus: true });
    }, BD.fail);
  });
  BD.on('f-set', function (el) { var k = el.getAttribute('data-k'); if (el.value) L.filter[k] = k === 'minRevenue' ? +el.value : el.value; else delete L.filter[k]; reload(); });

  // ---------- saved lists ----------
  BD.on('list-save', function () {
    if (L.list) {
      var lists = BD.lists().map(function (l) { return l.id === L.list.id ? Object.assign({}, l, { filter: clone(L.filter), sort: L.sort }) : l; });
      return saveLists(lists).then(function () { L.list = listById(L.list.id); redraw(); BD.toast('List saved'); BD.loadListCounts(); });
    }
    BD.modal({ title: 'Save as a list', sub: 'Saved lists keep these filters. Pin them to the sidebar to call or email them in one click.',
      body: '<label class="field"><span>Name</span><input name="name" required placeholder="e.g. Ontario restaurants, never called"></label><label class="checkline" style="margin-top:12px"><input type="checkbox" name="pin" checked> Pin it to my sidebar</label>' +
        (BD.isMgr() ? '<label class="checkline" style="margin-top:8px"><input type="checkbox" name="shared" checked> Share it with the team</label>' : ''),
      submit: 'Save list', onSubmit: function (f) {
        var d = BD.formData(f); if (!d.name.trim()) throw new Error('Name the list.');
        var l = { id: BD.uid('l-'), name: d.name.trim().slice(0, 60), filter: clone(L.filter), sort: L.sort, shared: BD.isMgr() ? !!d.shared : false, owner: BD.state.me.user.member };
        return saveLists(BD.lists().concat([l])).then(function () {
          var after = d.pin ? BD.saveMine({ pinned: (BD.state.me.mine.pinned || []).concat([l.id]) }) : Promise.resolve();
          return after.then(function () { BD.loadListCounts(); BD.go('#/leads?list=' + l.id); BD.toast('List saved'); });
        });
      } });
  });
  function saveLists(lists) { return BD.api('/api/settings', { body: { key: 'lists', data: lists } }).then(function (r) { BD.state.me.settings.lists = r.lists || lists; }); }
  BD.saveLists = saveLists;
  BD.on('leads-more', function (el) {
    var items = [{ v: 'import', label: 'Import leads' }, { v: 'export', label: 'Export these as CSV' }];
    if (L.list) items.push({ sep: true }, { v: 'rename', label: 'Rename list' }, { v: 'delete', label: 'Delete list', danger: true });
    BD.menu(el, items, function (v) {
      if (v === 'import') BD.go('#/settings/import');
      if (v === 'export') location.href = '/api/leads/export?f=' + encodeURIComponent(JSON.stringify(L.filter));
      if (v === 'rename') BD.modal({ title: 'Rename list', body: '<label class="field"><span>Name</span><input name="name" value="' + esc(L.list.name) + '"></label>', submit: 'Save', onSubmit: function (f) {
        var n = BD.formData(f).name.trim(); if (!n) throw new Error('Name the list.');
        return saveLists(BD.lists().map(function (l) { return l.id === L.list.id ? Object.assign({}, l, { name: n }) : l; })).then(function () { L.list = listById(L.list.id); redraw(); BD.renderNav(); });
      } });
      if (v === 'delete') BD.confirm('Delete "' + L.list.name + '"?', 'The leads stay. Only the saved filter goes.', 'Delete list', function () {
        return saveLists(BD.lists().filter(function (l) { return l.id !== L.list.id; })).then(function () { BD.go('#/leads'); BD.loadListCounts(); });
      }, true);
    }, { right: true });
  });

  // ---------- bulk ----------
  BD.leadSelection = function () { return L.all ? { filter: L.filter, count: L.total } : nSel() ? { ids: Object.keys(L.sel), count: nSel() } : { filter: L.filter, count: L.total }; };
  function bulk(action, value, label) {
    var s = BD.leadSelection();
    return BD.api('/api/leads/bulk', { body: { ids: s.ids, filter: s.ids ? undefined : s.filter, action: action, value: value } }).then(function (r) { BD.toast(label + ': ' + BD.plural(r.changed, 'lead')); reload(); BD.loadListCounts(); });
  }
  BD.on('bulk-status', function (el) { BD.menu(el, BD.statuses().map(function (s) { return { v: s.id, label: s.label }; }), function (v) { bulk('status', v, 'Moved to ' + BD.status(v).label); }); });
  BD.on('bulk-assign', function (el) {
    BD.menu(el, BD.state.me.team.filter(function (p) { return p.active; }).map(function (p) { return { v: p.id, label: p.name }; }).concat([{ sep: true }, { v: '', label: 'Nobody' }]), function (v) { bulk('assign', v || null, v ? 'Assigned to ' + BD.pname(v) : 'Unassigned'); });
  });
  BD.on('bulk-dnc', function () {
    var n = nSel();
    BD.confirm('Add ' + BD.plural(n, 'lead') + ' to do-not-call?', 'Their numbers go on your internal do-not-call list. The dialer and Call buttons skip them from now on.', 'Add to do-not-call', function () { return bulk('dnc', null, 'Added to do-not-call'); }, true);
  });
  BD.on('lead-new', function () { BD.leadForm(null); });
})();
