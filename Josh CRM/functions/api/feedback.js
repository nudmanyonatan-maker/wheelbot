// POST /api/feedback { text, page } -> stored for Yonatan. Read it with: npm run feedback
import { json, readJson, requireSession, randomToken } from '../../lib/server.js';

export async function onRequestPost({ request, env }) {
  const s = await requireSession(request, env, true);
  if (s.reply) return s.reply;
  const b = await readJson(request, 20000);
  const text = String((b && b.text) || '').trim().slice(0, 5000);
  if (!text) return json({ ok: false, error: 'Write something first.' }, 400);
  await env.DB.prepare('INSERT INTO feedback (id, ws, user_id, text, page, created) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('fb_' + randomToken(9), s.me.ws, s.me.id, text, String(b.page || '').slice(0, 200), Date.now()).run();
  return json({ ok: true });
}
