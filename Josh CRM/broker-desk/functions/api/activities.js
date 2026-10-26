// POST /api/activities { leadId, kind: 'note', body } -> adds a note.
// POST /api/activities { leadId, kind: 'call', outcome, body, duration } -> logs a call made outside the desk.
import { route, json, fail, newId } from '../../lib/server.js';
import { canSeeLead, assertSee } from '../../lib/leads.js';
import { addActivity } from '../../lib/activity.js';

export const { onRequestPost } = route({
  async post({ env, me, body }) {
    assertSee(await canSeeLead(env, me, String(body.leadId || '')));
    const kind = body.kind === 'call' ? 'call' : 'note', text = String(body.body || '').trim().slice(0, 8000);
    if (kind === 'note' && !text) throw fail('Write the note first.');
    const id = await addActivity(env, me.ws, { kind, dir: kind === 'call' ? 'out' : null, leadId: body.leadId, dealId: body.dealId || null, member: me.member, body: text,
      status: kind === 'call' ? 'completed' : null, outcome: body.outcome ? String(body.outcome).slice(0, 60) : null, duration: kind === 'call' ? Math.max(0, body.duration | 0) : null,
      data: kind === 'call' ? { logged: true } : {} }, { touch: kind === 'call', call: kind === 'call' });
    return json({ ok: true, id });
  }
});
