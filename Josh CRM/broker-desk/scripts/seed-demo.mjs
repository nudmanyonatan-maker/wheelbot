// Seeds a demo brokerage into the LOCAL database: "Crown Merchant Funding" (workspace crown-demo),
// three people, about 2,500 made-up Canadian leads, 12 made-up lenders, deals at every stage, and a
// month of calls, texts and emails, so every screen has something real-looking on it.
// Everything is invented. Phone numbers use the 555-01xx range set aside for fiction, and the
// workspace is flagged demo, so nothing can ever be dialed, texted or emailed from it.
//   node scripts/seed-demo.mjs            (resets the demo workspace and loads it)
//   node scripts/seed-demo.mjs --password <pw>   (sets the sign-in password, default Walkthrough-2026)
//   node scripts/seed-demo.mjs --remote [--invite --url https://...]   (the live database)
//   node scripts/seed-demo.mjs --export public/demo-data   (the files behind the in-app "Reload demo
//     data" button: no logins, every time relative to the moment of the reload, in a few parts)
// On --remote the seeded logins get random passwords nobody knows, and a reset keeps every login,
// password and session as they are, so people who signed in stay signed in. --invite prints a
// one-time link that sets the password for the demo manager (Nathan S.).
import { execFileSync } from 'node:child_process';
import { pbkdf2Sync, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean));
const EXPORT = typeof args.export === 'string' ? args.export : '', REMOTE = !!args.remote || !!EXPORT, WS = 'crown-demo', PW = REMOTE ? randomBytes(24).toString('base64url') : args.password || 'Walkthrough-2026', NOW = Date.now(), DAY = 864e5, HOUR = 36e5, MIN = 6e4;
let seed = 20261015;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const q = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(Math.round(v)) : "'" + String(v).replace(/'/g, "''") + "'";
const js = (o) => q(JSON.stringify(o));
let n = 0; const id = (p) => p + '_' + (NOW).toString(36) + (n++).toString(36).padStart(4, '0');
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(ltd|ltee|inc|corp|corporation|co|the|limited|llc|enterprises)\b/g, ' ').replace(/\s+/g, '').trim();

// ---------- people ----------
const TEAM = [
  { member: 'u1', name: 'Nathan S.', email: 'nathan@crown.example', role: 'manager', number: '+14165550142' },
  { member: 'u2', name: 'Maya Levi', email: 'maya@crown.example', role: 'rep', number: '+16475550187' },
  { member: 'u3', name: 'Jordan Price', email: 'jordan@crown.example', role: 'rep', number: '+19055550163' }
];
// Extra logins on the live demo only (--remote --guest): on the team, but they own no seeded data.
const GUESTS = REMOTE && args.guest ? [{ member: 'u4', name: 'Yonatan N.', email: 'yonatan@crown.example', role: 'manager', number: '+16475550199' }] : [];
const PEOPLE = [...TEAM, ...GUESTS];
function passFor(email, pw) {
  const key = pbkdf2Sync(pw, 'brokerdesk:v1:' + email, 200000, 32, 'sha256').toString('base64url');
  const salt = randomBytes(16).toString('base64url');
  return 'v1$' + salt + '$' + createHash('sha256').update(salt + ':' + key).digest('hex');
}

// ---------- places ----------
const PROVS = [
  ['ON', 0.6, [416, 647, 437, 905, 289, 613, 519, 705, 343, 226], ['Toronto', 'Mississauga', 'Brampton', 'Hamilton', 'Ottawa', 'London', 'Markham', 'Vaughan', 'Kitchener', 'Windsor', 'Oakville', 'Barrie', 'Kingston', 'Oshawa']],
  ['QC', 0.1, [514, 438, 450, 418, 819], ['Montreal', 'Laval', 'Quebec City', 'Gatineau', 'Longueuil', 'Sherbrooke']],
  ['BC', 0.1, [604, 778, 236, 250], ['Vancouver', 'Surrey', 'Burnaby', 'Richmond', 'Victoria', 'Kelowna']],
  ['AB', 0.1, [403, 587, 780, 825], ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge']],
  ['MB', 0.03, [204, 431], ['Winnipeg', 'Brandon']], ['SK', 0.03, [306, 639], ['Saskatoon', 'Regina']],
  ['NS', 0.025, [902, 782], ['Halifax', 'Dartmouth']], ['NB', 0.015, [506], ['Moncton', 'Saint John', 'Fredericton']]
];
const nextNum = {}; // area code -> next 01xx
function phoneIn(prov) {
  const codes = PROVS.find((p) => p[0] === prov)[2];
  for (let tries = 0; tries < 40; tries++) {
    const ac = pick(codes), k = nextNum[ac] || 0;
    if (k < 100) { nextNum[ac] = k + 1; return '+1' + ac + '55501' + String(k).padStart(2, '0'); }
  }
  return null;
}
function provPick() { let r = rnd(), acc = 0; for (const p of PROVS) { acc += p[1]; if (r < acc) return p; } return PROVS[0]; }

// ---------- businesses ----------
const PLACE = ['Maple', 'Northern', 'Lakeshore', 'Bayview', 'Kingsway', 'Riverside', 'Summit', 'Cedar', 'Granite', 'Harbour', 'Prairie', 'Laurentian', 'Ridgeway', 'Oakridge', 'Westend', 'Eastside', 'Union', 'Victoria', 'Dundas', 'Bloor', 'Beaches', 'Danforth', 'Huron', 'Algonquin', 'Muskoka', 'Georgian', 'Thames', 'Humber', 'Rideau', 'Niagara', 'Grand River', 'Kawartha', 'Laurier', 'Mont-Royal', 'Pacific', 'Coastal', 'Rocky', 'Bow River', 'Red River', 'Fundy', 'Kensington', 'Parkdale', 'Leslieville', 'Junction', 'Roncesvalles', 'Liberty', 'Queensway', 'Lakeview', 'Pinecrest', 'Silver Birch', 'Red Maple', 'Ironwood', 'Stonebridge', 'Elmwood', 'Birchmount', 'Highland', 'Valley', 'Northgate', 'Southpoint', 'Twin Oaks'];
const KIND = [['Auto repair', ['Auto Repair', 'Collision', 'Auto Service', 'Tire and Auto']], ['Bakery', ['Bakery', 'Bake Shop', 'Patisserie']], ['Bar or pub', ['Pub', 'Tap House', 'Brewhouse']], ['Beauty salon', ['Salon', 'Hair Studio', 'Nail Bar', 'Spa']],
  ['Café', ['Café', 'Coffee House', 'Coffee Roasters']], ['Cleaning', ['Cleaning Services', 'Janitorial', 'Maids']], ['Construction', ['Construction', 'Contracting', 'Builders', 'Renovations']], ['Dental', ['Dental', 'Dental Studio', 'Dental Care']],
  ['Electrical', ['Electric', 'Electrical Services']], ['Fitness', ['Fitness', 'Gym', 'Athletic Club', 'Yoga Studio']], ['Grocery', ['Grocers', 'Fresh Market', 'Foods']], ['Healthcare', ['Physio Clinic', 'Medical Clinic', 'Wellness Centre', 'Chiropractic']],
  ['Home care', ['Home Care', 'Senior Care']], ['Hotel', ['Inn', 'Motel', 'Suites']], ['HVAC', ['Heating and Cooling', 'HVAC', 'Mechanical']], ['Landscaping', ['Landscaping', 'Lawn Care', 'Gardens']], ['Logistics', ['Logistics', 'Courier', 'Freight']],
  ['Manufacturing', ['Manufacturing', 'Fabrication', 'Machine Works']], ['Plumbing', ['Plumbing', 'Plumbing and Drains']], ['Printing', ['Print Shop', 'Printing', 'Sign and Print']], ['Restaurant', ['Bistro', 'Grill', 'Kitchen', 'Trattoria', 'Shawarma', 'Pho House', 'Pizzeria']],
  ['Retail', ['Boutique', 'Hardware', 'Pharmacy', 'Furniture', 'Pet Supply']], ['Roofing', ['Roofing']], ['Staffing', ['Staffing', 'Recruiting']], ['Trucking', ['Trucking', 'Transport', 'Haulage']], ['Wholesale', ['Wholesale', 'Distributors', 'Imports']]];
const SUFFIX = ['Inc.', 'Ltd.', 'Ltd.', 'Inc.', 'Corp.', '', '', ''];
const FIRST = ['Elena', 'Marco', 'Priya', 'Daniel', 'Sophie', 'Liam', 'Aisha', 'Noah', 'Chloe', 'Ethan', 'Mei', 'Omar', 'Hannah', 'Lucas', 'Zara', 'Mateo', 'Olivia', 'Arjun', 'Isabelle', 'Samuel', 'Fatima', 'Jacob', 'Emma', 'Ravi', 'Nadia', 'Kevin', 'Grace', 'Hassan', 'Julie', 'Wei', 'Mohammed', 'Sarah', 'Andre', 'Leila', 'Tyler', 'Mila', 'Gurpreet', 'Benoit', 'Amara', 'Connor', 'Yasmin', 'Diego', 'Rachel', 'Kofi', 'Anika', 'Pierre', 'Tanya', 'Vikram', 'Carmen', 'Owen'];
const LAST = ['Ruiz', 'Rossi', 'Shah', 'Tremblay', 'Martin', 'Nguyen', 'Khan', 'Wilson', 'Chen', 'Singh', 'Gagnon', 'Brown', 'Patel', 'Roy', 'Li', 'Kowalski', 'Cohen', 'Ali', 'Leblanc', 'Murphy', 'Haddad', 'Fraser', 'Wong', 'Bouchard', 'Silva', 'Sharma', 'Campbell', 'Ahmed', 'Kim', 'Lefebvre', 'Okafor', 'Grant', 'Dubois', 'Mendes', 'Hussain', 'Morrison', 'Pelletier', 'Park', 'Gill', 'Reid'];

const sql = [];
const add = (s) => sql.push(s);

// ---------- reset ----------
['leads', 'contacts', 'activities', 'tasks', 'deals', 'lenders', 'settings', 'member_settings', 'phone_accounts', 'numbers', 'wallet', 'dial_sessions', 'dial_month', 'dial_legs', 'dnc', 'suppress', 'mailboxes', 'sequences', 'enrollments', 'files', 'audit']
  .forEach((t) => add(`DELETE FROM ${t} WHERE ws = ${q(WS)};`));
if (!REMOTE) { add(`DELETE FROM sessions WHERE ws = ${q(WS)};`); add(`DELETE FROM invites WHERE ws = ${q(WS)};`); add(`DELETE FROM users WHERE ws = ${q(WS)};`); add(`DELETE FROM workspaces WHERE id = ${q(WS)};`); }
add(`INSERT INTO workspaces (id, name, slug, brand, created) VALUES (${q(WS)}, 'Crown Merchant Funding', 'crown', ${js({ color: '#1f3fae', logoText: 'Crown Merchant Funding' })}, ${NOW - 200 * DAY}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, brand = excluded.brand;`);
PEOPLE.forEach((t, i) => add(`INSERT INTO users (id, ws, email, name, member, phone, pass, role, created) VALUES (${q('usr_crown_' + t.member)}, ${q(WS)}, ${q(t.email)}, ${q(t.name)}, ${q(t.member)}, ${q(t.number)}, ${q(passFor(t.email, PW))}, ${q(t.role)}, ${NOW - (200 - i) * DAY}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, role = excluded.role;`));
let inviteLink = '';
if (REMOTE && args.invite) {
  const token = randomBytes(24).toString('base64url'), m = TEAM[0];
  add(`INSERT INTO invites (token, ws, email, name, member, phone, role, expires) VALUES (${q(createHash('sha256').update(token).digest('hex'))}, ${q(WS)}, ${q(m.email)}, ${q(m.name)}, ${q(m.member)}, ${q(m.number)}, ${q(m.role)}, ${NOW + 7 * DAY});`);
  inviteLink = String(args.url || '').replace(/\/$/, '') + '/#invite=' + token;
}
const guestLinks = GUESTS.map((g) => {
  const token = randomBytes(24).toString('base64url');
  add(`INSERT INTO invites (token, ws, email, name, member, phone, role, expires) VALUES (${q(createHash('sha256').update(token).digest('hex'))}, ${q(WS)}, ${q(g.email)}, ${q(g.name)}, ${q(g.member)}, ${q(g.number)}, ${q(g.role)}, ${NOW + 7 * DAY});`);
  return 'Set-password link for ' + g.email + ' (one use, 7 days): ' + String(args.url || '').replace(/\/$/, '') + '/#invite=' + token;
});

// ---------- settings ----------
const LISTS = [
  { id: 'l-fresh', name: 'Fresh Leads 2026', filter: { list: 'Fresh Leads 2026' }, sort: 'calls', shared: true },
  { id: 'l-to-call', name: 'Leads to call', filter: { status: ['to-call', 'new'] }, sort: 'calls', shared: true },
  { id: 'l-never', name: 'Never reached out', filter: { contacted: 'never', notStatus: ['dnc', 'bad-number', 'not-interested'] }, sort: 'created', shared: true },
  { id: 'l-oct', name: 'OCT 26 LEADS', filter: { list: 'OCT 26 LEADS' }, sort: 'calls', shared: true },
  { id: 'l-sep', name: 'SEP 26 LEADS', filter: { list: 'SEP 26 LEADS' }, sort: 'calls', shared: true },
  { id: 'l-website', name: 'Website leads', filter: { source: 'website' }, sort: 'created', shared: true },
  { id: 'l-apps', name: 'Applications in', filter: { status: ['app-in'] }, sort: 'recent', shared: true },
  { id: 'l-ontario-rest', name: 'Ontario restaurants', filter: { province: ['ON'], industry: 'Restaurant' }, sort: 'calls', shared: true },
  { id: 'l-new-week', name: 'New this week', filter: { created: '7d' }, sort: 'created', shared: true }
];
const setting = (k, v) => add(`INSERT INTO settings (ws, key, data, updated_at) VALUES (${q(WS)}, ${q(k)}, ${js(v)}, ${NOW});`);
setting('lists', LISTS);
setting('demo', true);
// The demo's calls are simulated, so its calling hours are open all day: people try it at night and
// on weekends. A real brokerage starts on the CRTC hours (9 to 9:30 weekdays, 10 to 6 weekends).
setting('compliance', { sender: { company: 'Crown Merchant Funding', address: '100 King St W, Suite 5700, Toronto ON M5X 1C7', phone: '(416) 555-0142', email: 'info@crown.example' }, recording: false, voicemailDrop: true,
  hours: { weekday: ['00:00', '23:59'], weekend: ['00:00', '23:59'] } });
setting('routing', { mode: 'round-robin', members: ['u1', 'u2', 'u3'], next: 7 });
PEOPLE.forEach((t) => add(`INSERT INTO member_settings (ws, member, data, updated_at) VALUES (${q(WS)}, ${q(t.member)}, ${js({ pinned: ['l-fresh', 'l-to-call', 'l-never', 'l-oct', 'l-website'], lines: 3, signature: t.name.replace(' S.', '') + '\nCrown Merchant Funding\n' + t.number.replace('+1', '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3'), voicemailDrop: true })}, ${NOW});`));

// ---------- phone, mail ----------
add(`INSERT INTO phone_accounts (ws, provider, sub_sid, sub_secret, registration, balance_cents, auto_recharge, spend_cap_cents, markup_pct, created_at) VALUES (${q(WS)}, 'sim', 'SIMcrown-demo', 'plain:{}',
  ${js({ status: 'approved', legalName: 'Crown Merchant Funding Inc.', businessNumber: '000000000RC0001', address: '100 King St W, Toronto ON', website: 'crown.example', submittedAt: NOW - 40 * DAY })}, 14237, ${js({ on: true, below: 2500, amount: 10000 })}, 60000, 0, ${NOW - 120 * DAY});`);
PEOPLE.forEach((t, i) => add(`INSERT INTO numbers (ws, id, e164, label, member, provider_sid, area_code, monthly_cents, created_at) VALUES (${q(WS)}, ${q('pn_crown_' + i)}, ${q(t.number)}, ${q(['Toronto main', 'Toronto 647', 'Mississauga'][i] || 'Toronto, second line')}, ${q(t.member)}, ${q('PNSIM' + i)}, ${q(t.number.slice(2, 5))}, 160, ${NOW - (120 - i * 20) * DAY});`));
PEOPLE.forEach((t) => add(`INSERT INTO mailboxes (ws, member, provider, address, status, connected_at, daily_cap) VALUES (${q(WS)}, ${q(t.member)}, 'sim', ${q(t.email)}, 'connected', ${NOW - 90 * DAY}, 400);`));

// ---------- lenders ----------
const LENDERS = [
  ['ln_maple', 'Maple Ridge Capital', { minRevenue: 20000, minMonths: 6, maxPositions: 2, maxAmount: 250000, restricted: ['Real estate'] }, 10],
  ['ln_north', 'Northbridge Advance', { minRevenue: 30000, minMonths: 12, minScore: 600, maxPositions: 1, maxAmount: 500000 }, 8],
  ['ln_laur', 'Laurentian Business Funding', { minRevenue: 15000, minMonths: 6, maxPositions: 3, provinces: ['QC', 'ON', 'NB'] }, 10],
  ['ln_prairie', 'Prairie Rock Capital', { minRevenue: 25000, minMonths: 12, maxPositions: 2, provinces: ['AB', 'SK', 'MB', 'BC'] }, 9],
  ['ln_harbour', 'Harbourfront Funding', { minRevenue: 40000, minMonths: 24, minScore: 650, maxPositions: 0, maxAmount: 750000 }, 6],
  ['ln_granite', 'Granite Peak Finance', { minRevenue: 10000, minMonths: 4, maxPositions: 4, maxAmount: 75000, restricted: ['Trucking', 'Construction'] }, 12],
  ['ln_lake', 'Lakeshore Merchant Capital', { minRevenue: 20000, minMonths: 9, maxPositions: 2, restricted: ['Bar or pub'] }, 10],
  ['ln_blue', 'Bluewater Advance', { minRevenue: 50000, minMonths: 18, maxPositions: 1, maxAmount: 1000000 }, 7],
  ['ln_summit', 'Summit Lane Capital', { minRevenue: 15000, minMonths: 6, maxPositions: 3 }, 11],
  ['ln_cedar', 'Cedar Grove Funding', { minRevenue: 25000, minMonths: 12, maxPositions: 2, restricted: ['Auto repair'] }, 9],
  ['ln_ottawa', 'Ottawa Valley Capital', { minRevenue: 20000, minMonths: 12, provinces: ['ON'] }, 8],
  ['ln_west', 'Westcoast Merchant Funding', { minRevenue: 30000, minMonths: 12, maxPositions: 2, provinces: ['BC', 'AB'] }, 9]
];
LENDERS.forEach(([lid, name, rules, pts]) => add(`INSERT INTO lenders (ws, id, name, active, updated_at, data) VALUES (${q(WS)}, ${q(lid)}, ${q(name)}, 1, ${NOW}, ${js({ email: 'submissions@' + norm(name).slice(0, 16) + '.example', points: pts, rules: { minRevenue: null, minMonths: null, minScore: null, maxPositions: null, maxAmount: null, restricted: [], provinces: [], ...rules }, contacts: [{ name: pick(FIRST) + ' ' + pick(LAST), phone: '', email: '' }] })});`));

// ---------- leads ----------
const LEADS = [];
// Sized for Cloudflare's free plan: one in-app reload deletes and re-adds every row, and each index
// counts as a write, so the full book (about 2,500 leads, a month of dials) used two thirds of the
// account's 100,000 daily writes. --full brings that book back for local filming.
const SCALE = args.full ? 1 : 0.22, DIAL_DAYS = args.full ? 29 : 11, DIALS = args.full ? [32, 58] : [18, 30];
const LIST_SPEC = [['Fresh Leads 2026', 620, 1, 25, 'import'], ['OCT 26 LEADS', 480, 0, 14, 'import'], ['SEP 26 LEADS', 520, 18, 44, 'import'], ['AUG 26 LEADS', 380, 45, 75, 'import'], ['New Leads May', 300, 130, 160, 'import'],
  ['Website applications', 90, 0, 120, 'website'], ['Referral partners', 70, 0, 150, 'referral']].map((x) => [x[0], Math.round(x[1] * SCALE), x[2], x[3], x[4]]);
function makeLead(o) {
  const p = o.prov ? PROVS.find((x) => x[0] === o.prov) : provPick(), k = o.kind || pick(KIND);
  const name = o.name || (pick(PLACE) + ' ' + pick(k[1]) + (rnd() < 0.5 ? ' ' + pick(SUFFIX) : '')).trim();
  const first = o.first || pick(FIRST), last = o.last || pick(LAST), phone = o.phone || phoneIn(p[0]);
  const dom = norm(name).replace(/(and)$/, '').slice(0, 22) + '.ca';
  return { id: o.id || id('ld'), name, nameNorm: norm(name), prov: p[0], city: o.city || pick(p[3]), industry: k[0], contact: first + ' ' + last, phone, email: o.email !== undefined ? o.email : (rnd() < 0.86 ? first.toLowerCase().replace(/[^a-z]/g, '') + '@' + dom : null),
    revenue: o.revenue || Math.round((15000 + Math.pow(rnd(), 2.2) * 380000) / 1000) * 1000, requested: o.requested || Math.round((10000 + Math.pow(rnd(), 1.8) * 240000) / 5000) * 5000, months: o.months || between(6, 220), score: o.score || between(540, 800), positions: o.positions ?? (rnd() < 0.55 ? 0 : between(1, 3)),
    status: o.status, list: o.list, source: o.source, created: o.created, owner: o.owner, consent: o.consent, custom: o.custom || {}, website: rnd() < 0.5 ? 'www.' + dom : '', calls: 0, lastContact: null, lastCall: null, notes: o.notes || '', dnc: o.status === 'dnc' ? 1 : 0, dealId: null };
}
const STATUS_W = [['to-call', 0.4], ['new', 0.14], ['contacted', 0.2], ['app-sent', 0.06], ['not-interested', 0.1], ['bad-number', 0.05], ['dnc', 0.02], ['app-in', 0.02], ['submitted', 0.01]];
function statusPick() { let r = rnd(), a = 0; for (const s of STATUS_W) { a += s[1]; if (r < a) return s[0]; } return 'to-call'; }

// The leads the walkthrough uses, so the story is the same every take.
const STAR = {
  dial1: makeLead({ name: 'Bayview Auto Repair Ltd.', kind: KIND[0], prov: 'ON', city: 'Toronto', first: 'Kevin', last: 'Wong', status: 'to-call', list: 'Fresh Leads 2026', source: 'import', created: NOW - 2 * HOUR, owner: 'u1', custom: { demoAnswer: 'no-answer', demoRing: 4000 }, revenue: 68000 }),
  dial2: makeLead({ name: 'Kestrel Print Studio', kind: KIND[19], prov: 'ON', city: 'Mississauga', first: 'Hannah', last: 'Moore', status: 'to-call', list: 'Fresh Leads 2026', source: 'import', created: NOW - 2 * HOUR - MIN, owner: 'u1', custom: { demoAnswer: 'voicemail', demoRing: 2400 }, revenue: 52000 }),
  dial3: makeLead({ name: 'Northline Logistics Inc.', kind: KIND[16], prov: 'ON', city: 'Brampton', first: 'Gurpreet', last: 'Gill', status: 'to-call', list: 'Fresh Leads 2026', source: 'import', created: NOW - 2 * HOUR - 2 * MIN, owner: 'u1', custom: { demoAnswer: 'human', demoRing: 5300, demoReply: 'Filling it out now, thanks!', demoReplyAfter: 3 }, revenue: 186000, requested: 120000, months: 64, positions: 1, notes: 'Two trucks added this spring. Wants working capital for fuel cards and payroll.' }),
  dial4: makeLead({ name: 'Granite Peak Roofing', kind: KIND[22], prov: 'ON', city: 'Hamilton', first: 'Owen', last: 'Fraser', status: 'to-call', list: 'Fresh Leads 2026', source: 'import', created: NOW - 2 * HOUR - 3 * MIN, owner: 'u1', custom: { demoAnswer: 'no-answer' } }),
  dial5: makeLead({ name: 'Lakeview Dental Studio', kind: KIND[7], prov: 'ON', city: 'Oakville', first: 'Leila', last: 'Haddad', status: 'to-call', list: 'Fresh Leads 2026', source: 'import', created: NOW - 2 * HOUR - 4 * MIN, owner: 'u1', custom: { demoAnswer: 'voicemail' } }),
  bakery: makeLead({ name: 'Harbour Lane Bakery', kind: KIND[1], prov: 'ON', city: 'Toronto', first: 'Elena', last: 'Ruiz', status: 'app-in', list: 'SEP 26 LEADS', source: 'import', created: NOW - 30 * DAY, owner: 'u1', consent: { type: 'express', source: 'Said yes on the call with Nathan, Sep 16' }, revenue: 48000, requested: 40000, months: 52, score: 690, positions: 0,
    custom: { demoReply: 'Perfect, sending all 4 over now!', demoReplyAfter: 1 }, notes: 'Second location opening in the spring. Busy season is November and December.' }),
  physio: makeLead({ name: 'Riverside Physio Clinic', kind: KIND[11], prov: 'ON', city: 'Ottawa', first: 'Sophie', last: 'Tremblay', status: 'submitted', list: 'AUG 26 LEADS', source: 'import', created: NOW - 50 * DAY, owner: 'u1', consent: { type: 'implied', source: 'Existing relationship' }, revenue: 92000, requested: 75000, months: 84, score: 720, positions: 0 }),
  coffee: makeLead({ name: 'Kensington Coffee Roasters', kind: KIND[4], prov: 'ON', city: 'Toronto', first: 'Mateo', last: 'Silva', status: 'app-in', list: 'Website applications', source: 'website', created: NOW - 14 * MIN, owner: 'u1', consent: { type: 'express', source: 'Application form ' + new Date(NOW).toISOString().slice(0, 10) }, revenue: 34000, requested: 50000, months: 14, score: 702, positions: 1 }),
  dental: makeLead({ name: 'Dundas Street Dental', kind: KIND[7], prov: 'ON', city: 'Toronto', first: 'Priya', last: 'Shah', status: 'contacted', list: 'OCT 26 LEADS', source: 'import', created: NOW - 8 * DAY, owner: 'u1', revenue: 140000, requested: 100000, custom: { demoAnswer: 'human', demoRing: 500 } }),
  pho: makeLead({ name: 'Golden Lotus Pho House', kind: KIND[20], prov: 'ON', city: 'Markham', first: 'Mei', last: 'Nguyen', status: 'app-sent', list: 'OCT 26 LEADS', source: 'import', created: NOW - 6 * DAY, owner: 'u1', consent: { type: 'express', source: 'Opted in by text, Oct 9' } }),
  hvac: makeLead({ name: 'Northern Comfort Heating and Cooling', kind: KIND[14], prov: 'ON', city: 'Barrie', first: 'Connor', last: 'Murphy', status: 'contacted', list: 'SEP 26 LEADS', source: 'import', created: NOW - 25 * DAY, owner: 'u1', consent: { type: 'implied', source: 'Published business contact' } })
};
Object.values(STAR).forEach((l) => LEADS.push(l));
LIST_SPEC.forEach(([list, count, d0, d1, source]) => {
  for (let i = 0; i < count; i++) {
    const created = NOW - (d0 + rnd() * (d1 - d0)) * DAY - rnd() * 8 * HOUR;
    const status = list === 'Fresh Leads 2026' ? (rnd() < 0.7 ? 'to-call' : statusPick()) : list === 'OCT 26 LEADS' ? (rnd() < 0.55 ? 'new' : statusPick()) : source === 'website' ? pick(['app-in', 'contacted', 'app-sent', 'submitted', 'not-interested']) : statusPick();
    const owner = pick(['u1', 'u1', 'u2', 'u3']);
    const consent = source === 'website' ? { type: 'express', source: 'Application form' } : source === 'referral' ? { type: 'implied', source: 'Referral from a partner' } : rnd() < 0.35 ? { type: 'implied', source: 'Published business contact' } : null;
    const l = makeLead({ status, list, source, created, owner, consent });
    if (l.phone) LEADS.push(l);
  }
});

// ---------- history ----------
const ACTS = [];
const act = (a) => ACTS.push(a);
const bizHour = (t) => { const d = new Date(t); d.setHours(9 + Math.floor(rnd() * 9), Math.floor(rnd() * 60), Math.floor(rnd() * 60)); return d.getTime(); };
const numOf = (m) => TEAM.find((t) => t.member === m).number;
const contacted = LEADS.filter((l) => ['contacted', 'app-sent', 'app-in', 'submitted', 'not-interested', 'bad-number', 'to-call'].includes(l.status));
// A month of dialing: about 45 dials a day a person. Jordan's 905 number answers far less often,
// which the dashboard flags as a number going to spam.
for (let d = DIAL_DAYS; d >= 0; d--) {
  const day = new Date(NOW - d * DAY); if (day.getDay() === 0 || day.getDay() === 6) continue;
  TEAM.forEach((t) => {
    const dials = d === 0 ? between(10, 16) : between(DIALS[0], DIALS[1]);
    for (let i = 0; i < dials; i++) {
      const l = pick(contacted); if (!l || l.created > NOW - d * DAY) continue;
      let at = bizHour(NOW - d * DAY); if (at > NOW - 5 * MIN) at = NOW - between(6, 300) * MIN;
      const answer = t.member === 'u3' ? 0.07 : 0.24, r = rnd();
      const status = r < answer ? 'completed' : r < answer + 0.27 ? 'voicemail' : 'no-answer';
      const dur = status === 'completed' ? (rnd() < 0.3 ? between(8, 28) : between(35, 640)) : status === 'voicemail' ? between(18, 34) : 0;
      const outcome = status === 'completed' ? (dur >= 30 ? pick(['Talked', 'Talked', 'Call back later', 'Send application', 'Not interested']) : 'Talked') : status === 'voicemail' ? 'Left voicemail' : 'No answer';
      act({ kind: 'call', dir: 'out', lead: l, member: t.member, at, status, duration: dur, outcome, via: t.number, other: l.phone, data: { voicemailDropped: status === 'voicemail', sessionId: rnd() < 0.7 ? 'ds_hist' : null, lines: 3 }, cost: Math.max(1, Math.ceil(dur / 60) * 2) });
      l.calls++; l.lastCall = Math.max(l.lastCall || 0, at); l.lastContact = Math.max(l.lastContact || 0, at);
      if (status === 'completed' && dur > 60 && rnd() < 0.4) act({ kind: 'note', lead: l, member: t.member, at: at + dur * 1000 + 30000, body: pick(['Owner interested, wants offers by Friday.', 'Sending the application link by text.', 'Has 2 positions already, will wait until one pays off.', 'Busy season, call back in 2 weeks.', 'Asked for statements, said they will email tonight.', 'Not the decision maker. Owner is back Monday.']) });
    }
  });
}
// Emails: a bulk send and sequence emails to leads with consent, plus some replies.
LEADS.filter((l) => l.consent && l.email).slice(0, 700).forEach((l, i) => {
  const at = bizHour(NOW - between(0, 25) * DAY); if (at > NOW) return;
  act({ kind: 'email', dir: 'out', lead: l, member: l.owner, at, status: 'sent', subject: 'Working capital for ' + l.name, body: 'Hi ' + l.contact.split(' ')[0] + ',\n\nI am with Crown Merchant Funding. We help Canadian businesses get $10,000 to $500,000 in working capital, usually within 48 hours.\n\nBest,\n' + TEAM.find((t) => t.member === l.owner).name, via: TEAM.find((t) => t.member === l.owner).email, other: l.email, data: { bulk: true, seqId: 'sq_new' } });
  l.lastContact = Math.max(l.lastContact || 0, at);
  if (i % 14 === 3) act({ kind: 'email', dir: 'in', lead: l, member: l.owner, at: at + between(2, 30) * HOUR, status: 'received', subject: 'Re: Working capital for ' + l.name, body: pick(['Sounds interesting. What do you need from me?', 'Please call me tomorrow morning.', 'How fast can you fund?']), other: l.email });
});
// Texts.
LEADS.filter((l) => l.consent).slice(0, 260).forEach((l, i) => {
  const at = bizHour(NOW - between(1, 20) * DAY);
  act({ kind: 'sms', dir: 'out', lead: l, member: l.owner, at, status: 'delivered', body: 'Hi ' + l.contact.split(' ')[0] + ', this is ' + TEAM.find((t) => t.member === l.owner).name.split(' ')[0] + ' with Crown Merchant Funding. Is now a good time for a quick call about working capital for ' + l.name + '?', via: numOf(l.owner), other: l.phone, cost: 2 });
  if (i % 4 === 1) act({ kind: 'sms', dir: 'in', lead: l, member: l.owner, at: at + between(5, 240) * MIN, status: 'received', body: pick(['Yes, call me after 3', 'Who is this?', 'Not right now', 'Sure, what do you need?', 'Can you text me the application?']), via: numOf(l.owner), other: l.phone });
});

// ---------- the star leads' own history ----------
const B = STAR.bakery, PH = STAR.physio, CO = STAR.coffee, DE = STAR.dental, PO = STAR.pho, HV = STAR.hvac, NL = STAR.dial3;
[[B, 30, 'call', 'completed', 312, 'Talked', 'Elena wants $40k for a second oven and the spring opening. Sending the application.'], [B, 29, 'sms', 'delivered', 0, null, 'Hi Elena, here is the 2-minute application: crown.example/apply. Once it is in, send the last 4 months of bank statements.'],
 [B, 27, 'email', 'sent', 0, null, 'Thanks for applying. To get you offers I just need the last 4 months of business bank statements.'], [B, 3, 'sms', 'delivered', 0, null, 'Hi Elena, thanks for the June to August statements. I just need September and I can send your file today.']]
  .forEach(([l, d, kind, status, dur, outcome, body]) => act({ kind, dir: 'out', lead: l, member: 'u1', at: bizHour(NOW - d * DAY), status, duration: dur, outcome, body, subject: kind === 'email' ? 'Bank statements for Harbour Lane Bakery' : null, via: kind === 'email' ? TEAM[0].email : TEAM[0].number, other: kind === 'email' ? l.email : l.phone }));
act({ kind: 'sms', dir: 'in', lead: B, member: 'u1', at: bizHour(NOW - 3 * DAY) + 40 * MIN, status: 'received', body: 'Will do, the bank is slow this month', via: TEAM[0].number, other: B.phone });
B.calls = 3; B.lastCall = NOW - 30 * DAY; B.lastContact = NOW - 3 * DAY;
// Today's inbox for Nathan.
act({ kind: 'call', dir: 'in', lead: DE, member: 'u1', at: NOW - 38 * MIN, status: 'voicemail', duration: 22, unread: true, via: TEAM[0].number, other: DE.phone, data: { voicemail: "Hi, it's Priya from Dundas Street Dental, returning your call about the funding. Call me back when you can, thanks." } });
act({ kind: 'call', dir: 'in', lead: HV, member: 'u1', at: NOW - 95 * MIN, status: 'missed', duration: 0, unread: true, via: TEAM[0].number, other: HV.phone });
act({ kind: 'sms', dir: 'out', lead: PO, member: 'u1', at: NOW - 3 * HOUR, status: 'delivered', body: 'Hi Mei, here is the application link: crown.example/apply. Takes 2 minutes.', via: TEAM[0].number, other: PO.phone });
act({ kind: 'sms', dir: 'in', lead: PO, member: 'u1', at: NOW - 52 * MIN, status: 'received', body: 'Filled it out. How long until we hear back?', unread: true, via: TEAM[0].number, other: PO.phone });
act({ kind: 'sms', dir: 'in', lead: PO, member: 'u1', at: NOW - 51 * MIN, status: 'received', body: 'Also can I get more than 30k?', unread: true, via: TEAM[0].number, other: PO.phone });
act({ kind: 'email', dir: 'in', lead: HV, member: 'u1', at: NOW - 2 * HOUR, status: 'received', subject: 'Re: Working capital for Northern Comfort Heating and Cooling', body: 'Hi Nathan, attached are our last four statements. Let me know what else you need. Connor', unread: true, other: HV.email });
act({ kind: 'form', dir: 'in', lead: CO, member: 'u1', at: NOW - 14 * MIN, unread: true, body: 'Applied on the website for $50,000, with 3 statements.', data: { consent: 'Application form' } });
LEADS.forEach((l) => { if (l.calls && !l.lastContact) l.lastContact = l.lastCall; });

// ---------- deals ----------
const DEALS = [];
const stmts = (n) => { const o = { app: NOW - 20 * DAY }; for (let i = 1; i <= n; i++) o['s' + i] = NOW - 10 * DAY; return o; };
function sub(lid, sentDaysAgo, status, offers, hours) {
  const s = { id: id('sb'), lenderId: lid, sentAt: NOW - sentDaysAgo * DAY, status, reason: null, respondedAt: null, offers: [] };
  if (status !== 'sent') s.respondedAt = s.sentAt + (hours || between(4, 40)) * HOUR;
  if (status === 'declined') s.reason = pick(['Revenue too low', 'Too many positions', 'NSFs on statements', 'Restricted industry', 'Credit too low']);
  if (status === 'approved') s.offers = offers.map((o) => ({ id: id('of'), ...o }));
  return s;
}
function deal(l, stage, o = {}) {
  const d = { id: o.id || id('dl'), lead: l, owner: l.owner, stage, business: l.name, requested: l.requested, created: o.created || NOW - 20 * DAY, stageAt: o.stageAt || NOW - between(0, 4) * DAY,
    merchant: { monthlyRevenue: l.revenue, months: l.months, score: l.score, positions: l.positions, industry: l.industry, province: l.prov }, paperwork: o.paperwork || stmts(3), submissions: o.submissions || [], accepted: null, closing: o.closing || {}, points: null, terms: null,
    fundedAmount: null, fundedAt: null, lenderId: null, commission: null, commissionPaidAt: null, closed: o.closed || null, renewalOf: null };
  if (o.paperwork === undefined) { d.paperwork.id = NOW - 10 * DAY; d.paperwork.void = NOW - 10 * DAY; }
  l.dealId = d.id; DEALS.push(d); return d;
}
// The ones the walkthrough opens.
deal(B, 'statements', { id: 'dl_bakery', created: NOW - 27 * DAY, stageAt: NOW - 20 * DAY, paperwork: { app: NOW - 27 * DAY, s2: NOW - 4 * DAY, s3: NOW - 4 * DAY, s4: NOW - 4 * DAY, id: NOW - 26 * DAY } });
const phd = deal(PH, 'offers', { id: 'dl_physio', created: NOW - 9 * DAY, stageAt: NOW - 1 * DAY, submissions: [
  sub('ln_maple', 3, 'approved', [{ amount: 75000, factor: 1.32, termMonths: 9, freq: 'daily', points: 10 }, { amount: 60000, factor: 1.28, termMonths: 8, freq: 'daily', points: 10 }], 20),
  sub('ln_north', 3, 'approved', [{ amount: 70000, factor: 1.27, termMonths: 10, freq: 'weekly', points: 8 }], 30),
  sub('ln_blue', 3, 'declined', null, 6), sub('ln_ottawa', 3, 'sent')] });
[[3, 'Sent the file to Maple Ridge Capital, Northbridge Advance, Bluewater Advance, Ottawa Valley Capital.', 'out'], [3 - 6 / 24, 'Bluewater Advance declined: Too many positions.', 'in'],
 [3 - 20 / 24, 'Maple Ridge Capital approved with 2 offers, best $75,000.', 'in'], [3 - 30 / 24, 'Northbridge Advance approved with 1 offer, best $70,000.', 'in']]
  .forEach(([d, body, dir]) => act({ kind: 'submission', dir, lead: PH, dealId: 'dl_physio', member: 'u1', at: NOW - d * DAY, body }));
deal(CO, 'app', { id: 'dl_coffee', created: NOW - 14 * MIN, stageAt: NOW - 14 * MIN, paperwork: { app: NOW - 14 * MIN, s1: NOW - 14 * MIN, s2: NOW - 14 * MIN, s3: NOW - 14 * MIN } });
// A lender reply waiting in the inbox.
const hvd = deal(HV, 'offers', { created: NOW - 6 * DAY, stageAt: NOW - 40 * MIN, submissions: [sub('ln_summit', 2, 'approved', [{ amount: 55000, factor: 1.35, termMonths: 8, freq: 'daily', points: 11 }], 46), sub('ln_cedar', 2, 'sent')] });
act({ kind: 'submission', dir: 'in', lead: HV, dealId: hvd.id, member: 'u1', at: NOW - 40 * MIN, unread: true, body: 'Summit Lane Capital approved with 1 offer, best $55,000.' });
// The rest of the book.
const pool = LEADS.filter((l) => !Object.values(STAR).includes(l) && ['app-in', 'submitted', 'contacted', 'app-sent'].includes(l.status));
const lenderIds = LENDERS.map((x) => x[0]);
const plan = [['app', 3], ['statements', 6], ['submitted', 8], ['offers', 4], ['contracts', 4], ['funded', 24], ['dead', 10]];
plan.forEach(([stage, count]) => {
  for (let i = 0; i < count; i++) {
    const l = pool.shift(); if (!l) return;
    const recentFund = stage === 'funded' && i < 5;
    const created = recentFund ? NOW - between(6, 16) * DAY : stage === 'funded' ? NOW - between(30, 200) * DAY : NOW - between(2, 30) * DAY;
    const lids = [...lenderIds].sort(() => rnd() - 0.5).slice(0, between(2, 4));
    const offerFor = () => [{ amount: Math.round(l.requested * (0.6 + rnd() * 0.4) / 2500) * 2500, factor: Math.round((1.24 + rnd() * 0.16) * 100) / 100, termMonths: between(6, 12), freq: rnd() < 0.6 ? 'daily' : 'weekly', points: between(6, 12) }];
    const subs = stage === 'app' || stage === 'statements' ? [] : lids.map((lid, j) => sub(lid, Math.max(1, Math.round((NOW - created) / DAY) - 1), stage === 'submitted' ? (j === 0 ? 'declined' : 'sent') : stage === 'dead' ? 'declined' : (j === 0 ? 'approved' : rnd() < 0.5 ? 'declined' : 'approved'), offerFor()));
    const d = deal(l, stage, { created, stageAt: recentFund ? created + between(2, 4) * DAY : stage === 'funded' ? created + between(3, 9) * DAY : NOW - between(0, 6) * DAY, submissions: subs, paperwork: stage === 'statements' ? { app: created, s1: created + DAY } : undefined });
    if (stage === 'dead') d.closed = { kind: 'declined', reason: pick(['Revenue too low', 'Too many positions', 'NSFs on statements']), note: '', at: d.stageAt, from: 'submitted' };
    if (stage === 'contracts' || stage === 'funded') {
      const s = subs.find((x) => x.status === 'approved'), off = s.offers[0];
      d.accepted = { submissionId: s.id, offerId: off.id }; d.terms = { ...off }; d.points = off.points; d.lenderId = s.lenderId;
      d.closing = stage === 'funded' ? { signed: d.stageAt, bankverify: d.stageAt, call: d.stageAt } : { signed: NOW - DAY };
      if (stage === 'funded') { d.fundedAmount = off.amount; d.fundedAt = d.stageAt; d.commission = Math.round(off.amount * off.points / 100); d.commissionPaidAt = NOW - d.fundedAt > 25 * DAY ? d.fundedAt + 14 * DAY : null; l.status = 'funded'; }
    }
  }
});

// ---------- tasks ----------
const TASKS = [];
const today = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
[[B, today(9, 30), 'Get the September statement from Elena'], [STAR.pho, today(11, 0), 'Call Mei about her application'], [PH, today(14, 0), 'Go over offers with Sophie'], [STAR.dental, today(16, 30), 'Call Priya back'], [STAR.hvac, NOW - DAY, 'Check Connor\'s statements came through']]
  .forEach(([l, due, note]) => TASKS.push({ id: id('tk'), lead: l, member: 'u1', due, note }));
LEADS.filter((l) => l.owner !== 'u1' && l.status === 'contacted').slice(0, 30).forEach((l) => TASKS.push({ id: id('tk'), lead: l, member: l.owner, due: NOW + between(-2, 5) * DAY, note: 'Follow up' }));

// ---------- write it ----------
LEADS.forEach((l) => {
  const c = l.consent || { type: 'none' };
  add(`INSERT INTO leads (ws, id, owner, name, name_norm, status, source, list_tag, province, city, industry, contact_name, phone_key, email_lc, monthly_revenue, requested, consent, consent_source, consent_at, dnc, created_at, updated_at, last_contact_at, last_call_at, calls, deal_id, data) VALUES (${q(WS)}, ${q(l.id)}, ${q(l.owner)}, ${q(l.name)}, ${q(l.nameNorm)}, ${q(l.status)}, ${q(l.source)}, ${q(l.list)}, ${q(l.prov)}, ${q(l.city)}, ${q(l.industry)}, ${q(l.contact)}, ${q(l.phone.slice(-10))}, ${q(l.email)}, ${l.revenue}, ${l.requested}, ${q(c.type)}, ${q(c.source || null)}, ${c.type === 'none' ? 'NULL' : l.created}, ${l.dnc}, ${Math.round(l.created)}, ${Math.round(l.created)}, ${l.lastContact ? Math.round(l.lastContact) : 'NULL'}, ${l.lastCall ? Math.round(l.lastCall) : 'NULL'}, ${l.calls}, ${q(l.dealId)}, ${js({ website: l.website, notes: l.notes, months: l.months, score: l.score, positions: l.positions, custom: l.custom })});`);
  add(`INSERT INTO contacts (ws, lead_id, id, pos, name, title, phone, phone_key, email, email_lc) VALUES (${q(WS)}, ${q(l.id)}, 'c0', 0, ${q(l.contact)}, 'Owner', ${q(l.phone)}, ${q(l.phone.slice(-10))}, ${q(l.email)}, ${q(l.email)});`);
  if (l.dnc) add(`INSERT OR IGNORE INTO dnc (ws, phone_key, reason, at) VALUES (${q(WS)}, ${q(l.phone.slice(-10))}, 'Asked not to be called', ${Math.round(l.created + DAY)});`);
});
ACTS.forEach((a) => add(`INSERT INTO activities (ws, id, lead_id, deal_id, kind, dir, member, at, status, duration, outcome, subject, body, other, via, unread, cost_cents, data) VALUES (${q(WS)}, ${q(id('ac'))}, ${q(a.lead && a.lead.id)}, ${q(a.dealId || (a.lead && a.lead.dealId && a.kind === 'submission' ? a.lead.dealId : null))}, ${q(a.kind)}, ${q(a.dir || null)}, ${q(a.member)}, ${Math.round(a.at)}, ${q(a.status || null)}, ${a.duration == null ? 'NULL' : a.duration}, ${q(a.outcome || null)}, ${q(a.subject || null)}, ${q(a.body || null)}, ${q(a.other || null)}, ${q(a.via || null)}, ${a.unread ? 1 : 0}, ${a.cost || 'NULL'}, ${js({ ...(a.data || {}), settled: true })});`));
DEALS.forEach((d) => add(`INSERT INTO deals (ws, id, lead_id, owner, stage, business, requested, funded_amount, funded_at, lender_id, commission, commission_paid_at, created_at, updated_at, stage_at, data) VALUES (${q(WS)}, ${q(d.id)}, ${q(d.lead.id)}, ${q(d.owner)}, ${q(d.stage)}, ${q(d.business)}, ${d.requested || 'NULL'}, ${d.fundedAmount || 'NULL'}, ${d.fundedAt ? Math.round(d.fundedAt) : 'NULL'}, ${q(d.lenderId)}, ${d.commission || 'NULL'}, ${d.commissionPaidAt ? Math.round(d.commissionPaidAt) : 'NULL'}, ${Math.round(d.created)}, ${Math.round(d.stageAt)}, ${Math.round(d.stageAt)}, ${js({ merchant: d.merchant, paperwork: d.paperwork, submissions: d.submissions, accepted: d.accepted, closing: d.closing, points: d.points, terms: d.terms, closed: d.closed, renewalOf: null, notes: '' })});`));
TASKS.forEach((t) => add(`INSERT INTO tasks (ws, id, lead_id, member, due_at, note, kind, created_at) VALUES (${q(WS)}, ${q(t.id)}, ${q(t.lead.id)}, ${q(t.member)}, ${Math.round(t.due)}, ${q(t.note)}, 'follow-up', ${NOW - 2 * DAY});`));
LEADS.forEach((l) => { const t = TASKS.filter((x) => x.lead === l).sort((a, b) => a.due - b.due)[0]; if (t) add(`UPDATE leads SET next_task_at = ${Math.round(t.due)} WHERE ws = ${q(WS)} AND id = ${q(l.id)};`); });

// Sequences and who is in them.
const SEQ = [
  ['sq_new', 'New lead follow-up', [{ id: 's0', wait: 0, kind: 'email', subject: 'Working capital for {business}', body: 'Hi {first},\n\nI am {rep} with {company}. We help Canadian businesses get $10,000 to $500,000 in working capital, usually within 48 hours.\n\nThe application takes two minutes: {apply}\n\nBest,\n{rep}' },
    { id: 's1', wait: 2, kind: 'sms', subject: '', body: 'Hi {first}, it is {rep} with {company}. Did you get my email about funding for {business}? Reply STOP to opt out.' }, { id: 's2', wait: 4, kind: 'task', subject: '', body: 'Call {first}' },
    { id: 's3', wait: 7, kind: 'email', subject: 'Following up', body: 'Hi {first},\n\nFollowing up on funding for {business}. Is now still a good time?\n\nBest,\n{rep}' }]],
  ['sq_stmt', 'Statements chase', [{ id: 's0', wait: 0, kind: 'sms', subject: '', body: 'Hi {first}, just need the last 4 months of business bank statements for {business} and I can send your file today.' },
    { id: 's1', wait: 1, kind: 'email', subject: 'Bank statements for {business}', body: 'Hi {first},\n\nTo get you offers I just need the last 4 months of business bank statements. Reply with them attached.\n\nBest,\n{rep}' }, { id: 's2', wait: 3, kind: 'task', subject: '', body: 'Call {first} about statements' }]],
  ['sq_renew', 'Renewal check-in', [{ id: 's0', wait: 0, kind: 'email', subject: 'How is {business} doing?', body: 'Hi {first},\n\nYou are past halfway on your advance, so you can renew if more working capital would help.\n\nBest,\n{rep}' }, { id: 's1', wait: 3, kind: 'task', subject: '', body: 'Call {first} about renewing' }]]
];
SEQ.forEach(([sid, name, steps]) => add(`INSERT INTO sequences (ws, id, name, active, steps, created_at, updated_at) VALUES (${q(WS)}, ${q(sid)}, ${q(name)}, 1, ${js(steps)}, ${NOW - 60 * DAY}, ${NOW - 10 * DAY});`));
add(`INSERT INTO sequences (ws, id, name, active, steps, created_at, updated_at) VALUES (${q(WS)}, 'sq_bulk1', 'Bulk email: Working capital before the holidays', 1, ${js([{ id: 's0', wait: 0, kind: 'email', subject: 'Working capital before the holidays', body: '...' }])}, ${NOW - 12 * DAY}, ${NOW - 12 * DAY});`);
LEADS.filter((l) => l.consent && l.email).slice(0, 640).forEach((l, i) => {
  const st = i < 150 ? 'active' : i < 210 ? 'replied' : i < 560 ? 'done' : 'stopped';
  add(`INSERT INTO enrollments (ws, id, seq_id, lead_id, member, step, next_at, status, created_at, updated_at) VALUES (${q(WS)}, ${q(id('en'))}, ${q(i % 9 === 0 ? 'sq_bulk1' : 'sq_new')}, ${q(l.id)}, ${q(l.owner)}, ${st === 'active' ? between(1, 3) : 4}, ${st === 'active' ? NOW + between(1, 6) * DAY : 'NULL'}, ${q(i % 9 === 0 ? 'done' : st)}, ${NOW - 20 * DAY}, ${NOW - 2 * DAY});`);
});

// The dialer's month so far and the wallet's history.
add(`INSERT INTO dial_month (ws, month, placed, answered, abandoned) VALUES (${q(WS)}, ${q(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'))}, 1240, 236, 34);`);
let bal = 0;
for (let d = 14; d >= 0; d--) {
  const t = NOW - d * DAY; if ([0, 6].includes(new Date(t).getDay())) continue;
  add(`INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (${q(WS)}, ${q(id('wl'))}, ${t - 2 * HOUR}, 'call', ${-between(380, 640)}, 'Calls, ' || ${q(new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }))});`);
  add(`INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (${q(WS)}, ${q(id('wl'))}, ${t - HOUR}, 'sms', ${-between(20, 90)}, 'Texts, ' || ${q(new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }))});`);
}
[[12, 10000, 'Auto top-up'], [5, 10000, 'Auto top-up'], [1, 10000, 'Auto top-up']].forEach(([d, c, note]) => add(`INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (${q(WS)}, ${q(id('wl'))}, ${NOW - d * DAY}, 'topup', ${c}, ${q(note)});`));
PEOPLE.forEach((t, i) => add(`INSERT INTO wallet (ws, id, at, kind, cents, note) VALUES (${q(WS)}, ${q(id('wl'))}, ${NOW - 14 * DAY + i}, 'number', -160, ${q('Number ' + t.number.replace('+1', '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') + ', monthly')});`));

if (EXPORT) { exportParts(EXPORT); process.exit(0); }
const file = path.join(os.tmpdir(), 'broker-desk-seed.sql');
fs.writeFileSync(file, sql.join('\n'));
execFileSync('npx', ['wrangler', 'd1', 'execute', 'broker-desk', ...(REMOTE ? ['--remote', '--env', 'production'] : ['--local']), '--yes', '--file', file], { stdio: ['ignore', 'ignore', 'inherit'], cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..') });
fs.rmSync(file, { force: true });
console.log(`seeded ${LEADS.length} leads, ${ACTS.length} activities, ${DEALS.length} deals, ${TASKS.length} tasks.` + (REMOTE ? '' : ` Sign in as ${TEAM[0].email} / ${PW}`));
if (inviteLink) console.log('Set-password link for ' + TEAM[0].email + ' (one use, 7 days): ' + inviteLink);
guestLinks.forEach((x) => console.log(x));

// ---------- export for the in-app reset ----------
// Times become (?1+offset) so the server binds the moment of the reset. Times inside quoted JSON
// become printf('...%d...', ?1+offset). Rows for the same table are merged into multi-row inserts,
// and the statements are split into parts small enough for one request each.
function exportParts(dir) {
  const TS = /\b1[6-9]\d{11}(?:\.\d+)?(?![\d.])/g, rel = (v) => { const d = Math.round(Number(v) - NOW); return '(?1' + (d >= 0 ? '+' : '') + d + ')'; };
  const relativize = (st) => {
    let out = '', i = 0;
    while (i < st.length) {
      const a = st.indexOf("'", i);
      out += (a < 0 ? st.slice(i) : st.slice(i, a)).replace(TS, rel);
      if (a < 0) break;
      let j = a + 1;
      for (;;) { const k = st.indexOf("'", j); if (k < 0) throw new Error('unclosed quote'); if (st[k + 1] === "'") { j = k + 2; continue; } j = k; break; }
      const inner = st.slice(a + 1, j), hits = inner.match(TS);
      out += !hits || hits.length > 90 ? "'" + inner + "'" : "printf('" + inner.replace(/%/g, '%%').replace(TS, '%d') + "', " + hits.map(rel).join(', ') + ')';
      i = j + 1;
    }
    return out;
  };
  const keep = sql.filter((st) => !/^INSERT INTO (users|invites|workspaces) /.test(st));
  // Deletes first, then every table's rows as multi-row inserts, then the few updates.
  const pre = [], groups = new Map(), post = [];
  for (const raw of keep) {
    const st = relativize(raw).replace(/^INSERT INTO /, 'INSERT OR REPLACE INTO ');
    const m = /^(INSERT OR REPLACE INTO \w+ \([^)]*\)) VALUES (.*);$/s.exec(st);
    if (/^DELETE /.test(st)) pre.push(st);
    else if (m && !/ ON CONFLICT /.test(m[2])) { if (!groups.has(m[1])) groups.set(m[1], []); groups.get(m[1]).push(m[2]); }
    else post.push(st);
  }
  const merged = [...pre];
  for (const [head, rows] of groups) {
    let cur = [], len = 0;
    for (const r of rows) {
      if (cur.length && (len + r.length > 80000 || cur.length >= 400)) { merged.push(head + ' VALUES ' + cur.join(',') + ';'); cur = []; len = 0; }
      cur.push(r); len += r.length + 1;
    }
    if (cur.length) merged.push(head + ' VALUES ' + cur.join(',') + ';');
  }
  merged.push(...post);
  const parts = [[]];
  let size = 0;
  for (const st of merged) {
    const last = parts[parts.length - 1];
    if (last.length && (last.length >= 30 || size + st.length > 700000)) { parts.push([]); size = 0; }
    parts[parts.length - 1].push(st); size += st.length;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  parts.forEach((p, i) => fs.writeFileSync(path.join(dir, 'part-' + i + '.sql'), p.join('\n--8<--\n')));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ws: WS, parts: parts.length, built: NOW, statements: merged.length, leads: LEADS.length }));
  console.log('exported ' + merged.length + ' statements in ' + parts.length + ' parts to ' + dir + ' (' + Math.round(merged.reduce((n, s) => n + s.length, 0) / 1024) + ' KB)');
}
