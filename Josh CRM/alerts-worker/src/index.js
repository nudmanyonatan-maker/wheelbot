import { sendPush } from '../../lib/webpush.js';

const STALE_MS = 15 * 60 * 1000;

const SQL_MARK_STALE =
  'UPDATE alerts SET sent_at = -1 WHERE sent_at IS NULL AND at <= ?';
const SQL_SELECT_DUE =
  'SELECT ws, fid, rec_kind, rec_id, at, title, body, member FROM alerts WHERE sent_at IS NULL AND at <= ? ORDER BY at LIMIT 100';
// Each device with the member it belongs to, so a follow-up only reaches the person it is for.
const SQL_SELECT_SUBS =
  'SELECT p.endpoint, p.ws, p.user_id, p.p256dh, p.auth, p.ua, p.created, u.member FROM push_subs p LEFT JOIN users u ON u.id = p.user_id WHERE p.ws = ?';
const SQL_DELETE_SUB = 'DELETE FROM push_subs WHERE endpoint = ?';
const SQL_MARK_SENT = 'UPDATE alerts SET sent_at = ? WHERE ws = ? AND fid = ?';

function sanitizeTopic(fid) {
  return String(fid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

function openUrl(recKind, recId) {
  const kind = recKind === 'deals' ? 'deal' : 'shop';
  return '/#open=' + kind + ':' + recId;
}

function vapidOpts(env) {
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK),
    subject: env.VAPID_SUBJECT,
  };
}

export async function runAlerts(env, now) {
  const db = env.DB;
  await db.prepare(SQL_MARK_STALE).bind(now - STALE_MS).run();

  const { results: alerts } = await db.prepare(SQL_SELECT_DUE).bind(now).all();
  if (!alerts || alerts.length === 0) {
    console.log('sent 0 alerts to 0 devices');
    return { sentAlerts: 0, sentDevices: 0 };
  }

  const byWs = new Map();
  for (const a of alerts) {
    if (!byWs.has(a.ws)) byWs.set(a.ws, []);
    byWs.get(a.ws).push(a);
  }

  const opts = vapidOpts(env);
  let sentAlerts = 0;
  let sentDevices = 0;

  for (const [ws, rows] of byWs) {
    const { results: subs } = await db.prepare(SQL_SELECT_SUBS).bind(ws).all();
    const list = subs || [];

    for (const alert of rows) {
      try {
        const payload = {
          title: alert.title,
          body: alert.body,
          tag: alert.fid,
          url: openUrl(alert.rec_kind, alert.rec_id),
        };
        const topic = sanitizeTopic(alert.fid);
        // Alerts saved before follow-ups had an owner go to every device on the workspace.
        const targets = alert.member ? list.filter((sub) => sub.member === alert.member) : list;
        for (const sub of targets) {
          const result = await sendPush(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            { ...opts, topic }
          );
          if (result.ok) sentDevices += 1;
          if (result.gone) {
            await db.prepare(SQL_DELETE_SUB).bind(sub.endpoint).run();
          }
        }
        await db.prepare(SQL_MARK_SENT).bind(now, alert.ws, alert.fid).run();
        sentAlerts += 1;
      } catch (err) {
        console.log('alert failed ' + alert.ws + '/' + alert.fid + ': ' + (err && err.message));
      }
    }
  }

  console.log('sent ' + sentAlerts + ' alerts to ' + sentDevices + ' devices');
  return { sentAlerts, sentDevices };
}

export default {
  async scheduled(controller, env, ctx) {
    const now = Date.now();
    ctx.waitUntil(runAlerts(env, now));
  },

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok');
    }
    return new Response('Not Found', { status: 404 });
  },
};
