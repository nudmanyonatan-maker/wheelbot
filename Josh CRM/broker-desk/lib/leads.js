// Leads on the server: the row shape, search and filters with paging, saving with contacts,
// matching inbound calls, texts and emails back to a lead, and touching a lead after contact.
// Reps only ever see and change their own leads; managers see everyone's.
import { SH, q, all, one, parse, newId, isManager, fail } from './server.js';

const STR = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const INT = (v) => { const n = Math.round(Number(v)); return isFinite(n) && n > 0 ? n : null; };

export function rowToLead(r, contacts) {
  if (!r) return null;
  const d = parse(r.data, {});
  const out = {
    id: r.id, owner: r.owner, name: r.name, status: r.status, source: r.source, list: r.list_tag, province: r.province, city: r.city,
    industry: r.industry, contactName: r.contact_name, phone: r.phone_key ? SH.fmtPhone(r.phone_key) : '', email: r.email_lc || '',
    monthlyRevenue: r.monthly_revenue, requested: r.requested,
    consent: { type: r.consent, source: r.consent_source, at: r.consent_at }, dnc: !!r.dnc, smsOptOut: !!r.sms_opt_out, emailOptOut: !!r.email_opt_out,
    createdAt: r.created_at, updatedAt: r.updated_at, lastContactAt: r.last_contact_at, lastCallAt: r.last_call_at, calls: r.calls,
    nextTaskAt: r.next_task_at, dealId: r.deal_id,
    website: d.website || '', address: d.address || '', notes: d.notes || '', months: d.months || null, score: d.score || null,
    positions: d.positions == null ? null : d.positions, custom: d.custom || {}
  };
  if (contacts) out.contacts = contacts.map((c) => ({ id: c.id, name: c.name || '', title: c.title || '', phone: c.phone || '', phone2: c.phone2 || '', email: c.email || '' }));
  return out;
}

// ---------- query ----------
// filter: { q, status: [], owner: '' | 'me' | 'none' | member, list, source, province: [], created: '1d'|'7d'|'30d',
//           contacted: 'never'|'today'|'7d+'|'30d+', consent: 'ok'|'none', callable: true, hasEmail: true }
const SORTS = {
  created: 'created_at DESC', name: 'name_norm ASC', contacted: 'COALESCE(last_contact_at, 0) ASC', recent: 'COALESCE(last_contact_at, 0) DESC',
  revenue: 'COALESCE(monthly_revenue, 0) DESC', calls: 'calls ASC, created_at DESC'
};
export function leadWhere(me, f) {
  f = f || {};
  const w = ['ws = ?1', 'deleted = 0'], p = [me.ws];
  const add = (sql, ...vals) => { let s = sql; vals.forEach((v) => { p.push(v); s = s.replace('$', '?' + p.length); }); w.push(s); };
  if (!isManager(me)) add('owner = $', me.member);
  else if (f.owner === 'me') add('owner = $', me.member);
  else if (f.owner === 'none') w.push('owner IS NULL');
  else if (f.owner) add('owner = $', String(f.owner));
  if (Array.isArray(f.ids)) add('id IN (SELECT value FROM json_each($))', JSON.stringify(f.ids.map(String).slice(0, 20000)));
  if (Array.isArray(f.status) && f.status.length) add('status IN (SELECT value FROM json_each($))', JSON.stringify(f.status.map(String)));
  if (Array.isArray(f.notStatus) && f.notStatus.length) add('status NOT IN (SELECT value FROM json_each($))', JSON.stringify(f.notStatus.map(String)));
  if (f.list) add('list_tag = $', String(f.list));
  if (f.source) add('source = $', String(f.source));
  if (Array.isArray(f.province) && f.province.length) add('province IN (SELECT value FROM json_each($))', JSON.stringify(f.province.map(String)));
  if (f.industry) add('industry = $', String(f.industry));
  const now = Date.now(), DAY = SH.DAY;
  if (f.created) { const n = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }[f.created]; if (n) add('created_at >= $', now - n * DAY); }
  if (f.contacted === 'never') w.push('last_contact_at IS NULL');
  else if (f.contacted === 'today') add('last_contact_at >= $', me.day0 || now - now % DAY);
  else if (f.contacted === '7d+') add('(last_contact_at IS NULL OR last_contact_at < $)', now - 7 * DAY);
  else if (f.contacted === '30d+') add('(last_contact_at IS NULL OR last_contact_at < $)', now - 30 * DAY);
  if (f.consent === 'ok') w.push("consent IN ('express', 'implied')");
  else if (f.consent === 'none') w.push("consent = 'none'");
  if (f.callable) w.push("phone_key IS NOT NULL AND dnc = 0 AND status NOT IN ('dnc', 'bad-number')");
  if (f.hasEmail) w.push('email_lc IS NOT NULL AND email_opt_out = 0');
  if (f.minRevenue) add('monthly_revenue >= $', INT(f.minRevenue) || 0);
  if (f.q) {
    const s = String(f.q).trim().toLowerCase().slice(0, 80), k = SH.phoneKey(s), digits = s.replace(/\D/g, '');
    if (k) add('(phone_key = $ OR id IN (SELECT lead_id FROM contacts WHERE ws = ?1 AND (phone_key = $ OR phone2_key = $)))', k, k, k);
    else if (s.indexOf('@') > 0) add('(email_lc = $ OR id IN (SELECT lead_id FROM contacts WHERE ws = ?1 AND email_lc = $))', s, s);
    else if (digits.length >= 4 && digits.length === s.replace(/[\s()+.-]/g, '').length) add("phone_key LIKE $", '%' + digits + '%');
    else { const like = '%' + s.replace(/[%_]/g, '') + '%'; add('(name LIKE $ OR contact_name LIKE $ OR email_lc LIKE $ OR city LIKE $)', like, like, like, like); }
  }
  return { where: w.join(' AND '), params: p };
}
export async function queryLeads(env, me, f, { limit = 50, offset = 0, sort = 'created' } = {}) {
  const { where, params } = leadWhere(me, f);
  limit = Math.max(1, Math.min(200, limit | 0)); offset = Math.max(0, offset | 0);
  const order = SORTS[sort] || SORTS.created;
  const [rows, count] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM leads WHERE ' + where + ' ORDER BY ' + order + ', id LIMIT ' + limit + ' OFFSET ' + offset).bind(...params),
    env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ' + where).bind(...params)
  ]);
  return { leads: (rows.results || []).map((r) => rowToLead(r)), total: (count.results[0] || {}).n || 0 };
}
export async function leadIds(env, me, f, { sort = 'created', max = 5000 } = {}) {
  const { where, params } = leadWhere(me, f);
  const rows = await all(env, 'SELECT id FROM leads WHERE ' + where + ' ORDER BY ' + (SORTS[sort] || SORTS.created) + ', id LIMIT ' + Math.min(20000, max), ...params);
  return rows.map((r) => r.id);
}
// Counts per status and per list, for the sidebar and the filter menus.
export async function leadFacets(env, me) {
  const { where, params } = leadWhere(me, {});
  const [st, li] = await env.DB.batch([
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads WHERE ' + where + ' GROUP BY status').bind(...params),
    env.DB.prepare('SELECT list_tag AS list, COUNT(*) AS n FROM leads WHERE ' + where + ' AND list_tag IS NOT NULL GROUP BY list_tag ORDER BY MAX(created_at) DESC LIMIT 100').bind(...params)
  ]);
  const status = {}; (st.results || []).forEach((r) => { status[r.status] = r.n; });
  return { status, lists: li.results || [] };
}

// ---------- read one ----------
export async function getLead(env, me, id) {
  const r = await one(env, 'SELECT * FROM leads WHERE ws = ? AND id = ? AND deleted = 0', me.ws, id);
  if (!r) return null;
  if (!isManager(me) && r.owner !== me.member) return null;
  const contacts = await all(env, 'SELECT * FROM contacts WHERE ws = ? AND lead_id = ? ORDER BY pos', me.ws, id);
  return rowToLead(r, contacts);
}
export async function canSeeLead(env, me, id) {
  const r = await one(env, 'SELECT owner FROM leads WHERE ws = ? AND id = ? AND deleted = 0', me.ws, id);
  return !!r && (isManager(me) || r.owner === me.member);
}

// ---------- write ----------
function cleanContacts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((c, i) => ({
    id: /^[A-Za-z0-9_-]{1,40}$/.test(c && c.id || '') ? c.id : 'c' + i + Date.now().toString(36),
    name: STR(c && c.name, 120) || '', title: STR(c && c.title, 80) || '', phone: STR(c && c.phone, 30) || '', phone2: STR(c && c.phone2, 30) || '',
    email: SH.emailLc(c && c.email) || ''
  })).filter((c) => c.name || c.phone || c.email);
}
// Turns what the app sends into column values. Unknown fields are ignored.
export function leadFields(b, existing) {
  const ex = existing || {};
  const d = { website: STR(b.website, 200) ?? ex.website ?? '', address: STR(b.address, 300) ?? ex.address ?? '', notes: b.notes !== undefined ? String(b.notes || '').slice(0, 4000) : ex.notes || '',
    months: b.months !== undefined ? INT(b.months) : ex.months || null, score: b.score !== undefined ? INT(b.score) : ex.score || null,
    positions: b.positions !== undefined ? (b.positions === '' || b.positions == null ? null : Math.max(0, Math.min(20, b.positions | 0))) : ex.positions ?? null,
    custom: b.custom && typeof b.custom === 'object' ? Object.fromEntries(Object.entries(b.custom).slice(0, 50).map(([k, v]) => [String(k).slice(0, 60), String(v ?? '').slice(0, 500)])) : ex.custom || {} };
  const pick = (k, f) => (b[k] !== undefined ? f(b[k]) : ex[k] ?? null);
  return {
    name: pick('name', (v) => STR(v, 200)) || ex.name || 'Unnamed business',
    status: pick('status', (v) => STR(v, 40)) || ex.status || 'new',
    owner: b.owner !== undefined ? (b.owner ? String(b.owner).slice(0, 40) : null) : ex.owner ?? null,
    source: pick('source', (v) => STR(v, 60)), list: pick('list', (v) => STR(v, 80)), province: pick('province', (v) => (SH.PROV[String(v || '').toUpperCase()] ? String(v).toUpperCase() : null)),
    city: pick('city', (v) => STR(v, 80)), industry: pick('industry', (v) => STR(v, 60)),
    monthlyRevenue: pick('monthlyRevenue', INT), requested: pick('requested', INT), data: d
  };
}
// Saves a whole lead with its contacts. The first contact becomes the one shown in lists.
export function leadStatements(env, me, id, f, contacts, { create, consent, now = Date.now() } = {}) {
  const cs = cleanContacts(contacts);
  const first = cs.find((c) => c.phone) || cs[0] || {}, primary = cs[0] || {};
  const phoneK = SH.phoneKey(first.phone) || SH.phoneKey(first.phone2) || null, email = (cs.find((c) => c.email) || {}).email || null;
  const out = [];
  if (create) {
    const c = consent || {};
    out.push(q(env, `INSERT INTO leads (ws, id, owner, name, name_norm, status, source, list_tag, province, city, industry, contact_name, phone_key, email_lc,
      monthly_revenue, requested, consent, consent_source, consent_at, created_at, updated_at, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20, ?21)`,
      me.ws, id, f.owner, f.name, SH.normName(f.name), f.status, f.source, f.list, f.province, f.city, f.industry, primary.name || null, phoneK, email,
      f.monthlyRevenue, f.requested, ['express', 'implied'].includes(c.type) ? c.type : 'none', c.source || null, c.type && c.type !== 'none' ? c.at || now : null, now, JSON.stringify(f.data)));
  } else {
    out.push(q(env, `UPDATE leads SET owner = ?3, name = ?4, name_norm = ?5, status = ?6, source = ?7, list_tag = ?8, province = ?9, city = ?10, industry = ?11,
      contact_name = ?12, phone_key = ?13, email_lc = ?14, monthly_revenue = ?15, requested = ?16, updated_at = ?17, data = ?18 WHERE ws = ?1 AND id = ?2`,
      me.ws, id, f.owner, f.name, SH.normName(f.name), f.status, f.source, f.list, f.province, f.city, f.industry, primary.name || null, phoneK, email,
      f.monthlyRevenue, f.requested, now, JSON.stringify(f.data)));
    out.push(q(env, 'DELETE FROM contacts WHERE ws = ? AND lead_id = ?', me.ws, id));
  }
  cs.forEach((c, i) => out.push(q(env, 'INSERT INTO contacts (ws, lead_id, id, pos, name, title, phone, phone_key, phone2, phone2_key, email, email_lc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    me.ws, id, c.id, i, c.name, c.title, c.phone, SH.phoneKey(c.phone) || null, c.phone2, SH.phoneKey(c.phone2) || null, c.email, c.email || null)));
  return out;
}
export async function createLead(env, me, b) {
  const id = newId('ld'), f = leadFields(b);
  if (!f.owner) f.owner = isManager(me) ? (b.owner === null ? null : me.member) : me.member;
  if (!isManager(me)) f.owner = me.member;
  await env.DB.batch(leadStatements(env, me, id, f, b.contacts, { create: true, consent: b.consent }));
  return id;
}

// ---------- matching inbound contact ----------
export async function leadByPhone(env, ws, phone) {
  const k = SH.phoneKey(phone);
  if (!k) return null;
  return await one(env, `SELECT id, owner, name, contact_name FROM leads WHERE ws = ?1 AND deleted = 0 AND (phone_key = ?2 OR id IN
    (SELECT lead_id FROM contacts WHERE ws = ?1 AND (phone_key = ?2 OR phone2_key = ?2))) ORDER BY COALESCE(last_contact_at, 0) DESC LIMIT 1`, ws, k);
}
export async function leadByEmail(env, ws, email) {
  const e = SH.emailLc(email);
  if (!e) return null;
  return await one(env, `SELECT id, owner, name, contact_name FROM leads WHERE ws = ?1 AND deleted = 0 AND (email_lc = ?2 OR id IN
    (SELECT lead_id FROM contacts WHERE ws = ?1 AND email_lc = ?2)) ORDER BY COALESCE(last_contact_at, 0) DESC LIMIT 1`, ws, e);
}
// After any call, text or email: when they were last reached, and the call count.
export function touchStmt(env, ws, leadId, { at = Date.now(), call = false } = {}) {
  return call
    ? q(env, 'UPDATE leads SET last_contact_at = MAX(COALESCE(last_contact_at, 0), ?3), last_call_at = ?3, calls = calls + 1 WHERE ws = ?1 AND id = ?2', ws, leadId, at)
    : q(env, 'UPDATE leads SET last_contact_at = MAX(COALESCE(last_contact_at, 0), ?3) WHERE ws = ?1 AND id = ?2', ws, leadId, at);
}
export function assertSee(ok) { if (!ok) throw fail('That lead is not in your book.', 404); }
