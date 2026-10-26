const RS = 4096;
const TEXT = new TextEncoder();

export function b64urlEncode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function strBytes(s) {
  return TEXT.encode(s);
}

async function hkdf(ikm, salt, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    bits
  );
  return new Uint8Array(raw);
}

async function exportUncompressedP256(publicKey) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error('expected uncompressed P-256 public key');
  }
  return raw;
}

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicKey = b64urlEncode(await exportUncompressedP256(pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKey,
    privateJwk: {
      kty: privateJwk.kty,
      crv: privateJwk.crv,
      x: privateJwk.x,
      y: privateJwk.y,
      d: privateJwk.d,
    },
  };
}

export async function vapidAuthHeader(endpoint, { publicKey, privateJwk, subject }) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = { aud, exp, sub: subject };
  const unsigned =
    b64urlEncode(strBytes(JSON.stringify(header))) +
    '.' +
    b64urlEncode(strBytes(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    'jwk',
    { ...privateJwk, kty: 'EC', crv: 'P-256', ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      strBytes(unsigned)
    )
  );
  const jwt = unsigned + '.' + b64urlEncode(sig);
  return 'vapid t=' + jwt + ', k=' + publicKey;
}

export async function encryptPayload(payload, { p256dh, auth }) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const plaintext =
    typeof payload === 'string' ? strBytes(payload) : new Uint8Array(payload);

  const asPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const asPublic = await exportUncompressedP256(asPair.publicKey);
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey },
      asPair.privateKey,
      256
    )
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(
    strBytes('WebPush: info'),
    new Uint8Array([0]),
    uaPublic,
    asPublic
  );
  const ikm = await hkdf(shared, authSecret, keyInfo, 256);

  const cek = await hkdf(
    ikm,
    salt,
    concat(strBytes('Content-Encoding: aes128gcm'), new Uint8Array([0])),
    128
  );
  const nonce = await hkdf(
    ikm,
    salt,
    concat(strBytes('Content-Encoding: nonce'), new Uint8Array([0])),
    96
  );

  const padded = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  header[16] = (RS >>> 24) & 0xff;
  header[17] = (RS >>> 16) & 0xff;
  header[18] = (RS >>> 8) & 0xff;
  header[19] = RS & 0xff;
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

function sanitizeTopic(topic) {
  if (topic == null || topic === '') return null;
  const s = String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return s || null;
}

export async function sendPush(subscription, payloadObject, opts) {
  const {
    publicKey,
    privateJwk,
    subject,
    ttl = 86400,
    urgency = 'high',
    topic,
  } = opts;
  try {
    const body = await encryptPayload(JSON.stringify(payloadObject), {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    });
    const headers = {
      Authorization: await vapidAuthHeader(subscription.endpoint, {
        publicKey,
        privateJwk,
        subject,
      }),
      TTL: String(ttl),
      Urgency: urgency,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    };
    const t = sanitizeTopic(topic);
    if (t) headers.Topic = t;

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers,
      body,
    });
    const status = res.status;
    return {
      status,
      ok: res.ok,
      gone: status === 404 || status === 410,
    };
  } catch {
    return { status: 0, ok: false, gone: false };
  }
}
