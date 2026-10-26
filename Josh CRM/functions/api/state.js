// Cloudflare Pages Function: the shared store behind ISO Desk.
// GET  /api/state  -> { epoch, shops: {id: rec}, deals: {...}, msgs: {...}, meta: {...} }
// POST /api/state  { epoch, shops: [rec], deals: [rec], ... } merges record by record, newest updatedAt wins.
//                  Deletes ride along as { id, deleted: true, updatedAt } tombstones.
// POST /api/state  { reset: true } wipes every saved change and starts a new epoch, so open
//                  tabs know to reload the starting data.
// Only edits are stored here. The starting data is built in the browser, relative to today.

const KEY = 'isodesk-state';
const KINDS = ['shops', 'deals', 'msgs', 'meta'];
const MAX_BYTES = 20 * 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const ID_RX = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_RECORD = 200 * 1024;

// Anyone with the link can write here, so only plain records with token ids are stored.
// Nested lists must carry token ids too. The app checks the rest of the shape on load.
function valid(kind, rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || typeof rec.id !== 'string' || !ID_RX.test(rec.id)) return false;
  if (typeof rec.updatedAt !== 'number' || !isFinite(rec.updatedAt)) return false;
  if (rec.deleted === true) return true;
  if (kind === 'meta' && rec.id !== 'settings') return false;
  if (kind === 'deals' && (typeof rec.shopId !== 'string' || !ID_RX.test(rec.shopId))) return false;
  for (const list of ['followUps', 'activity', 'contacts', 'offers', 'templates']) {
    if (rec[list] === undefined) continue;
    if (!Array.isArray(rec[list])) return false;
    if (rec[list].some((x) => !x || typeof x !== 'object' || typeof x.id !== 'string' || !ID_RX.test(x.id))) return false;
  }
  return JSON.stringify(rec).length <= MAX_RECORD;
}

async function read(env) {
  const raw = await env.NOTES_KV.get(KEY);
  const st = raw ? JSON.parse(raw) : null;
  if (st && st.epoch) return st;
  const fresh = { epoch: 1 };
  KINDS.forEach((k) => { fresh[k] = {}; });
  return fresh;
}

export async function onRequestGet({ env }) {
  return json(await read(env));
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Body must be JSON' }, 400); }
  if (body && body.reset === true) {
    const fresh = { epoch: Date.now() };
    KINDS.forEach((k) => { fresh[k] = {}; });
    await env.NOTES_KV.put(KEY, JSON.stringify(fresh));
    return json({ ok: true, epoch: fresh.epoch });
  }
  const st = await read(env);
  if (body.epoch && body.epoch !== st.epoch) return json({ ok: false, reset: true, epoch: st.epoch }, 409);
  let written = 0, rejected = 0;
  for (const kind of KINDS) {
    const incoming = Array.isArray(body[kind]) ? body[kind] : [];
    for (const rec of incoming) {
      if (!valid(kind, rec)) { rejected++; continue; }
      const cur = st[kind][rec.id];
      if (!cur || (rec.updatedAt || 0) >= (cur.updatedAt || 0)) { st[kind][rec.id] = rec; written++; }
    }
  }
  const out = JSON.stringify(st);
  if (out.length > MAX_BYTES) return json({ ok: false, error: 'Too much data saved. Reset the demo.' }, 413);
  await env.NOTES_KV.put(KEY, out);
  return json({ ok: rejected === 0, written, rejected, epoch: st.epoch });
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
}
