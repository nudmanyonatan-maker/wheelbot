// Nylas webhooks: GET answers the challenge when the webhook is set up; POST brings new messages,
// which land on the matching lead as unread emails. Signed with NYLAS_WEBHOOK_SECRET.
import { one, hmac, safeEqual } from '../../../lib/server.js';
import { inboundEmail } from '../../../lib/mail.js';
export async function onRequestGet({ request }) { return new Response(new URL(request.url).searchParams.get('challenge') || '', { status: 200 }); }
export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const sig = request.headers.get('X-Nylas-Signature') || '';
  if (!env.NYLAS_WEBHOOK_SECRET || !safeEqual(await hmac(env.NYLAS_WEBHOOK_SECRET, raw, 'hex'), sig)) return new Response('Forbidden', { status: 403 });
  let ev; try { ev = JSON.parse(raw); } catch { return new Response('', { status: 400 }); }
  if (ev.type !== 'message.created') return new Response('', { status: 200 });
  const m = ev.data && ev.data.object || {}, grant = m.grant_id;
  const box = grant ? await one(env, 'SELECT ws, member, address FROM mailboxes WHERE grant_id = ?', grant) : null;
  const from = ((m.from || [])[0] || {}).email || '';
  if (box && from && from.toLowerCase() !== String(box.address).toLowerCase())
    await inboundEmail(env, box.ws, { member: box.member, from, subject: m.subject || '', body: m.snippet || '', id: m.id, thread: m.thread_id });
  return new Response('', { status: 200 });
}
