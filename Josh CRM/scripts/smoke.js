// Runtime smoke test: loads data.js, importer.js and app.js against a stub DOM, renders every
// screen, opens every shop and deal on every tab, opens every dialog, and fails on any throw.
// Runs the public demo and the private desk (signed in, with a stubbed server).
//   node scripts/smoke.js demo
//   node scripts/smoke.js live      Josh alone
//   node scripts/smoke.js team      Josh as manager of a team of three: every book, team, change log, import for a rep
//   node scripts/smoke.js rep       a rep who sees only their own book
const path = require('path');
const MODE = ['live', 'team', 'rep'].indexOf(process.argv[2]) >= 0 ? process.argv[2] : 'demo';
const LIVE = MODE !== 'demo';
const els = {};
function el(id) {
  return els[id] || (els[id] = { id, innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, focus() {}, remove() {}, setSelectionRange() {}, click() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    offsetWidth: 0, offsetHeight: 0, get firstChild() { return id.indexOf('child-') === 0 ? null : el('child-' + id); } });
}
global.window = global;
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
global.addEventListener = () => {};
global.document = { getElementById: el, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
  createElement() { return el('x' + Math.random()); }, body: { appendChild() {}, classList: { add() {}, remove() {} } }, activeElement: null, hidden: false };
global.setInterval = () => 0; global.setTimeout = () => 0; global.clearTimeout = () => {}; global.innerWidth = 1400; global.innerHeight = 900; global.scrollTo = () => {};
global.location = { hash: '', pathname: '/', search: '', host: 'localhost:8788', replace() {}, reload() {} };
global.history = { replaceState() {} };
global.matchMedia = () => ({ matches: false });
Object.defineProperty(global, 'navigator', { value: { userAgent: 'smoke', onLine: true, maxTouchPoints: 0 }, configurable: true });
if (MODE === 'demo') global.ISODESK_DEMO = true;

let seedForServer = null, otherShop = null;
const reply = (body, status = 200) => Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body), headers: { get: () => null } });
const TEAM3 = [{ id: 'u1', name: 'Josh Abecassis', role: 'manager', active: true }, { id: 'u2', name: 'Dana Ortiz', role: 'rep', active: true }, { id: 'u3', name: 'Eli Brandt', role: 'rep', active: false }];
const ME_REPLY = {
  live: { user: { name: 'Josh Abecassis', email: 'josh@example.com', member: 'u1', phone: '(305) 280-5556', role: 'owner' }, team: [{ id: 'u1', name: 'Josh Abecassis' }] },
  team: { user: { name: 'Josh Abecassis', email: 'josh@example.com', member: 'u1', phone: '(305) 280-5556', role: 'manager' }, team: TEAM3 },
  rep: { user: { name: 'Dana Ortiz', email: 'dana@example.com', member: 'u2', phone: '(305) 555-0142', role: 'rep' }, team: TEAM3 }
};
global.fetch = (url, opt) => {
  if (MODE === 'demo') return Promise.reject(new Error('offline'));
  if (url.indexOf('/api/auth/me') === 0) return reply(Object.assign({ ok: true, ws: { id: 'w1', name: 'Test' }, vapidKey: '' }, ME_REPLY[MODE]));
  if (url.indexOf('/api/data') === 0 && (!opt || !opt.method || opt.method === 'GET')) return reply(Object.assign({ now: Date.now() }, seedForServer));
  if (url.indexOf('/api/team') === 0 && (!opt || !opt.method || opt.method === 'GET')) return reply({ ok: true, people: TEAM3.map((t, i) => ({ member: t.id, name: t.name, email: t.id + '@example.com', phone: '', role: t.role, active: t.active, lastSignIn: i ? null : Date.now() })), invites: [] });
  if (url.indexOf('/api/team') === 0) return reply({ ok: true, link: 'https://example.test/#invite=abc', member: 'u9' });
  if (url.indexOf('/api/audit') === 0) return reply({ ok: true, more: true, entries: [
    { id: 3, at: Date.now(), who: 'Dana Ortiz', member: 'u2', action: 'update', kind: 'shops', recId: Object.keys(seedForServer.shops)[0], label: 'A shop', changes: [{ f: 'name', from: 'Old', to: 'New' }, { f: 'contacts', added: ['Rita Gomez'] }, { f: 'repId', from: 'u1', to: 'u2' }, { f: 'about', from: '{"x":1}', to: 'y' }] },
    { id: 2, at: Date.now() - 6e4, who: 'Josh Abecassis', member: 'u1', action: 'invite', kind: null, recId: 'u2', label: 'Dana Ortiz', changes: [{ f: 'invited as', to: 'rep, dana@example.com' }] },
    { id: 1, at: Date.now() - 12e4, who: 'Josh Abecassis', member: 'u1', action: 'sign-in', kind: null, recId: null, label: 'Josh Abecassis', changes: null }] });
  if (url.indexOf('/api/import-check') === 0) return reply({ ok: true, names: otherShop ? { [window.AD.normName(otherShop.name)]: { id: null, name: otherShop.name, repId: otherShop.repId, owner: 'Josh Abecassis', yours: false } } : {}, phones: {}, domains: {} });
  return reply({ ok: true, rejected: [], denied: [], now: Date.now() });
};
require(path.join(__dirname, '../public/data.js'));
require(path.join(__dirname, '../public/importer.js'));
if (LIVE) {
  // The server hands back the demo seed as if Josh had built it up himself. A rep gets only their own book.
  const seed = window.AD.buildSeed(); seedForServer = {};
  const keep = (k, r) => MODE !== 'rep' || (k === 'shops' ? r.repId === 'u2' : k === 'deals' ? seed.shops.some((s) => s.id === r.shopId && s.repId === 'u2') : k === 'meta');
  ['shops', 'deals', 'msgs', 'meta'].forEach((k) => { seedForServer[k] = {}; seed[k].forEach((r) => { if (!keep(k, r)) return; r.updatedAt = 1; seedForServer[k][r.id] = r; }); });
  otherShop = seed.shops.filter((s) => s.repId === 'u1')[0];
}
require(path.join(__dirname, '../public/app.js'));
const D = window.ISODESK; let errs = 0;
const fake = (attrs) => ({ getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]), closest() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0 }; } });
const tryIt = (label, fn) => { try { fn(); return true; } catch (e) { errs++; console.log('FAIL', label, e.stack.split('\n').slice(0, 3).join(' | ')); return false; } };
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  for (let i = 0; i < 12; i++) await tick();
  if (LIVE && !D.session()) { console.log('FAIL live boot did not sign in'); process.exit(1); }
  const views = LIVE ? ['today', 'shops', 'deals'] : ['today', 'messages', 'shops', 'deals'];
  views.forEach((v) => tryIt('view ' + v, () => { D.ui.view = v; D.render(); if (els.main.innerHTML.length < 500) throw new Error('view ' + v + ' rendered almost nothing'); }));
  if (LIVE) {
    tryIt('live hides Messages', () => { if (els.nav.innerHTML.indexOf('data-v="messages"') >= 0) throw new Error('Messages tab shown on the private desk'); });
    tryIt('live setup card', () => { D.ui.view = 'today'; D.render(); if (els.main.innerHTML.indexOf('Get set up') < 0) throw new Error('setup card missing'); });
  }
  const db = D.db(); let n = 0;
  Object.keys(db.shops).forEach((id) => ['deals', 'people', 'activity'].forEach((tab) => { if (tryIt('shop ' + id + ' ' + tab, () => D.act.open(fake({ 'data-type': 'shop', 'data-id': id, 'data-tab': tab }), null))) n++; }));
  Object.keys(db.deals).forEach((id) => ['paperwork', 'offers', 'activity'].forEach((tab) => { if (tryIt('deal ' + id + ' ' + tab, () => D.act.open(fake({ 'data-type': 'deal', 'data-id': id, 'data-tab': tab }), null))) n++; }));
  D.act['close-drawer']();
  const modals = [['how', {}], ['settings-open', {}], ['add-shop', {}], ['add-list', {}], ['new-deal', {}], ['import-open', {}]].concat(LIVE ? [['phone-setup', {}], ['feedback-open', {}]] : [['new-text', {}], ['reset-open', {}]]);
  modals.forEach(([a, attrs]) => tryIt('modal ' + a, () => { D.act[a](fake(attrs), null); D.act['modal-close'](); }));
  tryIt('fu popover', () => D.act['fu-new'](fake({}), null));
  tryIt('alerts', () => D.checkAlerts());
  if (MODE === 'demo') tryIt('conversation', () => D.act['conv-open'](fake({ 'data-v': Object.keys(db.msgs).map((k) => db.msgs[k].phone.replace(/\D/g, ''))[0] }), null));
  // import a phone contacts file and a deals sheet, then render everything again
  tryIt('import contacts', () => {
    const before = Object.keys(D.db().shops).length;
    const m = { text: 'BEGIN:VCARD\nVERSION:3.0\nFN:Rita Gomez\nORG:Sunrise Capital Group\nTEL;TYPE=CELL:305-555-0177\nEMAIL:rita@sunrise.example\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:Sam Lee\nORG:Sunrise Capital\nTEL:(305) 555-0178\nEND:VCARD\n', fileName: 'contacts.vcf' };
    D.importParse(m); const res = D.runImport(m);
    const after = Object.keys(D.db().shops).length;
    if (after !== before + 1) throw new Error('expected one new shop, got ' + (after - before) + ': ' + res.msg);
  });
  tryIt('import deals', () => {
    const m = { text: 'Merchant,ISO,Amount Requested,Status,Date Submitted\nApi Diner,Sunrise Capital,"$40,000",Funded,09/30/2026\nBolt Gym,Brand New Shop LLC,25k,Declined,10/01/2026\nCasa Taco,Sunrise Capital,30000,Approved,10/10/2026\n', fileName: 'deals.csv' };
    D.importParse(m); if (m.tkind !== 'deals') throw new Error('not read as deals: ' + m.tkind);
    const res = D.runImport(m); if (res.created.deals.length !== 3) throw new Error(res.msg);
    D.render();
    res.created.deals.forEach((id) => ['paperwork', 'offers', 'activity'].forEach((tab) => D.act.open(fake({ 'data-type': 'deal', 'data-id': id, 'data-tab': tab }), null)));
    D.act['close-drawer']();
  });
  views.forEach((v) => tryIt('view after import ' + v, () => { D.ui.view = v; D.render(); }));
  if (LIVE) await rolesChecks();
  console.log(MODE + ': screens and drawers rendered: ' + n + ' | errors: ' + errs);
  async function rolesChecks() {
    const html = (id) => els[id] ? els[id].innerHTML : '';
    const shopsShown = () => { D.ui.view = 'shops'; D.render(); return (html('main').match(/data-act="open" data-type="shop"/g) || []).length; };
    D.ui.f.book = '';
    tryIt('me menu by role', () => { D.act['me-menu'](fake({}), null); const p = html('pop-root'); if ((p.indexOf('team-open') >= 0) !== (MODE !== 'rep')) throw new Error('team item shown to the wrong role'); if (p.indexOf('log-open') < 0) throw new Error('no change log item'); });
    tryIt('book filter only for a manager with a team', () => { shopsShown(); if ((html('main').indexOf('data-act="book"') >= 0) !== (MODE === 'team')) throw new Error('book filter shown wrongly'); });
    if (MODE === 'team') {
      tryIt('books', () => {
        const mine = shopsShown(); D.ui.f.book = 'all'; const all = shopsShown(); D.ui.f.book = 'u2'; const dana = shopsShown(); D.ui.f.book = 'none'; const none = shopsShown();
        if (!(mine > 0 && all > mine && dana > 0 && none > 0 && all >= mine + dana + none)) throw new Error('book counts off: ' + [mine, all, dana, none]);
        D.ui.f.book = 'all'; D.ui.view = 'deals'; D.render(); D.ui.f.book = ''; D.render();
      });
      D.act['team-open'](fake({}), null); for (let i = 0; i < 6; i++) await tick();
      tryIt('team modal', () => { const h = html('modal-root'); if (h.indexOf('Add and get their link') < 0 || h.indexOf('Dana Ortiz') < 0 || h.indexOf('Turn back on') < 0) throw new Error('team modal incomplete'); });
      tryIt('team invite', () => { D.submit.team({ name: 'New Rep', email: 'new@example.com', phone: '(305) 555-0199', role: 'rep' }); });
      for (let i = 0; i < 6; i++) await tick();
      tryIt('team link shown', () => { if (html('modal-root').indexOf('#invite=abc') < 0) throw new Error('no link'); D.act['modal-close'](); });
    }
    D.act['log-open'](fake({}), null); for (let i = 0; i < 6; i++) await tick();
    tryIt('change log', () => { const h = html('modal-root'); if (h.indexOf('Dana Ortiz</b> changed') < 0 || h.indexOf('name from Old to New') < 0 || h.indexOf('people: added Rita Gomez') < 0 || (MODE !== 'live' && h.indexOf('whose book from Josh Abecassis to Dana Ortiz') < 0) || h.indexOf('Show older changes') < 0) throw new Error('log lines off: ' + h.slice(0, 300)); });
    D.act['log-more'](fake({}), null); for (let i = 0; i < 6; i++) await tick(); D.act['modal-close']();
    const sid = Object.keys(D.db().shops)[0];
    tryIt('change log of one shop', () => { D.act['log-rec'](fake({ 'data-type': 'shop', 'data-id': sid }), null); D.act['modal-close'](); });
    // A contact with no company whose email domain matches a shop here joins that shop.
    const host = Object.values(D.db().shops).filter((s) => s.contacts.some((c) => /@/.test(c.email || '')))[0];
    tryIt('import matches by email domain', () => {
      const dom = host.contacts.filter((c) => /@/.test(c.email))[0].email.split('@')[1], before = host.contacts.length, shops = Object.keys(D.db().shops).length;
      const m = { text: 'BEGIN:VCARD\nVERSION:3.0\nFN:Zed Quill\nEMAIL:zed@' + dom + '\nTEL:(415) 555-0193\nEND:VCARD\n', fileName: 'one.vcf' };
      D.importParse(m); D.runImport(m);
      if (D.db().shops[host.id].contacts.length !== before + 1 || Object.keys(D.db().shops).length !== shops) throw new Error('not matched to ' + host.name);
    });
    if (MODE === 'rep') {
      const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:Kim Park\nORG:' + otherShop.name + ', LLC\nTEL:(415) 555-0194\nEND:VCARD\n';
      D.act['import-open'](fake({}), null);
      const mm = D.modal(); Object.assign(mm, { step: 'preview', text: vcf, fileName: 'two.vcf' }); D.importParse(mm);
      for (let i = 0; i < 6; i++) await tick();
      tryIt("rep import leaves a teammate's shop alone", () => {
        const shops = Object.keys(D.db().shops).length, h = html('modal-root');
        if (h.indexOf('Already in Josh Abecassis&#39;s book, left alone') < 0) throw new Error('taken shop not flagged: ' + h.slice(0, 600));
        D.runImport(mm); if (Object.keys(D.db().shops).length !== shops) throw new Error('rep import made a shop that is in someone else\'s book');
        D.act['modal-close']();
      });
    }
    if (MODE === 'team') tryIt('import into a rep\'s book', () => {
      const m = { text: 'Company,Name,Phone\nFreshwater Funding Co,Lia Moss,(415) 555-0195\n', fileName: 'shops.csv' };
      D.importParse(m); m.assign = 'u2'; const res = D.runImport(m);
      const s = D.db().shops[res.created.shops[0]];
      if (!s || s.repId !== 'u2' || !s.assignedAt) throw new Error('new shop not in Dana\'s book');
      m.assign = null; const m2 = { text: 'Company,Name,Phone\nOpen Water Capital,Ty Fox,(415) 555-0196\n', fileName: 'shops2.csv' }; D.importParse(m2); m2.assign = null;
      const s2 = D.db().shops[D.runImport(m2).created.shops[0]]; if (s2.repId !== null) throw new Error('nobody should own it');
    });
  }
  process.exit(errs ? 1 : 0);
})();
