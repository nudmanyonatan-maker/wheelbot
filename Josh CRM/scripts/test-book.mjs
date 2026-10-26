// lib/book.js against a real SQLite with the same migrations as D1 (Node's built-in node:sqlite),
// so the split into tables, the rebuild, roles, phone messages and the diff are checked without a
// dev server. Run: node scripts/test-book.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { saveBook, readBook, saveMessages, matchShops, diff } from '../lib/book.js';

const sqlite = new DatabaseSync(':memory:');
['0001_base.sql', '0002_book.sql'].forEach((f) => sqlite.exec(readFileSync(new URL('../db/migrations/' + f, import.meta.url), 'utf8')));
// Just enough of D1's API for lib/book.js.
const stmt = (sql) => ({ sql, args: [], bind(...a) { this.args = a; return this; },
  all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }, first() { return sqlite.prepare(this.sql).get(...this.args) || null; }, run() { sqlite.prepare(this.sql).run(...this.args); return {}; } });
const env = { DB: { prepare: stmt, batch: async (list) => { sqlite.exec('BEGIN'); try { const out = list.map((s) => (/^\s*SELECT/i.test(s.sql) ? s.all() : (s.run(), { results: [] }))); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } } };
const rows = (sql, ...a) => sqlite.prepare(sql).all(...a);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

sqlite.exec("INSERT INTO users (id, ws, email, name, member, role, created) VALUES ('U1', 'w', 'boss@x.test', 'Josh Abecassis', 'u1', 'owner', 1), ('U2', 'w', 'rep@x.test', 'Dana Ortiz', 'm2', 'rep', 2)");
const boss = { id: 'U1', ws: 'w', member: 'u1', name: 'Josh Abecassis', role: 'manager' };
const rep = { id: 'U2', ws: 'w', member: 'm2', name: 'Dana Ortiz', role: 'rep' };
const t = Date.now();

// A shop goes in whole and comes back whole.
const shop = { id: 's1', name: 'Sunrise Capital Group LLC', state: 'FL', repId: 'm2', updatedAt: t, about: 'Sends restaurants', history: [], paused: null,
  contacts: [{ id: 'c1', name: 'Rita Gomez', role: 'Owner', phone: '(305) 555-0177', email: 'rita@sunrisecap.example' }, { id: 'c2', name: 'Sam Lee', role: 'Sales rep', phone: '+1 305 555 0178', phone2: '', email: 'sam@gmail.com' }],
  followUps: [{ id: 'f1', due: '2026-10-20', time: '09:00', note: 'Call Rita', at: t + 864e5, by: 'u1' }], activity: [{ id: 'a1', type: 'note', text: 'Met at the expo', at: new Date(t).toISOString() }] };
const deal = { id: 'd1', shopId: 's1', stage: 'submitted', updatedAt: t, merchant: { business: 'Casa Taco' }, requested: 30000, followUps: [], activity: [] };
let r = await saveBook(env, boss, { shops: [shop], deals: [deal], meta: [{ id: 'settings', updatedAt: t, templates: [], alerts: { quietDays: 30 } }] });
ok(r.written === 3 && !r.denied.length, 'manager saves a shop, a deal and settings');
const back = JSON.parse(await readBook(env, boss, 0));
ok(JSON.stringify(back.shops.s1) === JSON.stringify(Object.assign({ id: 's1', repId: 'm2', updatedAt: t, contacts: shop.contacts, followUps: shop.followUps }, (({ id, repId, updatedAt, contacts, followUps, ...rest }) => rest)(shop))), 'the shop comes back exactly as saved');
ok(back.deals.d1.merchant.business === 'Casa Taco' && back.meta.settings.alerts.quietDays === 30, 'deal and settings come back');
const con = rows("SELECT id, phone_key, email_domain FROM contacts WHERE ws = 'w' ORDER BY pos");
ok(con[0].phone_key === '3055550177' && con[0].email_domain === 'sunrisecap.example' && con[1].phone_key === '3055550178' && con[1].email_domain === '', 'contacts keep match keys, free mail has no domain');
ok(rows("SELECT norm_name FROM shops WHERE id = 's1'")[0].norm_name === 'sunrisecapital', 'shop name normalized with normName from data.js');
ok(rows("SELECT member FROM alerts WHERE fid = 'f1'")[0].member === 'u1', 'alert goes to whoever set the follow-up');

// A rep sees and changes only their own book.
r = await saveBook(env, boss, { shops: [{ id: 's2', name: 'Bridgeway', repId: 'u1', updatedAt: t, contacts: [], followUps: [], activity: [] }] });
const repView = JSON.parse(await readBook(env, rep, 0));
ok(repView.shops.s1 && !repView.shops.s2 && repView.deals.d1 && !repView.meta.settings, "rep sees their shop and deal, not the manager's shop or settings");
r = await saveBook(env, rep, { shops: [{ id: 's2', name: 'Mine now', repId: 'm2', updatedAt: t + 1, contacts: [], followUps: [], activity: [] }] });
ok(r.written === 0 && r.denied[0].id === 's2', "rep cannot take a manager's shop");

// The change log has before and after.
r = await saveBook(env, rep, { shops: [Object.assign({}, shop, { name: 'Sunrise Capital', updatedAt: t + 2, contacts: shop.contacts.concat([{ id: 'c3', name: 'Ana Ruiz', phone: '' }]) })] });
const log = rows("SELECT who, action, changes FROM audit WHERE ws = 'w' AND rec_id = 's1' ORDER BY id");
const last = JSON.parse(log[log.length - 1].changes);
ok(log[0].action === 'create' && log[log.length - 1].who === 'Dana Ortiz' && last.some((c) => c.f === 'name' && c.from === 'Sunrise Capital Group LLC' && c.to === 'Sunrise Capital') && last.some((c) => c.f === 'contacts' && c.added[0] === 'Ana Ruiz'), 'audit has who, what and before/after');

// Texts from the phone line land in the rep's book once, however often the carrier retries.
const text = { id: 'in1', phone: '(305) 555-0177', dir: 'in', kind: 'text', text: 'Got a new file for you', at: new Date(t).toISOString(), read: false, updatedAt: t };
r = await saveMessages(env, { ws: 'w', member: 'm2' }, [text]);
ok(r.written === 1, 'inbound text saved');
await saveBook(env, rep, { msgs: [Object.assign({}, text, { read: true, updatedAt: t + 5 })] });
r = await saveMessages(env, { ws: 'w', member: 'm2' }, [Object.assign({}, text, { updatedAt: t + 9 })]);
ok(r.written === 0 && JSON.parse(rows("SELECT data FROM messages WHERE id = 'in1'")[0].data).read === true, 'a carrier retry does not undo the rep reading it');
ok(JSON.parse(await readBook(env, rep, 0)).msgs.in1 && !JSON.parse(await readBook(env, { ...rep, member: 'm9' }, 0)).msgs.in1, 'the text is in the rep\'s book only');
ok(rows("SELECT who FROM audit WHERE rec_id = 'in1' AND action = 'create'")[0].who === 'Phone line', 'logged as the phone line');

// Matching for imports.
const mt = await matchShops(env, rep, ['SUNRISE CAPITAL, LLC', 'Bridgeway Inc'], ['305.555.0178'], ['sunrisecap.example', 'gmail.com']);
ok(mt.names.sunrisecapital.id === 's1' && mt.names.bridgeway.id === null && mt.names.bridgeway.owner === 'Josh Abecassis', 'names match across books, ids only for your own');
ok(mt.phones['3055550178'].id === 's1' && mt.domains['sunrisecap.example'].id === 's1' && !mt.domains['gmail.com'], 'phone and company domain match');

// A device whose clock runs an hour ahead cannot beat a later edit from a device with the right time.
const ahead = { id: 'sClock', name: 'From the fast clock', repId: 'u1', updatedAt: Date.now() + 36e5, contacts: [], followUps: [], activity: [] };
r = await saveBook(env, boss, { shops: [ahead] });
const stored = rows("SELECT updated_at FROM shops WHERE id = 'sClock'")[0].updated_at;
ok(r.written === 1 && stored <= Date.now() && r.stamped.length === 1 && r.stamped[0].id === 'sClock' && r.stamped[0].updatedAt === stored, 'a future time is saved as the server time and reported back');
r = await saveBook(env, boss, { shops: [Object.assign({}, ahead, { name: 'Edited later, right clock', updatedAt: Date.now() })] });
ok(r.written === 1 && !r.stamped.length && rows("SELECT name FROM shops WHERE id = 'sClock'")[0].name === 'Edited later, right clock', 'the later edit wins');
r = await saveBook(env, boss, { shops: [Object.assign({}, ahead, { name: 'Old offline edit', updatedAt: stored - 60000 })] });
ok(r.written === 0 && rows("SELECT name FROM shops WHERE id = 'sClock'")[0].name === 'Edited later, right clock', 'an older edit still loses');

// Nobody can write over, or bring back, a teammate's deleted record, even knowing its id.
sqlite.exec("INSERT INTO users (id, ws, email, name, member, role, created) VALUES ('U3', 'w', 'eli@x.test', 'Eli Brandt', 'm3', 'rep', 3)");
const eli = { id: 'U3', ws: 'w', member: 'm3', name: 'Eli Brandt', role: 'rep' };
const t2 = Date.now();
await saveBook(env, rep, { shops: [{ id: 'sDel', name: 'Dana Old Shop', repId: 'm2', updatedAt: t2, contacts: [], followUps: [], activity: [] }],
  deals: [{ id: 'dDel', shopId: 's1', updatedAt: t2, merchant: { business: 'Dana Old Deal' }, followUps: [], activity: [] }], msgs: [{ id: 'mDel', phone: '(305) 555-0177', dir: 'out', kind: 'text', text: 'hi', at: new Date(t2).toISOString(), updatedAt: t2 }] });
await saveBook(env, rep, { shops: [{ id: 'sDel', deleted: true, updatedAt: t2 + 1 }], deals: [{ id: 'dDel', deleted: true, updatedAt: t2 + 1 }], msgs: [{ id: 'mDel', deleted: true, updatedAt: t2 + 1 }] });
await saveBook(env, eli, { shops: [{ id: 'sEli', name: 'Eli Shop', repId: 'm3', updatedAt: t2, contacts: [], followUps: [], activity: [] }] });
r = await saveBook(env, eli, {
  shops: [{ id: 'sDel', name: 'Taken by Eli', repId: 'm3', updatedAt: t2 + 5, contacts: [], followUps: [], activity: [] }],
  deals: [{ id: 'dDel', shopId: 'sEli', updatedAt: t2 + 5, merchant: { business: 'Taken by Eli' }, followUps: [], activity: [] }],
  msgs: [{ id: 'mDel', phone: '(305) 555-0177', dir: 'out', kind: 'text', text: 'planted', at: new Date(t2).toISOString(), updatedAt: t2 + 5 }] });
ok(r.written === 0 && r.denied.length === 3, "a rep cannot write over a teammate's deleted shop, deal or text");
ok(rows("SELECT deleted, rep_id FROM shops WHERE id = 'sDel'")[0].deleted === 1 && rows("SELECT deleted FROM deals WHERE id = 'dDel'")[0].deleted === 1 &&
  rows("SELECT deleted, rep_id FROM messages WHERE id = 'mDel'")[0].rep_id === 'm2' && JSON.parse(rows("SELECT data FROM messages WHERE id = 'mDel'")[0].data).deleted === true, 'the deleted rows are untouched');
r = await saveBook(env, rep, { shops: [{ id: 'sDel', name: 'Dana Old Shop', repId: 'm2', updatedAt: t2 + 9, contacts: [], followUps: [], activity: [] }] });
ok(r.written === 1 && rows("SELECT deleted FROM shops WHERE id = 'sDel'")[0].deleted === 0, 'the owner can still bring their own shop back');

// Diff details.
ok(diff({ a: 1, followUps: [{ id: 'f', note: 'x', at: 1 }] }, { a: 1, followUps: [{ id: 'f', note: 'x', at: 2 }] }).length === 0, 'the app\'s own time stamps are not changes');
ok(diff({ stage: 'submitted' }, { stage: 'approved' })[0].to === 'approved', 'plain field change');

console.log('book tests passed: ' + n);
