// The desk's business phone line: click-to-call bridges and inbound texts. Stub, not live yet.
// PHONE_PROVIDER picks the carrier:
//   connectuc  Josh's line where it is today, through the NetSapiens v2 API that Connect UC runs on.
//              Needs NS_API_BASE (the API host Unicom gives) and NS_API_KEY (scoped to Josh's user).
//   twilio     the same number after a port to Twilio. Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.
// PHONE_LINES says whose number is whose, as JSON: {"3052805556": {"ws": "<workspace id>", "member": "u1"}}.
// member is the person id the app uses (users.member), so texts land in that rep's book.
// Nothing here runs until those are set. See recommendation-phone.md.
import { sha256hex, randomToken } from './server.js';

const enc = new TextEncoder();

// Same rules as digits() and fmtPhone() in public/app.js, so records match what the app writes.
export function digits(p) { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; }
export function fmtPhone(p) { const d = digits(p); return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : String(p || ''); }
const e164 = (d) => '+1' + d;

// US numbers only, and no 900 or 976 pay lines, so a stolen session cannot run up a bill.
export function dialable(d) { return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) && !d.startsWith('900') && d.slice(3, 6) !== '976'; }

// { '3052805556': { ws, member } }, keeping only well-formed entries.
export function lines(env) {
  let m = {};
  try { m = JSON.parse(env.PHONE_LINES || '{}') || {}; } catch { return {}; }
  const out = {};
  Object.keys(m).forEach((n) => { const o = m[n]; if (digits(n).length === 10 && o && typeof o.ws === 'string' && typeof o.member === 'string') out[digits(n)] = { ws: o.ws, member: o.member }; });
  return out;
}
export function lineFor(env, ws, member) { const m = lines(env); return Object.keys(m).find((n) => m[n].ws === ws && m[n].member === member) || null; }

export function phoneReady(env) {
  if (!Object.keys(lines(env)).length) return false;
  if (env.PHONE_PROVIDER === 'connectuc') return !!(env.NS_API_BASE && env.NS_API_KEY);
  if (env.PHONE_PROVIDER === 'twilio') return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
  return false;
}

// Rings Josh first, then dials the shop from the business number once he picks up.
// line, to and agent are 10-digit strings. agent is Josh's cell, used on Twilio only.
export async function placeCall(env, { line, to, agent }) {
  if (env.PHONE_PROVIDER === 'connectuc') {
    // Leaving out call-orig-user rings the API key's own user: Josh's Connect UC app and desk phone.
    const callId = randomToken(16);
    const body = { synchronous: 'no', 'call-id': callId, 'call-term-user': '1' + to, 'caller-id-number': '1' + line };
    if (env.NS_ORIG_USER) body['call-orig-user'] = env.NS_ORIG_USER;
    const res = await fetch(env.NS_API_BASE.replace(/\/+$/, '') + '/ns-api/v2/domains/~/users/~/calls', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.NS_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return res.ok ? { ok: true, callId } : { ok: false, error: 'Connect UC did not take the call (' + res.status + ').' };
  }
  if (env.PHONE_PROVIDER === 'twilio') {
    if (!dialable(agent) || agent === line) return { ok: false, error: 'Add your cell number to your desk profile so the call can ring you.' };
    // A 20 second ring on Josh's leg hangs up before his voicemail answers and gets bridged to the shop.
    const twiml = '<Response><Dial callerId="' + e164(line) + '"><Number>' + e164(to) + '</Number></Dial></Response>';
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Calls.json', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: e164(agent), From: e164(line), Twiml: twiml, Timeout: '20' })
    });
    if (!res.ok) return { ok: false, error: 'Twilio did not take the call (' + res.status + ').' };
    const out = await res.json().catch(() => ({}));
    return { ok: true, callId: out.sid || null };
  }
  return { ok: false, error: 'No phone line is set up.' };
}

// Comparing hashes keeps the check constant-time without a hand-rolled loop.
async function sameSecret(a, b) { return !!a && !!b && (await sha256hex(a)) === (await sha256hex(b)); }

// Twilio signs the exact webhook URL plus every POST field, sorted by name, with HMAC-SHA1.
async function twilioSigned(request, env, form) {
  const sig = request.headers.get('X-Twilio-Signature');
  if (!sig) return false;
  let data = env.PHONE_WEBHOOK_URL || request.url;
  [...new Set(form.keys())].sort().forEach((k) => { form.getAll(k).sort().forEach((v) => { data += k + v; }); });
  const key = await crypto.subtle.importKey('raw', enc.encode(env.TWILIO_AUTH_TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let bin = '';
  for (let i = 0; i < mac.length; i++) bin += String.fromCharCode(mac[i]);
  return sameSecret(btoa(bin), sig);
}

// The texts in one carrier webhook post as [{ ref, from, to, text, media, at }], or null when the
// post fails its check. A NetSapiens subscription has no signature: it sends the subscription id in
// X-Correlation-ID, which stays secret in NS_SUBSCRIPTION_ID.
export async function readInbound(request, env) {
  const raw = await request.text();
  if (raw.length > 64 * 1024) return null;
  if (env.PHONE_PROVIDER === 'twilio') {
    const form = new URLSearchParams(raw);
    if (!(await twilioSigned(request, env, form))) return null;
    return [{ ref: 'tw' + (form.get('MessageSid') || ''), from: form.get('From'), to: form.get('To'), text: form.get('Body') || '', media: +form.get('NumMedia') || 0, at: Date.now() }];
  }
  if (env.PHONE_PROVIDER === 'connectuc') {
    if (!(await sameSecret(request.headers.get('X-Correlation-ID'), env.NS_SUBSCRIPTION_ID))) return null;
    let list;
    try { list = JSON.parse(raw); } catch { return []; }
    // In the NetSapiens message model "orig" is inbound and "term" is outbound. Confirm against a
    // real post before going live: the docs only show the read model, not the event body.
    return (Array.isArray(list) ? list : [list]).filter((m) => m && m.direction === 'orig' && (m.type === 'sms' || m.type === 'mms'))
      .map((m) => ({ ref: 'uc' + (m.id == null ? '' : m.id), from: m['from-number'], to: m['terminating-number'] || m.dialed, text: m.text || '', media: m.type === 'mms' ? 1 : 0, at: Date.parse(m.timestamp) || Date.now() }));
  }
  return null;
}

// The msgs record public/app.js keeps for a text (see cleanRec), as an unread inbound one.
// The id comes from the carrier's message id, so a retried webhook writes the same record once.
export function inboundRecord(t, now) {
  const ref = String(t.ref || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 70);
  let text = String(t.text || '').trim();
  if (t.media) text = text ? text + ' (picture)' : '(Picture message. Open it on your phone.)';
  return { id: 'm' + (ref.length > 2 ? ref : randomToken(12)), phone: fmtPhone(t.from), dir: 'in', kind: 'text', text: text.slice(0, 2000),
    outcome: null, duration: 0, at: new Date(t.at).toISOString(), read: false, spam: false, via: '', updatedAt: now };
}
