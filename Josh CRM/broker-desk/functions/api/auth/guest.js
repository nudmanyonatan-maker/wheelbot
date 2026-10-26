// GET  /api/auth/guest -> { available, name }: whether this site offers a guest login to its demo.
// POST /api/auth/guest -> signs in to the demo workspace as its manager, with no password.
// Only when DEMO_GUEST names a workspace that is flagged demo, so a real brokerage's book can never
// be opened this way. Guest sessions last 7 days and can't change logins or passwords.
import { json, sameOrigin, createSession, throttled, noteMiss, logEvent, one, getSetting } from '../../../lib/server.js';

async function demoUser(env) {
  const ws = String(env.DEMO_GUEST || '');
  if (!ws || (await getSetting(env, ws, 'demo', false)) !== true) return null;
  const w = await one(env, 'SELECT name FROM workspaces WHERE id = ?', ws);
  const user = await one(env, "SELECT id, ws, member, name FROM users WHERE ws = ? AND role = 'manager' AND disabled_at IS NULL ORDER BY created LIMIT 1", ws);
  return w && user ? { user, wsName: w.name } : null;
}
export async function onRequestGet({ env }) {
  const d = await demoUser(env);
  return json({ ok: true, available: !!d, name: d ? d.wsName : null });
}
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'This request came from another site.' }, 403);
  const d = await demoUser(env);
  if (!d) return json({ ok: false, error: 'There is no demo on this site.' }, 404);
  const ip = request.headers.get('CF-Connecting-IP') || 'local', keys = ['ip:guest:' + ip]; // 30 per 15 minutes per address
  const wait = await throttled(env, keys);
  if (wait) return json({ ok: false, error: 'Too many demo sign-ins from here. Wait ' + wait + ' minutes.' }, 429);
  await noteMiss(env, keys);
  await logEvent(env, d.user, 'sign-in', null, null, 'Demo guest', null);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, d.user, request, 'guest') });
}
