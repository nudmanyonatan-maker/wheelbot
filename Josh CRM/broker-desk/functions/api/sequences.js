// GET  /api/sequences -> sequences with how many leads are in each, by status.
// POST /api/sequences { action: 'save', id?, name, steps, active }
// POST /api/sequences { action: 'enroll', id, ids | listId | filter }
// POST /api/sequences { action: 'bulk', subject, body, ids | listId | filter } -> a one-off bulk email.
// POST /api/sequences { action: 'stop', enrollmentId } | { action: 'delete', id }
import { route, json, fail, q, all, one, newId, isManager, getSetting } from '../../lib/server.js';
import { cleanSteps, rowToSeq, enroll, seqCounts } from '../../lib/sequences.js';
async function filterOf(env, me, b) {
  if (b.listId) { const l = (await getSetting(env, me.ws, 'lists', [])).find((x) => x.id === b.listId) || (await import('../../lib/defaults.js')).DEFAULT_LISTS.find((x) => x.id === b.listId); if (!l) throw fail('That list is gone.'); return l.filter; }
  return b.filter || {};
}
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) {
    const counts = await seqCounts(env, me.ws);
    const rows = await all(env, 'SELECT * FROM sequences WHERE ws = ? ORDER BY updated_at DESC', me.ws);
    return json({ ok: true, sequences: rows.map((r) => rowToSeq(r, counts[r.id])) });
  },
  async post({ env, me, body }) {
    const now = Date.now();
    if (body.action === 'save') {
      const name = String(body.name || '').trim().slice(0, 100); if (!name) throw fail('Name the sequence.');
      const steps = cleanSteps(body.steps); if (!steps.length) throw fail('Add at least one step.');
      const id = body.id && /^[A-Za-z0-9_-]{1,80}$/.test(body.id) ? body.id : newId('sq');
      await q(env, 'INSERT INTO sequences (ws, id, name, active, steps, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(ws, id) DO UPDATE SET name = excluded.name, active = excluded.active, steps = excluded.steps, updated_at = excluded.updated_at',
        me.ws, id, name, body.active === false ? 0 : 1, JSON.stringify(steps), now).run();
      return json({ ok: true, id });
    }
    if (body.action === 'enroll') return json({ ok: true, ...(await enroll(env, me, String(body.id || ''), { ids: body.ids, filter: await filterOf(env, me, body) })) });
    if (body.action === 'bulk') {
      const subject = String(body.subject || '').trim(), text = String(body.body || '').trim();
      if (!subject || !text) throw fail('Write a subject and a message.');
      const id = newId('sq');
      await q(env, 'INSERT INTO sequences (ws, id, name, active, steps, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)', me.ws, id, ('Bulk email: ' + subject).slice(0, 100),
        JSON.stringify(cleanSteps([{ wait: 0, kind: 'email', subject, body: text }])), now, now).run();
      const res = await enroll(env, me, id, { ids: body.ids, filter: await filterOf(env, me, body) });
      if (!res.enrolled) { await q(env, 'DELETE FROM sequences WHERE ws = ? AND id = ?', me.ws, id).run(); return json({ ok: true, id: null, ...res }); }
      return json({ ok: true, id, ...res });
    }
    if (body.action === 'stop') { await q(env, "UPDATE enrollments SET status = 'stopped', updated_at = ? WHERE ws = ? AND id = ?", now, me.ws, String(body.enrollmentId || '')).run(); return json({ ok: true }); }
    if (body.action === 'delete') {
      if (!isManager(me)) throw fail('Only a manager can delete a sequence.', 403);
      await env.DB.batch([q(env, 'DELETE FROM sequences WHERE ws = ? AND id = ?', me.ws, body.id), q(env, "UPDATE enrollments SET status = 'stopped' WHERE ws = ? AND seq_id = ? AND status = 'active'", me.ws, body.id)]);
      return json({ ok: true });
    }
    throw fail('Unknown action.');
  }
});
