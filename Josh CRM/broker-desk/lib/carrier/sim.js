// The demo line: behaves like a carrier so every phone screen works before a real account exists.
// Numbers come from the 555-01xx range set aside for fiction. Calls are acted out in the browser
// (see public/js/phone.js); texts are "delivered" at once; the texting registration is approved a
// minute after it is sent in, so the review step can be seen.
const REVIEW_MS = 60 * 1000;

export const sim = {
  name: 'sim',
  async ensureAccount(env, ws) { return { subSid: 'SIM' + ws, secret: {} }; },
  async searchNumbers(env, acct, { areaCode, taken = [] }) {
    const ac = /^\d{3}$/.test(String(areaCode || '')) ? String(areaCode) : '416', out = [];
    for (let k = 3; k < 100 && out.length < 8; k += 7) {
      const e164 = '+1' + ac + '55501' + String(k).padStart(2, '0');
      if (taken.indexOf(e164) < 0) out.push({ e164, locality: LOCALITY[ac] || 'Canada', region: REGION[ac] || '' });
    }
    return out;
  },
  async buyNumber(env, acct, e164) { return { sid: 'PNSIM' + e164.replace(/\D/g, '') }; },
  async releaseNumber() { return true; },
  async voiceToken() { return { sim: true }; },
  async sendSms(env, acct, { from, to }) { return { sid: 'SMSIM' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), status: 'delivered', from, to }; },
  async placeCall() { throw new Error('The demo line places calls from the browser.'); },
  async updateCall() { return true; },
  async verify() { return true; },
  async submitRegistration(env, acct, profile) { return { status: 'review', submittedAt: Date.now(), ref: 'SIMREG' + Date.now().toString(36) }; },
  registrationStatus(reg) {
    if (!reg || !reg.submittedAt) return reg && reg.status || 'draft';
    if (reg.status === 'review' && Date.now() - reg.submittedAt > REVIEW_MS) return 'approved';
    return reg.status;
  }
};
const LOCALITY = { 416: 'Toronto', 647: 'Toronto', 437: 'Toronto', 905: 'Mississauga', 289: 'Hamilton', 613: 'Ottawa', 519: 'London', 705: 'Barrie',
  514: 'Montreal', 438: 'Montreal', 450: 'Laval', 418: 'Quebec City', 604: 'Vancouver', 778: 'Vancouver', 250: 'Victoria', 403: 'Calgary', 587: 'Calgary',
  780: 'Edmonton', 204: 'Winnipeg', 306: 'Regina', 902: 'Halifax', 506: 'Moncton', 709: "St. John's" };
const REGION = { 416: 'ON', 647: 'ON', 437: 'ON', 905: 'ON', 289: 'ON', 613: 'ON', 519: 'ON', 705: 'ON', 514: 'QC', 438: 'QC', 450: 'QC', 418: 'QC',
  604: 'BC', 778: 'BC', 250: 'BC', 403: 'AB', 587: 'AB', 780: 'AB', 204: 'MB', 306: 'SK', 902: 'NS', 506: 'NB', 709: 'NL' };
