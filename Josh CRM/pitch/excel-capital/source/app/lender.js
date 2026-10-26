/* Lender edition, for the Excel Capital pitch video. Loads after data.js and before app.js.
 * A UK direct lender: pounds and UK dates, brokers instead of shops, applications from the
 * lender's own website, and repayments as the repayments app would report them.
 * Every business, broker and person here is made up. Phone numbers use Ofcom's drama range. */
(function () {
  'use strict';
  var A = window.AD, DAY = A.DAY, NOW = A.NOW, TODAY = A.TODAY;
  function ago(days, hours) { return new Date(NOW - days * DAY - (hours || 0) * 36e5).toISOString(); }
  function fill(list, items) { list.length = 0; items.forEach(function (x) { list.push(x); }); }

  // ---------- money, dates, words ----------
  A.money0 = function (n) { return '£' + Math.round(n).toLocaleString('en-GB'); };
  A.moneyK = function (n) { return n >= 1e6 ? '£' + (Math.round(n / 1e5) / 10) + 'm' : '£' + Math.round(n / 1000) + 'k'; };
  A.monthLabel = function (key, long) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-GB', { month: long ? 'long' : 'short' }); };
  A.STAGES[0].label = 'New application';
  fill(A.CLOSING_ITEMS, [
    { id: 'signed', label: 'Contract signed' },
    { id: 'idcheck', label: "Director's passport checked" },
    { id: 'company', label: 'Companies House check' },
    { id: 'repay', label: 'Repayments approved in their bank' },
    { id: 'call', label: 'Funding call done' }
  ]);
  fill(A.DISCLOSURE_STATES, []);
  fill(A.INDUSTRIES, ['Bakery', 'Café', 'Care home', 'Car dealer', 'Cleaning', 'Construction', 'Dental practice', 'E-commerce', 'Electrical contractor',
    'Engineering', 'Gym', 'Hair and beauty', 'Haulage', 'Healthcare', 'Home care', 'Hotel', 'Landscaping', 'Manufacturing', 'Motor repair', 'Nursery',
    'Off-licence', 'Plumbing', 'Printing', 'Pub', 'Recruitment', 'Restaurant', 'Retail', 'Veterinary', 'Wholesale']);
  fill(A.STATES, ['London', 'Birmingham', 'Bristol', 'Cardiff', 'Edinburgh', 'Glasgow', 'Kent', 'Leeds', 'Liverpool', 'Manchester', 'Newcastle', 'Nottingham', 'Sheffield', 'York']);
  fill(A.DECLINE_REASONS, ['Revenue too low', 'Trading under 12 months', 'Too many other lenders', 'Bounced payments on statements', 'Restricted industry',
    'Revenue trending down', 'Recent default', 'Other']);
  fill(A.LOST_REASONS, ['Went with another lender', 'Business stopped responding', 'Business no longer needs it', 'Offer too small', 'Price too high',
    'Broker stopped responding', 'Other']);
  fill(A.CONTACT_ROLES, ['Owner', 'Broker', 'Processor', 'Applicant']);
  A.TEAM[0].name = 'Excel Team'; A.TEAM[0].first = 'Excel'; A.TEAM[0].initials = 'ET';
  A.TEAM[1].name = 'Tom Hughes'; A.TEAM[1].first = 'Tom'; A.TEAM[1].initials = 'TH';
  A.TEAM[2].name = 'Amira Khan'; A.TEAM[2].first = 'Amira'; A.TEAM[2].initials = 'AK';
  A.MY_PHONE.number = '020 7946 0123'; A.MY_PHONE.provider = 'your phone';
  // UK lenders mostly collect weekly; a daily term still counts business days.
  var baseSuggest = A.suggestOffer;
  A.suggestOffer = function (d, r) { var o = baseSuggest(d, r); o.freq = 'weekly'; return o; };
  var TEMPLATES = [
    { id: 't1', name: 'Got the file', text: 'Hi {first}, got the file for {merchant}. It is with underwriting now.' },
    { id: 't2', name: 'Need statements', text: 'Hi {first}, we still need the {missing} for {merchant} before underwriting can price it.' },
    { id: 't3', name: 'Offer is out', text: 'Hi {first}, {merchant} is approved. The offers are in your inbox. Let me know which one they pick.' },
    { id: 't4', name: 'Checking in', text: 'Hi {first}, checking in. Anything new for us this week?' },
    { id: 't5', name: 'Renewal', text: 'Hi {first}, {merchant} has paid back over half and can renew. Want us to run numbers?' },
    { id: 't6', name: 'Missed repayment', text: 'Hi {first}, this week\'s repayment did not go through. Can you check there is money in the account? We will try again Thursday.' }
  ];
  var baseSettings = A.defaultSettings;
  A.defaultSettings = function () { var s = baseSettings(); s.templates = JSON.parse(JSON.stringify(TEMPLATES)); return s; };

  // ---------- repayments, as the repayments app reports them ----------
  var BANKS = ['Barclays', 'NatWest', 'HSBC', 'Lloyds', 'Santander', 'Monzo Business', 'Starling', 'Metro Bank'];
  // Collections run weekly from a week after funding. Ceiling: 20% over the payment, to the next £10.
  function schedule(f) {
    var n = A.paymentCount(f), pay = Math.round(A.payback(f) / n), out = [], start = new Date(f.fundedAt);
    for (var k = 1; k <= n; k++) { var t = new Date(start.getTime() + k * 7 * DAY); out.push({ n: k, at: t.toISOString(), amount: pay }); }
    return out;
  }
  function mandate(f, bank, approvedDays) { return { status: 'approved', bank: bank, maxPayment: Math.ceil(Math.round(A.payback(f) / A.paymentCount(f)) * 1.2 / 10) * 10, approvedAt: ago(approvedDays, 3), payments: [] }; }
  // Builds collections up to today. fails: { paymentNumber: reason } (a failed one is retried two days later unless open).
  function history(f, bank, fails, stoppedDays) {
    var m = mandate(f, bank, Math.round((NOW - new Date(f.fundedAt)) / DAY) + 1), sch = schedule(f), stop = stoppedDays ? NOW - stoppedDays * DAY : Infinity;
    sch.forEach(function (p) {
      var t = new Date(p.at).getTime();
      if (t > NOW) return;
      var id = 'p' + p.n;
      if (t >= stop) { m.payments.push({ id: id, at: p.at, amount: p.amount, status: 'failed', reason: 'Mandate cancelled by the business' }); return; }
      var fail = fails && fails[p.n];
      if (!fail) { m.payments.push({ id: id, at: p.at, amount: p.amount, status: 'collected' }); return; }
      m.payments.push({ id: id, at: p.at, amount: p.amount, status: 'failed', reason: fail.reason });
      if (fail.retried) m.payments.push({ id: id + 'r', at: new Date(t + 2 * DAY).toISOString(), amount: p.amount, status: 'collected', retry: true });
    });
    if (stoppedDays) m.status = 'cancelled';
    return m;
  }
  A.repaySchedule = schedule;
  A.repayProgress = function (d) {
    var total = A.payback(d.funded), got = 0, sch = schedule(d.funded), done = 0, last = null;
    (d.repay.payments || []).forEach(function (p) { if (p.status === 'collected') { got += p.amount; done++; } if (!last || p.at >= last.at) last = p; });
    var next = sch.filter(function (p) { return new Date(p.at).getTime() > NOW; })[0] || null;
    var per = sch.length ? sch[0].amount : 0, toHalf = Math.max(0, Math.ceil((total / 2 - got) / (per || 1)));
    return { total: sch.length, made: done, paidPct: Math.min(1, got / total), collected: got, payback: total, balance: Math.max(0, total - got),
      next: next, last: last, failed: last && last.status === 'failed' ? last : null, daysToHalf: toHalf * 7 };
  };

  // ---------- the sample book ----------
  // [id, name, region, size 0-3, flag]
  var BROKERS = [
    ['s01', 'Thameside Business Finance', 'London', 3],
    ['s02', 'Northern Quarter Capital', 'Manchester', 3],
    ['s03', 'Brindley Commercial Finance', 'Birmingham', 2],
    ['s04', 'Pennine Funding Partners', 'Leeds', 2],
    ['s05', 'Clydeview Business Capital', 'Glasgow', 2],
    ['s06', 'Severnside Finance', 'Bristol', 1],
    ['s07', 'Merseyway Commercial', 'Liverpool', 1],
    ['s08', 'Castlegate Funding', 'Nottingham', 1],
    ['s09', 'Kingsway Capital Partners', 'London', 1, 'quiet'],
    ['s10', 'Ouseburn Finance', 'Newcastle', 0, 'unsigned'],
    ['web', 'Your website', 'Online', -1]
  ];
  var FIRSTS = ['James', 'Sophie', 'Oliver', 'Charlotte', 'Harry', 'Amelia', 'Jack', 'Priya', 'George', 'Emily', 'Ravi', 'Hannah', 'Callum', 'Isla',
    'Daniel', 'Grace', 'Liam', 'Megan', 'Omar', 'Chloe', 'Ben', 'Aisha', 'Ryan', 'Lucy'];
  var LASTS = ['Patel', 'Clarke', 'Wright', 'Evans', 'Murphy', 'Hughes', 'Walsh', 'Turner', 'Shah', 'Campbell', 'Davies', 'Robinson', 'Hussain', 'Kelly',
    'Bennett', 'Ward', 'Fraser', 'Morgan', 'Lewis', 'Begum'];
  var mob = 100;
  function phone() { mob++; return '07700 900' + String(mob).slice(-3); }

  // [id, business, owner, industry, region, monthlyRev, tibMonths, score, positions, requested, broker, stage, stageDays, submittedDays, extra]
  var LIVE = [
    ['d01', 'Kestrel Print Studio', 'Hannah Moore', 'Printing', 'Manchester', 52000, 40, 690, 0, 40000, 'web', 'submitted', 0, 0, { hours: 2 }],
    ['d02', 'The Olive Grove Deli', 'Marco Ricci', 'Café', 'London', 38000, 30, 660, 0, 25000, 'web', 'submitted', 0, 0, { missing: ['m3'], hours: 4 }],
    ['d03', 'Ashford Plumbing & Heating', 'Gary Holt', 'Plumbing', 'Kent', 61000, 84, 700, 0, 60000, 's01', 'submitted', 0, 0, { hours: 1 }],
    ['d04', 'Northgate Haulage', 'Steve Barker', 'Haulage', 'Leeds', 140000, 60, 655, 1, 150000, 's04', 'submitted', 1, 1, { missing: ['m3'] }],
    ['d05', 'Spice Junction', 'Anil Mehta', 'Restaurant', 'Birmingham', 47000, 26, 640, 1, 35000, 's03', 'submitted', 0, 0, { hours: 5 }],
    ['d06', 'Riverside Physio Clinic', 'Dr Kate Sutton', 'Healthcare', 'Bristol', 58000, 72, 720, 0, 45000, 's06', 'underwriting', 2, 3, { missing: ['m3'], note: 'Underwriting needs the September statement before they can price it.' }],
    ['d07', 'Brightwell Cleaning Services', 'Donna Price', 'Cleaning', 'Liverpool', 33000, 28, 610, 0, 30000, 's07', 'underwriting', 1, 2],
    ['d08', 'Fenwick Veterinary Practice', 'Dr Alan Reid', 'Veterinary', 'Manchester', 95000, 96, 740, 0, 120000, 's02', 'underwriting', 3, 4],
    ['d09', 'The Crown & Anchor', 'Mick Doyle', 'Pub', 'Nottingham', 44000, 150, 580, 3, 30000, 's08', 'underwriting', 1, 2, { note: 'Three other lenders already collecting. Underwriting will want to go small.' }],
    ['d10', 'Coldstream Refrigeration', 'Ross Fraser', 'Engineering', 'Glasgow', 118000, 64, 705, 0, 150000, 's05', 'underwriting', 0, 1],
    ['d11', 'Bella Vista Trattoria', 'Sal Romano', 'Restaurant', 'London', 88000, 110, 680, 1, 100000, 's02', 'approved', 1, 4, {
      offers: [{ amount: 85000, buyRate: 1.27, termMonths: 9, freq: 'weekly', fee: 1.5, maxPoints: 8, points: 6 },
               { amount: 100000, buyRate: 1.30, termMonths: 10, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }],
      note: 'Broker says Sal wants it before Christmas and leans to the longer term.' }],
    ['d12', 'Apex Motor Group', 'Tony Grant', 'Car dealer', 'Birmingham', 130000, 48, 640, 2, 120000, 's03', 'approved', 3, 7, {
      offers: [{ amount: 90000, buyRate: 1.36, termMonths: 8, freq: 'weekly', fee: 2.5, maxPoints: 10, points: 8 }] }],
    ['d13', 'Marylebone Dental Studio', 'Dr Leah Cohen', 'Dental practice', 'London', 165000, 90, 760, 0, 200000, 's01', 'approved', 0, 3, {
      offers: [{ amount: 200000, buyRate: 1.19, termMonths: 14, freq: 'weekly', fee: 1.5, maxPoints: 8, points: 6 }] }],
    ['d14', 'Pennine Freight', 'Bill Jensen', 'Haulage', 'Leeds', 156000, 44, 615, 2, 120000, 's04', 'approved', 2, 6, {
      offers: [{ amount: 95000, buyRate: 1.38, termMonths: 8, freq: 'weekly', fee: 3, maxPoints: 10, points: 10 }] }],
    ['d16', 'Elm Tree Care Home', 'Ruth Adeyemi', 'Care home', 'Kent', 120000, 84, 730, 0, 150000, 's01', 'contracts', 1, 8, {
      offers: [{ amount: 150000, buyRate: 1.26, termMonths: 12, freq: 'weekly', fee: 1.5, maxPoints: 8, points: 6 }], accept: 0, closing: ['signed', 'company', 'call'] }],
    ['d17', 'Ironworks Gym', 'Marcus Webb', 'Gym', 'Leeds', 54000, 38, 650, 1, 50000, 's04', 'contracts', 1, 9, {
      offers: [{ amount: 50000, buyRate: 1.30, termMonths: 9, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }], accept: 0, closing: ['signed', 'idcheck', 'company', 'call'] }],
    ['d18', 'The Hungry Fox', 'Rosa Mendes', 'Restaurant', 'Sheffield', 46000, 52, 600, 2, 40000, 's03', 'contracts', 2, 7, {
      offers: [{ amount: 40000, buyRate: 1.36, termMonths: 8, freq: 'weekly', fee: 2.5, maxPoints: 10, points: 8 }], accept: 0, closing: ['idcheck', 'company'] }],
    ['d19', 'Glow Hair & Beauty', 'Tasha Green', 'Hair and beauty', 'Glasgow', 39000, 35, 645, 1, 45000, 's05', 'contracts', 1, 6, {
      offers: [{ amount: 40000, buyRate: 1.35, termMonths: 8, freq: 'weekly', fee: 2.5, maxPoints: 10, points: 9 }], accept: 0, closing: ['company'] }],
    ['d20', 'Oakfield Motors', 'Dave Kowalski', 'Motor repair', 'Nottingham', 68000, 132, 700, 0, 75000, 's03', 'funded', 6, 13, {
      offers: [{ amount: 75000, buyRate: 1.29, termMonths: 9, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }], accept: 0, bank: 'Lloyds' }],
    ['d21', 'Cellar Door Wines', 'Victor Alvarez', 'Off-licence', 'London', 98000, 90, 665, 1, 80000, 's02', 'funded', 12, 19, {
      offers: [{ amount: 80000, buyRate: 1.31, termMonths: 8, freq: 'weekly', fee: 2, maxPoints: 10, points: 7 }], accept: 0, bank: 'HSBC' }],
    ['d22', 'Sharp Cuts Barbers', 'Darnell Brooks', 'Hair and beauty', 'Bristol', 24000, 60, 610, 0, 20000, 's06', 'funded', 21, 27, {
      offers: [{ amount: 20000, buyRate: 1.36, termMonths: 6, freq: 'weekly', fee: 3, maxPoints: 10, points: 10 }], accept: 0, bank: 'Starling' }],
    ['d23', 'Highbury Electrical', 'Frank Duarte', 'Electrical contractor', 'London', 72000, 54, 675, 1, 90000, 's01', 'funded', 9, 15, {
      offers: [{ amount: 80000, buyRate: 1.32, termMonths: 8, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }], accept: 0, bank: 'Barclays' }],
    ['d24', 'Green Leaf CBD', 'Jordan Blake', 'Retail', 'Bristol', 140000, 26, 700, 0, 150000, 's06', 'closed', 4, 6, { closed: ['declined', 'Restricted industry', 'We do not fund CBD.', 'underwriting'] }],
    ['d25', 'Westway Service Station', 'Raj Patel', 'Retail', 'London', 160000, 40, 650, 1, 100000, 's01', 'closed', 5, 12, { closed: ['lost', 'Went with another lender', 'Broker says another lender came in at 1.27.', 'approved'], offers: [{ amount: 90000, buyRate: 1.33, termMonths: 8, freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }] }],
    ['d26', 'The Tap Room', 'Sean Gallagher', 'Pub', 'Manchester', 58000, 34, 590, 5, 50000, 's02', 'closed', 9, 11, { closed: ['declined', 'Too many other lenders', 'Five lenders already collecting.', 'underwriting'] }],
    ['d27', 'Summit Roofing', 'Jake Miller', 'Construction', 'Sheffield', 27000, 14, 540, 2, 40000, 's03', 'closed', 14, 16, { closed: ['declined', 'Revenue too low', '', 'underwriting'] }]
  ];
  // Funded history. [id, business, owner, industry, region, broker, fundedDaysAgo, amount, factor, termMonths, bank, fails, stoppedDaysAgo]
  var BOOK = [
    ['h01', 'Harbour Lane Bakery', 'Elena Ruiz', 'Bakery', 'Bristol', 's06', 64, 30000, 1.30, 6, 'NatWest', { 9: { reason: 'Not enough money in the account' } }],
    ['h02', 'Lakeside Logistics', 'Mark Fisher', 'Haulage', 'Manchester', 's02', 150, 120000, 1.30, 9, 'Barclays', { 6: { reason: 'Not enough money in the account', retried: true } }],
    ['h03', 'Westfield Dental Care', 'Dr Paul Nguyen', 'Dental practice', 'Leeds', 's04', 95, 100000, 1.22, 12, 'HSBC'],
    ['h04', 'Greenway Landscapes', 'Luis Herrera', 'Landscaping', 'Birmingham', 's03', 135, 45000, 1.30, 8, 'Lloyds'],
    ['h05', 'The Grand Harbour Hotel', 'Grace Kim', 'Hotel', 'Kent', 's01', 60, 250000, 1.27, 10, 'Barclays'],
    ['h06', 'Caring Hands Home Care', 'Karen Wu', 'Home care', 'Liverpool', 's07', 175, 80000, 1.29, 9, 'Santander'],
    ['h07', 'Little Acorns Nursery', 'Monique Harris', 'Nursery', 'Nottingham', 's08', 80, 40000, 1.30, 6, 'Monzo Business', { 9: { reason: 'Bank declined the payment' } }],
    ['h08', 'Urban Threads', 'Jessica Lin', 'Retail', 'London', 's09', 140, 60000, 1.33, 10, 'Metro Bank', null, 18],
    ['h09', 'Precision Pipework', 'Tom Walsh', 'Plumbing', 'Glasgow', 's05', 160, 70000, 1.29, 10, 'Barclays'],
    ['h10', 'Metro Print & Sign', 'Greg Hall', 'Printing', 'Leeds', 's04', 260, 50000, 1.28, 8, 'NatWest'],
    ['h11', 'FreshFields Produce', 'Diego Ramirez', 'Wholesale', 'Kent', 's01', 130, 200000, 1.28, 10, 'HSBC'],
    ['h12', 'Sunrise Café', 'Bethan Jones', 'Café', 'Cardiff', 's06', 90, 25000, 1.34, 6, 'Starling'],
    ['h13', 'Riverside Family Dental', 'Dr Omar Aziz', 'Dental practice', 'Newcastle', 's02', 140, 90000, 1.25, 10, 'Lloyds'],
    ['h14', 'Village Pizza Co', 'Tony Greco', 'Restaurant', 'York', 'web', 110, 35000, 1.34, 7, 'Santander'],
    ['h15', 'Oak Street Vets', 'Dr Ben Cole', 'Veterinary', 'Edinburgh', 's05', 125, 75000, 1.27, 10, 'Barclays'],
    ['h16', 'Bridgeport Engineering', 'Hal Turner', 'Engineering', 'Sheffield', 's03', 45, 130000, 1.29, 10, 'NatWest']
  ];
  // [id, business, industry, region, broker, closedDaysAgo, kind, reason, requested]
  var LOST = [
    ['x01', 'Quickline Couriers', 'Haulage', 'London', 's01', 33, 'declined', 'Bounced payments on statements', 60000],
    ['x02', 'Cornerstone Grill', 'Restaurant', 'Manchester', 's02', 40, 'lost', 'Went with another lender', 50000],
    ['x03', 'Peak Performance Gym', 'Gym', 'Birmingham', 's03', 52, 'declined', 'Revenue too low', 35000],
    ['x04', 'Ace Removals', 'Haulage', 'Leeds', 's04', 37, 'lost', 'Price too high', 80000],
    ['x05', 'Seaside Boutique', 'Retail', 'Bristol', 's06', 65, 'declined', 'Trading under 12 months', 20000],
    ['x06', 'Valley Auto Glass', 'Motor repair', 'Glasgow', 's05', 48, 'lost', 'Business no longer needs it', 25000],
    ['x07', 'Mile High Brewing', 'Pub', 'Liverpool', 's07', 70, 'declined', 'Revenue trending down', 60000],
    ['x08', 'Keystone Diner', 'Restaurant', 'Nottingham', 's08', 29, 'lost', 'Offer too small', 40000],
    ['x09', 'Empire Car Wash', 'Motor repair', 'London', 's09', 75, 'lost', 'Went with another lender', 65000],
    ['x10', 'Lakeshore Dental Lab', 'Dental practice', 'Manchester', 's02', 9, 'lost', 'Offer too small', 45000]
  ];

  A.buildSeed = function () {
    var shops = BROKERS.map(function (row, i) {
      var web = row[0] === 'web', domain = row[1].toLowerCase().replace(/[^a-z]+/g, '').slice(0, 18) + '.co.uk';
      var person = function (k, role) { var f = FIRSTS[(i * 7 + k * 5) % FIRSTS.length], l = LASTS[(i * 5 + k * 3 + 3) % LASTS.length]; return { id: row[0] + '-c' + (k + 1), name: f + ' ' + l, role: role, phone: phone(), email: f.toLowerCase() + '@' + domain }; };
      var contacts = web ? [] : [person(0, 'Owner')];
      if (row[3] >= 1) contacts.push(person(1, 'Broker'));
      if (row[3] >= 2) contacts.push(Object.assign(person(2, 'Processor'), { email: 'deals@' + domain }));
      var created = web ? 200 : 300 - i * 20;
      var s = { id: row[0], updatedAt: 0, name: row[1], state: row[2], repId: 'u1', assignedAt: ago(created, 3), history: [], paused: null,
        agreementAt: row[4] === 'unsigned' ? null : ago(created - 2, 2), createdAt: ago(row[4] === 'unsigned' ? 6 : created, 5), contacts: contacts, followUps: [], activity: [] };
      s.activity.push({ id: row[0] + '-a9', type: 'system', text: web ? 'Applications from excelcapital.co.uk land here.' : 'Broker added.', at: s.createdAt, by: null });
      return s;
    });
    var shopById = {}; shops.forEach(function (s) { shopById[s.id] = s; });
    var web = shopById.web;
    function baseDeal(id, m, shopId, submittedDays, requested, hours) {
      var shop = shopById[shopId], contactId;
      if (shopId === 'web') { var c = { id: 'web-' + id, name: m.owner, role: 'Applicant', phone: m.phone, email: m.email }; web.contacts.push(c); contactId = c.id; }
      else contactId = shop.contacts[shop.contacts.length > 1 ? 1 : 0].id;
      var at = hours ? ago(0, hours) : ago(submittedDays, 3);
      return { id: id, updatedAt: 0, merchant: m, requested: requested, shopId: shopId, contactId: contactId, repOverride: null,
        stage: 'submitted', stageAt: at, submittedAt: at, renewalOf: null, paperwork: {}, closing: {}, offers: [], acceptedOfferId: null, funded: null, closed: null, followUps: [], activity: [] };
    }
    function merchant(row) {
      var first = row[2].replace(/^Dr /, '').split(' ')[0].toLowerCase();
      return { business: row[1], owner: row[2], industry: row[3], state: row[4], monthlyRevenue: row[5], tibMonths: row[6], fico: row[7], positions: row[8],
        phone: phone(), email: first + '@' + row[1].toLowerCase().replace(/[^a-z]+/g, '').slice(0, 16) + '.co.uk' };
    }
    function fullPaperwork(deal, daysAgo) {
      deal.paperwork.app = ago(daysAgo, 3);
      A.statementMonths(deal.submittedAt).forEach(function (mk) { deal.paperwork[mk] = ago(daysAgo, 3); });
      deal.paperwork.mtd = ago(daysAgo, 3);
    }
    function addOffers(deal, list, sentDays) { list.forEach(function (o, k) { deal.offers.push(Object.assign({ id: deal.id + '-o' + (k + 1), sentAt: ago(sentDays, 1 + k * 0.2) }, o)); }); }
    function from(deal) { return deal.shopId === 'web' ? 'Applied on your website.' : 'Submitted by ' + shopById[deal.shopId].name + '.'; }
    var deals = [];
    LIVE.forEach(function (row, i) {
      var x = row[14] || {}, m = merchant(row);
      var deal = baseDeal(row[0], m, row[10], row[13], row[9], x.hours);
      deal.stage = row[11]; deal.stageAt = x.hours ? deal.submittedAt : ago(row[12], 1 + (i % 4));
      fullPaperwork(deal, row[13]);
      (x.missing || []).forEach(function (k) { if (k === 'm3') delete deal.paperwork[A.statementMonths(deal.submittedAt)[2]]; else delete deal.paperwork[k]; });
      if (x.offers) addOffers(deal, x.offers, row[11] === 'approved' ? row[12] : Math.max(row[12] + 2, 1));
      if (x.accept !== undefined) {
        deal.acceptedOfferId = deal.offers[x.accept].id;
        if (row[11] === 'funded') A.CLOSING_ITEMS.forEach(function (c) { deal.closing[c.id] = ago(row[12] + 1, 2); });
        else (x.closing || []).forEach(function (c) { deal.closing[c] = ago(Math.max(0, row[12] - 1), 1); });
      }
      if (row[11] === 'funded') {
        var o = deal.offers[x.accept];
        deal.funded = { amount: o.amount, buyRate: o.buyRate, termMonths: o.termMonths, freq: 'weekly', fee: o.fee, points: o.points, fundedAt: ago(row[12], 4), status: 'performing', stoppedAt: null, repId: 'u1' };
        deal.repay = history(deal.funded, x.bank);
      }
      if (x.closed) deal.closed = { kind: x.closed[0], reason: x.closed[1], note: x.closed[2], at: ago(row[12], 2), fromStage: x.closed[3] };
      deal.activity.push({ id: deal.id + '-a0', type: 'system', text: from(deal), at: deal.submittedAt, by: null });
      if (x.note) deal.activity.push({ id: deal.id + '-a1', type: 'note', text: x.note, at: ago(row[12], 0.5), by: 'u1' });
      if (deal.offers.length) deal.activity.push({ id: deal.id + '-a2', type: 'system', text: 'Underwriting sent ' + (deal.offers.length > 1 ? deal.offers.length + ' offers' : 'an offer') + '.', at: deal.offers[0].sentAt, by: null });
      if (deal.funded) deal.activity.push({ id: deal.id + '-a3', type: 'system', text: 'Funded ' + A.money0(deal.funded.amount) + '.', at: deal.funded.fundedAt, by: null });
      if (deal.closed) deal.activity.push({ id: deal.id + '-a4', type: 'system', text: (deal.closed.kind === 'declined' ? 'Declined: ' : 'Lost: ') + deal.closed.reason + '.', at: deal.closed.at, by: null });
      deals.push(deal);
    });
    BOOK.forEach(function (row, i) {
      var m = merchant([row[0], row[1], row[2], row[3], row[4], Math.round(row[7] * 0.9 / 1000) * 1000, 30 + i * 6, 620 + (i * 13) % 120, i % 2]);
      var subDays = row[6] + 6;
      var deal = baseDeal(row[0], m, row[5], subDays, Math.round(row[7] * 1.1 / 5000) * 5000);
      fullPaperwork(deal, subDays);
      addOffers(deal, [{ amount: row[7], buyRate: row[8], termMonths: row[9], freq: 'weekly', fee: 2, maxPoints: 10, points: 8 }], row[6] + 3);
      deal.acceptedOfferId = deal.offers[0].id;
      A.CLOSING_ITEMS.forEach(function (c) { deal.closing[c.id] = ago(row[6] + 1, 2); });
      deal.stage = 'funded'; deal.stageAt = ago(row[6], 4);
      deal.funded = { amount: row[7], buyRate: row[8], termMonths: row[9], freq: 'weekly', fee: 2, points: 8, fundedAt: ago(row[6], 4),
        status: row[12] ? 'stopped' : 'performing', stoppedAt: row[12] ? ago(row[12], 0) : null, repId: 'u1' };
      deal.repay = history(deal.funded, row[10], row[11], row[12]);
      deal.activity.push({ id: deal.id + '-a0', type: 'system', text: from(deal), at: deal.submittedAt, by: null });
      deal.activity.push({ id: deal.id + '-a3', type: 'system', text: 'Funded ' + A.money0(row[7]) + '.', at: deal.funded.fundedAt, by: null });
      if (row[12]) deal.activity.push({ id: deal.id + '-a5', type: 'system', text: 'The business cancelled repayments in their bank. Sent to collections.', at: deal.funded.stoppedAt, by: null });
      deals.push(deal);
    });
    LOST.forEach(function (row, i) {
      var m = merchant([row[0], row[1], FIRSTS[(i * 3) % FIRSTS.length] + ' ' + LASTS[(i * 7) % LASTS.length], row[2], row[3], Math.round(row[8] * 0.8 / 1000) * 1000, 20 + i * 5, 600, i % 3]);
      var deal = baseDeal(row[0], m, row[4], row[5] + 3, row[8]);
      fullPaperwork(deal, row[5] + 3);
      deal.stage = 'closed'; deal.stageAt = ago(row[5], 2);
      if (row[6] === 'lost') addOffers(deal, [A.suggestOffer(deal)], row[5] + 1);
      deal.closed = { kind: row[6], reason: row[7], note: '', at: ago(row[5], 2), fromStage: row[6] === 'lost' ? 'approved' : 'underwriting' };
      deal.activity.push({ id: deal.id + '-a0', type: 'system', text: from(deal), at: deal.submittedAt, by: null });
      deals.push(deal);
    });
    // A renewal already under way for Precision Pipework.
    var h09 = deals.filter(function (d) { return d.id === 'h09'; })[0];
    var ren = baseDeal('d29', Object.assign({}, h09.merchant, { monthlyRevenue: h09.merchant.monthlyRevenue + 5000 }), 's05', 1, 90000);
    ren.renewalOf = 'h09'; ren.stage = 'underwriting'; ren.stageAt = ago(0, 3); fullPaperwork(ren, 1);
    ren.activity.push({ id: 'd29-a0', type: 'system', text: 'Renewal submitted by Clydeview Business Capital.', at: ren.submittedAt, by: null });
    deals.push(ren);

    var toMonday = ((8 - TODAY.getDay()) % 7) || 7;
    var FU = [
      ['shop', 's01', 0, '10:00', 'Ask about the two care home files they mentioned', ''],
      ['shop', 's09', -3, '11:00', 'Check in. Nothing from them since the summer', ''],
      ['shop', 's10', 1, '11:00', 'Chase the signed broker agreement', ''],
      ['shop', 's08', toMonday, '09:30', 'Weekly check in', 'weekly'],
      ['deal', 'd11', 0, '15:00', 'Did Sal pick an offer?', ''],
      ['deal', 'd06', -1, '09:00', 'Need the September statement from Severnside', ''],
      ['deal', 'd14', 0, '13:00', 'Push Pennine on the Pennine Freight offer', '']
    ];
    var dealById = {}; deals.forEach(function (d) { dealById[d.id] = d; });
    FU.forEach(function (f, k) {
      var rec = f[0] === 'shop' ? shopById[f[1]] : dealById[f[1]];
      rec.followUps.push({ id: f[1] + '-f' + k, due: A.dayOffset(f[2]), time: f[3], note: f[4], repeat: f[5], doneAt: null, by: 'u1', createdAt: ago(Math.max(1, -f[2] + 2), 1) });
    });
    shopById.s01.about = 'Their best files are care homes and dental practices. Prefers email for offers.';
    shopById.s04.about = 'Haulage and gyms around Leeds. They sit on offers, so push them after a day.';
    shopById.s06.about = 'Statements always come late. Ask for them up front.';
    deals.forEach(function (d) { d.activity.sort(function (a, b) { return a.at < b.at ? 1 : -1; }); });
    var meta = A.defaultSettings(); meta.setup = { hidden: true, phoneAck: true };
    return { shops: shops, deals: deals, msgs: [], meta: [meta] };
  };

  // ---------- words: brokers, businesses, applications ----------
  var WORDS = [
    [/\bISO Desk\b/g, 'Excel Capital'], [/\bISO managers\b/g, 'account managers'], [/\bISO manager\b/g, 'account manager'], [/\bISO agreement\b/g, 'broker agreement'],
    [/\bShops\b/g, 'Brokers'], [/\bshops\b/g, 'brokers'], [/\bShop\b/g, 'Broker'], [/\bshop\b/g, 'broker'],
    [/\bMerchants\b/g, 'Businesses'], [/\bmerchants\b/g, 'businesses'], [/\bMerchant\b/g, 'Business'], [/\bmerchant\b/g, 'business'],
    [/\bLog a submission\b/g, 'Add an application'], [/\ba submission\b/g, 'an application'], [/\bA submission\b/g, 'An application'], [/\bsubmissions\b/g, 'applications'], [/\bsubmission\b/g, 'application'], [/\bfunders\b/g, 'lenders'], [/\bfunder\b/g, 'lender'],
    [/\bcash advances\b/g, 'loans'], [/\bConnect UC\b/g, 'your phone'], [/\bTime in business\b/g, 'Trading for'], [/\bOpen positions\b/g, 'Other lenders']
  ];
  function tr(s) { for (var i = 0; i < WORDS.length; i++) s = s.replace(WORDS[i][0], WORDS[i][1]); return s; }
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1 };
  function walk(node) {
    if (node.nodeType === 3) { if (node.parentNode && !SKIP[node.parentNode.nodeName]) { var v = tr(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; } return; }
    if (node.nodeType !== 1) return;
    ['placeholder', 'data-tip', 'aria-label', 'title'].forEach(function (a) { var v = node.getAttribute(a); if (v) { var t = tr(v); if (t !== v) node.setAttribute(a, t); } });
    if (SKIP[node.nodeName]) return;
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }
  function start() {
    document.title = 'Excel Capital';
    walk(document.body);
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') walk(m.target);
        else Array.prototype.forEach.call(m.addedNodes, walk);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'data-tip', 'aria-label', 'title'] });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  var css = document.createElement('style');
  css.textContent = '.repay-top{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line-2);border-top:1px solid var(--line-2);border-bottom:1px solid var(--line-2)}' +
    '.repay-top>div{background:#fff;padding:10px 16px}.repay-top .l{font-size:12px;color:var(--muted)}.repay-top .v{font-size:19px;margin-top:1px}.repay-top .v.word{font-family:var(--sans);font-size:15px;font-weight:650;padding-top:3px}.repay-top .sub{font-size:12.5px;color:var(--ink-2)}' +
    '.repay-bar{padding:12px 16px 4px}.pay-row{display:grid;grid-template-columns:110px 110px minmax(0,1fr);align-items:center;gap:12px;padding:8px 16px;border-top:1px solid var(--line-2);font-size:13.5px}' +
    '.pay-row .amt{font-family:var(--serif);font-variant-numeric:tabular-nums}.pay-row .why{color:var(--ink-2)}.pay-row.bad{background:var(--bad-soft)}' +
    '.repay-foot{padding:9px 16px;font-size:12.5px;color:var(--muted);border-top:1px solid var(--line-2)}.chk .meta .btn{margin-left:6px}' +
    '.brand .ex{font-weight:700;letter-spacing:-.01em}';
  document.head.appendChild(css);
})();
