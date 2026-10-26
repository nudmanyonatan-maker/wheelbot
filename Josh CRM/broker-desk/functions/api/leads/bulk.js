// POST /api/leads/bulk { ids | filter, action, value } -> changes many leads at once.
// action: assign (value: member or null), status (value: status id), list (value: list name), dnc, erase.
import { route, json, fail, q, isManager, logEvent } from '../../../lib/server.js';
import { leadIds } from '../../../lib/leads.js';

export const { onRequestPost } = route({
  async post({ env, me, body }) {
    const ids = Array.isArray(body.ids) && body.ids.length ? body.ids.filter((x) => typeof x === 'string').slice(0, 20000) : await leadIds(env, me, body.filter || {}, { max: 20000 });
    if (!ids.length) return json({ ok: true, changed: 0 });
    if ((body.action === 'assign' || body.action === 'erase') && !isManager(me)) throw fail('Only a manager can do that.', 403);
    const now = Date.now(), v = body.value == null ? null : String(body.value).slice(0, 80);
    const sql = { assign: 'owner = ?3', status: 'status = ?3', list: 'list_tag = ?3', dnc: 'dnc = 1, status = \'dnc\'', erase: 'deleted = 1' }[body.action];
    if (!sql) throw fail('Unknown action.');
    // Reps can only touch their own leads; the WHERE clause enforces it again.
    const own = isManager(me) ? '' : ' AND owner = ?5';
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = JSON.stringify(ids.slice(i, i + 400));
      const args = [me.ws, chunk, v, now, ...(isManager(me) ? [] : [me.member])];
      await q(env, 'UPDATE leads SET ' + sql + ', updated_at = ?4 WHERE ws = ?1 AND id IN (SELECT value FROM json_each(?2))' + own + (sql.includes('?3') ? '' : ' AND ?3 IS ?3'), ...args).run();
      if (body.action === 'dnc') await q(env, 'INSERT OR IGNORE INTO dnc (ws, phone_key, reason, at) SELECT ws, phone_key, \'Bulk do-not-call\', ?3 FROM leads WHERE ws = ?1 AND id IN (SELECT value FROM json_each(?2)) AND phone_key IS NOT NULL', me.ws, chunk, now).run();
    }
    await logEvent(env, me, 'bulk', 'lead', null, body.action + ' ' + ids.length + ' leads', [{ f: body.action, to: v }]);
    return json({ ok: true, changed: ids.length });
  }
});
