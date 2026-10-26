// Twilio, the real carrier. One master account (env.TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) holds a
// sub-account per brokerage, so numbers, usage and texting registration stay separate, like
// GoHighLevel's phone system. Everything the desk needs is a plain REST call, so it runs in a Worker.
//
// Per sub-account we keep (sealed): its auth token (to check webhook signatures), an API key and
// secret (to mint browser calling tokens) and a TwiML app (where browser calls are sent).
//
// Not live-tested yet: it needs the master account. The demo line (sim.js) runs the same screens.
import { b64url } from '../server.js';

const API = 'https://api.twilio.com/2010-04-01';
const enc = new TextEncoder();

function auth(env) { return 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN); }
async function tw(env, method, path, params) {
  const body = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])) : undefined;
  const res = await fetch(API + path, { method, headers: { Authorization: auth(env), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.message || 'Twilio said no (' + res.status + ')'); e.expose = true; e.status = 502; e.code = j.code; throw e; }
  return j;
}
const sub = (acct) => API_SUB(acct.subSid);
const API_SUB = (sid) => '/Accounts/' + sid;

async function hmacB64(alg, secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: alg }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  let s = ''; for (let i = 0; i < sig.length; i++) s += String.fromCharCode(sig[i]);
  return btoa(s);
}

export const twilio = {
  name: 'twilio',
  // Creates the brokerage's sub-account, an API key for browser calling, and the TwiML app that
  // browser calls go to. base is this site's origin, for the webhooks.
  async ensureAccount(env, ws, wsName, base) {
    const a = await tw(env, 'POST', '/Accounts.json', { FriendlyName: 'Broker Desk: ' + (wsName || ws) });
    const key = await tw(env, 'POST', API_SUB(a.sid) + '/Keys.json', { FriendlyName: 'Broker Desk browser calling' });
    const app = await tw(env, 'POST', API_SUB(a.sid) + '/Applications.json', {
      FriendlyName: 'Broker Desk calls', VoiceUrl: base + '/api/phone/voice?ws=' + encodeURIComponent(ws), VoiceMethod: 'POST',
      StatusCallback: base + '/api/phone/status?ws=' + encodeURIComponent(ws), StatusCallbackMethod: 'POST'
    });
    return { subSid: a.sid, secret: { authToken: a.auth_token, keySid: key.sid, keySecret: key.secret, appSid: app.sid } };
  },
  async searchNumbers(env, acct, { areaCode, contains }) {
    const qs = new URLSearchParams({ VoiceEnabled: 'true', SmsEnabled: 'true', PageSize: '12' });
    if (/^\d{3}$/.test(String(areaCode || ''))) qs.set('AreaCode', areaCode);
    if (contains) qs.set('Contains', String(contains).replace(/[^0-9*]/g, '').slice(0, 7));
    const j = await tw(env, 'GET', sub(acct) + '/AvailablePhoneNumbers/CA/Local.json?' + qs);
    return (j.available_phone_numbers || []).map((n) => ({ e164: n.phone_number, locality: n.locality || '', region: n.region || '' }));
  },
  async buyNumber(env, acct, e164, base, ws) {
    const n = await tw(env, 'POST', sub(acct) + '/IncomingPhoneNumbers.json', {
      PhoneNumber: e164, VoiceUrl: base + '/api/phone/inbound?ws=' + encodeURIComponent(ws), VoiceMethod: 'POST',
      SmsUrl: base + '/api/phone/sms-in?ws=' + encodeURIComponent(ws), SmsMethod: 'POST',
      StatusCallback: base + '/api/phone/status?ws=' + encodeURIComponent(ws), AddressSid: env.TWILIO_ADDRESS_SID
    });
    return { sid: n.sid };
  },
  async releaseNumber(env, acct, sid) { await tw(env, 'DELETE', sub(acct) + '/IncomingPhoneNumbers/' + sid + '.json'); return true; },
  // A Twilio Access Token with a Voice grant, so the browser can place and take calls as `identity`.
  async voiceToken(env, acct, identity, ttl = 3600) {
    const s = acct.secret || {}, now = Math.floor(Date.now() / 1000);
    const head = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
    const body = { jti: s.keySid + '-' + now, iss: s.keySid, sub: acct.subSid, iat: now, exp: now + ttl,
      grants: { identity, voice: { incoming: { allow: true }, outgoing: { application_sid: s.appSid } } } };
    const part = (o) => b64url(enc.encode(JSON.stringify(o)));
    const unsigned = part(head) + '.' + part(body);
    const key = await crypto.subtle.importKey('raw', enc.encode(s.keySecret || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(unsigned))));
    return { token: unsigned + '.' + sig, ttl };
  },
  async sendSms(env, acct, { from, to, body, statusUrl, mediaUrl }) {
    const m = await tw(env, 'POST', sub(acct) + '/Messages.json', { From: from, To: to, Body: body, StatusCallback: statusUrl, MediaUrl: mediaUrl });
    return { sid: m.sid, status: m.status };
  },
  // One outbound leg for the multi-line dialer. Voicemail detection waits for the greeting to end, so
  // a dropped voicemail starts after the beep.
  async placeCall(env, acct, { from, to, url, statusUrl, amd = true }) {
    const c = await tw(env, 'POST', sub(acct) + '/Calls.json', {
      From: from, To: to, Url: url, Method: 'POST', StatusCallback: statusUrl, StatusCallbackMethod: 'POST',
      'StatusCallbackEvent': 'initiated ringing answered completed', MachineDetection: amd ? 'DetectMessageEnd' : null, Timeout: 25
    });
    return { sid: c.sid };
  },
  async updateCall(env, acct, sid, { twiml, status }) {
    await tw(env, 'POST', sub(acct) + '/Calls/' + sid + '.json', { Twiml: twiml, Status: status });
    return true;
  },
  // X-Twilio-Signature: HMAC-SHA1 of the full URL plus every POST field (sorted, name then value).
  async verify(request, env, acct, params) {
    const sig = request.headers.get('X-Twilio-Signature') || '';
    const token = (acct && acct.secret && acct.secret.authToken) || env.TWILIO_AUTH_TOKEN || '';
    if (!sig || !token) return false;
    const url = request.url, keys = Object.keys(params || {}).sort();
    const data = url + keys.map((k) => k + params[k]).join('');
    return (await hmacB64('SHA-1', token, data)) === sig;
  },
  // The desk collects everything the carriers ask for. Until the Trust Hub calls are automated, the
  // platform owner submits it in the Twilio console and marks it approved in the admin view.
  async submitRegistration() { return { status: 'review', submittedAt: Date.now(), ref: null, manual: true }; },
  registrationStatus(reg) { return (reg && reg.status) || 'draft'; }
};
