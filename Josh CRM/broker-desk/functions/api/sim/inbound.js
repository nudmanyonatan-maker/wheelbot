// POST /api/sim/inbound { kind: 'sms' | 'call', leadId | from, body } -> plays an inbound text or
// call on the demo line, so the inbox, ringing and voicemail can be seen. Demo line only.
import { route, json, fail, SH, one } from '../../../lib/server.js';
import { phoneAccount } from '../../../lib/carrier/index.js';
import { inboundText } from '../../../lib/phone.js';
import { addActivity } from '../../../lib/activity.js';
import { leadByPhone } from '../../../lib/leads.js';
export const { onRequestPost } = route({
  async post({ env, me, body }) {
    const acct = await phoneAccount(env, me.ws, { create: false });
    if (!acct || acct.provider !== 'sim') throw fail('Only on the demo line.', 409);
    const lead = body.leadId ? await one(env, 'SELECT id, owner, phone_key FROM leads WHERE ws = ? AND id = ?', me.ws, body.leadId) : null;
    const from = lead ? SH.e164(lead.phone_key) : SH.e164(body.from);
    if (!from) throw fail('Pick a lead with a phone number.');
    const num = await one(env, 'SELECT e164 FROM numbers WHERE ws = ? AND released_at IS NULL ORDER BY (member = ?) DESC LIMIT 1', me.ws, me.member);
    if (!num) throw fail('Buy a number first.');
    const at = Date.now() + (Math.max(0, Math.min(120, body.delay | 0)) * 1000);
    if (body.kind === 'call') {
      const l = lead || await leadByPhone(env, me.ws, from);
      const id = await addActivity(env, me.ws, { kind: 'call', dir: 'in', leadId: l && l.id, member: me.member, status: 'ringing', other: from, via: num.e164, unread: true, at, data: { sim: true, voicemail: body.body || null } }, { touch: !!l });
      return json({ ok: true, id });
    }
    await addActivity(env, me.ws, { kind: 'sms', dir: 'in', leadId: lead && lead.id, member: me.member, status: 'received', body: String(body.body || 'Hi, is this the funding company?').slice(0, 1600), other: from, via: num.e164, unread: true, at, data: { demo: true } }, { touch: !!lead });
    return json({ ok: true });
  }
});
