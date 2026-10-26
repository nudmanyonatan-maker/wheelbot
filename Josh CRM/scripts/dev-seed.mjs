// Local test desk: a manager and a rep on the made-up demo shops, for trying roles and imports on
// a dev server. Local only; it refuses to run against a deployed site.
//   BASE=http://localhost:8790 PERSIST=.wrangler/state-book node scripts/dev-seed.mjs
// Then sign in at BASE with either login below.
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import '../public/data.js';

const BASE = process.env.BASE || 'http://localhost:8788';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('dev-seed only runs against a local dev server.'); process.exit(1); }
// Test logins for the local dev database only.
const MANAGER = { email: 'manager@dev.test', name: 'Josh Abecassis', password: 'local dev only 1' };
const REP = { email: 'rep@dev.test', name: 'Dana Ortiz', password: 'local dev only 2' };
const WS = 'devdesk';

async function key(mail, pw) {
  const te = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('isodesk:v1:' + mail), iterations: 200000 }, k, 256);
  return Buffer.from(bits).toString('base64url');
}
function client() {
  const c = { cookie: '' };
  c.call = async (path, body) => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: c.cookie, Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) c.cookie = set.split(';')[0];
    return r.json();
  };
  return c;
}

const where = ['--local'].concat(process.env.PERSIST ? ['--persist', process.env.PERSIST] : []);
const link = execFileSync('node', ['scripts/invite.mjs', ...where, '--base', BASE, '--email', MANAGER.email, '--name', MANAGER.name, '--ws', WS, '--wsname', 'Dev desk', '--member', 'u1', '--role', 'manager'], { encoding: 'utf8' }).trim();
const boss = client();
let r = await boss.call('/api/auth/accept', { token: link.split('#invite=')[1], key: await key(MANAGER.email, MANAGER.password) });
if (!r.ok) { console.error('Manager sign-up failed: ' + r.error); process.exit(1); }
r = await boss.call('/api/team', { action: 'invite', name: REP.name, email: REP.email, role: 'rep' });
const repMember = r.member;
const rep = client();
r = await rep.call('/api/auth/accept', { token: r.link.split('#invite=')[1], key: await key(REP.email, REP.password) });
if (!r.ok) { console.error('Rep sign-up failed: ' + r.error); process.exit(1); }

// The demo's made-up book: Josh keeps his shops, Dana's go to the rep, the rest have nobody.
const seed = globalThis.AD.buildSeed(), owner = (id) => (id === 'u1' ? 'u1' : id === 'u2' ? repMember : null);
seed.shops.forEach((s) => { s.repId = owner(s.repId); s.history = []; s.updatedAt = Date.now(); });
seed.deals.forEach((d) => { d.repOverride = null; if (d.funded) d.funded.repId = owner(d.funded.repId); d.updatedAt = Date.now(); });
const all = seed.shops.map((x) => ['shops', x]).concat(seed.deals.map((x) => ['deals', x]));
for (let i = 0; i < all.length; i += 150) {
  const body = { shops: [], deals: [] };
  all.slice(i, i + 150).forEach(([k, x]) => body[k].push(x));
  r = await boss.call('/api/data', body);
  if (!r.ok) { console.error('Seeding failed: ' + JSON.stringify(r)); process.exit(1); }
}
console.log('Seeded ' + seed.shops.length + ' shops and ' + seed.deals.length + ' deals into ' + WS + ' at ' + BASE + '.');
console.log('Sign in as the manager (' + MANAGER.email + ') or the rep (' + REP.email + '); passwords are in this file.');
