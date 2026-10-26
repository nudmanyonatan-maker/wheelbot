// GET /api/phone/token -> what the browser needs to make and take calls: a Twilio Voice token, or
// { sim: true } on the demo line.
import { route, json } from '../../../lib/server.js';
import { phoneAccount, carrierOf } from '../../../lib/carrier/index.js';
export const { onRequestGet } = route({
  async get({ env, me, url }) {
    const acct = await phoneAccount(env, me.ws, { base: url.origin });
    return json({ ok: true, provider: acct.provider, identity: me.ws + '.' + me.member, ...(await carrierOf(acct).voiceToken(env, acct, me.ws + '.' + me.member)) });
  }
});
