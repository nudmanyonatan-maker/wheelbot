// GET    /api/phone/numbers?areaCode=416 -> numbers available to buy.
// POST   /api/phone/numbers { e164, label, member } -> buys it (first month from the wallet).
// PATCH  /api/phone/numbers { id, label, member } -> rename or give it to someone.
// DELETE /api/phone/numbers?id= -> releases it.
import { route, json, fail, q, all, one, isManager, newId, SH, logEvent } from '../../../lib/server.js';
import { phoneAccount, carrierOf, chargeStmts, priced, PRICES, canSpend } from '../../../lib/carrier/index.js';

export const { onRequestGet, onRequestPost, onRequestPatch, onRequestDelete } = route({
  async get({ env, me, url }) {
    const acct = await phoneAccount(env, me.ws, { base: url.origin });
    const taken = (await all(env, 'SELECT e164 FROM numbers WHERE released_at IS NULL')).map((r) => r.e164);
    const list = await carrierOf(acct).searchNumbers(env, acct, { areaCode: url.searchParams.get('areaCode'), contains: url.searchParams.get('contains'), taken });
    return json({ ok: true, numbers: list, monthlyCents: priced(acct, PRICES.number) });
  },
  async post({ env, me, body, url }) {
    if (!isManager(me)) throw fail('Only a manager can buy numbers.', 403);
    const e164 = SH.e164(body.e164);
    if (!e164) throw fail('Pick a number.');
    if (await one(env, 'SELECT 1 AS x FROM numbers WHERE e164 = ? AND released_at IS NULL', e164)) throw fail('Someone just took that number. Pick another.', 409);
    const acct = await phoneAccount(env, me.ws, { base: url.origin });
    const spend = await canSpend(env, acct); if (!spend.ok) throw fail(spend.why, 402);
    const res = await carrierOf(acct).buyNumber(env, acct, e164, url.origin, me.ws);
    const id = newId('pn'), cents = priced(acct, PRICES.number);
    await env.DB.batch([
      q(env, 'INSERT INTO numbers (ws, id, e164, label, member, provider_sid, area_code, monthly_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        me.ws, id, e164, String(body.label || '').slice(0, 60) || null, body.member || me.member, res.sid, e164.slice(2, 5), cents, Date.now()),
      ...chargeStmts(env, acct, 'number', cents, id, 'Number ' + SH.fmtPhone(e164) + ', first month')
    ]);
    await logEvent(env, me, 'number', null, id, SH.fmtPhone(e164), null);
    return json({ ok: true, id });
  },
  async patch({ env, me, body }) {
    if (!isManager(me)) throw fail('Only a manager can change numbers.', 403);
    await q(env, 'UPDATE numbers SET label = COALESCE(?, label), member = COALESCE(?, member) WHERE ws = ? AND id = ?', body.label != null ? String(body.label).slice(0, 60) : null, body.member || null, me.ws, String(body.id || '')).run();
    return json({ ok: true });
  },
  async delete({ env, me, url }) {
    if (!isManager(me)) throw fail('Only a manager can release numbers.', 403);
    const n = await one(env, 'SELECT * FROM numbers WHERE ws = ? AND id = ? AND released_at IS NULL', me.ws, url.searchParams.get('id'));
    if (!n) throw fail('That number is gone.', 404);
    const acct = await phoneAccount(env, me.ws);
    await carrierOf(acct).releaseNumber(env, acct, n.provider_sid);
    await q(env, 'UPDATE numbers SET released_at = ? WHERE ws = ? AND id = ?', Date.now(), me.ws, n.id).run();
    await logEvent(env, me, 'number', null, n.id, 'Released ' + SH.fmtPhone(n.e164), null);
    return json({ ok: true });
  }
});
