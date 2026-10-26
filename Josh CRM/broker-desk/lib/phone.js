// Calls and texts: starting and finishing a call, sending a text, and taking inbound calls and
// texts from the carrier. Every path checks the contact rules and the wallet, logs an activity on
// the lead, and charges usage.
import { SH, q, one, all, newId, fail, isManager } from './server.js';
import { phoneAccount, carrierOf, myNumber, canSpend, chargeStmts, callCost, smsCost, regStatus, numberByE164 } from './carrier/index.js';
import { getLead, leadByPhone, touchStmt, rowToLead } from './leads.js';
import { activityStmt, rowToActivity } from './activity.js';
import { rules, callCheck, textCheck, fill } from './compliance.js';

export async function leadRow(env, ws, id) { return rowToLead(await one(env, 'SELECT * FROM leads WHERE ws = ? AND id = ? AND deleted = 0', ws, id)); }

// ---------- calls ----------
// Logs the call as ringing and hands back what the browser needs to place it.
export async function startCall(env, me, { leadId, to, sessionId, base }) {
  const lead = leadId ? await getLead(env, me, leadId) : null;
  if (leadId && !lead) throw fail('That lead is not in your book.', 404);
  const phone = to || (lead && lead.phone);
  const r = await rules(env, me.ws);
  const chk = await callCheck(env, me.ws, lead, phone, r);
  if (!chk.ok) throw fail(chk.why, 409);
  const acct = await phoneAccount(env, me.ws, { base });
  const spend = await canSpend(env, acct);
  if (!spend.ok) throw fail(spend.why, 402);
  const num = await myNumber(env, me.ws, me.member);
  if (!num) throw fail('Get a phone number first: Settings, Phone, Buy a number.', 409);
  const a = { kind: 'call', dir: 'out', leadId: lead && lead.id, member: me.member, status: 'ringing', other: SH.e164(phone), via: num.e164,
    data: { sessionId: sessionId || null, record: !!r.recording, provider: acct.provider } };
  await env.DB.batch([activityStmt(env, me.ws, a)]);
  const c = (lead && lead.custom) || {};
  return { activityId: a.id, from: num.e164, to: SH.e164(phone), provider: acct.provider, record: !!r.recording, notice: r.recording ? r.recordingNotice : '',
    ...(acct.provider === 'sim' ? { plan: c.demoAnswer || null, ringMs: +c.demoRing || null } : {}) };
}
// The rep's side of the result: outcome and notes. Duration comes from the browser on the demo line
// and from the carrier's status callback on Twilio.
export async function finishCall(env, me, id, b) {
  const row = await one(env, 'SELECT * FROM activities WHERE ws = ? AND id = ? AND kind = ?', me.ws, id, 'call');
  if (!row) throw fail('That call is not on file.', 404);
  if (row.member !== me.member && !isManager(me)) throw fail('That call is someone else\'s.', 403);
  const a = rowToActivity(row), acct = await phoneAccount(env, me.ws, { create: false });
  const sim = !acct || acct.provider === 'sim';
  const status = ['completed', 'no-answer', 'busy', 'failed', 'voicemail', 'abandoned', 'canceled', 'missed'].includes(b.status) ? b.status : a.status === 'ringing' ? 'completed' : a.status;
  const duration = sim ? Math.max(0, Math.min(4 * 3600, b.duration | 0)) : a.duration;
  const data = { ...a.data, voicemailDropped: !!b.voicemailDropped || a.data.voicemailDropped || false, answeredBy: b.answeredBy || a.data.answeredBy || null };
  const st = [q(env, 'UPDATE activities SET status = ?3, duration = ?4, outcome = ?5, body = ?6, data = ?7 WHERE ws = ?1 AND id = ?2',
    me.ws, id, status, duration, b.outcome ? String(b.outcome).slice(0, 60) : a.outcome, b.note != null ? String(b.note).slice(0, 4000) : a.body, JSON.stringify(data))];
  // An inbound call someone answered needs nothing more in the inbox; a missed one or a voicemail stays.
  if (a.dir === 'in') st.push(q(env, 'UPDATE activities SET unread = ? WHERE ws = ? AND id = ?', status === 'completed' ? 0 : 1, me.ws, id));
  // Calling back and reaching them takes care of their missed calls and voicemails too.
  if (a.dir === 'out' && status === 'completed' && a.leadId) {
    st.push(q(env, "UPDATE activities SET unread = 0, handled_at = ?3 WHERE ws = ?1 AND lead_id = ?2 AND kind = 'call' AND dir = 'in' AND unread = 1", me.ws, a.leadId, Date.now()));
  }
  const first = a.status === 'ringing';
  if (first && a.leadId) st.push(touchStmt(env, me.ws, a.leadId, { at: a.at, call: true }));
  if (first && sim && acct) {
    const cents = callCost(acct, duration, { amd: !!data.sessionId && data.lines > 1, recorded: data.record });
    st.push(q(env, 'UPDATE activities SET cost_cents = ? WHERE ws = ? AND id = ?', cents, me.ws, id));
    st.push(...chargeStmts(env, acct, 'call', cents, id, 'Call to ' + SH.fmtPhone(a.other)));
  }
  if (b.status === 'bad-number' && a.leadId) st.push(q(env, "UPDATE leads SET status = 'bad-number', updated_at = ? WHERE ws = ? AND id = ?", Date.now(), me.ws, a.leadId));
  if (b.leadStatus && a.leadId) st.push(q(env, 'UPDATE leads SET status = ?, updated_at = ? WHERE ws = ? AND id = ?', String(b.leadStatus).slice(0, 40), Date.now(), me.ws, a.leadId));
  await env.DB.batch(st);
  return { id, status, duration };
}

// ---------- texts ----------
export async function sendText(env, me, { leadId, to, body, bulk = false, base, from: fromSeq }) {
  body = String(body || '').trim().slice(0, 1600);
  if (!body) throw fail('Write the text first.');
  const lead = leadId ? (me.system ? await leadRow(env, me.ws, leadId) : await getLead(env, me, leadId)) : null;
  if (leadId && !lead) throw fail('That lead is not in your book.', 404);
  const phone = to || (lead && lead.phone);
  const chk = await textCheck(env, me.ws, lead, phone, { bulk });
  if (!chk.ok) throw fail(chk.why, 409);
  const acct = await phoneAccount(env, me.ws, { base });
  const reg = regStatus(acct);
  if (reg !== 'approved') throw fail(reg === 'review' ? 'Texting is waiting on carrier approval. Calls work in the meantime.' : 'Turn on texting first: Settings, Phone, Texting registration.', 409);
  const spend = await canSpend(env, acct);
  if (!spend.ok) throw fail(spend.why, 402);
  const num = await myNumber(env, me.ws, me.member);
  if (!num) throw fail('Get a phone number first: Settings, Phone, Buy a number.', 409);
  const res = await carrierOf(acct).sendSms(env, acct, { from: num.e164, to: SH.e164(phone), body, statusUrl: base ? base + '/api/phone/status?ws=' + encodeURIComponent(me.ws) : null });
  const cents = smsCost(acct, body);
  const a = { kind: 'sms', dir: 'out', leadId: lead && lead.id, member: me.member, status: res.status === 'delivered' ? 'delivered' : 'sent', body, other: SH.e164(phone),
    via: num.e164, providerId: res.sid, costCents: cents, data: { bulk } };
  const st = [activityStmt(env, me.ws, a), ...chargeStmts(env, acct, 'sms', cents, a.id, 'Text to ' + SH.fmtPhone(phone))];
  if (lead) st.push(touchStmt(env, me.ws, lead.id));
  // The demo line plays the other side: some leads write back after a while.
  if (acct.provider === 'sim' && lead) { const reply = simReply(lead, body, 'sms'); if (reply) st.push(activityStmt(env, me.ws, { kind: 'sms', dir: 'in', leadId: lead.id, member: lead.owner || me.member, status: 'received', body: reply.text, other: SH.e164(phone), via: num.e164, unread: true, at: Date.now() + reply.after * 1000, data: { demo: true } })); }
  await env.DB.batch(st);
  return { id: a.id, status: a.status, costCents: cents };
}
// Canned replies for the demo line, keyed on what was sent. A lead can carry a scripted reply in
// custom.demoReply, which always comes back (used for the walkthrough video).
export function simReply(lead, sent, kind) {
  const c = lead.custom || {};
  if (c.demoReply) return { text: c.demoReply, after: +(c.demoReplyAfter || 8) };
  const s = String(sent || '').toLowerCase(), roll = (lead.id.charCodeAt(lead.id.length - 1) + Date.now()) % 10;
  if (roll > 3) return null;
  if (/statement/.test(s)) return { text: kind === 'sms' ? 'Sent them to your email just now' : 'Attached are the last 4 months. Let me know what else you need.', after: 40 };
  if (/application|apply/.test(s)) return { text: 'Filled it out. How long does it take?', after: 60 };
  if (/offer|approved/.test(s)) return { text: 'Can you call me to go over the numbers?', after: 45 };
  return { text: ['Who is this?', 'Yes, still looking. What do you need from me?', 'Call me after 3', 'Not right now, maybe next month'][roll], after: 30 };
}

// ---------- inbound ----------
const STOP_RX = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|arret|arrêt)\s*[.!]*\s*$/i;
const START_RX = /^\s*(start|unstop|yes)\s*$/i;
export async function inboundText(env, ws, { from, to, body, sid, media }) {
  const lead = await leadByPhone(env, ws, from);
  const num = await numberByE164(env, SH.e164(to));
  const st = [activityStmt(env, ws, { kind: 'sms', dir: 'in', leadId: lead && lead.id, member: (num && num.member) || (lead && lead.owner) || null, status: 'received',
    body: String(body || '').slice(0, 1600), other: SH.e164(from), via: SH.e164(to), providerId: sid, unread: true, data: media ? { media } : {} })];
  if (lead) {
    st.push(touchStmt(env, ws, lead.id));
    // A reply ends any sequence they are in.
    st.push(q(env, "UPDATE enrollments SET status = 'replied', updated_at = ? WHERE ws = ? AND lead_id = ? AND status = 'active'", Date.now(), ws, lead.id));
    if (STOP_RX.test(body || '')) {
      st.push(q(env, 'UPDATE leads SET sms_opt_out = 1, updated_at = ? WHERE ws = ? AND id = ?', Date.now(), ws, lead.id));
      st.push(activityStmt(env, ws, { kind: 'system', leadId: lead.id, body: 'Replied STOP. Texts to this number are off.' }));
    } else if (START_RX.test(body || '')) st.push(q(env, 'UPDATE leads SET sms_opt_out = 0 WHERE ws = ? AND id = ?', ws, lead.id));
  }
  await env.DB.batch(st);
  return lead;
}
export async function wsForNumber(env, e164) { const n = await numberByE164(env, SH.e164(e164)); return n ? n.ws : null; }
export { fill };
