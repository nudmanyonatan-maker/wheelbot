// GET    /api/leads/:id -> the lead with contacts, activity, open tasks, deals, sequences and files.
// GET    /api/leads/:id?export=1 -> everything held about this business, as a file (Quebec Law 25).
// PATCH  /api/leads/:id { ...fields, contacts, consent, dnc, status, owner } -> saves.
// DELETE /api/leads/:id -> erases the lead and everything on it (a person asking to be forgotten).
import { route, json, fail, q, all, one, isManager, SH, logEvent } from '../../../lib/server.js';
import { getLead, leadFields, leadStatements, assertSee } from '../../../lib/leads.js';
import { leadActivities, activityStmt, rowToTask, markLeadRead } from '../../../lib/activity.js';
import { rowToDeal } from '../../../lib/deals.js';
import { deleteFile } from '../../../lib/files.js';

export const { onRequestGet, onRequestPatch, onRequestDelete } = route({
  async get({ env, me, params, url }) {
    const lead = await getLead(env, me, params.id);
    assertSee(lead);
    const [acts, tasks, deals, enr, files] = await Promise.all([
      leadActivities(env, me, lead.id, { limit: url.searchParams.get('export') ? 2000 : 80 }),
      all(env, 'SELECT * FROM tasks WHERE ws = ? AND lead_id = ? AND done_at IS NULL ORDER BY due_at', me.ws, lead.id),
      all(env, 'SELECT * FROM deals WHERE ws = ? AND lead_id = ? AND deleted = 0 ORDER BY created_at DESC', me.ws, lead.id),
      all(env, 'SELECT e.*, s.name FROM enrollments e JOIN sequences s ON s.ws = e.ws AND s.id = e.seq_id WHERE e.ws = ? AND e.lead_id = ? ORDER BY e.created_at DESC', me.ws, lead.id),
      all(env, 'SELECT id, name, type, size, kind, at, deal_id FROM files WHERE ws = ? AND lead_id = ? ORDER BY at DESC', me.ws, lead.id)
    ]);
    const out = { lead, activities: acts, tasks: tasks.map(rowToTask), deals: deals.map(rowToDeal),
      sequences: enr.map((e) => ({ id: e.id, seqId: e.seq_id, name: e.name, step: e.step, status: e.status, nextAt: e.next_at })), files };
    if (url.searchParams.get('export')) {
      await logEvent(env, me, 'export', 'lead', lead.id, lead.name, null);
      return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="' + SH.normName(lead.name).slice(0, 40) + '-data.json"' } });
    }
    if (url.searchParams.get('read') !== '0') await markLeadRead(env, me, lead.id);
    return json({ ok: true, ...out });
  },
  async patch({ env, me, params, body }) {
    const lead = await getLead(env, me, params.id);
    assertSee(lead);
    if (body.owner !== undefined && !isManager(me)) delete body.owner;
    const f = leadFields(body, lead), now = Date.now(), st = [], changes = [];
    st.push(...leadStatements(env, me, lead.id, f, body.contacts !== undefined ? body.contacts : lead.contacts, { now }));
    if (body.status && body.status !== lead.status) { changes.push({ f: 'status', from: lead.status, to: body.status }); st.push(activityStmt(env, me.ws, { kind: 'status', leadId: lead.id, member: me.member, body: body.status, data: { from: lead.status } })); }
    if (body.owner !== undefined && body.owner !== lead.owner) changes.push({ f: 'owner', from: lead.owner, to: body.owner });
    if (body.consent && ['express', 'implied', 'none'].includes(body.consent.type)) {
      st.push(q(env, 'UPDATE leads SET consent = ?3, consent_source = ?4, consent_at = ?5 WHERE ws = ?1 AND id = ?2', me.ws, lead.id, body.consent.type,
        String(body.consent.source || '').slice(0, 200) || null, body.consent.type === 'none' ? null : now));
      st.push(activityStmt(env, me.ws, { kind: 'system', leadId: lead.id, member: me.member, body: body.consent.type === 'none' ? 'Consent removed.' : 'Consent recorded: ' + body.consent.type + (body.consent.source ? ', ' + body.consent.source : '') + '.' }));
      changes.push({ f: 'consent', from: lead.consent.type, to: body.consent.type });
    }
    for (const [k, col] of [['dnc', 'dnc'], ['smsOptOut', 'sms_opt_out'], ['emailOptOut', 'email_opt_out']]) {
      if (body[k] === undefined || !!body[k] === lead[k]) continue;
      st.push(q(env, 'UPDATE leads SET ' + col + ' = ? WHERE ws = ? AND id = ?', body[k] ? 1 : 0, me.ws, lead.id));
      changes.push({ f: k, from: lead[k], to: !!body[k] });
      if (k === 'dnc') {
        const phones = (body.contacts || lead.contacts || []).flatMap((c) => [c.phone, c.phone2]).map(SH.phoneKey).filter(Boolean);
        phones.forEach((p) => st.push(body.dnc ? q(env, 'INSERT OR IGNORE INTO dnc (ws, phone_key, reason, at) VALUES (?, ?, ?, ?)', me.ws, p, 'Marked on ' + lead.name, now) : q(env, 'DELETE FROM dnc WHERE ws = ? AND phone_key = ?', me.ws, p)));
        st.push(activityStmt(env, me.ws, { kind: 'system', leadId: lead.id, member: me.member, body: body.dnc ? 'Added to the do-not-call list.' : 'Taken off the do-not-call list.' }));
      }
    }
    await env.DB.batch(st);
    if (changes.length) await logEvent(env, me, 'update', 'lead', lead.id, f.name, changes);
    return json({ ok: true, lead: await getLead(env, me, lead.id) });
  },
  async delete({ env, me, params }) {
    if (!isManager(me)) throw fail('Only a manager can erase a lead.', 403);
    const lead = await getLead(env, me, params.id);
    assertSee(lead);
    const files = await all(env, 'SELECT r2_key FROM files WHERE ws = ? AND lead_id = ?', me.ws, lead.id);
    await env.DB.batch([
      q(env, 'DELETE FROM leads WHERE ws = ? AND id = ?', me.ws, lead.id), q(env, 'DELETE FROM contacts WHERE ws = ? AND lead_id = ?', me.ws, lead.id),
      q(env, 'DELETE FROM activities WHERE ws = ? AND lead_id = ?', me.ws, lead.id), q(env, 'DELETE FROM tasks WHERE ws = ? AND lead_id = ?', me.ws, lead.id),
      q(env, 'DELETE FROM deals WHERE ws = ? AND lead_id = ?', me.ws, lead.id), q(env, 'DELETE FROM enrollments WHERE ws = ? AND lead_id = ?', me.ws, lead.id),
      q(env, 'DELETE FROM files WHERE ws = ? AND lead_id = ?', me.ws, lead.id)
    ]);
    for (const f of files) await deleteFile(env, f.r2_key);
    await logEvent(env, me, 'erase', 'lead', lead.id, lead.name, null);
    return json({ ok: true });
  }
});
