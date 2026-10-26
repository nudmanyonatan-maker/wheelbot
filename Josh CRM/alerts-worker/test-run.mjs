import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { generateVapidKeys } from '../lib/webpush.js';
import { runAlerts } from './src/index.js';

function createFakeDb({ alerts, subs }) {
  return {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) {
          this._binds = args;
          return this;
        },
        async run() {
          if (sql === 'UPDATE alerts SET sent_at = -1 WHERE sent_at IS NULL AND at <= ?') {
            const cutoff = this._binds[0];
            for (const a of alerts) {
              if (a.sent_at == null && a.at <= cutoff) a.sent_at = -1;
            }
            return { success: true };
          }
          if (sql === 'DELETE FROM push_subs WHERE endpoint = ?') {
            const endpoint = this._binds[0];
            const idx = subs.findIndex((s) => s.endpoint === endpoint);
            if (idx >= 0) subs.splice(idx, 1);
            return { success: true };
          }
          if (sql === 'UPDATE alerts SET sent_at = ? WHERE ws = ? AND fid = ?') {
            const [sentAt, ws, fid] = this._binds;
            const a = alerts.find((r) => r.ws === ws && r.fid === fid);
            if (a) a.sent_at = sentAt;
            return { success: true };
          }
          throw new Error('unexpected run sql: ' + sql);
        },
        async all() {
          if (
            sql ===
            'SELECT ws, fid, rec_kind, rec_id, at, title, body, member FROM alerts WHERE sent_at IS NULL AND at <= ? ORDER BY at LIMIT 100'
          ) {
            const t = this._binds[0];
            const results = alerts
              .filter((a) => a.sent_at == null && a.at <= t)
              .sort((a, b) => a.at - b.at)
              .slice(0, 100)
              .map((a) => ({ ...a }));
            return { results };
          }
          if (
            sql ===
            'SELECT p.endpoint, p.ws, p.user_id, p.p256dh, p.auth, p.ua, p.created, u.member FROM push_subs p LEFT JOIN users u ON u.id = p.user_id WHERE p.ws = ?'
          ) {
            const ws = this._binds[0];
            const results = subs.filter((s) => s.ws === ws).map((s) => ({ ...s }));
            return { results };
          }
          throw new Error('unexpected all sql: ' + sql);
        },
        async first() {
          const { results } = await this.all();
          return results[0] || null;
        },
      };
      return stmt;
    },
  };
}

function makePushKeys() {
  const ecdh = nodeCrypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey(null, 'uncompressed').toString('base64url'),
    auth: nodeCrypto.randomBytes(16).toString('base64url'),
  };
}

const keys = await generateVapidKeys();
const now = Date.now();

const alerts = [
  {
    ws: 'ws1',
    fid: 'fid-due',
    rec_kind: 'deals',
    rec_id: 'd1',
    at: now - 60_000,
    title: 'Due deal',
    body: 'Check deal',
    sent_at: null,
  },
  {
    ws: 'ws1',
    fid: 'fid-owned',
    rec_kind: 'shops',
    rec_id: 's2',
    at: now - 30_000,
    title: 'Dana only',
    body: 'Only her phone',
    sent_at: null,
    member: 'mB',
  },
  {
    ws: 'ws1',
    fid: 'fid-stale',
    rec_kind: 'shops',
    rec_id: 's1',
    at: now - 20 * 60_000,
    title: 'Stale',
    body: 'Old',
    sent_at: null,
  },
  {
    ws: 'ws1',
    fid: 'fid-future',
    rec_kind: 'deals',
    rec_id: 'd2',
    at: now + 60_000,
    title: 'Future',
    body: 'Later',
    sent_at: null,
  },
];

const k0 = makePushKeys();
const k1 = makePushKeys();
const k2 = makePushKeys();
const subs = [
  {
    endpoint: 'https://push.example/ok',
    ws: 'ws1',
    user_id: 'u1',
    member: 'mA',
    p256dh: k0.p256dh,
    auth: k0.auth,
    ua: 'test',
    created: now,
  },
  {
    endpoint: 'https://push.example/gone',
    ws: 'ws1',
    user_id: 'u2',
    member: 'mC',
    p256dh: k1.p256dh,
    auth: k1.auth,
    ua: 'test',
    created: now,
  },
  {
    endpoint: 'https://push.example/b',
    ws: 'ws1',
    user_id: 'u3',
    member: 'mB',
    p256dh: k2.p256dh,
    auth: k2.auth,
    ua: 'test',
    created: now,
  },
];

const captured = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  captured.push({ url: String(url), init });
  if (String(url).includes('/gone')) {
    return new Response('', { status: 410 });
  }
  return new Response('', { status: 201 });
};

try {
  const db = createFakeDb({ alerts, subs });
  const env = {
    DB: db,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
    VAPID_SUBJECT: 'mailto:test@example.com',
  };

  const result = await runAlerts(env, now);

  // fid-due has no owner, so every device gets it (one is gone); fid-owned reaches only mB's device.
  assert.equal(result.sentAlerts, 2);
  assert.equal(result.sentDevices, 3);
  assert.equal(alerts.find((a) => a.fid === 'fid-owned').sent_at, now);

  const due = alerts.find((a) => a.fid === 'fid-due');
  assert.equal(due.sent_at, now);

  const stale = alerts.find((a) => a.fid === 'fid-stale');
  assert.equal(stale.sent_at, -1);

  const future = alerts.find((a) => a.fid === 'fid-future');
  assert.equal(future.sent_at, null);

  assert.deepEqual(subs.map((x) => x.endpoint), ['https://push.example/ok', 'https://push.example/b']);

  const sent = captured.map((c) => c.url + ' ' + c.init.headers.Topic).sort();
  assert.deepEqual(sent, [
    'https://push.example/b fid-due',
    'https://push.example/b fid-owned',
    'https://push.example/gone fid-due',
    'https://push.example/ok fid-due',
  ]);

  for (const c of captured) {
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(c.init.headers.Authorization.startsWith('vapid t='));
  }

  console.log('alerts-worker test-run passed');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  globalThis.fetch = realFetch;
}
