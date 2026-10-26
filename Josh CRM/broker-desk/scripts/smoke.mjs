// Browser smoke test: signs in with the seeded manager, opens every screen, runs a call, a text,
// a short dial session and a deal change, and fails on any page error or console error.
//   BASE=http://localhost:8810 node scripts/smoke.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:8810';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE + '/');
await page.fill('.auth-form [name=email]', 'nathan@crown.example');
await page.fill('.auth-form [name=pw]', 'Walkthrough-2026');
await page.click('.auth-form button[type=submit]');
await page.waitForSelector('.page-inbox', { timeout: 15000 });
ok(await page.isVisible('#ix-calls'), 'inbox shows calls');
ok((await page.textContent('.side-nav')).includes('Inbox'), 'sidebar');
// Calls wait for the lead's calling hours, so open them for the run (restored at the end).
const savedCompliance = await page.evaluate(async () => {
  const me = await (await fetch('/api/me')).json(), c = me.settings.compliance;
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'compliance', data: { ...c, hours: { weekday: ['00:00', '23:59'], weekend: ['00:00', '23:59'] } } }) });
  await window.BD.reloadMe();
  return c;
});

const screens = [['#/leads?list=l-fresh', '.ltable .lrow:not(.lhead)'], ['#/leads?list=l-to-call', '.ltable'], ['#/deals', '.board .col'], ['#/deal/dl_physio', '[data-spec-id="deal-lenders"]'],
  ['#/lenders', '.lnrow'], ['#/sequences', '.seqcard'], ['#/dash', '.tiles'], ['#/settings/phone', '[data-spec-id="phone-wallet"]'], ['#/settings/email', '[data-spec-id="email-connect"]'],
  ['#/settings/team', '[data-spec-id="team"]'], ['#/settings/rules', '[data-spec-id="rules-dnc"]'], ['#/settings/statuses', '.stlist'], ['#/settings/templates', '.tpl-edit'], ['#/settings/form', '[data-spec-id="form-link"]'],
  ['#/settings/brand', '#b-n'], ['#/settings/import', '[data-spec-id="import"]'], ['#/settings/account', 'form[data-form="pw"]'], ['#/settings/log', '.log-list']];
for (const [h, sel] of screens) {
  await page.evaluate((x) => { location.hash = x; }, h);
  try { await page.waitForSelector(sel, { timeout: 8000 }); ok(true, h); } catch { ok(false, h + ' did not show ' + sel); }
}
// A lead: call, wrap-up, text.
const lead = await page.evaluate(async () => (await (await fetch('/api/leads?limit=1&f=' + encodeURIComponent(JSON.stringify({ q: 'Harbour Lane Bakery' })))).json()).leads[0].id);
await page.evaluate((x) => { location.hash = '#/lead/' + x; }, lead);
await page.waitForSelector('[data-spec-id="composer"]');
await page.click('[data-act="lead-call"]');
await page.waitForSelector('.callbar.live, .callbar.voicemail, .callbar.wrap', { timeout: 15000 });
if (await page.isVisible('[data-act="cb-hang"]')) await page.click('[data-act="cb-hang"]');
await page.waitForSelector('.callbar.wrap');
await page.fill('.callbar textarea', 'Smoke test call');
await page.click('[data-act="cb-save"]');
await wait(1500);
ok((await page.textContent('.tl')).includes('Smoke test call'), 'call note on the timeline');
await page.click('.comp [data-act="comp-tab"][data-v="sms"]');
await page.fill('.comp textarea', 'Smoke test text');
await page.click('[data-act="comp-send"]');
await wait(1500);
ok((await page.textContent('.tl')).includes('Smoke test text'), 'text on the timeline');
// A short dial session.
await page.evaluate(() => { location.hash = '#/leads?list=l-fresh'; });
await page.waitForSelector('[data-act="dialer-open"]');
await page.click('[data-act="dialer-open"]');
await page.waitForSelector('.lines-seg');
await page.click('[data-act="dl-lines-pick"][data-v="2"]');
await page.click('.modal button[type=submit]');
await page.waitForSelector('.legs .leg', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.dl-live') || document.querySelectorAll('.legs .leg').length && [...document.querySelectorAll('.legs .leg .lg-st')].every((x) => !/Ringing|Dialing/.test(x.textContent)), null, { timeout: 25000 });
if (await page.isVisible('[data-act="dl-hang"]')) { await page.click('[data-act="dl-hang"]'); await page.click('[data-act="dl-save"]'); }
await wait(500);
await page.click('[data-act="dl-end"]');
await page.waitForSelector('.sumgrid');
ok((await page.textContent('.sumgrid')).includes('Dialed'), 'dial session summary');
await page.click('.modal [data-act="modal-close"]');
// The public form renders.
const form = await (await page.request.get(BASE + '/apply/crown')).text();
ok(/Send my application/.test(form), 'public application form');
// The demo's one-click guest login, the demo bar and the feedback box.
const guest = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
guest.on('pageerror', (e) => errors.push('guest pageerror: ' + e.message));
await guest.goto(BASE + '/');
await guest.waitForSelector('[data-act="guest-in"]', { timeout: 8000 });
await guest.click('[data-act="guest-in"]');
await guest.waitForSelector('.page-inbox', { timeout: 15000 });
ok(await guest.isVisible('.demo-bar'), 'guest sees the demo bar');
await guest.click('[data-act="demo-feedback"]');
await guest.waitForSelector('.modal textarea[name=text]');
ok((await guest.textContent('.modal')).includes('Send feedback'), 'feedback box opens');
await guest.click('.modal [data-act="modal-close"]');
const g2 = await (await browser.newContext()).newPage();
await g2.goto(BASE + '/#demo');
await g2.waitForSelector('.page-inbox', { timeout: 15000 }).then(() => ok(true), () => ok(false, '/#demo signs straight in'));
await page.evaluate((c) => fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'compliance', data: c }) }), savedCompliance);
ok(!errors.length, 'no page errors' + (errors.length ? ':\n    ' + errors.join('\n    ') : ''));
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
