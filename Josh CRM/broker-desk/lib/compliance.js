// Canadian contact rules, in one place so every call, text and email goes through them.
// - CRTC: an internal do-not-call list, calling hours in the lead's time zone, and a cap of 5%
//   abandoned calls per calendar month for the multi-line dialer (answered with no rep on the line
//   within 2 seconds). The guard lowers the line count before the cap is reached.
// - CASL: bulk email and texts need express or implied consent, carry the sender's identity and an
//   unsubscribe link, and opt-outs are honoured at once (the law allows 10 business days).
import { SH, q, one, getSetting, hmac } from './server.js';

export const COMPLIANCE_DEFAULTS = {
  hours: SH.HOURS, recording: false, recordingNotice: 'This call may be recorded for quality and training.',
  voicemailDrop: true, voicemailMessage: 'Hi, this is {rep} from {company}. I was calling about funding for {business}. Call me back at {number}. Thanks.',
  abandonMessage: 'Sorry we missed you. This is {company}. Call us back at {number}.',
  maxLines: 5, abandonCap: 5, sender: { company: '', address: '', phone: '', email: '' }
};
export async function rules(env, ws) { const c = await getSetting(env, ws, 'compliance', {}); return { ...COMPLIANCE_DEFAULTS, ...c, sender: { ...COMPLIANCE_DEFAULTS.sender, ...(c.sender || {}) } }; }

export async function onDnc(env, ws, phone) {
  const k = SH.phoneKey(phone);
  return !!k && !!(await one(env, 'SELECT 1 AS x FROM dnc WHERE ws = ? AND phone_key = ?', ws, k));
}
export async function suppressed(env, ws, email) {
  const e = SH.emailLc(email);
  return !!e && !!(await one(env, 'SELECT 1 AS x FROM suppress WHERE ws = ? AND email_lc = ?', ws, e));
}
// Can this lead be phoned right now? Returns { ok, why }.
export async function callCheck(env, ws, lead, phone, r) {
  r = r || await rules(env, ws);
  if (!SH.phoneKey(phone)) return { ok: false, why: 'No phone number.' };
  if (lead && (lead.dnc || lead.status === 'dnc')) return { ok: false, why: 'This lead is on your do-not-call list.' };
  if (await onDnc(env, ws, phone)) return { ok: false, why: 'This number is on your do-not-call list.' };
  const w = SH.callingWindow({ province: lead && lead.province, phone }, r.hours);
  if (!w.ok) return { ok: false, why: 'It is ' + w.local + ' where they are. Calling hours are ' + (w.window ? w.window[0] + ' to ' + w.window[1] : 'closed') + ' their time.', hours: true };
  return { ok: true };
}
export async function textCheck(env, ws, lead, phone, { bulk = false } = {}) {
  if (!SH.phoneKey(phone)) return { ok: false, why: 'No phone number.' };
  if (lead && lead.smsOptOut) return { ok: false, why: 'They replied STOP. Texts to this number are off.' };
  if (lead && (lead.dnc || lead.status === 'dnc')) return { ok: false, why: 'This lead is on your do-not-call list.' };
  if (bulk && lead && !['express', 'implied'].includes(lead.consent && lead.consent.type)) return { ok: false, why: 'No CASL consent on file, so they can only get one-to-one texts.' };
  return { ok: true };
}
export async function emailCheck(env, ws, lead, email, { bulk = false } = {}) {
  if (!SH.emailLc(email)) return { ok: false, why: 'No email address.' };
  if (lead && lead.emailOptOut) return { ok: false, why: 'They unsubscribed from email.' };
  if (await suppressed(env, ws, email)) return { ok: false, why: 'This address is on your unsubscribe list.' };
  if (bulk && lead && !['express', 'implied'].includes(lead.consent && lead.consent.type)) return { ok: false, why: 'No CASL consent on file, so they can only get one-to-one email.' };
  return { ok: true };
}

// ---------- the 5% abandoned-call guard ----------
export function monthKey(at = Date.now()) { const d = new Date(at); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
export async function abandonState(env, ws, r) {
  r = r || await rules(env, ws);
  const m = await one(env, 'SELECT placed, answered, abandoned FROM dial_month WHERE ws = ? AND month = ?', ws, monthKey()) || { placed: 0, answered: 0, abandoned: 0 };
  const rate = m.placed ? m.abandoned / m.placed : 0, cap = (r.abandonCap || 5) / 100;
  // Room left: how many more abandons this month before reaching the cap, at the current volume.
  let maxLines = r.maxLines || 5;
  if (rate >= cap * 0.9) maxLines = 1; else if (rate >= cap * 0.75) maxLines = Math.min(maxLines, 2); else if (rate >= cap * 0.6) maxLines = Math.min(maxLines, 3);
  return { month: monthKey(), placed: m.placed, answered: m.answered, abandoned: m.abandoned, rate, cap, maxLines };
}
export function countStmt(env, ws, { placed = 0, answered = 0, abandoned = 0 }) {
  return q(env, `INSERT INTO dial_month (ws, month, placed, answered, abandoned) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(ws, month) DO UPDATE SET placed = placed + ?3, answered = answered + ?4, abandoned = abandoned + ?5`, ws, monthKey(), placed, answered, abandoned);
}

// ---------- CASL unsubscribe links ----------
export async function unsubToken(env, ws, email) {
  const e = SH.emailLc(email);
  return encodeURIComponent(ws) + '.' + btoa(e).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.' + (await hmac(env.SECRET_KEY || 'local-dev', 'unsub:' + ws + ':' + e)).slice(0, 22);
}
export async function readUnsubToken(env, token) {
  const [wsEnc, emB64, sig] = String(token || '').split('.');
  if (!wsEnc || !emB64 || !sig) return null;
  let email; try { email = atob(emB64.replace(/-/g, '+').replace(/_/g, '/')); } catch { return null; }
  const ws = decodeURIComponent(wsEnc);
  const want = (await hmac(env.SECRET_KEY || 'local-dev', 'unsub:' + ws + ':' + email)).slice(0, 22);
  return want === sig ? { ws, email } : null;
}
export function fill(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : m === '{first}' ? 'there' : '')); }
// The footer CASL needs on every commercial email: who sent it, how to reach them, how to stop.
export function caslFooter(r, unsubUrl) {
  const s = r.sender || {};
  return '\n\n--\n' + [s.company, s.address, [s.phone, s.email].filter(Boolean).join(' | ')].filter(Boolean).join('\n') + '\nTo stop getting these emails: ' + unsubUrl;
}
