// GET   /api/tasks?scope=mine|team&days=7 -> open tasks due within the next days (and overdue).
// POST  /api/tasks { leadId, dueAt, note } -> new task.
// PATCH /api/tasks { id, done: true } | { id, dueAt } -> finish or move.
import { route, json, fail, q, all, one, newId, isManager } from '../../lib/server.js';
import { canSeeLead, assertSee } from '../../lib/leads.js';
import { rowToTask, refreshNextTask, activityStmt } from '../../lib/activity.js';

export const { onRequestGet, onRequestPost, onRequestPatch } = route({
  async get({ env, me, url }) {
    const days = Math.min(60, +url.searchParams.get('days') || 7), team = url.searchParams.get('scope') === 'team' && isManager(me);
    const rows = await all(env, `SELECT t.*, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.ws = t.ws AND l.id = t.lead_id WHERE t.ws = ?1 AND t.done_at IS NULL AND t.due_at <= ?2 ${team ? '' : 'AND t.member = ?3'} ORDER BY t.due_at LIMIT 500`,
      me.ws, Date.now() + days * 864e5, ...(team ? [] : [me.member]));
    return json({ ok: true, tasks: rows.map(rowToTask) });
  },
  async post({ env, me, body }) {
    if (body.leadId) assertSee(await canSeeLead(env, me, String(body.leadId)));
    const due = +body.dueAt; if (!(due > 0)) throw fail('Pick when.');
    const id = newId('tk'), member = isManager(me) && body.member ? String(body.member) : me.member;
    await q(env, 'INSERT INTO tasks (ws, id, lead_id, deal_id, member, due_at, note, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      me.ws, id, body.leadId || null, body.dealId || null, member, due, String(body.note || '').slice(0, 300) || null, ['call', 'email', 'follow-up'].includes(body.kind) ? body.kind : 'follow-up', Date.now()).run();
    await refreshNextTask(env, me.ws, body.leadId);
    return json({ ok: true, id });
  },
  async patch({ env, me, body }) {
    const t = await one(env, 'SELECT * FROM tasks WHERE ws = ? AND id = ?', me.ws, String(body.id || ''));
    if (!t || (t.member !== me.member && !isManager(me))) throw fail('That task is gone.', 404);
    const st = [];
    if (body.done) {
      st.push(q(env, 'UPDATE tasks SET done_at = ? WHERE ws = ? AND id = ?', Date.now(), me.ws, t.id));
      if (t.lead_id) st.push(activityStmt(env, me.ws, { kind: 'system', leadId: t.lead_id, member: me.member, body: 'Task done' + (t.note ? ': ' + t.note : '') + '.' }));
    } else if (+body.dueAt > 0) st.push(q(env, 'UPDATE tasks SET due_at = ? WHERE ws = ? AND id = ?', +body.dueAt, me.ws, t.id));
    else if (body.note !== undefined) st.push(q(env, 'UPDATE tasks SET note = ? WHERE ws = ? AND id = ?', String(body.note || '').slice(0, 300), me.ws, t.id));
    if (st.length) await env.DB.batch(st);
    await refreshNextTask(env, me.ws, t.lead_id);
    return json({ ok: true });
  }
});
