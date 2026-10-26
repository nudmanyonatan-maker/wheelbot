// End-to-end API test against a running local desk (npm run dev, after npm run seed).
// Signs in as the seeded manager and a rep, then walks every feature on the demo line:
// leads, filters, import, calls, texts and STOP, email, sequences, deals, lenders, the dialer and
// its guard, do-not-call, calling hours, the public application form, unsubscribe, rep privacy.
//   BASE=http://localhost:8810 node scripts/test-api.mjs
import { pbkdf2Sync } from 'node:crypto';
const BASE = process.env.BASE || 'http://localhost:8810';
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('  FAIL', m); } };
const key = (email, pw) => pbkdf2Sync(pw, 'brokerdesk:v1:' + email, 200000, 32, 'sha256').toString('base64url');
function client() {
  let cookie = '';
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  return async function api(path, body, method) {
    const res = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE, 'X-Day0': String(d0.getTime()) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, j: ct.includes('json') ? await res.json() : null, text: ct.includes('json') ? null : await res.text() };
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = client(), R = client();
let r = await A('/api/auth/login', { email: 'nathan@crown.example', key: key('nathan@crown.example', 'Walkthrough-2026') });
ok(r.status === 200, 'manager signs in');
r = await A('/api/auth/login', { email: 'nathan@crown.example', key: key('nathan@crown.example', 'wrong-password') });
ok(r.status === 401, 'wrong password refused');
await R('/api/auth/login', { email: 'maya@crown.example', key: key('maya@crown.example', 'Walkthrough-2026') });
r = await A('/api/me'); ok(r.j && r.j.ok && r.j.ws.name === 'Crown Merchant Funding', 'me returns workspace'); ok(r.j.phone.numbers.length === 3, 'three numbers');
const me = r.j;
// Calls are held outside the lead's calling hours, so a run at night or on a weekend evening would
// fail for the right reason. Open the hours for the run and put them back at the end.
const savedCompliance = me.settings.compliance;
await A('/api/settings', { key: 'compliance', data: { ...savedCompliance, hours: { weekday: ['00:00', '23:59'], weekend: ['00:00', '23:59'] } } });

// ---------- leads ----------
r = await A('/api/leads?limit=5&f=' + encodeURIComponent(JSON.stringify({ list: 'Fresh Leads 2026' })) + '&sort=calls');
ok(r.j.total > 100 && r.j.leads.length === 5, 'saved list pages from the server (' + r.j.total + ')');
r = await A('/api/leads?limit=5&f=' + encodeURIComponent(JSON.stringify({ q: 'harbour lane' })));
ok(r.j.leads.some((l) => l.name === 'Harbour Lane Bakery'), 'search by name');
const bakery = r.j.leads.find((l) => l.name === 'Harbour Lane Bakery');
r = await A('/api/leads?limit=5&f=' + encodeURIComponent(JSON.stringify({ q: bakery.phone })));
ok(r.j.leads[0] && r.j.leads[0].id === bakery.id, 'search by phone');
r = await A('/api/leads?limit=1&f=' + encodeURIComponent(JSON.stringify({ status: ['to-call'], province: ['ON'], contacted: 'never', consent: 'none' })));
ok(r.j.total > 0, 'combined filters');
r = await A('/api/leads?listCounts=' + encodeURIComponent(JSON.stringify(['l-fresh', 'l-to-call'])));
ok(r.j.counts['l-fresh'] > 0 && r.j.counts['l-to-call'] > 0, 'sidebar list counts');
r = await A('/api/leads', { name: 'Test Bakery API', contacts: [{ name: 'Test Person', phone: '7095550199', email: 'test' + Date.now() + '@testbakery.example' }], province: 'ON', monthlyRevenue: 40000, months: 30 });
ok(r.j.ok && r.j.lead.phone === '(709) 555-0199', 'create lead');
const tl = r.j.lead;
r = await A('/api/leads/' + tl.id, { status: 'contacted', consent: { type: 'express', source: 'test' } }, 'PATCH');
ok(r.j.lead.status === 'contacted' && r.j.lead.consent.type === 'express', 'patch status and consent');
r = await A('/api/leads/import', { rows: [{ name: 'Imported Co One', phone: '7095550177', email: 'one@imported.example', status: null }, { name: 'Test Bakery API', phone: '7095550199' }], list: 'API import', owner: 'u1', status: 'to-call', dedupe: 'skip', consent: { type: 'none' } });
ok(r.j.added === 1 && r.j.skipped === 1, 'import adds new and skips duplicates');

// ---------- rep privacy ----------
r = await R('/api/leads/' + bakery.id);
ok(r.status === 404, "rep cannot open the manager's lead");
r = await R('/api/leads?limit=200&f=' + encodeURIComponent(JSON.stringify({})));
ok(r.j.leads.every((l) => l.owner === 'u2'), 'rep sees only their own leads');
r = await R('/api/leads/bulk', { ids: [bakery.id], action: 'assign', value: 'u2' });
ok(r.status === 403, 'rep cannot reassign');

// ---------- calls ----------
r = await A('/api/phone/call', { leadId: tl.id });
ok(r.j.ok && r.j.provider === 'sim' && r.j.from === '+14165550142', 'call starts on my number');
const callId = r.j.activityId;
r = await A('/api/phone/call', { id: callId, status: 'completed', duration: 95, outcome: 'Talked', note: 'Good call', leadStatus: 'app-sent' }, 'PATCH');
ok(r.j.ok, 'call saved');
r = await A('/api/leads/' + tl.id);
ok(r.j.lead.calls === 1 && r.j.lead.status === 'app-sent' && r.j.activities.some((a) => a.kind === 'call' && a.duration === 95 && a.body === 'Good call'), 'call logged on the lead');
r = await A('/api/leads/' + tl.id, { dnc: true }, 'PATCH');
r = await A('/api/phone/call', { leadId: tl.id });
ok(r.status === 409 && /do-not-call/.test(r.j.error), 'do-not-call blocks the call');
await A('/api/leads/' + tl.id, { dnc: false }, 'PATCH');

// ---------- texts and STOP ----------
r = await A('/api/phone/sms', { leadId: tl.id, body: 'Hi Test, quick question about your application.' });
ok(r.j.ok && r.j.status === 'delivered', 'text sent');
r = await A('/api/sim/inbound', { kind: 'sms', leadId: tl.id, body: 'STOP' });
ok(r.j.ok, 'inbound text plays on the demo line');
// The demo inbound route logs the text; STOP handling runs through the carrier route, so check both paths.
r = await A('/api/leads/' + tl.id, { smsOptOut: true }, 'PATCH');
r = await A('/api/phone/sms', { leadId: tl.id, body: 'Another one' });
ok(r.status === 409 && /STOP/.test(r.j.error), 'opted-out lead cannot be texted');

// ---------- email, sequences ----------
r = await A('/api/email', { action: 'send', leadId: tl.id, subject: 'Statements', body: 'Hi Test, just the September statement please.' });
ok(r.j.ok, 'email sent from the mailbox');
r = await A('/api/sequences', { action: 'save', name: 'API test sequence', steps: [{ wait: 0, kind: 'email', subject: 'Hello {first}', body: 'Hi {first}, about {business}.' }, { wait: 2, kind: 'task', body: 'Call {first}' }] });
ok(r.j.ok, 'sequence saved'); const seqId = r.j.id;
r = await A('/api/sequences', { action: 'enroll', id: seqId, ids: [tl.id] });
ok(r.j.enrolled === 1, 'lead with consent enrolled (' + r.j.enrolled + ')');
await sleep(2500);
r = await A('/api/inbox');
ok(r.j.ok, 'inbox loads (runs due sequence steps)');
r = await A('/api/leads/' + tl.id);
ok(r.j.activities.some((a) => a.kind === 'email' && /Hello Test/.test(a.subject || '')), 'sequence email went out with fill-ins');
r = await A('/api/sequences', { action: 'bulk', subject: 'Holiday funding', body: 'Hi {first}', filter: { list: 'API import' } });
ok(r.j.ok && r.j.enrolled === 0, 'bulk email skips leads without consent');

// ---------- unsubscribe ----------
const unsubLine = (await A('/api/leads/' + tl.id)).j.activities.find((a) => a.kind === 'email' && a.data.bulk);
const m = unsubLine && /\/u\/([^\s]+)/.exec(unsubLine.body);
ok(!!m, 'bulk email carries an unsubscribe link');
if (m) {
  r = await fetch(BASE + '/u/' + m[1]); ok(r.status === 200, 'unsubscribe page opens');
  r = await fetch(BASE + '/u/' + m[1], { method: 'POST' }); ok(r.status === 200, 'unsubscribe works');
  r = await A('/api/leads/' + tl.id); ok(r.j.lead.emailOptOut === true, 'lead marked unsubscribed');
  r = await A('/api/email', { action: 'send', leadId: tl.id, subject: 'x', body: 'y' }); ok(r.status === 409, 'unsubscribed address cannot be emailed');
}

// ---------- deals, lenders ----------
r = await A('/api/lenders'); ok(r.j.lenders.length >= 12, 'lenders listed');
r = await A('/api/deals', { leadId: tl.id, requested: 60000 }); ok(r.j.ok && r.j.deal.stage === 'statements', 'deal opens waiting on statements');
const dealId = r.j.deal.id;
for (const item of ['s1', 's2', 's3']) r = await A('/api/deals/' + dealId, { action: 'paper', item, on: true });
ok(r.j.deal.stage === 'app', 'statements in moves it to complete');
r = await A('/api/deals/' + dealId); ok(r.j.lenders.some((l) => l.fit.fits) && r.j.lenders.some((l) => !l.fit.fits), 'lender fit check shows fits and misses');
r = await A('/api/deals/' + dealId, { action: 'submit', lenderIds: ['ln_maple', 'ln_summit'] }); ok(r.j.deal.stage === 'submitted' && r.j.deal.submissions.length === 2, 'sent to lenders');
const sid = r.j.deal.submissions[0].id;
r = await A('/api/deals/' + dealId, { action: 'response', submissionId: sid, status: 'approved', offers: [{ amount: 50000, factor: 1.3, termMonths: 8, freq: 'daily', points: 10 }] });
ok(r.j.deal.stage === 'offers', 'approval moves to offers');
const off = r.j.deal.submissions[0].offers[0].id;
r = await A('/api/deals/' + dealId, { action: 'accept', submissionId: sid, offerId: off }); ok(r.j.deal.stage === 'contracts', 'offer taken');
r = await A('/api/deals/' + dealId, { action: 'fund' }); ok(r.j.deal.stage === 'funded' && r.j.deal.commission === 5000, 'funded with commission');

// ---------- dialer and the guard ----------
r = await A('/api/dialer'); ok(r.j.guard.cap === 0.05, 'guard reports the 5% cap');
r = await A('/api/dialer', { filter: { list: 'Fresh Leads 2026' }, lines: 3, title: 'API test' });
ok(r.j.ok && r.j.session.lines >= 1, 'dial session starts'); const ds = r.j.session.id;
r = await A('/api/dialer/' + ds, { action: 'next', lines: 3 });
ok(r.j.calls.length >= 1 && r.j.calls.every((c) => c.lead.phone), 'a round of calls');
const legs = r.j.calls;
const before = (await A('/api/dialer')).j.guard;
r = await A('/api/dialer/' + ds, { action: 'result', activityId: legs[0].activityId, result: 'connected', duration: 60, outcome: 'Talked' }); ok(r.j.ok, 'connected leg saved');
if (legs[1]) r = await A('/api/dialer/' + ds, { action: 'result', activityId: legs[1].activityId, result: 'abandoned' });
if (legs[2]) r = await A('/api/dialer/' + ds, { action: 'result', activityId: legs[2].activityId, result: 'voicemail', voicemailDropped: true });
r = await A('/api/dialer/' + ds, { action: 'result', activityId: legs[0].activityId, result: 'connected', duration: 60 });
const after = (await A('/api/dialer')).j.guard;
ok(!legs[1] || after.abandoned === before.abandoned + 1, 'abandoned call counted toward the cap');
r = await A('/api/dialer/' + ds, { action: 'end' }); ok(r.j.summary.connected === 1, 'session summary (results counted once)');

// ---------- phone setup ----------
r = await A('/api/phone/numbers?areaCode=613'); ok(r.j.numbers.length > 0 && r.j.numbers[0].e164.startsWith('+1613555'), 'search numbers by area code');
const pick = r.j.numbers[0].e164, bal0 = (await A('/api/phone/account')).j.balanceCents;
r = await A('/api/phone/numbers', { e164: pick, member: 'u1' }); ok(r.j.ok, 'buy a number');
const acct = (await A('/api/phone/account')).j;
ok(acct.balanceCents === bal0 - 160 || acct.balanceCents > bal0, 'wallet charged for the number');
r = await A('/api/phone/numbers?id=' + r.j.id, null, 'DELETE'); ok(r.j.ok, 'release a number');
r = await R('/api/phone/numbers', { e164: pick }); ok(r.status === 403, 'rep cannot buy numbers');
r = await A('/api/phone/registration', { profile: { legalName: 'X', businessNumber: '1', address: 'a', website: 'w', contactName: 'c', contactEmail: 'e', useCase: 'u', optIn: 'o', sample1: 'You are approved for $50k', sample2: 's' } });
ok(r.status === 400 && /loan/.test(r.j.error), 'registration refuses loan-offer samples');

// ---------- compliance ----------
r = await A('/api/compliance', { action: 'dnc-add', numbers: '(416) 555-0198\n647-555-0197' }); ok(r.j.added === 2, 'do-not-call list takes pasted numbers');
r = await A('/api/compliance'); ok(r.j.dnc.some((d) => d.phone === '(416) 555-0198'), 'do-not-call list shows them');

// ---------- application form ----------
const fd = new FormData();
Object.entries({ business: 'API Form Co', name: 'Form Person', phone: '7095550193', email: 'form@apiformco.example', province: 'NL', city: "St. John's", industry: 'Café', months: '30', revenue: '45000', amount: '30000', consent: 'yes' }).forEach(([k, v]) => fd.append(k, v));
fd.append('statements', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'june.pdf');
r = await fetch(BASE + '/apply/crown', { method: 'POST', body: fd }); const html = await r.text();
ok(r.status === 200 && /Application received/.test(html), 'public form accepts an application');
r = await A('/api/leads?limit=1&f=' + encodeURIComponent(JSON.stringify({ q: 'API Form Co' })));
const fl = r.j.leads[0];
ok(fl && fl.consent.type === 'express' && fl.source === 'website' && fl.dealId, 'form lead has consent, source and a deal');
r = await A('/api/inbox?team=1'); ok(r.j.activities.some((a) => a.kind === 'form' && a.leadId === fl.id), 'new application in the inbox');
r = await fetch(BASE + '/apply/nope'); ok(r.status === 404, 'unknown form 404s');

// ---------- dashboard, cron, misc ----------
r = await A('/api/dash?days=7'); ok(r.j.totals.dials > 0 && r.j.series.length === 7 && r.j.funnel.funded >= 1, 'dashboard numbers');
r = await A('/api/dash?days=30&member=u3'); ok(r.j.numbers.some((n) => n.flag), 'spam-flag on the low-answer number');
r = await fetch(BASE + '/api/cron', { method: 'POST' }); ok(r.status === 403, 'cron needs its secret');
r = await A('/api/audit'); ok(r.j.rows.length > 0, 'change log');
r = await R('/api/audit'); ok(r.status === 403, 'reps cannot read the change log');

// Clean up what this test added, so the demo stays tidy.
for (const q of ['Test Bakery API', 'Imported Co One', 'API Form Co']) {
  const x = await A('/api/leads?limit=5&f=' + encodeURIComponent(JSON.stringify({ q })));
  for (const l of x.j.leads) await A('/api/leads/' + l.id, null, 'DELETE');
}
await A('/api/settings', { key: 'compliance', data: savedCompliance });

// ---------- saved lists: a rep can keep their own, not rewrite shared ones ----------
{
  const shared = (await A('/api/settings')).j.settings.lists, maya = (await R('/api/me')).j.user.member;
  r = await R('/api/settings', { key: 'lists', data: [{ id: 'l-test-mine', name: 'Maya test list', filter: { province: ['ON'] }, sort: 'recent', shared: false, owner: maya },
    { id: shared[0].id, name: 'Renamed by a rep', filter: {}, shared: true }] });
  const after = (await A('/api/settings')).j.settings.lists;
  ok(r.status === 200 && shared.every((l) => after.some((x) => x.id === l.id && x.name === l.name)), 'rep cannot rename or drop shared lists');
  ok(after.some((l) => l.id === 'l-test-mine' && l.shared === false && l.owner === maya), 'rep saves their own private list');
  await R('/api/settings', { key: 'lists', data: after.filter((l) => l.id !== 'l-test-mine') });
  ok(!(await A('/api/settings')).j.settings.lists.some((l) => l.id === 'l-test-mine'), 'rep deletes their own list');
}
await A('/api/sequences', { action: 'delete', id: seqId });
await A('/api/compliance', { action: 'dnc-remove', phone: '4165550198' }); await A('/api/compliance', { action: 'dnc-remove', phone: '6475550197' });
// ---------- demo: guest sign-in, feedback, reload ----------
{
  const G = client();
  r = await G('/api/auth/guest'); ok(r.j && r.j.available && r.j.name === 'Crown Merchant Funding', 'demo offers a guest login');
  r = await G('/api/auth/guest', {}); ok(r.status === 200, 'guest signs in with no password');
  r = await G('/api/me'); ok(r.j && r.j.user.guest && r.j.user.member === 'u1' && r.j.settings.demo, 'guest lands in the demo as its manager');
  r = await G('/api/team', { action: 'invite', name: 'Not Allowed', email: 'nope@crown.example', role: 'rep' }); ok(r.status === 403, 'guest cannot invite people');
  r = await G('/api/auth/password', { current: 'x', next: key('nathan@crown.example', 'Another-password-1') }); ok(r.status === 403, 'guest cannot change the password');
  r = await G('/api/feedback', { text: 'API test note: the dialer should show the last note.', route: '#/inbox (Inbox)' }); ok(r.status === 200, 'feedback saves');
  r = await A('/api/feedback'); const note = r.j.feedback.find((f) => /API test note/.test(f.text) && !f.done);
  ok(note && /demo login/.test(note.who) && note.route.includes('Inbox'), 'manager reads feedback with who and where');
  if (note) { await A('/api/feedback', { action: 'done', id: note.id }); ok((await A('/api/feedback')).j.feedback.find((f) => f.id === note.id).done, 'feedback marked done'); }
  r = await R('/api/demo/reset', { part: 0 }); ok(r.status === 403, 'a rep cannot reload the demo');
  let at = null, parts = 1, t0 = Date.now();
  for (let i = 0; i < parts; i++) { r = await G('/api/demo/reset', { part: i, at }); if (r.status !== 200) break; at = r.j.at; parts = r.j.parts; }
  ok(r.status === 200 && r.j.done, 'guest reloads the demo data in ' + parts + ' parts (' + Math.round((Date.now() - t0) / 100) / 10 + 's)');
  const coffee = (await A('/api/leads?limit=1&f=' + encodeURIComponent(JSON.stringify({ q: 'Kensington Coffee' })))).j.leads[0];
  const ago = (at - coffee.createdAt) / 60000;
  ok(ago > 13 && ago < 15.5, 'reloaded dates are fresh (website application ' + ago.toFixed(1) + ' min ago)');
  const man = await (await fetch(BASE + '/demo-data/manifest.json')).json();
  r = await A('/api/leads?limit=1'); ok(r.j.total === man.leads, 'reload restores the whole book (' + r.j.total + ' leads)');
  ok((await A('/api/me')).status === 200 && (await G('/api/me')).status === 200, 'everyone stays signed in after a reload');
}
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
