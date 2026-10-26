// GET  /api/leads?f=<json filter>&sort=&offset=&limit= -> { leads, total }
// GET  /api/leads?facets=1 -> counts per status and list
// POST /api/leads { name, contacts, ... } -> creates one lead
import { route, json, fail, SH, logEvent, getSetting } from '../../../lib/server.js';
import { DEFAULT_LISTS } from '../../../lib/defaults.js';
import { queryLeads, leadFacets, createLead, getLead, leadWhere } from '../../../lib/leads.js';
import { addActivity } from '../../../lib/activity.js';

export const { onRequestGet, onRequestPost } = route({
  async get({ env, me, url }) {
    if (url.searchParams.get('facets')) return json({ ok: true, ...(await leadFacets(env, me)) });
    // Counts for the saved lists in the sidebar, one query each, in one round trip.
    if (url.searchParams.get('listCounts')) {
      let ids = []; try { ids = JSON.parse(url.searchParams.get('listCounts')); } catch { ids = []; }
      const lists = (await getSetting(env, me.ws, 'lists', null)) || DEFAULT_LISTS;
      const pick = lists.filter((l) => ids.includes(l.id)).slice(0, 20);
      if (!pick.length) return json({ ok: true, counts: {} });
      const res = await env.DB.batch(pick.map((l) => { const w = leadWhere(me, l.filter); return env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ' + w.where).bind(...w.params); }));
      const counts = {}; pick.forEach((l, i) => { counts[l.id] = (res[i].results[0] || {}).n || 0; });
      return json({ ok: true, counts });
    }
    let f = {};
    try { f = JSON.parse(url.searchParams.get('f') || '{}'); } catch { throw fail('Bad filter.'); }
    const r = await queryLeads(env, me, f, { sort: url.searchParams.get('sort') || 'created', offset: +url.searchParams.get('offset') || 0, limit: +url.searchParams.get('limit') || 50 });
    return json({ ok: true, ...r });
  },
  async post({ env, me, body }) {
    if (!String(body.name || '').trim()) throw fail('Write the business name.');
    const id = await createLead(env, me, { ...body, source: body.source || 'manual' });
    await addActivity(env, me.ws, { kind: 'system', leadId: id, member: me.member, body: 'Lead added by ' + me.name + '.' });
    await logEvent(env, me, 'create', 'lead', id, body.name, null);
    return json({ ok: true, lead: await getLead(env, me, id) });
  }
});
