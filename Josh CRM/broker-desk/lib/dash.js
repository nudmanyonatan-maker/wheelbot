// Dashboards: activity per rep, the funnel from lead to funded, lenders, lead lists, phone numbers
// (to catch one going to spam), renewals coming due, and the dialer's abandoned-call rate.
import { SH, all, one, isManager, parse } from './server.js';
import { abandonState } from './compliance.js';
import { payback } from './deals.js';
import { rowToDeal } from './deals.js';

const TALKED = 30; // a call of 30 seconds or more counts as a conversation
export async function dashboard(env, me, { days = 7, member = '' } = {}) {
  days = [1, 7, 30, 90].includes(+days) ? +days : 7;
  const now = Date.now(), day0 = me.day0 || Date.now() - Date.now() % SH.DAY;
  const since = days === 1 ? day0 : day0 - (days - 1) * SH.DAY, prevSince = since - days * SH.DAY;
  const who = !isManager(me) ? me.member : member === 'me' ? me.member : member || '';
  const wa = " AND (?3 = '' OR member = ?3)", wd = " AND (?3 = '' OR owner = ?3)";
  const P = (extra = []) => [me.ws, since, who || '', ...extra];
  const [reps, daily, funnelL, funnelD, lenders, lists, nums, prev, deals] = await env.DB.batch([
    env.DB.prepare(`SELECT member,
        SUM(kind = 'call' AND dir = 'out') AS dials, SUM(kind = 'call' AND dir = 'out' AND duration >= ${TALKED}) AS talks,
        SUM(CASE WHEN kind = 'call' THEN COALESCE(duration, 0) ELSE 0 END) AS talk, SUM(kind = 'call' AND dir = 'in') AS inbound,
        SUM(kind = 'sms' AND dir = 'out') AS texts, SUM(kind = 'email' AND dir = 'out') AS emails, SUM(kind = 'call' AND status = 'voicemail') AS vms
      FROM activities WHERE ws = ?1 AND at >= ?2${wa} AND at <= ${now} GROUP BY member`).bind(...P()),
    env.DB.prepare(`SELECT CAST((at - ?2) / ${SH.DAY} AS INTEGER) AS d, SUM(kind = 'call' AND dir = 'out') AS dials, SUM(kind = 'call' AND dir = 'out' AND duration >= ${TALKED}) AS talks,
        SUM(kind = 'sms' AND dir = 'out') AS texts, SUM(kind = 'email' AND dir = 'out') AS emails
      FROM activities WHERE ws = ?1 AND at >= ?2${wa} AND at <= ${now} GROUP BY d ORDER BY d`).bind(...P()),
    env.DB.prepare(`SELECT COUNT(*) AS created, SUM(last_contact_at >= ?2) AS contacted FROM leads WHERE ws = ?1 AND deleted = 0 AND created_at >= ?2${wd}`).bind(...P()),
    env.DB.prepare(`SELECT COUNT(*) AS apps, SUM(stage NOT IN ('app', 'statements', 'dead')) AS submitted, SUM(stage IN ('offers', 'contracts', 'funded')) AS approved,
        SUM(stage = 'funded') AS funded, SUM(CASE WHEN stage = 'funded' THEN funded_amount ELSE 0 END) AS volume, SUM(CASE WHEN stage = 'funded' THEN commission ELSE 0 END) AS commission,
        SUM(CASE WHEN stage = 'funded' AND commission_paid_at IS NULL THEN commission ELSE 0 END) AS owed
      FROM deals WHERE ws = ?1 AND deleted = 0 AND created_at >= ?2${wd}`).bind(...P()),
    env.DB.prepare(`SELECT id, name, data FROM lenders WHERE ws = ?1 AND ?2 > 0 AND ?3 = ?3`).bind(...P()),
    env.DB.prepare(`SELECT list_tag AS list, COUNT(*) AS leads, SUM(last_contact_at IS NOT NULL) AS contacted, SUM(deal_id IS NOT NULL) AS apps, SUM(status = 'funded') AS funded
      FROM leads WHERE ws = ?1 AND deleted = 0 AND list_tag IS NOT NULL${wd} AND ?2 > 0 GROUP BY list_tag ORDER BY MAX(created_at) DESC LIMIT 12`).bind(...P()),
    env.DB.prepare(`SELECT via, COUNT(*) AS calls, SUM(duration >= ${TALKED}) AS talks, SUM(status = 'completed') AS answered, AVG(CASE WHEN status = 'completed' THEN duration END) AS avg
      FROM activities WHERE ws = ?1 AND kind = 'call' AND dir = 'out' AND at >= ?2${wa} AND at <= ${now} GROUP BY via`).bind(...P()),
    env.DB.prepare(`SELECT SUM(kind = 'call' AND dir = 'out') AS dials, SUM(kind = 'call' AND dir = 'out' AND duration >= ${TALKED}) AS talks, SUM(kind = 'email' AND dir = 'out') AS emails, SUM(kind = 'sms' AND dir = 'out') AS texts
      FROM activities WHERE ws = ?1 AND at >= ?4 AND at < ?2${wa}`).bind(me.ws, since, who || '', prevSince),
    env.DB.prepare(`SELECT * FROM deals WHERE ws = ?1 AND deleted = 0 AND stage <> 'dead' AND ?2 > 0${wd}`).bind(...P())
  ]);
  // Lender approval rates come from every submission on file, not just this period's.
  const lenderStats = {};
  (lenders.results || []).forEach((l) => { lenderStats[l.id] = { id: l.id, name: l.name, sent: 0, approved: 0, declined: 0, pending: 0, funded: 0, volume: 0, hours: [] }; });
  const dealRows = (deals.results || []).map(rowToDeal);
  const allDeals = (await all(env, 'SELECT * FROM deals WHERE ws = ? AND deleted = 0' + (who ? ' AND owner = ?' : ''), me.ws, ...(who ? [who] : []))).map(rowToDeal);
  allDeals.forEach((d) => d.submissions.forEach((s) => {
    const L = lenderStats[s.lenderId]; if (!L) return;
    L.sent++; if (s.status === 'approved') L.approved++; else if (s.status === 'declined') L.declined++; else L.pending++;
    if (s.respondedAt) L.hours.push((s.respondedAt - s.sentAt) / 36e5);
    if (d.stage === 'funded' && d.lenderId === s.lenderId) { L.funded++; L.volume += d.fundedAmount || 0; }
  }));
  const lenderOut = Object.values(lenderStats).filter((l) => l.sent).map((l) => ({ ...l, rate: l.approved + l.declined ? l.approved / (l.approved + l.declined) : null,
    hours: l.hours.length ? l.hours.reduce((a, b) => a + b, 0) / l.hours.length : null })).sort((a, b) => b.sent - a.sent);
  const renewals = dealRows.filter((d) => d.stage === 'funded').map((d) => ({ d, p: payback(d) })).filter((x) => x.p && x.p.pct < 1)
    .map((x) => ({ id: x.d.id, leadId: x.d.leadId, business: x.d.business, amount: x.d.fundedAmount, pct: x.p.pct, halfAt: x.p.halfAt, ready: x.p.pct >= 0.5 }))
    .sort((a, b) => a.halfAt - b.halfAt).slice(0, 12);
  const team = await all(env, 'SELECT member, name FROM users WHERE ws = ?', me.ws), names = {}; team.forEach((t) => { names[t.member] = t.name; });
  const numbers = await all(env, 'SELECT e164, label, member FROM numbers WHERE ws = ? AND released_at IS NULL', me.ws);
  const numOut = (nums.results || []).filter((n) => n.via).map((n) => {
    const meta = numbers.find((x) => x.e164 === n.via) || {}, ans = n.calls ? n.answered / n.calls : 0;
    return { number: n.via, label: meta.label || '', member: meta.member || null, calls: n.calls, answered: n.answered, talks: n.talks, rate: ans, avg: n.avg ? Math.round(n.avg) : 0,
      flag: n.calls >= 40 && ans < 0.12 ? 'Low answer rate. This number may be marked as spam.' : null };
  });
  const sumReps = (k) => (reps.results || []).reduce((t, r) => t + (r[k] || 0), 0);
  const series = Array.from({ length: days }, (_, i) => ({ d: i, at: since + i * SH.DAY, dials: 0, talks: 0, texts: 0, emails: 0 }));
  (daily.results || []).forEach((r) => { if (series[r.d]) Object.assign(series[r.d], { dials: r.dials || 0, talks: r.talks || 0, texts: r.texts || 0, emails: r.emails || 0 }); });
  const fl = funnelL.results[0] || {}, fd = funnelD.results[0] || {}, pv = prev.results[0] || {};
  return {
    days, since, member: who, guard: await abandonState(env, me.ws),
    totals: { dials: sumReps('dials'), talks: sumReps('talks'), talk: sumReps('talk'), inbound: sumReps('inbound'), texts: sumReps('texts'), emails: sumReps('emails'), vms: sumReps('vms') },
    prev: { dials: pv.dials || 0, talks: pv.talks || 0, texts: pv.texts || 0, emails: pv.emails || 0 },
    reps: (reps.results || []).filter((r) => r.member).map((r) => ({ member: r.member, name: names[r.member] || 'Sequence', dials: r.dials || 0, talks: r.talks || 0, talk: r.talk || 0,
      texts: r.texts || 0, emails: r.emails || 0, vms: r.vms || 0, rate: r.dials ? (r.talks || 0) / r.dials : 0 })).sort((a, b) => b.dials - a.dials),
    series, funnel: { leads: fl.created || 0, contacted: fl.contacted || 0, apps: fd.apps || 0, submitted: fd.submitted || 0, approved: fd.approved || 0, funded: fd.funded || 0,
      volume: fd.volume || 0, commission: fd.commission || 0, owed: fd.owed || 0 },
    lenders: lenderOut, lists: lists.results || [], numbers: numOut, renewals
  };
}
export { parse, one };
