// POST /api/auth/password { current, next } -> changes the password and signs out the other devices.
import { json, readJson, requireSession, checkKey, hashKey, validKey } from '../../../lib/server.js';
import { logEvent } from '../../../lib/book.js';

export async function onRequestPost({ request, env }) {
  const s = await requireSession(request, env, true);
  if (s.reply) return s.reply;
  const b = await readJson(request, 4096);
  if (!b || !validKey(b.next)) return json({ ok: false, error: 'Pick a new password.' }, 400);
  const row = await env.DB.prepare('SELECT pass FROM users WHERE id = ?').bind(s.me.id).first();
  if (!row || !(await checkKey(b.current, row.pass))) return json({ ok: false, error: 'Your current password is not right.' }, 401);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass = ? WHERE id = ?').bind(await hashKey(b.next), s.me.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(s.me.id, s.me.sid)
  ]);
  await logEvent(env, s.me, 'password', null, null, s.me.name, null);
  return json({ ok: true });
}
