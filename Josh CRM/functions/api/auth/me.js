// GET /api/auth/me -> who is signed in, their role, their team and the key for phone alerts.
// team lists everyone who ever had a login (their names show up in shop history); active is
// false for people a manager removed.
import { json, getSession, roleOf } from '../../../lib/server.js';

export async function onRequestGet({ request, env }) {
  const me = await getSession(request, env);
  if (!me) return json({ ok: false, signedOut: true }, 401);
  const ws = await env.DB.prepare('SELECT id, name FROM workspaces WHERE id = ?').bind(me.ws).first();
  const team = await env.DB.prepare('SELECT member AS id, name, role, disabled_at FROM users WHERE ws = ? ORDER BY created').bind(me.ws).all();
  return json({
    ok: true,
    user: { name: me.name, email: me.email, member: me.member, phone: me.phone || '', role: me.role },
    ws: ws || { id: me.ws, name: '' },
    team: (team.results || []).map((t) => ({ id: t.id, name: t.name, role: roleOf(t.role), active: !t.disabled_at })),
    vapidKey: env.VAPID_PUBLIC_KEY || ''
  });
}
