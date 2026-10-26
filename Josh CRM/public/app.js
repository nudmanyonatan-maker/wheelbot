/* ISO Desk, built for Josh Abecassis, ISO manager. Vanilla JS, no build step, nothing from a CDN.
 * Two modes. The private desk (/) signs in and keeps one workspace in /api/data, starting empty.
 * The demo (/demo/) is the seed in data.js overlaid with edits from /api/state, which everyone
 * with the link shares. Screens are functions that return HTML; clicks go through one delegated
 * listener keyed on data-act.
 * On the private desk a manager sees every rep's book and a rep sees only their own; the server
 * decides what each device gets and may save, this file only follows along. */
(function () {
  'use strict';
  var A = window.AD, ME = A.ME;
  var LIVE = !window.ISODESK_DEMO, SESSION = null;
  var UI_KEY = LIVE ? 'isodesk-ui-desk-v1' : 'isodesk-ui-v2', LOCAL_KEY = 'isodesk-local-v2', API = '/api/state';
  var KINDS = ['shops', 'deals', 'msgs', 'meta'];
  var OPEN = ['submitted', 'underwriting', 'approved', 'contracts'];
  var STAGE_LABEL = {}; A.STAGES.forEach(function (s) { STAGE_LABEL[s.id] = s.label; });

  // ---------- small utils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var uidN = 0;
  function uid(p) { return p + Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 8); }
  function vals(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function sum(arr, f) { return arr.reduce(function (t, x) { return t + f(x); }, 0); }
  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function daysSince(iso) { return Math.round((A.TODAY - dayStart(iso)) / A.DAY); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dueDiff(s) { return Math.round((parseDay(s) - A.TODAY) / A.DAY); }
  function addDays(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return A.dateOnly(d); }
  function addMonth(s) { var d = parseDay(s); d.setMonth(d.getMonth() + 1); return A.dateOnly(d); }
  function hhmm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fmtDay(iso) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function agoText(iso) { var n = daysSince(iso); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  function minsAgo(iso) {
    var m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'Just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 24 && daysSince(iso) === 0) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return cap(agoText(iso));
  }
  function timeText(iso) { var n = daysSince(iso); var t = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); return n <= 0 ? 'Today ' + t : n === 1 ? 'Yesterday ' + t : fmtDay(iso) + ', ' + t; }
  function fmtTime(t) { if (!t) return ''; var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + (h < 12 ? ' AM' : ' PM'); }
  function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function money(n) { return A.money0(n); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function words(arr) { return arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }
  function nowISO() { return new Date().toISOString(); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function lc(s) { return /^(Today|Tomorrow|Yesterday)\b/.test(s || '') ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function digits(p) { var d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }
  function fmtPhone(p) { var d = digits(p); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(p || ''); }
  function first(name) { return String(name || '').replace(/^Dr\.\s+/, '').split(' ')[0]; }
  function initials(name) { return String(name || '?').replace(/^Dr\.\s+/, '').split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase(); }

  var ICON = {
    clock: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5" stroke-linecap="round"/></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 6.3l2.4 2.4 4.6-5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="4.8"/><path d="M10.6 10.6L14 14" stroke-linecap="round"/></svg>',
    down: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.7l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3L5 8l5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    phone: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2.5h3l1.2 3-1.7 1.1a8 8 0 0 0 3.9 3.9l1.1-1.7 3 1.2v3c0 .6-.5 1-1 1A11.5 11.5 0 0 1 2 3.5c0-.6.4-1 1-1z" stroke-linejoin="round"/></svg>',
    msg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" stroke-linejoin="round"/></svg>',
    note: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3" stroke-linecap="round"/></svg>',
    dot: '<svg width="13" height="13" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.6" fill="currentColor"/></svg>',
    plus: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg>',
    send: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 8h10M8.5 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // ---------- people ----------
  var PEOPLE = {}, TEAM = [];
  function setTeam(list) { TEAM = list; PEOPLE = {}; TEAM.forEach(function (p) { PEOPLE[p.id] = p; }); }
  setTeam(A.TEAM);
  function solo() { return TEAM.length < 2; }
  // Managers see every book; reps see only their own (the server enforces it). The demo plays a manager.
  function isMgr() { return !LIVE || !SESSION || SESSION.user.role !== 'rep'; }
  function activeTeam() { return TEAM.filter(function (p) { return p.active !== false; }); }
  function teamFrom(list) { return list.map(function (t) { return { id: t.id, name: t.name, first: first(t.name), initials: initials(t.name), role: t.role || 'manager', active: t.active !== false }; }); }
  // Which book Shops and Deals show a manager: '' their own, 'all', 'none' (nobody's yet) or a person's id.
  function bookOn() { return LIVE && isMgr() && !solo(); }
  function bookOf() { return bookOn() ? UI.f.book || '' : ''; }
  function inBook(rep) { var b = bookOf(); return b === '' ? rep === ME : b === 'all' ? true : b === 'none' ? !rep : rep === b; }
  function bookLabel() { var b = bookOf(); return b === '' ? 'Mine' : b === 'all' ? 'Everyone' : b === 'none' ? 'Nobody yet' : pname(b); }
  function bookOptions() {
    var others = TEAM.filter(function (p) { return p.id !== ME && (p.active !== false || I.shops.some(function (s) { return s.repId === p.id; })); });
    return [['', 'Mine'], ['all', 'Everyone']].concat(others.map(function (p) { return [p.id, p.name + (p.active === false ? ' (removed)' : '')]; }), [['none', 'Nobody yet']]);
  }
  function bookButton() { return bookOn() ? '<button class="ms' + (bookOf() ? ' on' : '') + '" data-act="book" data-spec-id="book-filter">Book: <b>' + esc(bookLabel()) + '</b>' + ICON.down + '</button>' : ''; }
  function bookSub() { var b = bookOf(); return b === '' ? 'Your book of broker shops.' : b === 'all' ? 'Every shop on the team.' : b === 'none' ? 'Shops nobody looks after yet.' : esc(pname(b)) + "'s book."; }
  function myPhone() { return (DB.meta.settings && DB.meta.settings.phone) || (SESSION && SESSION.user.phone) || (LIVE ? '' : A.MY_PHONE.number); }
  function pname(id) { var p = PEOPLE[id]; return p ? p.name : 'Nobody'; }
  function pfirst(id) { var p = PEOPLE[id]; return p ? p.first : 'nobody'; }
  function whose(id) { return id === ME ? 'Your shop' : id ? pname(id) + "'s shop" : 'Nobody on it'; }

  // ---------- state ----------
  function emptyKinds() { var o = {}; KINDS.forEach(function (k) { o[k] = {}; }); return o; }
  var DB = emptyKinds(), pending = emptyKinds();
  var EPOCH = null;
  var UI = { view: 'today', f: { shops: [], since: 'any', status: [], quality: [], q: '', book: '' }, sort: 'last', convFilter: 'all', conv: null, desktop: false, showUpcoming: false, drafts: {} };
  try { var saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); ['view', 'sort', 'desktop', 'convFilter'].forEach(function (k) { if (saved[k] !== undefined) UI[k] = saved[k]; }); } catch (e) { /* private window */ }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: UI.view, sort: UI.sort, desktop: UI.desktop, convFilter: UI.convFilter })); } catch (e) { /* ignore */ } }
  var drawer = null, modal = null, pop = null, I = null, call = null, sheet = null, alerts = [];

  function loadSeed() {
    DB = emptyKinds();
    var s = A.buildSeed();
    KINDS.forEach(function (k) { (s[k] || []).forEach(function (x) { DB[k][x.id] = x; }); });
  }
  function S() { return DB.meta.settings; }

  // ---------- persistence ----------
  // Demo: shared through /api/state, merged record by record.
  // Private desk: /api/data for the signed-in workspace, plus a copy on this device so the desk
  // opens instantly and keeps working through a dropped connection.
  var saveTimer = null, inflight = false, failCount = 0, mode = LIVE ? 'live' : 'shared', LAST = 0, cacheTimer = null;
  function hasPending() { return KINDS.some(function (k) { return Object.keys(pending[k]).length > 0; }); }
  // The alerts worker needs each open follow-up's due time as a moment, worked out in Josh's own time zone.
  function stampFUs(rec) { (rec.followUps || []).forEach(function (f) { if (!f.doneAt && f.due) f.at = dueAt(f).getTime(); else delete f.at; }); }
  function put(kind, rec) { if (I) { I.info = {}; I.auto = null; } if (kind === 'shops' || kind === 'deals') stampFUs(rec); rec.updatedAt = Date.now(); DB[kind][rec.id] = rec; pending[kind][rec.id] = rec; queueSave(); }
  function remove(kind, id) { delete DB[kind][id]; pending[kind][id] = { id: id, deleted: true, updatedAt: Date.now() }; queueSave(); }
  function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 450); saveCacheSoon(); }
  function cacheKey() { return SESSION ? 'isodesk-ws-' + SESSION.ws.id + '-' + SESSION.user.member : null; }
  function saveCacheSoon() { if (!LIVE || !SESSION) return; clearTimeout(cacheTimer); cacheTimer = setTimeout(saveCache, 800); }
  function saveCache() {
    var k = cacheKey(); if (!k) return;
    try { localStorage.setItem(k, JSON.stringify({ v: 1, last: LAST, session: SESSION, db: DB, pending: pending })); localStorage.setItem('isodesk-last', k); } catch (e) { /* too big or blocked: the desk still works online */ }
  }
  function readCache() {
    try { var k = localStorage.getItem('isodesk-last'), c = k ? JSON.parse(localStorage.getItem(k) || 'null') : null; return c && c.v === 1 && c.session && c.db ? c : null; } catch (e) { return null; }
  }
  function dropCache() { try { var k = cacheKey(); if (k) localStorage.removeItem(k); localStorage.removeItem('isodesk-last'); } catch (e) { /* ignore */ } }
  // Records come from a store anyone with the link can write to, so check their shape before
  // using them: ids must be plain tokens, numbers must be numbers, dates must be dates.
  var ID_RX = /^[A-Za-z0-9_-]{1,80}$/, DAY_RX = /^\d{4}-\d{2}-\d{2}$/, TIME_RX = /^\d{2}:\d{2}$/;
  function okId(v) { return typeof v === 'string' && ID_RX.test(v); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 4000) : ''; }
  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object' && okId(x.id); }) : []; }
  function iso(v) { return typeof v === 'string' && !isNaN(Date.parse(v)) ? v : null; }
  function cleanOffer(o) { ['amount', 'buyRate', 'termMonths', 'fee', 'maxPoints', 'points'].forEach(function (k) { o[k] = num(o[k], k === 'buyRate' ? 1 : 0); }); o.freq = o.freq === 'weekly' ? 'weekly' : 'daily'; return o; }
  function cleanRec(kind, r) {
    if (!r || typeof r !== 'object' || !okId(r.id)) return null;
    r.updatedAt = num(r.updatedAt);
    if (r.deleted) return { id: r.id, deleted: true, updatedAt: r.updatedAt };
    r.followUps = arr(r.followUps).map(function (f) { if (!DAY_RX.test(f.due || '')) f.due = A.dayOffset(1); if (!TIME_RX.test(f.time || '')) f.time = '09:00'; if (['', 'weekly', 'biweekly', 'monthly'].indexOf(f.repeat || '') < 0) f.repeat = ''; f.note = str(f.note, 300); f.doneAt = iso(f.doneAt); return f; });
    r.activity = arr(r.activity).map(function (a) { a.text = str(a.text); a.at = iso(a.at) || nowISO(); return a; });
    if (kind === 'shops') {
      r.name = str(r.name, 200) || 'Unnamed shop'; r.state = str(r.state, 2); r.about = str(r.about, 2000);
      if (r.repId != null && !okId(r.repId)) r.repId = null;
      r.contacts = arr(r.contacts).map(function (c) { c.name = str(c.name, 120); c.role = str(c.role, 40); c.phone = str(c.phone, 30); c.phone2 = str(c.phone2, 30); c.email = str(c.email, 160); return c; });
      r.history = Array.isArray(r.history) ? r.history.filter(function (h) { return h && okId(h.repId); }) : [];
      r.createdAt = iso(r.createdAt) || nowISO(); r.assignedAt = iso(r.assignedAt); r.agreementAt = iso(r.agreementAt); r.w9At = iso(r.w9At); r.importedAt = iso(r.importedAt);
      if (r.paused && typeof r.paused === 'object') r.paused.reason = str(r.paused.reason, 200); else r.paused = null;
      r.touches = arr(r.touches).filter(function (t) { return typeof t.rule === 'string' && typeof t.key === 'string' && iso(t.at) && (t.how !== 'later' || (DAY_RX.test(t.due || '') && TIME_RX.test(t.time || ''))); }).slice(0, 80);
      if (['', 'weekly', 'biweekly', 'monthly', 'off'].indexOf(r.autoFU || '') < 0) r.autoFU = '';
    } else if (kind === 'deals') {
      if (!okId(r.shopId)) return null;
      if (A.STAGE_INDEX[r.stage] === undefined) r.stage = 'submitted';
      var m = r.merchant && typeof r.merchant === 'object' ? r.merchant : {};
      r.merchant = { business: str(m.business, 200) || 'Unnamed merchant', owner: str(m.owner, 120), industry: str(m.industry, 60), state: str(m.state, 2),
        monthlyRevenue: num(m.monthlyRevenue), tibMonths: num(m.tibMonths), fico: num(m.fico), positions: num(m.positions), phone: str(m.phone, 30), email: str(m.email, 160) };
      r.requested = num(r.requested);
      ['contactId', 'acceptedOfferId', 'renewalOf'].forEach(function (k) { if (!okId(r[k])) r[k] = null; });
      r.offers = arr(r.offers).map(cleanOffer);
      if (r.funded && typeof r.funded === 'object') { var noTerms = !!r.funded.noTerms; cleanOffer(r.funded); r.funded.noTerms = noTerms || !(r.funded.termMonths > 0) || !(r.funded.buyRate > 1); r.funded.fundedAt = iso(r.funded.fundedAt) || nowISO(); r.funded.stoppedAt = iso(r.funded.stoppedAt); r.funded.commissionPaidAt = iso(r.funded.commissionPaidAt); if (!PEOPLE[r.funded.repId]) r.funded.repId = null; } else r.funded = null;
      if (r.closed && typeof r.closed === 'object') { r.closed.kind = r.closed.kind === 'declined' ? 'declined' : 'lost'; r.closed.reason = str(r.closed.reason, 120); r.closed.note = str(r.closed.note, 1000); if (A.STAGE_INDEX[r.closed.fromStage] === undefined) r.closed.fromStage = 'submitted'; } else r.closed = null;
      r.paperwork = r.paperwork && typeof r.paperwork === 'object' ? r.paperwork : {}; r.closing = r.closing && typeof r.closing === 'object' ? r.closing : {};
      r.repOverride = null; r.submittedAt = iso(r.submittedAt) || nowISO(); r.stageAt = iso(r.stageAt) || r.submittedAt; r.importedAt = iso(r.importedAt);
    } else if (kind === 'msgs') {
      r.phone = str(r.phone, 30); r.dir = r.dir === 'out' ? 'out' : 'in'; r.kind = r.kind === 'call' ? 'call' : 'text'; r.text = str(r.text, 2000);
      r.outcome = r.outcome ? str(r.outcome, 40) : null; r.duration = num(r.duration); r.at = iso(r.at) || nowISO(); r.read = !!r.read; r.spam = !!r.spam; r.via = r.via === 'phone' ? 'phone' : '';
    } else if (kind === 'meta') {
      if (r.id !== 'settings') return null;
      var al = r.alerts || {};
      r.alerts = { offerDays: Math.max(1, num(al.offerDays, 2)), paperDays: Math.max(1, num(al.paperDays, 2)), quietDays: Math.max(7, num(al.quietDays, 30)) };
      r.templates = arr(r.templates).map(function (t) { t.name = str(t.name, 60); t.text = str(t.text, 600); return t; });
      r.blocked = Array.isArray(r.blocked) ? r.blocked.filter(function (b) { return b && typeof b.phone === 'string'; }).map(function (b) { return { phone: str(b.phone, 30), at: iso(b.at) || nowISO() }; }) : [];
      r.phone = str(r.phone, 30);
      var su = r.setup && typeof r.setup === 'object' ? r.setup : {};
      r.setup = { phoneAck: !!su.phoneAck, hidden: !!su.hidden };
      var au = r.auto && typeof r.auto === 'object' ? r.auto : {}, tx = au.texts && typeof au.texts === 'object' ? au.texts : {};
      r.auto = { topDays: Math.min(60, Math.max(2, num(au.topDays, 7))), otherDays: Math.min(90, Math.max(2, num(au.otherDays, 14))), perDay: Math.min(200, Math.max(1, num(au.perDay, 25))),
        off: Array.isArray(au.off) ? au.off.filter(function (x) { return typeof x === 'string' && RULE[x]; }) : [], texts: {} };
      Object.keys(tx).forEach(function (k) { if (RULE[k] && typeof tx[k] === 'string') r.auto.texts[k] = str(tx[k], 600); });
    }
    return r;
  }
  function applyOverlay(ov) {
    var changed = false;
    KINDS.forEach(function (kind) {
      var recs = ov[kind] || {};
      Object.keys(recs).forEach(function (id) {
        var r = cleanRec(kind, recs[id]), cur = DB[kind][id];
        if (!r || r.id !== id) return;
        if (pending[kind][id]) return; // our unsaved edit wins until it lands
        if (r.deleted) { if (cur && (cur.updatedAt || 0) <= r.updatedAt) { delete DB[kind][id]; changed = true; } return; }
        if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) { DB[kind][id] = r; changed = true; }
      });
    });
    return changed;
  }
  function saveLocal() {
    try {
      var ov = {};
      KINDS.forEach(function (kind) { ov[kind] = {}; vals(DB[kind]).forEach(function (r) { if (r.updatedAt) ov[kind][r.id] = r; }); vals(pending[kind]).forEach(function (r) { if (r.deleted) ov[kind][r.id] = r; }); });
      localStorage.setItem(LOCAL_KEY, JSON.stringify(ov));
    } catch (e) { /* storage blocked */ }
  }
  function flush() {
    if (!hasPending()) return;
    if (mode === 'local') { saveLocal(); pending = emptyKinds(); return; }
    if (inflight) { queueSave(); return; }
    if (LIVE && !SESSION) return;
    // At most 150 records a request, so a big import goes up in pieces.
    var sentVer = emptyKinds(), body = LIVE ? {} : { epoch: EPOCH }, n = 0;
    KINDS.forEach(function (kind) { body[kind] = []; Object.keys(pending[kind]).forEach(function (id) { if (n >= 150) return; var r = pending[kind][id]; sentVer[kind][id] = r.updatedAt; body[kind].push(r); n++; }); });
    inflight = true;
    fetch(LIVE ? '/api/data' : API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        inflight = false;
        if (LIVE && res.status === 401) { signedOut(); return; }
        if (!LIVE && res.status === 409 && res.j && res.j.reset) { onRemoteReset(res.j.epoch); return; }
        if (!res.j || res.j.ok !== true) throw new Error('save rejected');
        KINDS.forEach(function (kind) { Object.keys(sentVer[kind]).forEach(function (id) { if (pending[kind][id] && pending[kind][id].updatedAt === sentVer[kind][id]) delete pending[kind][id]; }); });
        // A record the server refuses would be retried forever, so it is dropped and reported once.
        (res.j.rejected || []).forEach(function (x) { if (x && pending[x.kind]) delete pending[x.kind][x.id]; });
        // A clock running ahead gets its time pulled back to the server's. Take the stored time,
        // or this device would keep ignoring newer edits from the others.
        (res.j.stamped || []).forEach(function (x) {
          var cur = x && DB[x.kind] && DB[x.kind][x.id];
          if (cur && !pending[x.kind][x.id] && cur.updatedAt === sentVer[x.kind][x.id] && x.updatedAt < cur.updatedAt) cur.updatedAt = x.updatedAt;
        });
        var nDenied = (res.j.denied || []).length, nBad = (res.j.rejected || []).length - nDenied;
        if (LIVE && nDenied) { toast(plural(nDenied, 'change') + ' not saved. ' + (nDenied === 1 ? 'It was' : 'They were') + ' to shops that are no longer in your book.', { bad: true }); pullLive(false).then(function (c) { if (c) softRender(); }).catch(function () { /* next tick */ }); }
        else if (LIVE && nBad > 0) toast(plural(nBad, 'change') + ' could not be saved. Tell Yonatan.', { bad: true });
        failCount = 0; setSaveWarn(null); saveCacheSoon();
        if (hasPending()) queueSave();
      })
      .catch(function () {
        inflight = false; failCount++;
        if (LIVE) saveCache(); else saveLocal();
        setSaveWarn(LIVE ? 'Offline. Your changes are kept on this device and save when the connection is back.' : 'Your last change has not saved yet. Retrying.');
        setTimeout(flush, Math.min(30000, 2000 * failCount));
      });
  }
  var knownIn = null; // inbound message ids already seen, so a new text can raise an alert
  function noteInbound(raise) {
    var ids = {};
    vals(DB.msgs).forEach(function (m) {
      if (m.dir !== 'in') return; ids[m.id] = 1;
      if (raise && knownIn && !knownIn[m.id] && !m.read && m.kind === 'text') pushAlert({ id: 'msg-' + m.id, kind: 'text', key: digits(m.phone) });
    });
    knownIn = ids;
  }
  function pull(first) {
    return fetch(API, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('no api'); return r.json(); }).then(function (st) {
      if (EPOCH !== null && st.epoch !== EPOCH) { onRemoteReset(st.epoch); return; }
      EPOCH = st.epoch;
      var changed = applyOverlay(st);
      if (changed && !first) { softRender(); noteInbound(true); }
    });
  }
  function onRemoteReset(epoch) {
    EPOCH = epoch; pending = emptyKinds(); loadSeed(); drawer = null; modal = null; sheet = null; call = null; alerts = []; closePop();
    render(); toast('The demo data was reset to the starting point');
  }
  function setSaveWarn(msg) {
    var el = document.getElementById('savewarn');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'savewarn'; el.className = 'savewarn'; document.body.appendChild(el); }
    el.textContent = msg;
  }
  setInterval(function () {
    if (document.hidden || mode !== 'shared' || modal || dragId) return;
    pull(false).catch(function () { /* the next tick retries */ });
  }, 60000);
  function pullLive(full) {
    return fetch('/api/data?since=' + (full ? 0 : LAST), { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { signedOut(); throw new Error('signed out'); }
      if (!r.ok) throw new Error('no api');
      return r.json();
    }).then(function (st) {
      var changed = applyOverlay(st);
      LAST = st.now || LAST;
      if (!inflight && !hasPending()) setSaveWarn(null);
      saveCacheSoon();
      return changed;
    });
  }
  // Other devices' changes: every 20 seconds while the desk is on screen, and right away when it comes back.
  function syncNow() { if (!LIVE || !SESSION || !navigator.onLine) return; flush(); pullLive(false).then(function (c) { if (c) softRender(); }).catch(function () { /* next tick */ }); }
  setInterval(function () { if (!document.hidden && !modal && !dragId) syncNow(); }, 20000);
  window.addEventListener('online', syncNow);

  // ---------- derived ----------
  function buildIndex() {
    I = { dealsByShop: {}, renewing: {}, dupOf: {}, byPhone: {}, convByKey: {}, byMerchant: {}, shops: vals(DB.shops), deals: vals(DB.deals) };
    I.deals.forEach(function (d) {
      (I.dealsByShop[d.shopId] = I.dealsByShop[d.shopId] || []).push(d); if (d.renewalOf) I.renewing[d.renewalOf] = d.id;
      var mk = A.normName(d.merchant.business); if (mk) (I.byMerchant[mk] = I.byMerchant[mk] || []).push(d);
    });
    Object.keys(I.byMerchant).forEach(function (k) { I.byMerchant[k].sort(function (a, b) { return a.submittedAt < b.submittedAt ? -1 : 1; }); });
    var groups = {};
    I.shops.forEach(function (s) {
      var n = A.normName(s.name); (groups[n] = groups[n] || []).push(s.id);
      // A number on two records (a duplicate shop) resolves to Josh's copy.
      s.contacts.forEach(function (c) { [c.phone, c.phone2].forEach(function (ph) { var k = digits(ph), cur = I.byPhone[k]; if (k && (!cur || (cur.shop.repId !== ME && (s.repId === ME || !cur.shop.repId)))) I.byPhone[k] = { shop: s, contact: c }; }); });
    });
    Object.keys(groups).forEach(function (n) { var g = groups[n]; if (g.length > 1) g.forEach(function (id) { I.dupOf[id] = g.filter(function (x) { return x !== id; }); }); });
    I.blocked = {}; (S().blocked || []).forEach(function (b) { I.blocked[digits(b.phone)] = b; });
    vals(DB.msgs).forEach(function (m) {
      var k = digits(m.phone); if (!k || I.blocked[k]) return;
      var c = I.convByKey[k] = I.convByKey[k] || { key: k, phone: fmtPhone(m.phone), who: I.byPhone[k] || null, msgs: [], unread: 0, spam: false };
      c.msgs.push(m); if (m.dir === 'in' && !m.read) c.unread++; if (m.spam) c.spam = true;
    });
    I.convs = vals(I.convByKey).map(function (c) { c.msgs.sort(function (a, b) { return a.at < b.at ? -1 : 1; }); c.last = c.msgs[c.msgs.length - 1]; if (c.who) c.spam = false; return c; })
      .sort(function (a, b) { return a.last.at < b.last.at ? 1 : -1; });
    // Top shops: the fifth of each book that funded the most in the last six months. They get checked in on more often.
    I.info = {}; I.top = {}; I.auto = null;
    var books = {};
    I.shops.forEach(function (s) { if (s.repId) (books[s.repId] = books[s.repId] || []).push(s); });
    Object.keys(books).forEach(function (rep) {
      books[rep].map(function (s) { return { id: s.id, v: shopInfo(s).f180 }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; })
        .slice(0, Math.max(1, Math.ceil(books[rep].length / 5))).forEach(function (x) { I.top[x.id] = 1; });
    });
  }
  function shopOf(d) { return DB.shops[d.shopId] || null; }
  // Other shops that sent the same merchant, oldest first. Nobody sells this check, and it is
  // where fights over who brought a merchant start.
  function rivalSubs(d) { return (I.byMerchant[A.normName(d.merchant.business)] || []).filter(function (x) { return x.id !== d.id && x.shopId !== d.shopId; }); }
  function merchantMatches(name, shopId) {
    var k = A.normName(name); if (k.length < 4) return '';
    var hits = I.byMerchant[k] || [];
    if (!hits.length && k.length >= 6) {
      // Names drift between shops ("Bella Napoli" and "Bella Napoli Trattoria LLC"), so a close name counts too.
      var near = Object.keys(I.byMerchant).filter(function (x) { return x !== k && (x.indexOf(k) === 0 || k.indexOf(x) === 0); })[0];
      if (near) hits = I.byMerchant[near];
    }
    if (!hits.length) return '<div class="match-box good"><span>No shop has sent this merchant before.</span></div>';
    var other = hits.filter(function (d) { return d.shopId !== shopId; }), firstD = hits[0], fs = shopOf(firstD) || { name: 'A shop' };
    var line = hits.slice(0, 3).map(function (d) { return ((shopOf(d) || {}).name || 'A shop') + ', ' + fmtDay(d.submittedAt) + ', ' + STAGE_LABEL[d.stage].toLowerCase(); }).join('; ');
    var same = A.normName(firstD.merchant.business) === k, who = same ? 'this merchant' : firstD.merchant.business;
    return '<div class="match-box' + (other.length ? ' bad' : '') + '"><b>' + esc(other.length ? fs.name + ' sent ' + who + ' first, on ' + fmtDay(firstD.submittedAt) + '.' : 'This shop sent ' + who + ' before, on ' + fmtDay(firstD.submittedAt) + '.') + '</b><span>' + esc(line) + '</span>' +
      '<span class="acts"><button type="button" class="btn sm" data-act="open-from-list" data-type="deal" data-id="' + esc(firstD.id) + '">Open it</button></span></div>';
  }
  function ownerOf(d) { if (d.repOverride) return d.repOverride.repId; var s = shopOf(d); return s ? s.repId : null; }
  function recOf(type, id) { return type === 'shop' ? DB.shops[id] : DB.deals[id]; }
  function recName(type, rec) { return type === 'shop' ? rec.name : rec.merchant.business; }
  function kindOf(type) { return type === 'shop' ? 'shops' : 'deals'; }
  // How a shop is doing. Its pace is the usual gap between its deals, from its last few. Slowing down
  // and gone quiet are measured against that pace, so a shop that sends twice a week is flagged after a
  // week of silence and one that sends monthly is not. Without enough deals the pace is taken as 10 days.
  // Gone quiet never waits longer than the quiet days in Settings.
  function approvedish(d) { return d.offers.length > 0 || ['approved', 'contracts', 'funded'].indexOf(d.stage) >= 0; }
  function shopInfo(s) {
    if (I.info[s.id]) return I.info[s.id];
    var ds = I.dealsByShop[s.id] || [], quietDays = S().alerts.quietDays;
    var subs = ds.map(function (d) { return d.submittedAt; }).sort();
    var last = subs.length ? subs[subs.length - 1] : null;
    var lastDays = last ? daysSince(last) : null;
    var recent = subs.filter(function (x) { return daysSince(x) <= 365; }).slice(-9), gaps = [];
    for (var i = 1; i < recent.length; i++) gaps.push((Date.parse(recent[i]) - Date.parse(recent[i - 1])) / A.DAY);
    gaps.sort(function (a, b) { return a - b; });
    var mid = Math.floor(gaps.length / 2), pace = gaps.length >= 2 ? Math.max(1, Math.round(gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2)) : null;
    var expect = pace || 10, slowAt = Math.max(Math.round(expect * 1.5), 7), quietAt = Math.min(quietDays, Math.max(expect * 3, 14));
    var status = s.paused ? 'Paused' : (!ds.length && daysSince(s.createdAt) <= quietDays) ? 'New' : (lastDays === null || lastDays > quietAt) ? 'Gone quiet' : lastDays > slowAt ? 'Slowing down' : 'Active';
    var in30 = ds.filter(function (d) { return daysSince(d.submittedAt) <= 30; });
    var f90 = ds.filter(function (d) { return d.funded && daysSince(d.funded.fundedAt) <= 90; });
    var f180 = ds.filter(function (d) { return d.funded && daysSince(d.funded.fundedAt) <= 180; });
    // Approved out of decided, last 90 days. Still in underwriting, or lost before an offer, is not decided.
    var d90 = ds.filter(function (d) { return daysSince(d.submittedAt) <= 90; }), reasons = {}, topDecline = null;
    var appr = d90.filter(approvedish).length, decl = 0;
    d90.forEach(function (d) { if (d.closed && d.closed.kind === 'declined') { decl++; reasons[d.closed.reason] = (reasons[d.closed.reason] || 0) + 1; if (!topDecline || reasons[d.closed.reason] > reasons[topDecline]) topDecline = d.closed.reason; } });
    var decided = appr + decl, quality = decided < 3 ? 'few' : appr / decided >= 0.6 ? 'good' : appr / decided <= 0.3 ? 'poor' : 'mixed';
    // The last time you and the shop were in touch: a call or text either way, on any of its numbers.
    var talked = null;
    s.contacts.forEach(function (c) { [c.phone, c.phone2].forEach(function (ph) { var cv = I.convByKey[digits(ph)]; if (cv && (!talked || cv.last.at > talked)) talked = cv.last.at; }); });
    (s.activity || []).forEach(function (a) { if ((a.type === 'call' || a.type === 'text') && (!talked || a.at > talked)) talked = a.at; });
    return (I.info[s.id] = { deals: ds, last: last, lastDays: lastDays, status: status, sub30: in30.length, f90: sum(f90, function (d) { return d.funded.amount; }),
      f180: sum(f180, function (d) { return d.funded.amount; }), pace: pace, appr: appr, decided: decided, quality: quality, topDecline: topDecline, talked: talked,
      open: ds.filter(function (d) { return OPEN.indexOf(d.stage) >= 0; }), dups: I.dupOf[s.id] || [] });
  }
  function fileMissing(d) {
    var out = [];
    if (!d.paperwork.app) out.push({ id: 'app', label: 'Signed application', short: 'application', tiny: 'application' });
    A.statementMonths(d.submittedAt).forEach(function (mk) { if (!d.paperwork[mk]) out.push({ id: mk, label: A.monthLabel(mk, true) + ' bank statement', short: A.monthLabel(mk, true) + ' statement', tiny: A.monthLabel(mk) + ' statement' }); });
    return out;
  }
  function closingItems(d) { return A.CLOSING_ITEMS.filter(function (c) { return !c.disclosureOnly || A.DISCLOSURE_STATES.indexOf(d.merchant.state) >= 0; }); }
  function closingMissing(d) { return closingItems(d).filter(function (c) { return !d.closing[c.id]; }); }
  function acceptedOffer(d) { return d.offers.filter(function (o) { return o.id === d.acceptedOfferId; })[0] || null; }
  function bestOffer(d) { return d.offers.slice().sort(function (a, b) { return b.amount - a.amount; })[0] || null; }
  function renewalState(d) {
    if (!d.funded) return null;
    if (d.funded.noTerms) return { kind: 'noterms', p: null };
    var p = A.fundedProgress(d.funded);
    if (d.funded.status === 'stopped') return { kind: 'stopped', p: p };
    if (p.paidPct >= 1) return { kind: 'paid', p: p };
    if (I.renewing[d.id]) return { kind: 'renewing', p: p, id: I.renewing[d.id] };
    if (p.paidPct >= 0.5) return { kind: 'ready', p: p };
    return { kind: 'later', p: p };
  }
  function log(rec, type, text, extra) { rec.activity = rec.activity || []; rec.activity.unshift(Object.assign({ id: uid('a'), type: type, text: text, at: nowISO(), by: ME }, extra || {})); }

  // ---------- automatic follow-ups ----------
  // For each shop in your book, the one thing worth saying today, already written. Deal news comes
  // first (a decline, a funding, paperwork, an unanswered offer, a renewal), then the relationship
  // (a new shop's first deal, a shop slowing down or gone quiet, the regular check-in). Nothing goes
  // out until you send it. What happened to each one is kept on the shop in `touches`:
  // { rule, key (the deal or the shop), how: sent | skipped | called | later, at, due/time for later, reason }.
  var RULE = {}, RULE_IDX = {}; A.AUTO_RULES.forEach(function (r, i) { RULE[r.id] = r; RULE_IDX[r.id] = i; });
  var CADENCE = [['', 'Automatic'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['off', 'Off']];
  var QUALITY = [['good', 'Mostly approved'], ['mixed', 'Mixed'], ['poor', 'Mostly declined'], ['few', 'Too few to tell']];
  var SKIPS = [['talked', 'Already talked to them'], ['notnow', 'Not worth it right now'], ['off', 'Stop automatic follow-ups for this shop']];
  function autoSet() { var d = A.defaultSettings().auto, a = S().auto || {}; return { topDays: a.topDays || d.topDays, otherDays: a.otherDays || d.otherDays, perDay: a.perDay || d.perDay, off: a.off || [], texts: a.texts || {} }; }
  function ruleText(id) { var t = autoSet().texts[id]; return t && t.trim() ? t : RULE[id].text; }
  function ruleWhen(id) { var a = autoSet(), st = S().alerts; return RULE[id].when.replace('{paperDays}', st.paperDays).replace(/\{offerDays\}/g, st.offerDays).replace('{topDays}', a.topDays).replace('{otherDays}', a.otherDays); }
  function cadenceDays(s, inf) {
    if (s.autoFU === 'weekly') return 7; if (s.autoFU === 'biweekly') return 14; if (s.autoFU === 'monthly') return 30;
    if (inf.quality === 'poor') return 30;
    return I.top[s.id] ? autoSet().topDays : autoSet().otherDays;
  }
  function lastHandled(s, test) { var h = null; (s.touches || []).forEach(function (t) { if (t.how !== 'later' && test(t) && (!h || t.at > h.at)) h = t; }); return h; }
  function snoozed(s, rule, key) { return (s.touches || []).some(function (t) { return t.how === 'later' && t.rule === rule && t.key === key && dueAt(t) > new Date(); }); }
  function touchFor(s) {
    if (s.repId !== ME) return null;
    var inf = shopInfo(s), st = S().alerts, off = autoSet().off, t = null;
    var mk = function (rule, d, x) {
      var key = d ? d.id : s.id, c = (d && dealContact(d)) || bestContact(s);
      if (off.indexOf(rule) >= 0 || snoozed(s, rule, key) || !c || !digits(c.phone)) return null;
      return Object.assign({ id: rule + ':' + key, rule: rule, key: key, s: s, d: d || null, c: c, call: false, late: false, value: inf.f180 }, x);
    };
    var deals = inf.deals.filter(function (d) { return ownerOf(d) === ME && !openFUs(d).length; });
    var news = function (rule, fn) { for (var i = 0; i < deals.length && !t; i++) { var x = fn(deals[i], lastHandled(s, function (h) { return h.rule === rule && h.key === deals[i].id; })); if (x) t = mk(rule, deals[i], x); } };
    news('declined', function (d, h) { return !h && d.closed && d.closed.kind === 'declined' && daysSince(d.closed.at) <= 3 && { chip: 'Declined', why: 'Underwriting declined ' + d.merchant.business + ': ' + d.closed.reason.toLowerCase() + '.' }; });
    news('funded', function (d, h) { return !h && d.funded && daysSince(d.funded.fundedAt) <= 3 && { chip: 'Funded', why: d.merchant.business + ' funded ' + lc(agoText(d.funded.fundedAt)) + ' for ' + money(d.funded.amount) + '.' }; });
    news('paperwork', function (d, h) {
      var miss = d.stage === 'submitted' || d.stage === 'underwriting' ? fileMissing(d) : [], n = daysSince(d.submittedAt);
      return miss.length && (!h || daysSince(h.at) >= st.paperDays) && { chip: n ? plural(n, 'day') + ' waiting' : 'Today', late: n >= st.paperDays, why: d.merchant.business + ' still needs the ' + words(miss.map(function (m) { return m.short; })) + '.' };
    });
    news('closing', function (d, h) {
      var miss = d.stage === 'contracts' ? closingMissing(d) : [], n = daysSince(d.stageAt);
      return miss.length && n >= 1 && (!h || daysSince(h.at) >= st.paperDays) && { chip: plural(n, 'day') + ' waiting', late: n >= st.paperDays, why: 'Left before ' + d.merchant.business + ' funds: ' + words(miss.slice(0, 3).map(function (c) { return c.label.toLowerCase(); })) + (miss.length > 3 ? ' and ' + (miss.length - 3) + ' more' : '') + '.' };
    });
    news('offer', function (d, h) {
      if (d.stage !== 'approved' || !d.offers.length) return null;
      var n = daysSince(d.offers[0].sentAt);
      return n >= st.offerDays && (!h || daysSince(h.at) >= st.offerDays) && { chip: plural(n, 'day') + ' out', late: true, why: 'Offer on ' + d.merchant.business + ' out ' + plural(n, 'day') + ' with no answer. Best is ' + money(bestOffer(d).amount) + '.' };
    });
    news('renewal', function (d, h) { var rs = renewalState(d); return !h && rs && rs.kind === 'ready' && { chip: pct(rs.p.paidPct) + ' paid', why: d.merchant.business + ' is ' + pct(rs.p.paidPct) + ' paid back and can renew.' }; });
    if (t || s.paused || s.autoFU === 'off' || openFUs(s).length) return t;
    // The relationship. A text sent or a follow-up skipped counts as being in touch.
    var h = lastHandled(s, function (x) { return RULE[x.rule] && RULE[x.rule].group === 'shop'; });
    var touched = [inf.talked, h && h.at].filter(Boolean).sort().pop() || null;
    var talkedDays = touched ? daysSince(touched) : Infinity, lastWord = touched ? 'Last talked ' + lc(agoText(touched)) : 'No calls or texts logged yet';
    if (inf.status === 'New' && !s.importedAt) {
      var since = daysSince(s.agreementAt || s.createdAt);
      return since >= 2 && talkedDays >= 4 ? mk('welcome', null, { chip: 'New', why: (s.agreementAt ? 'Signed ' : 'Added ') + lc(agoText(s.agreementAt || s.createdAt)) + ', no deal yet. ' + lastWord + '.' }) : null;
    }
    if (inf.status === 'Slowing down') return talkedDays >= 5 ? mk('slowing', null, { chip: inf.lastDays + ' days', late: true, why: (inf.pace ? 'Usually sends a deal every ' + plural(inf.pace, 'day') : 'Usually sends a deal every week or two') + '. Nothing in ' + inf.lastDays + '.' }) : null;
    if (inf.status === 'Gone quiet') {
      if (talkedDays < 21) return null;
      var big = !!I.top[s.id];
      return mk('quiet', null, { chip: inf.lastDays === null ? 'No deals' : inf.lastDays + ' days', late: true, call: big,
        why: (inf.lastDays === null ? (s.importedAt ? 'No deals logged since you imported it.' : 'Has never sent a deal.') : 'No deal in ' + inf.lastDays + ' days.') + (big ? ' One of your top shops, so call.' : ' ' + lastWord + '.') });
    }
    var every = cadenceDays(s, inf), gap = Math.min(talkedDays, inf.lastDays === null ? Infinity : inf.lastDays);
    if (gap < every) return null;
    var why = lastWord + '. You check in every ' + plural(every, 'day') + '.';
    return (inf.quality === 'poor' && mk('declines', null, { chip: 'Check-in', why: 'Most of their deals get declined, ' + (inf.decided - inf.appr) + ' of ' + inf.decided + ' in 90 days. ' + why })) || mk('checkin', null, { chip: 'Check-in', why: why });
  }
  // Today's list. Deal news always shows. Check-ins are capped per day, counting the ones already
  // handled today, so the list ends; the rest wait for tomorrow, new shops and the biggest first.
  function touches() {
    if (I.auto) return I.auto;
    var news = [], rel = [], doneToday = 0;
    I.shops.forEach(function (s) {
      if (s.repId !== ME) return;
      (s.touches || []).forEach(function (x) { if (RULE[x.rule] && RULE[x.rule].group === 'shop' && daysSince(x.at) === 0) doneToday++; });
      var t = touchFor(s); if (t) (RULE[t.rule].group === 'deal' ? news : rel).push(t);
    });
    var order = function (a, b) { return RULE_IDX[a.rule] - RULE_IDX[b.rule] || b.value - a.value || (a.s.name < b.s.name ? -1 : 1); };
    news.sort(order); rel.sort(order);
    var room = Math.max(0, autoSet().perDay - doneToday);
    return (I.auto = { news: news, rel: rel.slice(0, room), waiting: rel.slice(room), doneToday: doneToday, all: news.concat(rel.slice(0, room)) });
  }
  function findTouch(id) { var tt = touches(); return tt.all.concat(tt.waiting).filter(function (x) { return x.id === id; })[0] || null; }
  function touchText(t) { var d = UI.drafts['touch:' + t.id]; return d !== undefined ? d : fillText(ruleText(t.rule), { c: t.c, s: t.s, d: t.d }); }
  // When the next automatic follow-up to a shop comes due if nothing else happens first. Deal news
  // cannot be predicted, so this is the relationship side only.
  function nextAuto(s) {
    if (s.repId !== ME) return null;
    var t = touchFor(s);
    if (t) return { today: true, t: t };
    if (s.paused || s.autoFU === 'off') return null;
    var sn = (s.touches || []).filter(function (x) { return x.how === 'later' && dueAt(x) > new Date(); })[0];
    if (sn) return { due: sn.due };
    var inf = shopInfo(s), h = lastHandled(s, function (x) { return RULE[x.rule] && RULE[x.rule].group === 'shop'; });
    var touched = [inf.talked, h && h.at].filter(Boolean).sort().pop() || null, talkedDays = touched ? daysSince(touched) : 0;
    var wait = inf.status === 'Slowing down' ? 5 - talkedDays : inf.status === 'Gone quiet' ? 21 - talkedDays : inf.status === 'New' && !s.importedAt ? 4 - talkedDays
      : cadenceDays(s, inf) - Math.min(talkedDays, inf.lastDays === null ? talkedDays : inf.lastDays);
    return { due: A.dayOffset(Math.max(1, wait)) };
  }
  function markTouch(t, how, extra) {
    var s = DB.shops[t.s.id];
    s.touches = (s.touches || []).filter(function (x) { return !(x.how === 'later' && x.rule === t.rule && x.key === t.key); });
    s.touches.unshift(Object.assign({ id: uid('t'), rule: t.rule, key: t.key, how: how, at: nowISO() }, extra || {}));
    if (s.touches.length > 80) s.touches.length = 80;
  }
  function sendTouch(id, how) {
    var t = findTouch(id); if (!t) return null;
    var text = touchText(t).trim();
    if (!text) { toast('Write the text first', { bad: true }); return null; }
    var before = { s: clone(t.s), d: t.d ? clone(t.d) : null }, mid = uid('m');
    put('msgs', { id: mid, phone: t.c.phone, dir: 'out', kind: 'text', text: text, outcome: null, duration: 0, at: nowISO(), read: true, spam: false, via: LIVE ? 'phone' : '' });
    markTouch(t, 'sent');
    if (t.d) { log(DB.deals[t.d.id], 'text', 'Texted ' + first(t.c.name) + ': ' + text); put('deals', DB.deals[t.d.id]); }
    put('shops', DB.shops[t.s.id]);
    delete UI.drafts['touch:' + id]; if (UI.editTouch === id) UI.editTouch = null;
    if (LIVE) { copyText(text); if (how === 'sms') openLink(smsLink(digits(t.c.phone), text)); }
    return { t: t, undo: function () { remove('msgs', mid); put('shops', before.s); if (before.d) put('deals', before.d); render(); },
      msg: LIVE ? (how === 'sms' ? 'Opened Messages for ' + first(t.c.name) + '.' : 'Copied. Paste it into Connect UC and hit send.') : 'Sent to ' + first(t.c.name) + ' at ' + t.s.name + '.' };
  }
  function laterTouch(t, due, time) { var before = clone(t.s); markTouch(t, 'later', { due: due, time: time }); put('shops', DB.shops[t.s.id]); return function () { put('shops', before); render(); }; }
  function skipTouch(t, reason) {
    var before = clone(t.s); markTouch(t, 'skipped', { reason: reason });
    var s = DB.shops[t.s.id];
    if (reason === 'off') { s.autoFU = 'off'; log(s, 'system', 'Automatic follow-ups turned off.'); }
    put('shops', s);
    return function () { put('shops', before); render(); };
  }

  // ---------- follow-ups ----------
  function dueAt(f) { var d = parseDay(f.due), t = (f.time || '09:00').split(':'); d.setHours(+t[0], +t[1] || 0, 0, 0); return d; }
  function fuIsDue(f) { return dueAt(f) <= new Date(); }
  function openFUs(rec) { return (rec.followUps || []).filter(function (f) { return !f.doneAt; }).sort(function (a, b) { return dueAt(a) - dueAt(b); }); }
  function fuLabel(f) {
    var n = dueDiff(f.due), t = f.time ? ' ' + fmtTime(f.time) : '';
    if (n < -1) return (-n) + ' days late';
    if (n === -1) return 'Yesterday' + t;
    if (n === 0) return 'Today' + t;
    if (n === 1) return 'Tomorrow' + t;
    if (n < 7) return parseDay(f.due).toLocaleDateString('en-US', { weekday: 'long' }) + t;
    return parseDay(f.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + t;
  }
  function repeatLabel(r) { var x = A.REPEATS.filter(function (y) { return y[0] === (r || ''); })[0]; return x ? x[1] : ''; }
  function myFUs() {
    var out = [];
    I.shops.forEach(function (s) { openFUs(s).forEach(function (f) { if (s.repId === ME || f.by === ME) out.push({ type: 'shop', rec: s, f: f }); }); });
    I.deals.forEach(function (d) { openFUs(d).forEach(function (f) { if (ownerOf(d) === ME || f.by === ME) out.push({ type: 'deal', rec: d, f: f }); }); });
    return out.sort(function (a, b) { return dueAt(a.f) - dueAt(b.f); });
  }
  function findFU(type, id, fid) { var r = recOf(type, id); return r ? (r.followUps || []).filter(function (f) { return f.id === fid; })[0] : null; }
  function quickTimes() {
    var now = new Date(), h = new Date(now.getTime() + 3600000), out = [];
    h.setMinutes(Math.ceil(h.getMinutes() / 15) * 15, 0, 0);
    if (dayStart(h).getTime() === A.TODAY.getTime() && h.getHours() >= 7 && h.getHours() < 21) out.push({ label: 'In an hour', due: A.dateOnly(h), time: hhmm(h) });
    out.push({ label: 'Tomorrow 9 AM', due: A.dayOffset(1), time: '09:00' });
    out.push({ label: 'In 3 days', due: A.dayOffset(3), time: '09:00' });
    out.push({ label: 'Next Monday', due: A.dayOffset(((8 - A.TODAY.getDay()) % 7) || 7), time: '09:00' });
    return out;
  }

  // ---------- phone ----------
  function bestContact(shop) {
    if (!shop || !shop.contacts.length) return null;
    var best = null, bestAt = '';
    shop.contacts.forEach(function (c) { if (!digits(c.phone)) return; var cv = I.convByKey[digits(c.phone)]; var at = cv ? cv.last.at : ''; if (!best || at > bestAt) { best = c; bestAt = at; } });
    return best || shop.contacts[0];
  }
  function dealContact(d) { var s = shopOf(d); if (!s) return null; return s.contacts.filter(function (c) { return c.id === d.contactId; })[0] || bestContact(s); }
  function contactFor(type, rec) { return type === 'shop' ? bestContact(rec) : dealContact(rec); }
  function convFor(key) { return I.convByKey[key] || { key: key, phone: fmtPhone(key), who: I.byPhone[key] || null, msgs: [], unread: 0, spam: false }; }
  function convName(c) { return c.who ? c.who.contact.name : fmtPhone(c.phone); }
  // On a wide screen, Messages opens on the newest real conversation instead of an empty pane.
  function ensureConv() {
    if (UI.view !== 'messages' || UI.conv || window.innerWidth <= 760) return;
    buildIndex();
    var c = I.convs.filter(function (x) { return UI.convFilter === 'unknown' ? !x.who : UI.convFilter === 'unread' ? x.who && x.unread : !x.spam; })[0];
    if (c) { UI.conv = c.key; markRead(c.key); }
  }
  function markRead(key) {
    vals(DB.msgs).forEach(function (m) { if (digits(m.phone) === key && m.dir === 'in' && !m.read) { m.read = true; put('msgs', m); } });
  }

  // ---------- toast, tooltip ----------
  var toastTimer = null;
  function toast(msg, opt) {
    opt = opt || {};
    var root = document.getElementById('toast-root');
    clearTimeout(toastTimer);
    root.innerHTML = '<div class="toast' + (opt.bad ? ' bad' : '') + '" role="status"><span>' + esc(msg) + '</span>' +
      (opt.action ? '<button data-act="toast-action">' + esc(opt.action.label) + '</button>' : '') +
      (opt.undo ? '<button data-act="toast-undo">Undo</button>' : '') + '</div>';
    root._undo = opt.undo || null; root._action = opt.action ? opt.action.fn : null;
    toastTimer = setTimeout(function () { root.innerHTML = ''; root._undo = null; root._action = null; }, opt.action || opt.undo ? 7000 : 3500);
  }
  var tipEl = null;
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { if (tipEl) tipEl.style.display = 'none'; return; }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = t.getAttribute('data-tip'); tipEl.style.display = 'block';
    var r = t.getBoundingClientRect(), w = tipEl.offsetWidth, hgt = tipEl.offsetHeight;
    tipEl.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + 'px';
    var top = r.top - hgt - 8; tipEl.style.top = (top < 8 ? r.bottom + 8 : top) + 'px';
  });
  document.addEventListener('scroll', function () { if (tipEl) tipEl.style.display = 'none'; }, true);

  // ================= RENDER =================
  function render() {
    buildIndex();
    renderTop(); renderMain(); renderDrawer(); renderModal(); renderCall(); renderSheet(); renderAlerts();
    if (pop) renderPop();
    window.__ISO_READY = true;
  }
  var deferred = false;
  function typing() { var a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT'); }
  function softRender() { if (typing() || pressing) { deferred = true; return; } render(); }
  // A sync that lands while typing waits. It must also wait out a click in progress, or the
  // re-render swaps the button out between mousedown and mouseup and the click is lost.
  var downAt = null, pressing = false;
  document.addEventListener('mousedown', function (e) { downAt = e.target; pressing = true; }, true);
  document.addEventListener('mouseup', function () { pressing = false; if (deferred) setTimeout(flushDeferred, 0); }, true);
  function flushDeferred() { if (deferred && !typing() && !pressing) { deferred = false; render(); } }
  document.addEventListener('focusout', function () { if (deferred) setTimeout(flushDeferred, 0); });

  // ---------- top bar ----------
  function renderTop() {
    var fus = myFUs(), tt = touches();
    var today = fus.filter(function (x) { return dueDiff(x.f.due) <= 0; }).length + tt.all.length, dueNow = fus.filter(function (x) { return fuIsDue(x.f); }).length + tt.news.length;
    var unread = sum(I.convs.filter(function (c) { return c.who; }), function (c) { return c.unread; });
    var items = [['today', 'Today', today, dueNow > 0], ['messages', 'Messages', unread, unread > 0], ['shops', 'Shops'], ['deals', 'Deals']];
    if (LIVE) items.splice(1, 1); // texts and calls happen on Josh's phone until his line is connected
    var meBtn = document.querySelector('.me');
    var meName = LIVE ? (SESSION ? SESSION.user.name : '') : pname(ME);
    if (meBtn && meName) { meBtn.innerHTML = '<span class="av">' + esc(initials(meName)) + '</span><span>' + esc(meName) + '</span>'; if (meBtn.setAttribute) meBtn.setAttribute('aria-label', meName + ', menu'); }
    document.getElementById('nav').innerHTML = items.map(function (it) {
      return '<button data-act="nav" data-v="' + it[0] + '" class="' + (UI.view === it[0] ? 'on' : '') + '">' + it[1] + (it[2] ? '<span class="badge' + (it[3] ? ' hot' : '') + '">' + it[2] + '</span>' : '') + '</button>';
    }).join('');
    document.getElementById('modepill').innerHTML = mode === 'local' ? '<span class="pill warn" data-tip="The shared save service is not reachable from here, so edits stay in this browser.">Saving in this browser only</span>' : '';
  }

  // ---------- main ----------
  function renderMain() {
    var main = document.getElementById('main');
    var board = main.querySelector('.board');
    var keep = board ? { left: board.scrollLeft, cols: Array.prototype.map.call(board.querySelectorAll('.col-body'), function (c) { return c.scrollTop; }) } : null;
    if (LIVE && UI.view === 'messages') UI.view = 'today';
    var html = UI.view === 'deals' ? viewDeals() : UI.view === 'shops' ? viewShops() : UI.view === 'messages' ? viewMessages() : viewToday();
    main.innerHTML = '<div class="page page-' + UI.view + '">' + html + '</div>';
    var nb = main.querySelector('.board');
    if (nb && keep) { nb.scrollLeft = keep.left; Array.prototype.forEach.call(nb.querySelectorAll('.col-body'), function (c, i) { c.scrollTop = keep.cols[i] || 0; }); }
    var nt = main.querySelector('.th-body'); if (nt) nt.scrollTop = nt.scrollHeight;
  }
  function pageHead(title, sub, right) {
    return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right ? '<div class="filters">' + right + '</div>' : '') + '</div>';
  }
  function ib(icon, tip, act, attrs, cls) { return '<button class="ib' + (cls ? ' ' + cls : '') + '" data-act="' + act + '" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '"' + (attrs || '') + '>' + ICON[icon] + '</button>'; }
  function callText(c, type, id, fid) {
    if (!c || !c.phone) return '';
    var a = ' data-phone="' + esc(c.phone) + '" data-type="' + (type || '') + '" data-id="' + (id || '') + '"' + (fid ? ' data-fid="' + esc(fid) + '"' : '');
    return ib('phone', 'Call ' + first(c.name), 'call', a) + ib('msg', 'Text ' + first(c.name), 'text', a);
  }
  function fuAttrs(type, id, fid) { return ' data-type="' + esc(type) + '" data-id="' + esc(id) + '" data-fid="' + esc(fid) + '"'; }

  // ---------- TODAY ----------
  // One list of everyone to reach today: the follow-ups you set, then what the desk wrote for you.
  // Below it, deal work only you can do, and housekeeping folded into one line.
  function viewToday() {
    var fus = myFUs();
    var due = fus.filter(function (x) { return dueDiff(x.f.due) <= 0; });
    var upcoming = fus.filter(function (x) { var n = dueDiff(x.f.due); return n > 0 && n <= 7; });
    var tt = touches(), texts = tt.all.filter(function (t) { return !t.call; }), calls = tt.all.filter(function (t) { return t.call; });
    var news = texts.filter(function (t) { return RULE[t.rule].group === 'deal'; }), checks = texts.filter(function (t) { return RULE[t.rule].group === 'shop'; });
    var total = due.length + tt.all.length;
    var date = A.TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    var sub = date + '. ' + (total ? plural(total, 'follow-up') + ' today' + (texts.length ? ', ' + texts.length + ' already written for you' : '') + '.' : 'Nothing to follow up on today.');
    var html = pageHead('Today', esc(sub), LIVE ? alertsBtn() : desktopBtn()) + (LIVE ? setupCard() : '');
    var group = function (id, title, n, note, body) { return '<div class="tgroup" id="tg-' + id + '"><div class="tgroup-h"><h3>' + esc(title) + '<span class="cnt">' + n + '</span></h3><span>' + esc(note) + '</span></div><div class="rows">' + body + '</div></div>'; };
    var capped = function (id, list, fn) { var all = UI.more === id, rows = (all ? list : list.slice(0, 8)).map(fn).join(''); return rows + (list.length > 8 && !all ? '<button class="more-line" data-act="more" data-v="' + id + '">Show the other ' + (list.length - 8) + '</button>' : ''); };
    var body = '';
    if (due.length || upcoming.length) body += group('mine', 'Follow-ups you set', due.length, 'Due today or late.', (due.length ? due.map(fuRow).join('') : '<div class="empty-line">None due today.</div>') +
      (upcoming.length ? '<button class="more-line" data-act="toggle-upcoming">' + (UI.showUpcoming ? 'Hide the rest of the week' : upcoming.length + ' more later this week') + '</button>' + (UI.showUpcoming ? upcoming.map(fuRow).join('') : '') : ''));
    if (news.length) body += group('news', 'About their deals', news.length, 'News the shop needs from you. Written for you: read it and send.', capped('news', news, touchRow));
    if (checks.length || tt.waiting.length) body += group('checks', 'Check-ins', checks.length, 'Shops due a word from you. New shops first, then slowing down, gone quiet and regular check-ins, biggest first.',
      (checks.length ? capped('checks', checks, touchRow) : '<div class="empty-line">You did ' + plural(tt.doneToday, 'check-in') + ' today, your daily limit.</div>') +
      (tt.waiting.length ? '<button class="more-line" data-act="toggle-waiting">' + (UI.showWaiting ? 'Hide the ones that can wait' : plural(tt.waiting.length, 'more shop') + ' can wait until tomorrow. Show them') + '</button>' + (UI.showWaiting ? tt.waiting.map(touchRow).join('') : '') : ''));
    if (calls.length) body += group('calls', 'Worth a call', calls.length, 'Top shops that went quiet. A call lands better than a text.', calls.map(touchRow).join(''));
    html += '<section class="panel tsec" id="t-reach" data-spec-id="today-reach"><div class="panel-head"><h2>Follow-ups<span class="cnt">' + total + '</span></h2><div class="acts">' +
      '<button class="btn sm ghost" data-act="how-picked">How these are picked</button>' + (texts.length ? '<button class="btn sm primary" data-act="review-open" data-spec-id="review-open">Go through the ' + plural(texts.length, 'text') + '</button>' : '') + '</div></div>' +
      (body || '<div class="empty-line">Nothing to follow up on today. The desk adds follow-ups here as deals move and shops go quiet.</div>') + '</section>';
    var m = LIVE ? { rows: [] } : messageRows();
    if (m.rows.length) html += section('msg', 'Messages', m.count, '<button class="btn sm ghost" data-act="nav" data-v="messages">Open messages</button>', m.rows.join(''));
    var wr = waitingOnYou();
    if (wr.length) html += section('deals', 'Deals waiting on you', wr.length, '', capped('deals', wr, todoRow));
    html += tidySection();
    return html;
  }
  // A follow-up the desk wrote. The text shows in full on hover, opens for editing on click, and
  // Send, Later and Skip sit on the row. A call has Call instead of a text.
  function touchRow(t) {
    var text = touchText(t), editing = UI.editTouch === t.id, k = ' data-k="' + esc(t.id) + '"';
    var draft = t.call ? '' : editing ? '<textarea class="t-edit" data-in="touch"' + k + ' rows="3" aria-label="Text to ' + esc(first(t.c.name)) + '">' + esc(text) + '</textarea>'
      : '<button class="t-draft" data-act="touch-edit"' + k + ' data-tip="' + esc(text) + '"><span>' + esc(text) + '</span></button>';
    var go = t.call ? '<button class="btn sm" data-act="call" data-phone="' + esc(t.c.phone) + '" data-type="shop" data-id="' + esc(t.s.id) + '" data-touch="' + esc(t.id) + '">' + ICON.phone + 'Call ' + esc(first(t.c.name)) + '</button>'
      : '<button class="btn sm" data-act="touch-send"' + k + '>' + ICON.send + (LIVE ? 'Copy text' : 'Send') + '</button>';
    return '<div class="row trow touch click" data-act="open" data-type="' + (t.d ? 'deal' : 'shop') + '" data-id="' + esc(t.d ? t.d.id : t.s.id) + '">' +
      '<div class="when' + (t.late ? ' due' : '') + '">' + esc(t.chip) + '</div>' +
      '<div class="main"><b>' + esc(t.s.name) + '</b> <span class="muted">' + esc(t.c.name) + '</span><div class="sub">' + esc(t.why) + '</div>' + draft + '</div>' +
      '<div class="acts">' + go + '<button class="btn sm ghost" data-act="touch-later"' + k + '>Later</button><button class="btn sm ghost" data-act="touch-skip"' + k + '>Skip</button></div></div>';
  }
  function section(id, title, count, right, body) {
    return '<section class="panel tsec" id="t-' + id + '" data-spec-id="today-' + id + '"><div class="panel-head"><h2>' + esc(title) + (count ? '<span class="cnt">' + count + '</span>' : '') + '</h2>' + right + '</div><div class="rows">' + body + '</div></section>';
  }
  function alertsBtn() { return UI.push ? '' : '<button class="btn sm ghost" data-act="push-on" data-spec-id="desktop-alerts">' + ICON.clock + 'Turn on alerts</button>'; }
  function setupCard() {
    var st = S().setup || {}, hasShops = I.shops.length > 0;
    if (st.hidden || (hasShops && UI.push && st.phoneAck)) return '';
    var n = 0, row = function (done, title, sub, btn) {
      n++;
      return '<div class="row trow setup-row' + (done ? ' done' : '') + '"><div class="when">' + (done ? ICON.check + ' Done' : '<span class="step-n">' + n + '</span>') + '</div><div class="main"><b>' + esc(title) + '</b><div class="sub">' + esc(sub) + '</div></div><div class="acts">' + (done ? '' : btn) + '</div></div>';
    };
    return section('setup', 'Get set up', 0, '<button class="btn sm ghost" data-act="setup-hide">Hide</button>',
      row(hasShops, 'Bring in your shops and contacts', 'From your phone, a spreadsheet or a SmartMCA export. Shops already here are matched, not doubled.', '<button class="btn sm primary" data-act="import-open">Import</button>') +
      row(UI.push, 'Turn on follow-up alerts', 'Click Turn on, then Allow. Alerts pop up on this computer when a follow-up is due, even with the desk closed.', '<button class="btn sm" data-act="push-on">Turn on</button>') +
      row(!!st.phoneAck, 'Calls and texts', 'Call opens Connect UC with the number ready. Text copies your message to paste into Connect UC. The desk logs both.', '<button class="btn sm" data-act="setup-phone-ok">Got it</button>'));
  }
  function desktopBtn() {
    if (!('Notification' in window)) return '';
    var on = UI.desktop && Notification.permission === 'granted';
    return '<button class="btn sm ghost" data-act="desktop-toggle" data-spec-id="desktop-alerts">' + ICON.clock + (on ? 'Desktop alerts on' : 'Turn on desktop alerts') + '</button>';
  }
  function fuRow(x) {
    var due = fuIsDue(x.f), name = recName(x.type, x.rec);
    var sub = (x.f.note || 'Follow up') + (x.f.repeat ? ' (' + repeatLabel(x.f.repeat).toLowerCase() + ')' : '');
    var c = contactFor(x.type, x.rec);
    return '<div class="row trow click" data-act="open" data-type="' + x.type + '" data-id="' + esc(x.rec.id) + '">' +
      '<div class="when' + (due ? ' due' : '') + '">' + esc(fuLabel(x.f)) + '</div>' +
      '<div class="main"><b>' + esc(name) + '</b>' + (x.type === 'deal' ? ' <span class="muted">' + esc((shopOf(x.rec) || {}).name || '') + '</span>' : '') + '<div class="sub">' + esc(sub) + '</div></div>' +
      '<div class="acts">' + callText(c, x.type, x.rec.id, x.f.id) + '<button class="btn sm ghost" data-act="fu-later"' + fuAttrs(x.type, x.rec.id, x.f.id) + '>Later</button>' +
      '<button class="btn sm done-btn" data-act="fu-done"' + fuAttrs(x.type, x.rec.id, x.f.id) + '>' + ICON.check + 'Done</button></div></div>';
  }
  function todoRow(x) {
    var c = contactFor(x.type, x.rec);
    return '<div class="row trow click" data-act="open" data-type="' + x.type + '" data-id="' + esc(x.rec.id) + '"' + (x.tab ? ' data-tab="' + x.tab + '"' : '') + '>' +
      '<div class="when' + (x.late ? ' due' : '') + '">' + esc(x.when || '') + '</div>' +
      '<div class="main"><b>' + esc(recName(x.type, x.rec)) + '</b><div class="sub">' + esc(x.sub) + '</div></div>' +
      '<div class="acts">' + callText(c, x.type, x.rec.id) + (x.btn ? '<button class="btn sm" data-act="' + x.btn.act + '" data-type="' + x.type + '" data-id="' + esc(x.rec.id) + '">' + esc(x.btn.label) + '</button>' : '') + '</div></div>';
  }
  function messageRows() {
    var rows = [], count = 0;
    I.convs.forEach(function (c) {
      if (!c.who || !c.unread) return;
      count++;
      var m = c.last, missed = m.kind === 'call' && m.outcome === 'Missed';
      var a = ' data-phone="' + esc(c.phone) + '" data-type="shop" data-id="' + esc(c.who.shop.id) + '"';
      rows.push('<div class="row trow click" data-act="conv-open" data-v="' + esc(c.key) + '"><div class="when due">' + esc(minsAgo(m.at)) + '</div>' +
        '<div class="main"><b>' + esc(c.who.contact.name) + '</b> <span class="muted">' + esc(c.who.shop.name) + '</span><div class="sub">' + (missed ? '<span class="bad">Missed call</span>' : esc(m.text)) + '</div></div>' +
        '<div class="acts">' + ib('phone', 'Call back', 'call', a) + '<button class="btn sm" data-act="text"' + a + '>' + ICON.msg + 'Reply</button></div></div>');
    });
    var unknown = 0; I.convs.forEach(function (c) { if (!c.who) unknown += c.msgs.filter(function (m) { return m.dir === 'in' && m.kind === 'call' && daysSince(m.at) === 0; }).length; });
    if (unknown) rows.push('<div class="row trow"><div class="when">Today</div><div class="main"><b>' + plural(unknown, 'call') + ' from numbers not in your contacts</b><div class="sub">They look like the spam calls. Block them in one click.</div></div><div class="acts"><button class="btn sm" data-act="review-unknown">Review</button></div></div>');
    return { rows: rows, count: count + (unknown ? 1 : 0) };
  }
  // Deal steps nobody else can take: an approval with no offer written down, a complete file to send on.
  function waitingOnYou() {
    var out = [];
    I.deals.forEach(function (d) {
      if (ownerOf(d) !== ME) return;
      var s = shopOf(d) || { name: 'the shop' };
      if (d.stage === 'approved' && !d.offers.length) out.push({ type: 'deal', rec: d, tab: 'offers', when: 'Approved', sub: 'Record the offer underwriting sent, so the desk can follow it with ' + s.name + '.', k: 1 });
      else if (d.stage === 'submitted' && !fileMissing(d).length) out.push({ type: 'deal', rec: d, tab: 'paperwork', when: 'New', sub: 'Complete file from ' + s.name + '. Send it to underwriting.', btn: { act: 'to-uw', label: 'Send to underwriting' }, k: 0 });
    });
    return out.sort(function (a, b) { return b.k - a.k; });
  }
  // Housekeeping that keeps the book honest: duplicate shops, unsigned agreements, shops nobody has.
  // Folded into one line, since none of it is a person waiting on you.
  function tidyItems() {
    var out = [];
    I.shops.forEach(function (s) {
      var inf = shopInfo(s);
      if (s.repId === ME && inf.dups.length) {
        var o = DB.shops[inf.dups[0]];
        if (s.id < o.id || o.repId !== ME) out.push({ k: 'dup', type: 'shop', rec: s, when: 'Duplicate', sub: 'Same shop as ' + o.name + (o.repId ? ' (' + whose(o.repId).toLowerCase() + ')' : ', which nobody looks after') + '.', btn: { act: 'merge-open', label: 'Merge them' } });
        return;
      }
      if (s.repId === ME && !s.agreementAt && !s.importedAt) out.push({ k: 'sign', type: 'shop', rec: s, when: 'No agreement', sub: 'No signed ISO agreement yet. Commission cannot be paid until it is.', btn: { act: 'agree-signed', label: 'Mark signed' } });
      else if (!s.repId && !inf.dups.length) out.push({ k: 'none', type: 'shop', rec: s, when: 'Unassigned', sub: 'Nobody looks after this shop yet.' + (inf.deals.length ? ' ' + plural(inf.deals.length, 'deal') + ' on file.' : ''), btn: { act: 'take-shop', label: 'Take it' } });
    });
    return out;
  }
  function tidySection() {
    var list = tidyItems(); if (!list.length) return '';
    var n = function (k) { return list.filter(function (x) { return x.k === k; }).length; };
    var parts = [n('dup') ? plural(n('dup'), 'duplicate shop') : '', n('sign') ? plural(n('sign'), 'unsigned agreement') : '', n('none') ? plural(n('none'), 'shop') + ' with nobody on it' : ''].filter(Boolean);
    return '<section class="panel tsec tidy" id="t-tidy" data-spec-id="today-tidy"><button class="tidy-h" data-act="toggle-tidy" aria-expanded="' + !!UI.showTidy + '"><b>Tidy up</b><span class="cnt">' + list.length + '</span><span class="muted">' + esc(cap(words(parts))) + '</span><span class="sp"></span><span class="link">' + (UI.showTidy ? 'Hide' : 'Show') + '</span></button>' +
      (UI.showTidy ? '<div class="rows">' + list.map(todoRow).join('') + '</div>' : '') + '</section>';
  }

  // ---------- MESSAGES ----------
  function viewMessages() {
    var f = UI.convFilter;
    var list = I.convs.filter(function (c) { return f === 'unread' ? c.who && c.unread > 0 : f === 'unknown' ? !c.who : !c.spam; });
    var nUnread = I.convs.filter(function (c) { return c.who && c.unread > 0; }).length, nUnknown = I.convs.filter(function (c) { return !c.who; }).length;
    var seg = '<div class="seg">' + [['all', 'All'], ['unread', 'Unread' + (nUnread ? ' (' + nUnread + ')' : '')], ['unknown', 'Not in contacts' + (nUnknown ? ' (' + nUnknown + ')' : '')]].map(function (x) {
      return '<button class="' + (f === x[0] ? 'on' : '') + '" data-act="conv-filter" data-v="' + x[0] + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    var cur = UI.conv ? convFor(UI.conv) : null;
    var left = list.length ? list.map(function (c) {
      var m = c.last;
      var prev = m.kind === 'call' ? (m.outcome === 'Missed' ? 'Missed call' : (m.dir === 'out' ? 'You called' : 'They called') + (m.duration ? ', ' + fmtDur(m.duration) : '')) : (m.dir === 'out' ? 'You: ' : '') + m.text;
      return '<button class="conv' + (cur && cur.key === c.key ? ' on' : '') + (c.unread ? ' unread' : '') + '" data-act="conv-open" data-v="' + esc(c.key) + '"><span class="av' + (c.who ? '' : ' none') + '">' + (c.who ? esc(initials(c.who.contact.name)) : '#') + '</span>' +
        '<span class="cv-main"><span class="cv-top"><b>' + esc(convName(c)) + '</b><span class="t">' + esc(minsAgo(m.at)) + '</span></span><span class="cv-sub">' + esc(c.who ? c.who.shop.name : (c.spam ? 'Likely spam' : 'Not in your contacts')) + '</span><span class="cv-prev' + (m.outcome === 'Missed' ? ' bad' : '') + '">' + esc(prev) + '</span></span>' + (c.unread ? '<span class="udot"></span>' : '') + '</button>';
    }).join('') : '<div class="empty-line">Nothing here.</div>';
    return pageHead('Messages', 'Texts and calls on your line, ' + esc(myPhone()) + '.', seg + '<button class="btn primary" data-act="new-text" data-spec-id="new-text">' + ICON.msg + 'New text</button>') +
      '<div class="msgs' + (cur ? ' has-cur' : '') + '" data-spec-id="messages"><div class="conv-list panel">' + left + '</div><div class="conv-pane panel">' + (cur ? threadPane(cur, 'pane') : '<div class="empty-pane">Pick a conversation on the left.</div>') + '</div></div>';
  }
  function threadPane(c, where) {
    var who = c.who;
    var sub = who ? '<button class="link" data-act="open" data-type="shop" data-id="' + esc(who.shop.id) + '">' + esc(who.shop.name) + '</button><span>' + esc(fmtPhone(c.phone)) + '</span>' : '<span>' + (c.spam ? 'Likely spam' : 'Not in your contacts') + '</span>';
    var acts = (who ? '' : '<button class="btn sm" data-act="add-contact-from" data-v="' + esc(c.key) + '">Add to a shop</button><button class="btn sm danger" data-act="block" data-v="' + esc(c.key) + '">Block number</button>') +
      '<button class="btn sm" data-act="call" data-phone="' + esc(c.phone) + '"' + (who ? ' data-type="shop" data-id="' + esc(who.shop.id) + '"' : '') + '>' + ICON.phone + 'Call</button>' +
      (where === 'sheet' ? '<button class="x" data-act="sheet-close" aria-label="Close">' + ICON.x + '</button>' : '');
    return '<div class="th-head">' + (where === 'pane' ? '<button class="ib mobile-only" data-act="conv-close" aria-label="Back">' + ICON.back + '</button>' : '') +
      '<div class="th-who"><b>' + esc(convName(c)) + '</b><span class="th-sub">' + sub + '</span></div><div class="th-acts">' + acts + '</div></div>' +
      '<div class="th-body' + (c.msgs.length ? '' : ' none') + '">' + (c.msgs.length ? c.msgs.slice(-60).map(bubble).join('') : '<div class="th-empty">No texts with ' + esc(c.who ? first(c.who.contact.name) : 'this number') + ' yet. Pick a template or write one below.</div>') + '</div>' + (c.spam ? '<div class="th-comp spam-note">This number looks like the spam calls. Block it and it stops showing up here.</div>' : composer(c));
  }
  function bubble(m) {
    if (m.kind === 'call') {
      var what = m.dir === 'in' ? (m.outcome === 'Missed' ? 'Missed call' : 'They called') : 'You called';
      return '<div class="th-call' + (m.outcome === 'Missed' ? ' bad' : '') + '">' + ICON.phone + '<span>' + what + (m.duration ? ', ' + fmtDur(m.duration) : '') + (m.dir === 'out' && m.outcome ? ', ' + esc(m.outcome.toLowerCase()) : '') + '. ' + esc(timeText(m.at)) + '</span>' + (m.text ? '<div class="th-note">' + esc(m.text) + '</div>' : '') + '</div>';
    }
    return '<div class="bub ' + m.dir + '"><div class="b">' + esc(m.text) + '</div><div class="t">' + esc(timeText(m.at)) + '</div></div>';
  }
  function composer(c) {
    var tpls = c.who ? (S().templates || []) : [];
    return '<div class="th-comp">' + (tpls.length ? '<div class="tpls">' + tpls.map(function (t) { return '<button class="chip" data-act="tpl" data-v="' + esc(t.id) + '" data-key="' + esc(c.key) + '">' + esc(t.name) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="th-row"><textarea data-in="sms" data-key="' + esc(c.key) + '" rows="2" placeholder="Text ' + esc(c.who ? first(c.who.contact.name) : fmtPhone(c.phone)) + '">' + esc(UI.drafts['sms:' + c.key] || '') + '</textarea>' +
      (LIVE ? '<div class="send-col"><button class="btn primary" data-act="send" data-how="copy" data-v="' + esc(c.key) + '">' + ICON.send + 'Copy text</button><button class="link" data-act="send" data-how="sms" data-v="' + esc(c.key) + '">Open in Messages</button></div>'
        : '<button class="btn primary" data-act="send" data-v="' + esc(c.key) + '">' + ICON.send + 'Send</button>') + '</div><div class="th-from">' + (LIVE ? 'Copy it, then paste it into Connect UC so it goes out from ' + esc(myPhone()) + '. The desk keeps a copy here.' : 'From your number, ' + esc(myPhone())) + '</div></div>';
  }
  function fillTemplate(text, c) {
    var ctx = sheet && sheet.key === c.key ? sheet.ctx : null;
    var d = ctx && ctx.type === 'deal' ? DB.deals[ctx.id] : null;
    if (!d && c.who) d = (I.dealsByShop[c.who.shop.id] || []).filter(function (x) { return OPEN.indexOf(x.stage) >= 0; }).sort(function (a, b) { return a.stageAt < b.stageAt ? 1 : -1; })[0] || null;
    return fillText(text, { c: c.who ? c.who.contact : null, s: c.who ? c.who.shop : null, d: d });
  }
  // Fills a template: {first} the person, {me} you, {shop}, {merchant}, {missing} paperwork, {reason} for a decline,
  // {amount} and {commission} on a funded deal, {last} the shop's last deal, {declines} its most common decline reason.
  function fillText(text, x) {
    var d = x.d, inf = x.s ? shopInfo(x.s) : null;
    var miss = d ? (d.stage === 'contracts' ? closingMissing(d).map(function (y) { return y.label.toLowerCase(); }) : fileMissing(d).map(function (y) { return y.short; })) : [];
    var lastDeal = inf && inf.deals.length ? inf.deals.reduce(function (a, b) { return a.submittedAt > b.submittedAt ? a : b; }) : null;
    return text.replace(/\{first\}/g, x.c ? first(x.c.name) : 'there').replace(/\{shop\}/g, x.s ? x.s.name : 'your shop').replace(/\{me\}/g, first(pname(ME)))
      .replace(/\{merchant\}/g, d ? d.merchant.business : 'the deal').replace(/\{missing\}/g, miss.length ? words(miss) : 'paperwork')
      .replace(/\{reason\}/g, d && d.closed ? d.closed.reason.toLowerCase() + (d.closed.note ? '. ' + d.closed.note : '') : 'it did not fit our box')
      .replace(/\{amount\}/g, d ? money(d.funded ? d.funded.amount : d.requested) : 'the amount').replace(/\{commission\}/g, d && d.funded ? money(A.commission(d.funded)) : 'your commission')
      .replace(/\{last\}/g, lastDeal ? lastDeal.merchant.business : 'a while').replace(/\{declines\}/g, inf && inf.topDecline ? inf.topDecline.toLowerCase() : 'our guidelines');
  }

  // ---------- SHOPS ----------
  var STATUSES = ['Active', 'Slowing down', 'Gone quiet', 'New', 'Paused'];
  // The book at a glance. The status strip splits every shop into one state, and each count is the
  // filter for it. Pace, approvals and the next automatic follow-up say how each relationship is going.
  function viewShops() {
    var f = UI.f;
    var book = I.shops.filter(function (s) { return inBook(s.repId); }).map(function (s) { return { s: s, inf: shopInfo(s), fu: openFUs(s)[0] || null, na: nextAuto(s) }; });
    var counts = {}; STATUSES.forEach(function (x) { counts[x] = 0; }); book.forEach(function (x) { counts[x.inf.status]++; });
    var rows = book.filter(function (x) {
      if (f.status.length && f.status.indexOf(x.inf.status) < 0) return false;
      if (f.quality.length && f.quality.indexOf(x.inf.quality) < 0) return false;
      var q = f.q.toLowerCase();
      if (q && x.s.name.toLowerCase().indexOf(q) < 0 && !x.s.contacts.some(function (c) { return c.name.toLowerCase().indexOf(q) >= 0; })) return false;
      return true;
    });
    var nextAt = function (x) { return x.fu ? dueAt(x.fu).getTime() : x.na ? (x.na.today ? A.TODAY.getTime() : parseDay(x.na.due).getTime() + 1) : 9e15; };
    var sorters = {
      last: function (a, b) { return (b.inf.last || '').localeCompare(a.inf.last || ''); },
      name: function (a, b) { return a.s.name.localeCompare(b.s.name); },
      pace: function (a, b) { return (a.inf.pace || 999) - (b.inf.pace || 999); },
      appr: function (a, b) { return (b.inf.decided ? b.inf.appr / b.inf.decided : -1) - (a.inf.decided ? a.inf.appr / a.inf.decided : -1) || b.inf.decided - a.inf.decided; },
      funded: function (a, b) { return b.inf.f90 - a.inf.f90; },
      fu: function (a, b) { return nextAt(a) - nextAt(b); }
    };
    rows.sort(sorters[UI.sort] || sorters.last);
    var right = bookButton() + '<input class="inline-search" data-in="shop-q" type="search" placeholder="Filter shops or people" value="' + esc(f.q) + '" aria-label="Filter shops">' +
      msButton('quality', 'Deals', 'Any approval rate', function () { return QUALITY.map(function (x) { return { v: x[0], l: x[1] }; }); }) +
      '<button class="btn" data-act="import-open" data-spec-id="add-list">Import</button><button class="btn primary" data-act="add-shop" data-spec-id="add-shop">' + ICON.plus + 'Add shop</button>';
    var strip = '<div class="health" data-spec-id="shops-health"><button class="hchip' + (f.status.length ? '' : ' on') + '" data-act="status-all"><b>' + book.length + '</b> ' + (book.length === 1 ? 'shop' : 'shops') + '</button>' +
      STATUSES.map(function (st) { return '<button class="hchip' + (f.status.indexOf(st) >= 0 ? ' on' : '') + '" data-act="status-toggle" data-v="' + esc(st) + '"><b class="' + (counts[st] && (st === 'Slowing down' || st === 'Gone quiet') ? 'warn' : '') + '">' + counts[st] + '</b> ' + esc(st.toLowerCase()) + '</button>'; }).join('') + '</div>';
    var head = '<div class="thead shoprow">' + sortHead('name', 'Shop') + sortHead('pace', 'Sends a deal') + sortHead('last', 'Last deal') + sortHead('appr', 'Approved, 90 days', true) + sortHead('funded', 'Funded, 90 days', true) + sortHead('fu', 'Next follow-up') + '<span></span></div>';
    return pageHead('Shops', bookSub(), right) + strip + readback(rows.length, 'shop') +
      '<div class="panel" data-spec-id="shops-list">' + head + '<div class="rows">' + (rows.length ? rows.map(shopRow).join('') : bookOf() && !I.shops.some(function (s) { return inBook(s.repId); }) ? '<div class="empty-line">No shops in this book.</div>' : !I.shops.some(function (s) { return inBook(s.repId); })
        ? '<div class="empty-sec"><b>No shops yet.</b><span>Bring in your phone contacts or a spreadsheet, or add a shop by hand. Shops already here are matched, never doubled.</span><div class="btn-row"><button class="btn primary" data-act="import-open">Import</button><button class="btn" data-act="add-shop">' + ICON.plus + 'Add shop</button></div></div>'
        : '<div class="empty-line">No shops match. <button class="link" data-act="clear-filters">Clear filters</button></div>') + '</div></div>';
  }
  function sortHead(key, label, right) { return '<button class="sorth' + (right ? ' right' : '') + (UI.sort === key ? ' on' : '') + '" data-act="sort" data-v="' + key + '">' + esc(label) + (UI.sort === key ? ICON.down : '') + '</button>'; }
  function statusPill(inf) {
    return inf.status === 'Gone quiet' ? '<span class="pill warn">Gone quiet</span>' : inf.status === 'Slowing down' ? '<span class="pill warn">Slowing down</span>' : inf.status === 'Paused' ? '<span class="pill bad">Paused</span>' : inf.status === 'New' ? '<span class="pill accent">New</span>' : '';
  }
  function paceText(inf) { return inf.pace ? 'Every ' + plural(inf.pace, 'day') : inf.deals.length ? 'Too few deals' : 'No deals yet'; }
  function dayLabel(due) { return fuLabel({ due: due }); }
  // The next follow-up on a row: yours if you set one, otherwise the automatic one and when it comes up.
  function nextCell(x) {
    var s = x.s;
    if (x.fu) return '<button class="fu-chip' + (fuIsDue(x.fu) ? ' due' : '') + '" data-act="fu-edit"' + fuAttrs('shop', s.id, x.fu.id) + ' data-tip="' + esc(x.fu.note || 'Follow up') + '">' + ICON.clock + esc(fuLabel(x.fu)) + '</button>';
    if (x.na && x.na.today) return '<button class="fu-chip auto today" data-act="review-one" data-k="' + esc(x.na.t.id) + '" data-tip="' + esc(x.na.t.why + ' Click to read the text and send it.') + '">Today, ' + esc(x.na.t.call ? 'call' : 'text ready') + '</button>';
    if (x.na) return '<button class="fu-chip auto" data-act="fu-new-for" data-type="shop" data-id="' + esc(s.id) + '" data-tip="Automatic follow-up. Click to set your own instead.">Auto, ' + esc(lc(dayLabel(x.na.due))) + '</button>';
    if (s.repId === ME && s.autoFU === 'off') return '<button class="fu-set" data-act="fu-new-for" data-type="shop" data-id="' + esc(s.id) + '" data-tip="Automatic follow-ups are off for this shop.">' + ICON.plus + 'Follow-up</button>';
    return '<button class="fu-set" data-act="fu-new-for" data-type="shop" data-id="' + esc(s.id) + '">' + ICON.plus + 'Follow-up</button>';
  }
  function shopRow(x) {
    var s = x.s, inf = x.inf, flags = [];
    if (inf.dups.length) flags.push('<span class="pill warn">Possible duplicate</span>');
    if (!s.agreementAt && !s.importedAt) flags.push('<span class="pill">No signed agreement</span>');
    var c = bestContact(s), late = inf.status === 'Gone quiet' || inf.status === 'Slowing down';
    return '<div class="row shoprow click" data-act="open" data-type="shop" data-id="' + esc(s.id) + '">' +
      '<div class="main"><b>' + esc(s.name) + '</b> ' + statusPill(inf) + ' ' + flags.join(' ') + '<div class="sub">' + esc([s.state, c ? c.name : ''].filter(Boolean).join(', ')) + (bookOf() === 'all' ? ', ' + esc(s.repId === ME ? 'yours' : s.repId ? pname(s.repId) : 'nobody yet') : '') + '</div></div>' +
      '<div class="' + (inf.pace ? '' : 'muted') + '">' + esc(paceText(inf)) + '</div>' +
      '<div class="' + (late ? 'warn' : '') + '">' + (inf.last ? esc(cap(agoText(inf.last))) : '<span class="muted">Never</span>') + '</div>' +
      '<div class="right num' + (inf.quality === 'poor' ? ' bad' : '') + '"' + (inf.decided ? ' data-tip="' + esc(inf.appr + ' approved out of ' + inf.decided + ' decided, from ' + plural(inf.deals.filter(function (d) { return daysSince(d.submittedAt) <= 90; }).length, 'deal') + ' sent in the last 90 days.') + '"' : '') + '>' + (inf.decided ? inf.appr + ' of ' + inf.decided : '<span class="muted">None decided</span>') + '</div>' +
      '<div class="right money-sm">' + (inf.f90 ? money(inf.f90) : '<span class="muted">None</span>') + '</div>' +
      '<div>' + nextCell(x) + '</div>' +
      '<div class="acts">' + callText(c, 'shop', s.id) + '</div></div>';
  }
  function msButton(key, label, anyLabel, optionsFn) {
    var sel = UI.f[key], opts = optionsFn();
    var txt = !sel.length ? anyLabel : sel.length === 1 ? (opts.filter(function (o) { return o.v === sel[0]; })[0] || { l: sel[0] }).l : sel.length + ' selected';
    return '<button class="ms' + (sel.length ? ' on' : '') + '" data-act="ms" data-key="' + key + '">' + esc(label) + ': <b>' + esc(txt) + '</b>' + ICON.down + '</button>';
  }
  function readback(count, noun) {
    var parts = [];
    if (UI.f.shops.length && UI.view === 'deals') parts.push(UI.f.shops.length === 1 && DB.shops[UI.f.shops[0]] ? DB.shops[UI.f.shops[0]].name : UI.f.shops.length + ' shops');
    if (UI.f.since !== 'any' && UI.view === 'deals') parts.push('submitted ' + SINCE.filter(function (s) { return s[0] === UI.f.since; })[0][1].toLowerCase());
    if (UI.view === 'shops' && UI.f.status.length) parts.push(UI.f.status.join(' or ').toLowerCase());
    if (UI.view === 'shops' && UI.f.quality.length) parts.push(QUALITY.filter(function (x) { return UI.f.quality.indexOf(x[0]) >= 0; }).map(function (x) { return x[1]; }).join(' or ').toLowerCase());
    if (UI.view === 'shops' && UI.f.q) parts.push('matching "' + UI.f.q + '"');
    return '<div class="readback"><span><b>' + plural(count, noun) + '</b>' + (parts.length ? ', ' + esc(parts.join(', ')) : '') + '</span>' + (parts.length ? '<button class="link" data-act="clear-filters">Clear filters</button>' : '') + '</div>';
  }

  // ---------- DEALS ----------
  var SINCE = [['any', 'Any time'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['month', 'This month']];
  // The deals in the book on screen: your own, or for a manager whichever book is picked.
  function myDeals() { return I.deals.filter(function (d) { return inBook(ownerOf(d)); }); }
  function filteredDeals() {
    var f = UI.f;
    return myDeals().filter(function (d) {
      if (f.shops.length && f.shops.indexOf(d.shopId) < 0) return false;
      if (f.since === 'month') return new Date(d.submittedAt) >= new Date(A.TODAY.getFullYear(), A.TODAY.getMonth(), 1);
      if (f.since === 'd7') return daysSince(d.submittedAt) < 7;
      if (f.since === 'd30') return daysSince(d.submittedAt) < 30;
      return true;
    });
  }
  function monthNumbers() {
    var start = new Date(A.TODAY.getFullYear(), A.TODAY.getMonth(), 1), mine = myDeals();
    var sub = mine.filter(function (d) { return new Date(d.submittedAt) >= start; });
    var fund = mine.filter(function (d) { return d.funded && new Date(d.funded.fundedAt) >= start; });
    return { sub: sub, appr: sub.filter(function (d) { return d.offers.length || ['approved', 'contracts', 'funded'].indexOf(d.stage) >= 0; }), fund: fund, amt: sum(fund, function (d) { return d.funded.amount; }) };
  }
  function viewDeals() {
    var deals = filteredDeals();
    var cols = A.STAGES.map(function (st) {
      var list = deals.filter(function (d) { return d.stage === st.id && (OPEN.indexOf(st.id) >= 0 || daysSince(d.stageAt) <= 30); });
      list.sort(function (a, b) { return OPEN.indexOf(st.id) >= 0 ? (a.stageAt < b.stageAt ? -1 : 1) : (a.stageAt < b.stageAt ? 1 : -1); });
      return { st: st, list: list };
    });
    var shown = sum(cols, function (c) { return c.list.length; }), mn = monthNumbers();
    var right = bookButton() + msButton('shops', 'Shop', 'Any shop', shopOptions) +
      '<button class="ms' + (UI.f.since !== 'any' ? ' on' : '') + '" data-act="since">Submitted: <b>' + SINCE.filter(function (s) { return s[0] === UI.f.since; })[0][1] + '</b>' + ICON.down + '</button>' +
      '<button class="btn primary" data-act="new-deal" data-spec-id="log-submission">' + ICON.plus + 'Log a submission</button>';
    var month = A.TODAY.toLocaleDateString('en-US', { month: 'long' });
    var sub = month + ' so far: <button class="link" data-act="month-list" data-v="sub">' + plural(mn.sub.length, 'deal') + ' in</button>, <button class="link" data-act="month-list" data-v="appr">' + mn.appr.length + ' approved</button>, <button class="link" data-act="month-list" data-v="fund">' + mn.fund.length + ' funded for ' + money(mn.amt) + '</button>.';
    return pageHead('Deals', sub, right) + readback(shown, 'deal') +
      '<div class="board" data-spec-id="deals-board">' + cols.map(function (c) {
        var amt = sum(c.list, function (d) { return d.funded ? d.funded.amount : d.requested; });
        var note = c.st.id === 'funded' ? (amt ? money(amt) + ', last 30 days' : 'Last 30 days') : c.st.id === 'closed' ? 'Last 30 days' : (amt ? money(amt) + ' asked' : '');
        return '<section class="col' + (c.st.id === 'closed' ? ' dead' : '') + '" data-stage="' + esc(c.st.id) + '"><div class="col-head"><div class="t">' + esc(c.st.label) + '<span>' + c.list.length + '</span></div><div class="sum">' + esc(note) + '</div></div>' +
          '<div class="col-body">' + (c.list.length ? c.list.map(card).join('') : '<div class="col-empty">' + (c.st.id === 'closed' ? 'Drag a deal here to decline it or mark it lost' : 'Nothing here') + '</div>') + '</div></section>';
      }).join('') + '</div>';
  }
  function shopOptions() { return I.shops.filter(function (s) { return inBook(s.repId); }).sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (s) { return { v: s.id, l: s.name }; }); }
  function cardFlag(d) {
    var miss = fileMissing(d);
    if ((d.stage === 'submitted' || d.stage === 'underwriting') && miss.length) return '<span class="flag warn">Needs ' + esc(miss.length === 1 ? miss[0].tiny : miss.length + ' documents') + '</span>';
    if (d.stage === 'submitted') return '<span class="flag">File complete</span>';
    if (d.stage === 'underwriting') return '<span class="flag">With underwriting</span>';
    if (d.stage === 'approved') { var b = bestOffer(d); return b ? '<span class="flag">' + plural(d.offers.length, 'offer') + ', best ' + A.moneyK(b.amount) + '</span>' : '<span class="flag warn">Offer not recorded</span>'; }
    if (d.stage === 'contracts') { var cm = closingMissing(d); return cm.length ? '<span class="flag">' + cm.length + ' left to fund</span>' : '<span class="flag good">Ready to fund</span>'; }
    if (d.stage === 'funded') return '<span class="flag">Funded ' + fmtDay(d.funded.fundedAt) + '</span>';
    return '<span class="flag">' + esc(d.closed ? d.closed.reason : '') + '</span>';
  }
  function card(d) {
    var s = shopOf(d) || { name: 'Unknown shop' };
    var age = daysSince(d.stageAt), stale = OPEN.indexOf(d.stage) >= 0 && age >= 3, fu = openFUs(d)[0];
    return '<article class="card" draggable="true" data-act="open" data-type="deal" data-id="' + esc(d.id) + '" tabindex="0">' +
      '<div class="biz">' + esc(d.merchant.business) + '</div><div class="owner">' + esc(s.name) + '</div>' +
      '<div class="amt"><span class="money">' + money(d.funded ? d.funded.amount : d.requested) + '</span>' + (d.renewalOf ? '<span class="pill accent">Renewal</span>' : '') + '</div>' +
      '<div class="foot">' + cardFlag(d) + (OPEN.indexOf(d.stage) >= 0 ? '<span class="age' + (stale ? ' stale' : '') + '" data-tip="Days in ' + esc(STAGE_LABEL[d.stage].toLowerCase()) + '">' + (age === 0 ? 'today' : age + 'd') + '</span>' : '') + '</div>' +
      (fu ? '<div class="card-fu' + (fuIsDue(fu) ? ' due' : '') + '">' + ICON.clock + esc(fuLabel(fu)) + '</div>' : '') + '</article>';
  }

  // ================= DRAWER =================
  function openRecord(type, id, tab, hint) {
    if (!recOf(type, id)) return;
    var back = drawer ? (drawer.type !== type || drawer.id !== id ? drawer.back.concat([{ type: drawer.type, id: drawer.id, tab: drawer.tab }]) : drawer.back) : [];
    drawer = { type: type, id: id, tab: tab || defaultTab(type, id), back: back, hint: hint || null };
    UI.editContact = null; UI.editAbout = null; UI.editNote = null;
    closePop(); render();
    var b = document.querySelector('.d-body'); if (b) b.scrollTop = 0;
  }
  function defaultTab(type, id) {
    if (type === 'shop') return 'deals';
    return { submitted: 'paperwork', underwriting: 'paperwork', approved: 'offers', contracts: 'paperwork', funded: 'offers', closed: 'activity' }[DB.deals[id].stage];
  }
  function renderDrawer() {
    var root = document.getElementById('drawer-root');
    if (!drawer) { root.innerHTML = ''; return; }
    var rec = recOf(drawer.type, drawer.id);
    if (!rec) { drawer = null; root.innerHTML = ''; return; }
    var body = root.querySelector('.d-body'), st = body ? body.scrollTop : 0, enter = root.querySelector('.drawer') ? '' : ' enter';
    root.innerHTML = '<div class="scrim' + enter + '" data-act="close-drawer"></div><aside class="drawer' + enter + '" role="dialog" aria-label="' + esc(recName(drawer.type, rec)) + '">' + (drawer.type === 'deal' ? dealDrawer(rec) : shopDrawer(rec)) + '</aside>';
    var nb = root.querySelector('.d-body'); if (nb) nb.scrollTop = st;
  }
  function backLink() {
    if (!drawer.back.length) return '';
    var b = drawer.back[drawer.back.length - 1], rec = recOf(b.type, b.id);
    return rec ? '<button class="backlink" data-act="drawer-back">' + ICON.back + 'Back to ' + esc(recName(b.type, rec)) + '</button>' : '';
  }
  function headActions(type, rec) {
    var c = contactFor(type, rec);
    if (c && !digits(c.phone)) c = null;
    var a = c ? ' data-phone="' + esc(c.phone) + '" data-type="' + type + '" data-id="' + esc(rec.id) + '"' : '';
    return (c ? '<button class="btn" data-act="call"' + a + '>' + ICON.phone + 'Call ' + esc(first(c.name)) + '</button><button class="btn" data-act="text"' + a + '>' + ICON.msg + 'Text</button>' : '') +
      '<button class="btn" data-act="fu-new-for" data-type="' + type + '" data-id="' + esc(rec.id) + '">' + ICON.clock + 'Follow-up</button>' +
      '<button class="btn ghost" data-act="' + (type === 'deal' ? 'edit-deal' : 'edit-shop') + '">Edit</button><button class="x" data-act="close-drawer" aria-label="Close">' + ICON.x + '</button>';
  }
  function fuList(type, rec) {
    var list = openFUs(rec);
    if (!list.length) return '';
    return '<div class="fu-list" data-spec-id="record-follow-ups">' + list.map(function (f) {
      return '<div class="fu-item' + (fuIsDue(f) ? ' due' : '') + '"><span class="ic">' + ICON.clock + '</span><b>' + esc(fuLabel(f)) + '</b><span class="note">' + esc(f.note || 'Follow up') + (f.repeat ? ' <span class="muted">(' + esc(repeatLabel(f.repeat).toLowerCase()) + ')</span>' : '') + '</span>' +
        '<span class="fu-acts"><button class="btn sm ghost" data-act="fu-edit"' + fuAttrs(type, rec.id, f.id) + '>Edit</button><button class="btn sm ghost" data-act="fu-later"' + fuAttrs(type, rec.id, f.id) + '>Later</button><button class="btn sm" data-act="fu-done"' + fuAttrs(type, rec.id, f.id) + '>' + ICON.check + 'Done</button></span></div>';
    }).join('') + '</div>';
  }
  function tabsHtml(list) {
    return '<div class="tabs" role="tablist">' + list.map(function (t) { return '<button role="tab" data-act="tab" data-v="' + t[0] + '" class="' + (drawer.tab === t[0] ? 'on' : '') + '">' + esc(t[1]) + (t[2] !== undefined ? '<span class="c">' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div>';
  }

  // ---------- deal drawer ----------
  function dealDrawer(d) {
    var s = shopOf(d) || { name: 'Unknown shop', contacts: [] }, c = dealContact(d), m = d.merchant;
    var head = '<div class="d-head">' + backLink() + '<div class="d-top"><div class="d-title"><h2>' + esc(m.business) + (d.renewalOf ? ' <span class="pill accent">Renewal</span>' : '') + '</h2>' +
      '<div class="who"><span>' + esc(m.owner) + '</span><span>' + esc(m.industry) + ', ' + esc(m.state) + '</span><span>From <button class="link" data-act="open" data-type="shop" data-id="' + esc(d.shopId) + '">' + esc(s.name) + '</button>' + (c ? ', sent by ' + esc(c.name) : '') + '</span>' + (ownerOf(d) !== ME ? '<span>' + esc(whose(ownerOf(d))) + '</span>' : '') + '</div></div>' +
      '<div class="d-actions">' + headActions('deal', d) + '</div></div>' + fuList('deal', d) +
      // A blank on the form or a column the import did not have reads "Not given", never a made-up 0.
      '<div class="facts">' + fact('Requested', d.requested ? money(d.requested) : 'Not given', !!d.requested) + fact('Monthly revenue', m.monthlyRevenue ? money(m.monthlyRevenue) : 'Not given', !!m.monthlyRevenue) +
      fact('<span class="term" data-tip="How long the business has been open.">Time in business</span>', !m.tibMonths ? 'Not given' : m.tibMonths >= 24 ? Math.floor(m.tibMonths / 12) + ' years' : m.tibMonths + ' months') +
      fact('<span class="term" data-tip="The owner\'s personal credit score.">Credit score</span>', m.fico || 'Not given') +
      fact('<span class="term" data-tip="Other cash advances the merchant is still paying back. More positions, more risk.">Open positions</span>', d.importedAt && !m.positions ? 'Not given' : m.positions) +
      fact('Submitted', fmtDay(d.submittedAt)) + '</div>' + stageTrack(d) +
      tabsHtml([['paperwork', 'Paperwork'], ['offers', 'Offers', d.offers.length], ['activity', 'Activity', d.activity.length]]) + '</div>';
    var rivals = rivalSubs(d), rival = '';
    if (rivals.length) {
      var r0 = rivals[0], rs0 = shopOf(r0) || { name: 'Another shop' }, earlier = r0.submittedAt < d.submittedAt;
      rival = banner(earlier && (OPEN.indexOf(r0.stage) >= 0 || daysSince(r0.submittedAt) <= 120) ? 'warn' : '', (earlier ? rs0.name + ' sent this merchant first, on ' + fmtDay(r0.submittedAt) : rs0.name + ' also sent this merchant, on ' + fmtDay(r0.submittedAt)) + ' (' + STAGE_LABEL[r0.stage].toLowerCase() + ').' + (rivals.length > 1 ? ' ' + plural(rivals.length - 1, 'other shop') + ' too.' : ''),
        '<button class="btn sm" data-act="open" data-type="deal" data-id="' + esc(r0.id) + '">Open theirs</button>');
    }
    return head + '<div class="d-body">' + nextStep(d) + rival + (drawer.hint ? '<div class="hint">' + esc(drawer.hint) + '</div>' : '') +
      (drawer.tab === 'paperwork' ? dealPaperwork(d) : drawer.tab === 'offers' ? dealOffers(d) : activityTab('deal', d)) + '</div>';
  }
  function fact(label, value, isMoney) { return '<div class="fact"><div class="l">' + label + '</div><div class="v' + (isMoney ? ' money' : '') + '">' + esc(value) + '</div></div>'; }
  function stageTrack(d) {
    var cur = A.STAGE_INDEX[d.stage], from = d.stage === 'closed' && d.closed ? A.STAGE_INDEX[d.closed.fromStage] : null;
    return '<div class="track" data-spec-id="stage-track">' + A.STAGES.filter(function (s) { return s.id !== 'closed'; }).map(function (s, i) {
      var cls = d.stage === 'closed' ? (i <= from ? 'done' : '') : i < cur ? 'done' : i === cur ? 'cur' : '';
      return '<button class="' + cls + '" data-act="move" data-v="' + esc(s.id) + '" data-tip="Move to ' + esc(s.label.toLowerCase()) + '"><span>' + esc(s.label) + '</span></button>';
    }).join('') + '</div>';
  }
  function nextStep(d) {
    var s = shopOf(d) || { name: 'the shop' }, miss = fileMissing(d);
    var t = '', sub = '', btn = '', tone = '';
    if (d.stage === 'submitted') {
      if (miss.length) { t = s.name + ' still owes paperwork.'; sub = 'Missing the ' + words(miss.map(function (x) { return x.short; })) + '. Underwriting will not price it until it is in.'; btn = '<button class="btn" data-act="tpl-ask" data-v="t2">' + ICON.msg + 'Text the shop for it</button>'; tone = 'bad'; }
      else { t = 'The file is complete.'; sub = 'Send it to underwriting so they can price it.'; btn = '<button class="btn primary" data-act="move" data-v="underwriting">Send to underwriting</button>'; }
    } else if (d.stage === 'underwriting') {
      t = 'With underwriting since ' + agoText(d.stageAt) + '.'; sub = 'When they decide, record it here so you can tell the shop right away.';
      if (miss.length) { sub = 'Underwriting is waiting on the ' + words(miss.map(function (x) { return x.short; })) + ' from ' + s.name + '.'; tone = 'bad'; }
      btn = '<button class="btn primary" data-act="offer-new">Record an approval</button><button class="btn" data-act="close-open" data-v="declined">Record a decline</button>';
    } else if (d.stage === 'approved' && !d.offers.length) {
      t = 'Approved.'; sub = 'Record what underwriting offered, so you can follow it with ' + s.name + '.'; btn = '<button class="btn primary" data-act="offer-new">Record the offer</button>';
    } else if (d.stage === 'approved') {
      var b = bestOffer(d), sent = daysSince(d.offers[0].sentAt), late = sent >= S().alerts.offerDays;
      t = (d.offers.length > 1 ? d.offers.length + ' offers' : 'An offer') + ' went to ' + s.name + ' ' + agoText(d.offers[0].sentAt) + '.';
      sub = 'Best is ' + money(b.amount) + '. When the merchant picks one, mark it and the contracts go out.' + (late ? ' It has been ' + plural(sent, 'day') + ', worth a call.' : '');
      btn = drawer.tab === 'offers' ? '' : '<button class="btn primary" data-act="tab" data-v="offers">Mark the offer they picked</button>'; tone = late ? 'bad' : '';
    } else if (d.stage === 'contracts') {
      var cm = closingMissing(d);
      if (cm.length) { t = plural(cm.length, 'thing') + ' left before it can fund.'; sub = words(cm.map(function (x) { return x.label; })) + '.'; btn = drawer.tab === 'paperwork' ? '' : '<button class="btn" data-act="tab" data-v="paperwork">Open the checklist</button>'; }
      else { t = 'Everything is in.'; sub = 'Contract signed, paperwork verified, funding call done.'; btn = '<button class="btn primary" data-act="move" data-v="funded">Mark funded</button>'; tone = 'good'; }
    } else if (d.stage === 'funded') {
      var rs = renewalState(d); tone = 'good';
      t = 'Funded ' + money(d.funded.amount) + ' on ' + fmtDay(d.funded.fundedAt) + '.';
      if (rs.kind === 'ready') { sub = pct(rs.p.paidPct) + ' paid in, so the merchant can renew. Tell ' + s.name + '.'; btn = '<button class="btn primary" data-act="renew">Start renewal</button>'; }
      else if (rs.kind === 'renewing') { sub = 'Renewal under way.'; btn = '<button class="btn" data-act="open" data-type="deal" data-id="' + esc(rs.id) + '">Open the renewal</button>'; }
      else if (rs.kind === 'stopped') { sub = 'Payments stopped on ' + fmtDay(d.funded.stoppedAt) + '. Not eligible to renew.'; tone = 'bad'; }
      else if (rs.kind === 'paid') sub = 'Paid off in full.';
      else if (rs.kind === 'noterms') { sub = 'The advance terms were not in the import, so the renewal date is unknown.'; btn = '<button class="btn" data-act="edit-deal">Add the terms</button>'; tone = ''; }
      else sub = pct(rs.p.paidPct) + ' paid in. Can renew at 50%, around ' + fmtDay(new Date(Date.now() + rs.p.daysToHalf * A.DAY).toISOString()) + '.';
    } else {
      var cl = d.closed || { kind: 'lost', reason: 'Unknown' };
      t = (cl.kind === 'declined' ? 'Underwriting declined it: ' : 'Lost: ') + cl.reason + '.'; sub = cl.note || 'No note.'; tone = 'bad';
      btn = '<button class="btn" data-act="reopen">Reopen</button>';
    }
    var closeBtn = d.stage === 'submitted' ? '<button class="btn ghost" data-act="close-open" data-v="declined">Decline</button>' : (d.stage === 'approved' || d.stage === 'contracts') ? '<button class="btn ghost" data-act="close-open" data-v="lost">Mark lost</button>' : '';
    return '<div class="next ' + tone + '" data-spec-id="next-step"><div class="txt"><b>' + esc(t) + '</b><span>' + esc(sub) + '</span></div><div class="next-acts">' + btn + closeBtn + '</div></div>';
  }
  function dealPaperwork(d) {
    var item = function (key, label, at, opt) {
      return '<button class="chk' + (at ? ' ok' : '') + '" data-act="paper" data-v="' + key + '"><span class="box">' + (at ? ICON.check : '') + '</span><span>' + esc(label) + (opt ? ' <span class="muted">(if underwriting asks)</span>' : '') + '</span><span class="meta">' + (at ? 'Got it ' + esc(timeText(at)) : 'Missing') + '</span></button>';
    };
    var file = '<div class="sec" data-spec-id="paperwork"><div class="sec-h"><div><h3>The file</h3><p>Underwriting needs the signed application and the last three months of bank statements.</p></div></div>' +
      item('app', 'Signed application', d.paperwork.app) + A.statementMonths(d.submittedAt).map(function (mk) { return item(mk, A.monthLabel(mk, true) + ' bank statement', d.paperwork[mk]); }).join('') +
      item('mtd', 'This month so far', d.paperwork.mtd, true) + '</div>';
    var closing = '';
    if (d.acceptedOfferId || d.stage === 'contracts' || d.stage === 'funded') {
      var items = closingItems(d), left = closingMissing(d).length, disc = A.DISCLOSURE_STATES.indexOf(d.merchant.state) >= 0;
      closing = '<div class="sec" data-spec-id="closing-checklist"><div class="sec-h"><div><h3>Before it can fund</h3><p>' + (left ? left + ' of ' + items.length + ' left.' : 'All ' + items.length + ' done.') + (disc ? ' ' + esc(d.merchant.state) + ' law requires a cost disclosure before the merchant signs.' : '') + '</p></div></div>' +
        items.map(function (c) { return '<button class="chk' + (d.closing[c.id] ? ' ok' : '') + '" data-act="closing" data-v="' + esc(c.id) + '"><span class="box">' + (d.closing[c.id] ? ICON.check : '') + '</span><span>' + esc(c.label) + '</span><span class="meta">' + (d.closing[c.id] ? 'Done ' + esc(timeText(d.closing[c.id])) : 'Not yet') + '</span></button>'; }).join('') + '</div>';
    }
    return d.stage === 'contracts' ? closing + file : file + closing;
  }
  function dealOffers(d) {
    if (d.funded && d.funded.noTerms) return '<div class="sec"><div class="empty-sec"><b>Funded ' + money(d.funded.amount) + ' on ' + esc(fmtDay(d.funded.fundedAt)) + '.</b><span>The factor rate and term were not in the import. Add them to see payments and when it can renew.</span><button class="btn" data-act="edit-deal">Add the terms</button></div></div>';
    if (!d.offers.length && !d.funded) return '<div class="sec"><div class="empty-sec"><b>No offers yet.</b><span>When underwriting approves, record the offer here.</span>' + (d.stage === 'closed' ? '' : '<button class="btn primary" data-act="offer-new">Record an approval</button>') + '</div></div>';
    var canPick = d.stage === 'approved' || d.stage === 'underwriting' || (d.stage === 'contracts' && !d.acceptedOfferId), best = bestOffer(d);
    var list = d.funded ? [Object.assign({}, d.funded, { id: d.acceptedOfferId || 'funded', maxPoints: Math.max(d.funded.points || 0, d.funded.maxPoints || 0, 10) })] : d.offers;
    var html = '<div class="sec" data-spec-id="offers"><div class="sec-h"><div><h3>' + (d.funded ? 'What funded' : 'Offers') + '</h3><p>' + (d.funded ? 'The terms the merchant took.' : 'Slide the points to see what the merchant pays. The shop keeps the points as its commission.') + '</p></div>' +
      (d.funded || d.stage === 'closed' ? '' : '<button class="btn sm" data-act="offer-new">' + ICON.plus + 'Another offer</button>') + '</div>' +
      list.map(function (o) { return offerCard(d, o, !d.funded && canPick, o.id === d.acceptedOfferId, o === best && d.offers.length > 1 && !d.funded); }).join('') + '</div>';
    if (d.funded) {
      var comm = A.commission(d.funded), paidAt = d.funded.commissionPaidAt;
      if (comm > 0) html += '<div class="sec" data-spec-id="commission"><div class="sec-h"><div><h3>Shop commission</h3><p>' + money(comm) + ' for ' + esc(d.funded.points) + ' points.</p></div></div>' +
        '<button class="chk' + (paidAt ? ' ok' : '') + '" data-act="comm-paid"><span class="box">' + (paidAt ? ICON.check : '') + '</span><span>Paid to ' + esc((shopOf(d) || { name: 'the shop' }).name) + '</span><span class="meta">' + (paidAt ? 'Paid ' + esc(fmtDay(paidAt)) : 'Not yet') + '</span></button></div>';
      var p = A.fundedProgress(d.funded);
      html += '<div class="sec"><div class="sec-h"><div><h3>Paid back so far</h3><p>' + p.made + ' of ' + p.total + ' payments made, ' + money(p.balance) + ' left. Merchants can renew at 50%.</p></div></div><div class="pad"><div class="bar big' + (p.paidPct >= 0.5 ? ' good' : '') + '"><i style="width:' + Math.max(2, p.paidPct * 100) + '%"></i><span class="half"></span></div></div></div>';
    }
    return html;
  }
  function offerNums(o) {
    var apr = A.estAPR(o);
    return { sell: A.sellRate(o).toFixed(2), pay: money(A.paymentAmount(o)), n: A.paymentCount(o), per: o.freq === 'weekly' ? 'a week' : 'a business day', back: money(A.payback(o)), apr: apr === null ? 'n/a' : Math.round(apr * 100) + '%', comm: money(A.commission(o)), net: money(A.netFunded(o)) };
  }
  function offerCard(d, o, canPick, chosen, best) {
    var x = offerNums(o);
    var pick = canPick ? '<button class="btn sm primary" data-act="offer-pick" data-v="' + esc(o.id) + '">Merchant picked this</button>' : chosen && d.stage === 'contracts' ? '<span class="pill accent">Merchant picked this</span><button class="link" data-act="offer-unpick">Change</button>' : chosen ? '<span class="pill accent">Picked</span>' : '';
    var edit = !d.funded && d.stage !== 'closed' ? '<button class="link" data-act="offer-edit" data-v="' + esc(o.id) + '">Edit</button>' : '';
    return '<div class="offer' + (chosen ? ' chosen' : '') + '">' +
      '<div class="who"><span class="money big">' + money(o.amount) + '</span><div class="det">' + esc(o.termMonths) + ' months, ' + (o.freq === 'weekly' ? 'weekly' : 'daily') + ' payments</div>' + (best ? '<span class="best">Largest offer</span>' : '') + edit + '</div>' +
      '<div class="nums"><div><div class="l">Merchant pays</div><div class="v money" data-o="pay">' + x.pay + '</div><div class="sub">' + x.per + ', ' + x.n + ' payments</div></div>' +
      '<div><div class="l">Pays back in total</div><div class="v money" data-o="back">' + x.back + '</div><div class="sub">Gets ' + x.net + ' after the ' + esc(o.fee) + '% fee</div></div>' +
      '<div><div class="l"><span class="term" data-tip="The yearly cost of the advance, worked out the way the disclosure laws ask for it.">Est. APR</span></div><div class="v num" data-o="apr">' + x.apr + '</div><div class="sub"><span class="term" data-tip="What the merchant pays back for every dollar: our buy rate plus the shop\'s points.">Factor</span> <span data-o="sell">' + x.sell + '</span></div></div></div>' +
      '<div class="mine"><div class="l"><span class="term" data-tip="Our price to the shop. The shop can add up to the max points on top.">Buy rate</span> ' + o.buyRate.toFixed(2) + (d.funded ? ', shop added <b data-o="pts">' + esc(o.points || 0) + '</b> points' : ', shop adds <b data-o="pts">' + esc(o.points || 0) + '</b> of ' + esc(o.maxPoints) + ' points') + '</div>' +
      (d.funded ? '' : '<input type="range" min="0" max="' + esc(o.maxPoints) + '" step="1" value="' + esc(o.points || 0) + '" data-in="points" data-v="' + esc(o.id) + '" aria-label="Points the shop adds">') +
      '<div class="l">Shop earns</div><div class="v money" data-o="comm">' + x.comm + '</div><div class="pick">' + pick + '</div></div></div>';
  }

  // ---------- activity ----------
  function activityTab(type, rec) {
    var dr = UI.drafts['act:' + rec.id] || { type: 'note', text: '', outcome: 'Talked to them' };
    var comp = '<div class="sec" data-spec-id="activity"><div class="composer"><div class="bar2"><div class="seg">' +
      '<button class="' + (dr.type === 'note' ? 'on' : '') + '" data-act="draft-type" data-v="note">Note</button><button class="' + (dr.type === 'call' ? 'on' : '') + '" data-act="draft-type" data-v="call">Log a call</button></div>' +
      (dr.type === 'call' ? '<div class="chips">' + A.CALL_OUTCOMES.map(function (o) { return '<button class="chip' + (dr.outcome === o ? ' on' : '') + '" data-act="draft-outcome" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' : '') + '</div>' +
      '<textarea data-in="draft" placeholder="' + (dr.type === 'call' ? 'What did they say?' : 'Write a note') + '">' + esc(dr.text) + '</textarea><div class="bar3"><button class="btn primary sm" data-act="draft-save">' + (dr.type === 'call' ? 'Log call' : 'Save note') + '</button></div></div>';
    var items = (rec.activity || []).map(function (a) { return { at: a.at, a: a }; });
    if (type === 'shop') {
      var keys = {}; rec.contacts.forEach(function (c) { keys[digits(c.phone)] = c; });
      vals(DB.msgs).forEach(function (m) { var c = keys[digits(m.phone)]; if (c) items.push({ at: m.at, m: m, c: c }); });
    }
    items.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var limit = UI.allAct === rec.id ? 999 : 15;
    var list = '<ul class="tl">' + items.slice(0, limit).map(function (it) {
      if (it.m) {
        var m = it.m, isCall = m.kind === 'call';
        var txt = isCall ? (m.dir === 'in' ? (m.outcome === 'Missed' ? 'Missed call from ' : 'Call from ') + it.c.name : 'Called ' + it.c.name + (m.outcome ? ', ' + m.outcome.toLowerCase() : '')) + (m.duration ? ' (' + fmtDur(m.duration) + ')' : '') + (m.text ? '. ' + m.text : '')
          : (m.dir === 'in' ? it.c.name + ' texted: ' : 'You texted ' + first(it.c.name) + ': ') + m.text;
        return '<li><span class="ic' + (isCall ? ' call' : ' text') + '">' + (isCall ? ICON.phone : ICON.msg) + '</span><div><div class="meta">' + esc(timeText(m.at)) + '</div><div class="txt">' + esc(txt) + '</div></div></li>';
      }
      var a = it.a;
      var ic = a.type === 'call' ? '<span class="ic call">' + ICON.phone + '</span>' : a.type === 'text' ? '<span class="ic text">' + ICON.msg + '</span>' : a.type === 'note' ? '<span class="ic">' + ICON.note + '</span>' : '<span class="ic sys">' + ICON.dot + '</span>';
      var editing = UI.editNote === a.id;
      var body = editing ? '<textarea data-in="note-edit" rows="3">' + esc(UI.drafts['note:' + a.id] !== undefined ? UI.drafts['note:' + a.id] : a.text) + '</textarea><div class="bar3"><button class="btn sm ghost" data-act="note-cancel">Cancel</button><button class="btn sm primary" data-act="note-save" data-v="' + esc(a.id) + '">Save</button></div>'
        : '<div class="txt">' + esc(a.text) + '</div>';
      var tools = a.type === 'note' && !editing ? '<span class="tl-tools"><button class="link" data-act="note-edit" data-v="' + esc(a.id) + '">Edit</button><button class="link danger" data-act="note-del" data-v="' + esc(a.id) + '">Delete</button></span>' : '';
      return '<li class="' + (a.type === 'system' ? 'sys' : '') + '">' + ic + '<div><div class="meta">' + esc(timeText(a.at)) + (a.by && PEOPLE[a.by] && a.by !== ME ? ', ' + esc(pname(a.by)) : '') + (a.outcome ? ', ' + esc(a.outcome.toLowerCase()) : '') + tools + '</div>' + body + '</div></li>';
    }).join('') + '</ul>' + (items.length > limit ? '<div class="more"><button class="link" data-act="all-act">Show the other ' + (items.length - limit) + '</button></div>' : '');
    if (LIVE) list += '<div class="more"><button class="link" data-act="log-rec" data-type="' + type + '" data-id="' + esc(rec.id) + '">Every change to this ' + type + '</button></div>';
    return comp + list + '</div>';
  }

  // ---------- shop drawer ----------
  function shopDrawer(s) {
    var inf = shopInfo(s), flags = '';
    if (inf.dups.length) { var o = DB.shops[inf.dups[0]]; flags += banner('warn', 'Looks like the same shop as ' + o.name + ' (' + plural(shopInfo(o).deals.length, 'deal') + ', ' + whose(o.repId).toLowerCase() + ').', '<button class="btn sm" data-act="merge-open">Merge them</button>'); }
    if (!s.repId) flags += banner('warn', 'Nobody looks after this shop yet.', '<button class="btn sm primary" data-act="take-shop">Take it</button>');
    if (!s.agreementAt) flags += banner('', s.importedAt ? 'Is the ISO agreement signed? Mark it so commission can be paid.' : 'No signed ISO agreement yet. We cannot pay the shop commission until it is signed.', '<button class="btn sm" data-act="agree-signed">Mark signed</button>');
    if (s.paused) flags += banner('bad', 'Paused: ' + s.paused.reason + '. New submissions get sent back.', '<button class="btn sm" data-act="unpause">Resume</button>');
    var owner = s.repId === ME ? 'In your book' + (s.assignedAt ? ' since ' + fmtDay(s.assignedAt) : '') : s.repId ? pname(s.repId) + "'s shop" : 'Nobody looks after it';
    var head = '<div class="d-head">' + backLink() + '<div class="d-top"><div class="d-title"><h2>' + esc(s.name) + ' ' + statusPill(inf) + '</h2>' +
      '<div class="who">' + (s.state ? '<span>' + esc(s.state) + '</span>' : '') + '<span>' + esc(owner) + (solo() && s.repId === ME ? '' : ' <button class="link" data-act="assign-open">' + (s.repId === ME ? 'Hand off' : 'Change') + '</button>') + '</span>' + (s.agreementAt ? '<span>Agreement signed ' + esc(fmtDay(s.agreementAt)) + '</span>' : '') + (s.w9At ? '<span>W-9 on file</span>' : '') + '</div></div>' +
      '<div class="d-actions">' + headActions('shop', s) + '</div></div>' + aboutBox(s) + fuList('shop', s) + autoLine(s) +
      '<div class="facts five" data-spec-id="shop-numbers">' +
      factBtn('Last deal', inf.last ? cap(agoText(inf.last)) : 'Never', 'deals') + factBtn('Sends a deal', paceText(inf), 'deals') + factBtn('Open right now', inf.open.length, 'deals') +
      factBtn('Funded in 90 days', inf.f90 ? money(inf.f90) : '$0', 'deals', true) + factBtn('People', s.contacts.length, 'people') + '</div>' + funnelLine(inf) +
      tabsHtml([['deals', 'Deals', inf.deals.length], ['people', 'People', s.contacts.length], ['activity', 'Calls, texts and notes']]) + '</div>';
    return head + '<div class="d-body">' + flags + (drawer.tab === 'people' ? shopPeople(s) : drawer.tab === 'activity' ? activityTab('shop', s) : shopDeals(s, inf)) + '</div>';
  }
  // How the desk follows up with this shop on its own, what comes next, and the control to change it.
  function autoLine(s) {
    if (s.repId !== ME) return '';
    var inf = shopInfo(s), na = nextAuto(s), every = cadenceDays(s, inf);
    var mode = s.autoFU === 'off' ? 'Off' : s.autoFU ? CADENCE.filter(function (c) { return c[0] === s.autoFU; })[0][1] : 'Every ' + plural(every, 'day');
    var why = s.autoFU ? '' : I.top[s.id] ? ', one of your top shops' : inf.quality === 'poor' ? ', since most of their deals get declined' : '';
    var next = s.paused ? 'Paused, so only news on their deals.' : s.autoFU === 'off' ? 'Only news on their deals shows on Today.'
      : na && na.today ? '<b>Today:</b> ' + esc(na.t.why) : na ? 'Next one ' + esc(lc(dayLabel(na.due))) + '.' : '';
    return '<div class="auto-line" data-spec-id="shop-auto"><span class="l">Automatic follow-ups</span><button class="ms" data-act="auto-mode">' + esc(mode) + esc(why) + ICON.down + '</button>' +
      '<span class="nx">' + next + '</span>' + (na && na.today && !na.t.call ? '<button class="btn sm" data-act="review-one" data-k="' + esc(na.t.id) + '">Read the text</button>' : '') + '</div>';
  }
  function funnelLine(inf) {
    var d90 = inf.deals.filter(function (d) { return daysSince(d.submittedAt) <= 90; });
    if (!d90.length) return '';
    var appr = d90.filter(function (d) { return d.offers.length || ['approved', 'contracts', 'funded'].indexOf(d.stage) >= 0; }).length;
    var fund = d90.filter(function (d) { return d.stage === 'funded'; }).length, reasons = {}, top = null;
    d90.forEach(function (d) { if (d.closed && d.closed.kind === 'declined') { reasons[d.closed.reason] = (reasons[d.closed.reason] || 0) + 1; if (!top || reasons[d.closed.reason] > reasons[top]) top = d.closed.reason; } });
    return '<div class="funnel" data-spec-id="shop-funnel">Last 90 days: <b>' + d90.length + '</b> sent, <b>' + appr + '</b> approved, <b>' + fund + '</b> funded' + (d90.length >= 3 ? ' (' + pct(fund / d90.length) + ' funded)' : '') + '.' +
      (top ? ' Most declines: ' + esc(top.charAt(0).toLowerCase() + top.slice(1)) + ' (' + reasons[top] + ').' : '') + '</div>';
  }
  function aboutBox(s) {
    if (UI.editAbout === s.id) return '<div class="about editing" data-spec-id="shop-about"><textarea data-in="about" rows="3" placeholder="How this shop works: what they send, who to call, how they like to be reached">' + esc(UI.drafts['about:' + s.id] !== undefined ? UI.drafts['about:' + s.id] : (s.about || '')) + '</textarea><div class="bar3"><button class="btn sm ghost" data-act="about-cancel">Cancel</button><button class="btn sm primary" data-act="about-save">Save</button></div></div>';
    return s.about ? '<button class="about" data-act="about-edit" data-spec-id="shop-about"><span>' + esc(s.about) + '</span><span class="edit-hint">Edit</span></button>' : '<button class="about empty" data-act="about-edit" data-spec-id="shop-about">' + ICON.plus + 'Add a note about how this shop works</button>';
  }
  function banner(tone, text, btn) { return '<div class="next ' + tone + '"><div class="txt"><span>' + esc(text) + '</span></div><div class="next-acts">' + btn + '</div></div>'; }
  function factBtn(label, value, tab, isMoney) { return '<button class="fact" data-act="tab" data-v="' + tab + '"><div class="l">' + esc(label) + '</div><div class="v' + (isMoney ? ' money' : '') + '">' + esc(value) + '</div></button>'; }
  function shopDeals(s, inf) {
    if (!inf.deals.length) return '<div class="sec"><div class="empty-sec"><b>No deals from this shop yet.</b><span>When they send one, log it here.</span><button class="btn primary" data-act="new-deal" data-v="' + esc(s.id) + '">' + ICON.plus + 'Log a submission</button></div></div>';
    var list = inf.deals.slice().sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
    var cut = s.assignedAt, divided = false, shown = 0, limit = UI.allDeals === s.id ? 999 : 8, rows = '';
    list.forEach(function (d) {
      if (shown >= limit) return;
      if (cut && !divided && d.submittedAt < cut && s.history.length) {
        var prev = s.history[s.history.length - 1];
        rows += '<div class="divider">Before ' + (s.repId === ME ? 'you took' : esc(pfirst(s.repId)) + ' took') + ' over on ' + esc(fmtDay(cut)) + '. These came in under ' + esc(pname(prev.repId)) + '.</div>';
        divided = true;
      }
      shown++;
      rows += '<button class="row srow2" data-act="open" data-type="deal" data-id="' + esc(d.id) + '"><div class="main"><b>' + esc(d.merchant.business) + '</b><div class="sub">' + esc(d.merchant.industry) + ', submitted ' + esc(fmtDay(d.submittedAt)) + '</div></div><div>' + stagePill(d) + '</div><div class="right money-sm">' + money(d.funded ? d.funded.amount : d.requested) + '</div></button>';
    });
    return '<div class="sec" data-spec-id="shop-deals"><div class="sec-h"><div><h3>Deals from this shop</h3><p>' + plural(inf.deals.length, 'deal') + ', newest first.</p></div><button class="btn sm" data-act="new-deal" data-v="' + esc(s.id) + '">' + ICON.plus + 'Log a submission</button></div><div class="rows">' + rows + '</div>' +
      (list.length > limit ? '<div class="more"><button class="link" data-act="all-deals">Show the other ' + (list.length - limit) + '</button></div>' : '') + '</div>';
  }
  function stagePill(d) {
    if (d.stage === 'funded') { var rs = renewalState(d); return '<span class="pill good">Funded</span>' + (rs && rs.kind === 'ready' ? ' <span class="pill accent">Can renew</span>' : rs && rs.kind === 'stopped' ? ' <span class="pill bad">Stopped paying</span>' : ''); }
    if (d.stage === 'closed') return '<span class="pill">' + (d.closed && d.closed.kind === 'declined' ? 'Declined' : 'Lost') + '</span>';
    return '<span class="pill accent">' + esc(STAGE_LABEL[d.stage]) + '</span>';
  }
  function shopPeople(s) {
    var editing = UI.editContact;
    var rows = s.contacts.map(function (c) {
      if (editing === c.id) return contactForm(c);
      return '<div class="row crow"><div class="main"><b>' + esc(c.name) + '</b><div class="sub">' + esc(c.role) + '</div></div><div class="num">' + esc(c.phone) + (c.phone2 ? '<div class="sub">' + esc(c.phone2) + '</div>' : '') + '</div><div class="trunc"><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></div>' +
        '<div class="acts">' + callText(c, 'shop', s.id) + '<button class="btn sm ghost" data-act="contact-edit" data-v="' + esc(c.id) + '">Edit</button></div></div>';
    }).join('');
    return '<div class="sec" data-spec-id="shop-people"><div class="sec-h"><div><h3>People at this shop</h3><p>The owner, the reps who send deals and whoever handles the files.</p></div>' + (editing === 'new' ? '' : '<button class="btn sm" data-act="contact-edit" data-v="new">' + ICON.plus + 'Add a person</button>') + '</div><div class="rows">' +
      (editing === 'new' ? contactForm({ id: 'new', name: '', role: 'Sales rep', phone: '', email: '' }) : '') + (rows || (editing === 'new' ? '' : '<div class="empty-line">Nobody saved yet.</div>')) + '</div></div>';
  }
  function contactForm(c) {
    return '<form class="cform" data-form="contact" data-v="' + esc(c.id) + '" novalidate><div class="grid4">' +
      field('Name', input('name', c.name, 'text', ' autofocus')) + field('Role', select('role', A.CONTACT_ROLES, c.role)) + field('Phone', input('phone', c.phone, 'tel')) + field('Email', input('email', c.email, 'email')) + field('Second phone', input('phone2', c.phone2 || '', 'tel')) + '</div>' +
      '<div class="cform-f">' + (c.id !== 'new' ? '<button type="button" class="btn sm danger" data-act="contact-del" data-v="' + esc(c.id) + '">Remove</button>' : '') + '<span class="sp"></span><button type="button" class="btn sm ghost" data-act="contact-cancel">Cancel</button><button type="submit" class="btn sm primary">' + (c.id === 'new' ? 'Add person' : 'Save') + '</button></div></form>';
  }

  // ================= CALLS, TEXTS, ALERTS =================
  // On the private desk the phone does the calling and texting: tel: and sms: links hand the
  // number to whatever calls on this device (the phone app, FaceTime, Connect UC), and the desk
  // keeps the log, the note and the next follow-up.
  function e164(key) { return key.length === 10 ? '+1' + key : key; }
  function openLink(href) { var a = document.createElement('a'); a.href = href; a.style.display = 'none'; document.body.appendChild(a); if (a.click) a.click(); if (a.remove) a.remove(); }
  function smsLink(key, text) { var apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent || ''); return 'sms:' + e164(key) + (text ? (apple ? '&' : '?') + 'body=' + encodeURIComponent(text) : ''); }
  function startCall(phone, ctx) {
    if (call && call.state !== 'wrap') { toast('Finish the call you are on first', { bad: true }); return; }
    var key = digits(phone);
    call = { key: key, phone: fmtPhone(phone), who: I.byPhone[key] || null, ctx: ctx || null, state: LIVE ? 'live' : 'dialing', started: LIVE ? Date.now() : null, duration: 0, outcome: null, note: '', fu: '', device: LIVE };
    if (!call.ctx && call.who) call.ctx = { type: 'shop', id: call.who.shop.id };
    renderCall();
    if (LIVE) { openLink('tel:' + e164(key)); return; }
    setTimeout(function () { if (call && call.state === 'dialing' && call.key === key) { call.state = 'live'; call.started = Date.now(); renderCall(); } }, 1800);
  }
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); if (LIVE) { flush(); saveCache(); } return; }
    if (call && call.device && call.state === 'live' && hiddenAt && Date.now() - hiddenAt > 4000) ACT['call-end']();
    rollDay();
    syncNow();
  });
  setInterval(function () { if (call && call.state === 'live') { var el = document.getElementById('call-timer'); if (el) el.textContent = fmtDur((Date.now() - call.started) / 1000); } }, 1000);
  function renderCall() {
    var root = document.getElementById('call-root');
    if (!call) { root.innerHTML = ''; return; }
    var name = call.who ? call.who.contact.name : call.phone, sub = call.who ? call.who.shop.name : 'Not in your contacts';
    var who = '<span class="av">' + (call.who ? esc(initials(name)) : '#') + '</span><span class="cb-who"><b>' + esc(name) + '</b><span>' + esc(sub) + '</span></span>';
    var enter = root.querySelector('.callbar') ? '' : ' enter';
    if (call.state !== 'wrap') {
      root.innerHTML = '<div class="callbar' + enter + '" role="status" data-spec-id="call-bar">' + who + '<span class="cb-state">' + (call.state === 'dialing' ? 'Calling...' : '<span id="call-timer">0:00</span>') + '<small>' + (call.device ? 'Dialing in your calling app' : 'From ' + esc(myPhone())) + '</small></span>' +
        (call.device ? '<button class="btn primary" data-act="call-end">Hung up</button><button class="ib on-dark" data-act="call-discard" data-tip="Not calling? Close this" aria-label="Close">' + ICON.x + '</button>' : '<button class="btn danger-fill" data-act="call-end">End call</button>') + '</div>';
      return;
    }
    var q = quickTimes().filter(function (x) { return x.label !== 'In an hour'; });
    root.innerHTML = '<div class="callbar wrap' + enter + '" role="dialog" aria-label="Log this call" data-spec-id="call-bar">' +
      '<div class="cb-top">' + who + '<span class="cb-state">Call ended, ' + fmtDur(call.duration) + '</span></div>' +
      '<div class="chips">' + A.CALL_OUTCOMES.map(function (o) { return '<button class="chip' + (call.outcome === o ? ' on' : '') + '" data-act="call-outcome" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' +
      '<textarea data-in="call-note" rows="2" placeholder="What did they say?">' + esc(call.note) + '</textarea>' +
      '<div class="cb-fu"><span>Follow up</span><div class="chips">' + [['', 'No']].concat(q.map(function (x) { return [x.due + '|' + x.time, x.label]; })).map(function (o) { return '<button class="chip' + (call.fu === o[0] ? ' on' : '') + '" data-act="call-fu" data-v="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>' +
      '<div class="cb-f"><button class="btn ghost" data-act="call-discard">Do not log it</button><button class="btn primary" data-act="call-save">Save</button></div></div>';
  }
  function saveCall() {
    var c = call, note = (c.note || '').trim();
    put('msgs', { id: uid('m'), phone: c.phone, dir: 'out', kind: 'call', text: note, outcome: c.outcome, duration: c.duration, at: new Date(c.started || Date.now()).toISOString(), read: true, spam: false, via: c.device ? 'phone' : '' });
    var target = c.ctx ? recOf(c.ctx.type, c.ctx.id) : null, fuMsg = '';
    var tc = c.ctx && c.ctx.touch ? findTouch(c.ctx.touch) : null;
    if (tc) { markTouch(tc, 'called'); put('shops', DB.shops[tc.s.id]); }
    if (target && c.ctx.type === 'deal') log(target, 'call', note || c.outcome, { outcome: c.outcome });
    var from = target && c.ctx.fid ? (target.followUps || []).filter(function (y) { return y.id === c.ctx.fid && !y.doneAt; })[0] : null, closed = false;
    if (from && (c.fu || c.outcome === 'Talked to them')) { closeFU(target, from); closed = true; }
    if (c.fu && target) {
      var p = c.fu.split('|');
      target.followUps = target.followUps || [];
      target.followUps.push({ id: uid('f'), due: p[0], time: p[1], note: note ? 'After call: ' + note.slice(0, 80) : 'Follow up on the call with ' + first(c.who ? c.who.contact.name : 'them'), repeat: '', doneAt: null, by: ME, createdAt: nowISO() });
      fuMsg = ', follow-up set for ' + lc(fuLabel({ due: p[0], time: p[1] }));
    }
    if (target && (c.ctx.type === 'deal' || c.fu || closed)) put(kindOf(c.ctx.type), target);
    call = null; render();
    toast('Call logged' + (closed && c.fu ? '. Next follow-up ' + fuMsg.replace(', follow-up set for ', '') : closed ? ', follow-up done' : fuMsg));
  }
  function openSheet(phone, ctx) {
    var key = digits(phone);
    sheet = { key: key, ctx: ctx || null };
    markRead(key); render();
    var t = document.querySelector('.sheet textarea'); if (t) t.focus();
  }
  function renderSheet() {
    var root = document.getElementById('sheet-root');
    if (!sheet) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="sheet' + (root.querySelector('.sheet') ? '' : ' enter') + '" role="dialog" aria-label="Text" data-spec-id="text-sheet">' + threadPane(convFor(sheet.key), 'sheet') + '</div>';
    var b = root.querySelector('.th-body'); if (b) b.scrollTop = b.scrollHeight;
  }
  function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(function () { copyFallback(text); }); return; } } catch (e) { /* fall through */ }
    copyFallback(text);
  }
  function copyFallback(text) {
    var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); if (t.select) t.select(); try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ } if (t.remove) t.remove();
  }
  function sendText(key, how) {
    var text = (UI.drafts['sms:' + key] || '').trim();
    if (!text) { toast('Write the text first', { bad: true }); return; }
    var c = convFor(key);
    put('msgs', { id: uid('m'), phone: c.phone, dir: 'out', kind: 'text', text: text, outcome: null, duration: 0, at: nowISO(), read: true, spam: false, via: LIVE ? 'phone' : '' });
    var ctx = sheet && sheet.key === key ? sheet.ctx : null;
    if (ctx && ctx.type === 'deal' && DB.deals[ctx.id]) { var d = DB.deals[ctx.id]; log(d, 'text', 'Texted ' + first(convName(c)) + ': ' + text); put('deals', d); }
    UI.drafts['sms:' + key] = '';
    if (LIVE) {
      copyText(text);
      if (how === 'sms') { openLink(smsLink(key, text)); toast('Opened Messages. It sends from that device\'s own number.'); }
      else toast('Copied. Paste it into Connect UC and hit send.');
    }
    render();
    var t = document.querySelector((sheet && sheet.key === key ? '.sheet' : '.conv-pane') + ' textarea'); if (t) t.focus();
  }
  // Alerts: a follow-up that comes due while the page is open, or a new text from a shop.
  var lastCheck = Date.now();
  function pushAlert(a) { alerts = [a].concat(alerts.filter(function (x) { return x.id !== a.id; })).slice(0, 3); renderAlerts(); desktopNotify(a); }
  function alertText(a) {
    if (a.kind === 'fu') { var r = recOf(a.type, a.recId), f = r && findFU(a.type, a.recId, a.fid); return r && f ? { title: recName(a.type, r), body: f.note || 'Follow up' } : null; }
    var c = convFor(a.key); return { title: 'Text from ' + convName(c), body: c.last ? c.last.text : '' };
  }
  function renderAlerts() {
    var root = document.getElementById('alert-root');
    alerts = alerts.filter(function (a) { if (a.kind !== 'fu') return true; var f = findFU(a.type, a.recId, a.fid); return f && !f.doneAt && fuIsDue(f); });
    root.innerHTML = alerts.map(function (a) {
      var t = alertText(a); if (!t) return '';
      var acts;
      if (a.kind === 'fu') {
        var rec = recOf(a.type, a.recId), c = contactFor(a.type, rec);
        acts = callText(c, a.type, a.recId, a.fid) + '<span class="sp"></span><button class="btn sm ghost" data-act="fu-later"' + fuAttrs(a.type, a.recId, a.fid) + '>Later</button><button class="btn sm primary" data-act="fu-done"' + fuAttrs(a.type, a.recId, a.fid) + '>' + ICON.check + 'Done</button>';
      } else acts = '<span class="sp"></span><button class="btn sm primary" data-act="conv-open" data-v="' + esc(a.key) + '">Reply</button>';
      return '<div class="alert" role="alert"><div class="al-h"><span>' + (a.kind === 'fu' ? ICON.clock + 'Follow-up due now' : ICON.msg + 'New text') + '</span><button class="x" data-act="alert-x" data-v="' + esc(a.id) + '" aria-label="Dismiss">' + ICON.x + '</button></div>' +
        '<button class="al-b" data-act="alert-open" data-v="' + esc(a.id) + '"><b>' + esc(t.title) + '</b><span>' + esc(t.body) + '</span></button><div class="al-acts">' + acts + '</div></div>';
    }).join('');
  }
  function desktopNotify(a) {
    if (LIVE) return; // the private desk alerts through the phone and browser push instead
    if (!UI.desktop || !('Notification' in window) || Notification.permission !== 'granted') return;
    var t = alertText(a); if (!t) return;
    try { var n = new Notification(t.title, { body: t.body, tag: a.id }); n.onclick = function () { window.focus(); openAlert(a); n.close(); }; } catch (e) { /* some browsers only allow this from a service worker */ }
  }
  function openAlert(a) { if (a.kind === 'fu') openRecord(a.type, a.recId); else { UI.view = 'messages'; UI.conv = a.key; markRead(a.key); drawer = null; alerts = alerts.filter(function (x) { return x.id !== a.id; }); render(); } }
  // A.TODAY is fixed at load; move it (in place, so every date helper sees it) when the day changes.
  function rollDay() {
    var t = dayStart(new Date());
    if (t.getTime() === A.TODAY.getTime()) return false;
    A.TODAY.setTime(t.getTime()); render(); return true;
  }
  function checkAlerts() {
    rollDay();
    var now = Date.now();
    myFUs().forEach(function (x) { var t = dueAt(x.f).getTime(); if (t > lastCheck && t <= now) pushAlert({ id: 'fu-' + x.f.id, kind: 'fu', type: x.type, recId: x.rec.id, fid: x.f.id }); });
    lastCheck = now;
    renderTop();
    if (UI.view === 'today' && !typing() && !pop) renderMain();
  }
  setInterval(function () { if (I) checkAlerts(); }, 15000);

  // ================= MODALS =================
  function openModal(m) { modal = m; closePop(); renderModal(); var f = document.querySelector('.modal [autofocus]') || document.querySelector('.modal input:not([type=checkbox]):not([type=radio]), .modal textarea'); if (f) f.focus(); }
  function closeModal() { modal = null; renderModal(); }
  function renderModal() {
    var root = document.getElementById('modal-root');
    if (!modal) { root.innerHTML = ''; return; }
    var m = MODALS[modal.kind](modal), enter = root.querySelector('.modal-wrap') ? '' : ' enter';
    root.innerHTML = '<div class="modal-wrap' + enter + '" data-act="modal-bg"><div class="modal' + (m.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(m.title) + '"' + (m.spec ? ' data-spec-id="' + m.spec + '"' : '') + '>' +
      '<div class="modal-h"><div><h2>' + esc(m.title) + '</h2>' + (m.sub ? '<p>' + m.sub + '</p>' : '') + '</div><button class="x" data-act="modal-close" aria-label="Close">' + ICON.x + '</button></div>' +
      '<form class="modal-form" data-form="' + modal.kind + '" novalidate><div class="modal-b">' + m.body + '</div>' + (m.foot !== false ? '<div class="modal-f">' + (m.left || '') + '<button type="button" class="btn ghost" data-act="modal-close">Cancel</button>' + (m.submit ? '<button type="submit" class="btn primary">' + esc(m.submit) + '</button>' : '') + '</div>' : '') + '</form></div></div>';
  }
  function field(label, html, cls) { return '<label class="field' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + html + '</label>'; }
  function input(name, value, type, extra) { return '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + (extra || '') + '>'; }
  function select(name, options, value, extra) { return '<select name="' + name + '"' + (extra || '') + '>' + options.map(function (o) { var v = typeof o === 'string' ? o : o[0], l = typeof o === 'string' ? o : o[1]; return '<option value="' + esc(v) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>'; }
  function formData(form) { var o = {}; Array.prototype.forEach.call(form.elements, function (el) { if (!el.name) return; if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value; }); return o; }

  var MODALS = {
    how: function () {
      return { title: 'How ISO Desk works', sub: 'You look after broker shops. Shops send deals. The desk keeps you on top of both. <a href="/tour/" target="_blank" rel="noopener">Watch the walkthrough</a>', wide: true, foot: false,
        body: '<div class="steps">' + [
          ['A shop sends a deal', "A merchant's application and bank statements come in from a broker shop."],
          ['Underwriting decides', 'They approve with one or more offers, or decline.'],
          ['The merchant picks', 'The shop adds its points and presents the offer. You keep it moving.'],
          ['Paperwork, then money', 'Contract, documents and a funding call. Then it funds.'],
          ['Renew at half paid', 'Once half is paid back, tell the shop the merchant can renew.']
        ].map(function (s, i) { return '<div class="step"><span class="n">' + (i + 1) + '</span><span class="t">' + esc(s[0]) + '</span><span class="d">' + esc(s[1]) + '</span></div>'; }).join('') + '</div>' +
          '<dl class="gloss"><dt>Follow-ups</dt><dd>Set one from anywhere with the Follow-up button. When one comes due, an alert pops up with Call, Text, Done and Later right on it.</dd>' +
          '<dt>Calls and texts</dt><dd>' + (LIVE ? 'Call opens Connect UC with the number ready. When you hang up, log what happened and set the next follow-up in the same step. Text copies your message to paste into Connect UC.' : 'Go out from your number, ' + esc(myPhone()) + '. After a call, log what happened and set the next follow-up in the same step.') + '</dd>' +
          '<dt>Factor rate</dt><dd>What the merchant pays back per dollar. 1.35 on $10,000 is $13,500 back.</dd>' +
          '<dt>Buy rate and points</dt><dd>Our price to the shop, and what the shop adds on top. Each point adds 0.01 to the factor rate and pays the shop 1% of the advance.</dd>' +
          '<dt>Open positions</dt><dd>Other cash advances the merchant is still paying back.</dd>' +
          '<dt>Gone quiet</dt><dd>A shop that has not sent a deal in ' + S().alerts.quietDays + ' days. You can change that in Settings.</dd></dl>' };
    },
    list: function (m) {
      return { title: m.title, sub: esc(plural(m.rows.length, 'deal')), wide: true, foot: false,
        body: m.rows.length ? '<div class="rows list-rows">' + m.rows.map(function (d) {
          return '<button type="button" class="row" data-act="open-from-list" data-type="deal" data-id="' + esc(d.id) + '"><div class="main"><b>' + esc(d.merchant.business) + '</b><div class="sub">' + esc((shopOf(d) || {}).name || '') + '</div></div><div>' + stagePill(d) + '</div><div class="muted">' + esc(fmtDay(d.funded ? d.funded.fundedAt : d.submittedAt)) + '</div><div class="right money-sm">' + money(d.funded ? d.funded.amount : d.requested) + '</div></button>';
        }).join('') + '</div>' : '<div class="empty-line">No deals.</div>' };
    },
    addShop: function (m) {
      return { title: 'Add a shop', sub: 'It goes straight into your book. As you type, we check whether the shop is already here under another spelling.', submit: 'Add shop', spec: 'add-shop',
        body: '<div class="grid2">' + field('Shop name', input('name', m.name || '', 'text', ' autofocus autocomplete="off" data-in="addshop-name"'), 'wide') +
          '<div class="wide" id="addshop-match">' + addShopMatches(m.name || '') + '</div>' + field('State', select('state', A.STATES, 'FL')) + '<span></span>' +
          '<div class="form-sec wide">Main contact (optional)</div>' + field('Name', input('owner', '')) + field('Role', select('role', A.CONTACT_ROLES, 'Owner')) + field('Phone', input('phone', '', 'tel')) + field('Email', input('email', '', 'email')) +
          '<label class="checkline wide"><input type="checkbox" name="signed"> The ISO agreement is signed</label></div>' };
    },
    addList: function (m) {
      return { title: 'Add a list of shops', sub: 'Paste shop names, one per line, straight from an email or a spreadsheet. Shops already here are matched, not duplicated.', submit: 'Add shops', wide: true, spec: 'add-list',
        body: '<label class="field"><span>Shop names</span><textarea name="names" rows="8" autofocus data-in="addlist" placeholder="Bridgeway Funding Partners&#10;New Horizon Capital">' + esc(m.text || '') + '</textarea></label><div id="addlist-preview">' + addListPreview(m.text || '') + '</div>' };
    },
    newDeal: function (m) {
      var shops = I.shops.filter(function (s) { return inBook(s.repId) || s.id === m.shopId; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      var sid = m.shopId || (shops[0] && shops[0].id), shop = DB.shops[sid];
      return { title: 'Log a submission', sub: 'A shop sent you a deal. It lands in New submission.', submit: 'Log submission', wide: true, spec: 'log-submission',
        body: '<div class="grid3">' + field('Shop', select('shopId', shops.map(function (s) { return [s.id, s.name]; }), sid, ' data-in="newdeal-shop"'), 'span2') +
          field('Sent by', '<span id="nd-contact">' + select('contactId', (shop ? shop.contacts : []).map(function (c) { return [c.id, c.name + ', ' + c.role]; }), '') + '</span>') +
          field('Business name', input('business', '', 'text', ' autofocus autocomplete="off" data-in="newdeal-biz"')) + field('Owner', input('owner', '')) + field('Industry', select('industry', [['', 'Pick one']].concat(A.INDUSTRIES), '')) +
          '<div class="span3" id="nd-match"></div>' +
          field('State', select('state', [['', 'Pick one']].concat(A.STATES), '')) + field('Monthly revenue', input('monthlyRevenue', '', 'number', ' min="0" step="1000" placeholder="$"')) + field('Amount requested', input('requested', '', 'number', ' min="0" step="1000" placeholder="$"')) +
          field('Time in business (months)', input('tibMonths', '', 'number', ' min="0"')) + field('Credit score', input('fico', '', 'number', ' min="300" max="850"')) + field('Open positions', select('positions', ['0', '1', '2', '3', '4', '5'], '0')) +
          '<div class="form-sec span3">What came with it</div><div class="span3 checks"><label class="checkline"><input type="checkbox" name="app" checked> Signed application</label>' +
          A.statementMonths().map(function (mk) { return '<label class="checkline"><input type="checkbox" name="st_' + mk + '" checked> ' + A.monthLabel(mk, true) + ' statement</label>'; }).join('') + '</div></div>' };
    },
    offer: function (m) {
      var d = DB.deals[m.dealId], o = m.o;
      return { title: m.offerId ? 'Edit offer' : 'Record an approval', sub: 'What underwriting approved for ' + esc(d.merchant.business) + '.', submit: 'Save offer', spec: 'record-offer',
        left: m.offerId ? '<button type="button" class="btn danger left" data-act="offer-remove">Remove offer</button>' : '',
        body: '<div class="grid3">' + field('Amount', input('amount', o.amount, 'number', ' min="1000" step="500" data-in="offer-f"')) + field('Buy rate', input('buyRate', o.buyRate, 'number', ' min="1" max="2" step="0.01" data-in="offer-f"')) + field('Term (months)', input('termMonths', o.termMonths, 'number', ' min="1" max="24" data-in="offer-f"')) +
          field('Payments', select('freq', [['daily', 'Daily'], ['weekly', 'Weekly']], o.freq, ' data-in="offer-f"')) + field('Max points for the shop', input('maxPoints', o.maxPoints, 'number', ' min="0" max="15" data-in="offer-f"')) + field('Fee %', input('fee', o.fee, 'number', ' min="0" max="10" step="0.5" data-in="offer-f"')) +
          '<p class="span3 preview" id="offer-preview">' + offerPreview(o) + '</p></div>' };
    },
    close: function (m) {
      var d = DB.deals[m.dealId], kind = m.kindSel, reasons = kind === 'declined' ? A.DECLINE_REASONS : A.LOST_REASONS;
      return { title: kind === 'declined' ? 'Underwriting declined it' : 'Mark it lost', sub: esc(d.merchant.business) + '. The reason is kept with the deal.', submit: kind === 'declined' ? 'Mark declined' : 'Mark lost', spec: 'close-deal',
        body: '<div class="seg wide-seg"><button type="button" class="' + (kind === 'declined' ? 'on' : '') + '" data-act="close-kind" data-v="declined">Underwriting declined</button><button type="button" class="' + (kind === 'lost' ? 'on' : '') + '" data-act="close-kind" data-v="lost">Merchant or shop walked</button></div>' +
          '<div class="reasons">' + reasons.map(function (r) { return '<label class="' + (m.reason === r ? 'on' : '') + '"><input type="radio" name="reason" value="' + esc(r) + '"' + (m.reason === r ? ' checked' : '') + ' data-in="reason"> ' + esc(r) + '</label>'; }).join('') + '</div>' +
          field('Note' + (m.reason === 'Other' ? ' (needed for Other)' : ' (optional)'), '<textarea name="note" rows="2">' + esc(m.note || '') + '</textarea>') + (m.err ? '<p class="err">' + esc(m.err) + '</p>' : '') };
    },
    assign: function (m) {
      var s = DB.shops[m.shopId], inf = shopInfo(s), to = m.repId === undefined ? (s.repId || '') : m.repId, cons = [];
      if (to === (s.repId || '')) cons.push('Pick someone to see what changes.');
      else {
        cons.push(inf.open.length ? plural(inf.open.length, 'open deal') + ' move' + (inf.open.length === 1 ? 's' : '') + ' with the shop.' : 'No open deals to move.');
        if (inf.deals.some(function (d) { return d.funded; })) cons.push('Funded deals stay credited to whoever had the shop when they funded.');
        if (openFUs(s).length) cons.push('Follow-ups on the shop move with it.');
      }
      return { title: 'Who looks after ' + s.name + '?', sub: 'Deals follow their shop.', submit: to === (s.repId || '') ? null : (to === ME ? 'Take it' : to ? 'Hand it to ' + pfirst(to) : 'Leave it with nobody'), spec: 'hand-off',
        body: '<div class="reasons">' + activeTeam().map(function (p) { return [p.id, p.id === ME ? 'You (' + p.name + ')' : p.name]; }).concat([['', 'Nobody for now']]).map(function (o) {
          return '<label class="' + (to === o[0] ? 'on' : '') + '"><input type="radio" name="repId" value="' + o[0] + '"' + (to === o[0] ? ' checked' : '') + ' data-in="assign-rep"> ' + esc(o[1]) + (o[0] === (s.repId || '') ? ' <span class="muted">(now)</span>' : '') + '</label>';
        }).join('') + '</div><ul class="cons">' + cons.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' };
    },
    merge: function (m) {
      var a = DB.shops[m.a], b = DB.shops[m.b], keep = m.keep === b.id ? b : a, drop = keep === a ? b : a, di = shopInfo(drop);
      return { title: 'Merge duplicate shops', sub: 'Both records are the same shop. Merging keeps everything in one place.', submit: 'Merge into ' + keep.name, spec: 'merge-duplicates',
        body: '<div class="form-sec">Keep this name</div><div class="reasons">' + [a, b].map(function (s) { var x = shopInfo(s); return '<label class="' + (keep === s ? 'on' : '') + '"><input type="radio" name="keep" value="' + esc(s.id) + '"' + (keep === s ? ' checked' : '') + ' data-in="merge-keep"> <span><b>' + esc(s.name) + '</b><br><span class="muted">' + esc(whose(s.repId)) + ', ' + plural(x.deals.length, 'deal') + ', ' + plural(s.contacts.length, 'person', 'people') + ', added ' + fmtDay(s.createdAt) + '</span></span></label>'; }).join('') + '</div>' +
          '<ul class="cons"><li>' + esc(plural(di.deals.length, 'deal') + ' and ' + plural(drop.contacts.length, 'person', 'people') + ' move into ' + keep.name + '.') + '</li><li>' + esc(drop.name + ' is deleted. You can undo right after.') + '</li></ul>' };
    },
    editShop: function (m) {
      var s = DB.shops[m.shopId], n = (I.dealsByShop[s.id] || []).length;
      return { title: 'Edit shop', submit: 'Save', spec: 'edit-shop', left: n ? '' : '<button type="button" class="btn danger left" data-act="shop-delete">Delete shop</button>',
        body: '<div class="grid2">' + field('Shop name', input('name', s.name), 'wide') + field('State', select('state', [['', 'Pick one']].concat(s.state && A.STATES.indexOf(s.state) < 0 ? [s.state] : []).concat(A.STATES), s.state || '')) + '<span></span>' +
          field('About this shop', '<textarea name="about" rows="3">' + esc(s.about || '') + '</textarea>', 'wide') +
          '<label class="checkline wide"><input type="checkbox" name="signed"' + (s.agreementAt ? ' checked' : '') + '> The ISO agreement is signed</label>' +
          '<label class="checkline wide"><input type="checkbox" name="w9"' + (s.w9At ? ' checked' : '') + '> We have their W-9</label>' +
          '<label class="checkline wide"><input type="checkbox" name="paused"' + (s.paused ? ' checked' : '') + '> Pause new submissions from this shop</label>' +
          field('Why it is paused', input('pausedReason', s.paused ? s.paused.reason : ''), 'wide') +
          (n ? '<p class="muted wide">This shop has ' + plural(n, 'deal') + ', so it cannot be deleted. If it is a duplicate, merge it instead.</p>' : '') + '</div>' };
    },
    editDeal: function (m) {
      var d = DB.deals[m.dealId], x = d.merchant, fd = d.funded;
      var inds = x.industry && A.INDUSTRIES.indexOf(x.industry) < 0 ? [x.industry].concat(A.INDUSTRIES) : A.INDUSTRIES, states = x.state && A.STATES.indexOf(x.state) < 0 ? [x.state].concat(A.STATES) : A.STATES;
      return { title: 'Edit deal', submit: 'Save', wide: true, left: '<button type="button" class="btn danger left" data-act="deal-delete">Delete deal</button>',
        body: '<div class="grid3">' + field('Business name', input('business', x.business)) + field('Owner', input('owner', x.owner)) + field('Industry', select('industry', inds, x.industry)) +
          field('State', select('state', states, x.state)) + field('Monthly revenue', input('monthlyRevenue', x.monthlyRevenue, 'number')) + field('Amount requested', input('requested', d.requested, 'number')) +
          field('Time in business (months)', input('tibMonths', x.tibMonths, 'number')) + field('Credit score', input('fico', x.fico, 'number')) + field('Open positions', select('positions', ['0', '1', '2', '3', '4', '5'], String(x.positions))) +
          field('Merchant phone', input('mphone', x.phone || '', 'tel')) + field('Merchant email', input('memail', x.email || '', 'email')) + '<span></span>' +
          (fd ? '<div class="form-sec span3">What funded</div>' + field('Funded amount', input('fAmount', fd.amount, 'number', ' min="0"')) + field('Funded on', input('fDate', A.dateOnly(fd.fundedAt), 'date')) +
            field('Factor rate the merchant pays', input('fFactor', fd.noTerms ? '' : A.sellRate(fd).toFixed(2), 'number', ' step="0.01" min="1" max="2" placeholder="1.35"')) + field('Term (months)', input('fTerm', fd.noTerms ? '' : fd.termMonths, 'number', ' min="1" max="24"')) +
            field('Payments', select('fFreq', [['daily', 'Daily'], ['weekly', 'Weekly']], fd.freq)) + field('Shop points', input('fPoints', fd.points || 0, 'number', ' min="0" max="15"')) : '') + '</div>' };
    },
    addContactFrom: function (m) {
      var shops = I.shops.filter(function (s) { return s.repId === ME; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return { title: 'Add ' + fmtPhone(m.key) + ' to a shop', submit: 'Add person',
        body: '<div class="grid2">' + field('Shop', select('shopId', shops.map(function (s) { return [s.id, s.name]; }), '')) + field('Role', select('role', A.CONTACT_ROLES, 'Sales rep')) + field('Name', input('name', '', 'text', ' autofocus'), 'wide') + '</div>' };
    },
    newText: function () {
      var people = [];
      I.shops.filter(function (s) { return s.repId === ME; }).forEach(function (s) { s.contacts.forEach(function (c) { if (c.phone) people.push([digits(c.phone), c.name + ', ' + s.name]); }); });
      people.sort(function (a, b) { return a[1].localeCompare(b[1]); });
      return { title: 'New text', submit: 'Open conversation', body: field('To', select('to', people, '')) + field('Or type a number', input('number', '', 'tel', ' placeholder="(305) 555-0100"')) };
    },
    // One drafted text at a time: who, why now, what you know about them, and the text to change or send.
    review: function (m) {
      var t = reviewCur(m);
      if (!t) {
        var bits = [m.sent ? m.sent + (LIVE ? ' copied' : ' sent') : '', m.later ? m.later + ' moved to later' : '', m.skipped ? m.skipped + ' skipped' : ''].filter(Boolean), wait = touches().waiting.length;
        return { title: 'That is all of them', sub: esc(bits.length ? cap(words(bits)) + '.' : 'Nothing was left to send.'), spec: 'touch-review', foot: false,
          body: '<div class="rv-done"><p>' + (wait ? plural(wait, 'more shop') + ' can wait until tomorrow.' : 'Every shop due a word today has had one.') + '</p><button type="button" class="btn primary" data-act="modal-close">Back to Today</button></div>' };
      }
      var inf = shopInfo(t.s), n = m.ids.length;
      var facts = [inf.pace ? 'Sends a deal every ' + plural(inf.pace, 'day') : inf.deals.length ? plural(inf.deals.length, 'deal') + ' so far' : 'No deals yet', inf.last ? 'last one ' + lc(agoText(inf.last)) : '',
        inf.decided ? inf.appr + ' of ' + inf.decided + ' approved in 90 days' : '', inf.f90 ? money(inf.f90) + ' funded in 90 days' : ''].filter(Boolean);
      var choose = m.choose === 'later' ? '<div class="rv-choose"><span>Bring it back</span>' + quickTimes().map(function (x) { return '<button type="button" class="chip" data-act="rv-later" data-due="' + esc(x.due) + '" data-time="' + esc(x.time) + '">' + x.label + '</button>'; }).join('') + '</div>'
        : m.choose === 'skip' ? '<div class="rv-choose"><span>Skip it because</span>' + SKIPS.map(function (x) { return '<button type="button" class="chip" data-act="rv-skip" data-v="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' : '';
      return { title: "Today's texts", sub: (m.i + 1) + ' of ' + n + '. Read it, change anything, send.', spec: 'touch-review', foot: false,
        body: '<div class="rv-prog"><span style="width:' + Math.round(m.i / n * 100) + '%"></span></div>' +
          '<div class="rv-who"><div><b>' + esc(t.s.name) + '</b> <span class="muted">' + esc(t.c.name) + ', ' + esc(t.c.phone) + '</span></div><span class="pill' + (t.late ? ' warn' : '') + '">' + esc(t.chip) + '</span></div>' +
          '<p class="rv-why">' + esc(t.why) + '</p>' + '<p class="rv-facts">' + esc(cap(facts.join(', '))) + '.</p>' +
          '<textarea data-in="touch" data-k="' + esc(t.id) + '" rows="4" aria-label="Text to ' + esc(first(t.c.name)) + '" autofocus>' + esc(touchText(t)) + '</textarea>' + choose +
          '<div class="rv-bar"><button type="button" class="btn ghost' + (m.choose === 'skip' ? ' on' : '') + '" data-act="rv-choose" data-v="skip">Skip</button><button type="button" class="btn ghost' + (m.choose === 'later' ? ' on' : '') + '" data-act="rv-choose" data-v="later">Later</button><span class="sp"></span>' +
          (LIVE ? '<button type="button" class="link" data-act="rv-sms">Open in Messages</button>' : '') + '<button type="submit" class="btn primary">' + ICON.send + (LIVE ? 'Copy and next' : 'Send and next') + '</button></div>' +
          '<p class="rv-hint">' + (LIVE ? 'Copy puts it on your clipboard to paste into Connect UC. ' : '') + 'Cmd or Ctrl and Enter sends it.</p>' };
    },
    howPicked: function () {
      var a = autoSet(), row = function (r) { var off = a.off.indexOf(r.id) >= 0; return '<li class="' + (off ? 'off' : '') + '"><b>' + esc(r.label) + '</b><span>' + esc(ruleWhen(r.id)) + (off ? '. Turned off in Settings.' : '.') + '</span></li>'; };
      return { title: 'How follow-ups are picked', sub: 'Every day the desk looks at each shop in your book and writes the one thing worth saying. Nothing goes out until you send it.', spec: 'how-picked', wide: true, foot: false,
        body: '<h3 class="hp-h">News on their deals, always shown</h3><ul class="hp">' + A.AUTO_RULES.filter(function (r) { return r.group === 'deal'; }).map(row).join('') + '</ul>' +
          '<h3 class="hp-h">Keeping in touch, up to ' + a.perDay + ' a day, in this order</h3><ul class="hp">' + A.AUTO_RULES.filter(function (r) { return r.group === 'shop'; }).map(row).join('') + '</ul>' +
          '<dl class="gloss"><dt>Usual pace</dt><dd>The typical gap between a shop\'s deals, from its last few. A shop is slowing down once the gap since its last deal is half again its usual one, and gone quiet at three times it, or after ' + S().alerts.quietDays + ' days at most.</dd>' +
          '<dt>Top shops</dt><dd>The fifth of your book that funded the most in the last six months.</dd>' +
          '<dt>Biggest first</dt><dd>Within each kind, the shops that funded the most in the last six months come first. The rest wait for the next day.</dd>' +
          '<dt>One a day per shop</dt><dd>A shop you set your own follow-up on is left to you. Turn a shop off from its page.</dd>' +
          '<dt>Skip and Later</dt><dd>Skip counts as being in touch, so the shop comes back on its usual schedule. Later brings it back when you pick.</dd></dl>' +
          '<div class="btn-row"><button type="button" class="btn" data-act="settings-open">Change these in Settings</button></div>' };
    },
    settings: function (m) {
      var st = m.st, notif = 'Notification' in window;
      var carriers = '<li><span class="pill">To do</span><div><b>Keep calls from showing as Spam Likely</b><span>Register the number with each carrier: <a href="https://hiyahelp.zendesk.com/hc/en-us/requests/new" target="_blank" rel="noopener">AT&amp;T (Hiya)</a>, <a href="https://callreporting.t-mobile.com/" target="_blank" rel="noopener">T-Mobile</a>, <a href="https://reportarobocall.com/trf/" target="_blank" rel="noopener">Verizon</a>, <a href="https://spamreport.spectrum.com/charter/" target="_blank" rel="noopener">Spectrum</a>.</span></div></li>';
      var phone = LIVE
        ? '<div class="set-sec" data-spec-id="phone-setup"><h3>Your phone line</h3>' + field('Your number', input('phone', st.phone || myPhone(), 'tel'), 'inline-field') +
          '<ul class="setup"><li><span class="pill good">Working now</span><div><b>Calls open Connect UC</b><span>Call hands the number to your calling app. If it opens FaceTime instead, make Connect UC the default app for phone links. When you hang up, log the call in the desk.</span></div></li>' +
          '<li><span class="pill good">Working now</span><div><b>Texts copy for Connect UC</b><span>Copy text puts the message on your clipboard. Paste it into Connect UC so it goes out from ' + esc(myPhone()) + '. Open in Messages sends from that device\'s own number instead.</span></div></li>' +
          '<li><span class="pill warn">Next</span><div><b>Calls and texts inside ISO Desk from ' + esc(myPhone()) + '</b><span>Needs your line connected and business texting registered. Yonatan is setting it up with Unicom.</span></div></li>' + carriers + '</ul></div>'
        : '<div class="set-sec" data-spec-id="phone-setup"><h3>Your phone line</h3><p class="lead"><b>' + esc(myPhone()) + '</b> on ' + esc(A.MY_PHONE.provider) + '. Calls and texts in the desk go out from this number.</p>' +
          '<ul class="setup"><li><span class="pill warn">Not connected yet</span><div><b>Calling</b><span>Calls in this demo are simulated. Live calling connects through Connect UC click to call.</span></div></li>' +
          '<li><span class="pill warn">Not registered yet</span><div><b>Texting</b><span>Business texting from this number has to be registered for A2P 10DLC through Unicom first.</span></div></li>' + carriers + '</ul></div>';
      var device = LIVE
        ? '<div class="device-line"><span>Alerts on this ' + deviceWord() + ': <b>' + (UI.push ? 'on' : 'off') + '</b></span>' + (UI.push ? '<button type="button" class="btn sm" data-act="push-test">Send a test</button><button type="button" class="btn sm ghost" data-act="push-off">Turn off</button>' : '<button type="button" class="btn sm primary" data-act="phone-setup">Turn on</button>') + '</div>'
        : (notif ? '<label class="checkline"><input type="checkbox" name="desktop"' + (UI.desktop && Notification.permission === 'granted' ? ' checked' : '') + '> Show desktop alerts in this browser when a follow-up comes due</label>' : '');
      var data = LIVE
        ? '<div class="set-sec" data-spec-id="your-data"><h3>Your data</h3><p class="muted">Bring in contacts and spreadsheets, or take a full copy with you any time.</p><div class="btn-row"><button type="button" class="btn sm" data-act="import-open">Import</button><button type="button" class="btn sm" data-act="export-shops">Download shops and people</button><button type="button" class="btn sm" data-act="export-deals">Download deals</button><button type="button" class="btn sm" data-act="export-backup">Download a full backup</button></div></div>' +
          '<div class="set-sec" data-spec-id="account"><h3>Account</h3><p class="lead"><b>' + esc(SESSION.user.name) + '</b>, ' + esc(SESSION.user.email) + '</p>' +
          (m.pw ? '<div class="grid2 tight">' + field('Current password', '<input name="pwCur" type="password" autocomplete="current-password">') + field('New password', '<input name="pwNew" type="password" autocomplete="new-password" minlength="8">') + '</div>' + (m.pwErr ? '<p class="err">' + esc(m.pwErr) + '</p>' : '') + '<div class="btn-row"><button type="button" class="btn sm primary" data-act="pw-save">Change password</button><button type="button" class="btn sm ghost" data-act="pw-cancel">Cancel</button></div>'
            : '<div class="btn-row"><button type="button" class="btn sm" data-act="pw-open">Change password</button><button type="button" class="btn sm ghost" data-act="sign-out">Sign out</button></div>') + '</div>'
        : '<div class="set-sec"><h3>Blocked numbers</h3>' + (st.blocked.length ? '<div class="rows">' + st.blocked.map(function (b, i) { return '<div class="row brow"><div class="main"><b>' + esc(fmtPhone(b.phone)) + '</b><div class="sub">Blocked ' + esc(fmtDay(b.at)) + '</div></div><button type="button" class="btn sm ghost" data-act="unblock" data-v="' + i + '">Unblock</button></div>'; }).join('') + '</div>' : '<p class="muted">None yet. Block a number from Messages.</p>') + '</div>' +
          '<div class="set-sec"><h3>Demo data</h3><p class="muted">Put everything back to the starting data for everyone with the link.</p><button type="button" class="btn sm danger" data-act="reset-open">Reset the demo data</button></div>';
      return { title: 'Settings', wide: true, submit: 'Save settings', spec: 'settings',
        body: phone + '<div class="set-sec" data-spec-id="alert-settings"><h3>Alerts</h3>' + device + '<div class="thresholds">' +
          '<label>Flag an offer the shop has not answered after <input type="number" name="offerDays" min="1" max="30" value="' + esc(st.alerts.offerDays) + '"> days</label>' +
          '<label>Flag paperwork the shop still owes after <input type="number" name="paperDays" min="1" max="30" value="' + esc(st.alerts.paperDays) + '"> days</label>' +
          '<label>Count a shop as gone quiet after at most <input type="number" name="quietDays" min="7" max="120" value="' + esc(st.alerts.quietDays) + '"> days with no deals</label></div></div>' +
          '<div class="set-sec" data-spec-id="auto-settings"><h3>Automatic follow-ups</h3><p class="muted">Written for you on Today. Nothing goes out until you send it.</p><div class="thresholds">' +
          '<label>Check in with your top shops every <input type="number" name="autoTop" min="2" max="60" value="' + esc(st.auto.topDays) + '"> days</label>' +
          '<label>Check in with the rest every <input type="number" name="autoOther" min="2" max="90" value="' + esc(st.auto.otherDays) + '"> days</label>' +
          '<label>Show at most <input type="number" name="autoPerDay" min="1" max="200" value="' + esc(st.auto.perDay) + '"> check-ins a day. News on deals always shows.</label></div>' +
          '<div class="auto-rules">' + A.AUTO_RULES.map(function (r) { return '<label class="checkline"><input type="checkbox" name="rule_' + r.id + '"' + (st.auto.off.indexOf(r.id) < 0 ? ' checked' : '') + '> ' + esc(r.label) + '</label>'; }).join('') + '</div>' +
          '<details class="auto-texts"><summary>Change what each one says</summary><p class="muted">{first}, {me}, {shop}, {merchant}, {missing}, {reason}, {amount}, {commission}, {last} and {declines} fill in for each shop.</p>' +
          A.AUTO_RULES.map(function (r) { return '<label class="field"><span>' + esc(r.label) + '</span><textarea data-in="auto-text" data-v="' + r.id + '" rows="2">' + esc(st.auto.texts[r.id] || r.text) + '</textarea></label>'; }).join('') + '</details></div>' +
          '<div class="set-sec" data-spec-id="text-templates"><h3>Text templates</h3><p class="muted">{first}, {merchant}, {shop}, {missing} and {reason} fill in from the conversation.</p>' +
          st.templates.map(function (t, i) { return '<div class="tpl-edit"><input data-in="tpl-name" data-i="' + i + '" value="' + esc(t.name) + '" aria-label="Template name"><textarea data-in="tpl-text" data-i="' + i + '" rows="2" aria-label="Template text">' + esc(t.text) + '</textarea><button type="button" class="ib" data-act="tpl-del" data-v="' + i + '" data-tip="Delete template" aria-label="Delete template">' + ICON.x + '</button></div>'; }).join('') +
          '<button type="button" class="btn sm" data-act="tpl-add">' + ICON.plus + 'Add a template</button></div>' + data };
    },
    phone: function () {
      var ios = isIOS(), sup = pushSupported(), word = deviceWord();
      var on = UI.push ? '<div class="match-box good"><b>Alerts are on for this ' + word + '.</b><span>Follow-ups pop up when they come due, even with ISO Desk closed.</span><span class="acts"><button type="button" class="btn sm" data-act="push-test">Send a test</button><button type="button" class="btn sm ghost" data-act="push-off">Turn off</button></span></div>' : '';
      var steps;
      if (ios && !standalone()) steps = '<ol class="steps-ol"><li>Open <b>' + esc(location.host) + '</b> in Safari on your iPhone.</li><li>Tap the Share button, then <b>Add to Home Screen</b>.</li><li>Open ISO Desk from your home screen, sign in, and tap <b>Turn on alerts</b>.</li></ol><p class="muted">iPhones only show alerts from websites that are on the home screen.</p>';
      else if (!sup) steps = '<p>This browser cannot show alerts. On a computer use Chrome, Edge or Safari. On an iPhone, add ISO Desk to the home screen first.</p>';
      else steps = (UI.push ? '' : '<p class="lead">Turn alerts on for this ' + word + '. Then do the same on your other devices.</p><button type="button" class="btn primary" data-act="push-on">' + ICON.clock + 'Turn on alerts</button>') +
        (word === 'computer' ? '<p class="muted">On your iPhone: open ' + esc(location.host) + ' in Safari, tap Share, then Add to Home Screen. Open it from there and turn alerts on.</p>' : '');
      return { title: 'Alerts on your phone', sub: 'Get a buzz when a follow-up comes due, with the shop and what it is for.', foot: false, spec: 'phone-alerts', body: on + steps };
    },
    unfund: function (m) {
      var d = DB.deals[m.dealId];
      return { title: 'Move it out of Funded?', sub: esc(d.merchant.business) + ' goes back to ' + esc(STAGE_LABEL[m.to].toLowerCase()) + '.', submit: 'Move it back',
        body: '<ul class="cons"><li>The funding record goes: ' + esc(money(d.funded.amount)) + ' funded ' + esc(fmtDay(d.funded.fundedAt)) + ', its terms and the commission paid mark.</li><li>You can undo right after.</li></ul>' };
    },
    feedback: function () {
      return { title: 'Send Yonatan feedback', sub: 'What is missing, confusing or slow? Anything goes.', submit: 'Send', spec: 'feedback',
        body: '<textarea name="text" rows="6" autofocus placeholder="When I log a call I wish it would..."></textarea>' };
    },
    import: function (m) { return importModal(m); },
    team: function (m) { return teamModal(m); },
    log: function (m) { return logModal(m); },
    reset: function () { return { title: 'Reset the demo data?', sub: 'Everyone with the link goes back to the starting data. Anything people added or changed is removed. Feedback comments stay.', submit: 'Reset for everyone', body: '' }; }
  };
  function offerPreview(o) {
    var x = offerNums(Object.assign({}, o, { points: o.maxPoints }));
    return 'At the full ' + esc(o.maxPoints) + ' points the merchant pays <b>' + x.pay + '</b> ' + x.per + ' for ' + x.n + ' payments, ' + x.back + ' in total, and the shop earns ' + x.comm + '.';
  }
  function addShopMatches(name) {
    var q = A.normName(name);
    if (q.length < 3) return '';
    var exact = I.shops.filter(function (s) { return A.normName(s.name) === q; });
    var near = I.shops.filter(function (s) { var n = A.normName(s.name); return n !== q && (n.indexOf(q) >= 0 || q.indexOf(n) >= 0); }).slice(0, 4);
    if (exact.length) {
      var s = exact[0];
      return '<div class="match-box bad"><b>' + esc(s.name) + ' is already here.</b><span>' + esc(whose(s.repId)) + ', ' + plural(shopInfo(s).deals.length, 'deal') + '.</span><span class="acts"><button type="button" class="btn sm primary" data-act="open-from-list" data-type="shop" data-id="' + esc(s.id) + '">Open it</button>' +
        (!s.repId ? '<button type="button" class="btn sm" data-act="take-shop" data-id="' + esc(s.id) + '">Take it</button>' : '') + '</span><label class="checkline"><input type="checkbox" name="force"> It is a different shop, add it anyway</label></div>';
    }
    if (near.length) return '<div class="match-box"><span>Similar names already here:</span> ' + near.map(function (s) { return '<button type="button" class="link" data-act="open-from-list" data-type="shop" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>'; }).join(', ') + '</div>';
    return '<div class="match-box good"><span>No shop with this name yet.</span></div>';
  }
  function parseList(text) {
    var seen = {};
    return text.split(/\n/).map(function (l) { return l.replace(/^[\s\-*•\d.)]+/, '').trim(); }).filter(function (l) { var n = A.normName(l); if (l.length < 2 || !n || seen[n]) return false; seen[n] = 1; return true; });
  }
  function classifyList(text) {
    var out = { add: [], mine: [], other: [], claim: [] };
    parseList(text).forEach(function (name) {
      var n = A.normName(name), ex = I.shops.filter(function (s) { return A.normName(s.name) === n; })[0];
      if (!ex) out.add.push(name); else if (ex.repId === ME) out.mine.push(ex); else if (!ex.repId) out.claim.push(ex); else out.other.push(ex);
    });
    return out;
  }
  function addListPreview(text) {
    var c = classifyList(text);
    if (!c.add.length && !c.mine.length && !c.other.length && !c.claim.length) return '<p class="muted">Paste names above to see what happens to each one.</p>';
    var g = function (title, list, r) { return list.length ? '<div class="pv"><b>' + esc(title) + '</b><div>' + list.map(r).join('') + '</div></div>' : ''; };
    return '<div class="preview-list">' +
      g(plural(c.add.length, 'new shop') + ' go into your book', c.add, function (n) { return '<span class="tag good">' + esc(n) + '</span>'; }) +
      g(plural(c.claim.length, 'shop') + ' already here with nobody on ' + (c.claim.length === 1 ? 'it, you take it' : 'them, you take them'), c.claim, function (s) { return '<span class="tag">' + esc(s.name) + '</span>'; }) +
      g(plural(c.mine.length, 'shop') + ' already in your book, nothing to do', c.mine, function (s) { return '<span class="tag muted">' + esc(s.name) + '</span>'; }) +
      g(plural(c.other.length, 'shop') + (c.other.length === 1 ? ' belongs' : ' belong') + ' to a teammate, left alone', c.other, function (s) { return '<span class="tag warn">' + esc(s.name) + ' (' + esc(pfirst(s.repId)) + ')</span>'; }) + '</div>';
  }

  // ================= POPOVERS =================
  function closePop() { pop = null; var r = document.getElementById('pop-root'); if (r) r.innerHTML = ''; }
  function openPop(p, anchor) { p.rect = anchor.getBoundingClientRect(); pop = p; renderPop(); }
  function renderPop() {
    var root = document.getElementById('pop-root');
    if (!pop) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="pop' + (pop.kind === 'fu' ? ' wide' : '') + '" role="dialog">' + POPS[pop.kind](pop) + '</div>';
    // Screen pixels to page pixels, in case something (a screen recorder) zooms <body>.
    var z = (document.body.style && parseFloat(document.body.style.zoom)) || 1, el = root.firstChild, r0 = pop.rect, r = { left: r0.left / z, right: r0.right / z, top: r0.top / z, bottom: r0.bottom / z }, vw = window.innerWidth / z, vh = window.innerHeight / z;
    var left = Math.min(vw - el.offsetWidth - 8, Math.max(8, pop.alignRight ? r.right - el.offsetWidth : r.left));
    var top = r.bottom + 6; if (top + el.offsetHeight > vh - 8) top = Math.max(8, r.top - el.offsetHeight - 6);
    el.style.left = left + 'px'; el.style.top = top + 'px';
    var f = el.querySelector('[autofocus]'); if (f && document.activeElement !== f) { f.focus(); if (f.setSelectionRange && f.type !== 'date' && f.type !== 'time') f.setSelectionRange(f.value.length, f.value.length); }
  }
  var POPS = {
    ms: function (p) {
      var sel = UI.f[p.key];
      var opts = p.options.filter(function (o) { return !p.q || o.l.toLowerCase().indexOf(p.q.toLowerCase()) >= 0; });
      return (p.options.length > 8 ? '<input class="search-in" data-in="pop-q" placeholder="Search" value="' + esc(p.q || '') + '" autofocus>' : '') +
        '<label class="any"><input type="checkbox" data-in="ms-any"' + (!sel.length ? ' checked' : '') + '> ' + esc(p.any) + '</label>' +
        opts.map(function (o) { return '<label><input type="checkbox" data-in="ms-opt" value="' + esc(o.v) + '"' + (sel.indexOf(o.v) >= 0 ? ' checked' : '') + '> ' + esc(o.l) + '</label>'; }).join('');
    },
    single: function (p) { return p.options.map(function (o) { return '<button class="opt' + (o[0] === p.value ? ' sel' : '') + '" data-act="single-pick" data-v="' + o[0] + '">' + esc(o[1]) + (o[0] === p.value ? ICON.check : '') + '</button>'; }).join(''); },
    me: function () {
      if (!LIVE) return '<div class="head">' + esc(pname(ME)) + ', ISO manager</div><button class="opt" data-act="settings-open">Settings</button><button class="opt" data-act="import-open">Import contacts or a spreadsheet</button><button class="opt" data-act="how">How this works</button><button class="opt" data-act="tour">Watch the walkthrough</button>';
      return '<div class="head">' + esc(SESSION.user.name) + '<br><span class="muted">' + esc(SESSION.user.email) + (isMgr() ? ', manager' : '') + '</span></div>' +
        '<button class="opt" data-act="settings-open">Settings</button>' + (isMgr() ? '<button class="opt" data-act="team-open">Your team</button>' : '') + '<button class="opt" data-act="log-open">' + (isMgr() ? 'Every change' : 'Your changes') + '</button>' +
        '<button class="opt" data-act="import-open">Import contacts or a spreadsheet</button><button class="opt" data-act="phone-setup">Alerts on your phone</button>' +
        '<button class="opt" data-act="feedback-open">Send Yonatan feedback</button><button class="opt" data-act="how">How this works</button><button class="opt" data-act="tour">Watch the walkthrough</button><div class="sep"></div><button class="opt" data-act="sign-out">Sign out</button>';
    },
    fu: function (p) {
      if (!p.target) {
        var q = (p.q || '').toLowerCase(), res = [];
        I.shops.forEach(function (s) { if (!q || s.name.toLowerCase().indexOf(q) >= 0 || s.contacts.some(function (c) { return c.name.toLowerCase().indexOf(q) >= 0; })) res.push({ type: 'shop', id: s.id, name: s.name, sub: solo() ? ((s.contacts[0] || {}).name || '') : whose(s.repId), mine: s.repId === ME ? 1 : 0 }); });
        I.deals.forEach(function (d) { if (d.stage === 'closed') return; if (!q || d.merchant.business.toLowerCase().indexOf(q) >= 0) res.push({ type: 'deal', id: d.id, name: d.merchant.business, sub: STAGE_LABEL[d.stage] + ', ' + ((shopOf(d) || {}).name || ''), mine: ownerOf(d) === ME ? 1 : 0 }); });
        res.sort(function (a, b) { return (b.mine - a.mine) || (a.type === b.type ? 0 : a.type === 'shop' ? -1 : 1) || a.name.localeCompare(b.name); });
        return '<div class="head">Who is the follow-up for?</div><input class="search-in" data-in="fu-who" placeholder="Search your shops and deals" value="' + esc(p.q || '') + '" autofocus>' +
          '<div class="who-list">' + (res.length ? res.slice(0, 8).map(function (r) { return '<button class="opt" data-act="fu-target" data-type="' + r.type + '" data-id="' + esc(r.id) + '"><span>' + esc(r.name) + '</span><span class="muted">' + esc(r.sub) + '</span></button>'; }).join('') : '<div class="head">Nothing matches</div>') + '</div>';
      }
      var rec = recOf(p.target.type, p.target.id), cur = p.due + ' ' + p.time;
      return '<div class="head">' + (p.fid ? 'Change the follow-up on ' : 'Follow up on ') + '<b>' + esc(recName(p.target.type, rec)) + '</b>' + (p.global && !p.fid ? ' <button class="link" data-act="fu-retarget">Change</button>' : '') + '</div><div class="fu-pop" data-spec-id="follow-up-form">' +
        '<div class="chips">' + quickTimes().map(function (x) { return '<button class="chip' + (x.due + ' ' + x.time === cur ? ' on' : '') + '" data-act="fu-quick" data-due="' + esc(x.due) + '" data-time="' + esc(x.time) + '">' + x.label + '</button>'; }).join('') + '</div>' +
        '<div class="grid2 tight"><label class="field"><span>Day</span><input type="date" data-in="fu-date" value="' + esc(p.due) + '"></label><label class="field"><span>Time</span><input type="time" data-in="fu-time" value="' + esc(p.time) + '" step="900"></label></div>' +
        '<label class="field"><span>What for</span><input data-in="fu-note" value="' + esc(p.note) + '" placeholder="Ask about the two HVAC files" autofocus></label>' +
        '<label class="field"><span>Repeat</span><select data-in="fu-repeat">' + A.REPEATS.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === (p.repeat || '') ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
        '<div class="fu-pop-f">' + (p.fid ? '<button class="btn sm danger" data-act="fu-delete">Delete</button>' : '') + '<span class="sp"></span><button class="btn sm primary" data-act="fu-save">Save follow-up</button></div></div>';
    },
    tlater: function () {
      return '<div class="head">Bring it back</div>' + quickTimes().map(function (x) { return '<button class="opt" data-act="tlater-pick" data-due="' + esc(x.due) + '" data-time="' + esc(x.time) + '">' + x.label + '</button>'; }).join('');
    },
    tskip: function () {
      return '<div class="head">Skip it because</div>' + SKIPS.map(function (x) { return '<button class="opt" data-act="tskip-pick" data-v="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('');
    },
    automode: function (p) {
      var s = DB.shops[p.id], inf = shopInfo(s), auto = 'Automatic: every ' + plural(I.top[s.id] ? autoSet().topDays : inf.quality === 'poor' ? 30 : autoSet().otherDays, 'day');
      return '<div class="head">Check in with ' + esc(s.name) + '</div>' + CADENCE.map(function (c) { return '<button class="opt' + ((s.autoFU || '') === c[0] ? ' sel' : '') + '" data-act="auto-pick" data-v="' + c[0] + '"><span>' + esc(c[0] ? c[1] : auto) + '</span>' + ((s.autoFU || '') === c[0] ? ICON.check : '') + '</button>'; }).join('') +
        '<div class="sep"></div><div class="head">Off still shows news on their deals.</div>';
    },
    later: function () {
      return '<div class="head">Move it to</div>' + quickTimes().map(function (x) { return '<button class="opt" data-act="later-pick" data-due="' + esc(x.due) + '" data-time="' + esc(x.time) + '">' + x.label + '</button>'; }).join('') + '<div class="sep"></div><button class="opt" data-act="later-custom">Pick a day and time</button>';
    },
    search: function (p) {
      var q = p.q.toLowerCase(), qd = q.replace(/\D/g, '');
      var shops = I.shops.filter(function (s) { return s.name.toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return (b.repId === ME) - (a.repId === ME); }).slice(0, 5);
      var people = []; I.shops.forEach(function (s) { s.contacts.forEach(function (c) { if (c.name.toLowerCase().indexOf(q) >= 0 || (qd.length >= 3 && digits(c.phone).indexOf(qd) >= 0)) people.push({ s: s, c: c }); }); });
      var deals = I.deals.filter(function (d) { return d.merchant.business.toLowerCase().indexOf(q) >= 0 || d.merchant.owner.toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }).slice(0, 5);
      if (!shops.length && !people.length && !deals.length) return '<div class="head">Nothing matches "' + esc(p.q) + '"</div>';
      return (shops.length ? '<div class="head">Shops</div>' + shops.map(function (s) { return '<button class="opt" data-act="search-open" data-type="shop" data-id="' + esc(s.id) + '"><span>' + esc(s.name) + '</span><span class="muted">' + esc(solo() ? ((s.contacts[0] || {}).name || s.state || '') : whose(s.repId)) + '</span></button>'; }).join('') : '') +
        (people.length ? '<div class="head">People</div>' + people.slice(0, 4).map(function (x) { return '<button class="opt" data-act="search-open" data-type="shop" data-id="' + esc(x.s.id) + '" data-tab="people"><span>' + esc(x.c.name) + '</span><span class="muted">' + esc(x.s.name) + '</span></button>'; }).join('') : '') +
        (deals.length ? '<div class="head">Merchants</div>' + deals.map(function (d) { return '<button class="opt" data-act="search-open" data-type="deal" data-id="' + esc(d.id) + '"><span>' + esc(d.merchant.business) + '</span><span class="muted">' + esc(STAGE_LABEL[d.stage]) + '</span></button>'; }).join('') : '');
    }
  };
  function openFUPop(anchor, target, fid, global) {
    var p = { kind: 'fu', target: target || null, fid: fid || null, global: global !== undefined ? global : !target, q: '' };
    var f = target && fid ? findFU(target.type, target.id, fid) : null;
    if (f) { p.due = f.due; p.time = f.time || '09:00'; p.note = f.note || ''; p.repeat = f.repeat || ''; }
    else { var q = quickTimes()[0]; p.due = q.due; p.time = q.time; p.note = ''; p.repeat = ''; }
    openPop(p, anchor);
  }
  function readFUPop() {
    var g = function (k) { var el = document.querySelector('.pop [data-in="' + k + '"]'); return el ? el.value : null; };
    if (g('fu-date') !== null) pop.due = g('fu-date') || pop.due;
    if (g('fu-time') !== null) pop.time = g('fu-time') || pop.time;
    if (g('fu-note') !== null) pop.note = g('fu-note');
    if (g('fu-repeat') !== null) pop.repeat = g('fu-repeat');
  }

  // ================= TEAM AND CHANGE LOG =================
  // A manager adds reps, sets who is a manager, and turns logins off. Every change anyone makes is
  // logged on the server; a rep sees their own, a manager everyone's.
  function refreshTeam() {
    return api('/api/auth/me').then(function (res) { if (res.j && res.j.ok) { SESSION = res.j; setTeam(teamFrom(res.j.team)); saveCacheSoon(); render(); } });
  }
  function loadTeam() {
    api('/api/team').then(function (res) {
      if (!modal || modal.kind !== 'team') return;
      if (!res.j.ok) { modal.err = res.j.error || 'The team could not be loaded.'; modal.people = []; modal.invites = []; } else { modal.people = res.j.people; modal.invites = res.j.invites; }
      renderModal();
    }).catch(function () { if (modal && modal.kind === 'team') { modal.err = 'No connection. Try again in a moment.'; modal.people = modal.people || []; modal.invites = modal.invites || []; renderModal(); } });
  }
  function teamModal(m) {
    if (!m.people) return { title: 'Your team', foot: false, spec: 'team', body: '<p class="muted">Loading your team...</p>' };
    var roleOpts = [['rep', 'Rep: sees their own book'], ['manager', 'Manager: sees every book']];
    var rows = m.people.map(function (p) {
      var you = p.member === ME, n = I.shops.filter(function (s) { return s.repId === p.member; }).length;
      var sub = esc(p.email) + (!p.active ? ', login turned off' : p.lastSignIn ? ', last signed in ' + esc(agoText(new Date(p.lastSignIn).toISOString())) : ', has not signed in yet');
      var acts = m.confirm === p.member
        ? '<span class="muted">Turn off ' + esc(first(p.name)) + "'s login?</span><button type=\"button\" class=\"btn sm danger\" data-act=\"team-remove-yes\" data-v=\"" + esc(p.member) + '">Turn it off</button><button type="button" class="btn sm ghost" data-act="team-remove-no">Keep</button>'
        : you ? '' : p.active
          ? '<button type="button" class="btn sm ghost" data-act="team-link" data-v="' + esc(p.member) + '">New sign-in link</button><button type="button" class="btn sm ghost danger" data-act="team-remove" data-v="' + esc(p.member) + '">Turn off login</button>'
          : '<button type="button" class="btn sm" data-act="team-link" data-v="' + esc(p.member) + '">Turn back on</button>';
      return '<div class="row team-row' + (p.active ? '' : ' off') + '"><div class="main"><b>' + esc(p.name) + (you ? ' <span class="muted">(you)</span>' : '') + '</b><div class="sub">' + sub + '</div>' +
        (n ? '<button type="button" class="link" data-act="team-book" data-v="' + esc(p.member) + '">' + esc(plural(n, 'shop')) + ' in ' + (you ? 'your' : 'their') + ' book</button>' : '') + '</div>' +
        '<div>' + (p.active && !you ? select('role_' + p.member, roleOpts, p.role, ' data-in="team-role" data-v="' + esc(p.member) + '" aria-label="Role"') : '<span class="pill">' + (p.role === 'manager' ? 'Manager' : 'Rep') + '</span>') + '</div>' +
        '<div class="acts">' + acts + '</div></div>';
    }).join('');
    var pending = (m.invites || []).filter(function (i) { return !m.people.some(function (p) { return p.email === i.email; }); });
    var link = m.link ? '<div class="match-box good" data-spec-id="team-link"><b>Send this link to ' + esc(m.link.name) + '.</b><span>It works once and runs out in 7 days. They pick a password, then sign in on their phone and computer with their email.</span>' +
      '<input readonly value="' + esc(m.link.url) + '" aria-label="Sign-in link" data-in="team-link-box"><span class="acts"><button type="button" class="btn sm primary" data-act="team-copy">Copy link</button>' +
      (m.link.phone ? '<a class="btn sm" href="sms:' + esc(digits(m.link.phone)) + '&body=' + encodeURIComponent('Your ISO Desk login: ' + m.link.url) + '">Text it to them</a>' : '') + '</span></div>' : '';
    var add = m.add || { role: 'rep' };
    return { title: 'Your team', sub: 'Reps see only their own book. Managers see every book and can move shops between them.', wide: true, submit: 'Add and get their link', spec: 'team',
      body: link + '<div class="rows">' + rows + '</div>' +
        (pending.length ? '<p class="muted">Waiting to pick a password: ' + esc(words(pending.map(function (i) { return i.name; }))) + '.</p>' : '') +
        '<div class="form-sec">Add someone</div><div class="grid2">' + field('Name', input('name', add.name || '', 'text', ' autocomplete="off"')) + field('Email', input('email', add.email || '', 'email', ' autocomplete="off"')) +
        field('Mobile, to text them the link (optional)', input('phone', add.phone || '', 'tel')) + field('Role', select('role', roleOpts, add.role)) + '</div>' +
        (m.err ? '<p class="err">' + esc(m.err) + '</p>' : '') };
  }
  var LOG_FIELDS = { touches: 'automatic follow-ups', autoFU: 'automatic follow-up timing', auto: 'automatic follow-up settings', name: 'name', repId: 'whose book', state: 'state', about: 'notes', contacts: 'people', followUps: 'follow-ups', activity: 'activity', agreementAt: 'ISO agreement',
    w9At: 'W-9', paused: 'paused', stage: 'stage', merchant: 'merchant details', requested: 'amount asked', offers: 'offers', funded: 'funding', closed: 'declined or lost',
    paperwork: 'paperwork', closing: 'closing checklist', acceptedOfferId: 'offer picked', templates: 'text templates', alerts: 'alert timing', blocked: 'blocked numbers',
    phone: 'phone', read: 'read', text: 'text', history: 'past owners', setup: 'setup steps', role: 'role', shopId: 'shop', stageAt: 'stage date', assignedAt: 'date assigned',
    importedAt: 'import date', renewalOf: 'renewal of', contactId: 'sent by', spam: 'spam', outcome: 'call outcome', duration: 'call length', createdAt: 'date added' };
  function logValue(f, v) {
    if (f === 'repId') return v ? pname(v) : 'nobody';
    if (f === 'stage' && STAGE_LABEL[v]) return STAGE_LABEL[v];
    if (f === 'autoFU') return v ? (CADENCE.filter(function (c) { return c[0] === v; })[0] || [v, v])[1].toLowerCase() : 'automatic';
    return v;
  }
  function logChange(c) {
    var label = LOG_FIELDS[c.f] || c.f;
    if (c.added || c.removed || c.changed) return label + ': ' + [c.added ? 'added ' + words(c.added) : '', c.removed ? 'removed ' + words(c.removed) : '', c.changed ? 'changed ' + words(c.changed) : ''].filter(Boolean).join(', ');
    var a = logValue(c.f, c.from), b = logValue(c.f, c.to), plain = function (v) { return typeof v === 'string' && v.length <= 60 && !/^[[{]/.test(v) && !/^\d{4}-\d{2}-\d{2}T/.test(v); };
    if (c.to !== undefined && plain(b) && (a === '' || a === undefined || plain(a))) return label + (a ? ' from ' + a : '') + ' to ' + b;
    return label;
  }
  var LOG_VERB = { create: 'added', update: 'changed', 'delete': 'deleted', 'sign-in': 'signed in', password: 'set a new password', invite: 'sent a sign-in link to', role: 'changed the role of', remove: 'turned off the login of' };
  function logLine(e) {
    var kind = e.kind === 'deals' ? 'deal' : e.kind === 'shops' ? 'shop' : null, rec = kind ? recOf(kind, e.recId) : null;
    var what = e.kind === 'meta' ? 'their settings' : e.action === 'sign-in' || e.action === 'password' ? '' : e.kind === 'deals' ? 'the deal for ' + e.label : e.label;
    var name = rec && e.action !== 'delete' ? '<button class="link" data-act="open-from-list" data-type="' + kind + '" data-id="' + esc(e.recId) + '">' + esc(what) + '</button>' : esc(what);
    var ch = (e.changes || []).map(logChange);
    return '<li><span class="ic sys">' + ICON.dot + '</span><div><div class="meta">' + esc(timeText(new Date(e.at).toISOString())) + '</div><div class="txt"><b>' + esc(e.who || 'Someone') + '</b> ' + esc(LOG_VERB[e.action] || e.action) + (what ? ' ' + name : '') + (ch.length ? ': ' + esc(ch.join('; ')) : '') + '.</div></div></li>';
  }
  function loadLog(more) {
    var m = modal; if (!m || m.kind !== 'log') return;
    var q = ['limit=60'];
    if (m.member) q.push('member=' + encodeURIComponent(m.member));
    if (m.rec) q.push('rec=' + encodeURIComponent(m.rec));
    if (more && m.entries && m.entries.length) q.push('before=' + m.entries[m.entries.length - 1].id);
    api('/api/audit?' + q.join('&')).then(function (res) {
      if (modal !== m) return;
      var list = (res.j && res.j.entries) || [];
      m.entries = more ? (m.entries || []).concat(list) : list; m.more = !!(res.j && res.j.more); m.err = res.j && res.j.ok ? null : 'The change log could not be loaded.';
      renderModal();
    }).catch(function () { if (modal === m) { m.err = 'No connection. Try again in a moment.'; m.entries = m.entries || []; renderModal(); } });
  }
  function logModal(m) {
    var who = isMgr() && !m.rec && TEAM.length > 1 ? '<div class="filters log-who">' + select('who', [['', 'Everyone']].concat(TEAM.map(function (p) { return [p.id, p.name]; })), m.member || '', ' data-in="log-who" aria-label="Whose changes"') + '</div>' : '';
    var body = !m.entries ? '<p class="muted">Loading...</p>' : !m.entries.length ? '<div class="empty-line">No changes yet.</div>'
      : '<ul class="tl log-list">' + m.entries.map(logLine).join('') + '</ul>' + (m.more ? '<button type="button" class="more-line" data-act="log-more">Show older changes</button>' : '');
    return { title: m.rec ? 'Every change to ' + m.recName : isMgr() ? 'Every change' : 'Your changes', sub: 'Who changed what, and when. Newest first.', wide: true, foot: false, spec: 'change-log',
      body: who + (m.err ? '<p class="err">' + esc(m.err) + '</p>' : '') + body };
  }

  // ================= IMPORT AND EXPORT =================
  // Josh's phone contacts (.vcf), a spreadsheet or SmartMCA export (CSV), a pasted list of shop
  // names, or an ISO Desk backup. Parsing lives in importer.js; this turns the result into shops,
  // people and deals, matched against what is already here so nothing gets doubled.
  var IMP = window.ISOImport;
  var FIELD_LABEL = { company: 'Company', name: 'Name', first: 'First name', last: 'Last name', phone: 'Phone', phone2: 'Second phone', email: 'Email', title: 'Job title', state: 'State',
    notes: 'Notes', merchant: 'Merchant', owner: 'Owner', shop: 'Shop', amount: 'Amount', stage: 'Status', date: 'Date', industry: 'Industry', revenue: 'Monthly revenue', fico: 'Credit score' };
  var MAP_FIELDS = { contacts: ['company', 'name', 'first', 'last', 'phone', 'phone2', 'email', 'title', 'state', 'notes'], deals: ['merchant', 'owner', 'shop', 'amount', 'stage', 'date', 'industry', 'state', 'revenue', 'fico'] };
  // Same shop under any spelling. When there are two, the one in your book wins, then nobody's.
  function shopByNorm() {
    var o = {}, rank = function (s) { return s.repId === ME ? 2 : !s.repId ? 1 : 0; };
    I.shops.forEach(function (s) { var k = A.normName(s.name), cur = o[k]; if (!cur || rank(s) > rank(cur)) o[k] = s; });
    return o;
  }
  // Free mail says nothing about where someone works, so only company domains match.
  var FREE_MAIL = {}; ['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'comcast.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'verizon.net', 'cox.net', 'charter.net', 'optonline.net', 'earthlink.net', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com'].forEach(function (d) { FREE_MAIL[d] = 1; });
  function mailDomain(e) { var x = /@([a-z0-9.-]+\.[a-z]{2,})$/.exec(String(e || '').trim().toLowerCase()); return x && !FREE_MAIL[x[1]] ? x[1] : ''; }
  function phoneKey(p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
  function personKeys(people) {
    var ph = [], dm = [];
    people.forEach(function (p) { (p.phones || []).forEach(function (x) { var k = phoneKey(x.number); if (k) ph.push(k); }); (p.emails || []).forEach(function (e) { var d = mailDomain(e); if (d) dm.push(d); }); });
    return { ph: ph, dm: dm };
  }
  function matchIndex() {
    var ix = { name: shopByNorm(), phone: {}, domain: {} };
    I.shops.forEach(function (s) { s.contacts.forEach(function (c) { [c.phone, c.phone2].forEach(function (p) { var k = phoneKey(p); if (k && !ix.phone[k]) ix.phone[k] = s; }); var d = mailDomain(c.email); if (d && !ix.domain[d]) ix.domain[d] = s; }); });
    return ix;
  }
  // Where a company from the file already lives: same name, one of its people's numbers, or its
  // email domain. This device first, then the whole team (the server answers for shops outside a
  // rep's book). { shop, how } can take new people; { taken, how } is in someone else's book.
  function shopMatch(m, ix, name, people) {
    var r = m.remote || { names: {}, phones: {}, domains: {} }, n = A.normName(name), k = personKeys(people), hit = null;
    var pick = function (keys, map, how) { for (var i = 0; i < keys.length; i++) if (map[keys[i]]) return { v: map[keys[i]], how: how }; return null; };
    hit = (n && ix.name[n] ? { v: ix.name[n], how: 'name' } : null) || pick(k.ph, ix.phone, 'phone') || pick(k.dm, ix.domain, 'email');
    if (hit) return { shop: hit.v, how: hit.how };
    hit = (n && r.names[n] ? { v: r.names[n], how: 'name' } : null) || pick(k.ph, r.phones, 'phone') || pick(k.dm, r.domains, 'email');
    if (!hit) return null;
    return hit.v.id && DB.shops[hit.v.id] ? { shop: DB.shops[hit.v.id], how: hit.how } : { taken: hit.v, how: hit.how };
  }
  function howText(how, shop) { return how === 'phone' ? 'same phone number as someone at ' + shop : how === 'email' ? 'same email domain as ' + shop : ''; }
  // New shops from an import go to the picked person (a manager can pick anyone, or nobody).
  function importOwner(m) { return LIVE && isMgr() && m.assign !== undefined ? m.assign : ME; }
  function assignBox(m) {
    if (!LIVE || !isMgr() || activeTeam().length < 2) return '';
    var to = m.assign === undefined ? ME : m.assign || '';
    return '<div class="imp-assign" data-spec-id="import-assign">' + field('New shops go to', select('assign', activeTeam().map(function (p) { return [p.id, p.id === ME ? 'You (' + p.name + ')' : p.name]; }).concat([['', 'Nobody yet']]), to, ' data-in="imp-assign"')) + '</div>';
  }
  // Asks the server which of the file's shops, numbers and email domains are already on the team.
  function importCheck(m) {
    if (!LIVE || !SESSION) return;
    var names = [], phones = [], domains = [], seen = {};
    var add = function (list, v) { if (v && !seen[list.length + '|' + v] && list.length < 3000) { seen[list.length + '|' + v] = 1; list.push(v); } };
    if (m.tkind === 'deals') (m.deals || []).forEach(function (d) { add(names, d.shop); });
    else if (m.groups) m.groups.companies.concat(m.groups.loose.map(function (p) { return { name: '', people: [p] }; })).forEach(function (g) { add(names, g.name); var k = personKeys(g.people); k.ph.forEach(function (x) { add(phones, x); }); k.dm.forEach(function (x) { add(domains, x); }); });
    var key = names.join('|') + '#' + phones.join('|') + '#' + domains.join('|');
    if (m.checkKey === key) return;
    m.checkKey = key; m.remote = null; m.checking = true;
    api('/api/import-check', { names: names, phones: phones, domains: domains }).then(function (res) {
      if (modal !== m || m.checkKey !== key) return;
      var j = res.j || {};
      m.checking = false; m.remote = j.ok ? { names: j.names || {}, phones: j.phones || {}, domains: j.domains || {} } : null; renderModal();
    }).catch(function () { if (modal === m && m.checkKey === key) { m.checking = false; renderModal(); } });
  }
  // The whole contacts import worked out once, for the preview and for the import itself.
  function planImport(m) {
    var ix = matchIndex(), rows = [], byDomain = {}, plan = { rows: rows, joins: {}, toShop: [], rest: [], already: 0 };
    m.groups.companies.forEach(function (g) {
      var mt = shopMatch(m, ix, g.name, g.people), x = { g: g, mt: mt, state: !mt ? 'new' : mt.taken ? 'taken' : 'add' };
      if (x.state === 'add') x.fresh = g.people.filter(function (p) { var c = toContact(p); return !mt.shop.contacts.some(function (y) { return sameContact(y, c); }); }).length;
      rows.push(x);
      if (x.state !== 'taken') personKeys(g.people).dm.forEach(function (d) { if (!byDomain[d]) byDomain[d] = x; });
    });
    // People with no company: matched to a shop already here, or to a company in the same file by email domain.
    m.groups.loose.forEach(function (p) {
      var mt = shopMatch(m, ix, '', [p]);
      if (mt && mt.shop) { var c = toContact(p); if (mt.shop.contacts.some(function (y) { return sameContact(y, c); })) plan.already++; else plan.toShop.push({ p: p, shop: mt.shop, how: mt.how }); return; }
      if (mt && mt.taken) { plan.rest.push(p); return; }
      var fx = personKeys([p]).dm.map(function (d) { return byDomain[d]; }).filter(Boolean)[0];
      if (fx) { (plan.joins[fx.g.key] = plan.joins[fx.g.key] || []).push(p); return; }
      plan.rest.push(p);
    });
    return plan;
  }
  function roleFor(t) { t = String(t || '').toLowerCase(); return /owner|ceo|president|founder|principal|partner|managing/.test(t) ? 'Owner' : /process|underwrit|admin|operation|\bops\b|assistant|file/.test(t) ? 'Processor' : 'Sales rep'; }
  function toContact(p) {
    var ph = (p.phones || []).map(function (x) { return fmtPhone(x.number); });
    return { id: uid('c'), name: p.name || [p.first, p.last].join(' ').trim() || p.org || ph[0] || 'Unnamed', role: roleFor(p.title), phone: ph[0] || '', phone2: ph[1] || '', email: (p.emails || [])[0] || '' };
  }
  function sameContact(a, b) {
    var pa = [digits(a.phone), digits(a.phone2)].filter(Boolean), pb = [digits(b.phone), digits(b.phone2)].filter(Boolean);
    if (pa.some(function (x) { return pb.indexOf(x) >= 0; })) return true;
    if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return true;
    return !!a.name && a.name.toLowerCase() === String(b.name || '').toLowerCase();
  }
  function closedOut(at) { var c = {}; A.CLOSING_ITEMS.forEach(function (x) { c[x.id] = at; }); return c; }
  function sheetDay(isoStr) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(isoStr || ''); return m ? new Date(parseDay(m[1]).getTime() + 12 * 36e5).toISOString() : null; }
  function matchIndustry(t) { t = String(t || '').trim(); if (!t) return ''; var low = t.toLowerCase(); return A.INDUSTRIES.filter(function (x) { return x.toLowerCase() === low || low.indexOf(x.toLowerCase()) >= 0 || x.toLowerCase().indexOf(low) >= 0; })[0] || t.slice(0, 60); }
  function importParse(m) {
    var text = m.text || '';
    m.fmt = IMP.sniff(text, m.fileName || '');
    m.err = null;
    if (m.fmt === 'backup') { try { m.backup = JSON.parse(text); } catch (e) { m.err = 'This backup file could not be read.'; } return; }
    if (m.fmt === 'list') return;
    var people = [];
    if (m.fmt === 'vcard') people = IMP.parseVCards(text);
    else {
      m.table = m.table || IMP.parseTable(text);
      if (!m.map) { var g = IMP.guessMap(m.table.headers, m.table.rows); m.map = g.map; m.tkind = g.kind; }
      if (m.tkind === 'deals') { m.deals = IMP.dealsFromTable(m.table, m.map).map(function (d) { d.date = sheetDay(d.date); return d; }); importCheck(m); return; }
      people = IMP.peopleFromTable(m.table, m.map);
    }
    m.groups = IMP.groupPeople(people);
    m.sel = m.sel || {};
    m.groups.companies.forEach(function (c) { if (m.sel[c.key] === undefined) m.sel[c.key] = true; });
    if (!m.loose) m.loose = 'skip';
    if (m.looseMatch === undefined) m.looseMatch = true;
    importCheck(m);
  }
  function importModal(m) {
    if (m.step !== 'preview') {
      return { title: 'Import shops, people or deals', wide: true, foot: false, spec: 'import',
        body: '<label class="drop" data-drop="1"><input type="file" accept=".vcf,.csv,.tsv,.txt,.json,text/vcard,text/x-vcard,text/csv" data-in="import-file" class="file-in">' +
          '<b>Choose a file</b><span>or drop it here: phone contacts (.vcf), a spreadsheet saved as CSV, or an ISO Desk backup.</span></label>' +
          '<div class="howto"><div><b>iPhone contacts</b><span>Contacts app, Lists, hold All Contacts, then Export.</span></div><div><b>Android contacts</b><span>Contacts app, Fix and manage, then Export to file.</span></div><div><b>SmartMCA or Excel</b><span>Export the ISO list or the deal list, or save the sheet as CSV.</span></div></div>' +
          field('Or paste rows from a spreadsheet, or shop names one per line', '<textarea rows="4" data-in="import-paste" placeholder="Bridgeway Funding Partners&#10;New Horizon Capital">' + esc(m.text || '') + '</textarea>') +
          (m.err ? '<p class="err">' + esc(m.err) + '</p>' : '') +
          '<div class="modal-f"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button><button type="button" class="btn primary" data-act="import-paste-go">Continue</button></div>' };
    }
    var back = '<button type="button" class="btn ghost left" data-act="import-back">Back</button>', src = m.fileName ? esc(m.fileName) : 'What you pasted';
    if (m.err) return { title: 'Import', foot: false, body: '<p class="err">' + esc(m.err) + '</p><div class="modal-f">' + back + '</div>' };
    if (m.fmt === 'list') {
      var c = classifyList(m.text || '');
      return { title: 'Add a list of shops', sub: src, wide: true, spec: 'add-list', left: back, submit: c.add.length || c.claim.length ? 'Add ' + plural(c.add.length + c.claim.length, 'shop') : null, body: addListPreview(m.text || '') };
    }
    if (m.fmt === 'backup') {
      var b = m.backup || {}, n = function (k) { return Array.isArray(b[k]) ? b[k].filter(function (r) { return r && !r.deleted; }).length : 0; };
      return { title: 'Restore a backup', sub: src + (b.exportedAt ? ', saved ' + esc(fmtDay(b.exportedAt)) : ''), left: back, submit: 'Restore',
        body: '<p class="lead">' + esc(plural(n('shops'), 'shop') + ', ' + plural(n('deals'), 'deal') + ' and ' + plural(n('msgs'), 'call and text', 'calls and texts')) + '.</p><ul class="cons"><li>Anything missing here comes back.</li><li>Anything changed since the backup keeps the newer copy.</li><li>Nothing here gets deleted.</li></ul>' };
    }
    var mapping = m.table ? mappingBox(m) : '', checking = m.checking ? '<p class="muted">Checking against every shop on your team...</p>' : '';
    if (m.tkind === 'deals') {
      var byN = shopByNorm(), have = {}, newShops = {}, counts = { open: 0, funded: 0, closed: 0 }, rows = [], taken = 0;
      I.deals.forEach(function (d) { have[A.normName(d.merchant.business) + '|' + d.shopId] = 1; });
      var dupes = 0;
      (m.deals || []).forEach(function (d) {
        var shop = byN[A.normName(d.shop)];
        if (!shop && takenShop(m, d.shop)) { taken++; return; }
        if (shop && have[A.normName(d.merchant) + '|' + shop.id]) { dupes++; return; }
        if (!shop && d.shop) newShops[A.normName(d.shop)] = d.shop;
        counts[d.stage === 'funded' ? 'funded' : d.stage === 'closed' ? 'closed' : 'open']++;
        rows.push(d);
      });
      var nNew = Object.keys(newShops).length;
      var owner = importOwner(m);
      return { title: 'Import deals', sub: src, wide: true, spec: 'import', left: back, submit: rows.length && !m.checking ? 'Import ' + plural(rows.length, 'deal') : null,
        body: '<p class="lead"><b>' + esc(plural(rows.length, 'deal')) + '</b>: ' + counts.open + ' open, ' + counts.funded + ' funded, ' + counts.closed + ' declined or lost.' + (dupes ? ' ' + plural(dupes, 'deal') + ' already here, skipped.' : '') +
          (taken ? ' ' + plural(taken, 'deal') + ' for shops in a teammate\'s book, left alone.' : '') + (nNew ? ' ' + plural(nNew, 'new shop') + ' will be added to ' + (owner === ME ? 'your book' : owner ? pname(owner) + "'s book" : 'nobody\'s book yet') + '.' : '') + '</p>' + checking + (nNew ? assignBox(m) : '') + mapping +
          '<div class="rows list-rows">' + rows.slice(0, 12).map(function (d) { return '<div class="row imp-deal"><div class="main"><b>' + esc(d.merchant) + '</b><div class="sub">' + esc(d.shop || 'No shop') + '</div></div><div><span class="pill' + (d.stage === 'funded' ? ' good' : d.stage === 'closed' ? '' : ' accent') + '">' + esc(d.stage === 'closed' ? (/declin|reject|turn/i.test(d.stageText || '') ? 'Declined' : 'Lost') : STAGE_LABEL[d.stage]) + '</span></div><div class="muted">' + esc(d.date ? fmtDay(d.date) : '') + '</div><div class="right money-sm">' + (d.amount ? money(d.amount) : '') + '</div></div>'; }).join('') + '</div>' +
          (rows.length > 12 ? '<p class="muted">And ' + (rows.length - 12) + ' more.</p>' : '') + '<p class="muted">Paperwork on imported deals is marked as received. Untick anything still missing.</p>' };
    }
    var plan = planImport(m), comps = m.groups.companies, people = 0, shops = 0, fresh = 0, owner = importOwner(m);
    plan.rows.forEach(function (x) { if (!m.sel[x.g.key] || x.state === 'taken') return; var n = x.g.people.length + (plan.joins[x.g.key] || []).length; if (x.state === 'new') { shops++; people += n; } else { fresh++; people += x.fresh + (plan.joins[x.g.key] || []).length; } });
    if (m.looseMatch) people += plan.toShop.length;
    if (m.loose === 'own') { shops += plan.rest.length; people += plan.rest.length; }
    var limit = m.showAll ? comps.length : 40;
    var whoName = function (r) { return r.owner ? (r.yours ? 'your book' : r.owner + "'s book") : 'nobody\'s book'; };
    var list = plan.rows.slice(0, limit).map(function (x) {
      var g = x.g, joins = plan.joins[g.key] || [], on = m.sel[g.key] && x.state !== 'taken', tag;
      if (x.state === 'taken') tag = '<span class="tag warn">Already in ' + esc(whoName(x.mt.taken)) + ', left alone</span>';
      else if (x.state === 'add') tag = '<span class="tag">Already here' + (x.mt.how !== 'name' ? ' as ' + esc(x.mt.shop.name) : '') + (x.mt.shop.repId !== ME ? ' in ' + esc(x.mt.shop.repId ? pname(x.mt.shop.repId) + "'s book" : "nobody's book") : '') + (x.fresh || joins.length ? ', adds ' + plural(x.fresh + joins.length, 'person', 'people') : ', nothing new') + '</span>';
      else tag = '<span class="tag good">New shop</span>';
      var why = x.mt && x.mt.how !== 'name' ? '<span class="muted">Matched by ' + esc(howText(x.mt.how, x.mt.shop ? x.mt.shop.name : x.mt.taken.name)) + '.</span>' : '';
      var names = g.people.concat(joins).slice(0, 3).map(function (p) { return p.name || (p.phones[0] || {}).number || ''; }).join(', ') + (g.people.length + joins.length > 3 ? ' and ' + (g.people.length + joins.length - 3) + ' more' : '');
      return '<label class="imp-row' + (on ? ' on' : '') + (x.state === 'taken' ? ' off' : '') + '"><input type="checkbox" data-in="imp-sel" value="' + esc(g.key) + '"' + (on ? ' checked' : '') + (x.state === 'taken' ? ' disabled' : '') + '><span class="imp-main"><b>' + esc(g.name) + '</b><span class="muted">' + esc(names) + '</span>' + why + '</span>' + tag + '</label>';
    }).join('');
    var matched = plan.toShop.length ? '<div class="form-sec">' + esc(plural(plan.toShop.length, 'person', 'people')) + ' with no company matched to a shop</div><label class="checkline"><input type="checkbox" data-in="imp-loose-match"' + (m.looseMatch ? ' checked' : '') + '> Add them to those shops</label>' +
      '<div class="imp-list">' + plan.toShop.slice(0, m.showAll ? 999 : 12).map(function (y) { return '<div class="imp-row plain' + (m.looseMatch ? ' on' : '') + '"><span class="imp-main"><b>' + esc(y.p.name || (y.p.phones[0] || {}).number || 'Unnamed') + '</b><span class="muted">' + esc(y.shop.name) + ', matched by ' + (y.how === 'phone' ? 'phone number' : 'email domain') + '</span></span></div>'; }).join('') + '</div>' : '';
    var rest = plan.rest.length ? '<div class="form-sec">' + esc(plural(plan.rest.length, 'person', 'people')) + ' with no company and no match</div><div class="seg wide-seg"><button type="button" class="' + (m.loose === 'skip' ? 'on' : '') + '" data-act="imp-loose" data-v="skip">Skip them</button><button type="button" class="' + (m.loose === 'own' ? 'on' : '') + '" data-act="imp-loose" data-v="own">Add each as their own shop</button></div>' : '';
    var nTaken = plan.rows.filter(function (x) { return x.state === 'taken'; }).length;
    var submit = m.checking ? null : shops || fresh || (m.looseMatch && plan.toShop.length) ? 'Import ' + (shops ? plural(shops, 'new shop') + ' and ' : '') + plural(people, 'person', 'people') : null;
    return { title: 'Import contacts', sub: src, wide: true, spec: 'import', left: back, submit: submit,
      body: '<p class="lead">Found <b>' + esc(plural(comps.length, 'company', 'companies')) + '</b>' + (m.groups.loose.length ? ' and ' + esc(plural(m.groups.loose.length, 'person', 'people')) + ' with no company' : '') + '. Each company becomes a shop with its people, or adds to the shop already here. Untick anything personal.' + (plan.already ? ' ' + esc(plural(plan.already, 'person', 'people')) + ' with no company ' + (plan.already === 1 ? 'is' : 'are') + ' already on a shop here, skipped.' : '') +
        (nTaken ? ' ' + esc(plural(nTaken, 'company', 'companies')) + ' already in a teammate\'s book ' + (nTaken === 1 ? 'is' : 'are') + ' left alone.' : '') + (shops ? ' New shops go to ' + esc(owner === ME ? 'your book' : owner ? pname(owner) + "'s book" : 'nobody yet') + '.' : '') + '</p>' + checking + (shops ? assignBox(m) : '') + mapping +
        (comps.length ? '<div class="imp-tools"><button type="button" class="link" data-act="imp-all" data-v="1">Tick all</button><button type="button" class="link" data-act="imp-all" data-v="0">Untick all</button></div><div class="imp-list">' + list + '</div>' + (comps.length > limit ? '<button type="button" class="link" data-act="imp-show-all">Show the other ' + (comps.length - limit) + '</button>' : '') : '') +
        matched + rest };
  }
  // A shop name from a deals sheet that is already in someone else's book.
  function takenShop(m, name) { var r = m.remote && m.remote.names[A.normName(name)]; return r && !(r.id && DB.shops[r.id]) ? r : null; }
  function mappingBox(m) {
    var opts = [['-1', 'Not used']].concat(m.table.headers.map(function (h, i) { return [String(i), h]; }));
    var used = MAP_FIELDS[m.tkind || 'contacts'].filter(function (f) { return m.map[f] >= 0; });
    return '<details class="mapping"><summary>' + (used.length ? plural(used.length, 'column') + ' matched: ' + esc(used.map(function (f) { return FIELD_LABEL[f].toLowerCase(); }).join(', ')) + '. Check or change' : 'No columns matched. Pick them here') + '</summary><div class="grid3 tight">' +
      MAP_FIELDS[m.tkind || 'contacts'].map(function (f) { return field(FIELD_LABEL[f], select('map_' + f, opts, String(m.map[f]), ' data-in="imp-map" data-v="' + f + '"')); }).join('') + '</div></details>';
  }
  function runImport(m) {
    var now = nowISO(), src = m.fileName || 'a paste', created = { shops: [], deals: [] }, before = [], byNorm = shopByNorm(), owner = importOwner(m);
    var newShop = function (name, people, state) {
      var s = { id: uid('s'), name: name, state: state || '', repId: owner || null, assignedAt: owner ? now : null, history: [], paused: null, agreementAt: null, createdAt: now, importedAt: now, about: '', contacts: people || [], followUps: [], activity: [] };
      log(s, 'system', 'Imported from ' + src + '.'); put('shops', s); created.shops.push(s.id); byNorm[A.normName(name)] = s; return s;
    };
    if (m.tkind === 'deals') {
      var have = {}, n = 0;
      I.deals.forEach(function (d) { have[A.normName(d.merchant.business) + '|' + d.shopId] = 1; });
      (m.deals || []).forEach(function (r) {
        if (!byNorm[A.normName(r.shop)] && takenShop(m, r.shop)) return;
        var shop = byNorm[A.normName(r.shop)] || newShop(r.shop || 'Unknown shop', [], r.state);
        var key = A.normName(r.merchant) + '|' + shop.id; if (have[key]) return; have[key] = 1;
        var at = r.date || now, paper = { app: at };
        A.statementMonths(at).forEach(function (mk) { paper[mk] = at; });
        var d = { id: uid('d'), merchant: { business: r.merchant, owner: r.owner || '', industry: matchIndustry(r.industry), state: r.state || '', monthlyRevenue: r.revenue || 0, tibMonths: 0, fico: r.fico || 0, positions: 0, phone: r.phone ? fmtPhone(r.phone) : '', email: r.email || '' },
          requested: r.amount || 0, shopId: shop.id, contactId: null, repOverride: null, stage: r.stage, stageAt: at, submittedAt: at, renewalOf: null, paperwork: paper, closing: r.stage === 'funded' ? closedOut(at) : {}, offers: [], acceptedOfferId: null, importedAt: now,
          funded: r.stage === 'funded' ? { amount: r.amount || 0, buyRate: 0, termMonths: 0, freq: 'daily', fee: 0, points: 0, fundedAt: at, status: 'performing', stoppedAt: null, repId: shop.repId || null, noTerms: true } : null,
          closed: r.stage === 'closed' ? { kind: /declin|reject|turn/i.test(r.stageText || '') ? 'declined' : 'lost', reason: r.stageText || 'Imported', note: '', at: at, fromStage: 'submitted' } : null, followUps: [], activity: [] };
        log(d, 'system', 'Imported from ' + src + (r.stageText ? ', where it was "' + r.stageText + '"' : '') + '.');
        put('deals', d); created.deals.push(d.id); n++;
      });
      return { msg: plural(n, 'deal') + ' imported' + (created.shops.length ? ', ' + plural(created.shops.length, 'new shop') : ''), created: created, before: before };
    }
    var plan = planImport(m), people = 0, saved = {};
    var addTo = function (ex, contacts) {
      var add = contacts.filter(function (c) { return !ex.contacts.some(function (x) { return sameContact(x, c); }); });
      if (!add.length) return;
      if (!saved[ex.id]) { saved[ex.id] = 1; before.push(clone(ex)); }
      ex.contacts = ex.contacts.concat(add); people += add.length;
      log(ex, 'system', plural(add.length, 'person', 'people') + ' added from ' + src + '.'); put('shops', ex);
    };
    var groups = plan.rows.filter(function (x) { return m.sel[x.g.key] && x.state !== 'taken'; }).map(function (x) { return { name: x.g.name, people: x.g.people.concat(plan.joins[x.g.key] || []), ex: x.state === 'add' ? x.mt.shop : null }; });
    if (m.loose === 'own') groups = groups.concat(plan.rest.map(function (p) { return { name: p.name || (p.phones[0] || {}).number || 'Unnamed', people: [p], ex: byNorm[A.normName(p.name || '')] || null }; }));
    if (m.looseMatch) plan.toShop.forEach(function (y) { addTo(y.shop, [toContact(y.p)]); });
    groups.forEach(function (g) {
      var contacts = [];
      g.people.map(toContact).forEach(function (c) { if (!contacts.some(function (x) { return sameContact(x, c); })) contacts.push(c); });
      var states = g.people.map(function (p) { return p.state; }).filter(Boolean), ex = g.ex || byNorm[A.normName(g.name)];
      if (ex) addTo(ex, contacts);
      else {
        var s = newShop(g.name, contacts, states[0]); people += contacts.length;
        var notes = g.people.map(function (p) { return p.note; }).filter(Boolean).join('\n').slice(0, 1500);
        if (notes) s.about = notes;
      }
    });
    return { msg: plural(created.shops.length, 'shop') + ' added' + (before.length ? ', ' + plural(before.length, 'shop') + ' updated' : '') + ', ' + plural(people, 'person', 'people') + ' in all', created: created, before: before };
  }
  function restoreBackup(b) {
    var n = 0;
    KINDS.forEach(function (kind) {
      (Array.isArray(b[kind]) ? b[kind] : []).forEach(function (raw) {
        var r = cleanRec(kind, clone(raw)); if (!r || r.deleted) return;
        var cur = DB[kind][r.id];
        if (cur && (cur.updatedAt || 0) >= (r.updatedAt || 0)) return;
        DB[kind][r.id] = r; pending[kind][r.id] = r; n++;
      });
    });
    queueSave();
    return n;
  }
  function stamp() { return A.dateOnly(new Date()); }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function toCSV(rows) { return '﻿' + rows.map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n'); }
  function exportShops() {
    var rows = [['Shop', 'State', 'Status', 'Person', 'Role', 'Phone', 'Second phone', 'Email', 'ISO agreement signed', 'Last deal', 'Deals in 30 days', 'Funded in 90 days', 'Next follow-up', 'About']];
    I.shops.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (s) {
      var inf = shopInfo(s), fu = openFUs(s)[0], base = [s.name, s.state, inf.status];
      var tail = [s.agreementAt ? A.dateOnly(s.agreementAt) : '', inf.last ? A.dateOnly(inf.last) : '', inf.sub30, inf.f90, fu ? fu.due + ' ' + (fu.time || '') + ' ' + (fu.note || '') : '', s.about || ''];
      if (!s.contacts.length) rows.push(base.concat(['', '', '', '', '']).concat(tail));
      s.contacts.forEach(function (c) { rows.push(base.concat([c.name, c.role, c.phone, c.phone2 || '', c.email]).concat(tail)); });
    });
    download('iso-desk-shops-' + stamp() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
  }
  function exportDeals() {
    var rows = [['Merchant', 'Owner', 'Shop', 'Stage', 'Requested', 'Funded amount', 'Submitted', 'Funded on', 'Industry', 'State', 'Monthly revenue', 'Credit score', 'Open positions', 'Best offer', 'Declined or lost reason']];
    I.deals.slice().sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }).forEach(function (d) {
      var b = bestOffer(d), m = d.merchant;
      rows.push([m.business, m.owner, (shopOf(d) || {}).name || '', STAGE_LABEL[d.stage], d.requested, d.funded ? d.funded.amount : '', A.dateOnly(d.submittedAt), d.funded ? A.dateOnly(d.funded.fundedAt) : '', m.industry, m.state, m.monthlyRevenue || '', m.fico || '', m.positions, b ? b.amount : '', d.closed ? d.closed.reason : '']);
    });
    download('iso-desk-deals-' + stamp() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
  }
  function exportBackup() {
    download('iso-desk-backup-' + stamp() + '.json', JSON.stringify({ isodesk: 1, exportedAt: nowISO(), workspace: SESSION ? SESSION.ws.name : 'demo', shops: vals(DB.shops), deals: vals(DB.deals), msgs: vals(DB.msgs), meta: vals(DB.meta) }), 'application/json');
  }
  function readImportFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { modal.err = 'That file is over 15 MB. Split it or export fewer columns.'; renderModal(); return; }
    var r = new FileReader();
    r.onload = function () { Object.assign(modal, { step: 'preview', text: String(r.result || ''), fileName: file.name, table: null, map: null, tkind: null, sel: null, loose: null, showAll: false }); importParse(modal); renderModal(); };
    r.onerror = function () { modal.err = 'That file could not be read.'; renderModal(); };
    r.readAsText(file);
  }

  // ================= PHONE ALERTS (web push) =================
  var swReg = null;
  function isIOS() { var ua = navigator.userAgent || ''; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); }
  function standalone() { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function deviceWord() { return /Mobi|iPhone|Android/.test(navigator.userAgent || '') ? 'phone' : 'computer'; }
  function keyBytes(b64) { var x = b64.replace(/-/g, '+').replace(/_/g, '/'); x += '==='.slice((x.length + 3) % 4); var bin = atob(x), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function api(url, body) {
    return fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, credentials: 'same-origin', cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j || {} }; }); });
  }
  function registerSW() {
    if (!LIVE || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
      swReg = reg;
      return reg.pushManager ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) {
      var on = !!sub && 'Notification' in window && Notification.permission === 'granted';
      if (on !== !!UI.push) { UI.push = on; renderMain(); }
      if (sub) api('/api/push', { action: 'subscribe', sub: sub.toJSON() });
    }).catch(function () { /* no service worker here: alerts stay inside the page */ });
  }
  function pushOn() {
    if (isIOS() && !standalone()) { closePop(); openModal({ kind: 'phone' }); return; }
    if (!pushSupported() || !SESSION || !SESSION.vapidKey) { toast('This browser cannot show alerts. Try Chrome, Edge or Safari.', { bad: true }); return; }
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error('blocked');
      return swReg || navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; });
    }).then(function (reg) {
      swReg = reg;
      return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(SESSION.vapidKey) }); });
    }).then(function (sub) { return api('/api/push', { action: 'subscribe', sub: sub.toJSON() }); })
      .then(function (res) { if (!res.j.ok) throw new Error('save'); UI.push = true; render(); return api('/api/push', { action: 'test' }); })
      .then(function () { toast('Alerts are on. A test alert is on its way.'); })
      .catch(function (e) { toast(e && e.message === 'blocked' ? 'Alerts are blocked for this site. Allow notifications for ISO Desk in the browser settings, then try again.' : 'Could not turn alerts on. Try again in a moment.', { bad: true }); });
  }
  function pushOff() {
    var done = function () { UI.push = false; render(); toast('Alerts are off on this ' + deviceWord()); };
    if (!swReg || !swReg.pushManager) { done(); return; }
    swReg.pushManager.getSubscription().then(function (sub) {
      if (!sub) return null;
      return api('/api/push', { action: 'unsubscribe', endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); });
    }).then(done, done);
  }

  // ================= SIGN IN (private desk) =================
  var AUTH = null;
  function b64urlBytes(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  // The password is stretched here, on the device, salted with the email. The server only ever sees the result.
  function deriveKey(email, pw) {
    var te = new TextEncoder();
    return crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('isodesk:v1:' + email.trim().toLowerCase()), iterations: 200000 }, k, 256); })
      .then(b64urlBytes);
  }
  function showAuth(a) {
    AUTH = a; SESSION = null; drawer = null; modal = null; sheet = null; call = null; alerts = []; closePop();
    document.body.classList.add('signed-out');
    ['drawer-root', 'modal-root', 'call-root', 'sheet-root', 'alert-root'].forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    window.__ISO_READY = true;
    renderAuth();
    if (a.kind === 'invite' && !a.email) api('/api/auth/accept', { token: a.token, peek: true }).then(function (res) {
      if (!res.j.ok) { AUTH.dead = res.j.error || 'This link does not work.'; } else { AUTH.email = res.j.email; AUTH.name = res.j.name; }
      renderAuth();
    }).catch(function () { AUTH.dead = 'Could not reach ISO Desk. Check the connection and open the link again.'; renderAuth(); });
  }
  function renderAuth() {
    var a = AUTH; if (!a) return;
    var brand = '<div class="brand auth-brand"><svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#2a43c4"/><path d="M7 7.5h10M7 12h10M7 16.5h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg><span>ISO Desk</span></div>';
    var err = a.err ? '<p class="err">' + esc(a.err) + '</p>' : '', busy = a.busy ? ' disabled' : '', body;
    if (a.kind === 'invite') {
      if (a.dead) body = '<h1>This link did not work</h1><p>' + esc(a.dead) + '</p><p><a class="btn" href="/">Go to sign in</a></p>';
      else if (!a.email) body = '<p class="muted">Checking your link...</p>';
      else body = '<h1>Welcome' + (a.name ? ', ' + esc(first(a.name)) : '') + '</h1><p>Pick a password for <b>' + esc(a.email) + '</b>. You will use it to sign in on your phone and your computer.</p>' +
        '<form data-form="auth-invite" class="auth-form" novalidate>' + field('Password, 8 or more characters', '<input name="pw" type="password" autocomplete="new-password" autofocus>') + field('Type it again', '<input name="pw2" type="password" autocomplete="new-password">') + err +
        '<button class="btn primary big" type="submit"' + busy + '>' + (a.busy ? 'Setting it up...' : 'Set password and open ISO Desk') + '</button></form>';
    } else {
      body = '<h1>Sign in</h1><form data-form="auth-login" class="auth-form" novalidate>' + field('Email', '<input name="email" type="email" autocomplete="username" value="' + esc(a.email || '') + '"' + (a.email ? '' : ' autofocus') + '>') +
        field('Password', '<input name="pw" type="password" autocomplete="current-password"' + (a.email ? ' autofocus' : '') + '>') + err +
        '<button class="btn primary big" type="submit"' + busy + '>' + (a.busy ? 'Signing in...' : 'Sign in') + '</button></form>' +
        '<p class="auth-help">Forgot your password? Text Yonatan for a new link.</p><p class="auth-help"><a href="/demo/">Just looking? Open the demo</a></p>';
    }
    document.getElementById('main').innerHTML = '<div class="auth"><div class="auth-card">' + brand + body + '</div></div>';
    var f = document.querySelector('.auth [autofocus]'); if (f) f.focus();
  }
  function signedOut() { if (AUTH) return; saveCache(); showAuth({ kind: 'login', email: SESSION ? SESSION.user.email : '', err: 'You were signed out. Sign in again and nothing you changed is lost.' }); }
  function openFromHash() {
    var mm = /#open=(shop|deal):([A-Za-z0-9_-]{1,80})/.exec(location.hash || '');
    if (!mm || !SESSION) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* old browser */ }
    if (recOf(mm[1], mm[2])) { drawer = null; openRecord(mm[1], mm[2]); } else toast('That one is not on this device yet. Try again in a moment.');
  }

  // ================= ACTIONS =================
  function curRec() { return drawer ? recOf(drawer.type, drawer.id) : null; }
  function target(el) { var type = el.getAttribute('data-type') || (drawer && drawer.type), id = el.getAttribute('data-id') || (drawer && drawer.id); return { type: type, id: id }; }
  function withUndo(kind, ids, fn, msg, extra) {
    var before = ids.map(function (id) { return DB[kind][id] ? clone(DB[kind][id]) : { id: id, __gone: true }; });
    fn(); render();
    toast(msg, Object.assign({ undo: function () { before.forEach(function (b) { if (b.__gone) { if (DB[kind][b.id]) remove(kind, b.id); } else put(kind, b); }); render(); } }, extra || {}));
  }
  function gateFor(d, to) {
    var i = A.STAGE_INDEX[to], cur = A.STAGE_INDEX[d.stage];
    if (d.stage !== 'closed' && i <= cur) return { ok: true };
    var miss = fileMissing(d);
    if (i >= 1 && cur <= 1 && miss.length) return { ok: false, why: 'Underwriting needs the ' + words(miss.map(function (x) { return x.short; })) + ' first.', fix: { label: 'Show me', fn: function () { openRecord('deal', d.id, 'paperwork', 'Tick each document when the shop sends it.'); } } };
    if (i >= 2 && !d.offers.length) return { ok: false, why: 'Record what underwriting approved first.', fix: { label: 'Record it', fn: function () { openOfferModal(d); } }, auto: true };
    if (i >= 3 && !d.acceptedOfferId) return { ok: false, why: 'Mark which offer the merchant picked first.', fix: { label: 'Show me', fn: function () { openRecord('deal', d.id, 'offers', 'Press "Merchant picked this" on the offer they took.'); } }, auto: true };
    if (i >= 4) { var cm = closingMissing(d); if (cm.length) return { ok: false, why: 'It cannot fund yet. Still missing: ' + words(cm.map(function (c) { return c.label.toLowerCase(); })) + '.', fix: { label: 'Show me', fn: function () { openRecord('deal', d.id, 'paperwork', 'Tick each item as it comes in.'); } } }; }
    return { ok: true };
  }
  function moveDeal(d, to) {
    if (!d || to === d.stage) return;
    if (to === 'closed') { openCloseModal(d, d.stage === 'approved' || d.stage === 'contracts' ? 'lost' : 'declined'); return; }
    var g = gateFor(d, to);
    if (!g.ok) { if (g.auto) g.fix.fn(); toast(g.why, { bad: true, action: g.auto ? null : g.fix }); return; }
    var back = d.stage !== 'closed' && A.STAGE_INDEX[to] < A.STAGE_INDEX[d.stage];
    withUndo('deals', [d.id], function () {
      var x = DB.deals[d.id];
      if (x.stage === 'closed') { log(x, 'system', 'Reopened.'); x.closed = null; }
      if (x.stage === 'funded' && to !== 'funded') x.funded = null;
      x.stage = to; x.stageAt = nowISO();
      if (to === 'contracts' && !x.closing.sent) x.closing.sent = x.stageAt;
      if (to === 'funded') { var o = acceptedOffer(x); x.funded = { amount: o.amount, buyRate: o.buyRate, termMonths: o.termMonths, freq: o.freq, fee: o.fee, points: o.points, fundedAt: x.stageAt, status: 'performing', stoppedAt: null, repId: ownerOf(x) }; }
      log(x, 'system', back ? 'Moved back to ' + STAGE_LABEL[to].toLowerCase() + '.' : to === 'funded' ? 'Funded ' + money(x.funded.amount) + '.' : 'Moved to ' + STAGE_LABEL[to].toLowerCase() + '.');
      put('deals', x);
    }, to === 'funded' ? 'Funded' : 'Moved to ' + STAGE_LABEL[to]);
  }
  function openCloseModal(d, kind) { openModal({ kind: 'close', dealId: d.id, kindSel: kind, reason: null, note: '' }); }
  function openOfferModal(d, offerId) {
    var o = offerId ? d.offers.filter(function (x) { return x.id === offerId; })[0] : null, last = d.offers[d.offers.length - 1];
    openModal({ kind: 'offer', dealId: d.id, offerId: offerId || null, o: o ? Object.assign({}, o) : last ? Object.assign({}, last) : A.suggestOffer(d) });
  }
  function startRenewal(d) {
    var s = shopOf(d), id = uid('d');
    var x = { id: id, merchant: clone(d.merchant), requested: Math.round(d.funded.amount * 1.1 / 5000) * 5000, shopId: d.shopId, contactId: d.contactId, repOverride: null,
      stage: 'submitted', stageAt: nowISO(), submittedAt: nowISO(), renewalOf: d.id, paperwork: {}, closing: {}, offers: [], acceptedOfferId: null, funded: null, closed: null, followUps: [], activity: [] };
    log(x, 'system', 'Renewal of the ' + money(d.funded.amount) + ' funded ' + fmtDay(d.funded.fundedAt) + '. ' + (s ? s.name : 'The shop') + ' needs to send a fresh application and statements.');
    put('deals', x); log(d, 'system', 'Renewal started.'); put('deals', d);
    render();
    toast('Renewal started. Ask ' + (s ? s.name : 'the shop') + ' for fresh statements.', { action: { label: 'Open it', fn: function () { openRecord('deal', id, 'paperwork'); } }, undo: function () { remove('deals', id); render(); } });
  }
  // Marks one follow-up done on its record. A repeating one gets its next date. Returns that next one.
  function closeFU(x, f) {
    var next = null;
    f.doneAt = nowISO();
    log(x, 'system', 'Follow-up done' + (f.note ? ': ' + f.note : '') + '.');
    if (f.repeat) {
      var step = function (s) { return f.repeat === 'monthly' ? addMonth(s) : addDays(s, f.repeat === 'biweekly' ? 14 : 7); };
      var due = step(f.due); while (dueAt({ due: due, time: f.time }) <= new Date()) due = step(due);
      next = { id: uid('f'), due: due, time: f.time, note: f.note, repeat: f.repeat, doneAt: null, by: ME, createdAt: nowISO() };
      x.followUps.push(next);
    }
    alerts = alerts.filter(function (a) { return a.fid !== f.id; });
    return next;
  }
  function completeFU(type, id, fid) {
    var kind = kindOf(type), x = DB[kind][id], before = clone(x), f = (x.followUps || []).filter(function (y) { return y.id === fid; })[0];
    if (!f) return;
    var next = closeFU(x, f);
    render();
    toast(next ? 'Done. The next one is ' + lc(fuLabel(next)) : 'Follow-up done', { undo: function () { put(kind, before); render(); } });
  }
  function moveFU(type, id, fid, due, time) {
    var kind = kindOf(type);
    alerts = alerts.filter(function (a) { return a.fid !== fid; });
    withUndo(kind, [id], function () { var x = DB[kind][id], f = (x.followUps || []).filter(function (y) { return y.id === fid; })[0]; if (!f) return; f.due = due; f.time = time; log(x, 'system', 'Follow-up moved to ' + lc(fuLabel(f)) + '.'); put(kind, x); }, 'Moved to ' + lc(fuLabel({ due: due, time: time })));
  }
  function textFromTemplate(phone, ctx, tplId) {
    openSheet(phone, ctx);
    var t = (S().templates || []).filter(function (x) { return x.id === tplId; })[0] || A.defaultSettings().templates.filter(function (x) { return x.id === tplId; })[0];
    if (t) { var key = digits(phone); UI.drafts['sms:' + key] = fillTemplate(t.text, convFor(key)); renderSheet(); var ta = document.querySelector('.sheet textarea'); if (ta) ta.focus(); }
  }

  var ACT = {
    'nav': function (el) { UI.view = el.getAttribute('data-v'); saveUI(); drawer = null; closePop(); ensureConv(); render(); window.scrollTo(0, 0); },
    'how': function () { closePop(); openModal({ kind: 'how' }); },
    'tour': function () { closePop(); window.open('/tour/', '_blank', 'noopener'); },
    'me-menu': function (el) { openPop({ kind: 'me', alignRight: true }, el); },
    'settings-open': function () { closePop(); var st = clone(S()); st.auto = clone(autoSet()); openModal({ kind: 'settings', st: st }); },
    'open': function (el, e) { if (e && e.target.closest('button, a, input, select, textarea, label') && e.target.closest('[data-act]') !== el) return; openRecord(el.getAttribute('data-type'), el.getAttribute('data-id'), el.getAttribute('data-tab')); },
    'open-from-list': function (el) { closeModal(); drawer = null; openRecord(el.getAttribute('data-type'), el.getAttribute('data-id')); },
    'search-open': function (el) { var q = document.getElementById('q'); if (q) { q.value = ''; q.blur(); } closePop(); drawer = null; openRecord(el.getAttribute('data-type'), el.getAttribute('data-id'), el.getAttribute('data-tab')); },
    'close-drawer': function () { drawer = null; render(); },
    'drawer-back': function () { var b = drawer.back.pop(); drawer = { type: b.type, id: b.id, tab: b.tab, back: drawer.back }; render(); },
    'tab': function (el) { drawer.tab = el.getAttribute('data-v'); drawer.hint = null; UI.editContact = null; renderDrawer(); },
    'ms': function (el) { var key = el.getAttribute('data-key'); openPop({ kind: 'ms', key: key, options: key === 'shops' ? shopOptions() : key === 'quality' ? QUALITY.map(function (x) { return { v: x[0], l: x[1] }; }) : STATUSES.map(function (x) { return { v: x, l: x }; }), any: key === 'shops' ? 'Any shop' : key === 'quality' ? 'Any approval rate' : 'Any status', q: '' }, el); },
    'status-all': function () { UI.f.status = []; renderMain(); },
    'status-toggle': function (el) { var v = el.getAttribute('data-v'), i = UI.f.status.indexOf(v); if (i >= 0) UI.f.status.splice(i, 1); else UI.f.status.push(v); renderMain(); },
    'since': function (el) { openPop({ kind: 'single', key: 'since', options: SINCE, value: UI.f.since }, el); },
    'single-pick': function (el) { UI.f[pop.key] = el.getAttribute('data-v'); if (pop.key === 'book') UI.f.shops = []; closePop(); renderMain(); },
    'clear-filters': function () { UI.f = { shops: [], since: 'any', status: [], quality: [], q: '', book: UI.f.book || '' }; renderMain(); },
    'book': function (el) { openPop({ kind: 'single', key: 'book', options: bookOptions(), value: bookOf() }, el); },
    'sort': function (el) { UI.sort = el.getAttribute('data-v'); saveUI(); renderMain(); },
    'more': function (el) { UI.more = el.getAttribute('data-v'); renderMain(); },
    'toggle-upcoming': function () { UI.showUpcoming = !UI.showUpcoming; renderMain(); },
    'all-act': function () { UI.allAct = drawer.id; renderDrawer(); },
    'all-deals': function () { UI.allDeals = drawer.id; renderDrawer(); },
    'month-list': function (el) { var mn = monthNumbers(), v = el.getAttribute('data-v'), month = A.TODAY.toLocaleDateString('en-US', { month: 'long' }); openModal({ kind: 'list', title: v === 'fund' ? 'Funded in ' + month : v === 'appr' ? 'Approved in ' + month : 'Submitted in ' + month, rows: (v === 'fund' ? mn.fund : v === 'appr' ? mn.appr : mn.sub).slice().sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; }) }); },
    'desktop-toggle': function () {
      if (!('Notification' in window)) return;
      if (UI.desktop && Notification.permission === 'granted') { UI.desktop = false; saveUI(); renderMain(); toast('Desktop alerts off'); return; }
      Notification.requestPermission().then(function (p) { UI.desktop = p === 'granted'; saveUI(); renderMain(); toast(p === 'granted' ? 'Desktop alerts on. You get one when a follow-up comes due.' : 'The browser blocked desktop alerts. Alerts still pop up inside the desk.', { bad: p !== 'granted' }); });
    },
    // follow-ups
    'fu-new': function (el) { openFUPop(el, drawer ? { type: drawer.type, id: drawer.id } : null, null, true); },
    'fu-new-for': function (el) { openFUPop(el, target(el)); },
    'fu-edit': function (el) { openFUPop(el, target(el), el.getAttribute('data-fid')); },
    'fu-target': function (el) { pop.target = { type: el.getAttribute('data-type'), id: el.getAttribute('data-id') }; renderPop(); },
    'fu-retarget': function () { readFUPop(); pop.target = null; renderPop(); },
    'fu-quick': function (el) { readFUPop(); pop.due = el.getAttribute('data-due'); pop.time = el.getAttribute('data-time'); renderPop(); },
    'fu-save': function () {
      readFUPop();
      var p = pop; if (!p || !p.target) return;
      if (!p.due) { toast('Pick a day', { bad: true }); return; }
      var kind = kindOf(p.target.type), id = p.target.id, f = { due: p.due, time: p.time || '09:00', note: (p.note || '').trim(), repeat: p.repeat || '' };
      closePop();
      withUndo(kind, [id], function () {
        var x = DB[kind][id]; x.followUps = x.followUps || [];
        var cur = p.fid ? x.followUps.filter(function (y) { return y.id === p.fid; })[0] : null;
        if (cur) Object.assign(cur, f); else x.followUps.push(Object.assign({ id: uid('f'), doneAt: null, by: ME, createdAt: nowISO() }, f));
        log(x, 'system', (cur ? 'Follow-up changed to ' : 'Follow-up set for ') + lc(fuLabel(f)) + (f.note ? ': ' + f.note : '') + '.');
        put(kind, x);
      }, 'Follow-up ' + (p.fid ? 'changed' : 'set') + ' for ' + lc(fuLabel(f)));
    },
    'fu-delete': function () { var p = pop, kind = kindOf(p.target.type); closePop(); withUndo(kind, [p.target.id], function () { var x = DB[kind][p.target.id]; x.followUps = (x.followUps || []).filter(function (y) { return y.id !== p.fid; }); log(x, 'system', 'Follow-up deleted.'); put(kind, x); }, 'Follow-up deleted'); },
    'fu-done': function (el) { completeFU(el.getAttribute('data-type'), el.getAttribute('data-id'), el.getAttribute('data-fid')); },
    'fu-later': function (el) { openPop({ kind: 'later', type: el.getAttribute('data-type'), id: el.getAttribute('data-id'), fid: el.getAttribute('data-fid'), alignRight: true }, el); },
    'later-pick': function (el) { var p = pop; closePop(); moveFU(p.type, p.id, p.fid, el.getAttribute('data-due'), el.getAttribute('data-time')); },
    'later-custom': function () { var p = pop, r = p.rect; closePop(); openFUPop({ getBoundingClientRect: function () { return r; } }, { type: p.type, id: p.id }, p.fid); },
    // automatic follow-ups
    'touch-edit': function (el) { UI.editTouch = el.getAttribute('data-k'); renderMain(); var t = document.querySelector('[data-in="touch"][data-k="' + UI.editTouch + '"]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } },
    'touch-send': function (el) {
      var r = sendTouch(el.getAttribute('data-k'), 'copy'); if (!r) return;
      render(); toast(r.msg, { undo: r.undo });
    },
    'touch-later': function (el) { openPop({ kind: 'tlater', k: el.getAttribute('data-k'), alignRight: true }, el); },
    'touch-skip': function (el) { openPop({ kind: 'tskip', k: el.getAttribute('data-k'), alignRight: true }, el); },
    'tlater-pick': function (el) {
      var t = findTouch(pop.k), due = el.getAttribute('data-due'), time = el.getAttribute('data-time'); closePop(); if (!t) return;
      var undo = laterTouch(t, due, time); render(); toast('Back on ' + lc(fuLabel({ due: due, time: time })), { undo: undo });
    },
    'tskip-pick': function (el) {
      var t = findTouch(pop.k), why = el.getAttribute('data-v'); closePop(); if (!t) return;
      var undo = skipTouch(t, why); render(); toast(why === 'off' ? 'Skipped. No more automatic follow-ups for ' + t.s.name + '.' : 'Skipped', { undo: undo });
    },
    'review-open': function () { var ids = touches().all.filter(function (t) { return !t.call; }).map(function (t) { return t.id; }); if (!ids.length) { toast('Nothing to send right now'); return; } openModal({ kind: 'review', ids: ids, i: 0, sent: 0, later: 0, skipped: 0, choose: null }); },
    'review-one': function (el) { var t = findTouch(el.getAttribute('data-k')); if (!t) { render(); return; } closePop(); openModal({ kind: 'review', ids: [t.id], i: 0, sent: 0, later: 0, skipped: 0, choose: null }); },
    'rv-choose': function (el) { var v = el.getAttribute('data-v'); modal.choose = modal.choose === v ? null : v; renderModal(); },
    'rv-later': function (el) { var t = findTouch(modal.ids[modal.i]); if (!t) return; laterTouch(t, el.getAttribute('data-due'), el.getAttribute('data-time')); modal.later++; reviewNext(); },
    'rv-skip': function (el) { var t = findTouch(modal.ids[modal.i]); if (!t) return; skipTouch(t, el.getAttribute('data-v')); modal.skipped++; reviewNext(); },
    'rv-sms': function () { SUBMIT.review(null, 'sms'); },
    'how-picked': function () { openModal({ kind: 'howPicked' }); },
    'auto-mode': function (el) { openPop({ kind: 'automode', id: drawer.id }, el); },
    'auto-pick': function (el) {
      var v = el.getAttribute('data-v'), id = pop.id; closePop();
      withUndo('shops', [id], function () { var x = DB.shops[id]; x.autoFU = v; log(x, 'system', 'Automatic follow-ups set to ' + (v ? CADENCE.filter(function (c) { return c[0] === v; })[0][1].toLowerCase() : 'automatic') + '.'); put('shops', x); }, v === 'off' ? 'Automatic follow-ups off for this shop' : 'Saved');
    },
    'toggle-waiting': function () { UI.showWaiting = !UI.showWaiting; renderMain(); },
    'toggle-tidy': function () { UI.showTidy = !UI.showTidy; renderMain(); },
    // phone
    'call': function (el) { closePop(); startCall(el.getAttribute('data-phone'), el.getAttribute('data-type') ? { type: el.getAttribute('data-type'), id: el.getAttribute('data-id'), fid: el.getAttribute('data-fid') || null, touch: el.getAttribute('data-touch') || null } : null); },
    'call-end': function () { if (!call) return; call.duration = call.started ? (Date.now() - call.started) / 1000 : 0; call.state = 'wrap'; call.outcome = call.duration > 8 ? 'Talked to them' : 'No answer'; renderCall(); var t = document.querySelector('.callbar textarea'); if (t) t.focus(); },
    'call-outcome': function (el) { call.outcome = el.getAttribute('data-v'); renderCall(); },
    'call-fu': function (el) { call.fu = el.getAttribute('data-v'); renderCall(); },
    'call-save': function () { saveCall(); },
    'call-discard': function () { call = null; renderCall(); },
    'text': function (el) { closePop(); openSheet(el.getAttribute('data-phone'), el.getAttribute('data-type') ? { type: el.getAttribute('data-type'), id: el.getAttribute('data-id') } : null); },
    'sheet-close': function () { sheet = null; renderSheet(); },
    'send': function (el) { sendText(el.getAttribute('data-v'), el.getAttribute('data-how') || 'copy'); },
    'tpl': function (el) {
      var t = (S().templates || []).filter(function (x) { return x.id === el.getAttribute('data-v'); })[0], key = el.getAttribute('data-key'); if (!t) return;
      UI.drafts['sms:' + key] = fillTemplate(t.text, convFor(key));
      var ta = el.closest('.th-comp').querySelector('textarea'); ta.value = UI.drafts['sms:' + key]; ta.focus();
    },
    'tpl-ask': function (el) { var d = curRec(), c = dealContact(d); if (!c) { toast('This shop has nobody with a phone number yet', { bad: true }); return; } textFromTemplate(c.phone, { type: 'deal', id: d.id }, el.getAttribute('data-v')); },
    'conv-open': function (el) { var key = el.getAttribute('data-v'); UI.view = 'messages'; UI.conv = key; markRead(key); drawer = null; if (sheet && sheet.key === key) sheet = null; alerts = alerts.filter(function (a) { return a.key !== key; }); saveUI(); render(); var t = document.querySelector('.conv-pane textarea'); if (t && window.innerWidth > 760) t.focus(); },
    'conv-close': function () { UI.conv = null; renderMain(); },
    'conv-filter': function (el) { UI.convFilter = el.getAttribute('data-v'); UI.conv = null; saveUI(); ensureConv(); render(); },
    'review-unknown': function () { UI.view = 'messages'; UI.convFilter = 'unknown'; var u = I.convs.filter(function (c) { return !c.who; })[0]; UI.conv = u ? u.key : null; saveUI(); render(); },
    'new-text': function () { openModal({ kind: 'newText' }); },
    'block': function (el) {
      var key = el.getAttribute('data-v'), st = S(), before = clone(st);
      st.blocked = (st.blocked || []).concat([{ phone: fmtPhone(key), at: nowISO() }]); put('meta', st);
      if (UI.conv === key) UI.conv = null; if (sheet && sheet.key === key) sheet = null;
      ensureConv(); render(); toast(fmtPhone(key) + ' blocked. Their calls and texts stop showing up.', { undo: function () { put('meta', before); render(); } });
    },
    'unblock': function (el) { modal.st.blocked.splice(+el.getAttribute('data-v'), 1); renderModal(); },
    'add-contact-from': function (el) { openModal({ kind: 'addContactFrom', key: el.getAttribute('data-v') }); },
    // alerts
    'alert-x': function (el) { var id = el.getAttribute('data-v'); alerts = alerts.filter(function (a) { return a.id !== id; }); renderAlerts(); },
    'alert-open': function (el) { var a = alerts.filter(function (x) { return x.id === el.getAttribute('data-v'); })[0]; if (a) openAlert(a); },
    // deals
    'move': function (el) {
      var d = curRec(), to = el.getAttribute('data-v');
      if (d && d.stage === 'funded' && to !== 'funded') { openModal({ kind: 'unfund', dealId: d.id, to: to }); return; }
      moveDeal(d, to);
    },
    'to-uw': function (el) { moveDeal(DB.deals[el.getAttribute('data-id')], 'underwriting'); },
    'reopen': function () { var d = curRec(), to = d.closed && d.closed.fromStage ? d.closed.fromStage : 'submitted'; withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; x.stage = to; x.stageAt = nowISO(); x.closed = null; log(x, 'system', 'Reopened, back in ' + STAGE_LABEL[to].toLowerCase() + '.'); put('deals', x); }, 'Reopened'); },
    'close-open': function (el) { openCloseModal(curRec(), el.getAttribute('data-v')); },
    'close-kind': function (el) { modal.reason = null; modal.err = null; modal.kindSel = el.getAttribute('data-v'); renderModal(); },
    'offer-new': function () { openOfferModal(curRec()); },
    'offer-edit': function (el) { openOfferModal(curRec(), el.getAttribute('data-v')); },
    'offer-remove': function () { var d = DB.deals[modal.dealId], oid = modal.offerId; closeModal(); withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; x.offers = x.offers.filter(function (o) { return o.id !== oid; }); if (x.acceptedOfferId === oid) x.acceptedOfferId = null; if (!x.offers.length && x.stage === 'approved') { x.stage = 'underwriting'; x.stageAt = nowISO(); } log(x, 'system', 'Offer removed.'); put('deals', x); }, 'Offer removed'); },
    'offer-pick': function (el) {
      var d = curRec(), oid = el.getAttribute('data-v');
      drawer.tab = 'paperwork';
      withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; x.acceptedOfferId = oid; var o = acceptedOffer(x); x.stage = 'contracts'; x.stageAt = nowISO(); x.closing.sent = x.stageAt; log(x, 'system', 'Merchant picked the ' + money(o.amount) + ' offer at ' + A.sellRate(o).toFixed(2) + '. Contracts out.'); put('deals', x); }, 'Contracts out');
    },
    'offer-unpick': function () { var d = curRec(); withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; x.acceptedOfferId = null; x.stage = 'approved'; x.stageAt = nowISO(); log(x, 'system', 'Offer choice cleared, back to approved.'); put('deals', x); }, 'Back to approved'); },
    'paper': function (el) {
      var d = curRec(), k = el.getAttribute('data-v'), had = !!d.paperwork[k];
      var label = k === 'app' ? 'Signed application' : k === 'mtd' ? 'Month to date statement' : A.monthLabel(k, true) + ' statement';
      withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; if (had) delete x.paperwork[k]; else x.paperwork[k] = nowISO(); log(x, 'system', label + (had ? ' marked missing.' : ' received.')); put('deals', x); }, label + (had ? ' marked missing' : ' received'));
      var x = DB.deals[d.id];
      if (!had && x.stage === 'submitted' && !fileMissing(x).length) toast('The file is complete. Send it to underwriting?', { action: { label: 'Send it', fn: function () { moveDeal(DB.deals[d.id], 'underwriting'); } } });
    },
    'closing': function (el) {
      var d = curRec(), k = el.getAttribute('data-v'), had = !!d.closing[k], label = A.CLOSING_ITEMS.filter(function (c) { return c.id === k; })[0].label;
      withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; if (had) delete x.closing[k]; else x.closing[k] = nowISO(); log(x, 'system', label + (had ? ' unticked.' : ' done.')); put('deals', x); }, label + (had ? ' unticked' : ' done'));
      var x = DB.deals[d.id];
      if (!had && x.stage === 'contracts' && !closingMissing(x).length) toast('Everything is in. Ready to fund.', { action: { label: 'Mark funded', fn: function () { moveDeal(DB.deals[d.id], 'funded'); } } });
    },
    'comm-paid': function () { var d = curRec(), had = !!d.funded.commissionPaidAt; withUndo('deals', [d.id], function () { var x = DB.deals[d.id]; x.funded.commissionPaidAt = had ? null : nowISO(); log(x, 'system', had ? 'Shop commission marked unpaid.' : 'Shop commission of ' + money(A.commission(x.funded)) + ' paid.'); put('deals', x); }, had ? 'Marked unpaid' : 'Commission marked paid'); },
    'renew': function (el) { startRenewal(el.getAttribute('data-id') ? DB.deals[el.getAttribute('data-id')] : curRec()); },
    'edit-deal': function () { openModal({ kind: 'editDeal', dealId: drawer.id }); },
    'deal-delete': function () { var id = modal.dealId, before = clone(DB.deals[id]); closeModal(); drawer = null; remove('deals', id); render(); toast('Deal deleted', { undo: function () { put('deals', before); render(); } }); },
    'new-deal': function (el) {
      if (!I.shops.length) { toast('Add a shop first. Deals come in from shops.', { bad: true, action: { label: 'Add shop', fn: function () { openModal({ kind: 'addShop', name: '' }); } } }); return; }
      openModal({ kind: 'newDeal', shopId: el.getAttribute('data-v') || null });
    },
    'draft-type': function (el) { var k = 'act:' + drawer.id, d = UI.drafts[k] = UI.drafts[k] || { type: 'note', text: '', outcome: 'Talked to them' }; d.type = el.getAttribute('data-v'); renderDrawer(); var t = document.querySelector('.composer textarea'); if (t) t.focus(); },
    'draft-outcome': function (el) { var k = 'act:' + drawer.id, d = UI.drafts[k] = UI.drafts[k] || { type: 'call', text: '', outcome: '' }; d.outcome = el.getAttribute('data-v'); renderDrawer(); },
    'draft-save': function () {
      var k = 'act:' + drawer.id, dr = UI.drafts[k] || { type: 'note', text: '' }, kind = kindOf(drawer.type);
      if (!dr.text.trim() && dr.type === 'note') { toast('Write the note first', { bad: true }); return; }
      var x = DB[kind][drawer.id];
      log(x, dr.type, dr.text.trim() || dr.outcome, dr.type === 'call' ? { outcome: dr.outcome } : null);
      put(kind, x); UI.drafts[k] = { type: dr.type, text: '', outcome: dr.outcome }; render(); toast(dr.type === 'call' ? 'Call logged' : 'Note saved');
    },
    'note-edit': function (el) { UI.editNote = el.getAttribute('data-v'); renderDrawer(); var t = document.querySelector('[data-in="note-edit"]'); if (t) t.focus(); },
    'note-cancel': function () { delete UI.drafts['note:' + UI.editNote]; UI.editNote = null; renderDrawer(); },
    'note-save': function (el) {
      var id = el.getAttribute('data-v'), kind = kindOf(drawer.type), recId = drawer.id, text = UI.drafts['note:' + id];
      UI.editNote = null; delete UI.drafts['note:' + id];
      if (text === undefined || !text.trim()) { renderDrawer(); return; }
      withUndo(kind, [recId], function () { var x = DB[kind][recId], a = x.activity.filter(function (y) { return y.id === id; })[0]; if (a) { a.text = text.trim(); a.editedAt = nowISO(); } put(kind, x); }, 'Note saved');
    },
    'note-del': function (el) { var id = el.getAttribute('data-v'), kind = kindOf(drawer.type), recId = drawer.id; withUndo(kind, [recId], function () { var x = DB[kind][recId]; x.activity = x.activity.filter(function (y) { return y.id !== id; }); put(kind, x); }, 'Note deleted'); },
    // shops
    'add-shop': function () { openModal({ kind: 'addShop', name: '' }); },
    'add-list': function () { openModal({ kind: 'import', step: 'pick', text: '' }); },
    'assign-open': function (el) { openModal({ kind: 'assign', shopId: el.getAttribute('data-id') || drawer.id }); },
    'take-shop': function (el) {
      var id = el.getAttribute('data-id') || drawer.id; if (modal) closeModal();
      var name = DB.shops[id].name;
      withUndo('shops', [id], function () { var x = DB.shops[id], now = nowISO(); if (x.repId) x.history.push({ repId: x.repId, from: x.assignedAt || x.createdAt, to: now }); x.repId = ME; x.assignedAt = now; log(x, 'system', pfirst(ME) + ' took this shop.'); put('shops', x); }, name + ' is in your book');
    },
    'merge-open': function (el) {
      var id = el.getAttribute('data-id') || drawer.id, other = (I.dupOf[id] || [])[0]; if (!other) return;
      var a = DB.shops[id], b = DB.shops[other], keep = a.repId && !b.repId ? a : !a.repId && b.repId ? b : (a.createdAt < b.createdAt ? a : b);
      openModal({ kind: 'merge', a: a.id, b: b.id, keep: keep.id });
    },
    'agree-signed': function (el) { var id = el.getAttribute('data-id') || drawer.id; withUndo('shops', [id], function () { var x = DB.shops[id]; x.agreementAt = nowISO(); log(x, 'system', 'ISO agreement marked signed.'); put('shops', x); }, 'Agreement marked signed'); },
    'unpause': function () { var id = drawer.id; withUndo('shops', [id], function () { var x = DB.shops[id]; x.paused = null; log(x, 'system', 'Resumed. The shop can send deals again.'); put('shops', x); }, 'Shop resumed'); },
    'edit-shop': function () { openModal({ kind: 'editShop', shopId: drawer.id }); },
    'shop-delete': function () { var id = modal.shopId, before = clone(DB.shops[id]); closeModal(); drawer = null; remove('shops', id); render(); toast('Shop deleted', { undo: function () { put('shops', before); render(); } }); },
    'about-edit': function () { UI.editAbout = drawer.id; renderDrawer(); var t = document.querySelector('[data-in="about"]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } },
    'about-cancel': function () { delete UI.drafts['about:' + drawer.id]; UI.editAbout = null; renderDrawer(); },
    'about-save': function () {
      var id = drawer.id, text = UI.drafts['about:' + id]; UI.editAbout = null; delete UI.drafts['about:' + id];
      if (text === undefined) { renderDrawer(); return; }
      withUndo('shops', [id], function () { var x = DB.shops[id]; x.about = text.trim(); put('shops', x); }, 'Saved');
    },
    'contact-edit': function (el) { UI.editContact = el.getAttribute('data-v'); renderDrawer(); var f = document.querySelector('.cform input'); if (f) f.focus(); },
    'contact-cancel': function () { UI.editContact = null; renderDrawer(); },
    'contact-del': function (el) { var cid = el.getAttribute('data-v'), sid = drawer.id; UI.editContact = null; withUndo('shops', [sid], function () { var x = DB.shops[sid], c = x.contacts.filter(function (y) { return y.id === cid; })[0]; x.contacts = x.contacts.filter(function (y) { return y.id !== cid; }); log(x, 'system', (c ? c.name : 'A person') + ' removed.'); put('shops', x); }, 'Person removed'); },
    // private desk: import, export, alerts, account
    'import-open': function () { closePop(); openModal({ kind: 'import', step: 'pick', text: '' }); },
    'import-paste-go': function () { var t = document.querySelector('.modal [data-in="import-paste"]'); modal.text = t ? t.value : modal.text || ''; if (!modal.text.trim()) { modal.err = 'Choose a file, or paste something first.'; renderModal(); return; } Object.assign(modal, { step: 'preview', fileName: '', table: null, map: null, tkind: null, sel: null, loose: null }); importParse(modal); renderModal(); },
    'import-back': function () { Object.assign(modal, { step: 'pick', err: null, table: null, map: null, tkind: null }); renderModal(); },
    'imp-all': function (el) { var on = el.getAttribute('data-v') === '1'; modal.groups.companies.forEach(function (g) { modal.sel[g.key] = on; }); renderModal(); },
    'imp-show-all': function () { modal.showAll = true; renderModal(); },
    'imp-loose': function (el) { modal.loose = el.getAttribute('data-v'); renderModal(); },
    'export-shops': function () { exportShops(); toast('Downloaded your shops and people'); },
    'export-deals': function () { exportDeals(); toast('Downloaded your deals'); },
    'export-backup': function () { exportBackup(); toast('Downloaded a full backup. Import it here any time to restore.'); },
    'phone-setup': function () { closePop(); openModal({ kind: 'phone' }); },
    'push-on': function () { pushOn(); },
    'push-off': function () { pushOff(); if (modal && modal.kind === 'phone') closeModal(); },
    'push-test': function () { api('/api/push', { action: 'test' }).then(function (res) { toast(res.j.ok ? 'Test alert sent' : (res.j.error || 'No device took the test alert. Turn alerts off and on again.'), { bad: !res.j.ok }); }); },
    'setup-hide': function () { var st = S(), before = clone(st); st.setup = Object.assign({}, st.setup, { hidden: true }); put('meta', st); render(); toast('Hidden. Import and alerts are also in the menu under your name.', { undo: function () { put('meta', before); render(); } }); },
    'setup-phone-ok': function () { var st = S(); st.setup = Object.assign({}, st.setup, { phoneAck: true }); put('meta', st); render(); },
    'feedback-open': function () { closePop(); openModal({ kind: 'feedback' }); },
    'team-open': function () { closePop(); openModal({ kind: 'team' }); loadTeam(); },
    'team-book': function (el) { UI.f.book = el.getAttribute('data-v') === ME ? '' : el.getAttribute('data-v'); UI.f.shops = []; closeModal(); UI.view = 'shops'; saveUI(); drawer = null; render(); window.scrollTo(0, 0); },
    'team-copy': function () { var box = document.querySelector('.modal [data-in="team-link-box"]'); if (box) { box.select(); try { if (navigator.clipboard) navigator.clipboard.writeText(box.value); else document.execCommand('copy'); } catch (e) { /* select is enough */ } } toast('Link copied'); },
    'team-link': function (el) {
      var p = modal.people.filter(function (x) { return x.member === el.getAttribute('data-v'); })[0]; if (!p) return;
      api('/api/team', { action: 'invite', email: p.email, name: p.name }).then(function (res) {
        if (!res.j.ok) { modal.err = res.j.error || 'That did not work.'; renderModal(); return; }
        modal.link = { name: p.name, url: res.j.link, phone: p.phone }; modal.err = null; loadTeam(); refreshTeam();
      });
    },
    'team-remove': function (el) { modal.confirm = el.getAttribute('data-v'); renderModal(); },
    'team-remove-no': function () { modal.confirm = null; renderModal(); },
    'team-remove-yes': function (el) {
      var who = el.getAttribute('data-v'), p = modal.people.filter(function (x) { return x.member === who; })[0];
      api('/api/team', { action: 'remove', member: who }).then(function (res) {
        modal.confirm = null;
        if (!res.j.ok) { modal.err = res.j.error || 'That did not work.'; renderModal(); return; }
        toast((p ? first(p.name) : 'Their') + "'s login is off. Their shops stay in their book until you hand them over."); loadTeam(); refreshTeam();
      });
    },
    'log-open': function () { closePop(); openModal({ kind: 'log' }); loadLog(false); },
    'log-rec': function (el) { var t = el.getAttribute('data-type'), id = el.getAttribute('data-id'); openModal({ kind: 'log', rec: id, recName: recName(t, recOf(t, id)) }); loadLog(false); },
    'log-more': function () { loadLog(true); },
    'pw-open': function () { modal.pw = true; modal.pwErr = null; renderModal(); var f = document.querySelector('.modal [name="pwCur"]'); if (f) f.focus(); },
    'pw-cancel': function () { modal.pw = false; renderModal(); },
    'pw-save': function () {
      var cur = (document.querySelector('.modal [name="pwCur"]') || {}).value || '', next = (document.querySelector('.modal [name="pwNew"]') || {}).value || '';
      if (next.length < 8) { modal.pwErr = 'The new password needs 8 or more characters.'; renderModal(); return; }
      var email = SESSION.user.email;
      Promise.all([deriveKey(email, cur), deriveKey(email, next)]).then(function (k) { return api('/api/auth/password', { current: k[0], next: k[1] }); }).then(function (res) {
        if (!res.j.ok) { modal.pwErr = res.j.error || 'Could not change it.'; renderModal(); return; }
        modal.pw = false; renderModal(); toast('Password changed. Your other devices need to sign in again.');
      }).catch(function () { modal.pwErr = 'Could not reach ISO Desk.'; renderModal(); });
    },
    'sign-out': function () {
      closePop();
      if (hasPending()) { flush(); toast('Saving your last change first. Try again in a moment.'); return; }
      var done = function () { dropCache(); location.replace('/'); };
      var unsub = swReg && swReg.pushManager ? swReg.pushManager.getSubscription().then(function (sub) { if (!sub) return null; return api('/api/push', { action: 'unsubscribe', endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); }); }).catch(function () { return null; }) : Promise.resolve();
      unsub.then(function () { return api('/api/auth/logout', {}); }).then(done, done);
    },
    // settings
    'tpl-add': function () { modal.st.templates.push({ id: uid('t'), name: 'New template', text: '' }); renderModal(); var all = document.querySelectorAll('.tpl-edit textarea'); if (all.length) all[all.length - 1].focus(); },
    'tpl-del': function (el) { modal.st.templates.splice(+el.getAttribute('data-v'), 1); renderModal(); },
    'reset-open': function () { closePop(); openModal({ kind: 'reset' }); },
    // modal plumbing
    'modal-close': function () { closeModal(); },
    'modal-bg': function (el, e) { if (e.target === el && downAt === el) closeModal(); },
    'toast-undo': function () { var r = document.getElementById('toast-root'), u = r._undo; r.innerHTML = ''; r._undo = null; if (u) u(); },
    'toast-action': function () { var r = document.getElementById('toast-root'), a = r._action; r.innerHTML = ''; r._action = null; if (a) a(); }
  };

  // ---------- form submits ----------
  function reviewCur(m) { while (m.i < m.ids.length) { var t = findTouch(m.ids[m.i]); if (t) return t; m.i++; } return null; }
  function reviewNext() {
    modal.i++; modal.choose = null; render();
    var ta = document.querySelector('.modal textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  var SUBMIT = {
    review: function (f, how) {
      var m = modal; if (!m || m.kind !== 'review' || !reviewCur(m)) return;
      var r = sendTouch(m.ids[m.i], how || 'copy'); if (!r) return;
      m.sent++; reviewNext(); toast(r.msg, { undo: r.undo });
    },
    addShop: function (f) {
      var name = (f.name || '').trim(); if (!name) { toast('Give the shop a name', { bad: true }); return; }
      var exists = I.shops.filter(function (s) { return A.normName(s.name) === A.normName(name); })[0];
      if (exists && !f.force) { toast(exists.name + ' is already here. Open it, or tick "add it anyway".', { bad: true }); return; }
      var id = uid('s'), now = nowISO();
      var s = { id: id, name: name, state: f.state, repId: ME, assignedAt: now, history: [], paused: null, agreementAt: f.signed ? now : null, createdAt: now, about: '',
        contacts: f.owner.trim() ? [{ id: id + '-c1', name: f.owner.trim(), role: f.role, phone: fmtPhone(f.phone.trim()), email: f.email.trim() }] : [], followUps: [], activity: [] };
      log(s, 'system', 'Shop added.');
      put('shops', s); closeModal(); render();
      toast(name + ' is in your book', { action: { label: 'Open it', fn: function () { openRecord('shop', id, 'people'); } }, undo: function () { remove('shops', id); render(); } });
    },
    addList: function (f) {
      var c = classifyList(f.names || '');
      if (!c.add.length && !c.claim.length) { toast('Nothing new to add', { bad: true }); return; }
      var ids = [], now = nowISO(), claimed = [];
      c.add.forEach(function (name) { var id = uid('s'); ids.push(id); var s = { id: id, name: name, state: 'FL', repId: ME, assignedAt: now, history: [], paused: null, agreementAt: null, createdAt: now, about: '', contacts: [], followUps: [], activity: [] }; log(s, 'system', 'Added from a pasted list.'); put('shops', s); });
      c.claim.forEach(function (s) { claimed.push(clone(s)); s.repId = ME; s.assignedAt = now; log(s, 'system', 'Picked up from a pasted list.'); put('shops', s); });
      closeModal(); render();
      toast(plural(c.add.length, 'shop') + ' added' + (c.claim.length ? ', ' + c.claim.length + ' picked up' : ''), { undo: function () { ids.forEach(function (id) { remove('shops', id); }); claimed.forEach(function (s) { put('shops', s); }); render(); } });
    },
    newDeal: function (f) {
      var shop = DB.shops[f.shopId]; if (!shop) { toast('Pick the shop that sent it', { bad: true }); return; }
      if (!f.business.trim()) { toast('Add the business name', { bad: true }); return; }
      var id = uid('d'), now = nowISO();
      var d = { id: id, merchant: { business: f.business.trim(), owner: f.owner.trim(), industry: f.industry, state: f.state, monthlyRevenue: +f.monthlyRevenue || 0, tibMonths: +f.tibMonths || 0, fico: +f.fico || 0, positions: +f.positions || 0 },
        requested: +f.requested || 0, shopId: shop.id, contactId: f.contactId || (shop.contacts[0] || {}).id || null, repOverride: null, stage: 'submitted', stageAt: now, submittedAt: now, renewalOf: null,
        paperwork: {}, closing: {}, offers: [], acceptedOfferId: null, funded: null, closed: null, followUps: [], activity: [] };
      if (f.app) d.paperwork.app = now;
      A.statementMonths().forEach(function (mk) { if (f['st_' + mk]) d.paperwork[mk] = now; });
      log(d, 'system', 'Submitted by ' + shop.name + '.');
      var prior = (I.byMerchant[A.normName(d.merchant.business)] || []).filter(function (x) { return x.shopId !== shop.id; })[0], heads = '';
      if (prior) {
        var ps = shopOf(prior) || { name: 'Another shop' };
        log(d, 'system', ps.name + ' sent this merchant first, on ' + fmtDay(prior.submittedAt) + '.');
        log(prior, 'system', shop.name + ' sent this merchant too, on ' + fmtDay(now) + '.'); put('deals', prior);
        heads = '. Heads up: ' + ps.name + ' sent it first';
      }
      put('deals', d); closeModal(); render();
      toast(d.merchant.business + ' logged' + heads, { action: { label: 'Open it', fn: function () { openRecord('deal', id); } }, undo: function () { remove('deals', id); render(); } });
    },
    offer: function (f) {
      var d = DB.deals[modal.dealId], oid = modal.offerId;
      var o = { amount: +f.amount, buyRate: +f.buyRate, termMonths: +f.termMonths, freq: f.freq, maxPoints: +f.maxPoints, fee: +f.fee };
      if (!(o.amount > 0) || !(o.buyRate >= 1) || !(o.termMonths > 0)) { toast('Amount, buy rate and term are needed', { bad: true }); return; }
      closeModal();
      if (drawer) drawer.tab = 'offers';
      withUndo('deals', [d.id], function () {
        var x = DB.deals[d.id];
        if (oid) { var cur = x.offers.filter(function (y) { return y.id === oid; })[0]; Object.assign(cur, o); cur.points = Math.min(cur.points || 0, o.maxPoints); log(x, 'system', 'Offer edited: ' + money(o.amount) + ' at ' + o.buyRate.toFixed(2) + '.'); }
        else {
          x.offers.push(Object.assign({ id: uid('o'), points: Math.round(o.maxPoints * 0.8), sentAt: nowISO() }, o));
          if (x.stage === 'submitted' || x.stage === 'underwriting') { x.stage = 'approved'; x.stageAt = nowISO(); }
          log(x, 'system', 'Underwriting approved ' + money(o.amount) + ' at a ' + o.buyRate.toFixed(2) + ' buy rate, ' + esc(o.termMonths) + ' months.');
        }
        put('deals', x);
      }, oid ? 'Offer saved' : 'Offer recorded. Tell the shop.', oid ? null : { action: { label: 'Text the shop', fn: function () { var c = dealContact(DB.deals[d.id]); if (c) textFromTemplate(c.phone, { type: 'deal', id: d.id }, 't3'); } } });
    },
    close: function (f) {
      var d = DB.deals[modal.dealId], kind = modal.kindSel;
      if (!f.reason) { modal.err = 'Pick a reason.'; modal.note = f.note; renderModal(); return; }
      if (f.reason === 'Other' && !f.note.trim()) { modal.err = 'Say what happened when the reason is Other.'; modal.reason = 'Other'; renderModal(); return; }
      closeModal();
      withUndo('deals', [d.id], function () {
        var x = DB.deals[d.id];
        x.closed = { kind: kind, reason: f.reason, note: f.note.trim(), at: nowISO(), fromStage: x.stage === 'closed' ? 'submitted' : x.stage };
        x.stage = 'closed'; x.stageAt = nowISO(); x.followUps = (x.followUps || []).filter(function (fu) { return fu.doneAt; });
        log(x, 'system', (kind === 'declined' ? 'Declined: ' : 'Lost: ') + f.reason + (f.note.trim() ? '. ' + f.note.trim() : '') + '.');
        put('deals', x);
      }, kind === 'declined' ? 'Marked declined' : 'Marked lost', kind === 'declined' ? { action: { label: 'Text the shop why', fn: function () { var c = dealContact(DB.deals[d.id]); if (c) textFromTemplate(c.phone, { type: 'deal', id: d.id }, 't6'); else toast('This shop has nobody with a phone number yet', { bad: true }); } } } : null);
    },
    assign: function (f) {
      var s = DB.shops[modal.shopId], to = f.repId || null;
      closeModal(); if (to === s.repId) return;
      withUndo('shops', [s.id], function () {
        var x = DB.shops[s.id], now = nowISO();
        if (x.repId) x.history.push({ repId: x.repId, from: x.assignedAt || x.createdAt, to: now });
        log(x, 'system', to ? 'Moved to ' + pname(to) + '.' : 'Left with nobody.');
        x.repId = to; x.assignedAt = to ? now : null; put('shops', x);
      }, to === ME ? 'In your book' : to ? 'Handed to ' + pfirst(to) : 'Left with nobody');
    },
    merge: function (f) {
      var a = DB.shops[modal.a], b = DB.shops[modal.b], keep = f.keep === b.id ? b : a, drop = keep === a ? b : a;
      var moved = (I.dealsByShop[drop.id] || []).map(function (d) { return d.id; });
      var beforeShops = [clone(keep), clone(drop)], beforeDeals = moved.map(function (id) { return clone(DB.deals[id]); });
      closeModal();
      moved.forEach(function (id) { var d = DB.deals[id], old = drop.contacts.filter(function (y) { return y.id === d.contactId; })[0]; var c = old && keep.contacts.filter(function (x) { return x.name.toLowerCase() === old.name.toLowerCase(); })[0]; d.shopId = keep.id; if (c) d.contactId = c.id; log(d, 'system', 'Shop merged into ' + keep.name + '.'); put('deals', d); });
      drop.contacts.forEach(function (c) { if (!keep.contacts.some(function (x) { return x.name.toLowerCase() === c.name.toLowerCase(); })) keep.contacts.push(c); });
      if (!keep.repId && drop.repId) { keep.repId = drop.repId; keep.assignedAt = nowISO(); }
      if (!keep.agreementAt && drop.agreementAt) keep.agreementAt = drop.agreementAt;
      keep.activity = (keep.activity || []).concat((drop.activity || []).filter(function (x) { return x.type !== 'system'; }));
      keep.followUps = (keep.followUps || []).concat(openFUs(drop));
      log(keep, 'system', 'Merged in ' + drop.name + ': ' + plural(moved.length, 'deal') + ', ' + plural(drop.contacts.length, 'person', 'people') + '.');
      put('shops', keep); remove('shops', drop.id);
      if (drawer && drawer.id === drop.id) drawer.id = keep.id;
      render();
      toast('Merged into ' + keep.name, { undo: function () { beforeShops.forEach(function (s) { put('shops', s); }); beforeDeals.forEach(function (d) { put('deals', d); }); render(); } });
    },
    editShop: function (f) {
      var s = DB.shops[modal.shopId];
      if (!f.name.trim()) { toast('The shop needs a name', { bad: true }); return; }
      if (f.paused && !f.pausedReason.trim()) { toast('Say why the shop is paused', { bad: true }); return; }
      closeModal();
      withUndo('shops', [s.id], function () {
        var x = DB.shops[s.id], ch = [];
        if (x.name !== f.name.trim()) { ch.push('renamed from ' + x.name); x.name = f.name.trim(); }
        if (x.state !== f.state) { x.state = f.state; ch.push('state ' + f.state); }
        if ((x.about || '') !== f.about.trim()) x.about = f.about.trim();
        if (!!x.agreementAt !== !!f.signed) { x.agreementAt = f.signed ? nowISO() : null; ch.push(f.signed ? 'agreement signed' : 'agreement unmarked'); }
        if (!!x.w9At !== !!f.w9) { x.w9At = f.w9 ? nowISO() : null; ch.push(f.w9 ? 'W-9 received' : 'W-9 unmarked'); }
        if (!!x.paused !== !!f.paused || (x.paused && x.paused.reason !== f.pausedReason.trim())) { x.paused = f.paused ? { reason: f.pausedReason.trim(), at: nowISO() } : null; ch.push(f.paused ? 'paused' : 'resumed'); }
        if (ch.length) log(x, 'system', 'Edited: ' + ch.join(', ') + '.');
        put('shops', x);
      }, 'Shop saved');
    },
    editDeal: function (f) {
      var d = DB.deals[modal.dealId]; closeModal();
      withUndo('deals', [d.id], function () {
        var x = DB.deals[d.id];
        Object.assign(x.merchant, { business: f.business.trim() || x.merchant.business, owner: f.owner.trim(), industry: f.industry, state: f.state, monthlyRevenue: +f.monthlyRevenue || 0, tibMonths: +f.tibMonths || 0, fico: +f.fico || 0, positions: +f.positions || 0,
          phone: f.mphone.trim() ? fmtPhone(f.mphone.trim()) : '', email: f.memail.trim() });
        x.requested = +f.requested || 0;
        if (x.funded && f.fAmount !== undefined) {
          var pts = Math.max(0, +f.fPoints || 0), factor = +f.fFactor, term = +f.fTerm;
          x.funded.amount = +f.fAmount || x.funded.amount; x.funded.points = pts; x.funded.freq = f.fFreq === 'weekly' ? 'weekly' : 'daily';
          if (/^\d{4}-\d{2}-\d{2}$/.test(f.fDate || '')) x.funded.fundedAt = new Date(parseDay(f.fDate).getTime() + 12 * 36e5).toISOString();
          if (factor > 1 && term > 0) { x.funded.buyRate = Math.round((factor - pts / 100) * 1000) / 1000; x.funded.termMonths = term; x.funded.noTerms = false; }
        }
        log(x, 'system', 'Details edited.'); put('deals', x);
      }, 'Deal saved');
    },
    addContactFrom: function (f) {
      var key = modal.key, s = DB.shops[f.shopId];
      if (!s || !f.name.trim()) { toast('Pick a shop and add a name', { bad: true }); return; }
      closeModal();
      vals(DB.msgs).forEach(function (m) { if (digits(m.phone) === key && m.spam) { m.spam = false; put('msgs', m); } });
      withUndo('shops', [s.id], function () { var x = DB.shops[s.id]; x.contacts.push({ id: uid('c'), name: f.name.trim(), role: f.role, phone: fmtPhone(key), email: '' }); log(x, 'system', f.name.trim() + ' added from a call.'); put('shops', x); }, f.name.trim() + ' added to ' + s.name);
    },
    newText: function (f) {
      var key = digits(f.number) || f.to;
      if (!key || key.length < 10) { toast('Pick someone or type a 10 digit number', { bad: true }); return; }
      closeModal(); UI.conv = key; UI.view = 'messages'; render(); var t = document.querySelector('.conv-pane textarea'); if (t) t.focus();
    },
    settings: function (f) {
      var st = modal.st;
      st.alerts = { offerDays: Math.max(1, +f.offerDays || 2), paperDays: Math.max(1, +f.paperDays || 2), quietDays: Math.max(7, +f.quietDays || 30) };
      st.templates = st.templates.filter(function (t) { return t.text.trim(); });
      var au = st.auto;
      au.topDays = Math.min(60, Math.max(2, +f.autoTop || 7)); au.otherDays = Math.min(90, Math.max(2, +f.autoOther || 14)); au.perDay = Math.min(200, Math.max(1, +f.autoPerDay || 25));
      au.off = A.AUTO_RULES.filter(function (r) { return !f['rule_' + r.id]; }).map(function (r) { return r.id; });
      Object.keys(au.texts).forEach(function (k) { if (!au.texts[k].trim() || au.texts[k] === RULE[k].text) delete au.texts[k]; });
      if (LIVE && f.phone !== undefined) st.phone = f.phone.trim() ? fmtPhone(f.phone.trim()) : '';
      var wantDesktop = !!f.desktop, before = clone(S());
      closeModal();
      put('meta', st); render();
      toast('Settings saved', { undo: function () { put('meta', before); render(); } });
      if (!LIVE && 'Notification' in window && wantDesktop !== (UI.desktop && Notification.permission === 'granted')) ACT['desktop-toggle']();
    },
    import: function () {
      var m = modal;
      if (m.fmt === 'list') { SUBMIT.addList({ names: m.text || '' }); return; }
      if (m.fmt === 'backup') { var n = restoreBackup(m.backup || {}); closeModal(); render(); toast(n ? plural(n, 'record') + ' restored' : 'Nothing to restore. Everything here is as new or newer.'); return; }
      var res = runImport(m);
      closeModal(); render();
      toast(res.msg, { undo: function () { res.created.deals.forEach(function (id) { remove('deals', id); }); res.created.shops.forEach(function (id) { remove('shops', id); }); res.before.forEach(function (x) { put('shops', x); }); render(); } });
    },
    team: function (f) {
      var m = modal; m.add = { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), role: f.role };
      if (!m.add.name || !m.add.email) { m.err = 'Write their name and email.'; renderModal(); return; }
      api('/api/team', { action: 'invite', name: m.add.name, email: m.add.email, phone: m.add.phone, role: m.add.role }).then(function (res) {
        if (modal !== m) return;
        if (!res.j.ok) { m.err = res.j.error || 'That did not work.'; renderModal(); return; }
        m.link = { name: m.add.name, url: res.j.link, phone: m.add.phone }; m.add = { role: 'rep' }; m.err = null; renderModal(); loadTeam(); refreshTeam();
      }).catch(function () { m.err = 'No connection. Try again in a moment.'; renderModal(); });
    },
    unfund: function () { var d = DB.deals[modal.dealId], to = modal.to; closeModal(); moveDeal(d, to); },
    feedback: function (f) {
      var text = (f.text || '').trim(); if (!text) { toast('Write something first', { bad: true }); return; }
      closeModal();
      if (!LIVE) { toast('Thanks. In the demo, use the Feedback button at the bottom left instead.'); return; }
      api('/api/feedback', { text: text, page: UI.view + (drawer ? ', ' + drawer.type : '') }).then(function (res) { toast(res.j.ok ? 'Sent to Yonatan. Thanks.' : 'Could not send it. Try again.', { bad: !res.j.ok }); }).catch(function () { toast('Could not send it. Check the connection.', { bad: true }); });
    },
    'auth-login': function (f) {
      var email = (f.email || '').trim().toLowerCase();
      if (!email || !f.pw) { AUTH.err = 'Enter your email and password.'; AUTH.email = email; renderAuth(); return; }
      AUTH.busy = true; AUTH.err = null; AUTH.email = email; renderAuth();
      deriveKey(email, f.pw).then(function (key) { return api('/api/auth/login', { email: email, key: key }); }).then(function (res) {
        if (!res.j.ok) { AUTH.busy = false; AUTH.err = res.j.error || 'Could not sign in.'; renderAuth(); return; }
        AUTH = null; bootLive();
      }).catch(function () { AUTH.busy = false; AUTH.err = 'Could not reach ISO Desk. Check the connection.'; renderAuth(); });
    },
    'auth-invite': function (f) {
      if ((f.pw || '').length < 8) { AUTH.err = 'Use 8 or more characters.'; renderAuth(); return; }
      if (f.pw !== f.pw2) { AUTH.err = 'The two passwords do not match.'; renderAuth(); return; }
      AUTH.busy = true; AUTH.err = null; renderAuth();
      deriveKey(AUTH.email, f.pw).then(function (key) { return api('/api/auth/accept', { token: AUTH.token, key: key }); }).then(function (res) {
        if (!res.j.ok) { AUTH.busy = false; AUTH.err = res.j.error || 'Could not set the password.'; renderAuth(); return; }
        try { history.replaceState(null, '', '/'); } catch (e) { location.hash = ''; }
        AUTH = null; bootLive();
      }).catch(function () { AUTH.busy = false; AUTH.err = 'Could not reach ISO Desk. Check the connection.'; renderAuth(); });
    },
    reset: function () {
      closeModal();
      var done = function (epoch) { EPOCH = epoch || EPOCH; pending = emptyKinds(); try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ } loadSeed(); drawer = null; sheet = null; call = null; alerts = []; render(); toast('Demo data reset for everyone'); };
      if (mode === 'local') { done(); return; }
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) }).then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(); done(j.epoch); }).catch(function () { toast('Could not reset. Try again in a moment.', { bad: true }); });
    }
  };

  // ================= EVENTS =================
  var POP_OPENERS = '[data-act="ms"],[data-act="since"],[data-act="me-menu"],[data-act="fu-new"],[data-act="fu-new-for"],[data-act="fu-edit"],[data-act="fu-later"],[data-act="touch-later"],[data-act="touch-skip"],[data-act="auto-mode"]';
  document.addEventListener('click', function (e) {
    if (pop && !e.target.closest('.pop') && !e.target.closest(POP_OPENERS) && e.target.id !== 'q') closePop();
    var el = e.target.closest('[data-act]');
    if (!el || !ACT[el.getAttribute('data-act')]) return;
    var act = el.getAttribute('data-act');
    if (act === 'close-drawer' && el.classList.contains('scrim') && e.target !== el) return;
    if (el.tagName === 'BUTTON') e.preventDefault();
    ACT[act](el, e);
  });
  document.addEventListener('submit', function (e) {
    var form = e.target; e.preventDefault();
    if (form.getAttribute('data-form') === 'contact') {
      var cid = form.getAttribute('data-v'), f = formData(form), sid = drawer.id;
      if (!f.name.trim()) { toast('Add a name', { bad: true }); return; }
      UI.editContact = null;
      withUndo('shops', [sid], function () {
        var x = DB.shops[sid];
        var p2 = (f.phone2 || '').trim() ? fmtPhone(f.phone2.trim()) : '';
        if (cid === 'new') { x.contacts.push({ id: uid('c'), name: f.name.trim(), role: f.role, phone: fmtPhone(f.phone.trim()), phone2: p2, email: f.email.trim() }); log(x, 'system', f.name.trim() + ' added as ' + f.role.toLowerCase() + '.'); }
        else { var c = x.contacts.filter(function (y) { return y.id === cid; })[0]; Object.assign(c, { name: f.name.trim(), role: f.role, phone: fmtPhone(f.phone.trim()), phone2: p2, email: f.email.trim() }); }
        put('shops', x);
      }, cid === 'new' ? 'Person added' : 'Saved');
      return;
    }
    var kind = form.getAttribute('data-form');
    if (SUBMIT[kind]) SUBMIT[kind](formData(form), form);
  });
  document.addEventListener('input', function (e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-in');
    if (t.id === 'q') {
      var q = t.value.trim();
      if (q.length < 2) { if (pop && pop.kind === 'search') closePop(); return; }
      if (pop && pop.kind === 'search') { pop.q = q; renderPop(); } else openPop({ kind: 'search', q: q, alignRight: true }, t);
      t.focus(); return;
    }
    if (!k) return;
    if (k === 'draft') { var dk = 'act:' + drawer.id, d = UI.drafts[dk] = UI.drafts[dk] || { type: 'note', text: '', outcome: 'Talked to them' }; d.text = t.value; return; }
    if (k === 'sms') { UI.drafts['sms:' + t.getAttribute('data-key')] = t.value; return; }
    if (k === 'touch') { UI.drafts['touch:' + t.getAttribute('data-k')] = t.value; return; }
    if (k === 'auto-text') { modal.st.auto.texts[t.getAttribute('data-v')] = t.value; return; }
    if (k === 'about') { UI.drafts['about:' + drawer.id] = t.value; return; }
    if (k === 'note-edit') { UI.drafts['note:' + UI.editNote] = t.value; return; }
    if (k === 'call-note') { if (call) call.note = t.value; return; }
    if (k === 'tpl-name') { modal.st.templates[+t.getAttribute('data-i')].name = t.value; return; }
    if (k === 'tpl-text') { modal.st.templates[+t.getAttribute('data-i')].text = t.value; return; }
    if (k === 'shop-q') { UI.f.q = t.value; var pos = t.selectionStart; renderMain(); var n = document.querySelector('[data-in="shop-q"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (k === 'pop-q' || k === 'fu-who') { pop.q = t.value; renderPop(); return; }
    if (k === 'fu-note') { pop.note = t.value; return; }
    if (k === 'addshop-name') { document.getElementById('addshop-match').innerHTML = addShopMatches(t.value); return; }
    if (k === 'addlist') { document.getElementById('addlist-preview').innerHTML = addListPreview(t.value); return; }
    if (k === 'import-paste') { modal.text = t.value; return; }
    if (k === 'newdeal-biz') { var ndf = formData(t.form); document.getElementById('nd-match').innerHTML = merchantMatches(t.value, ndf.shopId); return; }
    if (k === 'offer-f') { var f = formData(t.form); document.getElementById('offer-preview').innerHTML = offerPreview({ amount: +f.amount || 0, buyRate: +f.buyRate || 1, termMonths: +f.termMonths || 1, freq: f.freq, maxPoints: +f.maxPoints || 0, fee: +f.fee || 0 }); return; }
    if (k === 'points') {
      var dd = curRec(), o = dd.offers.filter(function (x) { return x.id === t.getAttribute('data-v'); })[0]; if (!o) return;
      o.points = +t.value; var x = offerNums(o), cardEl = t.closest('.offer');
      ['pay', 'back', 'apr', 'sell', 'comm'].forEach(function (key) { var el = cardEl.querySelector('[data-o="' + key + '"]'); if (el) el.textContent = x[key]; });
      cardEl.querySelector('[data-o="pts"]').textContent = o.points;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-in');
    if (!k) return;
    if (k === 'points') { var d = curRec(), o = d.offers.filter(function (x) { return x.id === t.getAttribute('data-v'); })[0]; log(d, 'system', 'Shop points on the ' + money(o.amount) + ' offer set to ' + t.value + '.'); put('deals', d); return; }
    if (k === 'ms-any' || k === 'ms-opt') {
      var arr = UI.f[pop.key];
      if (k === 'ms-any') arr.length = 0;
      else { var i = arr.indexOf(t.value); if (t.checked && i < 0) arr.push(t.value); if (!t.checked && i >= 0) arr.splice(i, 1); }
      var anyBox = document.querySelector('.pop [data-in="ms-any"]'); if (anyBox) anyBox.checked = !arr.length;
      if (k === 'ms-any') Array.prototype.forEach.call(document.querySelectorAll('.pop [data-in="ms-opt"]'), function (c) { c.checked = false; });
      renderMain(); return;
    }
    if (k === 'newdeal-shop') { var s = DB.shops[t.value]; document.getElementById('nd-contact').innerHTML = select('contactId', (s ? s.contacts : []).map(function (c) { return [c.id, c.name + ', ' + c.role]; }), ''); return; }
    if (k === 'reason') { modal.reason = t.value; modal.err = null; modal.note = formData(t.form).note; renderModal(); return; }
    if (k === 'assign-rep') { modal.repId = t.value; renderModal(); return; }
    if (k === 'merge-keep') { modal.keep = t.value; renderModal(); return; }
    if (k === 'import-file') { readImportFile(t.files && t.files[0]); return; }
    if (k === 'imp-sel') { modal.sel[t.value] = t.checked; renderModal(); return; }
    if (k === 'imp-assign') { modal.assign = t.value || null; renderModal(); return; }
    if (k === 'imp-loose-match') { modal.looseMatch = t.checked; renderModal(); return; }
    if (k === 'log-who') { modal.member = t.value; modal.entries = null; renderModal(); loadLog(false); return; }
    if (k === 'team-role') {
      var who = t.getAttribute('data-v'), role = t.value;
      api('/api/team', { action: 'role', member: who, role: role }).then(function (res) {
        if (!res.j.ok) { toast(res.j.error || 'That did not work.', { bad: true }); }
        else toast(role === 'manager' ? 'Now a manager. They see every book.' : 'Now a rep. They see only their own book.');
        loadTeam(); refreshTeam();
      });
      return;
    }
    if (k === 'imp-map') { var mapEl = document.querySelector('.modal details.mapping'), wasOpen = mapEl && mapEl.open; modal.map[t.getAttribute('data-v')] = +t.value; modal.sel = null; importParse(modal); renderModal(); var nm = document.querySelector('.modal details.mapping'); if (nm && wasOpen) nm.open = true; return; }
    if (k === 'fu-date' || k === 'fu-time' || k === 'fu-repeat') { readFUPop(); renderPop(); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (pop) { closePop(); return; } if (modal) { closeModal(); return; } if (sheet) { sheet = null; renderSheet(); return; } if (drawer) { drawer = null; render(); return; } }
    var t = e.target, k = t.getAttribute && t.getAttribute('data-in');
    if (e.key === 'Enter' && t.id === 'q') { var hit = document.querySelector('.pop [data-act="search-open"]'); if (hit) hit.click(); }
    if (e.key === 'Enter' && t.classList && t.classList.contains('card')) t.click();
    if (e.key === 'Enter' && k === 'fu-note') { e.preventDefault(); ACT['fu-save'](); }
    if (e.key === 'Enter' && !e.shiftKey && k === 'sms') { e.preventDefault(); sendText(t.getAttribute('data-key')); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && k === 'touch') { e.preventDefault(); if (modal && modal.kind === 'review') SUBMIT.review(); else ACT['touch-send'](t); }
    if (e.key === 'Escape' && k === 'touch' && !modal) { UI.editTouch = null; renderMain(); }
    if (e.key === 'Enter' && k === 'fu-who') { e.preventDefault(); var w = document.querySelector('.pop [data-act="fu-target"]'); if (w) w.click(); }
  });
  window.addEventListener('resize', function () { if (pop) closePop(); });

  // ---------- drag and drop on the board ----------
  var dragId = null;
  document.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('.card'); if (!c) return; dragId = c.getAttribute('data-id'); c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* old browsers */ } });
  document.addEventListener('dragend', function (e) { var c = e.target.closest && e.target.closest('.card'); if (c) c.classList.remove('dragging'); dragId = null; Array.prototype.forEach.call(document.querySelectorAll('.col.drop,.col.drop-no'), function (x) { x.classList.remove('drop', 'drop-no'); }); });
  document.addEventListener('dragover', function (e) {
    var dz = e.target.closest && e.target.closest('[data-drop]'); if (dz) { e.preventDefault(); dz.classList.add('over'); return; }
    var col = e.target.closest && e.target.closest('.col'); if (!col || !dragId) return;
    e.preventDefault();
    var g = gateFor(DB.deals[dragId], col.getAttribute('data-stage')), ok = col.getAttribute('data-stage') === 'closed' || g.ok || g.auto;
    Array.prototype.forEach.call(document.querySelectorAll('.col'), function (x) { if (x !== col) x.classList.remove('drop', 'drop-no'); });
    col.classList.toggle('drop', ok); col.classList.toggle('drop-no', !ok);
  });
  document.addEventListener('drop', function (e) {
    var dz = e.target.closest && e.target.closest('[data-drop]'); if (dz) { e.preventDefault(); dz.classList.remove('over'); readImportFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); return; }
    var col = e.target.closest && e.target.closest('.col'); if (!col || !dragId) return;
    e.preventDefault(); col.classList.remove('drop', 'drop-no');
    var id = dragId; dragId = null; moveDeal(DB.deals[id], col.getAttribute('data-stage'));
  });

  // ================= BOOT =================
  function boot() {
    window.addEventListener('beforeunload', function () { if (hasPending() && mode !== 'local') flush(); });
    window.addEventListener('hashchange', function () { if (LIVE && /#invite=/.test(location.hash)) bootLive(); else openFromHash(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) { var d = e.data || {}; if (d.open && String(d.open).indexOf('#') >= 0) location.hash = String(d.open).split('#')[1]; });
    if (LIVE) { bootLive(); return; }
    loadSeed();
    render();
    noteInbound(false);
    pull(true).then(function () { ensureConv(); render(); noteInbound(false); }).catch(function () {
      mode = 'local';
      try { var ov = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); if (ov) applyOverlay(ov); } catch (e) { /* ignore */ }
      render();
    });
  }
  // The private desk paints from this device's copy first, then checks the session and pulls
  // whatever changed on Josh's other devices.
  function startLive(sess, cached) {
    SESSION = sess; ME = sess.user.member;
    setTeam(teamFrom(sess.team && sess.team.length ? sess.team : [{ id: ME, name: sess.user.name, role: sess.user.role }]));
    DB = emptyKinds(); DB.meta.settings = A.defaultSettings(); pending = emptyKinds(); LAST = 0;
    if (cached) {
      KINDS.forEach(function (k) {
        Object.keys(cached.db[k] || {}).forEach(function (id) { var r = cleanRec(k, cached.db[k][id]); if (r && !r.deleted && r.id === id) DB[k][id] = r; });
        Object.keys((cached.pending || {})[k] || {}).forEach(function (id) { pending[k][id] = cached.pending[k][id]; });
      });
      LAST = cached.last || 0;
    }
    document.body.classList.remove('signed-out');
    render(); noteInbound(false); registerSW();
  }
  function bootLive() {
    var inv = /#invite=([A-Za-z0-9_-]{20,100})/.exec(location.hash || '');
    if (inv) { showAuth({ kind: 'invite', token: inv[1] }); return; }
    var cached = readCache();
    if (cached) startLive(cached.session, cached);
    api('/api/auth/me').then(function (res) {
      if (res.status === 401 || !res.j.ok) { showAuth({ kind: 'login', email: cached ? cached.session.user.email : '' }); return; }
      var same = cached && cached.session.ws.id === res.j.ws.id && cached.session.user.member === res.j.user.member;
      if (!same) startLive(res.j, null);
      else { SESSION = res.j; setTeam(teamFrom(res.j.team)); }
      return pullLive(!same).then(function () { flush(); render(); openFromHash(); saveCache(); });
    }).catch(function () {
      if (cached) { setSaveWarn('Offline. Your changes are kept on this device and save when the connection is back.'); openFromHash(); return; }
      window.__ISO_READY = true;
      document.getElementById('main').innerHTML = '<div class="auth"><div class="auth-card"><h1>No connection</h1><p>ISO Desk could not be reached. Check the connection, then reload.</p><button class="btn primary" onclick="location.reload()">Reload</button></div></div>';
    });
  }
  window.ISODESK = { render: render, db: function () { return DB; }, ui: UI, act: ACT, submit: SUBMIT, checkAlerts: function () { lastCheck -= 3600000; checkAlerts(); }, live: LIVE, importParse: importParse, runImport: runImport, session: function () { return SESSION; }, modal: function () { return modal; } };
  boot();
})();
