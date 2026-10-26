// Shared helpers for every Broker Desk function: JSON replies, sessions, password checks,
// sign-in throttling, ids, small D1 helpers and the change log. Sessions and passwords work
// exactly like ISO Desk's: the browser stretches the password with PBKDF2, the server salts and
// hashes the result once, and the session cookie is HttpOnly and SameSite=Lax.
import '../public/js/shared.js';

export const SH = globalThis.BD_SHARED;
export const ID_RX = /^[A-Za-z0-9_-]{1,80}$/;
export const SESSION_DAYS = 180;
export const DAY = 864e5;
const COOKIE = 'bdk';
const enc = new TextEncoder();

export function roleOf(r) { return r === 'rep' ? 'rep' : 'manager'; }
export function isManager(me) { return !!me && me.role !== 'rep'; }

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}
export const bad = (error, status = 400, extra = {}) => json({ ok: false, error, ...extra }, status);

export function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomToken(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
export function newId(prefix) { return prefix + '_' + Date.now().toString(36) + randomToken(6).replace(/[-_]/g, 'x'); }
export async function sha256hex(str) {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
  let out = '';
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, '0');
  return out;
}
export async function hmac(secret, msg, encoding = 'b64url') {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return encoding === 'hex' ? Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('') : b64url(sig);
}
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

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
function sessionCookie(token) { return COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400; }
export const clearCookie = COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export async function createSession(env, user, request, kind = null) {
  const token = randomToken(32), now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, ws, created, expires, ua, kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256hex(token), user.id, user.ws, now, now + (kind === 'guest' ? 7 : SESSION_DAYS) * DAY, (request.headers.get('User-Agent') || '').slice(0, 200), kind).run();
  return sessionCookie(token);
}
export async function getSession(request, env) {
  const token = cookieValue(request);
  if (!token || token.length > 100) return null;
  const row = await env.DB.prepare('SELECT u.id, u.ws, u.email, u.name, u.member, u.phone, u.role, s.token AS sid, s.expires, s.kind FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.disabled_at IS NULL')
    .bind(await sha256hex(token)).first();
  if (!row || row.expires < Date.now()) return null;
  row.role = roleOf(row.role);
  row.guest = row.kind === 'guest';
  return row;
}
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}
export async function readJson(request, maxBytes = 256 * 1024) {
  if (+(request.headers.get('Content-Length') || 0) > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}
// Every private route starts here. Writes must come from this site.
export async function requireSession(request, env, write) {
  if (write && !sameOrigin(request)) return { reply: bad('This request came from another site.', 403) };
  const me = await getSession(request, env);
  if (!me) return { reply: json({ ok: false, error: 'Signed out', signedOut: true }, 401) };
  return { me };
}
// One wrapper for the common shape: session, optional manager check, JSON body for writes.
// The demo's guest login can use everything except what touches logins: the team, passwords.
export function noGuest(me) { if (me && me.guest) throw fail('The demo login can\'t change logins or passwords.', 403); }
export function route(handlers) {
  const wrap = (fn, write) => async (ctx) => {
    const s = await requireSession(ctx.request, ctx.env, write);
    if (s.reply) return s.reply;
    let body = null;
    if (write) { body = await readJson(ctx.request); if (body === null && ctx.request.headers.get('Content-Length') !== '0') body = {}; }
    s.me.day0 = localDay0(ctx.request);
    try { return await fn({ ...ctx, me: s.me, body: body || {}, url: new URL(ctx.request.url) }); }
    catch (e) { if (!(e && e.expose)) console.error(e); return bad(e && e.expose ? e.message : 'Something went wrong on our side. Try again.', e && e.status || 500); }
  };
  const out = {};
  if (handlers.get) out.onRequestGet = wrap(handlers.get, false);
  if (handlers.post) out.onRequestPost = wrap(handlers.post, true);
  if (handlers.patch) out.onRequestPatch = wrap(handlers.patch, true);
  if (handlers.delete) out.onRequestDelete = wrap(handlers.delete, true);
  return out;
}
// The start of today in the user's own time zone. The browser sends it (X-Day0); the server runs
// in UTC, so without it "today" would start at 7 or 8 pm the evening before in Toronto.
export function localDay0(request) {
  const v = +request.headers.get('X-Day0'), now = Date.now();
  if (v && v <= now && now - v < 30 * 36e5) return v;
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
}
export function fail(message, status = 400) { const e = new Error(message); e.expose = true; e.status = status; return e; }

// ---------- D1 ----------
export const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export async function all(env, sql, ...args) { const r = await q(env, sql, ...args).all(); return (r && r.results) || []; }
export async function one(env, sql, ...args) { return await q(env, sql, ...args).first(); }
export function parse(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

// ---------- settings ----------
export async function getSetting(env, ws, key, fallback) {
  const r = await one(env, 'SELECT data FROM settings WHERE ws = ? AND key = ?', ws, key);
  return r ? parse(r.data, fallback) : fallback;
}
export async function putSetting(env, ws, key, data) {
  await q(env, 'INSERT INTO settings (ws, key, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(ws, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    ws, key, JSON.stringify(data), Date.now()).run();
}

// ---------- sign-in throttle ----------
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
export async function clearMisses(env, keys) { await env.DB.batch(keys.map((k) => env.DB.prepare('DELETE FROM attempts WHERE key = ?').bind(k))); }

// ---------- change log ----------
export function auditStmt(env, me, action, kind, recId, label, changes) {
  return q(env, 'INSERT INTO audit (ws, at, user_id, member, who, action, kind, rec_id, label, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    me.ws, Date.now(), me.id || null, me.member || null, me.name || null, action, kind || null, recId || null, label ? String(label).slice(0, 200) : null,
    changes ? JSON.stringify(changes).slice(0, 4000) : null);
}
export async function logEvent(env, me, action, kind, recId, label, changes) { await auditStmt(env, me, action, kind, recId, label, changes).run(); }
