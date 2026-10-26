// POST /api/phone/registration { profile } -> sends the brokerage's texting registration in.
// The carriers want the legal name, business number, address, website, what the texts are for,
// how people opt in, and sample messages. Loan offers in the samples get rejected, so the form
// steers toward account updates.
import { route, json, fail, q, isManager, logEvent } from '../../../lib/server.js';
import { phoneAccount, carrierOf, regStatus } from '../../../lib/carrier/index.js';

const NEED = ['legalName', 'businessNumber', 'address', 'website', 'contactName', 'contactEmail', 'useCase', 'optIn', 'sample1', 'sample2'];
export const { onRequestPost } = route({
  async post({ env, me, body }) {
    if (!isManager(me)) throw fail('Only a manager can send the registration.', 403);
    const p = body.profile || {}, profile = {};
    NEED.concat(['contactPhone', 'volume']).forEach((k) => { profile[k] = String(p[k] || '').trim().slice(0, k.startsWith('sample') ? 320 : 300); });
    const missing = NEED.filter((k) => !profile[k]);
    if (missing.length) throw fail('Fill in every field first.', 400);
    if (/\b(approved|guaranteed|qualify|pre-?approved|cash advance|loan offer)\b/i.test(profile.sample1 + ' ' + profile.sample2)) throw fail('Carriers reject sample texts that read like loan offers. Write them as updates, like "Your statements came through, thanks."');
    const acct = await phoneAccount(env, me.ws);
    const res = await carrierOf(acct).submitRegistration(env, acct, profile);
    const reg = { ...profile, status: res.status, submittedAt: res.submittedAt, ref: res.ref, manual: !!res.manual };
    await q(env, 'UPDATE phone_accounts SET registration = ? WHERE ws = ?', JSON.stringify(reg), me.ws).run();
    await logEvent(env, me, 'registration', null, null, profile.legalName, null);
    return json({ ok: true, status: regStatus({ ...acct, registration: reg }) });
  }
});
