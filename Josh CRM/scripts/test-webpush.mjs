import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  b64urlEncode,
  b64urlDecode,
  encryptPayload,
  generateVapidKeys,
  vapidAuthHeader,
} from '../lib/webpush.js';

const require = createRequire(import.meta.url);
const ece = require('http_ece');

function nodeB64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function parseAes128gcmHeader(body) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  return { salt, rs, idlen, asPublic, ciphertext };
}

function independentDecrypt(body, uaEcdh, authSecret) {
  const { salt, asPublic, ciphertext } = parseAes128gcmHeader(Buffer.from(body));
  const shared = uaEcdh.computeSecret(asPublic);
  const uaPublic = uaEcdh.getPublicKey(null, 'uncompressed');
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
  ]);
  const ikm = crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32);
  const cek = crypto.hkdfSync(
    'sha256',
    ikm,
    salt,
    Buffer.from('Content-Encoding: aes128gcm\0'),
    16
  );
  const nonce = crypto.hkdfSync(
    'sha256',
    ikm,
    salt,
    Buffer.from('Content-Encoding: nonce\0'),
    12
  );
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(enc), decipher.final()]);
  assert.equal(padded[padded.length - 1], 0x02, 'trailing 0x02 delimiter');
  return padded.subarray(0, padded.length - 1);
}

function makeSubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    keys: {
      p256dh: nodeB64urlEncode(ecdh.getPublicKey(null, 'uncompressed')),
      auth: nodeB64urlEncode(auth),
    },
  };
}

async function testEncryptRoundTrip() {
  const sub = makeSubscription();
  const payloads = [
    JSON.stringify({ hello: 'world', n: 1 }),
    'x'.repeat(1200),
    JSON.stringify({ msg: 'שלום café 日本語 🔔' }),
  ];
  for (const payload of payloads) {
    const body = await encryptPayload(payload, sub.keys);
    const plain = independentDecrypt(body, sub.ecdh, sub.auth);
    assert.equal(plain.toString('utf8'), payload);

    const ecePlain = ece.decrypt(Buffer.from(body), {
      version: 'aes128gcm',
      privateKey: sub.ecdh,
      authSecret: sub.keys.auth,
    });
    assert.equal(ecePlain.toString('utf8'), payload);
  }
}

async function testVapid() {
  const { publicKey, privateJwk } = await generateVapidKeys();
  const subject = 'mailto:test@example.com';
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  const header = await vapidAuthHeader(endpoint, { publicKey, privateJwk, subject });
  assert.match(header, /^vapid t=[^,]+, k=/);
  const jwt = header.slice('vapid t='.length, header.indexOf(', k='));
  const k = header.slice(header.indexOf(', k=') + 4);
  assert.equal(k, publicKey);

  const [hB64, cB64, sB64] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(cB64, 'base64url').toString('utf8'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, subject);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp > now);
  assert.ok(claims.exp <= now + 12 * 60 * 60);

  const pubRaw = b64urlDecode(publicKey);
  const verifyKey = await crypto.subtle.importKey(
    'raw',
    pubRaw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    verifyKey,
    b64urlDecode(sB64),
    new TextEncoder().encode(hB64 + '.' + cB64)
  );
  assert.equal(ok, true);

  // Sanity on helpers
  const round = b64urlDecode(b64urlEncode(new Uint8Array([1, 2, 255])));
  assert.deepEqual([...round], [1, 2, 255]);
}

try {
  await testEncryptRoundTrip();
  await testVapid();
  console.log('webpush tests passed');
} catch (err) {
  console.error(err);
  process.exit(1);
}
