// The team behind a workspace. Managers only.
// GET  /api/team -> { people: [{ member, name, email, phone, role, active, lastSignIn }], invites: [{ name, email, role, expires }] }
// POST /api/team { action: 'invite', name, email, role, phone } -> { link }: a one-time link to pick a password, good for 7 days.
//      The same action on someone already on the team makes a password reset link (and turns a removed login back on).
// POST /api/team { action: 'role', member, role } -> manager or rep.
// POST /api/team { action: 'remove', member } -> turns the login off and signs them out everywhere. Their shops stay put
//      until a manager hands them to someone else.
import { json, readJson, requireSession, randomToken, sha256hex, roleOf, logEvent } from '../../lib/server.js';


const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i, LINK_DAYS = 7;

async function guard(request, env, write) {
  const s = await requireSession(request, env, write);
  if (s.reply) return s;
  if (s.me.role !== 'manager') return { reply: json({ ok: false, error: 'Only a manager can change the team.' }, 403) };
  if (write && s.me.guest) return { reply: json({ ok: false, error: 'The demo login can\'t change the team.' }, 403) };
  return s;
}

export async function onRequestGet({ request, env }) {
  const s = await guard(request, env, false);
  if (s.reply) return s.reply;
  const [people, invites] = await env.DB.batch([
    env.DB.prepare('SELECT u.member, u.name, u.email, u.phone, u.role, u.disabled_at, (SELECT MAX(created) FROM sessions WHERE user_id = u.id) AS last FROM users u WHERE u.ws = ? ORDER BY u.created').bind(s.me.ws),
    env.DB.prepare('SELECT name, email, role, expires FROM invites WHERE ws = ? AND used_at IS NULL AND expires > ? ORDER BY expires DESC').bind(s.me.ws, Date.now())
  ]);
  return json({
    ok: true,
    people: (people.results || []).map((p) => ({ member: p.member, name: p.name, email: p.email, phone: p.phone || '', role: roleOf(p.role), active: !p.disabled_at, lastSignIn: p.last || null })),
    invites: (invites.results || []).map((i) => ({ name: i.name, email: i.email, role: roleOf(i.role), expires: i.expires }))
  });
}

export async function onRequestPost({ request, env }) {
  const s = await guard(request, env, true);
  if (s.reply) return s.reply;
  const me = s.me, b = (await readJson(request, 4096)) || {}, now = Date.now();

  if (b.action === 'invite') {
    const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 120);
    const role = b.role === 'manager' ? 'manager' : 'rep', phone = String(b.phone || '').trim().slice(0, 30);
    if (!name) return json({ ok: false, error: 'Write their name.' }, 400);
    if (!EMAIL_RX.test(email)) return json({ ok: false, error: 'That email does not look right.' }, 400);
    const ex = await env.DB.prepare('SELECT id, ws, member, name, role FROM users WHERE email = ?').bind(email).first();
    if (ex && ex.ws !== me.ws) return json({ ok: false, error: 'That email already has a Broker Desk login somewhere else.' }, 409);
    const member = ex ? ex.member : 'm' + randomToken(6), token = randomToken(32);
    const steps = [env.DB.prepare('INSERT INTO invites (token, ws, email, name, member, phone, role, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256hex(token), me.ws, email, ex ? ex.name : name, member, phone, ex ? ex.role : role, now + LINK_DAYS * 864e5)];
    if (ex) steps.push(env.DB.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').bind(ex.id));
    await env.DB.batch(steps);
    await logEvent(env, me, 'invite', null, member, ex ? ex.name : name, [{ f: ex ? 'password reset link' : 'invited as', to: ex ? email : role + ', ' + email }]);
    return json({ ok: true, link: new URL(request.url).origin + '/#invite=' + token, existing: !!ex, member });
  }

  const who = await env.DB.prepare('SELECT id, member, name, role, disabled_at FROM users WHERE ws = ? AND member = ?').bind(me.ws, String(b.member || '')).first();
  if (!who) return json({ ok: false, error: 'That person is not on this team.' }, 404);
  const managers = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE ws = ? AND disabled_at IS NULL AND role != 'rep'").bind(me.ws).first()).n;
  const lastManager = roleOf(who.role) === 'manager' && !who.disabled_at && managers <= 1;

  if (b.action === 'role') {
    const role = b.role === 'manager' ? 'manager' : 'rep';
    if (role === roleOf(who.role)) return json({ ok: true });
    if (role === 'rep' && lastManager) return json({ ok: false, error: 'Someone has to stay a manager. Make another person a manager first.' }, 400);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, who.id),
      env.DB.prepare('UPDATE invites SET role = ? WHERE ws = ? AND member = ? AND used_at IS NULL').bind(role, me.ws, who.member)
    ]);
    await logEvent(env, me, 'role', null, who.member, who.name, [{ f: 'role', from: roleOf(who.role), to: role }]);
    return json({ ok: true });
  }

  if (b.action === 'remove') {
    if (who.id === me.id) return json({ ok: false, error: 'You cannot remove yourself.' }, 400);
    if (lastManager) return json({ ok: false, error: 'Someone has to stay a manager.' }, 400);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').bind(now, who.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(who.id),
      env.DB.prepare('UPDATE invites SET used_at = ? WHERE ws = ? AND member = ? AND used_at IS NULL').bind(now, me.ws, who.member)
    ]);
    await logEvent(env, me, 'remove', null, who.member, who.name, null);
    return json({ ok: true });
  }
  return json({ ok: false, error: 'Unknown action' }, 400);
}
