// GET  /api/inbox?team=1 -> what is waiting: missed calls, voicemails, texts, emails, applications,
//      lender replies and tasks due today. Also sends any sequence steps that are due, so the demo
//      runs without the cron worker.
// GET  /api/inbox?count=1 -> just the number, for the badge.
// POST /api/inbox { done: [activity ids] } -> handled.
import { route, json } from '../../lib/server.js';
import { inbox, inboxCount, markHandled } from '../../lib/activity.js';
import { tick } from '../../lib/sequences.js';

export const { onRequestGet, onRequestPost } = route({
  async get({ env, me, url }) {
    const base = url.origin;
    try { await tick(env, { ws: me.ws, base, limit: 25 }); } catch (e) { console.error('tick', e); }
    if (url.searchParams.get('count')) return json({ ok: true, count: await inboxCount(env, me) });
    return json({ ok: true, ...(await inbox(env, me, { team: url.searchParams.get('team') === '1' })) });
  },
  async post({ env, me, body }) { return json({ ok: true, handled: await markHandled(env, me, body.done) }); }
});
