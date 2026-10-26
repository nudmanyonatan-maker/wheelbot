// POST /api/push { action: 'subscribe', sub } saves this device for follow-up alerts.
// POST /api/push { action: 'unsubscribe', endpoint } removes it.
// POST /api/push { action: 'test' } sends a test alert to every device on the account.
import { json, readJson, requireSession } from '../../lib/server.js';
import { sendPush } from '../../lib/webpush.js';

const ENDPOINT_RX = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[^\s]{1,1500}$/;
const KEY_RX = /^[A-Za-z0-9_-]{16,200}$/;

export async function onRequestPost({ request, env }) {
  const s = await requireSession(request, env, true);
  if (s.reply) return s.reply;
  const b = (await readJson(request, 8000)) || {};
  if (b.action === 'subscribe') {
    const sub = b.sub || {}, keys = sub.keys || {};
    if (!ENDPOINT_RX.test(sub.endpoint || '') || !KEY_RX.test(keys.p256dh || '') || !KEY_RX.test(keys.auth || '')) return json({ ok: false, error: 'That device could not be saved.' }, 400);
    await env.DB.prepare('INSERT INTO push_subs (endpoint, ws, user_id, p256dh, auth, ua, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET ws = excluded.ws, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua')
      .bind(sub.endpoint, s.me.ws, s.me.id, keys.p256dh, keys.auth, (request.headers.get('User-Agent') || '').slice(0, 200), Date.now()).run();
    return json({ ok: true });
  }
  if (b.action === 'unsubscribe') {
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(b.endpoint || ''), s.me.id).run();
    return json({ ok: true });
  }
  if (b.action === 'test') {
    if (!env.VAPID_PRIVATE_JWK) return json({ ok: false, error: 'Alerts are not set up on the server yet.' }, 503);
    const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').bind(s.me.id).all()).results || [];
    const opts = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT, ttl: 600 };
    let sent = 0;
    for (const sub of subs) {
      const r = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, { title: 'ISO Desk alerts are on', body: 'Follow-ups will show up here when they come due.', tag: 'test', url: '/' }, opts);
      if (r.ok) sent++;
      if (r.gone) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
    }
    return json({ ok: sent > 0, sent, devices: subs.length });
  }
  return json({ ok: false, error: 'Unknown action' }, 400);
}
