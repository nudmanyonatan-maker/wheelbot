// The power and multi-line dialer. A session works down a saved list: each round dials as many
// leads as the rep picked (1 to 5). The first person to pick up is put through to the rep; the other
// lines hang up. If two people answer at once, the second hears a short message and that call counts
// as abandoned. The guard in compliance.js keeps abandoned calls under the monthly cap by lowering
// the line count.
import { SH, q, one, all, parse, newId, fail } from './server.js';
import { leadIds, rowToLead } from './leads.js';
import { activityStmt } from './activity.js';
import { phoneAccount, canSpend, myNumber, chargeStmts, callCost, carrierOf } from './carrier/index.js';
import { rules, abandonState, countStmt, callCheck } from './compliance.js';
import { getSetting } from './server.js';

export async function startSession(env, me, { listId, filter, title, lines }) {
  const r = await rules(env, me.ws), guard = await abandonState(env, me.ws, r);
  let f = filter;
  if (listId) {
    const lists = await getSetting(env, me.ws, 'lists', []);
    const l = lists.find((x) => x.id === listId);
    if (!l) throw fail('That list is gone.', 404);
    f = l.filter; title = title || l.name;
  }
  const ids = await leadIds(env, me, { ...(f || {}), callable: true }, { sort: 'calls', max: 5000 });
  if (!ids.length) throw fail('Nobody on this list can be called: no numbers, or all on do-not-call.', 409);
  const acct = await phoneAccount(env, me.ws);
  const spend = await canSpend(env, acct);
  if (!spend.ok) throw fail(spend.why, 402);
  if (!(await myNumber(env, me.ws, me.member))) throw fail('Get a phone number first: Settings, Phone, Buy a number.', 409);
  const want = Math.max(1, Math.min(5, lines | 0 || 1)), n = Math.min(want, guard.maxLines);
  const id = newId('ds'), now = Date.now();
  await q(env, 'INSERT INTO dial_sessions (ws, id, member, list_id, title, lines, status, started_at, queue, stats) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    me.ws, id, me.member, listId || null, String(title || 'Dial session').slice(0, 80), n, 'active', now, JSON.stringify(ids), JSON.stringify({ total: ids.length, dialed: 0, answered: 0, connected: 0, voicemail: 0, noAnswer: 0, abandoned: 0, skipped: 0, talk: 0 })).run();
  return { id, lines: n, asked: want, capped: n < want, guard, total: ids.length, title };
}
export async function getSession(env, me, id) {
  const s = await one(env, 'SELECT * FROM dial_sessions WHERE ws = ? AND id = ? AND member = ?', me.ws, id, me.member);
  if (!s) throw fail('That dial session is over.', 404);
  return { ...s, queue: parse(s.queue, []), stats: parse(s.stats, {}) };
}
// The next round: up to `n` leads that can be called right now. Leads outside calling hours go to
// the back of the queue for later in the session, and are skipped once they come round again.
export async function nextRound(env, me, sessionId, n, base) {
  const s = await getSession(env, me, sessionId);
  if (s.status !== 'active') throw fail('This session has ended.', 409);
  const r = await rules(env, me.ws), guard = await abandonState(env, me.ws, r);
  const lines = Math.max(1, Math.min(s.lines, guard.maxLines, n | 0 || s.lines));
  const num = await myNumber(env, me.ws, me.member), acct = await phoneAccount(env, me.ws, { create: false });
  const spend = await canSpend(env, acct);
  if (!spend.ok) throw fail(spend.why, 402);
  const out = [], later = [], queue = s.queue.slice(), seenLater = new Set(s.stats.laterIds || []);
  let skipped = 0;
  while (out.length < lines && queue.length) {
    const id = queue.shift();
    const row = await one(env, 'SELECT * FROM leads WHERE ws = ? AND id = ? AND deleted = 0', me.ws, id);
    if (!row) { skipped++; continue; }
    const lead = rowToLead(row);
    const chk = await callCheck(env, me.ws, lead, lead.phone, r);
    if (!chk.ok) {
      if (chk.hours && !seenLater.has(id)) { seenLater.add(id); later.push(id); } else skipped++;
      continue;
    }
    const a = { kind: 'call', dir: 'out', leadId: id, member: me.member, status: 'ringing', other: SH.e164(lead.phone), via: num.e164,
      data: { sessionId, lines, record: !!r.recording, provider: acct.provider } };
    const st = [activityStmt(env, me.ws, a)];
    // On the real line the server places each leg; Twilio calls /api/phone/dialer-leg when one is answered.
    if (acct.provider === 'twilio') {
      const enc = encodeURIComponent, w = 'ws=' + enc(me.ws);
      const leg = await carrierOf(acct).placeCall(env, acct, { from: num.e164, to: SH.e164(lead.phone), url: base + '/api/phone/dialer-leg?' + w + '&session=' + enc(sessionId) + '&act=' + a.id,
        statusUrl: base + '/api/phone/status?' + w + '&act=' + a.id });
      st.push(q(env, 'INSERT INTO dial_legs (ws, sid, session_id, lead_id, activity_id, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)', me.ws, leg.sid, sessionId, id, a.id, 'ringing', Date.now()));
      st.push(q(env, 'UPDATE activities SET provider_id = ? WHERE ws = ? AND id = ?', leg.sid, me.ws, a.id));
    }
    await env.DB.batch(st);
    out.push({ activityId: a.id, lead: { id, name: lead.name, contactName: lead.contactName, phone: lead.phone, province: lead.province, city: lead.city, status: lead.status, industry: lead.industry, monthlyRevenue: lead.monthlyRevenue, requested: lead.requested, calls: lead.calls, notes: lead.notes || '', demoAnswer: (lead.custom || {}).demoAnswer || null, demoRing: +(lead.custom || {}).demoRing || null } });
  }
  const stats = { ...s.stats, dialed: (s.stats.dialed || 0) + out.length, skipped: (s.stats.skipped || 0) + skipped, laterIds: Array.from(seenLater) };
  const status = !out.length && !queue.length && !later.length ? 'done' : 'active';
  await env.DB.batch([
    q(env, 'UPDATE dial_sessions SET queue = ?, stats = ?, status = ?, ended_at = ? WHERE ws = ? AND id = ?', JSON.stringify(queue.concat(later)), JSON.stringify(stats), status, status === 'done' ? Date.now() : null, me.ws, sessionId),
    ...(out.length ? [countStmt(env, me.ws, { placed: lines > 1 ? out.length : 0 })] : [])
  ]);
  return { calls: out, lines, left: queue.length + later.length, guard, status, from: num.e164, provider: acct.provider };
}
// One line's result on the demo line (the real carrier reports through /api/phone/dialer-leg).
// result: no-answer, busy, voicemail, connected, abandoned, failed.
export async function legResult(env, me, sessionId, activityId, { result, duration = 0, voicemailDropped = false, note, outcome, leadStatus }) {
  const s = await getSession(env, me, sessionId);
  const row = await one(env, 'SELECT * FROM activities WHERE ws = ? AND id = ? AND kind = ?', me.ws, activityId, 'call');
  if (!row) throw fail('That call is not on file.', 404);
  const data = parse(row.data, {});
  if (data.sessionId !== sessionId) throw fail('That call is from another session.', 409);
  const acct = await phoneAccount(env, me.ws, { create: false });
  const status = { 'no-answer': 'no-answer', busy: 'busy', voicemail: 'voicemail', connected: 'completed', abandoned: 'abandoned', failed: 'failed' }[result] || 'completed';
  const first = !data.settled;
  duration = Math.max(0, Math.min(4 * 3600, duration | 0));
  const st = [q(env, 'UPDATE activities SET status = ?3, duration = ?4, outcome = COALESCE(?5, outcome), body = COALESCE(?6, body), data = ?7 WHERE ws = ?1 AND id = ?2',
    me.ws, activityId, status, duration, outcome || null, note != null ? String(note).slice(0, 4000) : null, JSON.stringify({ ...data, settled: true, voicemailDropped: voicemailDropped || !!data.voicemailDropped, answeredBy: result === 'voicemail' ? 'machine' : ['connected', 'abandoned'].includes(result) ? 'human' : data.answeredBy || null }))];
  if (first) {
    st.push(q(env, 'UPDATE leads SET last_contact_at = MAX(COALESCE(last_contact_at, 0), ?3), last_call_at = ?3, calls = calls + 1 WHERE ws = ?1 AND id = ?2', me.ws, row.lead_id, row.at));
    const k = { 'no-answer': 'noAnswer', busy: 'noAnswer', voicemail: 'voicemail', connected: 'connected', abandoned: 'abandoned', failed: 'noAnswer' }[result];
    const stats = { ...s.stats, [k]: (s.stats[k] || 0) + 1, answered: (s.stats.answered || 0) + (['connected', 'abandoned'].includes(result) ? 1 : 0), talk: (s.stats.talk || 0) + (result === 'connected' ? duration : 0) };
    st.push(q(env, 'UPDATE dial_sessions SET stats = ? WHERE ws = ? AND id = ?', JSON.stringify(stats), me.ws, sessionId));
    if (data.lines > 1) st.push(countStmt(env, me.ws, { answered: ['connected', 'abandoned'].includes(result) ? 1 : 0, abandoned: result === 'abandoned' ? 1 : 0 }));
    if (acct && acct.provider === 'sim') {
      const cents = callCost(acct, duration, { amd: data.lines > 1, recorded: data.record && result === 'connected' });
      st.push(q(env, 'UPDATE activities SET cost_cents = ? WHERE ws = ? AND id = ?', cents, me.ws, activityId));
      st.push(...chargeStmts(env, acct, 'call', cents, activityId, 'Dialer call to ' + SH.fmtPhone(row.other)));
    }
  } else if (result === 'connected' && (note || outcome)) {
    // Notes after the call: nothing else to count.
  }
  if (leadStatus) st.push(q(env, 'UPDATE leads SET status = ?, updated_at = ? WHERE ws = ? AND id = ?', String(leadStatus).slice(0, 40), Date.now(), me.ws, row.lead_id));
  // A line the rep gave up on (they left the dialer, or someone else answered first) stops ringing.
  if (acct && acct.provider === 'twilio' && result === 'no-answer' && first) {
    const leg = await one(env, "SELECT sid FROM dial_legs WHERE ws = ? AND activity_id = ? AND status = 'ringing'", me.ws, activityId);
    if (leg) { try { await carrierOf(acct).updateCall(env, acct, leg.sid, { status: 'canceled' }); } catch { /* already answered or over */ } }
  }
  if (acct && acct.provider === 'twilio' && result === 'connected') {
    const leg = await one(env, 'SELECT sid FROM dial_legs WHERE ws = ? AND activity_id = ?', me.ws, activityId);
    if (leg) { try { await carrierOf(acct).updateCall(env, acct, leg.sid, { status: 'completed' }); } catch { /* already over */ } st.push(q(env, "UPDATE dial_legs SET status = 'done' WHERE ws = ? AND sid = ?", me.ws, leg.sid)); }
  }
  await env.DB.batch(st);
  return { ok: true };
}
export async function endSession(env, me, sessionId) {
  const s = await getSession(env, me, sessionId);
  await q(env, "UPDATE dial_sessions SET status = 'done', ended_at = ? WHERE ws = ? AND id = ?", Date.now(), me.ws, sessionId).run();
  return { ...s.stats, total: s.stats.total, left: s.queue.length };
}

// Where each leg of the current round stands, for the real line (the browser asks every second).
export async function legStates(env, me, sessionId, ids) {
  const rows = await all(env, 'SELECT id, status, duration, data FROM activities WHERE ws = ? AND id IN (SELECT value FROM json_each(?))', me.ws, JSON.stringify((ids || []).slice(0, 10)));
  return rows.map((r) => { const d = parse(r.data, {}); return { id: r.id, status: r.status, duration: r.duration, answeredBy: d.answeredBy || null, voicemailDropped: !!d.voicemailDropped }; });
}
