// GET /api/dash?days=7&member= -> the dashboard numbers.
import { route, json } from '../../lib/server.js';
import { dashboard } from '../../lib/dash.js';
export const { onRequestGet } = route({
  async get({ env, me, url }) { return json({ ok: true, ...(await dashboard(env, me, { days: url.searchParams.get('days'), member: url.searchParams.get('member') || '' })) }); }
});
