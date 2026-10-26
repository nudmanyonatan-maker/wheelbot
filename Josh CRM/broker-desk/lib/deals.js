// Deals and lenders. A deal is one funding file for a lead: its statements, the lenders it went to,
// their answers and offers, the offer the business took, closing, funding and the commission owed.
import { SH, q, all, one, parse, newId, fail, isManager } from './server.js';
import { activityStmt } from './activity.js';

export function rowToDeal(r) {
  if (!r) return null;
  const d = parse(r.data, {});
  return { id: r.id, leadId: r.lead_id, owner: r.owner, stage: r.stage, business: r.business, requested: r.requested, fundedAmount: r.funded_amount,
    fundedAt: r.funded_at, lenderId: r.lender_id, commission: r.commission, commissionPaidAt: r.commission_paid_at, createdAt: r.created_at,
    updatedAt: r.updated_at, stageAt: r.stage_at, merchant: d.merchant || {}, paperwork: d.paperwork || {}, submissions: d.submissions || [],
    accepted: d.accepted || null, closing: d.closing || {}, points: d.points ?? null, renewalOf: d.renewalOf || null, notes: d.notes || '', closed: d.closed || null, terms: d.terms || null };
}
function dataOf(d) { return JSON.stringify({ merchant: d.merchant, paperwork: d.paperwork, submissions: d.submissions, accepted: d.accepted, closing: d.closing, points: d.points, renewalOf: d.renewalOf, notes: d.notes, closed: d.closed, terms: d.terms }); }
export async function getDeal(env, me, id) {
  const r = await one(env, 'SELECT * FROM deals WHERE ws = ? AND id = ? AND deleted = 0', me.ws, id);
  if (!r || (!isManager(me) && r.owner !== me.member)) return null;
  return rowToDeal(r);
}
export async function listDeals(env, me, { stage, owner } = {}) {
  const w = ['ws = ?1', 'deleted = 0'], p = [me.ws];
  if (!isManager(me)) { p.push(me.member); w.push('owner = ?' + p.length); } else if (owner) { p.push(owner === 'me' ? me.member : owner); w.push('owner = ?' + p.length); }
  if (stage) { p.push(stage); w.push('stage = ?' + p.length); }
  const rows = await all(env, 'SELECT * FROM deals WHERE ' + w.join(' AND ') + ' ORDER BY stage_at DESC LIMIT 2000', ...p);
  return rows.map(rowToDeal);
}
export function saveDealStmt(env, me, d) {
  d.updatedAt = Date.now();
  return q(env, `UPDATE deals SET owner = ?3, stage = ?4, business = ?5, requested = ?6, funded_amount = ?7, funded_at = ?8, lender_id = ?9, commission = ?10,
    commission_paid_at = ?11, updated_at = ?12, stage_at = ?13, data = ?14 WHERE ws = ?1 AND id = ?2`,
    me.ws, d.id, d.owner, d.stage, d.business, d.requested, d.fundedAmount, d.fundedAt, d.lenderId, d.commission, d.commissionPaidAt, d.updatedAt, d.stageAt, dataOf(d));
}
export async function createDeal(env, me, lead, b = {}) {
  const now = Date.now(), id = newId('dl');
  const d = { id, leadId: lead.id, owner: lead.owner || me.member, stage: 'app', business: lead.name, requested: +b.requested || lead.requested || null,
    fundedAmount: null, fundedAt: null, lenderId: null, commission: null, commissionPaidAt: null, createdAt: now, updatedAt: now, stageAt: now,
    merchant: { monthlyRevenue: lead.monthlyRevenue || null, months: lead.months || null, score: lead.score || null, positions: lead.positions ?? null, industry: lead.industry || null, province: lead.province || null },
    paperwork: b.paperwork || {}, submissions: [], accepted: null, closing: {}, points: null, renewalOf: b.renewalOf || null, notes: '', closed: null };
  if (!statementsIn(d)) d.stage = 'statements';
  await env.DB.batch([
    q(env, 'INSERT INTO deals (ws, id, lead_id, owner, stage, business, requested, created_at, updated_at, stage_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      me.ws, id, lead.id, d.owner, d.stage, d.business, d.requested, now, now, now, dataOf(d)),
    q(env, "UPDATE leads SET deal_id = ?, status = CASE WHEN status IN ('funded') THEN status ELSE 'app-in' END, updated_at = ? WHERE ws = ? AND id = ?", id, now, me.ws, lead.id),
    activityStmt(env, me.ws, { kind: 'system', leadId: lead.id, dealId: id, member: me.member, body: b.renewalOf ? 'Renewal started.' : 'Deal opened' + (d.requested ? ' for ' + SH.money(d.requested) : '') + '.' })
  ]);
  return d;
}
export function missingPaper(d) { return SH.PAPERWORK.filter((p) => !p.optional && !d.paperwork[p.id]); }
export function statementsIn(d) { return SH.PAPERWORK.filter((p) => p.statement && !p.optional).every((p) => d.paperwork[p.id]); }
export function offerNums(o) {
  const n = o.freq === 'weekly' ? Math.round(o.termMonths * 52 / 12) : Math.round(o.termMonths * 21);
  const back = Math.round(o.amount * (o.factor || 1));
  return { payments: n, payback: back, payment: n ? Math.round(back / n) : 0, commission: SH.commission(o.amount, o.points) };
}
// How far a funded deal is paid back, estimated from its terms (the broker does not see the
// lender's collections). Renewals open at 50%.
export function payback(d) {
  if (!d.fundedAt || !d.terms) return null;
  const t = d.terms, per = t.freq === 'weekly' ? 7 * SH.DAY : SH.DAY * 7 / 5, n = offerNums(t).payments;
  const made = Math.max(0, Math.min(n, Math.floor((Date.now() - d.fundedAt) / per)));
  return { made, total: n, pct: n ? made / n : 0, halfAt: d.fundedAt + Math.ceil(n / 2) * per };
}

const STAGE_ORDER = SH.STAGE_INDEX;
// Changes to a deal, one action at a time. Returns the saved deal.
export async function dealAction(env, me, id, b) {
  const d = await getDeal(env, me, id);
  if (!d) throw fail('That deal is not in your book.', 404);
  const now = Date.now(), log = [], lenders = {};
  (await all(env, 'SELECT id, name, data FROM lenders WHERE ws = ?', me.ws)).forEach((l) => { lenders[l.id] = { name: l.name, ...parse(l.data, {}) }; });
  const ln = (lid) => (lenders[lid] && lenders[lid].name) || 'the lender';
  const setStage = (s) => { if (d.stage !== s) { d.stage = s; d.stageAt = now; } };
  const sub = (sid) => { const s = d.submissions.find((x) => x.id === sid); if (!s) throw fail('That submission is gone.'); return s; };
  let unread = false, kind = 'system', dir = null;
  switch (b.action) {
    case 'paper': {
      const item = SH.PAPERWORK.find((p) => p.id === b.item); if (!item) throw fail('Unknown item.');
      if (b.on) d.paperwork[item.id] = now; else delete d.paperwork[item.id];
      log.push(item.label + (b.on ? ' received.' : ' marked missing.'));
      if (d.stage === 'statements' && statementsIn(d)) setStage('app');
      if (d.stage === 'app' && !statementsIn(d)) setStage('statements');
      break;
    }
    case 'stage': {
      if (!(b.stage in STAGE_ORDER) || b.stage === 'funded' || b.stage === 'dead') throw fail('Use Fund or Close for that.');
      setStage(b.stage); log.push('Moved to ' + SH.STAGES[STAGE_ORDER[b.stage]].label.toLowerCase() + '.');
      break;
    }
    case 'submit': {
      const ids = (b.lenderIds || []).filter((x) => lenders[x] && !d.submissions.some((s) => s.lenderId === x && s.status !== 'declined'));
      if (!ids.length) throw fail('Pick at least one lender this file has not gone to yet.');
      ids.forEach((lid) => d.submissions.push({ id: newId('sb'), lenderId: lid, sentAt: now, status: 'sent', reason: null, respondedAt: null, offers: [] }));
      setStage('submitted'); kind = 'submission'; dir = 'out';
      log.push('Sent the file to ' + ids.map(ln).join(', ') + '.');
      break;
    }
    case 'response': {
      const s = sub(b.submissionId);
      s.status = b.status === 'declined' ? 'declined' : 'approved'; s.respondedAt = now; s.reason = s.status === 'declined' ? String(b.reason || 'Other').slice(0, 120) : null;
      if (s.status === 'approved') s.offers = (b.offers || []).slice(0, 6).map((o) => ({ id: newId('of'), amount: Math.round(+o.amount || 0), factor: Math.round((+o.factor || 1.3) * 1000) / 1000,
        termMonths: Math.max(1, Math.min(36, +o.termMonths || 6)), freq: o.freq === 'weekly' ? 'weekly' : 'daily', points: Math.max(0, Math.min(20, +o.points || 0)) }));
      kind = 'submission'; dir = 'in'; unread = !!b.fromLender;
      log.push(ln(s.lenderId) + (s.status === 'declined' ? ' declined: ' + s.reason + '.' : ' approved' + (s.offers.length ? ' with ' + s.offers.length + (s.offers.length > 1 ? ' offers' : ' offer') + ', best ' + SH.money(Math.max(...s.offers.map((o) => o.amount))) : '') + '.'));
      if (s.status === 'approved' && STAGE_ORDER[d.stage] < STAGE_ORDER.offers) setStage('offers');
      if (d.submissions.every((x) => x.status === 'declined') && d.stage !== 'dead') log.push('Every lender has declined so far.');
      break;
    }
    case 'accept': {
      const s = sub(b.submissionId), o = s.offers.find((x) => x.id === b.offerId); if (!o) throw fail('That offer is gone.');
      d.accepted = { submissionId: s.id, offerId: o.id }; d.points = o.points; d.terms = { ...o }; d.lenderId = s.lenderId;
      setStage('contracts'); log.push('Took the ' + SH.money(o.amount) + ' offer from ' + ln(s.lenderId) + '. Contracts out.');
      break;
    }
    case 'closing': {
      const item = SH.CLOSING.find((c) => c.id === b.item); if (!item) throw fail('Unknown item.');
      if (b.on) d.closing[item.id] = now; else delete d.closing[item.id];
      log.push(b.on ? 'Checked off: ' + item.label.toLowerCase() + '.' : 'Unchecked: ' + item.label.toLowerCase() + '.');
      break;
    }
    case 'fund': {
      if (!d.terms) throw fail('Mark the offer they took first.');
      d.fundedAmount = Math.round(+b.amount || d.terms.amount); d.fundedAt = b.at ? +b.at : now; d.commission = SH.commission(d.fundedAmount, d.points);
      setStage('funded'); log.push('Funded ' + SH.money(d.fundedAmount) + ' by ' + ln(d.lenderId) + '. Commission ' + SH.money(d.commission) + '.');
      break;
    }
    case 'commission': { d.commissionPaidAt = b.on ? now : null; log.push(b.on ? 'Commission of ' + SH.money(d.commission) + ' received.' : 'Commission marked unpaid.'); break; }
    case 'close': {
      d.closed = { kind: b.kind === 'declined' ? 'declined' : 'lost', reason: String(b.reason || 'Other').slice(0, 120), note: String(b.note || '').slice(0, 1000), at: now, from: d.stage };
      setStage('dead'); log.push((d.closed.kind === 'declined' ? 'Declined: ' : 'Lost: ') + d.closed.reason + '.');
      break;
    }
    case 'reopen': { const back = (d.closed && d.closed.from) || 'app'; d.closed = null; setStage(back === 'dead' ? 'app' : back); log.push('Reopened.'); break; }
    case 'edit': {
      if (b.requested !== undefined) d.requested = Math.round(+b.requested) || null;
      if (b.notes !== undefined) d.notes = String(b.notes || '').slice(0, 4000);
      if (b.merchant) ['monthlyRevenue', 'months', 'score', 'positions'].forEach((k) => { if (b.merchant[k] !== undefined) d.merchant[k] = b.merchant[k] === '' ? null : +b.merchant[k]; });
      if (b.owner !== undefined && isManager(me)) d.owner = b.owner || null;
      log.push('Details updated.');
      break;
    }
    default: throw fail('Unknown action.');
  }
  const st = [saveDealStmt(env, me, d)];
  log.forEach((t) => st.push(activityStmt(env, me.ws, { kind, dir, leadId: d.leadId, dealId: d.id, member: me.member, body: t, unread })));
  if (b.action === 'fund') st.push(q(env, "UPDATE leads SET status = 'funded', updated_at = ? WHERE ws = ? AND id = ?", now, me.ws, d.leadId));
  if (b.action === 'submit') st.push(q(env, "UPDATE leads SET status = 'submitted', updated_at = ? WHERE ws = ? AND id = ? AND status NOT IN ('funded')", now, me.ws, d.leadId));
  await env.DB.batch(st);
  return d;
}

// ---------- lenders ----------
export function rowToLender(r) {
  const d = parse(r.data, {});
  return { id: r.id, name: r.name, active: !!r.active, email: d.email || '', contacts: d.contacts || [], rules: d.rules || {}, notes: d.notes || '', products: d.products || [], points: d.points ?? null };
}
export async function listLenders(env, ws) { return (await all(env, 'SELECT * FROM lenders WHERE ws = ? ORDER BY active DESC, name', ws)).map(rowToLender); }
export async function saveLender(env, me, b) {
  if (!isManager(me)) throw fail('Only a manager can change lenders.', 403);
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(b.id || '') ? b.id : newId('ln'), name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw fail('Write the lender name.');
  const num = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(+v) || 0));
  const r = b.rules || {};
  const data = { email: SH.emailLc(b.email) || '', notes: String(b.notes || '').slice(0, 4000), points: num(b.points),
    contacts: (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 10).map((c) => ({ name: String(c.name || '').slice(0, 120), phone: String(c.phone || '').slice(0, 30), email: SH.emailLc(c.email) || '' })),
    products: (Array.isArray(b.products) ? b.products : []).map(String).slice(0, 10),
    rules: { minRevenue: num(r.minRevenue), minMonths: num(r.minMonths), minScore: num(r.minScore), maxPositions: r.maxPositions === '' || r.maxPositions == null ? null : num(r.maxPositions), maxAmount: num(r.maxAmount),
      restricted: (Array.isArray(r.restricted) ? r.restricted : []).map(String).slice(0, 40), provinces: (Array.isArray(r.provinces) ? r.provinces : []).filter((p) => SH.PROV[p]) } };
  await q(env, 'INSERT INTO lenders (ws, id, name, active, updated_at, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(ws, id) DO UPDATE SET name = excluded.name, active = excluded.active, updated_at = excluded.updated_at, data = excluded.data',
    me.ws, id, name, b.active === false ? 0 : 1, Date.now(), JSON.stringify(data)).run();
  return id;
}
