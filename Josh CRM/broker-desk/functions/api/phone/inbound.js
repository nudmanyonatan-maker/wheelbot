// Twilio asks here when someone calls one of the brokerage's numbers: ring the rep in the desk (and
// their cell if they forward), then voicemail.
import { twiml } from '../../../lib/carrier/index.js';
import { SH, one, newId, parse } from '../../../lib/server.js';
import { leadByPhone } from '../../../lib/leads.js';
import { addActivity } from '../../../lib/activity.js';
import { memberSettings } from '../../../lib/defaults.js';
import { onDnc } from '../../../lib/compliance.js';
import { hook } from '../../../lib/twhook.js';
export async function onRequestPost({ request, env }) {
  const h = await hook(request, env); if (h.reply) return h.reply;
  const { ws, params, url } = h;
  const num = await one(env, 'SELECT * FROM numbers WHERE e164 = ? AND ws = ? AND released_at IS NULL', SH.e164(params.To), ws);
  const lead = await leadByPhone(env, ws, params.From), member = (num && num.member) || (lead && lead.owner) || null;
  const id = newId('ac');
  await addActivity(env, ws, { id, kind: 'call', dir: 'in', leadId: lead && lead.id, member, status: 'ringing', other: SH.e164(params.From), via: SH.e164(params.To), providerId: params.CallSid, unread: true }, { touch: !!lead });
  const mine = member ? await memberSettings(env, ws, member) : {};
  return twiml.doc(twiml.ringRep({ identity: ws + '.' + member, forward: mine.forwardTo, action: url.origin + '/api/phone/voicemail?ws=' + encodeURIComponent(ws) + '&act=' + id }));
}
