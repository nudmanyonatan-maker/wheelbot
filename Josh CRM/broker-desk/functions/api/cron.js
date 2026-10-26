// POST /api/cron with header X-Cron-Secret -> sends due sequence steps for every brokerage.
// The alerts worker calls this every minute.
import { json, safeEqual } from '../../lib/server.js';
import { tick } from '../../lib/sequences.js';
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || !safeEqual(request.headers.get('X-Cron-Secret') || '', env.CRON_SECRET)) return json({ ok: false }, 403);
  return json({ ok: true, ...(await tick(env, { base: new URL(request.url).origin, limit: 200 })) });
}
