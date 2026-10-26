// GET  /api/phone/account -> the brokerage's phone setup: carrier, wallet, numbers, registration,
//      this month's usage by kind, and the latest wallet lines.
// POST /api/phone/account { action: 'topup', cents } | { action: 'auto', on, below, amount } | { action: 'cap', cents } | { action: 'markup', pct }
import { route, json, fail, q, all, one, isManager, newId, logEvent } from '../../../lib/server.js';
import { phoneAccount, regStatus, PRICES, priced, carrierFor } from '../../../lib/carrier/index.js';

export const { onRequestGet, onRequestPost } = route({
  async get({ env, me, url }) {
    const ws = await one(env, 'SELECT name FROM workspaces WHERE id = ?', me.ws);
    const acct = await phoneAccount(env, me.ws, { wsName: ws && ws.name, base: url.origin });
    const d0 = new Date(); d0.setDate(1); d0.setHours(0, 0, 0, 0);
    const [nums, usage, ledger] = await Promise.all([
      all(env, 'SELECT * FROM numbers WHERE ws = ? AND released_at IS NULL ORDER BY created_at', me.ws),
      all(env, 'SELECT kind, -SUM(cents) AS cents, COUNT(*) AS n FROM wallet WHERE ws = ? AND at >= ? AND cents < 0 GROUP BY kind', me.ws, d0.getTime()),
      all(env, 'SELECT * FROM wallet WHERE ws = ? ORDER BY at DESC LIMIT 40', me.ws)
    ]);
    return json({ ok: true, carrier: carrierFor(env).name, provider: acct.provider, balanceCents: acct.balanceCents, autoRecharge: acct.autoRecharge, spendCapCents: acct.spendCapCents,
      markupPct: acct.markupPct, registration: { ...acct.registration, status: regStatus(acct) },
      // Dollars, with the brokerage's markup, for the rates table.
      prices: Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [k, Math.round(v * (1 + (acct.markupPct || 0) / 100) * 1000) / 100000])),
      numbers: nums.map((n) => ({ id: n.id, e164: n.e164, label: n.label, member: n.member, areaCode: n.area_code, monthlyCents: n.monthly_cents, createdAt: n.created_at })),
      usage, ledger: ledger.map((l) => ({ id: l.id, at: l.at, kind: l.kind, cents: l.cents, note: l.note })) });
  },
  async post({ env, me, body }) {
    if (!isManager(me)) throw fail('Only a manager can change the phone wallet.', 403);
    const acct = await phoneAccount(env, me.ws);
    if (body.action === 'topup') {
      const c = Math.round(+body.cents || 0);
      if (c < 1000 || c > 500000) throw fail('Add between $10 and $5,000.');
      // On the real carrier this is where the card charge goes (Stripe). The demo line adds it at once.
      if (acct.provider !== 'sim' && !env.STRIPE_SECRET_KEY) throw fail('Card payments are not connected yet.', 501);
      await env.DB.batch([q(env, 'UPDATE phone_accounts SET balance_cents = balance_cents + ? WHERE ws = ?', c, me.ws),
        q(env, 'INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (?, ?, ?, ?, ?, ?)', me.ws, newId('wl'), Date.now(), 'topup', c, acct.provider === 'sim' ? 'Demo top-up' : 'Card top-up')]);
      await logEvent(env, me, 'wallet', null, null, 'Added ' + (c / 100).toFixed(2), null);
    } else if (body.action === 'auto') {
      const ar = { on: !!body.on, below: Math.max(500, Math.round(+body.below || 500)), amount: Math.max(1000, Math.round(+body.amount || 2500)) };
      await q(env, 'UPDATE phone_accounts SET auto_recharge = ? WHERE ws = ?', JSON.stringify(ar), me.ws).run();
    } else if (body.action === 'cap') {
      const c = body.cents ? Math.max(1000, Math.round(+body.cents)) : null;
      await q(env, 'UPDATE phone_accounts SET spend_cap_cents = ? WHERE ws = ?', c, me.ws).run();
    } else throw fail('Unknown action.');
    return json({ ok: true });
  }
});
