// POST /api/auth/accept { token, peek: true } -> who the invite is for.
// POST /api/auth/accept { token, key } -> sets the password, signs in, burns the invite.
// The same link resets a forgotten password: it replaces the password and signs out every device.
import { json, readJson, sameOrigin, sha256hex, hashKey, validKey, createSession, randomToken, throttled, noteMiss } from '../../../lib/server.js';
import { logEvent } from '../../../lib/book.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'This request came from another site.' }, 403);
  const b = await readJson(request, 4096);
  const token = String((b && b.token) || '');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await throttled(env, ['ip:' + ip])) return json({ ok: false, error: 'Too many tries. Wait a few minutes.' }, 429);
  const now = Date.now();
  const inv = token.length >= 20 && token.length <= 100 ? await env.DB.prepare('SELECT * FROM invites WHERE token = ?').bind(await sha256hex(token)).first() : null;
  if (!inv || inv.used_at || inv.expires < now) {
    await noteMiss(env, ['ip:' + ip]);
    return json({ ok: false, error: 'This link has expired or was already used. Ask Yonatan for a new one.' }, 400);
  }
  if (b.peek) return json({ ok: true, email: inv.email, name: inv.name });
  if (!validKey(b.key)) return json({ ok: false, error: 'Pick a password first.' }, 400);

  const pass = await hashKey(b.key);
  let user = await env.DB.prepare('SELECT id, ws, member, name, disabled_at FROM users WHERE email = ?').bind(inv.email).first();
  // A link made in one workspace can never reset a login that belongs to another one, even if the
  // email signed up there after the link was made.
  if (user && user.ws !== inv.ws) {
    await env.DB.prepare('UPDATE invites SET used_at = ? WHERE token = ?').bind(now, inv.token).run();
    return json({ ok: false, error: 'This link is not valid for this login. Ask for a new one.' }, 403);
  }
  if (user && user.disabled_at) return json({ ok: false, error: 'This login was turned off. Ask your manager.' }, 403);
  const steps = [
    env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name, created) VALUES (?, ?, ?)').bind(inv.ws, inv.ws, now),
    env.DB.prepare('UPDATE invites SET used_at = ? WHERE token = ?').bind(now, inv.token)
  ];
  if (user) {
    steps.push(env.DB.prepare('UPDATE users SET pass = ? WHERE id = ?').bind(pass, user.id));
    steps.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id));
  } else {
    user = { id: 'usr_' + randomToken(9), ws: inv.ws, member: inv.member, name: inv.name };
    steps.push(env.DB.prepare('INSERT INTO users (id, ws, email, name, member, phone, pass, role, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(user.id, inv.ws, inv.email, inv.name, inv.member, inv.phone || '', pass, inv.role || 'owner', now));
    // Links for this email from other workspaces stop working once it has a login here.
    steps.push(env.DB.prepare('UPDATE invites SET used_at = ? WHERE email = ? AND ws != ? AND used_at IS NULL').bind(now, inv.email, inv.ws));
  }
  await env.DB.batch(steps);
  await logEvent(env, { id: user.id, ws: user.ws, member: user.member, name: user.name }, 'password', null, null, user.name, null);
  return json({ ok: true, email: inv.email }, 200, { 'Set-Cookie': await createSession(env, user, request) });
}
