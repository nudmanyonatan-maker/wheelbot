// Twilio asks here when a multi-line dialer leg is answered. The first person to answer joins the
// rep's conference; anyone who answers after that hears a short message and is counted as
// abandoned; voicemails get the rep's recorded drop (or a hang-up). Other ringing legs are ended.
import { twiml, carrierOf } from '../../../lib/carrier/index.js';
import { q, one, all, parse } from '../../../lib/server.js';
import { rules, countStmt, fill } from '../../../lib/compliance.js';
import { hook } from '../../../lib/twhook.js';
export async function onRequestPost({ request, env }) {
  const h = await hook(request, env); if (h.reply) return h.reply;
  const { ws, acct, params, url } = h, session = url.searchParams.get('session'), act = url.searchParams.get('act');
  const r = await rules(env, ws), wsr = await one(env, 'SELECT name FROM workspaces WHERE id = ?', ws);
  const num = await one(env, 'SELECT e164 FROM numbers WHERE ws = ? AND e164 = ?', ws, params.From || params.Caller || '');
  const vars = { company: wsr ? wsr.name : '', number: num ? num.e164 : '' };
  const by = params.AnsweredBy || 'human';
  if (by.startsWith('machine') || by === 'fax') {
    await env.DB.batch([q(env, "UPDATE activities SET status = 'voicemail', data = json_set(data, '$.answeredBy', 'machine', '$.voicemailDropped', ?) WHERE ws = ? AND id = ?", r.voicemailDrop ? 1 : 0, ws, act)]);
    return twiml.doc(r.voicemailDrop ? twiml.say(fill(r.voicemailMessage, { ...vars, rep: '', business: 'your business' })) + twiml.hangup() : twiml.hangup());
  }
  // First human answer wins: D1 runs one write at a time, so only one leg can claim the session.
  const claim = await q(env, "UPDATE dial_legs SET connected = 1, answered_by = 'human' WHERE ws = ? AND sid = ? AND session_id = ? AND NOT EXISTS (SELECT 1 FROM dial_legs WHERE ws = ? AND session_id = ? AND connected = 1 AND status = 'live')", ws, params.CallSid, session, ws, session).run();
  if (claim.meta && claim.meta.changes) {
    await env.DB.batch([q(env, "UPDATE dial_legs SET status = 'live' WHERE ws = ? AND sid = ?", ws, params.CallSid), countStmt(env, ws, { answered: 1 }),
      q(env, "UPDATE activities SET status = 'answered', data = json_set(data, '$.answeredBy', 'human') WHERE ws = ? AND id = ?", ws, act)]);
    const others = await all(env, "SELECT sid FROM dial_legs WHERE ws = ? AND session_id = ? AND sid != ? AND status = 'ringing'", ws, session, params.CallSid);
    for (const o of others) { try { await carrierOf(acct).updateCall(env, acct, o.sid, { status: 'completed' }); } catch { /* already ended */ } }
    return twiml.doc(twiml.conference('dial-' + session));
  }
  await env.DB.batch([countStmt(env, ws, { answered: 1, abandoned: 1 }), q(env, "UPDATE activities SET status = 'abandoned' WHERE ws = ? AND id = ?", ws, act)]);
  return twiml.doc(twiml.say(fill(r.abandonMessage, vars)) + twiml.hangup());
}
