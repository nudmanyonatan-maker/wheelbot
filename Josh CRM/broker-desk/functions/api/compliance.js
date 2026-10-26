// GET  /api/compliance -> the do-not-call list, the email unsubscribe list and the dialer guard.
// POST /api/compliance { action: 'dnc-add', numbers: [...], reason } | { action: 'dnc-remove', phone }
import { route, json, fail, q, all, isManager, SH, logEvent } from '../../lib/server.js';
import { abandonState } from '../../lib/compliance.js';
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) {
    const [dnc, sup] = await Promise.all([all(env, 'SELECT phone_key, reason, at FROM dnc WHERE ws = ? ORDER BY at DESC LIMIT 500', me.ws), all(env, 'SELECT email_lc, reason, at FROM suppress WHERE ws = ? ORDER BY at DESC LIMIT 500', me.ws)]);
    const counts = await all(env, 'SELECT (SELECT COUNT(*) FROM dnc WHERE ws = ?1) AS dnc, (SELECT COUNT(*) FROM suppress WHERE ws = ?1) AS sup', me.ws);
    return json({ ok: true, dnc: dnc.map((d) => ({ phone: SH.fmtPhone(d.phone_key), reason: d.reason, at: d.at })), suppress: sup.map((s) => ({ email: s.email_lc, reason: s.reason, at: s.at })),
      counts: counts[0], guard: await abandonState(env, me.ws) });
  },
  async post({ env, me, body }) {
    if (body.action === 'dnc-add') {
      const keys = [...new Set((Array.isArray(body.numbers) ? body.numbers : String(body.numbers || '').split(/[\n,;]+/)).map(SH.phoneKey).filter(Boolean))].slice(0, 5000);
      if (!keys.length) throw fail('No phone numbers found.');
      const now = Date.now(), reason = String(body.reason || 'Added by ' + me.name).slice(0, 120);
      for (let i = 0; i < keys.length; i += 100) await env.DB.batch(keys.slice(i, i + 100).map((k) => q(env, 'INSERT OR IGNORE INTO dnc (ws, phone_key, reason, at) VALUES (?, ?, ?, ?)', me.ws, k, reason, now)));
      await q(env, 'UPDATE leads SET dnc = 1 WHERE ws = ? AND phone_key IN (SELECT value FROM json_each(?))', me.ws, JSON.stringify(keys)).run();
      await logEvent(env, me, 'dnc', null, null, keys.length + ' numbers added', null);
      return json({ ok: true, added: keys.length });
    }
    if (body.action === 'dnc-remove') {
      if (!isManager(me)) throw fail('Only a manager can take a number off the list.', 403);
      const k = SH.phoneKey(body.phone); if (!k) throw fail('Pick a number.');
      await env.DB.batch([q(env, 'DELETE FROM dnc WHERE ws = ? AND phone_key = ?', me.ws, k), q(env, 'UPDATE leads SET dnc = 0 WHERE ws = ? AND phone_key = ?', me.ws, k)]);
      await logEvent(env, me, 'dnc', null, null, 'Removed ' + SH.fmtPhone(k), null);
      return json({ ok: true });
    }
    throw fail('Unknown action.');
  }
});
