// GET /api/email/callback?code=&state= -> Nylas sends people back here after they sign in to their mailbox.
import { q, hmac } from '../../../lib/server.js';
import { finishConnect } from '../../../lib/mail.js';
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), [ws, member, sig] = String(url.searchParams.get('state') || '').split('.');
  const want = (await hmac(env.SECRET_KEY || 'local-dev', 'mail:' + ws + ':' + member)).slice(0, 16);
  if (!ws || sig !== want) return Response.redirect(url.origin + '/#/settings/email?mail=failed', 302);
  try {
    const g = await finishConnect(env, url.origin, url.searchParams.get('code'));
    await q(env, 'INSERT INTO mailboxes (ws, member, provider, address, grant_id, status, connected_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(ws, member) DO UPDATE SET provider = excluded.provider, address = excluded.address, grant_id = excluded.grant_id, status = excluded.status, connected_at = excluded.connected_at',
      ws, member, 'nylas', g.email, g.grantId, 'connected', Date.now()).run();
    return Response.redirect(url.origin + '/#/settings/email?mail=ok', 302);
  } catch { return Response.redirect(url.origin + '/#/settings/email?mail=failed', 302); }
}
