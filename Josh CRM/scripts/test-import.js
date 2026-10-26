// Import parser tests for public/importer.js. Run: node scripts/test-import.js
'use strict';
var assert = require('assert');
var path = require('path');
var I = require(path.join(__dirname, '../public/importer.js'));
var n = 0;
function ok(cond, msg) {
  assert(cond, msg);
  n++;
}
function eq(a, b, msg) {
  assert.strictEqual(a, b, msg || (String(a) + ' !== ' + String(b)));
  n++;
}
function deep(a, b, msg) {
  assert.deepStrictEqual(a, b, msg);
  n++;
}

/* ---------- helpers ---------- */
eq(I.digits('+1 (305) 555-0100'), '3055550100');
eq(I.normPhone('+1 (305) 555-0100'), '(305) 555-0100');
eq(I.normPhone('3055550100'), '(305) 555-0100');
eq(I.normPhone('ext 12'), 'ext 12');
eq(I.stateCode('Florida'), 'FL');
eq(I.stateCode('fl'), 'FL');
eq(I.stateCode('District of Columbia'), 'DC');
eq(I.stateCode('Narnia'), '');
eq(I.parseMoney('$50,000.00'), 50000);
eq(I.parseMoney('50000'), 50000);
eq(I.parseMoney('50k'), 50000);
eq(I.parseMoney('1.2M'), 1200000);
eq(I.parseMoney('(1,000)'), -1000);
eq(I.parseMoney(''), 0);
eq(I.parseDate('10/02/2026'), '2026-10-02');
eq(I.parseDate('2026-09-30'), '2026-09-30');
eq(I.parseDate('Oct 14, 2026'), '2026-10-14');
eq(I.parseDate('14 Oct 2026'), '2026-10-14');
eq(I.parseDate('1/5/26'), '2026-01-05');
eq(I.parseDate('2026-09-30T12:00:00Z'), '2026-09-30');
var excelSerial = String(Math.round(Date.UTC(2026, 8, 15) / 86400000 + 25569));
eq(I.parseDate(excelSerial), '2026-09-15');
eq(I.parseDate('not a date'), null);

/* ---------- sniff ---------- */
eq(I.sniff('BEGIN:VCARD\nFN:A\nEND:VCARD'), 'vcard');
eq(I.sniff('{"isodesk":1,"shops":{}}'), 'backup');
eq(I.sniff('name,phone\nA,1\nB,2'), 'table');
eq(I.sniff('Shop One\nShop Two\nShop Three'), 'list');

var backup = JSON.stringify({ isodesk: 1, version: 2, shops: {} });
eq(I.sniff(backup, 'backup.json'), 'backup');

/* ---------- iPhone / iCloud vCard 3.0 ---------- */
var iphoneVcf = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Rivera;Ana;;;',
  'FN:Ana Rivera',
  'ORG:Bluefin Capital;Sales',
  'TITLE:Account Executive',
  'EMAIL;type=INTERNET;type=WORK:ana@bluefin.example',
  'item1.TEL;type=pref:+1 (305) 555-0101',
  'item1.X-ABLabel:_$!<Mobile>!$_',
  'NOTE:Follow up about the renewal and',
  ' the Q4 pipeline review.',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJ',
  ' CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBD',
  ' AQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy',
  ' MjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  'ADR;type=WORK:;;100 Biscayne Blvd;Miami;FL;33132;USA',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Harbor Funding Group',
  'ORG:Harbor Funding Group',
  'X-ABShowAs:COMPANY',
  'TEL;type=WORK;type=VOICE:(305) 555-0199',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Cole;Jordan;;;',
  'FN:Jordan Cole',
  'TEL;TYPE=CELL:(786) 555-0144',
  'EMAIL:jordan.cole@example.com',
  'END:VCARD'
].join('\r\n');

eq(I.sniff(iphoneVcf, 'contacts.vcf'), 'vcard');
var iphonePeople = I.parseVCards(iphoneVcf);
eq(iphonePeople.length, 3);
eq(iphonePeople[0].name, 'Ana Rivera');
eq(iphonePeople[0].first, 'Ana');
eq(iphonePeople[0].last, 'Rivera');
eq(iphonePeople[0].org, 'Bluefin Capital');
eq(iphonePeople[0].title, 'Account Executive');
eq(iphonePeople[0].emails[0], 'ana@bluefin.example');
eq(iphonePeople[0].phones[0].number, '(305) 555-0101');
eq(iphonePeople[0].phones[0].type, 'Mobile');
ok(/renewal/.test(iphonePeople[0].note) && /pipeline/.test(iphonePeople[0].note), 'folded note');
eq(iphonePeople[0].city, 'Miami');
eq(iphonePeople[0].state, 'FL');
eq(iphonePeople[1].name, 'Harbor Funding Group');
eq(iphonePeople[1].org, 'Harbor Funding Group');
eq(iphonePeople[1].phones[0].number, '(305) 555-0199');
eq(iphonePeople[2].name, 'Jordan Cole');
eq(iphonePeople[2].org, '');
eq(iphonePeople[2].phones[0].number, '(786) 555-0144');

/* ---------- Android vCard 2.1 with quoted-printable ---------- */
var androidVcf = [
  'BEGIN:VCARD',
  'VERSION:2.1',
  'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=4A=6F=73=C3=A9;=4D=61=72=C3=AD=61;;;',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=4D=61=72=C3=AD=61=20=4A=6F=73=C3=A9',
  'TEL;CELL:3055550102',
  'NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Met at the Miami broker=',
  ' breakfast. Wants a call next week.',
  'END:VCARD'
].join('\n');

var androidPeople = I.parseVCards(androidVcf);
eq(androidPeople.length, 1);
eq(androidPeople[0].first, 'María');
eq(androidPeople[0].last, 'José');
eq(androidPeople[0].name, 'María José');
eq(androidPeople[0].phones[0].number, '(305) 555-0102');
ok(/breakfast/.test(androidPeople[0].note) && /next week/.test(androidPeople[0].note), 'qp soft break note');

/* ---------- Google Contacts CSV ---------- */
var googleCsv = [
  'First Name,Middle Name,Last Name,Phonetic First Name,Phonetic Middle Name,Phonetic Last Name,Name Prefix,Name Suffix,Nickname,File As,Organization Name,Organization Title,Organization Department,Birthday,Notes,Photo,Labels,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value',
  'Sam,,Lee,,,,,,,,Acme ISO,Rep,,,,,* myContacts,Work,sam@acme.example,Mobile,(305) 555-0201,Work,(305) 555-0202',
  'Pat,,Ng,,,,,,,,Best Rate Capital,"Owner, Principal",,,,,* myContacts,,pat@bestrate.example,Mobile,7865550203,,',
  'Riley,,Chen,,,,,,,,Clearwave Funding,Analyst,,,,,* myContacts,Work,riley@clearwave.example,Mobile,(954) 555-0204,,'
].join('\n');

eq(I.sniff(googleCsv, 'google.csv'), 'table');
var googleTable = I.parseTable(googleCsv);
eq(googleTable.headers[0], 'First Name');
eq(googleTable.rows.length, 3);
var googleGuess = I.guessMap(googleTable.headers, googleTable.rows);
eq(googleGuess.kind, 'contacts');
ok(googleGuess.map.first >= 0, 'google first');
ok(googleGuess.map.last >= 0, 'google last');
ok(googleGuess.map.company >= 0, 'google company');
ok(googleGuess.map.email >= 0, 'google email');
ok(googleGuess.map.phone >= 0, 'google phone');
var googlePeople = I.peopleFromTable(googleTable, googleGuess);
eq(googlePeople.length, 3);
eq(googlePeople[0].name, 'Sam Lee');
eq(googlePeople[0].org, 'Acme ISO');
eq(googlePeople[0].emails[0], 'sam@acme.example');
eq(googlePeople[0].phones[0].number, '(305) 555-0201');
eq(googlePeople[0].phones[1].number, '(305) 555-0202');
eq(googlePeople[1].title, 'Owner, Principal');
eq(googlePeople[1].emails[0], 'pat@bestrate.example');

/* ---------- Outlook CSV ---------- */
var outlookCsv = [
  '"First Name","Last Name","Company","Job Title","Business Phone","Mobile Phone","E-mail Address"',
  '"Chris","Adams","Northstar Advance","VP","(212) 555-0301","(917) 555-0302","chris@northstar.example"',
  '"Dana","Brooks","Summit MCA","Director","(718) 555-0303","","dana@summit.example"'
].join('\r\n');

var outlookTable = I.parseTable(outlookCsv);
var outlookGuess = I.guessMap(outlookTable.headers, outlookTable.rows);
eq(outlookGuess.kind, 'contacts');
var outlookPeople = I.peopleFromTable(outlookTable, outlookGuess);
eq(outlookPeople[0].name, 'Chris Adams');
eq(outlookPeople[0].org, 'Northstar Advance');
eq(outlookPeople[0].title, 'VP');
eq(outlookPeople[0].phones[0].number, '(212) 555-0301');
eq(outlookPeople[0].phones[1].number, '(917) 555-0302');
eq(outlookPeople[0].emails[0], 'chris@northstar.example');

/* ---------- Broker list with duplicate company spellings ---------- */
var brokerCsv = [
  'ISO Name,Contact,Phone,Email,State',
  'Pure Path Business Capital Inc,Alex Stone,(305) 555-0401,alex@purepath.example,FL',
  'PURE PATH BUSINESS CAPITAL,Alex Stone,305-555-0401,alex@purepath.example,Florida',
  'Pure Path Business Capital Inc,Blake Ortiz,(786) 555-0402,blake@purepath.example,FL',
  'Harbor Funding Group,Casey Kim,(954) 555-0403,casey@harbor.example,FL'
].join('\n');

var brokerTable = I.parseTable(brokerCsv);
var brokerGuess = I.guessMap(brokerTable.headers, brokerTable.rows);
eq(brokerGuess.kind, 'contacts');
ok(brokerGuess.map.company >= 0, 'broker company');
var brokerPeople = I.peopleFromTable(brokerTable, brokerGuess);
eq(brokerPeople.length, 4);
eq(brokerPeople[0].org, 'Pure Path Business Capital Inc');
eq(brokerPeople[0].state, 'FL');
var grouped = I.groupPeople(brokerPeople);
eq(grouped.companies.length, 2);
var pure = null;
for (var gi = 0; gi < grouped.companies.length; gi++) {
  if (/pure path/i.test(grouped.companies[gi].name)) pure = grouped.companies[gi];
}
ok(pure, 'pure path company group');
eq(pure.people.length, 2);
eq(grouped.loose.length, 0);

/* ---------- Deals sheet ---------- */
var dealsCsv = [
  'Merchant,DBA,Owner,ISO,Amount Requested,Status,Date Submitted,Industry,State,Monthly Revenue,FICO',
  'Joe\'s Pizza LLC,Joe\'s Pizza,Joe Marino,Acme ISO,"$75,000.00",Funded,10/02/2026,Restaurant,FL,"$40,000.00",680',
  'Bright Clean Co,Bright Clean,Amy Wu,Best Rate Capital,50k,Declined,2026-09-30,Janitorial,NY,25000,640',
  'Metro Auto Repair,Metro Auto,Luis Perez,Clearwave Funding,100000,Pending Review,' + excelSerial + ',Automotive,NJ,60000,700',
  'Sunrise Dental,Sunrise Dental,Nina Patel,Acme ISO,45000,Approved,09/01/2026,Healthcare,FL,80000,720',
  'Quick Lube Plus,Quick Lube,Tom Reed,Summit MCA,30000,Contracts Sent,08/15/2026,Automotive,FL,35000,650',
  'Green Garden Supply,Green Garden,Sam Green,Harbor Funding Group,20000,New,07/20/2026,Retail,FL,22000,610'
].join('\n');

eq(I.sniff(dealsCsv), 'table');
var dealsTable = I.parseTable(dealsCsv);
var dealsGuess = I.guessMap(dealsTable.headers, dealsTable.rows);
eq(dealsGuess.kind, 'deals');
ok(dealsGuess.map.merchant >= 0, 'deals merchant');
ok(dealsGuess.map.amount >= 0, 'deals amount');
ok(dealsGuess.map.stage >= 0, 'deals stage');
ok(dealsGuess.map.shop >= 0, 'deals shop');
eq(dealsGuess.map.company, -1);
var deals = I.dealsFromTable(dealsTable, dealsGuess);
eq(deals.length, 6);
eq(deals[0].merchant, 'Joe\'s Pizza LLC');
eq(deals[0].owner, 'Joe Marino');
eq(deals[0].shop, 'Acme ISO');
eq(deals[0].amount, 75000);
eq(deals[0].stage, 'funded');
eq(deals[0].stageText, 'Funded');
eq(deals[0].date, '2026-10-02');
eq(deals[0].industry, 'Restaurant');
eq(deals[0].state, 'FL');
eq(deals[0].revenue, 40000);
eq(deals[0].fico, 680);
eq(deals[1].amount, 50000);
eq(deals[1].stage, 'closed');
eq(deals[1].date, '2026-09-30');
eq(deals[2].stage, 'underwriting');
eq(deals[2].date, '2026-09-15');
eq(deals[3].stage, 'approved');
eq(deals[4].stage, 'contracts');
eq(deals[5].stage, 'submitted');

/* ---------- tab-separated Excel paste ---------- */
var tsv = 'Name\tPhone\tEmail\nAva Stone\t(305) 555-0501\tava@example.com\nBen Cole\t7865550502\tben@example.com';
eq(I.sniff(tsv), 'table');
var tsvTable = I.parseTable(tsv);
eq(tsvTable.headers[1], 'Phone');
eq(tsvTable.rows.length, 2);
var tsvGuess = I.guessMap(tsvTable.headers, tsvTable.rows);
var tsvPeople = I.peopleFromTable(tsvTable, tsvGuess);
eq(tsvPeople[0].phones[0].number, '(305) 555-0501');

/* ---------- semicolon CSV ---------- */
var semi = 'Company;Contact;Phone\nAlpha Capital;Kim Lee;3055550601\nBeta Funding;Ron Day;7865550602';
eq(I.sniff(semi), 'table');
var semiTable = I.parseTable(semi);
eq(semiTable.headers[0], 'Company');
eq(semiTable.rows[0][0], 'Alpha Capital');

/* ---------- BOM + blank lines ---------- */
var bomCsv = '\uFEFFISO Name,Phone\n\nGamma ISO,(305) 555-0701\n\nDelta ISO,(786) 555-0702\n';
var bomTable = I.parseTable(bomCsv);
eq(bomTable.headers[0], 'ISO Name');
eq(bomTable.rows.length, 2);
eq(I.sniff(bomCsv), 'table');

/* ---------- headerless CSV ---------- */
var headerless = 'Ana Rivera,(305) 555-0801\nJordan Cole,(786) 555-0802';
var hlTable = I.parseTable(headerless);
eq(hlTable.headers[0], 'Column 1');
eq(hlTable.headers[1], 'Column 2');
eq(hlTable.rows.length, 2);
eq(hlTable.rows[0][0], 'Ana Rivera');

/* ---------- plain list ---------- */
var listText = 'Acme ISO\nBest Rate Capital\nClearwave Funding';
eq(I.sniff(listText, 'shops.txt'), 'list');

/* ---------- vCard 4 TEL uri ---------- */
var v4 = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'FN:Uri Tel',
  'TEL;VALUE=uri:tel:+1-305-555-0900',
  'END:VCARD'
].join('\n');
var v4p = I.parseVCards(v4);
eq(v4p[0].phones[0].number, '(305) 555-0900');

/* ---------- TYPE="cell,voice" ---------- */
var typed = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Type Test',
  'TEL;TYPE="cell,voice":3055550901',
  'END:VCARD'
].join('\n');
eq(I.parseVCards(typed)[0].phones[0].type, 'Cell');

console.log('importer tests passed: ' + n);
process.exit(0);
