// GET /api/audit?rec=<id> -> the change log, newest first (managers), or one record's history.
import { route, json, fail, isManager, all } from '../../lib/server.js';
export const { onRequestGet } = route({
  async get({ env, me, url }) {
    if (!isManager(me)) throw fail('Only a manager can see the change log.', 403);
    const rec = url.searchParams.get('rec');
    const rows = rec ? await all(env, 'SELECT * FROM audit WHERE ws = ? AND rec_id = ? ORDER BY id DESC LIMIT 200', me.ws, rec)
      : await all(env, 'SELECT * FROM audit WHERE ws = ? ORDER BY id DESC LIMIT 300', me.ws);
    return json({ ok: true, rows: rows.map((r) => ({ at: r.at, who: r.who, action: r.action, kind: r.kind, recId: r.rec_id, label: r.label, changes: r.changes ? JSON.parse(r.changes) : null })) });
  }
});
