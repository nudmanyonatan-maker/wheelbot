// Twilio status callbacks for calls and texts: final status, length, and the charge to the wallet.
import { q, one, parse, SH } from '../../../lib/server.js';
import { callCost, chargeStmts } from '../../../lib/carrier/index.js';
import { hook } from '../../../lib/twhook.js';
export async function onRequestPost({ request, env }) {
  const h = await hook(request, env); if (h.reply) return h.reply;
  const { ws, acct, params, url } = h;
  if (params.MessageSid && params.MessageStatus) {
    await q(env, 'UPDATE activities SET status = ? WHERE ws = ? AND provider_id = ?', params.MessageStatus, ws, params.MessageSid).run();
    return new Response('', { status: 204 });
  }
  const actId = url.searchParams.get('act');
  const a = actId ? await one(env, 'SELECT * FROM activities WHERE ws = ? AND id = ?', ws, actId) : await one(env, 'SELECT * FROM activities WHERE ws = ? AND provider_id = ?', ws, params.ParentCallSid || params.CallSid);
  if (!a) return new Response('', { status: 204 });
  const st = { completed: 'completed', 'no-answer': 'no-answer', busy: 'busy', failed: 'failed', canceled: 'canceled', ringing: 'ringing', 'in-progress': 'answered', answered: 'answered' }[params.CallStatus] || a.status;
  const data = parse(a.data, {}), dur = +params.CallDuration || +params.DialCallDuration || a.duration || 0;
  const stmts = [q(env, 'UPDATE activities SET status = CASE WHEN status IN (\'voicemail\', \'abandoned\') THEN status ELSE ? END, duration = ? WHERE ws = ? AND id = ?', st, dur, ws, a.id)];
  if (['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(st) && !data.charged) {
    const cents = callCost(acct, dur, { inbound: a.dir === 'in', amd: !!data.sessionId && data.lines > 1, recorded: !!data.record });
    stmts.push(q(env, "UPDATE activities SET cost_cents = ?, data = json_set(data, '$.charged', 1) WHERE ws = ? AND id = ?", cents, ws, a.id));
    stmts.push(...chargeStmts(env, acct, 'call', cents, a.id, (a.dir === 'in' ? 'Call from ' : 'Call to ') + SH.fmtPhone(a.other)));
  }
  await env.DB.batch(stmts);
  return new Response('', { status: 204 });
}
