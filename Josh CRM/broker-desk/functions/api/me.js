// GET /api/me -> everything the app needs to start: who is signed in, the team, the brokerage's
// settings, this person's own settings, the phone line and the mailbox.
import { json, getSession, roleOf, one, all, parse, localDay0 } from '../../lib/server.js';
import { wsSettings, memberSettings } from '../../lib/defaults.js';
import { carrierFor, phoneAccount, regStatus } from '../../lib/carrier/index.js';
import { mailMode } from '../../lib/mail.js';
import { inboxCount } from '../../lib/activity.js';
import { abandonState } from '../../lib/compliance.js';

export async function onRequestGet({ request, env }) {
  const me = await getSession(request, env);
  if (!me) return json({ ok: false, signedOut: true }, 401);
  me.day0 = localDay0(request);
  const ws = await one(env, 'SELECT id, name, slug, brand FROM workspaces WHERE id = ?', me.ws) || { id: me.ws, name: '' };
  const team = await all(env, 'SELECT member AS id, name, email, role, disabled_at FROM users WHERE ws = ? ORDER BY created', me.ws);
  const acct = await phoneAccount(env, me.ws, { create: false });
  const nums = await all(env, 'SELECT id, e164, label, member FROM numbers WHERE ws = ? AND released_at IS NULL ORDER BY created_at', me.ws);
  const box = await one(env, 'SELECT provider, address, status, daily_cap FROM mailboxes WHERE ws = ? AND member = ?', me.ws, me.member);
  return json({
    ok: true,
    user: { name: me.name, email: me.email, member: me.member, phone: me.phone || '', role: me.role, guest: !!me.guest },
    ws: { id: ws.id, name: ws.name, slug: ws.slug, brand: parse(ws.brand, {}) },
    team: team.map((t) => ({ id: t.id, name: t.name, email: t.email, role: roleOf(t.role), active: !t.disabled_at })),
    settings: await wsSettings(env, me.ws), mine: await memberSettings(env, me.ws, me.member),
    phone: { carrier: carrierFor(env).name, provider: acct ? acct.provider : carrierFor(env).name, ready: !!acct, balanceCents: acct ? acct.balanceCents : null,
      registration: acct ? regStatus(acct) : 'draft', numbers: nums, mine: (nums.find((n) => n.member === me.member) || nums[0] || null) },
    mail: { mode: mailMode(env), box: box ? { provider: box.provider, address: box.address, status: box.status, dailyCap: box.daily_cap } : null },
    inbox: await inboxCount(env, me), guard: await abandonState(env, me.ws)
  });
}
