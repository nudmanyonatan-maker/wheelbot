/* ISO Desk: vocabulary, deal math and the demo seed for a funder's ISO team.
 * The ISO team looks after broker shops (ISOs). Shops send deals. Each shop has one
 * ISO manager, and a deal's ISO manager follows its shop unless someone overrides it.
 * Every seed date is relative to today, so the demo never goes stale. Seed records
 * carry updatedAt 0, so any saved edit wins over them. All names are made up. */
(function () {
  'use strict';
  // The server functions load this file too (for normName), where there is no window.
  var root = typeof window !== 'undefined' ? window : globalThis;

  var DAY = 864e5;
  var NOW = Date.now();
  var TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);

  function ago(days, hours) { return new Date(NOW - days * DAY - (hours || 0) * 36e5).toISOString(); }
  function dateOnly(d) { var x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
  function dayOffset(n) { var d = new Date(TODAY); d.setDate(d.getDate() + n); return dateOnly(d); }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function round(n, step) { return Math.round(n / step) * step; }
  function bizDaysBetween(fromISO, to) {
    var a = new Date(fromISO); a.setHours(0, 0, 0, 0);
    var b = new Date(to || TODAY); b.setHours(0, 0, 0, 0);
    var n = 0;
    while (a < b) { a.setDate(a.getDate() + 1); var w = a.getDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  }

  // ---------- vocabulary ----------
  var STAGES = [
    { id: 'submitted', label: 'New submission' },
    { id: 'underwriting', label: 'In underwriting' },
    { id: 'approved', label: 'Approved' },
    { id: 'contracts', label: 'Contracts out' },
    { id: 'funded', label: 'Funded' },
    { id: 'closed', label: 'Declined or lost' }
  ];
  var STAGE_INDEX = {}; STAGES.forEach(function (s, i) { STAGE_INDEX[s.id] = i; });

  // Josh is the person this desk is built for. His teammates are made up for the demo.
  // A recording can swap in a made-up rep with window.ISODESK_PERSONA = { name, first, initials, phone }.
  var PERSONA = root.ISODESK_PERSONA || null;
  var TEAM = [
    { id: 'u1', name: PERSONA ? PERSONA.name : 'Josh Abecassis', first: PERSONA ? PERSONA.first : 'Josh', initials: PERSONA ? PERSONA.initials : 'JA' },
    { id: 'u2', name: 'Dana Ortiz', first: 'Dana', initials: 'DO' },
    { id: 'u3', name: 'Eli Brandt', first: 'Eli', initials: 'EB' }
  ];
  var ME = 'u1';
  var MY_PHONE = { number: PERSONA ? PERSONA.phone : '(305) 280-5556', provider: PERSONA ? 'your phone company' : 'Unicom Connect UC' };
  var REPEATS = [['', 'Does not repeat'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']];
  var DEFAULT_SETTINGS = {
    id: 'settings', updatedAt: 0,
    alerts: { offerDays: 2, paperDays: 2, quietDays: 30 },
    blocked: [],
    templates: [
      { id: 't1', name: 'Got the file', text: 'Hi {first}, got the file for {merchant}. Sending it to underwriting now.' },
      { id: 't2', name: 'Need paperwork', text: 'Hi {first}, still need the {missing} for {merchant} before underwriting can price it.' },
      { id: 't3', name: 'Offer is out', text: 'Hi {first}, {merchant} is approved. The offers are in your email. Let me know which one they pick.' },
      { id: 't4', name: 'Checking in', text: 'Hi {first}, checking in. Anything new for me this week?' },
      { id: 't5', name: 'Renewal', text: 'Hi {first}, {merchant} is past halfway paid in and can renew. Want me to run numbers?' },
      { id: 't6', name: 'Declined', text: 'Hi {first}, underwriting passed on {merchant}: {reason}. Send me the next one.' }
    ],
    // Automatic follow-ups: how often to check in, how many check-ins a day, rules turned off, and edited texts.
    auto: { topDays: 7, otherDays: 14, perDay: 25, off: [], texts: {} }
  };

  // What the desk writes for each kind of automatic follow-up, in the order they win when a shop
  // has more than one. Deal news comes first because it is about money moving now.
  var AUTO_RULES = [
    { id: 'declined', group: 'deal', label: 'A deal was declined', when: 'Within 3 days of the decline', text: 'Hi {first}, underwriting passed on {merchant}: {reason}. Send me the next one.' },
    { id: 'funded', group: 'deal', label: 'A deal funded', when: 'Within 3 days of funding', text: 'Hi {first}, {merchant} is funded: {amount}. Your commission is {commission}. Thank you, send me the next one.' },
    { id: 'paperwork', group: 'deal', label: 'A file is missing paperwork', when: 'Right away, then again every {paperDays} days', text: 'Hi {first}, still need the {missing} for {merchant} before underwriting can price it.' },
    { id: 'closing', group: 'deal', label: 'A deal is waiting on closing items', when: 'Every {paperDays} days until it funds', text: 'Hi {first}, {merchant} is almost there. Still need the {missing} before it can fund.' },
    { id: 'offer', group: 'deal', label: 'An offer has no answer', when: 'After {offerDays} days, then every {offerDays} days', text: 'Hi {first}, checking on {merchant}. The offers are still good. Which one are they taking?' },
    { id: 'renewal', group: 'deal', label: 'A merchant can renew', when: 'Once, when half is paid back', text: 'Hi {first}, {merchant} is past halfway paid in and can renew. Want me to run numbers?' },
    { id: 'welcome', group: 'shop', label: 'A new shop has not sent a deal', when: '2 days after they sign, then every 4 days', text: "Hi {first}, it's {me}. Glad we're working together. Send me your first file and I'll get you an answer the same day." },
    { id: 'slowing', group: 'shop', label: 'A shop is sending less than usual', when: 'When the gap is half again their usual one, then every 5 days', text: "Hi {first}, haven't seen a file from you since {last}. Anything I can help with? Send me what you have and I'll get you numbers fast." },
    { id: 'quiet', group: 'shop', label: 'A shop has gone quiet', when: 'Every 3 weeks. A call for your top shops, a text for the rest', text: "Hi {first}, it's {me}. It's been a while. Still doing MCA deals? Send me your next file and I'll get you an answer today." },
    { id: 'checkin', group: 'shop', label: 'Regular check-in', when: 'Every {topDays} days for top shops, {otherDays} for the rest, counted from the last call, text or deal', text: 'Hi {first}, checking in. Anything new for me this week?' },
    { id: 'declines', group: 'shop', label: 'Check-in when most of their deals get declined', when: 'Every 30 days instead of the regular check-in', text: "Hi {first}, the last few files were declined for {declines}. Send me ones that clear that and I'll push them through." }
  ];

  var INDUSTRIES = ['Auto repair', 'Bar or nightclub', 'Cannabis', 'Cleaning services', 'Construction', 'Daycare', 'Dental', 'E-commerce',
    'Electrical contractor', 'Gym or fitness', 'Home health', 'Hotel', 'HVAC', 'Landscaping', 'Liquor store', 'Medical practice',
    'Moving and storage', 'Pet services', 'Plumbing', 'Printing', 'Restaurant', 'Retail', 'Salon or spa', 'Staffing', 'Transportation',
    'Trucking', 'Used car dealer', 'Veterinary', 'Wholesale'];
  var STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI',
    'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY'];
  // States with a commercial financing disclosure law: the funder owes the merchant a cost disclosure before signing.
  var DISCLOSURE_STATES = ['CA', 'CT', 'FL', 'GA', 'KS', 'MO', 'NY', 'UT', 'VA'];

  var DECLINE_REASONS = ['Revenue too low', 'Not enough time in business', 'Credit score too low', 'Too many open positions',
    'Too many NSFs or negative days', 'Restricted industry', 'Revenue trending down', 'Recent default on another advance', 'Other'];
  var LOST_REASONS = ['Went with another funder', 'Merchant stopped responding', 'Merchant no longer needs it', 'Offer too small',
    'Price too high', 'Shop stopped responding', 'Other'];
  var OVERRIDE_REASONS = ['Worked this deal directly with the shop', "Covering for the shop's ISO manager", 'Shop is assigned to the wrong person', 'Other'];
  var CONTACT_ROLES = ['Owner', 'Sales rep', 'Processor'];
  var CALL_OUTCOMES = ['Talked to them', 'Left voicemail', 'No answer'];

  var CLOSING_ITEMS = [ // what has to be in before a deal can fund
    { id: 'signed', label: 'Contract signed' },
    { id: 'disclosure', label: 'Cost disclosure delivered', disclosureOnly: true },
    { id: 'voided', label: 'Voided check' },
    { id: 'license', label: "Driver's license" },
    { id: 'ownership', label: 'Proof of ownership' },
    { id: 'bankverify', label: 'Bank login verified' },
    { id: 'call', label: 'Funding call done' }
  ];

  // The three full months of bank statements before a deal was submitted (or before today).
  function statementMonths(ref) {
    var base = ref ? new Date(ref) : TODAY, out = [];
    if (isNaN(base.getTime())) base = TODAY;
    for (var i = 3; i >= 1; i--) { var d = new Date(base.getFullYear(), base.getMonth() - i, 1); out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
    return out;
  }
  function monthLabel(key, long) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-US', { month: long ? 'long' : 'short' }); }

  // ---------- deal math ----------
  // Points: what the shop adds on top of our buy rate. 1 point = +0.01 on the factor
  // rate the merchant pays, and 1% of the advance paid to the shop as commission.
  function paymentCount(o) { return o.freq === 'weekly' ? Math.round(o.termMonths * 52 / 12) : Math.round(o.termMonths * 21); }
  function sellRate(o) { return Math.round((o.buyRate + (o.points || 0) / 100) * 1000) / 1000; }
  function payback(o) { return o.amount * sellRate(o); }
  function paymentAmount(o) { return payback(o) / paymentCount(o); }
  function commission(o) { return o.amount * (o.points || 0) / 100; }
  function netFunded(o) { return o.amount * (1 - (o.fee || 0) / 100); }
  // Estimated APR the way the disclosure laws ask for it: the yearly rate that discounts
  // the payments back to what the merchant actually receives.
  function estAPR(o) {
    var n = paymentCount(o), P = paymentAmount(o), PV = netFunded(o);
    if (!(n > 0) || !(P > 0) || !(PV > 0)) return null;
    var lo = 0, hi = 0.2;
    for (var i = 0; i < 80; i++) {
      var r = (lo + hi) / 2;
      var pv = P * (1 - Math.pow(1 + r, -n)) / r;
      if (pv > PV) lo = r; else hi = r;
    }
    return ((lo + hi) / 2) * (o.freq === 'weekly' ? 52 : 252);
  }
  function fundedProgress(f) {
    var total = paymentCount(f);
    var end = f.stoppedAt ? new Date(f.stoppedAt) : TODAY;
    var elapsed = f.freq === 'weekly' ? Math.floor((end - new Date(f.fundedAt)) / (7 * DAY)) : bizDaysBetween(f.fundedAt, end);
    var made = Math.max(0, Math.min(total, elapsed));
    var pb = payback(f);
    var toHalf = Math.max(0, Math.ceil(total / 2) - made);
    return { total: total, made: made, paidPct: made / total, balance: pb - made * pb / total,
      daysToHalf: f.freq === 'weekly' ? toHalf * 7 : Math.ceil(toHalf * 7 / 5) };
  }
  // What underwriting would likely offer, used to prefill "record an offer".
  function suggestOffer(deal, r) {
    var m = deal.merchant, credit = Math.max(0, Math.min(1, (m.fico - 500) / 280));
    var amount = Math.max(5000, Math.min(deal.requested, round(m.monthlyRevenue * (0.7 + credit * 0.6) * (1 - 0.12 * m.positions), 2500)));
    var buy = Math.round((1.42 - credit * 0.2 + ((r ? r() : 0.5) - 0.5) * 0.03) * 100) / 100;
    return { amount: amount, buyRate: buy, termMonths: Math.round(5 + credit * 7), freq: m.monthlyRevenue > 150000 ? 'weekly' : 'daily', fee: 2.5, maxPoints: 10, points: 8 };
  }
  function money0(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function moneyK(n) { return n >= 1e6 ? '$' + (Math.round(n / 1e5) / 10) + 'M' : '$' + Math.round(n / 1000) + 'k'; }
  // Two shop names are the same shop once case, punctuation and company suffixes are ignored.
  function normName(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(llc|inc|corp|corporation|co|ltd|the|group|company)\b/g, ' ').replace(/\s+/g, '').trim();
  }

  // ---------- shops ----------
  // [id, name, state, ISO manager, assignedDaysAgo, createdDaysAgo, size 0-3, flag]
  var SHOP_ROWS = [
    ['s01', 'Bridgeway Funding Partners', 'FL', 'u1', 45, 400, 3, 'reassigned'],
    ['s02', 'Northshore Capital Advisors', 'NY', 'u1', 300, 300, 3],
    ['s03', 'Lakeside Business Capital', 'IL', 'u1', 280, 280, 2],
    ['s04', 'Ridgeline Merchant Group', 'TX', 'u1', 250, 250, 2],
    ['s05', 'Harborview Advance', 'NJ', 'u1', 240, 240, 2],
    ['s06', 'Silverpine Funding', 'CA', 'u1', 200, 200, 1],
    ['s07', 'Copperstone Capital', 'AZ', 'u1', 190, 190, 2],
    ['s08', 'Tidewater Business Funding', 'VA', 'u1', 170, 170, 1],
    ['s09', 'Granite Path Capital', 'CO', 'u1', 150, 150, 1],
    ['s10', 'Bluefin Merchant Services', 'FL', 'u1', 140, 140, 1],
    ['s11', 'Oakmont Funding Group', 'PA', 'u1', 130, 130, 1],
    ['s12', 'Redline Capital Solutions', 'GA', 'u1', 220, 220, 1],
    ['s13', 'Mapleton Business Advisors', 'OH', 'u1', 210, 210, 1],
    ['s14', 'Pure Path Business Capital', 'NJ', 'u1', 90, 90, 1],
    ['s16', 'Westbrook Capital Partners', 'NY', 'u1', 9, 9, 0, 'unsigned'],
    ['s17', 'Summit Lane Funding', 'NY', 'u2', 330, 330, 3],
    ['s18', 'Clearwater Merchant Capital', 'FL', 'u2', 260, 260, 2],
    ['s19', 'Ironwood Business Funding', 'TX', 'u2', 230, 230, 2],
    ['s20', 'Brightpath Capital Group', 'CA', 'u2', 200, 200, 2],
    ['s21', 'Fairway Advance Partners', 'NC', 'u2', 180, 180, 1],
    ['s22', 'Cedar & Main Capital', 'MA', 'u2', 160, 160, 1],
    ['s23', 'Keyline Funding Solutions', 'NJ', 'u2', 150, 150, 2],
    ['s24', 'Horizon Edge Capital', 'FL', 'u2', 210, 210, 1],
    ['s25', 'Atlas Merchant Partners', 'IL', 'u2', 120, 120, 1],
    ['s26', 'Sterling Gate Funding', 'NY', 'u2', 260, 260, 2],
    ['s27', 'Sterlinggate Funding LLC', 'NY', 'u2', 20, 20, 0, 'dup:s26'],
    ['s28', 'Velocity Point Capital', 'NV', 'u2', 200, 200, 1, 'paused'],
    ['s29', 'Crestview Business Capital', 'GA', 'u3', 300, 300, 2],
    ['s30', 'Evergreen Merchant Funding', 'WA', 'u3', 240, 240, 1],
    ['s31', 'Rapid River Capital', 'TN', 'u3', 200, 200, 2],
    ['s32', 'Prime Harbor Funding', 'FL', 'u3', 180, 180, 1],
    ['s33', 'Liberty Square Capital', 'PA', 'u3', 160, 160, 1],
    ['s34', 'Northgate Advance', 'MI', 'u3', 140, 140, 1],
    ['s35', 'Sunbelt Business Funding', 'AZ', 'u3', 120, 120, 2],
    ['s36', 'Union Street Capital', 'NY', 'u3', 200, 200, 1],
    ['s37', 'Meridian Bay Funding', 'CA', 'u3', 14, 14, 0],
    ['s38', 'Coastline Capital Group', 'FL', null, 0, 3, 0, 'unsigned'],
    ['s39', 'Highmark Merchant Advisors', 'TX', null, 0, 180, 1],
    ['s15', 'PURE PATH BUSINESS CAPITAL INC', 'NJ', null, 0, 6, 0, 'dup:s14']
  ];
  var FIRSTS = ['Avi', 'Brian', 'Carla', 'Danny', 'Eitan', 'Frank', 'Gabe', 'Hannah', 'Isaac', 'Jenna', 'Kevin', 'Lior', 'Maya', 'Nate', 'Oren',
    'Paula', 'Rafi', 'Sasha', 'Tom', 'Vanessa', 'Will', 'Yael', 'Zack', 'Ari', 'Becca', 'Chris', 'Dov', 'Erica', 'Gil', 'Jordan', 'Liam', 'Mia'];
  var LASTS = ['Adler', 'Barak', 'Castro', 'Diaz', 'Elkin', 'Feld', 'Gold', 'Hayes', 'Ivri', 'Katz', 'Levy', 'Mizrahi', 'Novak', 'Ortega',
    'Peretz', 'Quinn', 'Rubin', 'Shapiro', 'Tal', 'Vega', 'Weiss', 'Yosef', 'Zur', 'Brooks', 'Cohen', 'Dahan', 'Ezra', 'Friedman'];
  var AREA = { FL: '305', NY: '212', IL: '312', TX: '214', NJ: '201', CA: '213', AZ: '602', VA: '757', CO: '303', PA: '215', GA: '404', OH: '614',
    NC: '704', MA: '617', NV: '702', WA: '206', TN: '615', MI: '313' };

  // ---------- the live pipeline (the story) ----------
  // [id, business, owner, industry, state, monthlyRev, tibMonths, fico, positions, requested, shop, stage, stageDays, submittedDays, extra]
  var LIVE = [
    ['d01', 'Pacific Rim Sushi', 'Kenji Mori', 'Restaurant', 'CA', 62000, 48, 690, 0, 75000, 's06', 'submitted', 0, 0],
    ['d02', 'Hometown Hardware', 'Joe Nowak', 'Retail', 'MI', 38000, 120, 710, 0, 40000, 's34', 'submitted', 0, 0, { missing: ['mtd'] }],
    ['d03', 'Lux Limousine Service', 'Omar Haddad', 'Transportation', 'NV', 29000, 30, 610, 1, 35000, 's20', 'submitted', 1, 1],
    ['d04', 'Atlas Moving & Storage', 'Kevin Price', 'Moving and storage', 'GA', 85000, 60, 655, 1, 100000, 's01', 'submitted', 1, 1, { missing: ['m3'] }],
    ['d05', 'Spice Route Indian Kitchen', 'Priya Iyer', 'Restaurant', 'TX', 47000, 18, 600, 1, 40000, 's04', 'submitted', 0, 0],
    ['d30', 'Shore Point Laundromat', 'Gina Russo', 'Cleaning services', 'NJ', 52000, 40, 640, 0, 50000, 's15', 'submitted', 0, 0],
    ['d06', 'Golden Crust Bakery', 'Maria Santos', 'Restaurant', 'NJ', 41000, 40, 630, 1, 35000, 's05', 'underwriting', 2, 3, { missing: ['m3'], note: 'Underwriting needs the September statement before they can price it.' }],
    ['d07', 'Bluebird Cleaning Services', 'Ashley Ford', 'Cleaning services', 'NC', 26000, 28, 590, 0, 25000, 's21', 'underwriting', 1, 2],
    ['d08', 'Riverbend Veterinary', 'Dr. Sarah Ellis', 'Veterinary', 'TN', 95000, 72, 740, 0, 120000, 's31', 'underwriting', 3, 4],
    ['d09', 'Crossroads Diner', 'Nick Pappas', 'Restaurant', 'PA', 34000, 150, 560, 3, 30000, 's11', 'underwriting', 1, 2, { note: 'Three other funders already pulling daily. Underwriting will want to go small.' }],
    ['d10', 'Coastal Climate HVAC', 'Mike Torres', 'HVAC', 'FL', 118000, 64, 705, 0, 150000, 's01', 'underwriting', 0, 1],
    ['d11', 'Bella Napoli Trattoria', 'Sal Russo', 'Restaurant', 'NY', 88000, 110, 680, 1, 100000, 's02', 'approved', 1, 4, {
      offers: [{ amount: 85000, buyRate: 1.27, termMonths: 9, freq: 'daily', fee: 1.5, maxPoints: 8, points: 6 },
               { amount: 100000, buyRate: 1.30, termMonths: 8, freq: 'daily', fee: 2, maxPoints: 10, points: 8 },
               { amount: 100000, buyRate: 1.36, termMonths: 10, freq: 'weekly', fee: 2.5, maxPoints: 12, points: 10 }],
      note: 'Shop says Sal wants the money before the holiday rush and leans weekly if the price is close.' }],
    ['d12', 'Apex Auto Sales', 'Tony Marino', 'Used car dealer', 'FL', 130000, 48, 640, 2, 120000, 's18', 'approved', 3, 7, {
      offers: [{ amount: 90000, buyRate: 1.38, termMonths: 8, freq: 'weekly', fee: 2.5, maxPoints: 10, points: 8 },
               { amount: 110000, buyRate: 1.44, termMonths: 6, freq: 'daily', fee: 3, maxPoints: 10, points: 9 }] }],
    ['d13', 'Midtown Smiles Orthodontics', 'Dr. Leah Cohen', 'Dental', 'NY', 165000, 90, 760, 0, 200000, 's17', 'approved', 0, 3, {
      offers: [{ amount: 200000, buyRate: 1.19, termMonths: 14, freq: 'weekly', fee: 1.5, maxPoints: 8, points: 6 }] }],
    ['d14', 'Prairie Wind Trucking', 'Bill Jensen', 'Trucking', 'OH', 156000, 44, 615, 2, 120000, 's04', 'approved', 2, 6, {
      offers: [{ amount: 95000, buyRate: 1.40, termMonths: 7, freq: 'daily', fee: 3, maxPoints: 10, points: 10 }] }],
    ['d15', 'Velocity Staffing Group', 'Andre Wallace', 'Staffing', 'TX', 240000, 70, 690, 1, 200000, 's19', 'approved', 1, 5, {
      offers: [{ amount: 175000, buyRate: 1.28, termMonths: 10, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 },
               { amount: 200000, buyRate: 1.32, termMonths: 9, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }] }],
    ['d16', 'Peachtree Family Dental', 'Dr. Anita Shah', 'Dental', 'GA', 120000, 84, 730, 0, 150000, 's29', 'contracts', 1, 8, {
      offers: [{ amount: 150000, buyRate: 1.26, termMonths: 10, freq: 'daily', fee: 1.5, maxPoints: 8, points: 6 }], accept: 0, closing: ['disclosure', 'voided', 'license'] }],
    ['d17', 'Iron Paradise Fitness', 'Marco Diaz', 'Gym or fitness', 'AZ', 54000, 38, 620, 1, 50000, 's07', 'contracts', 3, 9, {
      offers: [{ amount: 50000, buyRate: 1.33, termMonths: 8, freq: 'daily', fee: 2.5, maxPoints: 10, points: 8 }], accept: 0, closing: ['signed', 'voided', 'license', 'ownership', 'bankverify'] }],
    ['d18', 'Cactus Cantina', 'Rosa Mendez', 'Restaurant', 'AZ', 46000, 52, 600, 2, 40000, 's35', 'contracts', 2, 7, {
      offers: [{ amount: 40000, buyRate: 1.40, termMonths: 7, freq: 'daily', fee: 2.5, maxPoints: 10, points: 8 }], accept: 0, closing: ['voided'] }],
    ['d19', 'Glow Beauty Lounge', 'Tasha Green', 'Salon or spa', 'CA', 39000, 35, 645, 1, 45000, 's20', 'contracts', 1, 6, {
      offers: [{ amount: 40000, buyRate: 1.35, termMonths: 8, freq: 'daily', fee: 2.5, maxPoints: 10, points: 9 }], accept: 0, closing: ['signed', 'disclosure', 'voided', 'license'] }],
    ['d20', 'Main Street Auto Care', 'Dave Kowalski', 'Auto repair', 'OH', 68000, 132, 700, 0, 75000, 's01', 'funded', 6, 13, {
      offers: [{ amount: 75000, buyRate: 1.29, termMonths: 9, freq: 'daily', fee: 2, maxPoints: 10, points: 8 }], accept: 0 }],
    ['d21', 'Northside Liquors', 'Victor Alvarez', 'Liquor store', 'NY', 98000, 90, 665, 1, 80000, 's02', 'funded', 12, 19, {
      offers: [{ amount: 80000, buyRate: 1.31, termMonths: 8, freq: 'daily', fee: 2, maxPoints: 10, points: 7 }], accept: 0 }],
    ['d22', 'TrueCut Barbershop', 'Darnell Brooks', 'Salon or spa', 'GA', 24000, 60, 610, 0, 20000, 's29', 'funded', 21, 27, {
      offers: [{ amount: 20000, buyRate: 1.38, termMonths: 6, freq: 'daily', fee: 3, maxPoints: 10, points: 10 }], accept: 0 }],
    ['d23', 'Highline Electric', 'Frank Duarte', 'Electrical contractor', 'NJ', 72000, 54, 675, 1, 90000, 's23', 'funded', 9, 15, {
      offers: [{ amount: 80000, buyRate: 1.32, termMonths: 8, freq: 'daily', fee: 2, maxPoints: 10, points: 8 }], accept: 0 }],
    ['d24', 'Greenleaf Dispensary', 'Jordan Blake', 'Cannabis', 'CO', 140000, 26, 700, 0, 150000, 's09', 'closed', 4, 6, { closed: ['declined', 'Restricted industry', 'We do not fund cannabis.', 'underwriting'] }],
    ['d25', 'Quick Stop Fuel & Mart', 'Raj Patel', 'Retail', 'NJ', 160000, 40, 650, 1, 100000, 's05', 'closed', 5, 12, { closed: ['lost', 'Went with another funder', 'Shop says another funder came in at 1.29.', 'approved'], offers: [{ amount: 90000, buyRate: 1.33, termMonths: 8, freq: 'daily', fee: 2, maxPoints: 10, points: 8 }] }],
    ['d26', 'The Corner Tap', "Sean O'Malley", 'Bar or nightclub', 'IL', 58000, 34, 590, 5, 50000, 's25', 'closed', 9, 11, { closed: ['declined', 'Too many open positions', 'Five funders already pulling.', 'underwriting'] }],
    ['d27', 'Rapid Roofing Solutions', 'Jake Miller', 'Construction', 'TN', 27000, 14, 540, 2, 40000, 's31', 'closed', 14, 16, { closed: ['declined', 'Revenue too low', '', 'underwriting'] }],
    ['d28', 'Delta Tire & Lube', 'Curtis Bell', 'Auto repair', 'NC', 36000, 58, 610, 1, 30000, 's21', 'closed', 20, 26, { closed: ['lost', 'Merchant stopped responding', 'Shop tried for two weeks.', 'approved'], offers: [{ amount: 30000, buyRate: 1.36, termMonths: 7, freq: 'daily', fee: 2.5, maxPoints: 10, points: 8 }] }]
  ];

  // Funded history: renewals and each shop's production come from these.
  // [id, business, owner, industry, state, shop, fundedDaysAgo, amount, buyRate, termMonths, freq, points, stoppedDaysAgo]
  var BOOK = [
    ['h01', 'Lone Star Freight LLC', 'Ray Delgado', 'Trucking', 'TX', 's04', 120, 120000, 1.36, 9, 'daily', 10],
    ['h02', 'Summit Ridge Builders', 'Kyle Brennan', 'Construction', 'CO', 's09', 150, 140000, 1.30, 10, 'daily', 8],
    ['h03', 'Sunrise Medical Clinic', 'Dr. Paul Nguyen', 'Medical practice', 'AZ', 's35', 95, 100000, 1.22, 12, 'weekly', 6],
    ['h04', 'Green Thumb Landscaping', 'Luis Herrera', 'Landscaping', 'NC', 's21', 200, 45000, 1.34, 8, 'daily', 9],
    ['h05', 'Harbor View Hotel', 'Grace Kim', 'Hotel', 'FL', 's01', 60, 250000, 1.27, 10, 'weekly', 6],
    ['h06', 'Evergreen Home Health', 'Karen Wu', 'Home health', 'PA', 's33', 300, 80000, 1.29, 9, 'daily', 8],
    ['h07', 'Brightside Daycare', 'Monique Harris', 'Daycare', 'IL', 's03', 80, 40000, 1.35, 6, 'daily', 10],
    ['h08', 'Elevate Ecom Brands', 'Chris Park', 'E-commerce', 'NV', 's28', 140, 150000, 1.33, 10, 'weekly', 8, 18],
    ['h09', 'Precision Plumbing Co', 'Tom Walsh', 'Plumbing', 'MI', 's34', 180, 70000, 1.31, 10, 'daily', 8],
    ['h10', 'Bayou Seafood Wholesale', 'Remy Broussard', 'Wholesale', 'TX', 's28', 100, 75000, 1.42, 7, 'daily', 10, 20],
    ['h11', 'Metro Print & Sign', 'Greg Hall', 'Printing', 'CO', 's09', 250, 50000, 1.30, 8, 'daily', 8],
    ['h12', 'FreshFields Produce Co', 'Diego Ramirez', 'Wholesale', 'CA', 's20', 130, 200000, 1.28, 10, 'weekly', 6],
    ['h13', 'Urban Threads Boutique', 'Jessica Lin', 'Retail', 'PA', 's11', 200, 30000, 1.39, 6, 'daily', 10],
    ['h14', 'Silver Lake Pet Grooming', 'Amy Schultz', 'Pet services', 'OH', 's13', 190, 20000, 1.38, 6, 'daily', 10],
    ['h15', 'Sunset Nail Spa', 'Linh Tran', 'Salon or spa', 'CA', 's06', 70, 20000, 1.42, 6, 'daily', 10],
    ['h16', 'Riverside Family Dental', 'Dr. Omar Aziz', 'Dental', 'FL', 's18', 140, 90000, 1.25, 10, 'daily', 6],
    ['h17', 'Liberty Auto Body', 'Pete Russo', 'Auto repair', 'NJ', 's05', 125, 60000, 1.33, 8, 'daily', 8],
    ['h18', 'Hilltop Fitness Club', 'Nina Shah', 'Gym or fitness', 'NY', 's17', 155, 70000, 1.30, 9, 'daily', 8],
    ['h19', 'Village Pizza Co', 'Tony Greco', 'Restaurant', 'NY', 's02', 230, 35000, 1.37, 7, 'daily', 10],
    ['h20', 'Downtown Deli & Market', 'Sam Haddad', 'Retail', 'IL', 's25', 70, 30000, 1.36, 6, 'daily', 9],
    ['h21', 'Coastal Logistics Inc', 'Mark Fisher', 'Trucking', 'FL', 's10', 45, 110000, 1.35, 8, 'weekly', 8],
    ['h22', 'Pioneer Roofing', 'Gary Holt', 'Construction', 'TX', 's19', 65, 95000, 1.32, 9, 'daily', 8],
    ['h23', 'Royal Nail Lounge', 'Kim Vo', 'Salon or spa', 'GA', 's29', 100, 25000, 1.40, 6, 'daily', 10],
    ['h24', 'Lakeview Pharmacy', 'Rina Patel', 'Retail', 'IL', 's03', 320, 80000, 1.27, 10, 'daily', 6],
    ['h25', 'Prime Cut Steakhouse', 'Leo Marchetti', 'Restaurant', 'PA', 's33', 50, 60000, 1.33, 8, 'daily', 8],
    ['h26', 'Elite HVAC Services', 'Jon Price', 'HVAC', 'GA', 's12', 190, 85000, 1.31, 9, 'daily', 8],
    ['h27', 'Blue Ridge Cleaners', 'Ann Lee', 'Cleaning services', 'NC', 's21', 85, 25000, 1.39, 6, 'daily', 10],
    ['h28', 'Golden Gate Flooring', 'Ivan Petrov', 'Construction', 'CA', 's20', 40, 65000, 1.33, 8, 'daily', 8],
    ['h29', 'Main Street Smiles', 'Dr. Ruth Klein', 'Dental', 'NJ', 's23', 115, 120000, 1.24, 12, 'weekly', 6],
    ['h30', 'Sunrise Bakery & Cafe', 'Elena Ruiz', 'Restaurant', 'FL', 's01', 90, 40000, 1.36, 7, 'daily', 10],
    ['h31', 'Oak Street Veterinary', 'Dr. Ben Cole', 'Veterinary', 'TN', 's31', 135, 75000, 1.28, 10, 'daily', 7],
    ['h32', 'Metro Electric Supply', 'Raul Soto', 'Wholesale', 'AZ', 's07', 75, 90000, 1.32, 9, 'daily', 8],
    ['h33', 'Northside Auto Repair', 'Dmitri Volkov', 'Auto repair', 'NY', 's26', 225, 45000, 1.35, 7, 'daily', 9],
    ['h34', 'Harbor Fresh Seafood', 'Lena Chu', 'Restaurant', 'FL', 's24', 260, 50000, 1.36, 7, 'daily', 10],
    ['h35', 'Union Square Salon', 'Bianca Rossi', 'Salon or spa', 'NY', 's36', 205, 30000, 1.38, 6, 'daily', 10],
    ['h36', 'Bridgeport Machine Shop', 'Hal Turner', 'Construction', 'FL', 's01', 320, 130000, 1.29, 10, 'weekly', 8]
  ];

  // Declined and lost history, so approval and loss reasons have a real spread.
  // [id, business, industry, state, shop, closedDaysAgo, kind, reason, requested]
  var LOST = [
    ['x01', 'Quickline Couriers', 'Transportation', 'FL', 's01', 33, 'declined', 'Too many NSFs or negative days', 60000],
    ['x02', 'Cornerstone Grill', 'Restaurant', 'NY', 's02', 40, 'lost', 'Went with another funder', 50000],
    ['x03', 'Peak Performance Gym', 'Gym or fitness', 'IL', 's03', 52, 'declined', 'Credit score too low', 35000],
    ['x04', 'Ace Moving Co', 'Moving and storage', 'TX', 's04', 37, 'lost', 'Price too high', 80000],
    ['x05', 'Seaside Boutique', 'Retail', 'NJ', 's05', 65, 'declined', 'Revenue too low', 20000],
    ['x06', 'Valley Auto Glass', 'Auto repair', 'CA', 's06', 48, 'lost', 'Merchant no longer needs it', 25000],
    ['x07', 'Desert Sun Solar', 'Construction', 'AZ', 's07', 58, 'declined', 'Too many open positions', 90000],
    ['x08', 'Tidewater Marine', 'Retail', 'VA', 's08', 22, 'lost', 'Went with another funder', 70000],
    ['x09', 'Mile High Brewing', 'Bar or nightclub', 'CO', 's09', 70, 'declined', 'Revenue trending down', 60000],
    ['x10', 'Sunshine Daycare', 'Daycare', 'FL', 's10', 18, 'declined', 'Not enough time in business', 30000],
    ['x11', 'Keystone Diner', 'Restaurant', 'PA', 's11', 29, 'lost', 'Offer too small', 40000],
    ['x12', 'Big Apple Tailors', 'Retail', 'NY', 's17', 22, 'lost', 'Went with another funder', 25000],
    ['x13', 'Palm Beach Pools', 'Construction', 'FL', 's18', 44, 'declined', 'Recent default on another advance', 75000],
    ['x14', 'Lone Oak BBQ', 'Restaurant', 'TX', 's19', 31, 'lost', 'Price too high', 45000],
    ['x15', 'Golden Coast Wellness', 'Medical practice', 'CA', 's20', 27, 'declined', 'Too many NSFs or negative days', 55000],
    ['x16', 'Harbor Lights Bar', 'Bar or nightclub', 'MA', 's22', 24, 'declined', 'Too many open positions', 40000],
    ['x17', 'Garden State Movers', 'Moving and storage', 'NJ', 's23', 35, 'lost', 'Merchant stopped responding', 50000],
    ['x18', 'Windy City Wraps', 'Restaurant', 'IL', 's25', 41, 'declined', 'Revenue too low', 15000],
    ['x19', 'Empire Car Wash', 'Auto repair', 'NY', 's26', 19, 'lost', 'Went with another funder', 65000],
    ['x20', 'Peach State Plumbing', 'Plumbing', 'GA', 's29', 23, 'declined', 'Credit score too low', 35000],
    ['x21', 'Cascade Coffee Co', 'Restaurant', 'WA', 's30', 20, 'lost', 'Shop stopped responding', 30000],
    ['x22', 'Smoky Mountain Tours', 'Transportation', 'TN', 's31', 46, 'declined', 'Revenue trending down', 50000],
    ['x23', 'Miami Spice Kitchen', 'Restaurant', 'FL', 's32', 21, 'lost', 'Went with another funder', 40000],
    ['x24', 'Liberty Bell Bakery', 'Restaurant', 'PA', 's33', 25, 'declined', 'Not enough time in business', 20000],
    ['x25', 'Motor City Tire', 'Auto repair', 'MI', 's34', 30, 'lost', 'Offer too small', 30000],
    ['x26', 'Saguaro Landscaping', 'Landscaping', 'AZ', 's35', 17, 'declined', 'Too many NSFs or negative days', 25000],
    ['x27', 'Hudson Valley Farms', 'Wholesale', 'NY', 's36', 60, 'lost', 'Went with another funder', 90000],
    ['x28', 'Vegas Vibe Lounge', 'Bar or nightclub', 'NV', 's28', 34, 'declined', 'Recent default on another advance', 45000],
    ['x29', 'Ocean Drive Hotel', 'Hotel', 'FL', 's24', 55, 'declined', 'Revenue trending down', 150000],
    ['x30', 'Rio Grande Trucking', 'Trucking', 'TX', 's39', 70, 'lost', 'Shop stopped responding', 80000],
    ['x31', 'Sterling Dental Lab', 'Dental', 'NY', 's26', 47, 'declined', 'Revenue too low', 30000],
    ['x32', 'Clearwater Bait & Tackle', 'Retail', 'FL', 's18', 16, 'lost', 'Merchant no longer needs it', 15000],
    ['x33', 'Bayside Bistro', 'Restaurant', 'NJ', 's14', 12, 'declined', 'Credit score too low', 30000],
    ['x34', 'Mapleton Hardware', 'Retail', 'OH', 's13', 75, 'lost', 'Went with another funder', 35000],
    ['x35', 'Redline Body Shop', 'Auto repair', 'GA', 's12', 66, 'declined', 'Too many open positions', 40000],
    ['x36', 'Lakeshore Dental Lab', 'Dental', 'IL', 's03', 9, 'lost', 'Offer too small', 45000]
  ];

  var STORY_ACTIVITY = {
    s01: [{ type: 'call', outcome: 'Talked to them', text: 'Avi says they have two more HVAC files coming this week.', days: 2 }],
    s12: [{ type: 'call', outcome: 'Left voicemail', text: 'Nothing from them since the summer. Left a voicemail for the owner.', days: 34 }],
    s16: [{ type: 'note', text: 'New shop. Met them at the broker expo. ISO agreement sent, not signed yet.', days: 9 }],
    s28: [{ type: 'note', text: 'Paused new submissions after two merchants stopped paying within 60 days.', days: 15 }],
    s39: [{ type: 'note', text: 'Eli handed this shop back when he took over the Arizona book. Needs a new ISO manager.', days: 30 }]
  };

  function buildSeed() {
    var r = rng(20261015);
    var areaNext = {};
    var shops = SHOP_ROWS.map(function (row, i) {
      var first = FIRSTS[(i * 7) % FIRSTS.length], last = LASTS[(i * 5 + 3) % LASTS.length];
      var first2 = FIRSTS[(i * 11 + 5) % FIRSTS.length], last2 = LASTS[(i * 3 + 9) % LASTS.length];
      var domain = row[1].toLowerCase().replace(/[^a-z]+/g, '').slice(0, 18) + '.com';
      // 555-0100 to 555-0199 is the range set aside for fiction; count up per area code so no two people share a number.
      var phone = function () { var ac = AREA[row[2]] || '800'; areaNext[ac] = (areaNext[ac] || 100) + 1; return '(' + ac + ') 555-0' + String(areaNext[ac]).slice(-3); };
      var contacts = [{ id: row[0] + '-c1', name: first + ' ' + last, role: 'Owner', phone: phone(1), email: first.toLowerCase() + '@' + domain }];
      var flag = row[7] || '';
      if (row[6] >= 1) contacts.push({ id: row[0] + '-c2', name: first2 + ' ' + last2, role: 'Sales rep', phone: phone(2), email: first2.toLowerCase() + '@' + domain });
      if (row[6] >= 2) contacts.push({ id: row[0] + '-c3', name: FIRSTS[(i * 17 + 2) % FIRSTS.length] + ' ' + LASTS[(i * 7 + 1) % LASTS.length], role: 'Processor', phone: phone(3), email: 'subs@' + domain });
      var shop = {
        id: row[0], updatedAt: 0, name: row[1], state: row[2], repId: row[3],
        assignedAt: row[3] ? ago(row[4], 3) : null,
        history: [], paused: flag === 'paused' ? { reason: 'Two merchants stopped paying within 60 days', at: ago(15, 2) } : null,
        agreementAt: flag === 'unsigned' ? null : ago(Math.max(row[5] - 2, 1), 2),
        createdAt: ago(row[5], 5), contacts: contacts, followUps: [], activity: []
      };
      if (flag === 'reassigned') shop.history.push({ repId: 'u2', from: ago(row[5], 5), to: shop.assignedAt });
      if (row[0] === 's39') shop.history.push({ repId: 'u3', from: ago(row[5], 5), to: ago(30, 2) });
      (STORY_ACTIVITY[row[0]] || []).forEach(function (a, k) { shop.activity.push({ id: row[0] + '-a' + k, type: a.type, outcome: a.outcome, text: a.text, at: ago(a.days, 2), by: row[3] || null }); });
      shop.activity.push({ id: row[0] + '-a9', type: 'system', text: 'Shop added' + (row[3] ? '' : ', no ISO manager yet') + '.', at: shop.createdAt, by: null });
      return shop;
    });
    var shopById = {}; shops.forEach(function (s) { shopById[s.id] = s; });
    // Duplicates are the same people under a second spelling.
    SHOP_ROWS.forEach(function (row) {
      var f = row[7] || '';
      if (f.indexOf('dup:') === 0) { var orig = shopById[f.slice(4)]; shopById[row[0]].contacts = [Object.assign({}, orig.contacts[0], { id: row[0] + '-c1' })]; }
    });
    function repAt(shop, iso) {
      for (var k = 0; k < shop.history.length; k++) { var h = shop.history[k]; if (iso >= h.from && iso < h.to) return h.repId; }
      return shop.repId;
    }
    function baseDeal(id, m, shopId, submittedDays, requested) {
      var shop = shopById[shopId];
      var contact = shop.contacts[shop.contacts.length > 1 ? 1 : 0];
      return { id: id, updatedAt: 0, merchant: m, requested: requested, shopId: shopId, contactId: contact.id, repOverride: null,
        stage: 'submitted', stageAt: ago(submittedDays, 2), submittedAt: ago(submittedDays, 3), renewalOf: null,
        paperwork: {}, closing: {}, offers: [], acceptedOfferId: null, funded: null, closed: null, followUps: [], activity: [] };
    }
    function fullPaperwork(deal, daysAgo) {
      deal.paperwork.app = ago(daysAgo, 3);
      statementMonths(deal.submittedAt).forEach(function (mk) { deal.paperwork[mk] = ago(daysAgo, 3); });
      deal.paperwork.mtd = ago(daysAgo, 3);
    }
    function addOffers(deal, list, sentDays) {
      list.forEach(function (o, k) { deal.offers.push(Object.assign({ id: deal.id + '-o' + (k + 1), sentAt: ago(sentDays, 1 + k * 0.2) }, o)); });
    }
    var deals = [];

    LIVE.forEach(function (row, i) {
      var x = row[14] || {};
      var m = { business: row[1], owner: row[2], industry: row[3], state: row[4], monthlyRevenue: row[5], tibMonths: row[6], fico: row[7], positions: row[8] };
      var deal = baseDeal(row[0], m, row[10], row[13], row[9]);
      deal.stage = row[11]; deal.stageAt = ago(row[12], 1 + (i % 4));
      fullPaperwork(deal, row[13]);
      (x.missing || []).forEach(function (k) { if (k === 'm3') delete deal.paperwork[statementMonths(deal.submittedAt)[2]]; else delete deal.paperwork[k]; });
      if (x.offers) addOffers(deal, x.offers, row[11] === 'approved' ? row[12] : Math.max(row[12] + 2, 1));
      if (x.accept !== undefined) {
        deal.acceptedOfferId = deal.offers[x.accept].id;
        if (row[11] === 'funded') CLOSING_ITEMS.forEach(function (c) { deal.closing[c.id] = ago(row[12] + 1, 2); });
        else (x.closing || []).forEach(function (c) { deal.closing[c] = ago(Math.max(0, row[12] - 1), 1); });
      }
      if (row[11] === 'funded') {
        var o = deal.offers[x.accept];
        deal.funded = { amount: o.amount, buyRate: o.buyRate, termMonths: o.termMonths, freq: o.freq, fee: o.fee, points: o.points,
          fundedAt: ago(row[12], 4), status: 'performing', stoppedAt: null, repId: repAt(shopById[row[10]], ago(row[12], 4)) };
      }
      if (x.closed) deal.closed = { kind: x.closed[0], reason: x.closed[1], note: x.closed[2], at: ago(row[12], 2), fromStage: x.closed[3] };
      deal.activity.push({ id: deal.id + '-a0', type: 'system', text: 'Submitted by ' + shopById[row[10]].name + '.', at: deal.submittedAt, by: null });
      if (x.note) deal.activity.push({ id: deal.id + '-a1', type: 'note', text: x.note, at: ago(row[12], 0.5), by: shopById[row[10]].repId || null });
      if (deal.offers.length) deal.activity.push({ id: deal.id + '-a2', type: 'system', text: 'Underwriting sent ' + (deal.offers.length > 1 ? deal.offers.length + ' offers' : 'an offer') + ' to the shop.', at: deal.offers[0].sentAt, by: null });
      if (deal.funded) deal.activity.push({ id: deal.id + '-a3', type: 'system', text: 'Funded ' + money0(deal.funded.amount) + '.', at: deal.funded.fundedAt, by: null });
      if (deal.closed) deal.activity.push({ id: deal.id + '-a4', type: 'system', text: (deal.closed.kind === 'declined' ? 'Declined: ' : 'Lost: ') + deal.closed.reason + '.', at: deal.closed.at, by: null });
      deals.push(deal);
    });

    BOOK.forEach(function (row) {
      var shop = shopById[row[5]];
      var m = { business: row[1], owner: row[2], industry: row[3], state: row[4], monthlyRevenue: round(row[7] * (0.8 + r() * 0.6), 1000),
        tibMonths: 24 + Math.round(r() * 100), fico: 580 + Math.round(r() * 160), positions: Math.round(r() * 1.4) };
      var subDays = row[6] + 5 + Math.round(r() * 6);
      var deal = baseDeal(row[0], m, row[5], subDays, round(row[7] * (1 + r() * 0.3), 5000));
      fullPaperwork(deal, subDays);
      addOffers(deal, [{ amount: row[7], buyRate: row[8], termMonths: row[9], freq: row[10], fee: 2, maxPoints: 10, points: row[11] }], row[6] + 3);
      deal.acceptedOfferId = deal.offers[0].id;
      CLOSING_ITEMS.forEach(function (c) { deal.closing[c.id] = ago(row[6] + 1, 2); });
      deal.stage = 'funded'; deal.stageAt = ago(row[6], 4);
      deal.funded = { amount: row[7], buyRate: row[8], termMonths: row[9], freq: row[10], fee: 2, points: row[11], fundedAt: ago(row[6], 4),
        status: row[12] ? 'stopped' : 'performing', stoppedAt: row[12] ? ago(row[12], 0) : null, repId: repAt(shop, ago(row[6], 4)) };
      deal.activity.push({ id: deal.id + '-a0', type: 'system', text: 'Submitted by ' + shop.name + '.', at: deal.submittedAt, by: null });
      deal.activity.push({ id: deal.id + '-a3', type: 'system', text: 'Funded ' + money0(row[7]) + '.', at: deal.funded.fundedAt, by: null });
      if (row[12]) deal.activity.push({ id: deal.id + '-a5', type: 'system', text: 'Payments stopped. Sent to collections.', at: deal.funded.stoppedAt, by: null });
      deals.push(deal);
    });

    LOST.forEach(function (row) {
      var m = { business: row[1], owner: FIRSTS[row[1].length % FIRSTS.length] + ' ' + LASTS[(row[1].length * 3) % LASTS.length], industry: row[2], state: row[3],
        monthlyRevenue: round(row[8] * (0.6 + r() * 0.8), 1000), tibMonths: 6 + Math.round(r() * 80), fico: 520 + Math.round(r() * 170), positions: Math.round(r() * 3) };
      var deal = baseDeal(row[0], m, row[4], row[5] + 3, row[8]);
      fullPaperwork(deal, row[5] + 3);
      deal.stage = 'closed'; deal.stageAt = ago(row[5], 2);
      if (row[6] === 'lost') addOffers(deal, [suggestOffer(deal, r)], row[5] + 1);
      deal.closed = { kind: row[6], reason: row[7], note: '', at: ago(row[5], 2), fromStage: row[6] === 'lost' ? 'approved' : 'underwriting' };
      deal.activity.push({ id: deal.id + '-a0', type: 'system', text: 'Submitted by ' + shopById[row[4]].name + '.', at: deal.submittedAt, by: null });
      deal.activity.push({ id: deal.id + '-a4', type: 'system', text: (row[6] === 'declined' ? 'Declined: ' : 'Lost: ') + row[7] + '.', at: deal.closed.at, by: null });
      deals.push(deal);
    });

    // A renewal already under way: Precision Plumbing (h09) is being renewed through the same shop.
    var h09 = deals.filter(function (d) { return d.id === 'h09'; })[0];
    var ren = baseDeal('d29', Object.assign({}, h09.merchant, { monthlyRevenue: h09.merchant.monthlyRevenue + 5000, positions: 1 }), 's34', 1, 90000);
    ren.renewalOf = 'h09'; ren.stage = 'underwriting'; ren.stageAt = ago(0, 3); fullPaperwork(ren, 1);
    ren.activity.push({ id: 'd29-a0', type: 'system', text: 'Renewal submitted by Northgate Advance.', at: ren.submittedAt, by: null });
    deals.push(ren);

    var genMsgs = growBook(shops, shopById, deals, baseDeal, fullPaperwork, addOffers, areaNext);

    // Josh's follow-ups: some late, some due today with times, one repeating weekly, and one
    // that comes due a minute after the page opens so the alert can be seen working.
    var soon = new Date(NOW + 80000); soon.setSeconds(0, 0); soon.setMinutes(soon.getMinutes() + 1);
    var soonDay = Math.round((new Date(soon).setHours(0, 0, 0, 0) - TODAY) / DAY);
    var soonTime = String(soon.getHours()).padStart(2, '0') + ':' + String(soon.getMinutes()).padStart(2, '0');
    var toMonday = ((8 - TODAY.getDay()) % 7) || 7;
    var FU = [
      ['shop', 's01', 0, '10:00', 'Ask Avi when the two HVAC files are coming', ''],
      ['shop', 's13', -3, '11:00', 'Check in. Nothing from them since the summer', ''],
      ['shop', 's16', 1, '11:00', 'Chase the signed ISO agreement', ''],
      ['shop', 's03', 2, '14:00', 'Send them our restaurant guidelines', ''],
      ['shop', 's08', toMonday, '09:30', 'Weekly check in', 'weekly'],
      ['shop', 's12', 1, '15:00', 'Pitch the Elite HVAC renewal', ''],
      ['deal', 'd11', 0, '15:00', 'Did Sal pick an offer?', ''],
      ['deal', 'd06', -1, '09:00', 'Need the September statement from Harborview', ''],
      ['deal', 'd14', 0, '13:00', 'Push Ridgeline on the Prairie Wind offer', ''],
      ['deal', 'd17', soonDay, soonTime, 'Funding call with Marco at Iron Paradise', '']
    ];
    var dealById = {}; deals.forEach(function (d) { dealById[d.id] = d; });
    FU.forEach(function (f, k) {
      var rec = f[0] === 'shop' ? shopById[f[1]] : dealById[f[1]];
      rec.followUps.push({ id: f[1] + '-f' + k, due: dayOffset(f[2]), time: f[3], note: f[4], repeat: f[5], doneAt: null, by: ME, createdAt: ago(Math.max(1, -f[2] + 2), 1) });
    });

    // What Josh keeps in his head about each shop.
    var ABOUT = {
      s01: 'Avi runs it. HVAC and construction files, usually two or three a week. Prefers texts over calls.',
      s02: 'Mostly New York restaurants. Their processor sends clean files.',
      s04: 'Trucking and logistics. They sit on offers, so push them after a day.',
      s05: 'Statements always come late. Ask for them up front.',
      s12: 'Went quiet over the summer. The owner answers texts, not calls.'
    };
    Object.keys(ABOUT).forEach(function (id) { shopById[id].about = ABOUT[id]; });

    // Texts and calls on Josh's line, plus the scam calls he keeps getting.
    var msgs = [];
    var MSGS = [
      // [shop, contact index, direction, kind, text or call outcome, minutes ago, read, seconds]
      ['s01', 0, 'out', 'text', 'Got the Atlas Moving file. Still need their September statement.', 26 * 60, true],
      ['s01', 0, 'in', 'text', 'Coastal Climate is in your inbox. Can you get underwriting on it today?', 35, false],
      ['s02', 1, 'out', 'text', 'Bella Napoli is approved. Three offers are in your email.', 25 * 60, true],
      ['s02', 1, 'in', 'text', 'Sal likes the weekly one. Can you hold it until Friday?', 70, false],
      ['s05', 2, 'in', 'text', 'Golden Crust says the bank is sending September by end of day.', 3 * 60, true],
      ['s07', 1, 'out', 'text', 'Iron Paradise just needs the funding call. Can Marco do 2pm?', 140, true],
      ['s07', 1, 'in', 'text', '2pm works for him.', 95, false],
      ['s04', 1, 'in', 'call', 'Missed', 25, false, 0],
      ['s04', 1, 'out', 'call', 'Talked to them', 26 * 60 + 30, true, 312],
      ['s01', 0, 'out', 'call', 'Talked to them', 2 * 24 * 60, true, 251],
      ['s11', 1, 'in', 'call', 'Talked to them', 5 * 60, true, 188],
      ['s06', 0, 'out', 'call', 'Left voicemail', 30 * 60, true, 41]
    ];
    MSGS.forEach(function (m, k) {
      var sh = shopById[m[0]], c = sh.contacts[Math.min(m[1], sh.contacts.length - 1)];
      msgs.push({ id: 'm' + k, updatedAt: 0, phone: c.phone, dir: m[2], kind: m[3], text: m[3] === 'text' ? m[4] : '', outcome: m[3] === 'call' ? m[4] : null,
        duration: m[7] || 0, at: new Date(NOW - m[5] * 60000).toISOString(), read: m[6], spam: false });
    });
    [['(786) 555-0147', 12], ['(305) 555-0188', 48], ['(954) 555-0163', 130], ['(305) 555-0119', 22 * 60], ['(786) 555-0172', 27 * 60]].forEach(function (u, k) {
      msgs.push({ id: 'u' + k, updatedAt: 0, phone: u[0], dir: 'in', kind: 'call', text: '', outcome: 'Missed', duration: 0, at: new Date(NOW - u[1] * 60000).toISOString(), read: false, spam: true });
    });

    msgs = msgs.concat(genMsgs);
    deals.forEach(function (d) { d.activity.sort(function (a, b) { return a.at < b.at ? 1 : -1; }); });
    shops.forEach(function (s) { s.activity.sort(function (a, b) { return a.at < b.at ? 1 : -1; }); });
    return { shops: shops, deals: deals, msgs: msgs, meta: [JSON.parse(JSON.stringify(DEFAULT_SETTINGS))] };
  }

  // ---------- the rest of Josh's book ----------
  // An ISO manager looks after a couple of hundred shops and hears from most of them only now and
  // then. These come from a fixed seed: some send every few days, some are slowing down, some went
  // quiet months ago, some were imported and never logged a deal, a few are new or paused. Their
  // history stops two days back and nothing they sent is waiting on Josh, so the open pipeline
  // above stays the story. Returns their texts with Josh, which set when each was last contacted.
  var GEN_PRE = ['Atlantic', 'Beacon', 'Blue Harbor', 'Cardinal', 'Centerline', 'Citadel', 'Coral Bay', 'Crown Point', 'Eastgate', 'Elmwood', 'Empire State',
    'Falcon', 'First Street', 'Frontier', 'Gateway', 'Golden Mile', 'Grand Avenue', 'Hudson', 'Ironbridge', 'Keystone', 'Lakefront', 'Landmark', 'Lighthouse',
    'Main Line', 'Meadowbrook', 'Metro', 'Midway', 'Monarch', 'North Star', 'Oak Hill', 'Old Town', 'Pacific Crest', 'Park Avenue', 'Patriot', 'Pinnacle',
    'Pioneer', 'Quarry', 'Red Oak', 'River City', 'Rock Creek', 'Sandstone', 'Seaboard', 'Shoreline', 'Skyline', 'Southpoint', 'Springfield', 'Stonegate',
    'Tallwood', 'Titan', 'Trinity', 'Vantage', 'Victory', 'Vista', 'West End', 'Willow Creek', 'Windward', 'Bayfront', 'Brookside', 'Cornerstone', 'Fifth Avenue'];
  var GEN_SUF = ['Capital', 'Funding', 'Business Capital', 'Merchant Group', 'Advance', 'Financial', 'Capital Partners', 'Funding Solutions',
    'Merchant Services', 'Business Funding', 'Capital Advisors', 'Lending Partners'];
  var GEN_STATES = ['FL', 'NY', 'IL', 'TX', 'NJ', 'CA', 'AZ', 'VA', 'CO', 'PA', 'GA', 'OH', 'NC', 'MA', 'NV', 'WA', 'TN', 'MI'];
  var GEN_TOWNS = ['Tampa', 'Austin', 'Newark', 'Fresno', 'Mesa', 'Dayton', 'Akron', 'Reno', 'Tacoma', 'Raleigh', 'Macon', 'Yonkers', 'Joliet', 'Plano', 'Camden',
    'Pasadena', 'Tempe', 'Norfolk', 'Boulder', 'Erie', 'Savannah', 'Toledo', 'Durham', 'Lowell', 'Henderson', 'Spokane', 'Knoxville', 'Flint', 'Hialeah', 'Albany'];
  var GEN_BIZ = [['Auto Repair', 'Auto repair'], ['Pizza', 'Restaurant'], ['Plumbing', 'Plumbing'], ['Dental', 'Dental'], ['Trucking', 'Trucking'], ['Salon', 'Salon or spa'],
    ['Cleaners', 'Cleaning services'], ['Heating and Air', 'HVAC'], ['Market', 'Retail'], ['Builders', 'Construction'], ['Fitness', 'Gym or fitness'], ['Grill', 'Restaurant'],
    ['Landscaping', 'Landscaping'], ['Logistics', 'Transportation'], ['Pet Care', 'Pet services'], ['Staffing', 'Staffing'], ['Supply', 'Wholesale'],
    ['Family Medicine', 'Medical practice'], ['Electric', 'Electrical contractor'], ['Movers', 'Moving and storage']];
  var GEN_LOOK = ['Sunny', 'Elite', 'Prime', 'Golden', 'Family', 'Coastal', 'Summit', 'Lucky', 'Royal', 'Green Leaf', 'Blue Sky', 'Hometown', 'Express', 'Allied', 'Classic', 'Bright Star'];
  var GEN_OUT = ['Checking in. Anything new for me this week?', 'Got the file, sending it to underwriting now.', 'Approved. The offers are in your email.', 'Thanks for the file. Funded this morning.', 'Need the last bank statement on that one.'];
  var GEN_IN = ['Will do', 'Sending one over today', 'Thanks!', 'Slow week, more next week', 'Have two coming Monday'];

  function growBook(shops, shopById, deals, baseDeal, fullPaperwork, addOffers, areaNext) {
    var g = rng(77), msgs = [];
    var pick = function (arr) { return arr[Math.floor(g() * arr.length)]; };
    var between = function (a, b) { return a + g() * (b - a); };
    var taken = {}; shops.forEach(function (s) { taken[normName(s.name)] = 1; });
    var bizTaken = {}; deals.forEach(function (d) { bizTaken[normName(d.merchant.business)] = 1; });
    var declines = DECLINE_REASONS.filter(function (x) { return x !== 'Other' && x !== 'Restricted industry'; });
    var losses = ['Went with another funder', 'Merchant stopped responding', 'Merchant no longer needs it', 'Offer too small', 'Price too high'];
    var hours = function (days, h) { return new Date(NOW - (days * 24 + h) * 36e5).toISOString(); };
    for (var gi = 0; gi < 184; gi++) {
      var name = '', tries = 0;
      do { name = pick(GEN_PRE) + ' ' + pick(GEN_SUF); tries++; } while (taken[normName(name)] && tries < 60);
      if (taken[normName(name)]) continue;
      taken[normName(name)] = 1;
      var id = 'g' + String(gi + 1).padStart(3, '0'), st = pick(GEN_STATES), ac = AREA[st];
      var p = g(), kind = p < 0.36 ? 'steady' : p < 0.5 ? 'slowing' : p < 0.68 ? 'quiet' : p < 0.8 ? 'occasional' : p < 0.88 ? 'imported' : p < 0.95 ? 'new' : 'paused';
      var created = kind === 'new' ? Math.round(between(2, 25)) : Math.round(between(150, 700));
      var domain = name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 18) + '.com';
      var contacts = [];
      var person = function (role, emailUser) {
        var f = pick(FIRSTS), l = pick(LASTS); areaNext[ac] = (areaNext[ac] || 100) + 1;
        contacts.push({ id: id + '-c' + (contacts.length + 1), name: f + ' ' + l, role: role, phone: '(' + ac + ') 555-0' + String(areaNext[ac]).slice(-3), email: (emailUser || f.toLowerCase()) + '@' + domain });
      };
      person('Owner'); if (g() < 0.55) person('Sales rep'); if (g() < 0.2) person('Processor', 'subs');
      var shop = { id: id, updatedAt: 0, name: name, state: st, repId: 'u1', assignedAt: ago(created, 3), history: [],
        paused: kind === 'paused' ? { reason: pick(['Two merchants stopped paying', 'Sent a stacked file without saying so', 'Asked us to hold submissions for now']), at: ago(Math.round(between(5, 40)), 2) } : null,
        agreementAt: ago(Math.max(created - 1, 1), 2), createdAt: ago(created, 5), importedAt: kind === 'imported' ? ago(created, 5) : null,
        contacts: contacts, followUps: [], activity: [], touches: [] };
      shop.activity.push({ id: id + '-a9', type: 'system', text: kind === 'imported' ? 'Shop imported from SmartMCA.' : 'Shop added.', at: shop.createdAt, by: null });
      shops.push(shop); shopById[id] = shop;

      // How often they send, and how long since the last one.
      var pace = kind === 'steady' ? between(3, 12) : kind === 'slowing' ? between(4, 10) : kind === 'quiet' ? between(6, 20) : kind === 'occasional' ? between(18, 35) : kind === 'paused' ? between(8, 15) : 0;
      var lastDays = kind === 'steady' ? Math.max(2, pace * between(0.2, 1.2)) : kind === 'slowing' ? Math.max(8, pace * between(1.7, 2.7)) : kind === 'quiet' ? between(35, 140)
        : kind === 'occasional' ? Math.max(2, pace * between(0.1, 0.9)) : between(20, 60);
      var approve = [0.72, 0.5, 0.18][g() < 0.45 ? 0 : g() < 0.65 ? 1 : 2], size = Math.round(between(20, 120)) * 1000;
      var day = Math.round(lastDays), n = 0;
      while (pace && day <= lastDays + 150 && n < 14) {
        var biz, b, guard = 0;
        do { b = pick(GEN_BIZ); biz = pick(GEN_LOOK) + ' ' + b[0] + ' of ' + pick(GEN_TOWNS); guard++; } while (bizTaken[normName(biz)] && guard < 40);
        bizTaken[normName(biz)] = 1;
        var req = Math.max(10000, round(size * between(0.6, 1.5), 5000)), did = id + '-' + String(n + 1).padStart(2, '0');
        var m = { business: biz, owner: pick(FIRSTS) + ' ' + pick(LASTS), industry: b[1], state: pick(GEN_STATES), monthlyRevenue: round(req * between(0.7, 1.6), 1000),
          tibMonths: 12 + Math.round(g() * 120), fico: 560 + Math.round(g() * 180), positions: Math.round(g() * 2.2) };
        var deal = baseDeal(did, m, id, day, req);
        fullPaperwork(deal, day);
        deal.activity.push({ id: did + '-a0', type: 'system', text: 'Submitted by ' + name + '.', at: deal.submittedAt, by: null });
        if (day < 5) { deal.stage = 'underwriting'; deal.stageAt = ago(day - 1, 2); }
        else if (g() < approve) {
          addOffers(deal, [suggestOffer(deal, g)], day - 2);
          if (g() < 0.6) {
            var o = deal.offers[0];
            deal.acceptedOfferId = o.id; CLOSING_ITEMS.forEach(function (c) { deal.closing[c.id] = ago(day - 3, 2); });
            deal.stage = 'funded'; deal.stageAt = ago(day - 4, 4);
            deal.funded = { amount: o.amount, buyRate: o.buyRate, termMonths: o.termMonths, freq: o.freq, fee: o.fee, points: o.points, fundedAt: ago(day - 4, 4), status: 'performing', stoppedAt: null, repId: 'u1' };
            deal.activity.push({ id: did + '-a3', type: 'system', text: 'Funded ' + money0(o.amount) + '.', at: deal.funded.fundedAt, by: null });
            // Josh already told the shop about every renewal that opened before today.
            if (fundedProgress(deal.funded).paidPct >= 0.5) shop.touches.push({ id: did + '-t', rule: 'renewal', key: did, how: 'sent', at: ago(Math.max(1, Math.round(day * 0.3)), 2) });
          } else {
            deal.stage = 'closed'; deal.stageAt = ago(day - 3, 2);
            deal.closed = { kind: 'lost', reason: pick(losses), note: '', at: deal.stageAt, fromStage: 'approved' };
          }
        } else {
          deal.stage = 'closed'; deal.stageAt = ago(day - 2, 2);
          deal.closed = { kind: 'declined', reason: pick(declines), note: '', at: deal.stageAt, fromStage: 'underwriting' };
        }
        if (deal.closed) deal.activity.push({ id: did + '-a4', type: 'system', text: (deal.closed.kind === 'declined' ? 'Declined: ' : 'Lost: ') + deal.closed.reason + '.', at: deal.closed.at, by: null });
        deals.push(deal);
        day += Math.max(1, Math.round(pace * between(0.7, 1.3))); n++;
      }

      // The last time Josh and the shop talked, by text.
      if ((kind !== 'new' && kind !== 'imported') || g() < 0.5) {
        var lt = kind === 'quiet' ? between(4, 50) : between(0.2, 17), c = contacts[contacts.length > 1 && g() < 0.5 ? 1 : 0];
        msgs.push({ id: id + '-m1', updatedAt: 0, phone: c.phone, dir: 'out', kind: 'text', text: kind === 'new' ? "Welcome aboard. Send me your first file whenever you're ready." : pick(GEN_OUT),
          outcome: null, duration: 0, at: hours(lt, 3), read: true, spam: false });
        if (g() < 0.4) msgs.push({ id: id + '-m2', updatedAt: 0, phone: c.phone, dir: 'in', kind: 'text', text: pick(GEN_IN), outcome: null, duration: 0, at: hours(lt, 1), read: true, spam: false });
      }
    }
    return msgs;
  }

  root.AD = {
    DAY: DAY, TODAY: TODAY, NOW: NOW, STAGES: STAGES, STAGE_INDEX: STAGE_INDEX, TEAM: TEAM, ME: ME, MY_PHONE: MY_PHONE, REPEATS: REPEATS,
    INDUSTRIES: INDUSTRIES, STATES: STATES, DISCLOSURE_STATES: DISCLOSURE_STATES, DECLINE_REASONS: DECLINE_REASONS,
    LOST_REASONS: LOST_REASONS, OVERRIDE_REASONS: OVERRIDE_REASONS, CONTACT_ROLES: CONTACT_ROLES, CALL_OUTCOMES: CALL_OUTCOMES,
    CLOSING_ITEMS: CLOSING_ITEMS, AUTO_RULES: AUTO_RULES, statementMonths: statementMonths, defaultSettings: function () { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }, monthLabel: monthLabel,
    dateOnly: dateOnly, dayOffset: dayOffset, bizDaysBetween: bizDaysBetween, paymentCount: paymentCount, sellRate: sellRate,
    payback: payback, paymentAmount: paymentAmount, commission: commission, netFunded: netFunded, estAPR: estAPR,
    fundedProgress: fundedProgress, suggestOffer: suggestOffer, money0: money0, moneyK: moneyK, normName: normName, buildSeed: buildSeed
  };
})();
