// POST /api/import-check { names: [shop names], phones: [numbers], domains: [email domains] }
// -> { names: { <normName>: shop }, phones: { <10 digits>: shop }, domains: { <domain>: shop } }
// Before an import, says which shops in the file are already on the team, under any spelling,
// by a phone number or by a company email domain. A shop outside the caller's book comes back
// with its owner's name and no id: the rep learns it is taken without seeing inside it.
import { json, readJson, requireSession } from '../../lib/server.js';
import { matchShops } from '../../lib/book.js';

export async function onRequestPost({ request, env }) {
  const s = await requireSession(request, env, true);
  if (s.reply) return s.reply;
  const b = await readJson(request, 1024 * 1024);
  if (!b || typeof b !== 'object') return json({ ok: false, error: 'The list was not readable.' }, 400);
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 200) : []);
  return json(Object.assign({ ok: true }, await matchShops(env, s.me, list(b.names), list(b.phones), list(b.domains))));
}
