// GET  /api/deals?owner=me -> every open and recent deal for the board.
// POST /api/deals { leadId, requested, renewalOf } -> opens a deal on a lead.
import { route, json, fail } from '../../../lib/server.js';
import { getLead, assertSee } from '../../../lib/leads.js';
import { listDeals, createDeal, listLenders } from '../../../lib/deals.js';

export const { onRequestGet, onRequestPost } = route({
  async get({ env, me, url }) {
    return json({ ok: true, deals: await listDeals(env, me, { owner: url.searchParams.get('owner') || '' }), lenders: await listLenders(env, me.ws) });
  },
  async post({ env, me, body }) {
    const lead = await getLead(env, me, String(body.leadId || ''));
    assertSee(lead);
    const d = await createDeal(env, me, lead, body);
    return json({ ok: true, deal: d });
  }
});
