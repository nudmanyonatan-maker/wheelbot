// /apply/<slug>: the brokerage's own application form, replacing Jotform. GET shows it; POST
// creates or updates the lead (matched by email or phone), records express CASL consent with the
// date and source, opens a deal, stores any bank statements, routes the lead to the next rep, and
// puts "New application" in the inbox.
import { SH, q, one, newId, throttled, noteMiss } from '../../lib/server.js';
import { leadByEmail, leadByPhone, leadFields, leadStatements, rowToLead } from '../../lib/leads.js';
import { activityStmt } from '../../lib/activity.js';
import { createDeal } from '../../lib/deals.js';
import { wsSettings, nextOwner } from '../../lib/defaults.js';
import { fileStoreReady, putFile } from '../../lib/files.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic'];
function shell(ws, brand, inner) {
  const c = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#1f4fd1';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(ws.name)}: apply</title>
<style>:root{--a:${c};--ink:#18222c;--ink2:#46525e;--line:#dde1da;--bg:#f3f4f1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{background:#fff;border-bottom:1px solid var(--line);padding:14px 20px;display:flex;align-items:center;gap:10px;font-weight:700}header i{display:inline-block;width:26px;height:26px;border-radius:7px;background:var(--a)}
main{max-width:640px;margin:0 auto;padding:24px 16px 60px}h1{font-size:24px;margin:8px 0 4px}p.lead{color:var(--ink2);margin:0 0 18px}form{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;color:var(--ink2)}label.w{grid-column:1/-1}input,select{height:42px;width:100%;min-width:0;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit;color:var(--ink);background:#fff}
input:focus,select:focus{outline:2px solid var(--a);outline-offset:0}.chk{flex-direction:row;align-items:flex-start;gap:10px;font-weight:500;color:var(--ink)}.chk input{width:18px;height:18px;flex:none;margin-top:2px;accent-color:var(--a)}
.drop{grid-column:1/-1;border:1.5px dashed #c3c9bf;border-radius:10px;padding:16px;text-align:center;color:var(--ink2)}button{grid-column:1/-1;height:46px;border:0;border-radius:9px;background:var(--a);color:#fff;font:inherit;font-weight:650;font-size:16px;cursor:pointer}
.err{grid-column:1/-1;background:#fbe9e6;color:#b8382a;border-radius:8px;padding:10px 12px}.done{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px}small{color:var(--ink2);font-weight:500}
@media(max-width:600px){form{grid-template-columns:minmax(0,1fr);padding:16px}main{padding:18px 14px 48px}}</style></head><body><header><i></i>${esc(brand.logoText || ws.name)}</header><main>${inner}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
function form(s, v = {}, err) {
  const opt = (list, cur) => list.map((x) => '<option value="' + esc(x[0]) + '"' + (x[0] === cur ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('');
  return `<h1>${esc(s.form.title)}</h1><p class="lead">${esc(s.form.intro)}</p><form method="post" enctype="multipart/form-data" novalidate>
${err ? '<div class="err">' + esc(err) + '</div>' : ''}
<label class="w">Business legal name<input name="business" required value="${esc(v.business)}" autocomplete="organization"></label>
<label>Your name<input name="name" required value="${esc(v.name)}" autocomplete="name"></label>
<label>Mobile phone<input name="phone" required value="${esc(v.phone)}" inputmode="tel" autocomplete="tel"></label>
<label class="w">Email<input name="email" type="email" required value="${esc(v.email)}" autocomplete="email"></label>
<label>Province<select name="province" required><option value="">Pick one</option>${opt(SH.PROVINCES.map((p) => [p.id, p.name]), v.province)}</select></label>
<label>City<input name="city" value="${esc(v.city)}" autocomplete="address-level2"></label>
<label>Industry<select name="industry"><option value="">Pick one</option>${opt(SH.INDUSTRIES.map((i) => [i, i]), v.industry)}</select></label>
<label>Months in business<input name="months" inputmode="numeric" value="${esc(v.months)}"></label>
<label>Average monthly revenue<input name="revenue" inputmode="numeric" placeholder="$" value="${esc(v.revenue)}"></label>
<label>How much do you need?<input name="amount" inputmode="numeric" placeholder="$" value="${esc(v.amount)}"></label>
${s.form.askStatements ? '<div class="drop"><label style="align-items:center">Last 4 months of business bank statements <small>(PDF, optional now)</small><input type="file" name="statements" multiple accept="application/pdf,image/*" style="height:auto;border:0;margin-top:6px"></label></div>' : ''}
<label class="w chk"><input type="checkbox" name="consent" value="yes"${v.consent ? ' checked' : ''}> <span>${esc(s.form.consentText)}</span></label>
<button type="submit">Send my application</button></form>`;
}
async function wsBySlug(env, slug) { return await one(env, 'SELECT id, name, brand FROM workspaces WHERE slug = ?', String(slug || '').toLowerCase()); }
export async function onRequestGet({ env, params }) {
  const ws = await wsBySlug(env, params.slug);
  if (!ws) return new Response('Not found', { status: 404 });
  const s = await wsSettings(env, ws.id), brand = JSON.parse(ws.brand || '{}');
  return shell(ws, brand, form(s));
}
export async function onRequestPost({ request, env, params }) {
  const ws = await wsBySlug(env, params.slug);
  if (!ws) return new Response('Not found', { status: 404 });
  const s = await wsSettings(env, ws.id), brand = JSON.parse(ws.brand || '{}');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await throttled(env, ['ip:form:' + ip])) return shell(ws, brand, '<div class="done"><h1>Please wait a few minutes</h1><p>Too many applications from this connection.</p></div>');
  const fd = await request.formData().catch(() => null);
  if (!fd) return shell(ws, brand, form(s, {}, 'Something went wrong. Try again.'));
  const v = {}; ['business', 'name', 'phone', 'email', 'province', 'city', 'industry', 'months', 'revenue', 'amount', 'consent'].forEach((k) => { v[k] = String(fd.get(k) || '').trim().slice(0, 200); });
  const num = (x) => Math.round(+String(x).replace(/[^0-9.]/g, '')) || null;
  const err = !v.business || !v.name ? 'Fill in the business and your name.' : !SH.phoneKey(v.phone) ? 'That phone number does not look right.' : !SH.emailLc(v.email) ? 'That email does not look right.'
    : !SH.PROV[v.province] ? 'Pick your province.' : !v.consent ? 'Tick the box so we can contact you about your application.' : '';
  if (err) return shell(ws, brand, form(s, v, err));
  await noteMiss(env, ['ip:form:' + ip]);
  const sys = { ws: ws.id, member: null, name: 'Application form', role: 'manager', system: true };
  const now = Date.now(), existing = (await leadByEmail(env, ws.id, v.email)) || (await leadByPhone(env, ws.id, v.phone));
  const contacts = [{ name: v.name, phone: v.phone, email: v.email }];
  const fieldsIn = { name: v.business, province: v.province, city: v.city || undefined, industry: v.industry || undefined, months: num(v.months), monthlyRevenue: num(v.revenue), requested: num(v.amount) };
  const consent = { type: 'express', source: 'Application form ' + new Date(now).toISOString().slice(0, 10) + ', ' + ip };
  let leadId, owner;
  if (existing) {
    leadId = existing.id; owner = existing.owner || await nextOwner(env, ws.id);
    const cur = rowToLead(await one(env, 'SELECT * FROM leads WHERE ws = ? AND id = ?', ws.id, leadId));
    const f = leadFields({ ...fieldsIn, owner, status: 'app-in' }, cur);
    const keep = (cur.contacts || []).filter((c) => SH.emailLc(c.email) !== SH.emailLc(v.email));
    await env.DB.batch([...leadStatements(env, sys, leadId, f, contacts.concat(keep), { now }),
      q(env, 'UPDATE leads SET consent = ?, consent_source = ?, consent_at = ? WHERE ws = ? AND id = ?', consent.type, consent.source, now, ws.id, leadId)]);
  } else {
    leadId = newId('ld'); owner = await nextOwner(env, ws.id);
    const f = leadFields({ ...fieldsIn, owner, status: 'app-in', source: 'website', list: 'Website applications' });
    await env.DB.batch(leadStatements(env, sys, leadId, f, contacts, { create: true, consent, now }));
  }
  // Statements uploaded with the form go on the lead and tick the checklist.
  const files = fd.getAll('statements').filter((f) => f && typeof f !== 'string' && f.size > 0 && f.size <= 15 * 1024 * 1024 && TYPES.includes(f.type)).slice(0, 6);
  const paperwork = { app: now };
  const fst = [];
  for (let i = 0; i < files.length && fileStoreReady(env); i++) {
    const f = files[i], id = newId('fl'), name = String(f.name || 'statement.pdf').replace(/[^\w .()-]+/g, '').slice(0, 120), key = ws.id + '/' + leadId + '/' + id + '-' + name;
    await putFile(env, key, f, f.type);
    fst.push(q(env, 'INSERT INTO files (ws, id, lead_id, name, type, size, r2_key, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', ws.id, id, leadId, name, f.type, f.size, key, 'statement', now));
    if (i < 4) paperwork['s' + (i + 1)] = now;
  }
  const lead = rowToLead(await one(env, 'SELECT * FROM leads WHERE ws = ? AND id = ?', ws.id, leadId));
  lead.months = num(v.months); lead.monthlyRevenue = num(v.revenue);
  const deal = await createDeal(env, { ...sys, member: owner }, lead, { requested: num(v.amount), paperwork });
  await env.DB.batch([...fst,
    activityStmt(env, ws.id, { kind: 'form', dir: 'in', leadId, dealId: deal.id, member: owner, unread: true, body: 'Applied on the website for ' + (num(v.amount) ? SH.money(num(v.amount)) : 'funding') + (files.length ? ', with ' + files.length + ' statement' + (files.length > 1 ? 's' : '') : ', no statements yet') + '.', data: { consent: consent.source } })]);
  return shell(ws, brand, '<div class="done"><h1>Application received</h1><p>' + esc(s.form.thanks) + '</p></div>');
}
