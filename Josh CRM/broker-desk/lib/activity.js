// Activities (calls, texts, emails, notes, system events), tasks, and the inbox built from both.
import { q, all, one, parse, newId, isManager } from './server.js';
import { touchStmt } from './leads.js';

export function rowToActivity(r) {
  if (!r) return null;
  const d = parse(r.data, {});
  return { id: r.id, leadId: r.lead_id, dealId: r.deal_id, kind: r.kind, dir: r.dir, member: r.member, at: r.at, status: r.status,
    duration: r.duration, outcome: r.outcome, subject: r.subject, body: r.body, other: r.other, via: r.via, unread: !!r.unread,
    handledAt: r.handled_at, costCents: r.cost_cents, data: d, leadName: r.lead_name };
}
// One insert. a: { kind, dir, leadId, dealId, member, at, status, duration, outcome, subject, body, other, via, providerId, threadKey, unread, data }
export function activityStmt(env, ws, a) {
  const id = a.id || newId('ac');
  a.id = id;
  return q(env, `INSERT INTO activities (ws, id, lead_id, deal_id, kind, dir, member, at, status, duration, outcome, subject, body, other, via, provider_id,
    thread_key, unread, cost_cents, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ws, id, a.leadId || null, a.dealId || null, a.kind, a.dir || null, a.member || null, a.at || Date.now(), a.status || null, a.duration ?? null,
    a.outcome || null, a.subject ? String(a.subject).slice(0, 300) : null, a.body != null ? String(a.body).slice(0, 20000) : null, a.other || null, a.via || null,
    a.providerId || null, a.threadKey || null, a.unread ? 1 : 0, a.costCents ?? null, JSON.stringify(a.data || {}));
}
export async function addActivity(env, ws, a, { touch = false, call = false } = {}) {
  const st = [activityStmt(env, ws, a)];
  if (touch && a.leadId) st.push(touchStmt(env, ws, a.leadId, { at: a.at || Date.now(), call }));
  await env.DB.batch(st);
  return a.id;
}
export async function leadActivities(env, me, leadId, { before, limit = 60 } = {}) {
  const rows = await all(env, 'SELECT * FROM activities WHERE ws = ? AND lead_id = ? AND at <= ? AND at < ? ORDER BY at DESC LIMIT ?',
    me.ws, leadId, Date.now() + 1000, before || 9e15, Math.min(200, limit));
  return rows.map(rowToActivity);
}

// ---------- tasks ----------
export function rowToTask(r) {
  return r && { id: r.id, leadId: r.lead_id, dealId: r.deal_id, member: r.member, dueAt: r.due_at, note: r.note, kind: r.kind, doneAt: r.done_at, createdAt: r.created_at, leadName: r.lead_name };
}
export async function refreshNextTask(env, ws, leadId) {
  if (!leadId) return;
  await q(env, 'UPDATE leads SET next_task_at = (SELECT MIN(due_at) FROM tasks WHERE ws = ?1 AND lead_id = ?2 AND done_at IS NULL) WHERE ws = ?1 AND id = ?2', ws, leadId).run();
}

// ---------- inbox ----------
// Everything waiting on this person: missed calls and voicemails, texts and emails they have not
// handled, new applications, lender replies, and tasks due by the end of today. Managers can ask
// for the whole team. Items dated in the future (a reply the demo line will deliver later) stay
// hidden until their time comes.
export async function inbox(env, me, { team = false } = {}) {
  const now = Date.now(), end = { getTime: () => (me.day0 || now) + 864e5 - 1 };
  const whoAct = team && isManager(me) ? '' : ' AND (a.member = ?3 OR a.member IS NULL OR l.owner = ?3)';
  const whoTask = team && isManager(me) ? '' : ' AND t.member = ?3';
  const [acts, tasks] = await env.DB.batch([
    env.DB.prepare(`SELECT a.*, l.name AS lead_name FROM activities a LEFT JOIN leads l ON l.ws = a.ws AND l.id = a.lead_id
      WHERE a.ws = ?1 AND a.unread = 1 AND a.at <= ?2${whoAct} ORDER BY a.at DESC LIMIT 300`).bind(...(whoAct ? [me.ws, now, me.member] : [me.ws, now])),
    env.DB.prepare(`SELECT t.*, l.name AS lead_name FROM tasks t LEFT JOIN leads l ON l.ws = t.ws AND l.id = t.lead_id
      WHERE t.ws = ?1 AND t.done_at IS NULL AND t.due_at <= ?2${whoTask} ORDER BY t.due_at ASC LIMIT 300`).bind(...(whoTask ? [me.ws, end.getTime(), me.member] : [me.ws, end.getTime()]))
  ]);
  return { activities: (acts.results || []).map(rowToActivity), tasks: (tasks.results || []).map(rowToTask), now };
}
export async function inboxCount(env, me) {
  const end = { getTime: () => (me.day0 || Date.now()) + 864e5 - 1 };
  const [a, t] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM activities a LEFT JOIN leads l ON l.ws = a.ws AND l.id = a.lead_id WHERE a.ws = ?1 AND a.unread = 1 AND a.at <= ?2
      AND (a.member = ?3 OR a.member IS NULL OR l.owner = ?3)`).bind(me.ws, Date.now(), me.member),
    env.DB.prepare('SELECT COUNT(*) AS n FROM tasks WHERE ws = ?1 AND done_at IS NULL AND due_at <= ?2 AND member = ?3').bind(me.ws, end.getTime(), me.member)
  ]);
  return (a.results[0].n || 0) + (t.results[0].n || 0);
}
export async function markHandled(env, me, ids) {
  ids = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string').slice(0, 500);
  if (!ids.length) return 0;
  const r = await q(env, 'UPDATE activities SET unread = 0, handled_at = ?3 WHERE ws = ?1 AND id IN (SELECT value FROM json_each(?2))', me.ws, JSON.stringify(ids), Date.now()).run();
  return r.meta ? r.meta.changes : 0;
}
// Reading a lead marks its inbound texts, emails and missed calls as handled for that person.
export async function markLeadRead(env, me, leadId) {
  await q(env, "UPDATE activities SET unread = 0, handled_at = ?3 WHERE ws = ?1 AND lead_id = ?2 AND unread = 1 AND at <= ?3 AND kind IN ('sms', 'email', 'call')", me.ws, leadId, Date.now()).run();
}
export async function activityById(env, ws, id) { return rowToActivity(await one(env, 'SELECT * FROM activities WHERE ws = ? AND id = ?', ws, id)); }
