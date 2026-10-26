// What a new brokerage starts with: statuses, saved lists, templates, the application form and
// lead routing. Every one of these can be changed in Settings.
import { SH, getSetting, all, one, q } from './server.js';
import { COMPLIANCE_DEFAULTS } from './compliance.js';

export const DEFAULT_LISTS = [
  { id: 'l-to-call', name: 'Leads to call', filter: { status: ['to-call', 'new'] }, sort: 'calls' },
  { id: 'l-never', name: 'Never reached out', filter: { contacted: 'never', notStatus: ['dnc', 'bad-number', 'not-interested'] }, sort: 'created' },
  { id: 'l-new-week', name: 'New this week', filter: { created: '7d' }, sort: 'created' },
  { id: 'l-apps', name: 'Applications in', filter: { status: ['app-in'] }, sort: 'recent' },
  { id: 'l-website', name: 'Website leads', filter: { source: 'website' }, sort: 'created' }
];
export const DEFAULT_TEMPLATES = {
  sms: [
    { id: 't-intro', name: 'Intro', body: 'Hi {first}, this is {rep} with {company}. We help businesses like {business} get working capital in 24 to 48 hours. Is now a good time for a quick call?' },
    { id: 't-app', name: 'Application link', body: 'Hi {first}, here is the 2-minute application: {apply}. Once it is in, send the last 4 months of bank statements and I will get you offers.' },
    { id: 't-statements', name: 'Need statements', body: 'Hi {first}, I just need the last 4 months of business bank statements for {business} and I can send your file to our lenders today.' },
    { id: 't-offer', name: 'Offer is in', body: 'Hi {first}, good news: {business} is approved. Do you have 5 minutes to go over the offers?' },
    { id: 't-checkin', name: 'Checking in', body: 'Hi {first}, checking in. Is funding still something you are looking at for {business}?' }
  ],
  email: [
    { id: 'e-intro', name: 'Intro', subject: 'Working capital for {business}', body: 'Hi {first},\n\nI am {rep} with {company}. We help Canadian businesses get $10,000 to $500,000 in working capital, usually within 48 hours, based on revenue rather than credit.\n\nIf that would help {business}, the application takes two minutes: {apply}\n\nBest,\n{rep}' },
    { id: 'e-statements', name: 'Need statements', subject: 'Bank statements for {business}', body: 'Hi {first},\n\nThanks for applying. To get you offers I just need the last 4 months of business bank statements. You can reply to this email with them attached.\n\nBest,\n{rep}' },
    { id: 'e-followup', name: 'Follow-up', subject: 'Following up', body: 'Hi {first},\n\nFollowing up on funding for {business}. Is now still a good time? Happy to answer any questions.\n\nBest,\n{rep}' }
  ]
};
export const DEFAULT_FORM = {
  title: 'Apply for business funding', intro: 'Two minutes. No hard credit check. Most files get offers within 24 hours.',
  consentText: 'I agree to be contacted by email, phone and text about funding. I can unsubscribe at any time.',
  thanks: 'Thanks. We have your application and will be in touch shortly. If you have your last 4 months of bank statements handy, you can upload them now.',
  askStatements: true
};
export const DEFAULT_ROUTING = { mode: 'round-robin', members: [], next: 0 };
export const DEFAULT_PHONE = { greeting: 'You have reached {company}. Please leave your name, business and number, and we will call you right back.', ringSeconds: 20 };

export async function wsSettings(env, ws) {
  const rows = await all(env, 'SELECT key, data FROM settings WHERE ws = ?', ws), s = {};
  rows.forEach((r) => { try { s[r.key] = JSON.parse(r.data); } catch { /* skip */ } });
  return {
    demo: s.demo === true, statuses: s.statuses || SH.STATUSES, lists: s.lists || DEFAULT_LISTS, templates: s.templates || DEFAULT_TEMPLATES,
    compliance: { ...COMPLIANCE_DEFAULTS, ...(s.compliance || {}), sender: { ...COMPLIANCE_DEFAULTS.sender, ...((s.compliance || {}).sender || {}) } },
    phone: { ...DEFAULT_PHONE, ...(s.phone || {}) }, form: { ...DEFAULT_FORM, ...(s.form || {}) }, routing: { ...DEFAULT_ROUTING, ...(s.routing || {}) }
  };
}
export async function memberSettings(env, ws, member) {
  const r = await one(env, 'SELECT data FROM member_settings WHERE ws = ? AND member = ?', ws, member);
  let d = {}; try { d = r ? JSON.parse(r.data) : {}; } catch { d = {}; }
  return { pinned: d.pinned || DEFAULT_LISTS.slice(0, 4).map((l) => l.id), lines: d.lines || 2, signature: d.signature || '', forwardTo: d.forwardTo || '', voicemailDrop: d.voicemailDrop !== false };
}
export async function putMemberSettings(env, ws, member, patch) {
  const cur = await memberSettings(env, ws, member), next = { ...cur, ...patch };
  await q(env, 'INSERT INTO member_settings (ws, member, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(ws, member) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    ws, member, JSON.stringify(next), Date.now()).run();
  return next;
}
// Who gets the next website lead: round-robin over the chosen people, or a fixed person.
export async function nextOwner(env, ws) {
  const r = { ...DEFAULT_ROUTING, ...(await getSetting(env, ws, 'routing', {})) };
  const active = (await all(env, 'SELECT member FROM users WHERE ws = ? AND disabled_at IS NULL ORDER BY created', ws)).map((x) => x.member);
  const pool = (r.members && r.members.length ? r.members.filter((m) => active.includes(m)) : active);
  if (!pool.length) return null;
  if (r.mode === 'owner') return pool[0];
  const pick = pool[(r.next || 0) % pool.length];
  await q(env, 'INSERT INTO settings (ws, key, data, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(ws, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    ws, 'routing', JSON.stringify({ ...r, next: (r.next || 0) + 1 }), Date.now()).run();
  return pick;
}
