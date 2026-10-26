// Off camera, before recording starts: sign up through the fresh invite, load the UK sample book,
// and open on Today. The recorder has no phone and no push service, so those are stubbed.
const stub = () => {
  // No background sync while filming: a re-render mid-take would move things under the spotlight.
  const si = window.setInterval;
  window.setInterval = function (fn, ms) { if (ms === 20000 || ms === 60000) return 0; return si.apply(window, arguments); };
  const c = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (/^(tel|sms):/.test(this.getAttribute('href') || '')) return; return c.call(this); };
  try { Notification.requestPermission = () => Promise.resolve('granted'); } catch (e) {}
};
const seed = require('./seed.js');
module.exports = async ({ page, ctx, BASE, sleep }) => {
  await ctx.addInitScript(stub);
  await page.evaluate(stub);
  const pw = 'Walkthrough-2026';
  await page.locator('.auth input[name=pw]').fill(pw);
  await page.locator('.auth input[name=pw2]').fill(pw);
  await page.locator('.auth button[type=submit]').click();
  await page.waitForFunction(() => window.ISODESK.session && window.ISODESK.session(), null, { timeout: 15000 });
  await seed(page);
  await page.goto(BASE + '/');
  await page.waitForSelector('#t-miss .row');
  await sleep(800);
};
