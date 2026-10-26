// POST /api/feedback { text, route } -> saves a note about the desk, with the screen it was sent from.
// GET  /api/feedback -> every note for this workspace, newest first (managers).
// POST /api/feedback { action: 'done', id } -> marks a note handled.
import { route, json, fail, q, all, isManager } from '../../lib/server.js';
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) {
    if (!isManager(me)) throw fail('Only a manager can read feedback.', 403);
    const rows = await all(env, 'SELECT id, at, who, guest, route, text, done_at FROM feedback WHERE ws = ? ORDER BY at DESC LIMIT 500', me.ws);
    return json({ ok: true, feedback: rows.map((r) => ({ id: r.id, at: r.at, who: r.guest ? r.who + ' (demo login)' : r.who, route: r.route, text: r.text, done: !!r.done_at })) });
  },
  async post({ env, me, body, request }) {
    if (body.action === 'done') {
      if (!isManager(me)) throw fail('Only a manager can do that.', 403);
      await q(env, 'UPDATE feedback SET done_at = ? WHERE ws = ? AND id = ?', body.undo ? null : Date.now(), me.ws, body.id | 0).run();
      return json({ ok: true });
    }
    const text = String(body.text || '').trim().slice(0, 4000);
    if (!text) throw fail('Write what you\'d change first.');
    const recent = await all(env, 'SELECT id FROM feedback WHERE ws = ? AND at > ?', me.ws, Date.now() - 3600000);
    if (recent.length > 200) throw fail('That\'s a lot of notes in an hour. Try again later.', 429);
    await q(env, 'INSERT INTO feedback (ws, at, member, who, guest, route, text, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', me.ws, Date.now(), me.member, me.name, me.guest ? 1 : 0,
      String(body.route || '').slice(0, 200), text, (request.headers.get('User-Agent') || '').slice(0, 200)).run();
    return json({ ok: true });
  }
});
