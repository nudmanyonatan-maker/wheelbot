// Click to call from the desk's business number. Stub until the line is connected (lib/phone.js).
// POST /api/phone/call { phone } -> { ok, callId, from }. The carrier rings Josh first (his
// Connect UC app, or his cell on Twilio) and dials the shop when he picks up. The desk still logs
// the call itself at wrap-up, the same msgs record today's tel: flow writes, so nothing doubles.
import { json, readJson, requireSession } from '../../../lib/server.js';
import { digits, fmtPhone, dialable, lineFor, phoneReady, placeCall } from '../../../lib/phone.js';

export async function onRequestPost({ request, env }) {
  const s = await requireSession(request, env, true);
  if (s.reply) return s.reply;
  if (!phoneReady(env)) return json({ ok: false, error: 'Calling from the desk is not connected yet.', notConnected: true }, 501);
  // Only the person whose number it is can call from it.
  const line = lineFor(env, s.me.ws, s.me.member);
  if (!line) return json({ ok: false, error: 'This desk has no business line yet.', notConnected: true }, 403);
  const b = await readJson(request, 2048);
  const to = digits(b && b.phone);
  if (!dialable(to)) return json({ ok: false, error: 'That is not a US number the desk can call.' }, 400);
  const r = await placeCall(env, { line, to, agent: digits(s.me.phone) });
  if (!r.ok) return json({ ok: false, error: r.error }, 502);
  return json({ ok: true, callId: r.callId, from: fmtPhone(line) });
}
