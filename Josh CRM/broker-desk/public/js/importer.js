/* Reads a CSV (a Close export, a SmartMCA export, any spreadsheet saved as CSV) and guesses which
 * column is which. Quoted fields, line breaks inside quotes, semicolon or tab separators and a
 * byte-order mark are all handled. */
(function () {
  'use strict';
  var BD = window.BD;
  function parse(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/, 1)[0] || '', sep = [',', ';', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === '') { q = true; continue; }
      if (c === sep) { row.push(cell); cell = ''; continue; }
      if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(function (x) { return x.trim(); })) rows.push(row); row = []; continue; }
      cell += c;
    }
    row.push(cell); if (row.some(function (x) { return x.trim(); })) rows.push(row);
    var headers = (rows.shift() || []).map(function (h) { return h.trim(); });
    return { headers: headers, rows: rows };
  }
  var FIELDS = [
    ['name', 'Business name', ['lead name', 'company', 'company name', 'business', 'business name', 'legal name', 'organization', 'account name', 'display name', 'dba', 'lead', 'merchant', 'merchant name']],
    ['contactName', 'Contact name', ['contact name', 'contact', 'full name', 'primary contact', 'owner name', 'owner', 'contact full name', 'name']],
    ['firstName', 'Contact first name', ['first name', 'firstname', 'contact first name']],
    ['lastName', 'Contact last name', ['last name', 'lastname', 'contact last name', 'surname']],
    ['title', 'Contact title', ['title', 'contact title', 'job title', 'position']],
    ['phone', 'Phone', ['phone', 'contact phone', 'phone number', 'mobile', 'cell', 'mobile phone', 'work phone', 'primary phone', 'phone 1', 'contact phone 1', 'phones', 'telephone', 'business phone']],
    ['phone2', 'Second phone', ['phone 2', 'other phone', 'contact phone 2', 'home phone', 'alt phone', 'secondary phone']],
    ['email', 'Email', ['email', 'contact email', 'email address', 'primary email', 'emails', 'contact email 1', 'e-mail']],
    ['province', 'Province', ['province', 'state', 'region', 'prov', 'state/province', 'province/state', 'address state']],
    ['city', 'City', ['city', 'town', 'address city']],
    ['industry', 'Industry', ['industry', 'business type', 'vertical', 'category', 'type of business']],
    ['monthlyRevenue', 'Monthly revenue', ['monthly revenue', 'revenue', 'avg monthly revenue', 'average monthly revenue', 'monthly sales', 'gross monthly sales', 'monthly deposits', 'avg revenue']],
    ['requested', 'Amount wanted', ['amount requested', 'requested amount', 'requested', 'funding amount', 'amount needed', 'loan amount', 'amount']],
    ['months', 'Months trading', ['months in business', 'time in business', 'tib', 'months trading']],
    ['score', 'Credit score', ['credit score', 'fico', 'score', 'credit']],
    ['website', 'Website', ['website', 'url', 'web', 'site', 'company url']],
    ['status', 'Status', ['status', 'lead status', 'status label', 'stage']],
    ['notes', 'Notes', ['notes', 'description', 'note', 'comments', 'lead description']],
    ['list', 'List name', ['list', 'list name', 'campaign', 'batch']]
  ];
  function key(h) { return String(h || '').toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function guess(headers) {
    var map = {}, used = {};
    FIELDS.forEach(function (f) {
      for (var i = 0; i < headers.length; i++) { if (used[i]) continue; if (f[2].indexOf(key(headers[i])) >= 0) { map[f[0]] = i; used[i] = 1; return; } }
      for (var j = 0; j < headers.length; j++) { if (used[j]) continue; var k = key(headers[j]); if (f[2].some(function (a) { return a.length > 4 && k.indexOf(a) >= 0; })) { map[f[0]] = j; used[j] = 1; return; } }
    });
    if (map.name == null && map.contactName != null && map.firstName == null) { /* only a person column: use it for both */ }
    return map;
  }
  var PROV_NAMES = {}; BD.S.PROVINCES.forEach(function (p) { PROV_NAMES[p.name.toLowerCase()] = p.id; PROV_NAMES[p.id.toLowerCase()] = p.id; });
  PROV_NAMES['newfoundland'] = 'NL'; PROV_NAMES['pei'] = 'PE'; PROV_NAMES['que'] = 'QC'; PROV_NAMES['ont'] = 'ON';
  function money(v) { var n = Math.round(+String(v || '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; }
  // One CSV row to the fields the server takes.
  function toLead(cells, map, statusMap) {
    var g = function (k) { return map[k] == null ? '' : String(cells[map[k]] == null ? '' : cells[map[k]]).trim(); };
    var contact = g('contactName') || [g('firstName'), g('lastName')].filter(Boolean).join(' ');
    var st = g('status'), prov = PROV_NAMES[g('province').toLowerCase()] || null;
    return { name: g('name') || contact, contactName: contact, title: g('title'), phone: g('phone').split(/[,;\/]/)[0], phone2: g('phone2') || (g('phone').split(/[,;\/]/)[1] || '').trim(), email: (g('email').split(/[,;\s]/)[0] || '').trim(),
      province: prov, city: g('city'), industry: g('industry'), monthlyRevenue: money(g('monthlyRevenue')), requested: money(g('requested')), months: money(g('months')), score: money(g('score')),
      website: g('website'), notes: g('notes'), list: g('list') || null, status: st ? statusMap[st.toLowerCase()] || null : null };
  }
  // Their status names matched to ours by label, so "LEADS TO CALL" becomes Leads to call.
  function statusMap(rows, map) {
    var out = {}, ours = BD.statuses();
    if (map.status == null) return out;
    rows.forEach(function (r) {
      var s = String(r[map.status] || '').trim().toLowerCase(); if (!s || out[s] !== undefined) return;
      var hit = ours.filter(function (o) { return o.label.toLowerCase() === s || o.id === s || s.replace(/[^a-z]/g, '') === o.label.toLowerCase().replace(/[^a-z]/g, ''); })[0];
      if (!hit) hit = ours.filter(function (o) { return (/call/.test(s) && o.id === 'to-call') || (/not interest|dead|lost/.test(s) && o.id === 'not-interested') || (/fund/.test(s) && o.id === 'funded') || (/contact/.test(s) && o.id === 'contacted') || (/app/.test(s) && o.id === 'app-in') || (/new/.test(s) && o.id === 'new'); })[0];
      out[s] = hit ? hit.id : null;
    });
    return out;
  }
  BD.importer = { parse: parse, guess: guess, toLead: toLead, statusMap: statusMap, FIELDS: FIELDS };
})();
