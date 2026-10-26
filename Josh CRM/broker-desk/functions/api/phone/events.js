// GET /api/phone/events -> calls ringing for this person right now, and texts that just came in.
// The browser asks every few seconds. On Twilio, ringing calls also arrive through the Voice SDK.
import { route, json, all } from '../../../lib/server.js';
import { rowToActivity } from '../../../lib/activity.js';
export const { onRequestGet } = route({
  async get({ env, me, url }) {
    const since = Math.max(Date.now() - 120000, +url.searchParams.get('since') || 0), now = Date.now();
    const rows = await all(env, `SELECT a.*, l.name AS lead_name FROM activities a LEFT JOIN leads l ON l.ws = a.ws AND l.id = a.lead_id
      WHERE a.ws = ?1 AND a.dir = 'in' AND a.at > ?2 AND a.at <= ?3 AND (a.member = ?4 OR a.member IS NULL) AND a.kind IN ('call', 'sms', 'email') ORDER BY a.at`, me.ws, since, now, me.member);
    return json({ ok: true, now, events: rows.map(rowToActivity) });
  }
});
