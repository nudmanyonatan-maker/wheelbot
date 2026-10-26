// POST /api/phone/sms { leadId, to, body } -> sends a text from this person's number.
import { route, json } from '../../../lib/server.js';
import { sendText } from '../../../lib/phone.js';
export const { onRequestPost } = route({
  async post({ env, me, body, url }) { return json({ ok: true, ...(await sendText(env, me, { leadId: body.leadId, to: body.to, body: body.body, base: url.origin })) }); }
});
