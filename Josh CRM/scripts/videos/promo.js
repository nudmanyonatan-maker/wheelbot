// The short marketing cut. A made-up rep and made-up shops, nothing about Josh or MNR.
const VCF = require('./contacts');
module.exports = {
  out: 'public/tour/iso-desk-promo.mp4', poster: 'public/tour/promo-poster.jpg', posterAt: 6,
  voice: 'en-US-AvaMultilingualNeural', rate: '+6%',
  account: { name: 'Alex Rivera', email: 'alex@example.com', phone: '(212) 555-0142', ws: 'Promo desk' },
  async before(h) {
    await h.go('/'); await h.signIn(); await h.ready();
    await h.seed({ setup: { hidden: true, phoneAck: true } });
    await h.card('ISO Desk', 'The CRM for ISO managers.');
  },
  scenes: [
    { say: "If you manage broker shops at a funder, your day is follow-ups, calls, and chasing paperwork.", pad: 500 },
    { cap: 'Everything due, on one screen.',
      say: "ISO Desk puts it all on one screen: what's due, which deals need a push, and which shops have gone quiet.",
      run: async (h) => { await h.card(null); await h.wait(1600); await h.page.mouse.wheel(0, 480); await h.wait(1500); await h.page.mouse.wheel(0, -480); } },
    { cap: 'A follow-up in seconds. An alert on your phone.',
      say: "Set a follow-up in seconds, and get an alert on your phone when it's time.",
      run: async (h) => {
        await h.click(h.page.locator('header [data-act="fu-new"]')); await h.type('tidewater', 55); await h.page.keyboard.press('Enter'); await h.wait(500);
        await h.click(h.page.locator('.pop .chip', { hasText: 'Tomorrow 9 AM' })); await h.page.locator('.pop [data-in="fu-note"]').click();
        await h.type('Chase the trucking files', 40); await h.page.keyboard.press('Enter'); await h.wait(500);
        await h.phone('Tidewater Business Funding', 'Chase the trucking files'); await h.wait(2000); await h.phone(null);
      } },
    { cap: 'Call from your phone. Log it in one step.', capPos: 'top',
      say: "Call or text from your phone, and log the call, with the next follow-up, in one step.",
      run: async (h) => {
        await h.click(h.page.locator('#q')); await h.type('Lakeside', 45); await h.wait(400); await h.page.keyboard.press('Enter'); await h.wait(800);
        await h.click(h.page.locator('.d-actions [data-act="call"]')); await h.wait(1300);
        await h.click(h.page.locator('[data-act="call-end"]'));
        await h.click(h.page.locator('.callbar .chip', { hasText: 'Talked to them' }));
        await h.page.locator('.callbar textarea').click(); await h.type('Sending two files Friday', 35);
        await h.click(h.page.locator('.callbar .chip', { hasText: 'In 3 days' }));
        await h.click(h.page.locator('[data-act="call-save"]')); await h.wait(500);
        await h.click(h.page.locator('.drawer .x[data-act="close-drawer"]'));
      } },
    { cap: 'Every deal, from submission to funded.',
      say: "Follow every deal from submission to funded, with missing paperwork flagged before underwriting has to ask.",
      run: async (h) => {
        await h.click(h.page.locator('#nav [data-v="deals"]')); await h.wait(1200);
        const card = h.page.locator('.card[data-id="d04"]'), col = h.page.locator('.col[data-stage="underwriting"] .col-body');
        await h.point(card); await card.dragTo(col); await h.wait(2200);
      } },
    { cap: 'It knows which shop sent a merchant first.',
      say: "It catches duplicate shops, and tells you when another shop already sent you the same merchant.",
      run: async (h) => {
        await h.click(h.page.locator('[data-act="new-deal"]').first()); await h.wait(400);
        await h.page.selectOption('.modal [name=shopId]', 's05');
        await h.click(h.page.locator('.modal [name=business]')); await h.type('Bella Napoli Trattoria', 45); await h.wait(2200);
        await h.click(h.page.locator('.modal .x[data-act="modal-close"]'));
      } },
    { cap: 'Offers, points and renewals, worked out for you.',
      say: "Offers, points, and renewals, worked out for you.",
      run: async (h) => {
        await h.click(h.page.locator('.card[data-id="d11"] .biz')); await h.wait(900);
        const slider = h.page.locator('.offer input[type="range"]').first(); await h.point(slider);
        for (const v of [6, 8, 10]) { await slider.evaluate((el, val) => { el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); }, v); await h.wait(450); }
        await h.click(h.page.locator('.drawer .x[data-act="close-drawer"]'));
      } },
    { cap: 'Bring your contacts and your old CRM over in a minute.',
      say: "Bring your phone contacts, and your old CRM's export, over in about a minute.",
      run: async (h) => {
        await h.click(h.page.locator('header .me')); await h.click(h.page.locator('.pop [data-act="import-open"]')); await h.wait(600);
        await h.file('Contacts.vcf', VCF); await h.wait(2400);
        await h.click(h.page.locator('.modal .x[data-act="modal-close"]'));
      } },
    { say: "ISO Desk. Simple enough to use every day.", pad: 1800,
      run: async (h) => { await h.cap(null); await h.card('ISO Desk', 'Simple enough to use every day.', 'Shops, deals, follow-ups, calls and texts in one place'); } }
  ]
};
