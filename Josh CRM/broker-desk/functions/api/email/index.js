// GET  /api/email -> this person's mailbox and today's sending count.
// POST /api/email { action: 'send', leadId, to, subject, body } -> sends one email.
// POST /api/email { action: 'connect', provider } -> demo mailbox, or the Nylas sign-in link.
// POST /api/email { action: 'disconnect' } | { action: 'cap', cap }
import { route, json, fail, q, randomToken, hmac } from '../../../lib/server.js';
import { mailbox, mailMode, connectUrl, sentToday, sendEmail } from '../../../lib/mail.js';
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) {
    const b = await mailbox(env, me.ws, me.member);
    return json({ ok: true, mode: mailMode(env), box: b ? { provider: b.provider, address: b.address, status: b.status, dailyCap: b.daily_cap, connectedAt: b.connected_at } : null, sentToday: await sentToday(env, me.ws, me.member) });
  },
  async post({ env, me, body, url }) {
    if (body.action === 'send') return json({ ok: true, ...(await sendEmail(env, me, { leadId: body.leadId, to: body.to, subject: body.subject, body: body.body, base: url.origin })) });
    if (body.action === 'connect') {
      if (mailMode(env) === 'nylas') {
        const state = me.ws + '.' + me.member + '.' + (await hmac(env.SECRET_KEY || 'local-dev', 'mail:' + me.ws + ':' + me.member)).slice(0, 16);
        return json({ ok: true, url: connectUrl(env, url.origin, state, body.provider) });
      }
      await q(env, 'INSERT INTO mailboxes (ws, member, provider, address, status, connected_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(ws, member) DO UPDATE SET provider = excluded.provider, address = excluded.address, status = excluded.status, connected_at = excluded.connected_at',
        me.ws, me.member, 'sim', me.email, 'connected', Date.now()).run();
      return json({ ok: true, connected: true });
    }
    if (body.action === 'disconnect') { await q(env, 'DELETE FROM mailboxes WHERE ws = ? AND member = ?', me.ws, me.member).run(); return json({ ok: true }); }
    if (body.action === 'cap') { await q(env, 'UPDATE mailboxes SET daily_cap = ? WHERE ws = ? AND member = ?', Math.max(20, Math.min(2000, body.cap | 0)), me.ws, me.member).run(); return json({ ok: true }); }
    throw fail('Unknown action.');
  }
});
