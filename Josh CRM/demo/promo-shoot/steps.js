// Steps for the ISO Desk promo. One step() per app line in script.json.
module.exports = async ({ page, step, sleep, point, tryPoint, click, type, quick, moveTo, smoothScroll, cam, camOn, camFollow }) => {
  // Headless Chrome stalls the next click after handing a tel: link to the system; there is no phone here anyway.
  await page.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (/^(tel|sms):/.test(this.getAttribute('href') || '')) return; return c.call(this); }; });

  await step('a1', async () => {
    cam(1.0);
    await sleep(500);
    await point(page.locator('#t-fu .row').nth(0), { reveal: false, dx: 420 });
    await sleep(350);
    await point(page.locator('#t-fu .row').nth(2), { reveal: false, dx: 420 });
    await sleep(300);
    await camOn(page.locator('#t-fu .row').nth(1), 1.3, { dx: 300 });
  });

  await step('b1', async () => {
    camFollow(1.45);
    await click(page.locator('header [data-act="fu-new"]'));
    await sleep(200);
    await page.locator('.pop [data-in="fu-who"]').pressSequentially('tidewater', { delay: 35 });
    await click(page.locator('.pop [data-act="fu-target"]').first());
    await click(page.locator('.pop .chip', { hasText: 'In 3 days' }));
    await page.locator('.pop [data-in="fu-note"]').pressSequentially('Chase the trucking files', { delay: 18 });
    await click(page.locator('.pop [data-act="fu-save"]'));
  });

  await step('b2', async () => {
    await page.evaluate(() => {
      const r = window.ISODESK.db().shops.s03, f = r.followUps.filter((x) => !x.doneAt)[0], n = new Date(Date.now() - 30000);
      f.due = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
      f.time = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
      window.ISODESK.checkAlerts();
    });
    await sleep(350);
    await camOn(page.locator('.alert').first(), 1.7, { dx: -120, dy: 60 });
    await point(page.locator('.alert .al-b').first(), { reveal: false });
  });

  await step('c1', async () => {
    camFollow(1.5);
    await click(page.locator('.alert [data-act="call"]').first());
    await sleep(300);
    await click(page.locator('[data-act="call-end"]'));
    await click(page.locator('.callbar .chip', { hasText: 'Talked to them' }));
    await page.locator('.callbar textarea').pressSequentially('Files coming Friday', { delay: 20 });
    await click(page.locator('.callbar .chip', { hasText: 'In 3 days' }));
    await click(page.locator('[data-act="call-save"]'));
  });

  await step('d1', async () => {
    cam(1.0);
    await page.evaluate(() => { for (let i = 0; i < 6; i++) { const b = document.querySelector('.alert [data-act="alert-x"]'); if (!b) break; b.click(); } });
    await click(page.locator('#nav [data-v="deals"]'));
    await sleep(400);
    const card = page.locator('.card[data-id="d04"]'), col = page.locator('.col[data-stage="underwriting"] .col-body');
    await point(card, { reveal: false });
    const cb = await col.boundingBox();
    await moveTo(cb.x + cb.width / 2, cb.y + 140);
    await card.dragTo(col);
    await sleep(400);
    await camOn(page.locator('.toast'), 1.6);
    await tryPoint(page.locator('.toast [data-act="toast-action"]'), { reveal: false });
  });

  await step('d2', async () => {
    await page.evaluate(() => { const r = document.getElementById('toast-root'); if (r) r.innerHTML = ''; });
    camFollow(1.4);
    await click(page.locator('[data-act="new-deal"]').first());
    await page.selectOption('.modal [name=shopId]', 's05');
    await point(page.locator('.modal [name=business]'), { reveal: false });
    await page.locator('.modal [name=business]').pressSequentially('Bella Napoli', { delay: 40 });
    await camOn(page.locator('#nd-match b'), 1.45);
    await tryPoint(page.locator('#nd-match b'), { reveal: false });
  });
};
