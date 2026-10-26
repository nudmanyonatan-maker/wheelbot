// End-to-end check of the private desk API against a dev server (npm run dev), or a deployed preview.
// Makes a fresh invite, then signs up, signs in, saves, syncs, checks alerts, roles and the change log.
//   node scripts/test-api.mjs                                  local dev on :8788
//   BASE=http://localhost:8790 PERSIST=.wrangler/state-book node scripts/test-api.mjs   a dev server started with --persist-to
//   BASE=https://book-roles.iso-desk-josh.pages.dev node scripts/test-api.mjs           the preview deploy (cleans up after itself)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:8788';
const WHERE = BASE.startsWith('https://') ? '--remote' : '--local'; // a live run cleans up after itself
const PREVIEW = WHERE === '--remote' && !/^https:\/\/iso-desk-josh\.pages\.dev/.test(BASE);
const DBARGS = WHERE === '--remote' ? (PREVIEW ? ['iso-desk-preview', '--remote', '--env', 'preview'] : ['iso-desk', '--remote'])
  : ['iso-desk', '--local'].concat(process.env.PERSIST ? ['--persist-to', process.env.PERSIST] : []);
const INVITE_WHERE = WHERE === '--local' ? ['--local'].concat(process.env.PERSIST ? ['--persist', process.env.PERSIST] : []) : PREVIEW ? ['--preview'] : ['--remote'];
const email = 'api.test+' + Date.now() + '@example.com';
const WS = 'apitest' + Date.now();
const link = execFileSync('node', ['scripts/invite.mjs', ...INVITE_WHERE, '--base', BASE, '--email', email, '--name', 'Api Tester', '--ws', WS, '--member', 'u1'], { encoding: 'utf8' }).trim();
const token = link.split('#invite=')[1];
// Each person signed in gets their own cookie jar.
function client() {
  const c = { cookie: '' };
  c.call = async (path, body, extra = {}) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: c.cookie, Origin: extra.origin || BASE }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) c.cookie = set.split(';')[0];
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  return c;
}
const boss = client();
const call = boss.call;
let cookie = () => boss.cookie;
async function key(mail, pw) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('isodesk:v1:' + mail), iterations: 200000 }, k, 256);
  return Buffer.from(bits).toString('base64url');
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

let r = await call('/api/data');
ok(r.status === 401 && r.j.signedOut, 'data needs a session');
r = await call('/api/auth/accept', { token, peek: true });
ok(r.j.ok && r.j.email === email && r.j.name === 'Api Tester', 'invite peek names the person');
r = await call('/api/auth/accept', { token, key: 'short' });
ok(r.status === 400, 'rejects a malformed key');
r = await call('/api/auth/accept', { token, key: await key(email, 'correct horse battery') });
ok(r.j.ok && cookie().startsWith('isd='), 'accept signs in');
r = await call('/api/auth/accept', { token, peek: true });
ok(!r.j.ok, 'invite works only once');
r = await call('/api/auth/me');
ok(r.j.ok && r.j.user.email === email && r.j.user.role === 'manager' && r.j.team.length === 1 && r.j.vapidKey.length > 40, 'me returns user, role, team and push key');

// save a shop with a follow-up due in 2 minutes, a deal, and a bad record
const at = Date.now() + 120000;
const shop = { id: 'sApi1', name: 'Api Shop', updatedAt: Date.now(), contacts: [{ id: 'c1', name: 'Pat', phone: '(305) 555-0100' }], followUps: [{ id: 'fApi1', due: '2026-10-15', time: '09:00', note: 'Call Pat', doneAt: null, at }], activity: [] };
const deal = { id: 'dApi1', shopId: 'sApi1', updatedAt: Date.now(), merchant: { business: 'Api Pizza' }, followUps: [], activity: [] };
r = await call('/api/data', { shops: [shop, { id: 'bad id', updatedAt: 1 }], deals: [deal] });
ok(r.j.ok && r.j.written === 2 && r.j.rejected.length === 1, 'save writes good records and names the rejected one');
const since = r.j.now;
r = await call('/api/data?since=0');
ok(r.j.shops.sApi1 && r.j.shops.sApi1.name === 'Api Shop' && r.j.deals.dApi1, 'full pull returns the records');
// an older edit loses to the stored one
r = await call('/api/data', { shops: [{ ...shop, name: 'Old name', updatedAt: shop.updatedAt - 1000 }] });
ok(r.j.written === 0, 'older edit is ignored');
// a newer edit wins and shows up in an incremental pull
r = await call('/api/data', { shops: [{ ...shop, name: 'New name', updatedAt: Date.now() + 1 }] });
ok(r.j.written === 1, 'newer edit is written');
r = await call('/api/data?since=' + since);
ok(r.j.shops.sApi1 && r.j.shops.sApi1.name === 'New name', 'incremental pull carries the change');
// follow-up alert row
const db = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', ...DBARGS, '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;
let rows = db("SELECT fid, at, title, body, sent_at FROM alerts WHERE ws = '" + WS + "' AND fid = 'fApi1'");
ok(rows.length === 1 && rows[0].at === at && rows[0].title === 'New name' && rows[0].body === 'Call Pat' && rows[0].sent_at === null, 'open follow-up is copied into alerts');
rows = db("SELECT name, norm_name, rep_id FROM shops WHERE ws = '" + WS + "' AND id = 'sApi1'");
ok(rows.length === 1 && rows[0].name === 'New name' && rows[0].norm_name === 'newname', 'shop row with its matching key');
rows = db("SELECT name, phone_key FROM contacts WHERE ws = '" + WS + "' AND shop_id = 'sApi1'");
ok(rows.length === 1 && rows[0].phone_key === '3055550100', 'contact row with its phone key');
rows = db("SELECT due, note FROM follow_ups WHERE ws = '" + WS + "' AND parent_id = 'sApi1'");
ok(rows.length === 1 && rows[0].note === 'Call Pat', 'follow-up row');
// marking it done removes the alert
r = await call('/api/data', { shops: [{ ...shop, name: 'New name', updatedAt: Date.now() + 2, followUps: [{ ...shop.followUps[0], doneAt: new Date().toISOString() }] }] });
rows = db("SELECT fid FROM alerts WHERE ws = '" + WS + "' AND fid = 'fApi1'");
ok(rows.length === 0, 'done follow-up leaves alerts');
// delete with a tombstone
r = await call('/api/data', { deals: [{ id: 'dApi1', deleted: true, updatedAt: Date.now() + 3 }] });
r = await call('/api/data?since=0');
ok(r.j.deals.dApi1 && r.j.deals.dApi1.deleted === true, 'tombstone replaces the deal');
r = await call('/api/data?since=' + since);
ok(r.j.deals.dApi1 && r.j.deals.dApi1.deleted === true, 'a catch-up pull carries the deletion');
// writes from another site are refused
r = await call('/api/data', { shops: [shop] }, { origin: 'https://evil.example' });
ok(r.status === 403, 'cross-site write refused');
// push subscribe validation
r = await call('/api/push', { action: 'subscribe', sub: { endpoint: 'javascript:alert(1)', keys: { p256dh: 'x', auth: 'y' } } });
ok(r.status === 400, 'bad push endpoint refused');
r = await call('/api/feedback', { text: 'Testing feedback', page: 'today' });
ok(r.j.ok, 'feedback stored');
// password change, then sign in with the new one
r = await call('/api/auth/password', { current: await key(email, 'wrong one here'), next: await key(email, 'new password 123') });
ok(r.status === 401, 'wrong current password refused');
r = await call('/api/auth/password', { current: await key(email, 'correct horse battery'), next: await key(email, 'new password 123') });
ok(r.j.ok, 'password changed');
r = await call('/api/auth/logout', {});
ok(r.j.ok, 'signed out');
r = await call('/api/data');
ok(r.status === 401, 'signed out session no longer works');
r = await call('/api/auth/login', { email, key: await key(email, 'correct horse battery') });
ok(r.status === 401, 'old password refused');
r = await call('/api/auth/login', { email: email.toUpperCase(), key: await key(email, 'new password 123') });
ok(r.j.ok, 'new password works, email is case-insensitive');
r = await call('/api/data?since=0');
ok(r.j.shops.sApi1, 'data still there after signing back in');
// throttle: 8 misses lock the email
for (let i = 0; i < 8; i++) await call('/api/auth/login', { email, key: await key(email, 'guess ' + i) });
r = await call('/api/auth/login', { email, key: await key(email, 'new password 123') });
ok(r.status === 429, 'sign-in locks after 8 misses');
const inviteLink = (mail, ws) => execFileSync('node', ['scripts/invite.mjs', ...INVITE_WHERE, '--base', BASE, '--email', mail, '--name', 'Other Desk', '--ws', ws, '--member', 'u1'], { encoding: 'utf8' }).trim();
await import('./test-api-roles.mjs').then((m) => m.run({ BASE, WS, db, client, key, ok, boss, email, inviteLink }));
if (WHERE === '--remote') {
  for (const w of [WS, WS + 'b']) {
    for (const t of ['shops', 'contacts', 'deals', 'follow_ups', 'messages', 'settings', 'audit', 'records', 'alerts', 'push_subs', 'feedback', 'sessions', 'invites', 'users']) db('DELETE FROM ' + t + " WHERE ws = '" + w + "'");
    db("DELETE FROM workspaces WHERE id = '" + w + "'");
  } db("DELETE FROM attempts WHERE key LIKE 'e:api.test+%'");
}
console.log('api tests passed: ' + n + (WHERE === '--remote' ? ' (live, test data removed)' : ''));
