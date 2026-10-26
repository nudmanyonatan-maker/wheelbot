// Which carrier this deployment uses, each brokerage's phone account, the price list, the wallet,
// and the TwiML the real carrier gets back. Twilio is used once its master keys are set;
// until then every brokerage is on the demo line.
import { sim } from './sim.js';
import { twilio } from './twilio.js';
import { q, one, all, newId, parse } from '../server.js';
import { seal, unseal } from '../crypto.js';

export function carrierFor(env) { return env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? twilio : sim; }

// Rates in CAD cents, before the brokerage's markup. Twilio bills in USD; these round its Canadian
// rates up to cover the exchange rate. Calls bill per started minute.
export const PRICES = { number: 160, callOutMin: 2, callInMin: 1.2, sms: 1.5, mms: 3, amd: 1, recordingMin: 0.4 };

export async function phoneAccount(env, ws, { create = true, wsName, base } = {}) {
  let r = await one(env, 'SELECT * FROM phone_accounts WHERE ws = ?', ws);
  const carrier = carrierFor(env);
  if (!r && create) {
    const made = await carrier.ensureAccount(env, ws, wsName, base);
    const now = Date.now(), demo = carrier.name === 'sim';
    await env.DB.batch([
      q(env, 'INSERT OR IGNORE INTO phone_accounts (ws, provider, sub_sid, sub_secret, balance_cents, auto_recharge, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ws, carrier.name, made.subSid, await seal(env, made.secret), demo ? 2500 : 0, JSON.stringify({ on: demo, below: 500, amount: 2500 }), now),
      ...(demo ? [q(env, 'INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (?, ?, ?, ?, ?, ?)', ws, newId('wl'), now, 'topup', 2500, 'Demo credit')] : [])
    ]);
    r = await one(env, 'SELECT * FROM phone_accounts WHERE ws = ?', ws);
  }
  if (!r) return null;
  return { ws, provider: r.provider, subSid: r.sub_sid, secret: await unseal(env, r.sub_secret), registration: parse(r.registration, {}),
    balanceCents: r.balance_cents, autoRecharge: parse(r.auto_recharge, {}), spendCapCents: r.spend_cap_cents, markupPct: r.markup_pct || 0 };
}
export function carrierOf(acct) { return acct && acct.provider === 'twilio' ? twilio : sim; }
export function regStatus(acct) { return carrierOf(acct).registrationStatus(acct.registration); }

export function priced(acct, base) { return Math.ceil(base * (1 + (acct.markupPct || 0) / 100)); }
export function callCost(acct, seconds, { inbound = false, amd = false, recorded = false } = {}) {
  const mins = Math.max(1, Math.ceil((seconds || 0) / 60));
  let c = (seconds > 0 ? mins * (inbound ? PRICES.callInMin : PRICES.callOutMin) : 0) + (amd ? PRICES.amd : 0) + (recorded && seconds ? mins * PRICES.recordingMin : 0);
  if (!seconds && !amd) c = PRICES.callOutMin * 0.5; // a ring with no answer still costs a little
  return priced(acct, c);
}
export function smsCost(acct, body) { const segs = Math.max(1, Math.ceil(String(body || '').length / 153)); return priced(acct, segs * PRICES.sms); }

// Money out of the wallet, with auto top-up on the demo line. Returns the statements to batch.
export function chargeStmts(env, acct, kind, cents, ref, note) {
  const now = Date.now(), out = [
    q(env, 'UPDATE phone_accounts SET balance_cents = balance_cents - ? WHERE ws = ?', cents, acct.ws),
    q(env, 'INSERT INTO wallet (ws, id, at, kind, cents, ref, note) VALUES (?, ?, ?, ?, ?, ?, ?)', acct.ws, newId('wl'), now, kind, -cents, ref || null, note || null)
  ];
  const ar = acct.autoRecharge || {};
  if (ar.on && acct.provider === 'sim' && acct.balanceCents - cents < (ar.below || 500)) {
    out.push(q(env, 'UPDATE phone_accounts SET balance_cents = balance_cents + ? WHERE ws = ?', ar.amount || 2500, acct.ws));
    out.push(q(env, 'INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (?, ?, ?, ?, ?, ?)', acct.ws, newId('wl'), now + 1, 'topup', ar.amount || 2500, 'Auto top-up'));
    acct.balanceCents += ar.amount || 2500;
  }
  acct.balanceCents -= cents;
  return out;
}
// Calls and texts stop when the wallet is empty or this month's spend reaches the cap.
export async function canSpend(env, acct) {
  if (acct.balanceCents <= 0) return { ok: false, why: 'The phone wallet is empty. Add funds in Settings, Phone.' };
  if (acct.spendCapCents) {
    const d0 = new Date(); d0.setDate(1); d0.setHours(0, 0, 0, 0);
    const r = await one(env, "SELECT -COALESCE(SUM(cents), 0) AS spent FROM wallet WHERE ws = ? AND at >= ? AND cents < 0", acct.ws, d0.getTime());
    if ((r.spent || 0) >= acct.spendCapCents) return { ok: false, why: "This month's phone spending cap is reached. A manager can raise it in Settings, Phone." };
  }
  return { ok: true };
}
export async function myNumber(env, ws, member) {
  const rows = await all(env, 'SELECT * FROM numbers WHERE ws = ? AND released_at IS NULL ORDER BY (member = ?) DESC, created_at', ws, member);
  return rows[0] || null;
}
export async function numberByE164(env, e164) { return await one(env, 'SELECT * FROM numbers WHERE e164 = ? AND released_at IS NULL', e164); }

// ---------- TwiML ----------
const x = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export const twiml = {
  doc: (inner) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + inner + '</Response>', { headers: { 'Content-Type': 'text/xml' } }),
  say: (text) => '<Say voice="Polly.Joanna">' + x(text) + '</Say>',
  // Browser to phone. A recording notice plays to both sides before the call connects.
  dialOut: ({ from, to, record, notice, statusUrl }) =>
    (record && notice ? '<Say voice="Polly.Joanna">' + x(notice) + '</Say>' : '') +
    '<Dial callerId="' + x(from) + '"' + (record ? ' record="record-from-answer-dual"' : '') + ' answerOnBridge="true"><Number statusCallback="' + x(statusUrl) +
    '" statusCallbackEvent="initiated ringing answered completed">' + x(to) + '</Number></Dial>',
  // Phone to browser: ring the rep (and their cell if forwarding is on), then voicemail.
  ringRep: ({ identity, forward, timeout = 20, action }) =>
    '<Dial timeout="' + timeout + '" action="' + x(action) + '">' + '<Client>' + x(identity) + '</Client>' + (forward ? '<Number>' + x(forward) + '</Number>' : '') + '</Dial>',
  voicemail: ({ greeting, action }) => '<Say voice="Polly.Joanna">' + x(greeting) + '</Say><Record maxLength="120" playBeep="true" action="' + x(action) + '" transcribe="false"/>',
  conference: (room) => '<Dial><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false" waitUrl="">' + x(room) + '</Conference></Dial>',
  hangup: () => '<Hangup/>'
};
