// The private workspace store. Records live in their own tables (see lib/book.js and
// db/migrations/0002_book.sql); this route keeps the shape the app has always used.
// GET  /api/data?since=<ms> -> { now, shops: {id: rec}, deals: {...}, msgs: {...}, meta: {...} } changed since then (everything when since is 0).
//      A rep gets only their own book; a shop handed to someone else comes back as a deletion.
// POST /api/data { shops: [rec], deals: [...], msgs: [...], meta: [...] } -> keeps each record unless the stored copy is newer.
//      Deletes arrive as { id, deleted: true, updatedAt } tombstones. Changes outside the caller's
//      book are refused and listed in `denied`. Every accepted change is written to the audit log.
//      An updatedAt later than the server's clock is saved as the server's time; `stamped` lists
//      those as { kind, id, updatedAt } so the device can take the stored time.
import { json, readJson, requireSession, KINDS } from '../../lib/server.js';
import { readBook, saveBook } from '../../lib/book.js';

const MAX_BODY = 4 * 1024 * 1024, MAX_RECS = 400;

export async function onRequestGet({ request, env }) {
  const s = await requireSession(request, env, false);
  if (s.reply) return s.reply;
  const since = Math.max(0, +new URL(request.url).searchParams.get('since') || 0);
  return new Response(await readBook(env, s.me, since), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const s = await requireSession(request, env, true);
  if (s.reply) return s.reply;
  const b = await readJson(request, MAX_BODY);
  if (!b || typeof b !== 'object') return json({ ok: false, error: 'The save was not readable.' }, 400);
  const count = KINDS.reduce((t, k) => t + (Array.isArray(b[k]) ? b[k].length : 0), 0);
  if (count > MAX_RECS) return json({ ok: false, error: 'Too many changes in one save.' }, 413);
  const res = await saveBook(env, s.me, b);
  return json({ ok: true, written: res.written, rejected: res.rejected, denied: res.denied, stamped: res.stamped, now: res.now });
}
