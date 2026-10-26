// Sequences: a list of steps (an email, a text or a task, each after a wait in days). Leads are
// enrolled from a list; the minute tick sends whatever is due. Any reply stops the sequence for that
// lead, and so does an unsubscribe or a STOP. A bulk email is a one-step sequence sent right away.
import { SH, q, all, one, parse, newId, fail } from './server.js';
import { leadIds } from './leads.js';
import { sendEmail } from './mail.js';
import { sendText, leadRow } from './phone.js';
import { activityStmt } from './activity.js';
import { fill } from './compliance.js';

const DAYMS = SH.DAY;
export function cleanSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 12).map((s, i) => ({
    id: /^[A-Za-z0-9_-]{1,30}$/.test(s && s.id || '') ? s.id : 's' + i, wait: Math.max(0, Math.min(90, +(s && s.wait) || 0)),
    kind: ['email', 'sms', 'task'].includes(s && s.kind) ? s.kind : 'email', subject: String(s && s.subject || '').slice(0, 300), body: String(s && s.body || '').slice(0, 8000)
  }));
}
export function rowToSeq(r, counts) {
  return { id: r.id, name: r.name, active: !!r.active, steps: parse(r.steps, []), createdAt: r.created_at, updatedAt: r.updated_at, oneOff: r.name.startsWith('Bulk email:'), counts: counts || {} };
}
export async function enroll(env, me, seqId, { ids, filter }) {
  const seq = await one(env, 'SELECT * FROM sequences WHERE ws = ? AND id = ?', me.ws, seqId);
  if (!seq) throw fail('That sequence is gone.', 404);
  const steps = parse(seq.steps, []);
  if (!steps.length) throw fail('Add a step to the sequence first.');
  const kind = steps[0].kind;
  // Only leads with CASL consent join, and only ones the first step can reach.
  const base = Array.isArray(ids) && ids.length ? { ids: ids.slice(0, 5000) } : (filter || {});
  let list = await leadIds(env, me, { ...base, ...(kind === 'task' ? {} : { consent: 'ok' }), ...(kind === 'email' ? { hasEmail: true } : kind === 'sms' ? { callable: true } : {}) }, { max: 5000 });
  const already = new Set((await all(env, "SELECT lead_id FROM enrollments WHERE ws = ? AND seq_id = ? AND status = 'active'", me.ws, seqId)).map((r) => r.lead_id));
  list = list.filter((id) => !already.has(id));
  const now = Date.now(), first = now + steps[0].wait * DAYMS;
  for (let i = 0; i < list.length; i += 80) {
    await env.DB.batch(list.slice(i, i + 80).map((leadId, j) => q(env, 'INSERT INTO enrollments (ws, id, seq_id, lead_id, member, step, next_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
      me.ws, newId('en'), seqId, leadId, me.member, first + (i + j) * 2000, 'active', now, now)));
  }
  return { enrolled: list.length, skipped: already.size };
}

// Sends what is due. Called every minute by the cron worker, and by the app while someone is on the
// inbox, so the demo works without a worker. Sends are spread out (a few seconds apart, set at
// enrollment) so a bulk email never leaves as one burst.
export async function tick(env, { ws, base, limit = 40 } = {}) {
  const now = Date.now();
  const due = ws
    ? await all(env, "SELECT * FROM enrollments WHERE ws = ? AND status = 'active' AND next_at <= ? ORDER BY next_at LIMIT ?", ws, now, limit)
    : await all(env, "SELECT * FROM enrollments WHERE status = 'active' AND next_at <= ? ORDER BY next_at LIMIT ?", now, limit);
  let sent = 0;
  const seqs = {};
  for (const e of due) {
    const seq = seqs[e.seq_id] || (seqs[e.seq_id] = await one(env, 'SELECT * FROM sequences WHERE ws = ? AND id = ?', e.ws, e.seq_id));
    if (!seq || !seq.active) { await q(env, "UPDATE enrollments SET status = 'stopped', updated_at = ? WHERE ws = ? AND id = ?", now, e.ws, e.id).run(); continue; }
    const steps = parse(seq.steps, []), step = steps[e.step];
    if (!step) { await q(env, "UPDATE enrollments SET status = 'done', updated_at = ? WHERE ws = ? AND id = ?", now, e.ws, e.id).run(); continue; }
    const lead = await leadRow(env, e.ws, e.lead_id);
    const user = await one(env, 'SELECT name, member FROM users WHERE ws = ? AND member = ?', e.ws, e.member);
    const me = { ws: e.ws, member: e.member, name: user ? user.name : 'Sequence', system: true };
    if (!lead) { await q(env, "UPDATE enrollments SET status = 'stopped', updated_at = ? WHERE ws = ? AND id = ?", now, e.ws, e.id).run(); continue; }
    const vars = { first: String(lead.contactName || '').split(' ')[0], business: lead.name, rep: me.name.split(' ')[0] };
    let ok = true, why = '';
    try {
      if (step.kind === 'email') await sendEmail(env, me, { leadId: lead.id, subject: fill(step.subject, vars), body: fill(step.body, vars), bulk: true, base, seqId: seq.id });
      else if (step.kind === 'sms') {
        const w = SH.callingWindow(lead, { weekday: ['09:00', '21:00'], weekend: ['10:00', '18:00'] });
        if (!w.ok) { await q(env, 'UPDATE enrollments SET next_at = ? WHERE ws = ? AND id = ?', now + 30 * 60000, e.ws, e.id).run(); continue; }
        await sendText(env, me, { leadId: lead.id, body: fill(step.body, vars), bulk: true, base });
      } else {
        await env.DB.batch([q(env, 'INSERT INTO tasks (ws, id, lead_id, member, due_at, note, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          e.ws, newId('tk'), lead.id, e.member, now, fill(step.body || 'Follow up', vars).slice(0, 300), 'follow-up', now)]);
      }
      sent++;
    } catch (err) { ok = false; why = err && err.message || 'Could not send'; }
    if (!ok) {
      await env.DB.batch([
        q(env, "UPDATE enrollments SET status = 'stopped', updated_at = ? WHERE ws = ? AND id = ?", now, e.ws, e.id),
        activityStmt(env, e.ws, { kind: 'system', leadId: lead.id, body: 'Left the "' + seq.name + '" sequence: ' + why })
      ]);
      continue;
    }
    const next = steps[e.step + 1];
    await q(env, 'UPDATE enrollments SET step = ?, next_at = ?, status = ?, updated_at = ? WHERE ws = ? AND id = ?',
      e.step + 1, next ? now + next.wait * DAYMS : null, next ? 'active' : 'done', now, e.ws, e.id).run();
  }
  return { due: due.length, sent };
}
export async function seqCounts(env, ws) {
  const rows = await all(env, 'SELECT seq_id, status, COUNT(*) AS n FROM enrollments WHERE ws = ? GROUP BY seq_id, status', ws);
  const out = {}; rows.forEach((r) => { (out[r.seq_id] = out[r.seq_id] || {})[r.status] = r.n; });
  return out;
}
