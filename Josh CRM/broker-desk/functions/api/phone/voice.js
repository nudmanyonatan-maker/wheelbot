// Twilio asks here when the browser places a call (the TwiML app's Voice URL). Either a call to a
// lead, or the rep joining their dialer session's conference.
import { twiml } from '../../../lib/carrier/index.js';
import { one, q, parse } from '../../../lib/server.js';
import { hook } from '../../../lib/twhook.js';
export async function onRequestPost({ request, env }) {
  const h = await hook(request, env); if (h.reply) return h.reply;
  const { ws, params, url } = h;
  if (params.Conference) return twiml.doc(twiml.conference('dial-' + params.Conference.replace(/[^A-Za-z0-9_-]/g, '')));
  const act = await one(env, 'SELECT * FROM activities WHERE ws = ? AND id = ?', ws, params.ActivityId || '');
  if (!act) return twiml.doc(twiml.say('This call could not be placed.') + twiml.hangup());
  const data = parse(act.data, {}), r = await one(env, "SELECT data FROM settings WHERE ws = ? AND key = 'compliance'", ws), comp = parse(r && r.data, {});
  await q(env, 'UPDATE activities SET provider_id = ? WHERE ws = ? AND id = ?', params.CallSid, ws, act.id).run();
  return twiml.doc(twiml.dialOut({ from: act.via, to: act.other, record: !!data.record, notice: comp.recordingNotice || 'This call may be recorded.',
    statusUrl: url.origin + '/api/phone/status?ws=' + encodeURIComponent(ws) + '&act=' + act.id }));
}
