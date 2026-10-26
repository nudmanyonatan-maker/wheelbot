// Shared helpers for ISO Desk's private workspace functions: JSON replies, sessions,
// password checks, sign-in throttling and record validation.

export const ID_RX = /^[A-Za-z0-9_-]{1,80}$/;
export const KINDS = ['shops', 'deals', 'msgs', 'meta'];
export const SESSION_DAYS = 180;
const DAY = 864e5;
const COOKIE = 'isd';
const MAX_RECORD = 200 * 1024;
const enc = new TextEncoder();

// 'manager' sees and edits every book; 'rep' only their own. The first version called the manager 'owner'.
export function roleOf(r) { return r === 'rep' ? 'rep' : 'manager'; }

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

export function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomToken(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
export async function sha256hex(str) {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
  let out = '';
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, '0');
  return out;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// The browser stretches the password with PBKDF2 (salted with the email) and sends the result
// as "key", so the slow part runs on the device. Here it gets a random salt and one SHA-256.
export async function hashKey(key, salt = randomToken(16)) { return 'v1$' + salt + '$' + await sha256hex(salt + ':' + key); }
export async function checkKey(key, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 3 || p[0] !== 'v1' || typeof key !== 'string' || key.length < 20 || key.length > 200) return false;
  return safeEqual(await sha256hex(p[1] + ':' + key), p[2]);
}
export function validKey(key) { return typeof key === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(key); }

export function cookieValue(request) {
  const raw = request.headers.get('Cookie') || '';
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null;
}
function sessionCookie(token) {
  return COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400;
}
export const clearCookie = COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export async function createSession(env, user, request) {
  const token = randomToken(32), now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, ws, created, expires, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256hex(token), user.id, user.ws, now, now + SESSION_DAYS * DAY, (request.headers.get('User-Agent') || '').slice(0, 200)).run();
  return sessionCookie(token);
}

export async function getSession(request, env) {
  const token = cookieValue(request);
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare('SELECT u.id, u.ws, u.email, u.name, u.member, u.phone, u.role, s.token AS sid, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.disabled_at IS NULL')
    .bind(await sha256hex(token)).first();
  if (!row || row.expires < Date.now()) return null;
  row.role = roleOf(row.role);
  return row;
}

// The session cookie is SameSite=Lax, which already keeps it off cross-site posts.
// This also refuses any write whose Origin names another site.
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function readJson(request, maxBytes) {
  if (+(request.headers.get('Content-Length') || 0) > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Sign-in throttle: 8 misses in 15 minutes locks that email for the rest of the window. An IP gets
// 30, so one person's typos never lock out an office that shares a connection.
const WINDOW = 15 * 60 * 1000;
const limitFor = (k) => (k.startsWith('ip:') ? 30 : 8);
export async function throttled(env, keys) {
  const now = Date.now();
  for (const k of keys) {
    const r = await env.DB.prepare('SELECT n, until FROM attempts WHERE key = ?').bind(k).first();
    if (r && r.until > now && r.n >= limitFor(k)) return Math.ceil((r.until - now) / 60000);
  }
  return 0;
}
export async function noteMiss(env, keys) {
  const now = Date.now();
  await env.DB.batch(keys.map((k) => env.DB.prepare(
    'INSERT INTO attempts (key, n, until) VALUES (?1, 1, ?2) ON CONFLICT(key) DO UPDATE SET n = CASE WHEN until < ?3 THEN 1 ELSE n + 1 END, until = CASE WHEN until < ?3 THEN ?2 ELSE until END'
  ).bind(k, now + WINDOW, now)));
}
export async function clearMisses(env, keys) {
  await env.DB.batch(keys.map((k) => env.DB.prepare('DELETE FROM attempts WHERE key = ?').bind(k)));
}

// Plain records with token ids only. Nested lists carry token ids too. The app checks the rest of
// the shape when it loads them.
export function validRecord(kind, rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || typeof rec.id !== 'string' || !ID_RX.test(rec.id)) return false;
  if (typeof rec.updatedAt !== 'number' || !isFinite(rec.updatedAt)) return false;
  if (rec.deleted === true) return true;
  if (kind === 'meta' && rec.id !== 'settings') return false;
  if (kind === 'deals' && (typeof rec.shopId !== 'string' || !ID_RX.test(rec.shopId))) return false;
  for (const list of ['followUps', 'activity', 'contacts', 'offers', 'templates']) {
    if (rec[list] === undefined) continue;
    if (!Array.isArray(rec[list])) return false;
    if (rec[list].some((x) => !x || typeof x !== 'object' || typeof x.id !== 'string' || !ID_RX.test(x.id))) return false;
  }
  return JSON.stringify(rec).length <= MAX_RECORD;
}

// Turns a session check into the early reply every private route needs.
export async function requireSession(request, env, write) {
  if (write && !sameOrigin(request)) return { reply: json({ ok: false, error: 'This request came from another site.' }, 403) };
  const me = await getSession(request, env);
  if (!me) return { reply: json({ ok: false, error: 'Signed out', signedOut: true }, 401) };
  return { me };
}
