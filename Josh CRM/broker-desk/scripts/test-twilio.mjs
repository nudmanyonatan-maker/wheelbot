// Checks the Twilio pieces that work without an account: webhook signature checks (Twilio's own
// documented example), the browser calling token, and the TwiML the desk answers with.
//   node scripts/test-twilio.mjs
import { createHmac } from 'node:crypto';
import { twilio } from '../lib/carrier/twilio.js';
import { twiml } from '../lib/carrier/index.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };

// Twilio's documented example: auth token 12345, this URL and these fields.
const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
const expected = createHmac('sha1', '12345').update(url + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
const req = (sig) => ({ url, headers: { get: (h) => (h === 'X-Twilio-Signature' ? sig : null) } });
ok(await twilio.verify(req(expected), {}, { secret: { authToken: '12345' } }, params), 'valid signature accepted');
ok(!(await twilio.verify(req(expected), {}, { secret: { authToken: '54321' } }, params)), 'wrong token rejected');
ok(!(await twilio.verify(req(expected), {}, { secret: { authToken: '12345' } }, { ...params, Digits: '9999' })), 'tampered field rejected');
ok(!(await twilio.verify(req(''), {}, { secret: { authToken: '12345' } }, params)), 'missing signature rejected');

// The browser calling token: a JWT Twilio can verify with the API key secret.
const acct = { subSid: 'AC00000000000000000000000000000001', secret: { keySid: 'SK00000000000000000000000000000001', keySecret: 'keysecret', appSid: 'AP00000000000000000000000000000001' } };
const { token } = await twilio.voiceToken({}, acct, 'crown.u1', 3600);
const [h, p, s] = token.split('.');
const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
const head = dec(h), body = dec(p);
ok(head.alg === 'HS256' && head.cty === 'twilio-fpa;v=1', 'token header');
ok(body.iss === acct.secret.keySid && body.sub === acct.subSid && body.exp - body.iat === 3600, 'token claims');
ok(body.grants.identity === 'crown.u1' && body.grants.voice.outgoing.application_sid === acct.secret.appSid && body.grants.voice.incoming.allow === true, 'voice grant');
ok(createHmac('sha256', 'keysecret').update(h + '.' + p).digest('base64url') === s, 'token signature');

// TwiML.
const out = twiml.dialOut({ from: '+14165550142', to: '+14165550100', record: true, notice: 'This call may be recorded.', statusUrl: 'https://x/api/phone/status?ws=a&act=b' });
ok(out.startsWith('<Say') && out.includes('callerId="+14165550142"') && out.includes('record="record-from-answer-dual"') && out.includes('&amp;act=b'), 'outbound TwiML with recording notice, escaped');
ok(!twiml.dialOut({ from: '+1', to: '+2', record: false, statusUrl: 'u' }).includes('<Say'), 'no notice when not recording');
const ring = twiml.ringRep({ identity: 'crown.u1', forward: '+16475550100', action: 'https://x/vm' });
ok(ring.includes('<Client>crown.u1</Client>') && ring.includes('<Number>+16475550100</Number>') && ring.includes('timeout="20"'), 'inbound rings the rep and their cell');
ok(twiml.voicemail({ greeting: 'Leave a message <now>', action: 'a' }).includes('&lt;now&gt;'), 'greeting is escaped');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
