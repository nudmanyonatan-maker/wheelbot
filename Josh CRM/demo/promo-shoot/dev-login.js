// FILMING COPY ONLY. Never deployed. Signs the recorder in as a made-up local user.
import { createSession } from '../../lib/server.js';
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (u.hostname !== 'localhost') return new Response('Not found', { status: 404 });
  const user = await env.DB.prepare('SELECT id, ws FROM users WHERE email = ?').bind(u.searchParams.get('email') || '').first();
  if (!user) return new Response('No such local user', { status: 404 });
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': await createSession(env, user, request) } });
}
