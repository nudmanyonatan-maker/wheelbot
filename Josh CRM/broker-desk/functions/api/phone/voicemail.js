// After an inbound call rings out: answered calls are done; otherwise play the greeting and record.
// Twilio comes back here again with the recording.
import { twiml } from '../../../lib/carrier/index.js';
import { q, one, parse } from '../../../lib/server.js';
import { DEFAULT_PHONE } from '../../../lib/defaults.js';
import { fill } from '../../../lib/compliance.js';
import { hook } from '../../../lib/twhook.js';
export async function onRequestPost({ request, env }) {
  const h = await hook(request, env); if (h.reply) return h.reply;
  const { ws, params, url } = h, act = url.searchParams.get('act');
  if (params.RecordingUrl) {
    await q(env, "UPDATE activities SET status = 'voicemail', duration = ?, unread = 1, data = json_set(data, '$.recordingUrl', ?) WHERE ws = ? AND id = ?", +params.RecordingDuration || 0, params.RecordingUrl, ws, act).run();
    return twiml.doc(twiml.hangup());
  }
  if (params.DialCallStatus === 'completed' || params.DialCallStatus === 'answered') {
    await q(env, "UPDATE activities SET status = 'completed', unread = 0, duration = ? WHERE ws = ? AND id = ?", +params.DialCallDuration || 0, ws, act).run();
    return twiml.doc(twiml.hangup());
  }
  await q(env, "UPDATE activities SET status = 'missed' WHERE ws = ? AND id = ?", ws, act).run();
  const ph = await one(env, "SELECT data FROM settings WHERE ws = ? AND key = 'phone'", ws), wsr = await one(env, 'SELECT name FROM workspaces WHERE id = ?', ws);
  const greeting = fill((parse(ph && ph.data, {}).greeting) || DEFAULT_PHONE.greeting, { company: wsr ? wsr.name : '' });
  return twiml.doc(twiml.voicemail({ greeting, action: url.origin + '/api/phone/voicemail?ws=' + encodeURIComponent(ws) + '&act=' + act }));
}
