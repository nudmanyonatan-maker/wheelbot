// GET /api/leads/export?f=<json filter> -> CSV of the leads in a list.
import { route, fail, all, SH, logEvent } from '../../../lib/server.js';
import { leadWhere } from '../../../lib/leads.js';

const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const { onRequestGet } = route({
  async get({ env, me, url }) {
    let f = {}; try { f = JSON.parse(url.searchParams.get('f') || '{}'); } catch { throw fail('Bad filter.'); }
    const { where, params } = leadWhere(me, f);
    const rows = await all(env, 'SELECT * FROM leads WHERE ' + where + ' ORDER BY created_at DESC LIMIT 50000', ...params);
    const head = ['Business', 'Contact', 'Phone', 'Email', 'Status', 'Owner', 'List', 'Source', 'Province', 'City', 'Industry', 'Monthly revenue', 'Requested', 'Consent', 'Do not call', 'Created', 'Last contacted'];
    const lines = [head.join(',')].concat(rows.map((r) => [r.name, r.contact_name, r.phone_key ? SH.fmtPhone(r.phone_key) : '', r.email_lc, r.status, r.owner, r.list_tag, r.source, r.province, r.city, r.industry,
      r.monthly_revenue, r.requested, r.consent, r.dnc ? 'yes' : '', new Date(r.created_at).toISOString().slice(0, 10), r.last_contact_at ? new Date(r.last_contact_at).toISOString().slice(0, 10) : ''].map(cell).join(',')));
    await logEvent(env, me, 'export', 'lead', null, rows.length + ' leads', null);
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads.csv"' } });
  }
});
