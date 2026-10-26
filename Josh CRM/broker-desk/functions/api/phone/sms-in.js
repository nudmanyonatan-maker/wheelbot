// Twilio posts inbound texts here. Matched to a lead by number; STOP turns texts off for them.
import { inboundText } from '../../../lib/phone.js';
import { twiml } from '../../../lib/carrier/index.js';
import { hook } from '../../../lib/twhook.js';
export async function onRequestPost({ request, env }) {
  const h = await hook(request, env); if (h.reply) return h.reply;
  const { ws, params } = h, media = [];
  for (let i = 0; i < (+params.NumMedia || 0); i++) if (params['MediaUrl' + i]) media.push(params['MediaUrl' + i]);
  await inboundText(env, ws, { from: params.From, to: params.To, body: params.Body, sid: params.MessageSid, media: media.length ? media : null });
  return twiml.doc('');
}
