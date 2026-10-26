// POST /api/files (multipart: file, leadId, dealId, kind) -> stores a file on a lead (bank
// statements, ID, an application). Up to 15 MB; PDFs, images and spreadsheets.
import { route, json, fail, q, newId } from '../../../lib/server.js';
import { canSeeLead, assertSee } from '../../../lib/leads.js';
import { activityStmt } from '../../../lib/activity.js';
import { fileStoreReady, putFile } from '../../../lib/files.js';
const TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const { requireSession } = await import('../../../lib/server.js');
  const s = await requireSession(request, env, true); if (s.reply) return s.reply;
  const me = s.me, form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, error: 'No file.' }, 400);
  const file = form.get('file'), leadId = String(form.get('leadId') || ''), dealId = String(form.get('dealId') || '') || null, kind = String(form.get('kind') || 'other').slice(0, 20);
  if (!file || typeof file === 'string') return json({ ok: false, error: 'No file.' }, 400);
  if (file.size > 15 * 1024 * 1024) return json({ ok: false, error: 'Files up to 15 MB.' }, 413);
  if (!TYPES.includes(file.type)) return json({ ok: false, error: 'PDFs, images and spreadsheets only.' }, 415);
  if (!(await canSeeLead(env, me, leadId))) return json({ ok: false, error: 'That lead is not in your book.' }, 404);
  if (!fileStoreReady(env)) return json({ ok: false, error: 'File storage is not set up.' }, 501);
  const id = newId('fl'), name = String(file.name || 'file').replace(/[^\w .()-]+/g, '').slice(0, 120) || 'file', key = me.ws + '/' + leadId + '/' + id + '-' + name;
  await putFile(env, key, file, file.type);
  await env.DB.batch([
    q(env, 'INSERT INTO files (ws, id, lead_id, deal_id, name, type, size, r2_key, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', me.ws, id, leadId, dealId, name, file.type, file.size, key, kind, Date.now()),
    activityStmt(env, me.ws, { kind: 'system', leadId, dealId, member: me.member, body: 'File added: ' + name + '.' })
  ]);
  return json({ ok: true, id, name });
}
