// GET  /api/dialer/:id -> the session and its stats.
// POST /api/dialer/:id { action: 'next', lines } -> the next round of leads to dial.
// POST /api/dialer/:id { action: 'result', activityId, result, duration, ... } -> one line's result.
// POST /api/dialer/:id { action: 'lines', lines } -> change the line count mid-session.
// POST /api/dialer/:id { action: 'end' } -> stops and returns the summary.
import { route, json, fail, q } from '../../../lib/server.js';
import { getSession, nextRound, legResult, endSession, legStates } from '../../../lib/dialer.js';
import { abandonState } from '../../../lib/compliance.js';
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me, params, url }) {
    if (url.searchParams.get('legs')) return json({ ok: true, legs: await legStates(env, me, params.id, url.searchParams.get('legs').split(',')) });
    const s = await getSession(env, me, params.id); return json({ ok: true, session: { id: s.id, title: s.title, lines: s.lines, status: s.status, stats: s.stats, left: s.queue.length } }); },
  async post({ env, me, params, body, url }) {
    if (body.action === 'next') return json({ ok: true, ...(await nextRound(env, me, params.id, body.lines, url.origin)) });
    if (body.action === 'result') return json(await legResult(env, me, params.id, String(body.activityId || ''), body));
    if (body.action === 'lines') {
      const g = await abandonState(env, me.ws), n = Math.max(1, Math.min(5, body.lines | 0, g.maxLines));
      await q(env, 'UPDATE dial_sessions SET lines = ? WHERE ws = ? AND id = ? AND member = ?', n, me.ws, params.id, me.member).run();
      return json({ ok: true, lines: n, guard: g });
    }
    if (body.action === 'end') return json({ ok: true, summary: await endSession(env, me, params.id) });
    throw fail('Unknown action.');
  }
});
