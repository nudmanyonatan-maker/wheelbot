// Excel Capital pitch: a lender's day, then an application, then funding with repayments built in.
// Every click lands on the word that names it, zooms only on small things, and the camera is back
// at full screen before the cursor travels or the view changes.
module.exports = async ({ page, step, sleep, at, clickAt, pointAt, camAt, spot, unspot, spotAt, cam, moveTo, smoothScroll }) => {
  const $ = (sel, opt) => page.locator(sel, opt).first();
  // Scrolls the deal drawer so `sel` sits near the top of its body, out of the way of toasts.
  const drawerTo = (sel, gap) => page.evaluate(([s, g]) => { const b = document.querySelector('.d-body'), e = document.querySelector(s); if (b && e) b.scrollBy({ top: (e.getBoundingClientRect().top - b.getBoundingClientRect().top) / (parseFloat(document.body.style.zoom) || 1) - g, behavior: 'smooth' }); }, [sel, gap]);
  const topOf = (sel) => page.evaluate((s) => Math.max(0, document.querySelector(s).getBoundingClientRect().top + scrollY - 84), sel);

  // ---------- Your day ----------
  await step('a1', async () => {
    await spotAt('top', $('#t-miss'));
    await pointAt('reason', $('#t-miss .row .sub'), { lead: -0.2 });
    await pointAt('reason', $('#t-miss .btn[data-tab="repay"]'), { lead: 0.5 });
  });
  await step('a2', async () => {
    await unspot();
    await clickAt('See', $('#t-miss .btn[data-tab="repay"]'));
    await page.waitForSelector('.drawer .pay-row');
    await at('get', 0);
    await drawerTo('.drawer [data-spec-id="repayments"]', 24);
    await sleep(450);
    await spotAt('collection', $('.drawer .repay-top'));
    await spotAt('failed', $('.drawer .pay-row.bad'), { pad: 6, r: 8 });
  });
  await step('a3', async () => {
    await at('Below', 0);
    await unspot(); cam(1.0);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.drawer', { state: 'detached' }).catch(() => {});
    await spotAt('follow', $('#t-fu'));
    await at('applications', -0.9);
    await unspot();
    await smoothScroll(await topOf('#t-new'), 700);
    await spotAt('applications', $('#t-new'));
    await pointAt('website', $('#t-new .row', { hasText: 'Applied on your website' }).locator('.sub'), { lead: -0.1 });
    await pointAt('brokers', $('#t-new .row', { hasText: 'From ' }).locator('.sub'), { lead: -0.1 });
    await at('renewals', -0.9);
    await unspot();
    await smoothScroll(await topOf('#t-renew'), 700);
    await spotAt('renewals', $('#t-renew'));
    await pointAt('ready', $('#nav [data-v="deals"]'), { lead: 0.35, reveal: false });
  });

  // ---------- Applications ----------
  await step('b1', async () => {
    await unspot();
    await clickAt('Deals', $('#nav [data-v="deals"]'), { reveal: false });
    await page.waitForSelector('.col .col-head');
    await spotAt('left', $('.col .col-head'));
    await spotAt('funded', $('.col[data-stage="funded"] .col-head'));
    await pointAt('funded', $('.page-head [data-act="new-deal"]'), { lead: 0.6 });
  });
  await step('b2', async () => {
    await unspot();
    await clickAt('sends', $('.page-head [data-act="new-deal"]'));
    await page.waitForSelector('.modal [name=business]');
    await page.evaluate(() => { const s = document.querySelector('.modal [name=shopId]'); s.value = 's01'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await pointAt('type', $('.modal [name=business]'), { lead: -0.1 });
    await page.locator('.modal [name=business]').pressSequentially('Bella Vista', { delay: 32 });
    await page.waitForSelector('#nd-match b');
    await camAt('another', $('#nd-match'), 1.2);
    await spotAt('another', $('#nd-match'));
    await at('you', 0.25);
    await unspot(); cam(1.0);
    await page.keyboard.press('Escape');
    await pointAt('you', $('.card[data-id="d17"] .biz'), { lead: 0.3 });
  });

  // ---------- Repayments ----------
  await step('c1', async () => {
    await clickAt('Before', $('.card[data-id="d17"] .biz'), { lead: 0.05 });
    await page.waitForSelector('.drawer [data-act="bank-link"]');
    await drawerTo('.drawer [data-spec-id="closing-checklist"]', 24);
    await sleep(450);
    await spotAt('click', $('.drawer [data-spec-id="bank-link"]'), { pad: 6, r: 8 });
    await clickAt('Send', $('.drawer [data-act="bank-link"]'));
    await camAt('approves', $('.drawer [data-spec-id="bank-link"]'), 1.3, { dx: -320 });
    await spotAt('approves', $('.drawer [data-spec-id="bank-link"]'), { pad: 6, r: 8 });
  });
  await step('c2', async () => {
    await at('When', 0.2);
    await page.evaluate(() => window.EXCEL.approveBank('d17', 'NatWest'));
    await page.waitForSelector('.drawer .chk.ok[data-v="repay"]');
    await spot($('.drawer .chk.ok[data-v="repay"]'), { pad: 6, r: 8 });
    await at('Click', -0.45);
    await unspot(); cam(1.0);
    await clickAt('Mark', $('.drawer .next [data-act="move"][data-v="funded"]'));
    await page.waitForSelector('.drawer .tabs [data-v="repay"]');
    await pointAt('funded', $('.drawer .tabs [data-v="repay"]'), { lead: 0.5 });
  });
  await step('c3', async () => {
    await page.evaluate(() => { const r = document.getElementById('toast-root'); if (r) r.innerHTML = ''; });
    await clickAt('Repayments', $('.drawer .tabs [data-v="repay"]'), { lead: 0.05 });
    await page.waitForSelector('.drawer .repay-top');
    await spotAt('start', $('.drawer .next'));
    await spotAt('every', $('.drawer [data-spec-id="repayments"]'));
    await at('deal', 0.1);
    await unspot();
    await pointAt('deal', $('#nav [data-v="today"]'), { lead: 0.45, reveal: false });
  });
  await step('c4', async () => {
    await at('Once', 0);
    await page.keyboard.press('Escape');
    await clickAt('business', $('#nav [data-v="today"]'), { reveal: false });
    await page.waitForSelector('#t-renew');
    await smoothScroll(await topOf('#t-renew'), 600);
    await spotAt('ready', $('#t-renew'));
    await pointAt('renew', $('#t-renew [data-act="renew"]'), { lead: -0.1 });
  });
};
