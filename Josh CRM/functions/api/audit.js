// GET /api/audit?before=<id>&member=<m>&kind=<shops|deals|msgs|meta>&rec=<id>&limit=<n>
// -> { entries: [{ id, at, who, member, action, kind, recId, label, changes }], more }
// The change log, newest first. A manager sees the whole team's; a rep sees only their own changes.
import { json, requireSession } from '../../lib/server.js';

export async function onRequestGet({ request, env }) {
  const s = await requireSession(request, env, false);
  if (s.reply) return s.reply;
  const p = new URL(request.url).searchParams, me = s.me;
  const limit = Math.min(200, Math.max(1, +p.get('limit') || 100)), before = +p.get('before') || 0;
  const where = ['ws = ?'], args = [me.ws];
  if (before) { where.push('id < ?'); args.push(before); }
  const member = me.role === 'manager' ? p.get('member') : me.member;
  if (member) { where.push('member = ?'); args.push(member); }
  if (p.get('kind')) { where.push('kind = ?'); args.push(p.get('kind')); }
  if (p.get('rec')) { where.push('rec_id = ?'); args.push(p.get('rec')); }
  args.push(limit + 1);
  const rows = (await env.DB.prepare('SELECT id, at, who, member, action, kind, rec_id, label, changes FROM audit WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT ?').bind(...args).all()).results || [];
  const more = rows.length > limit;
  return json({
    ok: true, more,
    entries: rows.slice(0, limit).map((r) => {
      let changes = null; try { changes = r.changes ? JSON.parse(r.changes) : null; } catch { changes = null; }
      return { id: r.id, at: r.at, who: r.who, member: r.member, action: r.action, kind: r.kind, recId: r.rec_id, label: r.label, changes };
    })
  });
}
