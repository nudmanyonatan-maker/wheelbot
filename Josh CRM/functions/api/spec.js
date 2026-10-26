// Cloudflare Pages Function — spec-mode comment store.
// GET  /api/spec        -> { comments: [...] }
// POST /api/spec  body: { comments: [...] }  -> { ok: true, count }
//
// POST MERGES by comment id (newest updatedAt wins) so multiple reviewers can
// comment at once without clobbering each other. Deletes ride along as
// { deleted:true } tombstones. Storage: the existing NOTES_KV namespace under a
// separate key, so no new binding is needed.

const KEY = 'spec-comments';
const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

async function readAll(env) {
  const raw = await env.NOTES_KV.get(KEY);
  return raw ? JSON.parse(raw) : [];
}

function mergeById(existing, incoming) {
  const byId = new Map();
  const ver = (n) => Number((n && (n.updatedAt ?? n.ts)) || 0);
  for (const n of existing) if (n && typeof n.id === 'string') byId.set(n.id, n);
  for (const n of incoming) {
    if (!n || typeof n.id !== 'string') continue;
    const cur = byId.get(n.id);
    if (!cur || ver(n) >= ver(cur)) byId.set(n.id, n);
  }
  return Array.from(byId.values());
}

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ comments: await readAll(env) }), { headers: noStore });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const incoming = Array.isArray(body?.comments) ? body.comments : [];
  const merged = mergeById(await readAll(env), incoming);
  await env.NOTES_KV.put(KEY, JSON.stringify(merged));
  return new Response(JSON.stringify({ ok: true, count: merged.length }), { headers: noStore });
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { ...noStore, Allow: 'GET, POST' },
  });
}
