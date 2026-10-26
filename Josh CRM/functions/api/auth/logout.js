// POST /api/auth/logout -> ends this device's session.
import { json, sameOrigin, cookieValue, sha256hex, clearCookie } from '../../../lib/server.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const token = cookieValue(request);
  if (token && token.length <= 100) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
}
