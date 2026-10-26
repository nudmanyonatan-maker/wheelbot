// Email: each rep connects their own mailbox (Gmail or Outlook) so mail goes out from their real
// address and replies land on the lead. Nylas does the mailbox sync, which spares us Google's
// yearly security review; set NYLAS_API_KEY and NYLAS_CLIENT_ID to turn it on. Until then each rep
// gets a demo mailbox that sends nothing and lets some leads write back.
import { SH, q, one, fail, isManager } from './server.js';
import { activityStmt } from './activity.js';
import { touchStmt, getLead, leadByEmail } from './leads.js';
import { rules, emailCheck, unsubToken, caslFooter } from './compliance.js';
import { simReply, leadRow } from './phone.js';

const NYLAS = 'https://api.us.nylas.com/v3';
export function mailMode(env) { return env.NYLAS_API_KEY && env.NYLAS_CLIENT_ID ? 'nylas' : 'sim'; }

export async function mailbox(env, ws, member) { return await one(env, 'SELECT * FROM mailboxes WHERE ws = ? AND member = ?', ws, member); }
export function connectUrl(env, base, state, provider) {
  const p = new URLSearchParams({ client_id: env.NYLAS_CLIENT_ID, redirect_uri: base + '/api/email/callback', response_type: 'code', access_type: 'online', state, provider: provider === 'microsoft' ? 'microsoft' : 'google' });
  return NYLAS + '/connect/auth?' + p;
}
export async function finishConnect(env, base, code) {
  const res = await fetch(NYLAS + '/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.NYLAS_CLIENT_ID, client_secret: env.NYLAS_API_KEY, grant_type: 'authorization_code', code, redirect_uri: base + '/api/email/callback' }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.grant_id) throw fail('The mailbox did not connect. Try again.', 502);
  return { grantId: j.grant_id, email: j.email };
}
async function nylasSend(env, grant, { to, subject, body, replyTo }) {
  const res = await fetch(NYLAS + '/grants/' + encodeURIComponent(grant) + '/messages/send', { method: 'POST',
    headers: { Authorization: 'Bearer ' + env.NYLAS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: [{ email: to }], subject, body: body.replace(/\n/g, '<br>'), reply_to_message_id: replyTo || undefined }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw fail((j.error && j.error.message) || 'The email did not send.', 502);
  return { id: j.data && j.data.id, thread: j.data && j.data.thread_id };
}
export async function sentToday(env, ws, member) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const r = await one(env, "SELECT COUNT(*) AS n FROM activities WHERE ws = ? AND member = ? AND kind = 'email' AND dir = 'out' AND at >= ?", ws, member, d0.getTime());
  return r.n || 0;
}

// Sends one email from this person's mailbox. bulk adds the CASL footer and checks consent.
export async function sendEmail(env, me, { leadId, to, subject, body, bulk = false, base, seqId }) {
  subject = String(subject || '').trim().slice(0, 300); body = String(body || '').trim().slice(0, 20000);
  if (!subject || !body) throw fail('Write a subject and a message.');
  const lead = leadId ? (me.system ? await leadRow(env, me.ws, leadId) : await getLead(env, me, leadId)) : null;
  if (leadId && !lead) throw fail('That lead is not in your book.', 404);
  const email = SH.emailLc(to || (lead && lead.email));
  const chk = await emailCheck(env, me.ws, lead, email, { bulk });
  if (!chk.ok) throw fail(chk.why, 409);
  const box = await mailbox(env, me.ws, me.member);
  if (!box) throw fail('Connect your mailbox first: Settings, Email.', 409);
  if ((await sentToday(env, me.ws, me.member)) >= (box.daily_cap || 400)) throw fail('You reached today\'s sending limit of ' + box.daily_cap + ' emails, which protects your mailbox from spam filters. It resets at midnight.', 429);
  let text = body;
  if (bulk) text += caslFooter(await rules(env, me.ws), (base || '') + '/u/' + (await unsubToken(env, me.ws, email)));
  let provider = { id: null, thread: null };
  if (box.provider === 'nylas') provider = await nylasSend(env, box.grant_id, { to: email, subject, body: text });
  const a = { kind: 'email', dir: 'out', leadId: lead && lead.id, member: me.member, status: 'sent', subject, body: text, other: email, via: box.address,
    providerId: provider.id, threadKey: provider.thread || (lead && lead.id), data: { bulk, seqId: seqId || null } };
  const st = [activityStmt(env, me.ws, a)];
  if (lead) st.push(touchStmt(env, me.ws, lead.id));
  if (box.provider === 'sim' && lead) {
    const reply = simReply(lead, subject + ' ' + body, 'email');
    if (reply) st.push(activityStmt(env, me.ws, { kind: 'email', dir: 'in', leadId: lead.id, member: lead.owner || me.member, status: 'received', subject: 'Re: ' + subject,
      body: reply.text, other: email, via: box.address, threadKey: lead.id, unread: true, at: Date.now() + reply.after * 1000 * 2, data: { demo: true } }));
  }
  await env.DB.batch(st);
  return { id: a.id };
}
// A new message in a connected mailbox (Nylas webhook). Matched to a lead by the sender.
export async function inboundEmail(env, ws, { member, from, subject, body, id, thread }) {
  const lead = await leadByEmail(env, ws, from);
  if (!lead) return null;
  await env.DB.batch([
    activityStmt(env, ws, { kind: 'email', dir: 'in', leadId: lead.id, member: member || lead.owner, status: 'received', subject, body: String(body || '').slice(0, 20000),
      other: SH.emailLc(from), providerId: id, threadKey: thread || lead.id, unread: true }),
    touchStmt(env, ws, lead.id),
    q(env, "UPDATE enrollments SET status = 'replied', updated_at = ? WHERE ws = ? AND lead_id = ? AND status = 'active'", Date.now(), ws, lead.id)
  ]);
  return lead;
}
export { isManager };
