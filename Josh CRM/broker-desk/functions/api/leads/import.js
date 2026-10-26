// POST /api/leads/import { rows: [...], list, owner, status, source, consent, dedupe } -> { added, updated, skipped }
// The app reads the file (a Close export, a spreadsheet, a CSV) and sends rows already mapped to
// our fields, up to 250 at a time. Duplicates are found by phone, email or business name.
import { route, json, fail, SH, all, isManager, newId, logEvent } from '../../../lib/server.js';
import { leadFields, leadStatements } from '../../../lib/leads.js';
import { activityStmt } from '../../../lib/activity.js';
import { nextOwner } from '../../../lib/defaults.js';

export const { onRequestPost } = route({
  async post({ env, me, body }) {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 250) : [];
    if (!rows.length) throw fail('Nothing to import.');
    const dedupe = ['skip', 'update', 'allow'].includes(body.dedupe) ? body.dedupe : 'skip';
    const phones = [], emails = [], names = [];
    rows.forEach((r) => { const p = SH.phoneKey(r.phone), e = SH.emailLc(r.email), n = SH.normName(r.name); if (p) phones.push(p); if (e) emails.push(e); if (n) names.push(n); });
    const found = dedupe === 'allow' ? [] : await all(env, `SELECT id, owner, phone_key, email_lc, name_norm, data, status, source, list_tag, province, city, industry, monthly_revenue, requested, name FROM leads WHERE ws = ?1 AND deleted = 0 AND
      (phone_key IN (SELECT value FROM json_each(?2)) OR email_lc IN (SELECT value FROM json_each(?3)) OR name_norm IN (SELECT value FROM json_each(?4)))`, me.ws, JSON.stringify(phones), JSON.stringify(emails), JSON.stringify(names));
    const byP = {}, byE = {}, byN = {};
    found.forEach((f) => { if (f.phone_key) byP[f.phone_key] = f; if (f.email_lc) byE[f.email_lc] = f; byN[f.name_norm] = f; });
    const now = Date.now(), st = [];
    let added = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (!String(r.name || r.contactName || '').trim()) { skipped++; continue; }
      const hit = byP[SH.phoneKey(r.phone)] || byE[SH.emailLc(r.email)] || byN[SH.normName(r.name)];
      if (hit && !isManager(me) && hit.owner !== me.member) { skipped++; continue; }
      const contacts = [{ name: r.contactName || '', title: r.title || '', phone: r.phone || '', phone2: r.phone2 || '', email: r.email || '' }];
      const fields = { ...r, name: r.name || r.contactName, list: body.list || r.list || null, source: r.source || body.source || 'import', status: r.status || body.status || 'new' };
      if (hit) {
        if (dedupe === 'skip') { skipped++; continue; }
        const f = leadFields({ ...fields, status: r.status || undefined, owner: undefined }, { ...JSON.parse(hit.data || '{}'), owner: hit.owner, name: hit.name, status: hit.status, source: hit.source, list: hit.list_tag,
          province: hit.province, city: hit.city, industry: hit.industry, monthlyRevenue: hit.monthly_revenue, requested: hit.requested });
        st.push(...leadStatements(env, me, hit.id, f, contacts, { now }));
        updated++;
        continue;
      }
      let owner = body.owner === 'round' ? await nextOwner(env, me.ws) : body.owner === undefined ? me.member : body.owner || null;
      if (!isManager(me)) owner = me.member;
      const id = newId('ld'), f = leadFields({ ...fields, owner });
      st.push(...leadStatements(env, me, id, f, contacts, { create: true, consent: body.consent, now }));
      st.push(activityStmt(env, me.ws, { kind: 'system', leadId: id, member: me.member, at: now, body: 'Imported' + (body.list ? ' into "' + body.list + '"' : '') + '.' }));
      const k = SH.phoneKey(r.phone); if (k) byP[k] = { id, owner };
      added++;
    }
    for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
    if (body.last) await logEvent(env, me, 'import', 'lead', null, (body.list || 'Import') + ': ' + (body.total || added) + ' rows', null);
    return json({ ok: true, added, updated, skipped });
  }
});
