// GET  /api/lenders -> the lender list with rules.  POST /api/lenders { ...lender } -> saves (managers).
import { route, json } from '../../lib/server.js';
import { listLenders, saveLender } from '../../lib/deals.js';
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) { return json({ ok: true, lenders: await listLenders(env, me.ws) }); },
  async post({ env, me, body }) { const id = await saveLender(env, me, body); return json({ ok: true, id, lenders: await listLenders(env, me.ws) }); }
});
