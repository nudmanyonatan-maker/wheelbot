// Josh's walkthrough: the whole job, start to finish, on his real private desk.
const VCF = require('./contacts');
const seedSettings = { setup: { hidden: true, phoneAck: true } };
async function search(h, text) {
  await h.click(h.page.locator('#q')); await h.type(text, 45); await h.wait(500);
  await h.page.keyboard.press('Enter'); await h.wait(900);
}
async function closeDrawer(h) { await h.click(h.page.locator('.drawer .x[data-act="close-drawer"]')); await h.wait(300); }
module.exports = {
  out: 'public/tour/iso-desk-walkthrough.mp4', poster: 'public/tour/poster.jpg', posterAt: 44,
  voice: 'en-US-AndrewMultilingualNeural', rate: '+4%',
  account: { name: 'Josh Abecassis', email: 'josh@example.com', phone: '(305) 280-5556', ws: 'Walkthrough desk' },
  async before(h) { await h.go('/'); await h.card('ISO Desk', 'Your shops, deals and follow-ups, start to finish.', 'A walkthrough for Josh'); },
  scenes: [
    { say: "Hey Josh. This is ISO Desk: your shops, your deals and your follow-ups, in one simple place. Here's everything, start to finish.", pad: 700 },
    { cap: 'Sign in with your email. Same login on your phone and computer.',
      say: "Open the link Yonatan sends you and pick a password. After that, sign in with your email on your phone and your computer, and everything stays in sync.",
      run: async (h) => {
        await h.card(null); await h.wait(700);
        await h.click(h.page.locator('input[name=email]')); await h.type(h.acct.email, 45);
        await h.click(h.page.locator('input[name=pw]')); await h.type(h.acct.pw, 35);
        await h.click(h.page.locator('.auth button[type=submit]'));
        await h.page.waitForFunction(() => window.ISODESK.session && window.ISODESK.session()); await h.wait(600); await h.decorate();
      } },
    { cap: 'The first time in, Today shows three setup steps.',
      say: "The first time in, Today shows three quick steps: bring in your contacts, turn on phone alerts, and how calls and texts work.",
      run: async (h) => { await h.point(h.page.locator('#t-setup')); } },
    { cap: 'Bring in your contacts from your phone, or your ISO list from SmartMCA.',
      say: "Export your contacts from your iPhone, or your ISO list from SmartMCA, and drop the file in. Each company becomes a shop, with its people. Untick anything personal. Shops that are already here get matched, never doubled.",
      run: async (h) => {
        await h.click(h.page.locator('#t-setup [data-act="import-open"]')); await h.wait(1200);
        await h.file('Contacts.vcf', VCF); await h.wait(1600);
        await h.point(h.page.locator('.imp-list')); await h.wait(2600);
        await h.click(h.page.locator('.modal button[type=submit]')); await h.wait(1200);
      } },
    { say: "Now let's jump ahead, to a desk with a few weeks of work in it.", pad: 300,
      run: async (h) => { await h.cap(null); await h.card('A few weeks in', 'Same desk, now with deals, follow-ups and history.'); await h.wait(900); await h.seed(seedSettings); await h.card('A few weeks in', 'Same desk, now with deals, follow-ups and history.'); await h.wait(700); await h.card(null); } },
    { cap: 'Every morning, work Today from top to bottom.',
      say: "Every morning, start on Today. Follow-ups that are due, deals waiting on a shop, and shops worth a call, in the order they need you.",
      run: async (h) => { await h.wait(2500); await h.page.mouse.wheel(0, 520); await h.wait(2200); await h.page.mouse.wheel(0, -520); } },
    { cap: 'Set a follow-up in a few taps: who, when, and what for.',
      say: "To set a follow-up, press Follow-up, pick the shop, pick when, and write what it's for. It can repeat every week, too.",
      run: async (h) => {
        await h.click(h.page.locator('header [data-act="fu-new"]')); await h.type('tidewater', 60);
        await h.page.keyboard.press('Enter'); await h.wait(700);
        await h.click(h.page.locator('.pop .chip', { hasText: 'In 3 days' }));
        await h.page.locator('.pop [data-in="fu-note"]').click(); await h.type('Ask for their trucking files', 45);
        await h.page.keyboard.press('Enter'); await h.wait(1200);
      } },
    { cap: 'When it is due, it pops up here, and on your phone.',
      say: "When a follow-up comes due, it pops up right here, and on your phone, even with ISO Desk closed. Call, text, mark it done, or push it to later.",
      run: async (h) => {
        await h.dueNow('s03'); await h.wait(500);
        const t = await h.page.evaluate(() => { const s = window.ISODESK.db().shops.s03, f = s.followUps.filter((x) => !x.doneAt)[0]; return [s.name, f.note || 'Follow up']; });
        await h.phone(t[0], t[1]); await h.wait(3600); await h.phone(null);
        await h.click(h.page.locator('.alert [data-act="fu-later"]'));
        await h.click(h.page.locator('.pop [data-act="later-pick"]', { hasText: 'Tomorrow 9 AM' })); await h.wait(600);
      } },
    { cap: 'Press Call and your phone dials. Then log it in one step.', capPos: 'top',
      say: "Press call, and your phone dials the number. When you hang up, tap Hung up, write what happened, and pick the next follow-up, all in the same box.",
      run: async (h) => {
        await search(h, 'Lakeside');
        await h.click(h.page.locator('.d-actions [data-act="call"]')); await h.wait(2600);
        await h.click(h.page.locator('[data-act="call-end"]'));
        await h.click(h.page.locator('.callbar .chip', { hasText: 'Talked to them' }));
        await h.page.locator('.callbar textarea').click(); await h.type('Two restaurant files coming Friday', 42);
        await h.click(h.page.locator('.callbar .chip', { hasText: 'Tomorrow 9 AM' }));
        await h.click(h.page.locator('[data-act="call-save"]')); await h.wait(900);
      } },
    { cap: 'Texts fill in from your templates.', capPos: 'top',
      say: "To text, pick a template. The name, the merchant, and any missing paperwork fill in for you. It opens your phone's messages, ready to send, and keeps a copy here.",
      run: async (h) => {
        await closeDrawer(h); await search(h, 'Atlas');
        await h.click(h.page.locator('.next [data-act="tpl-ask"]')); await h.wait(2600);
        await h.click(h.page.locator('.sheet [data-act="send"]')); await h.wait(1800);
        await h.click(h.page.locator('.sheet [data-act="sheet-close"]'));
      } },
    { cap: 'Every shop: people, deals, notes and history.',
      say: "Every shop has its people, a note on how they work, every deal they've sent, and everything you've said to them. This line shows how many deals they sent in the last ninety days, how many were approved, and how many funded.",
      run: async (h) => {
        await closeDrawer(h); await h.click(h.page.locator('#nav [data-v="shops"]')); await h.wait(1500);
        await h.click(h.page.locator('.row[data-id="s01"] .main b')); await h.wait(1600);
        await h.point(h.page.locator('.funnel')); await h.wait(2600);
        await h.page.locator('.d-body').evaluate((el) => el.scrollTo({ top: 300, behavior: 'smooth' })); await h.wait(1600);
      } },
    { cap: 'Log a deal. It tells you if another shop sent it first.',
      say: "When a shop sends you a deal, log it here. If another shop already sent that merchant, ISO Desk tells you who got there first, so there's no fight over who brought it in.",
      run: async (h) => {
        await closeDrawer(h); await h.click(h.page.locator('#nav [data-v="deals"]')); await h.wait(1000);
        await h.click(h.page.locator('[data-act="new-deal"]').first()); await h.wait(500);
        await h.page.selectOption('.modal [name=shopId]', 's05'); await h.wait(300);
        await h.click(h.page.locator('.modal [name=business]')); await h.type('Bella Napoli Trattoria', 55); await h.wait(3200);
        await h.click(h.page.locator('.modal .x[data-act="modal-close"]'));
      } },
    { cap: 'Drag a deal to move it. It stops you if something is missing.',
      say: "Deals move left to right, from new submission to funded. Drag a card to move it. If something's missing, like a bank statement or a signed contract, it stops you, and says what.",
      run: async (h) => {
        const card = h.page.locator('.card[data-id="d04"]'), col = h.page.locator('.col[data-stage="underwriting"] .col-body');
        await h.point(card); await h.wait(300);
        const cb = await col.boundingBox(); await h.page.evaluate(([x, y]) => window.__demo.move(x, y), [cb.x + cb.width / 2, cb.y + 80]);
        await card.dragTo(col); await h.wait(3000);
      } },
    { cap: 'Offers show the payment, and what the shop earns.',
      say: "When underwriting approves, record the offer. Slide the points to see the merchant's payment, the payback, and what the shop earns.",
      run: async (h) => {
        await h.click(h.page.locator('.card[data-id="d11"] .biz')); await h.wait(1200);
        const slider = h.page.locator('.offer input[type="range"]').first(); await h.point(slider);
        for (const v of [6, 7, 8, 9]) { await slider.evaluate((el, val) => { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); }, v); await h.wait(550); }
        await slider.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true }))); await h.wait(900);
      } },
    { cap: 'Declines keep the reason, and the shop hears why.',
      say: "If underwriting passes, pick the reason, and text it to the shop in one tap, so they know what to send next time.",
      run: async (h) => {
        await closeDrawer(h); await h.click(h.page.locator('.card[data-id="d09"] .biz')); await h.wait(900);
        await h.click(h.page.locator('.next [data-act="close-open"][data-v="declined"]')); await h.wait(500);
        await h.click(h.page.locator('.modal .reasons label', { hasText: 'Too many open positions' }));
        await h.click(h.page.locator('.modal button[type=submit]')); await h.wait(1800);
        await h.point(h.page.locator('.toast [data-act="toast-action"]')); await h.wait(1200);
      } },
    { cap: 'Funded deals tell you when they can renew.',
      say: "Once a deal funds, ISO Desk tracks the payback, tells you when the merchant can renew, and lets you mark the shop's commission as paid.",
      run: async (h) => {
        await closeDrawer(h); await search(h, 'Summit Ridge'); await h.wait(1500);
        await h.page.locator('.d-body').evaluate((el) => el.scrollTo({ top: 520, behavior: 'smooth' })); await h.wait(1800);
        await h.click(h.page.locator('[data-act="comm-paid"]')); await h.wait(900);
      } },
    { cap: 'On your iPhone: Share, then Add to Home Screen. Then turn on alerts.',
      say: "Last thing. On your iPhone, open ISO Desk in Safari, tap Share, then Add to Home Screen. Open it from there, and turn on alerts.",
      run: async (h) => {
        await closeDrawer(h); await h.click(h.page.locator('header .me')); await h.wait(500);
        await h.click(h.page.locator('.pop [data-act="phone-setup"]')); await h.wait(3800);
        await h.click(h.page.locator('.modal .x[data-act="modal-close"]'));
      } },
    { say: "That's it. If anything is missing or confusing, tap your name, then Send Yonatan feedback. Talk soon.", pad: 1500,
      run: async (h) => { await h.cap(null); await h.card("That's it", 'Questions or ideas? Tap your name, then Send Yonatan feedback.', 'ISO Desk'); } }
  ]
};
