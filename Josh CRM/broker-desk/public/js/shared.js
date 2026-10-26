/* Broker Desk: vocabulary and rules shared by the browser and the server (the server imports this
 * file for its side effect, so it only touches globalThis). Canadian by default: provinces, their
 * time zones for calling hours, CAD money. */
(function (root) {
  'use strict';
  var DAY = 864e5;

  // Lead statuses. A brokerage can rename, reorder and add its own in Settings.
  var STATUSES = [
    { id: 'new', label: 'New', tone: 'accent' },
    { id: 'to-call', label: 'Leads to call', tone: 'warn' },
    { id: 'contacted', label: 'Contacted', tone: '' },
    { id: 'app-sent', label: 'Application sent', tone: '' },
    { id: 'app-in', label: 'Application in', tone: 'good' },
    { id: 'submitted', label: 'With lenders', tone: 'good' },
    { id: 'funded', label: 'Funded', tone: 'good' },
    { id: 'not-interested', label: 'Not interested', tone: 'muted' },
    { id: 'bad-number', label: 'Bad number', tone: 'muted' },
    { id: 'dnc', label: 'Do not contact', tone: 'bad' }
  ];
  // Deal stages, in the order a file moves through them.
  var STAGES = [
    { id: 'app', label: 'Application in' },
    { id: 'statements', label: 'Waiting on statements' },
    { id: 'submitted', label: 'With lenders' },
    { id: 'offers', label: 'Offers in' },
    { id: 'contracts', label: 'Contracts out' },
    { id: 'funded', label: 'Funded' },
    { id: 'dead', label: 'Declined or lost' }
  ];
  var STAGE_INDEX = {}; STAGES.forEach(function (s, i) { STAGE_INDEX[s.id] = i; });

  // What a file needs before lenders will look at it, and before it can fund.
  var PAPERWORK = [
    { id: 'app', label: 'Signed application' },
    { id: 's1', label: 'Bank statement, last month', statement: 1 },
    { id: 's2', label: 'Bank statement, 2 months ago', statement: 2 },
    { id: 's3', label: 'Bank statement, 3 months ago', statement: 3 },
    { id: 's4', label: 'Bank statement, 4 months ago', statement: 4, optional: true },
    { id: 'id', label: "Owner's photo ID" },
    { id: 'void', label: 'Void cheque or PAD form' }
  ];
  var CLOSING = [
    { id: 'signed', label: 'Contract signed' },
    { id: 'bankverify', label: 'Bank login verified' },
    { id: 'call', label: 'Funding call done' }
  ];
  var DECLINE_REASONS = ['Revenue too low', 'Under 6 months trading', 'Too many positions', 'NSFs on statements', 'Restricted industry',
    'Credit too low', 'Revenue trending down', 'Recent default', 'Other'];
  var LOST_REASONS = ['Went with another broker', 'Stopped responding', 'No longer needs it', 'Offer too small', 'Price too high', 'Other'];

  var PROVINCES = [
    ['ON', 'Ontario', 'America/Toronto'], ['QC', 'Quebec', 'America/Toronto'], ['BC', 'British Columbia', 'America/Vancouver'],
    ['AB', 'Alberta', 'America/Edmonton'], ['MB', 'Manitoba', 'America/Winnipeg'], ['SK', 'Saskatchewan', 'America/Regina'],
    ['NS', 'Nova Scotia', 'America/Halifax'], ['NB', 'New Brunswick', 'America/Moncton'], ['NL', 'Newfoundland and Labrador', 'America/St_Johns'],
    ['PE', 'Prince Edward Island', 'America/Halifax'], ['YT', 'Yukon', 'America/Whitehorse'], ['NT', 'Northwest Territories', 'America/Yellowknife'],
    ['NU', 'Nunavut', 'America/Iqaluit']
  ].map(function (p) { return { id: p[0], name: p[1], tz: p[2] }; });
  var PROV = {}; PROVINCES.forEach(function (p) { PROV[p.id] = p; });
  // Canadian area codes to province, so calling hours work for leads with no province on file.
  var AREA = {
    ON: [226, 249, 289, 343, 365, 382, 416, 437, 519, 548, 613, 647, 683, 705, 742, 753, 807, 905, 942],
    QC: [263, 354, 367, 418, 438, 450, 468, 514, 579, 581, 819, 873],
    BC: [236, 250, 257, 604, 672, 778], AB: [368, 403, 587, 780, 825], MB: [204, 431, 584], SK: [306, 474, 639],
    NS: [782, 902], NB: [428, 506], NL: [709, 879]
  };
  var AREA_PROV = {}; Object.keys(AREA).forEach(function (p) { AREA[p].forEach(function (a) { AREA_PROV[a] = p; }); });

  var INDUSTRIES = ['Auto repair', 'Bakery', 'Bar or pub', 'Beauty salon', 'Café', 'Cleaning', 'Construction', 'Dental', 'E-commerce',
    'Electrical', 'Fitness', 'Grocery', 'Healthcare', 'Home care', 'Hotel', 'HVAC', 'Landscaping', 'Logistics', 'Manufacturing',
    'Plumbing', 'Printing', 'Real estate', 'Restaurant', 'Retail', 'Roofing', 'Staffing', 'Trucking', 'Wholesale', 'Other'];

  // ---------- helpers ----------
  function normName(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(ltd|ltee|inc|corp|corporation|co|the|limited|llc|enterprises)\b/g, ' ').replace(/\s+/g, '').trim();
  }
  function phoneKey(p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
  function e164(p) { var k = phoneKey(p); return k ? '+1' + k : ''; }
  function fmtPhone(p) { var k = phoneKey(p); return k ? '(' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6) : String(p || ''); }
  function emailLc(e) { var s = String(e || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : ''; }
  function money(n) { return '$' + Math.round(n || 0).toLocaleString('en-CA'); }
  function moneyK(n) { n = n || 0; return n >= 1e6 ? '$' + (Math.round(n / 1e5) / 10) + 'M' : n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n); }
  function cents(c) { var neg = c < 0; c = Math.abs(Math.round(c || 0)); return (neg ? '-' : '') + '$' + Math.floor(c / 100).toLocaleString('en-CA') + '.' + String(c % 100).padStart(2, '0'); }
  function provinceOf(lead) {
    if (lead && lead.province && PROV[lead.province]) return lead.province;
    var k = phoneKey(lead && (lead.phone || lead.phone_key));
    return k ? AREA_PROV[+k.slice(0, 3)] || null : null;
  }
  function tzOf(lead) { var p = provinceOf(lead); return p ? PROV[p].tz : 'America/Toronto'; }

  // Calling hours in the lead's own time zone. Defaults follow the CRTC's telemarketing hours:
  // 9 am to 9:30 pm on weekdays, 10 am to 6 pm on weekends.
  var HOURS = { weekday: ['09:00', '21:30'], weekend: ['10:00', '18:00'] };
  function localParts(tz, at) {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
    var o = {}; f.formatToParts(new Date(at)).forEach(function (p) { o[p.type] = p.value; });
    return { day: o.weekday, hm: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute };
  }
  function callingWindow(lead, rules, at) {
    rules = rules || HOURS; at = at || Date.now();
    var tz = tzOf(lead), lp = localParts(tz, at), weekend = lp.day === 'Sat' || lp.day === 'Sun', w = weekend ? rules.weekend : rules.weekday;
    return { ok: !!w && lp.hm >= w[0] && lp.hm < w[1], local: lp.hm, day: lp.day, tz: tz, window: w };
  }

  // Which lenders' rules a deal fits. Each miss is a plain reason, so the rep sees why.
  // Which lenders' rules a deal fits. Each miss is a plain reason, so the rep sees why. Facts not on
  // file yet (no credit score, say) are not counted against the file; they come back as "check".
  function lenderFit(lender, deal) {
    var r = (lender && lender.rules) || {}, m = (deal && deal.merchant) || {}, why = [], check = [];
    var has = function (v) { return v !== null && v !== undefined && v !== ''; };
    if (r.minRevenue) { if (!has(m.monthlyRevenue)) check.push('revenue'); else if (m.monthlyRevenue < r.minRevenue) why.push('needs ' + money(r.minRevenue) + '/mo revenue'); }
    if (r.minMonths) { if (!has(m.months)) check.push('time in business'); else if (m.months < r.minMonths) why.push('needs ' + r.minMonths + ' months trading'); }
    if (r.minScore) { if (!has(m.score)) check.push('credit score'); else if (m.score < r.minScore) why.push('needs a ' + r.minScore + '+ credit score'); }
    if (r.maxPositions != null && has(m.positions) && m.positions > r.maxPositions) why.push(r.maxPositions ? 'takes ' + r.maxPositions + ' positions at most' : 'first position only');
    if (r.maxAmount && (deal.requested || 0) > r.maxAmount) why.push('funds up to ' + money(r.maxAmount));
    if (r.restricted && m.industry && r.restricted.indexOf(m.industry) >= 0) why.push('no ' + m.industry.toLowerCase());
    if (r.provinces && r.provinces.length && m.province && r.provinces.indexOf(m.province) < 0) why.push('not in ' + m.province);
    return { fits: why.length === 0, why: why, check: check };
  }
  // Points on a funded deal: the broker's commission is points percent of the amount funded.
  function commission(amount, points) { return Math.round((amount || 0) * (points || 0) / 100); }

  var SHARED = {
    DAY: DAY, STATUSES: STATUSES, STAGES: STAGES, STAGE_INDEX: STAGE_INDEX, PAPERWORK: PAPERWORK, CLOSING: CLOSING,
    DECLINE_REASONS: DECLINE_REASONS, LOST_REASONS: LOST_REASONS, PROVINCES: PROVINCES, PROV: PROV, AREA_PROV: AREA_PROV,
    INDUSTRIES: INDUSTRIES, HOURS: HOURS, normName: normName, phoneKey: phoneKey, e164: e164, fmtPhone: fmtPhone, emailLc: emailLc,
    money: money, moneyK: moneyK, cents: cents, provinceOf: provinceOf, tzOf: tzOf, callingWindow: callingWindow, lenderFit: lenderFit,
    commission: commission
  };
  root.BD_SHARED = SHARED;
})(typeof window !== 'undefined' ? window : globalThis);
