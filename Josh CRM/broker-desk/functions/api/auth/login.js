// POST /api/auth/login { email, key } -> sets the session cookie.
import { json, readJson, sameOrigin, checkKey, createSession, throttled, noteMiss, clearMisses, logEvent } from '../../../lib/server.js';


export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'This request came from another site.' }, 403);
  const b = await readJson(request, 4096);
  const email = String((b && b.email) || '').trim().toLowerCase();
  if (!email || !b.key) return json({ ok: false, error: 'Enter your email and password.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const keys = ['e:' + email, 'ip:' + ip];
  const wait = await throttled(env, keys);
  if (wait) return json({ ok: false, error: 'Too many tries. Wait ' + wait + ' minutes, then try again.' }, 429);
  const user = await env.DB.prepare('SELECT id, ws, pass, member, name FROM users WHERE email = ? AND disabled_at IS NULL').bind(email).first();
  if (!user || !(await checkKey(b.key, user.pass))) {
    await noteMiss(env, keys);
    return json({ ok: false, error: 'That email and password do not match.' }, 401);
  }
  await clearMisses(env, ['e:' + email]);
  await logEvent(env, user, 'sign-in', null, null, user.name, null);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, user, request) });
}
