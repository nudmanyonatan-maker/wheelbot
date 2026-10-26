// GET /api/files/:id -> downloads a file, for people who can see its lead.
import { requireSession, one } from '../../../lib/server.js';
import { canSeeLead } from '../../../lib/leads.js';
import { getFile } from '../../../lib/files.js';
export async function onRequestGet({ request, env, params }) {
  const s = await requireSession(request, env, false); if (s.reply) return s.reply;
  const f = await one(env, 'SELECT * FROM files WHERE ws = ? AND id = ?', s.me.ws, params.id);
  if (!f || !(await canSeeLead(env, s.me, f.lead_id))) return new Response('Not found', { status: 404 });
  const body = await getFile(env, f.r2_key);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'Content-Disposition': 'inline; filename="' + f.name.replace(/"/g, '') + '"', 'Cache-Control': 'private, no-store' } });
}
