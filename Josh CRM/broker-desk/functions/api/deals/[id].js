// GET  /api/deals/:id -> the deal, its lead, lender list (with fit for this file) and activity.
// POST /api/deals/:id { action, ... } -> paper, stage, submit, response, accept, closing, fund, commission, close, reopen, edit.
import { route, json, fail, SH, all } from '../../../lib/server.js';
import { getDeal, dealAction, listLenders } from '../../../lib/deals.js';
import { getLead } from '../../../lib/leads.js';
import { rowToActivity } from '../../../lib/activity.js';

export const { onRequestGet, onRequestPost } = route({
  async get({ env, me, params }) {
    const d = await getDeal(env, me, params.id);
    if (!d) throw fail('That deal is not in your book.', 404);
    const lead = await getLead(env, me, d.leadId);
    const lenders = (await listLenders(env, me.ws)).map((l) => ({ ...l, fit: SH.lenderFit(l, d) }));
    const acts = (await all(env, 'SELECT * FROM activities WHERE ws = ? AND deal_id = ? ORDER BY at DESC LIMIT 100', me.ws, d.id)).map(rowToActivity);
    const files = await all(env, 'SELECT id, name, type, size, kind, at FROM files WHERE ws = ? AND (deal_id = ? OR lead_id = ?) ORDER BY at DESC', me.ws, d.id, d.leadId);
    return json({ ok: true, deal: d, lead, lenders, activities: acts, files });
  },
  async post({ env, me, params, body }) { return json({ ok: true, deal: await dealAction(env, me, params.id, body) }); }
});
