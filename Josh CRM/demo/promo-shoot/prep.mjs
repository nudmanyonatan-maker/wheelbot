// Fresh made-up workspace for filming: Alex Rivera, the demo book of shops and deals, setup card hidden.
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const BASE = 'http://localhost:8798', EMAIL = 'alex@example.com';
const sql = (s) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'iso-desk', '--local', '--command', s], { stdio: ['ignore', 'ignore', 'inherit'] });
sql("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '" + EMAIL + "'); DELETE FROM users WHERE email = '" + EMAIL + "';");
const link = execFileSync('node', ['scripts/invite.mjs', '--local', '--email', EMAIL, '--name', 'Alex Rivera', '--ws', 'promo' + Date.now().toString(36), '--wsname', 'Harbor Funding', '--member', 'u1', '--phone', '(212) 555-0142'], { encoding: 'utf8' }).trim();
const te = new TextEncoder(), pw = randomBytes(12).toString('base64url');
const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
const key = Buffer.from(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('isodesk:v1:' + EMAIL), iterations: 200000 }, k, 256)).toString('base64url');
const r = await fetch(BASE + '/api/auth/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ token: link.split('#invite=')[1], key }) });
const cookie = r.headers.get('set-cookie').split(';')[0];
globalThis.window = globalThis;
require('./public/data.js');
const s = window.AD.buildSeed(), now = Date.now(), keep = {}, phones = {};
const later = (rec) => (rec.followUps || []).forEach((f) => { if (f.doneAt) return; const [y, mo, d] = f.due.split('-').map(Number), [hh, mm] = (f.time || '09:00').split(':').map(Number); const t = new Date(y, mo - 1, d, hh, mm).getTime(); if (t > now - 3 * 3600000 && t < now + 30 * 60000) { const n = new Date(now + 864e5); f.due = n.toISOString().slice(0, 10); f.time = '09:00'; } });
const shops = s.shops.filter((x) => x.repId === 'u1'); shops.forEach((x) => { keep[x.id] = 1; x.contacts.forEach((c) => { phones[c.phone.replace(/\D/g, '')] = 1; }); later(x); });
const deals = s.deals.filter((d) => keep[d.shopId]); deals.forEach(later);
const msgs = s.msgs.filter((m) => m.dir === 'out' && phones[m.phone.replace(/\D/g, '')]);
const meta = [Object.assign(s.meta[0], { setup: { hidden: true, phoneAck: true } })];
for (const [kind, list] of [['shops', shops], ['deals', deals], ['msgs', msgs], ['meta', meta]]) {
  for (let i = 0; i < list.length; i += 100) {
    const b = {}; b[kind] = list.slice(i, i + 100).map((x) => Object.assign(x, { updatedAt: now }));
    const res = await (await fetch(BASE + '/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie }, body: JSON.stringify(b) })).json();
    if (!res.ok) throw new Error(kind + ' ' + JSON.stringify(res));
  }
}
console.log('seeded', shops.length, 'shops', deals.length, 'deals');
