// Inbound texts to a rep's business number. Stub until the line is connected (lib/phone.js).
// The carrier posts here: a Twilio messaging webhook, or a NetSapiens "message" event subscription
// for Connect UC. Each text becomes an unread msgs record in the book of the rep who owns the
// number, so it shows up in Messages on the next sync. Texts from numbers the rep blocked are dropped.
import { json, validRecord } from '../../../lib/server.js';
import { saveMessages } from '../../../lib/book.js';
import { digits, lines, phoneReady, readInbound, inboundRecord } from '../../../lib/phone.js';

// An empty TwiML reply tells Twilio there is no auto-reply. NetSapiens only needs a 200.
function done(env) {
  return env.PHONE_PROVIDER === 'twilio'
    ? new Response('<Response/>', { headers: { 'Content-Type': 'text/xml' } })
    : json({ ok: true });
}

async function blockedFor(env, ws, member) {
  const row = await env.DB.prepare('SELECT data FROM settings WHERE ws = ? AND member = ?').bind(ws, member).first();
  let st = {};
  try { st = row ? JSON.parse(row.data) : {}; } catch { /* unreadable settings block nothing */ }
  return new Set((Array.isArray(st.blocked) ? st.blocked : []).map((b) => digits(b && b.phone)));
}

export async function onRequestPost({ request, env }) {
  if (!phoneReady(env)) return json({ ok: false, error: 'No phone line is set up.' }, 404);
  const texts = await readInbound(request, env);
  if (!texts) return json({ ok: false }, 403);
  const owners = lines(env), now = Date.now(), byLine = {};
  texts.forEach((t) => {
    const n = digits(t.to);
    if (!owners[n] || !digits(t.from)) return;
    const rec = inboundRecord(t, now);
    if (validRecord('msgs', rec)) (byLine[n] = byLine[n] || []).push(rec);
  });
  for (const n of Object.keys(byLine)) {
    const line = owners[n], blocked = await blockedFor(env, line.ws, line.member);
    const keep = byLine[n].filter((r) => !blocked.has(digits(r.phone)));
    // Insert-only, so a carrier retry never marks a text unread again. Logged as "Phone line".
    if (keep.length) await saveMessages(env, line, keep);
  }
  return done(env);
}
