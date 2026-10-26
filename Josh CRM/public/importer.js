/* ISO Desk contact/deal import parsers. Pure functions, no DOM. */
(function (root) {
  'use strict';

  var STATE_NAMES = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
    florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
    indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
    wyoming: 'WY', dc: 'DC'
  };
  var STATE_CODES = {};
  Object.keys(STATE_NAMES).forEach(function (k) {
    STATE_CODES[STATE_NAMES[k]] = STATE_NAMES[k];
  });

  var MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
    september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  function digits(s) {
    var d = String(s == null ? '' : s).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
  }

  function normPhone(s) {
    var raw = trim(s);
    if (!raw) return '';
    var d = digits(raw);
    if (d.length === 10) {
      return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    }
    return raw;
  }

  function stateCode(s) {
    var t = trim(s);
    if (!t) return '';
    var up = t.toUpperCase();
    if (up.length === 2 && STATE_CODES[up]) return up;
    var key = t.toLowerCase().replace(/[.\']/g, '').replace(/\s+/g, ' ');
    return STATE_NAMES[key] || '';
  }

  function parseMoney(s) {
    if (s == null || s === '') return 0;
    var t = trim(String(s));
    if (!t) return 0;
    var neg = false;
    if (/^\(.*\)$/.test(t)) {
      neg = true;
      t = t.slice(1, -1);
    }
    t = t.replace(/[$,\s]/g, '');
    var m = t.match(/^(-?)(\d+(?:\.\d+)?)([kmb])?$/i);
    if (!m) {
      var n = parseFloat(t);
      return isFinite(n) ? (neg ? -n : n) : 0;
    }
    var num = parseFloat(m[1] + m[2]);
    if (!isFinite(num)) return 0;
    var suf = (m[3] || '').toLowerCase();
    if (suf === 'k') num *= 1000;
    else if (suf === 'm') num *= 1000000;
    else if (suf === 'b') num *= 1000000000;
    return neg ? -num : num;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isoFromParts(y, m, d) {
    if (!y || m < 0 || m > 11 || d < 1 || d > 31) return null;
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function parseDate(s) {
    if (s == null || s === '') return null;
    var t = trim(String(s));
    if (!t) return null;

    if (/^\d+(\.\d+)?$/.test(t)) {
      var serial = parseFloat(t);
      if (serial >= 20000 && serial <= 80000) {
        var ms = Math.round((serial - 25569) * 86400 * 1000);
        var dt = new Date(ms);
        return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
      }
    }

    var isoTs = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (isoTs) return isoTs[1] + '-' + isoTs[2] + '-' + isoTs[3];

    var mdY = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (mdY) {
      var mm = parseInt(mdY[1], 10) - 1;
      var dd = parseInt(mdY[2], 10);
      var yy = parseInt(mdY[3], 10);
      if (mdY[3].length <= 2) yy = yy < 70 ? 2000 + yy : 1900 + yy;
      return isoFromParts(yy, mm, dd);
    }

    var mon1 = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (mon1) {
      var mi1 = MONTHS[mon1[1].toLowerCase()];
      if (mi1 != null) return isoFromParts(parseInt(mon1[3], 10), mi1, parseInt(mon1[2], 10));
    }

    var mon2 = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (mon2) {
      var mi2 = MONTHS[mon2[2].toLowerCase()];
      if (mi2 != null) return isoFromParts(parseInt(mon2[3], 10), mi2, parseInt(mon2[1], 10));
    }

    return null;
  }

  function countDelimsOutsideQuotes(line, delim) {
    var n = 0, inQ = false, i, c;
    for (i = 0; i < line.length; i++) {
      c = line.charAt(i);
      if (c === '"') {
        if (inQ && line.charAt(i + 1) === '"') { i++; continue; }
        inQ = !inQ;
      } else if (!inQ && c === delim) {
        n++;
      }
    }
    return n;
  }

  function detectDelimiter(line) {
    var candidates = [',', '\t', ';'];
    var best = ',', bestN = -1, i, n;
    for (i = 0; i < candidates.length; i++) {
      n = countDelimsOutsideQuotes(line, candidates[i]);
      if (n > bestN) { bestN = n; best = candidates[i]; }
    }
    return bestN > 0 ? best : ',';
  }

  function sniff(text, filename) {
    var t = String(text == null ? '' : text);
    if (/BEGIN:VCARD/i.test(t)) return 'vcard';
    try {
      var j = JSON.parse(trim(t));
      if (j && j.isodesk === 1) return 'backup';
    } catch (e) { /* not json */ }

    var lines = t.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    var nonempty = [];
    var i;
    for (i = 0; i < lines.length; i++) {
      if (trim(lines[i])) nonempty.push(lines[i]);
    }
    if (nonempty.length >= 2) {
      var first = nonempty[0];
      var delim = null;
      var delims = [',', '\t', ';'];
      for (i = 0; i < delims.length; i++) {
        if (countDelimsOutsideQuotes(first, delims[i]) >= 1) {
          delim = delims[i];
          break;
        }
      }
      if (delim) {
        var same = 0;
        for (i = 1; i < nonempty.length; i++) {
          if (countDelimsOutsideQuotes(nonempty[i], delim) >= 1) same++;
        }
        if (same >= (nonempty.length - 1) / 2) return 'table';
      }
    }
    return 'list';
  }

  function unescapeVCard(val) {
    var out = '', i, c;
    for (i = 0; i < val.length; i++) {
      c = val.charAt(i);
      if (c === '\\' && i + 1 < val.length) {
        var n = val.charAt(i + 1);
        if (n === 'n' || n === 'N') { out += '\n'; i++; }
        else if (n === ',' || n === ';' || n === '\\') { out += n; i++; }
        else out += c;
      } else out += c;
    }
    return out;
  }

  function splitUnescaped(val, sep) {
    var parts = [], cur = '', i, c;
    for (i = 0; i < val.length; i++) {
      c = val.charAt(i);
      if (c === '\\' && i + 1 < val.length) {
        cur += c + val.charAt(i + 1);
        i++;
      } else if (c === sep) {
        parts.push(cur);
        cur = '';
      } else cur += c;
    }
    parts.push(cur);
    return parts;
  }

  function decodeQuotedPrintable(val) {
    var s = String(val || '');
    s = s.replace(/=\r?\n/g, '').replace(/=$/, '');
    var bytes = [], i = 0;
    while (i < s.length) {
      if (s.charAt(i) === '=' && i + 2 < s.length && /[0-9A-Fa-f]{2}/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 3;
      } else if (s.charAt(i) === '_') {
        bytes.push(0x20);
        i++;
      } else {
        bytes.push(s.charCodeAt(i) & 0xff);
        i++;
      }
    }
    var out = '', j = 0;
    while (j < bytes.length) {
      var b = bytes[j];
      if (b < 0x80) {
        out += String.fromCharCode(b);
        j++;
      } else if ((b & 0xe0) === 0xc0 && j + 1 < bytes.length) {
        out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j + 1] & 0x3f));
        j += 2;
      } else if ((b & 0xf0) === 0xe0 && j + 2 < bytes.length) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[j + 1] & 0x3f) << 6) | (bytes[j + 2] & 0x3f));
        j += 3;
      } else if ((b & 0xf8) === 0xf0 && j + 3 < bytes.length) {
        var cp = ((b & 0x07) << 18) | ((bytes[j + 1] & 0x3f) << 12) | ((bytes[j + 2] & 0x3f) << 6) | (bytes[j + 3] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        j += 4;
      } else {
        out += String.fromCharCode(b);
        j++;
      }
    }
    return out;
  }

  function stripAppleLabel(s) {
    var t = trim(s);
    var m = t.match(/^_\$!<(.+)>!\$_$/);
    return m ? m[1] : t;
  }

  function parseParams(rawParams) {
    var params = {}, types = [], i, p, eq, key, val, parts, j;
    for (i = 0; i < rawParams.length; i++) {
      p = rawParams[i];
      if (!p) continue;
      eq = p.indexOf('=');
      if (eq === -1) {
        key = p.toUpperCase();
        if (key === 'PREF' || key === 'CELL' || key === 'HOME' || key === 'WORK' ||
            key === 'VOICE' || key === 'FAX' || key === 'INTERNET' || key === 'MAIN') {
          types.push(key.toLowerCase());
        } else {
          params[key] = true;
        }
      } else {
        key = p.slice(0, eq).toUpperCase();
        val = p.slice(eq + 1);
        if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
          val = val.slice(1, -1);
        }
        if (key === 'TYPE') {
          parts = val.split(',');
          for (j = 0; j < parts.length; j++) {
            if (trim(parts[j])) types.push(trim(parts[j]).toLowerCase());
          }
        } else {
          params[key] = val;
        }
      }
    }
    params._types = types;
    return params;
  }

  function isBinaryProp(name) {
    return name === 'PHOTO' || name === 'LOGO' || name === 'SOUND' || name === 'KEY' || name === 'AGENT';
  }

  function emptyPerson() {
    return {
      name: '', first: '', last: '', org: '', title: '',
      phones: [], emails: [], note: '', state: '', city: ''
    };
  }

  function parseVCards(text) {
    var raw = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var lines = raw.split(/\r\n|\n|\r/);
    var unfolded = [], i, line;
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (!line && !unfolded.length) continue;
      if (line.charAt(0) === ' ' || line.charAt(0) === '\t') {
        if (unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
      } else {
        unfolded.push(line);
      }
    }

    var people = [];
    var person = null;
    var labels = {};
    var phoneGroups = [];

    function finishPerson() {
      if (!person) return;
      var g, lbl, pi;
      for (g = 0; g < phoneGroups.length; g++) {
        lbl = labels[phoneGroups[g].group];
        if (lbl) phoneGroups[g].type = lbl;
      }
      for (pi = 0; pi < phoneGroups.length; pi++) {
        person.phones.push({ number: phoneGroups[pi].number, type: phoneGroups[pi].type || '' });
      }
      if (person._company) {
        if (person.org) person.name = person.org;
      }
      if (!person.name) {
        if (person._fn) person.name = person._fn;
        else if (person.first || person.last) person.name = trim(person.first + ' ' + person.last);
        else if (person.org) person.name = person.org;
        else if (person.emails.length) person.name = person.emails[0];
        else if (person.phones.length) person.name = person.phones[0].number;
      }
      var hasContact = person.name || person.org || person.phones.length || person.emails.length;
      if (hasContact && (person.name || person.org || person.phones.length || person.emails.length)) {
        delete person._fn;
        delete person._company;
        people.push(person);
      }
      person = null;
      labels = {};
      phoneGroups = [];
    }

    for (i = 0; i < unfolded.length; i++) {
      line = unfolded[i];
      if (!trim(line)) continue;
      var upper = line.toUpperCase();
      if (upper === 'BEGIN:VCARD') {
        finishPerson();
        person = emptyPerson();
        person._fn = '';
        person._company = false;
        labels = {};
        phoneGroups = [];
        continue;
      }
      if (upper === 'END:VCARD') {
        finishPerson();
        continue;
      }
      if (!person) continue;

      try {
        var colon = -1, inQ = false, ci, ch;
        for (ci = 0; ci < line.length; ci++) {
          ch = line.charAt(ci);
          if (ch === '"') inQ = !inQ;
          else if (ch === ':' && !inQ) { colon = ci; break; }
        }
        if (colon < 0) continue;

        var left = line.slice(0, colon);
        var value = line.slice(colon + 1);
        var leftParts = splitUnescaped(left, ';');
        var namePart = leftParts[0] || '';
        var group = '';
        var dot = namePart.indexOf('.');
        if (dot > 0) {
          group = namePart.slice(0, dot);
          namePart = namePart.slice(dot + 1);
        }
        var propName = namePart.toUpperCase();
        var params = parseParams(leftParts.slice(1));

        if (isBinaryProp(propName)) continue;

        var enc = String(params.ENCODING || params.encoding || '').toUpperCase();
        if (enc === 'QUOTED-PRINTABLE' || enc === 'QP') {
          while (value.length && value.charAt(value.length - 1) === '=' && i + 1 < unfolded.length) {
            value = value.slice(0, -1) + unfolded[++i];
          }
          value = decodeQuotedPrintable(value);
        }

        value = unescapeVCard(value);

        if (propName === 'FN') {
          person._fn = trim(value);
        } else if (propName === 'N') {
          var np = splitUnescaped(value, ';');
          person.last = trim(unescapeVCard(np[0] || ''));
          person.first = trim(unescapeVCard(np[1] || ''));
        } else if (propName === 'ORG') {
          var op = splitUnescaped(value, ';');
          person.org = trim(unescapeVCard(op[0] || ''));
        } else if (propName === 'TITLE') {
          person.title = trim(value);
        } else if (propName === 'EMAIL') {
          var em = trim(value);
          if (em && person.emails.indexOf(em) === -1) person.emails.push(em);
        } else if (propName === 'NOTE') {
          person.note = person.note ? person.note + '\n' + value : value;
        } else if (propName === 'ADR') {
          var ap = splitUnescaped(value, ';');
          person.city = trim(unescapeVCard(ap[3] || ''));
          person.state = stateCode(unescapeVCard(ap[4] || ''));
        } else if (propName === 'TEL') {
          var tel = trim(value);
          if (/^tel:/i.test(tel)) tel = tel.replace(/^tel:/i, '');
          tel = normPhone(tel);
          var typ = '';
          if (params._types && params._types.length) {
            var ti, prefer = '';
            for (ti = 0; ti < params._types.length; ti++) {
              if (params._types[ti] !== 'voice' && params._types[ti] !== 'pref') {
                prefer = params._types[ti];
                break;
              }
            }
            typ = prefer || '';
            if (typ) typ = typ.charAt(0).toUpperCase() + typ.slice(1);
          }
          phoneGroups.push({ number: tel, type: typ, group: group });
        } else if (propName === 'X-ABLABEL') {
          labels[group] = stripAppleLabel(value);
        } else if (propName === 'X-ABSHOWAS') {
          if (trim(value).toUpperCase() === 'COMPANY') person._company = true;
        }
      } catch (err) {
        /* skip bad line */
      }
    }
    finishPerson();
    return people;
  }

  function parseCsv(text, delim) {
    var rows = [], row = [], field = '', i = 0, c, inQ = false;
    var s = String(text);
    while (i < s.length) {
      c = s.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false;
          i++;
          continue;
        }
        field += c;
        i++;
      } else {
        if (c === '"') { inQ = true; i++; }
        else if (c === delim) { row.push(trim(field)); field = ''; i++; }
        else if (c === '\r') {
          row.push(trim(field)); field = '';
          rows.push(row); row = [];
          if (s.charAt(i + 1) === '\n') i += 2; else i++;
        } else if (c === '\n') {
          row.push(trim(field)); field = '';
          rows.push(row); row = [];
          i++;
        } else {
          field += c;
          i++;
        }
      }
    }
    if (field.length || row.length) {
      row.push(trim(field));
      rows.push(row);
    }
    return rows;
  }

  function looksLikeHeader(cells) {
    var i, cell, hasLetterOnly = false;
    for (i = 0; i < cells.length; i++) {
      cell = trim(cells[i]);
      if (!cell) continue;
      if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(cell)) return false;
      if (digits(cell).length >= 7) return false;
      if (/^[A-Za-z][A-Za-z\s\/&#\-]*$/.test(cell)) hasLetterOnly = true;
    }
    return hasLetterOnly;
  }

  function parseTable(text) {
    var s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var probeLines = s.split(/\r\n|\n|\r/);
    var firstNonEmpty = '';
    var li;
    for (li = 0; li < probeLines.length; li++) {
      if (trim(probeLines[li])) { firstNonEmpty = probeLines[li]; break; }
    }
    var delim = detectDelimiter(firstNonEmpty);
    var all = parseCsv(s, delim);
    var rows = [];
    for (li = 0; li < all.length; li++) {
      var r = all[li];
      var empty = true, ci;
      for (ci = 0; ci < r.length; ci++) {
        if (trim(r[ci])) { empty = false; break; }
      }
      if (!empty) rows.push(r);
    }
    if (!rows.length) return { headers: [], rows: [] };

    var headers, data;
    if (looksLikeHeader(rows[0])) {
      headers = rows[0].slice();
      data = rows.slice(1);
    } else {
      headers = [];
      for (li = 0; li < rows[0].length; li++) headers.push('Column ' + (li + 1));
      data = rows.slice();
    }

    var width = headers.length;
    for (li = 0; li < data.length; li++) {
      while (data[li].length < width) data[li].push('');
      if (data[li].length > width) data[li] = data[li].slice(0, width);
    }
    return { headers: headers, rows: data };
  }

  function normHeader(h) {
    return trim(String(h || ''))
      .toLowerCase()
      .replace(/[_\.\/\|]+/g, ' ')
      .replace(/[^a-z0-9\s\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function matchSynonym(norm, synonyms) {
    var i, syn;
    for (i = 0; i < synonyms.length; i++) {
      if (norm === synonyms[i]) return 2;
    }
    for (i = 0; i < synonyms.length; i++) {
      syn = synonyms[i];
      /* phrase contains only: short tokens like "name" must be exact */
      if (syn.indexOf(' ') === -1) continue;
      if (norm.indexOf(syn) !== -1) return 1;
    }
    return 0;
  }

  function bestCol(headers, synonyms, used) {
    var best = -1, bestScore = 0, i, n, sc;
    for (i = 0; i < headers.length; i++) {
      if (used[i]) continue;
      n = normHeader(headers[i]);
      sc = matchSynonym(n, synonyms);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best >= 0) used[best] = true;
    return best;
  }

  function isPhoneLabelHeader(n) {
    return /phone\s*\d*\s*-?\s*label/.test(n) || /\bfax\b/.test(n) || /label$/.test(n) && /phone|e-?mail|email/.test(n);
  }

  function isPhoneValueHeader(n) {
    if (isPhoneLabelHeader(n)) return false;
    if (/\bfax\b/.test(n)) return false;
    var syns = [
      'phone 1 - value', 'phone 2 - value', 'phone 3 - value',
      'phone 1 value', 'phone 2 value', 'phone 3 value',
      'mobile phone', 'cell phone', 'work phone', 'business phone',
      'primary phone', 'home phone', 'other phone', 'phone number',
      'telephone', 'mobile', 'cell', 'phone', 'tel', 'number'
    ];
    return matchSynonym(n, syns) > 0;
  }

  function guessMap(headers, rows) {
    var used = {};
    var map = {
      company: -1, name: -1, first: -1, last: -1,
      phone: -1, phone2: -1, phone3: -1, email: -1, title: -1, state: -1, notes: -1,
      merchant: -1, owner: -1, shop: -1, amount: -1, stage: -1, date: -1,
      industry: -1, revenue: -1, fico: -1
    };

    var merchantSyn = ['merchant name', 'merchant', 'dba', 'legal name', 'business name', 'client'];
    var amountSyn = [
      'amount requested', 'request amount', 'funding amount', 'advance amount',
      'funded amount', 'purchase price', 'loan amount', 'requested', 'amount'
    ];
    var stageSyn = ['deal status', 'deal stage', 'status', 'stage'];

    var merchantCol = bestCol(headers, merchantSyn, {});
    /* also allow company name / business as merchant candidates later for deals */
    var amountCol = bestCol(headers, amountSyn, {});
    var stageCol = bestCol(headers, stageSyn, {});

    var kind = 'contacts';
    if (merchantCol >= 0 && (amountCol >= 0 || stageCol >= 0)) kind = 'deals';
    if (merchantCol < 0 && kind === 'contacts') {
      /* check company-name style headers that only count as merchant in deals context:
         if we have amount/stage and a business/company name column, treat as deals */
      var bizProbe = bestCol(headers, ['business name', 'company name', 'business', 'company'], {});
      if (bizProbe >= 0 && (amountCol >= 0 || stageCol >= 0)) {
        kind = 'deals';
        merchantCol = bizProbe;
      }
    }

    used = {};
    if (kind === 'deals') {
      map.merchant = bestCol(headers, merchantSyn.concat(['business name', 'company name', 'business']), used);
      map.owner = bestCol(headers, ['owner name', 'merchant owner', 'owner', 'principal', 'guarantor'], used);
      map.shop = bestCol(headers, [
        'iso name', 'broker name', 'submitted by', 'referred by', 'iso', 'broker', 'shop', 'partner', 'agent'
      ], used);
      map.amount = bestCol(headers, amountSyn, used);
      map.stage = bestCol(headers, stageSyn, used);
      map.date = bestCol(headers, [
        'date submitted', 'submission date', 'funded date', 'date funded', 'created date',
        'submitted', 'created', 'date'
      ], used);
      map.industry = bestCol(headers, ['type of business', 'business type', 'industry', 'sic'], used);
      map.state = bestCol(headers, ['merchant state', 'business state', 'state', 'st', 'region', 'province'], used);
      map.revenue = bestCol(headers, [
        'avg monthly revenue', 'average monthly revenue', 'monthly revenue', 'gross monthly sales',
        'monthly deposits', 'monthly sales', 'revenue'
      ], used);
      map.fico = bestCol(headers, ['fico score', 'credit score', 'fico', 'credit'], used);
      map.phone = -1;
      map.email = -1;
      /* still map phone/email if present for deal contact info */
      var dUsed = {};
      Object.keys(used).forEach(function (k) { if (used[k]) dUsed[k] = true; });
      var phoneCols = [];
      var hi, hn;
      for (hi = 0; hi < headers.length; hi++) {
        if (dUsed[hi]) continue;
        hn = normHeader(headers[hi]);
        if (isPhoneValueHeader(hn)) phoneCols.push(hi);
      }
      if (phoneCols[0] != null) { map.phone = phoneCols[0]; dUsed[phoneCols[0]] = true; }
      map.email = bestCol(headers, [
        'e-mail 1 - value', 'email 1 - value', 'e-mail address', 'email address',
        'primary email', 'work email', 'e-mail', 'email'
      ], dUsed);
      map.company = -1;
      map.name = -1;
      map.first = -1;
      map.last = -1;
      map.phone2 = -1;
      map.phone3 = -1;
      map.title = -1;
      map.notes = -1;
    } else {
      map.company = bestCol(headers, [
        'organization name', 'company name', 'iso name', 'broker name', 'shop name',
        'organization', 'company', 'org', 'iso', 'broker', 'brokerage', 'shop',
        'agency', 'partner', 'business'
      ], used);
      map.name = bestCol(headers, [
        'full name', 'display name', 'contact name', 'sales rep', 'contact', 'name', 'rep'
      ], used);
      map.first = bestCol(headers, ['first name', 'given name', 'first'], used);
      map.last = bestCol(headers, ['last name', 'family name', 'surname', 'last'], used);
      var pcols = [];
      for (hi = 0; hi < headers.length; hi++) {
        if (used[hi]) continue;
        hn = normHeader(headers[hi]);
        if (isPhoneValueHeader(hn)) pcols.push(hi);
      }
      if (pcols[0] != null) { map.phone = pcols[0]; used[pcols[0]] = true; }
      if (pcols[1] != null) { map.phone2 = pcols[1]; used[pcols[1]] = true; }
      if (pcols[2] != null) { map.phone3 = pcols[2]; used[pcols[2]] = true; }
      map.email = bestCol(headers, [
        'e-mail 1 - value', 'email 1 - value', 'e-mail address', 'email address',
        'primary email', 'work email', 'e-mail', 'email'
      ], used);
      map.title = bestCol(headers, ['organization title', 'job title', 'title', 'role', 'position'], used);
      map.state = bestCol(headers, ['business state', 'merchant state', 'state', 'st', 'region', 'province'], used);
      map.notes = bestCol(headers, ['notes', 'note', 'comments', 'comment', 'description'], used);
    }

    return { kind: kind, map: map };
  }

  function cellAt(row, idx) {
    if (idx == null || idx < 0) return '';
    return trim(row[idx] == null ? '' : row[idx]);
  }

  function peopleFromTable(table, map) {
    var m = map.map || map;
    var people = [];
    var rows = table.rows || [];
    var ri, row, p, name, phones, seen, addPhone, vals, vi, num, dig;
    for (ri = 0; ri < rows.length; ri++) {
      row = rows[ri];
      p = emptyPerson();
      p.first = cellAt(row, m.first);
      p.last = cellAt(row, m.last);
      p.org = cellAt(row, m.company);
      p.title = cellAt(row, m.title);
      p.note = cellAt(row, m.notes);
      p.state = stateCode(cellAt(row, m.state));
      name = cellAt(row, m.name);
      if (!name) name = trim(p.first + ' ' + p.last);
      p.name = name;
      var em = cellAt(row, m.email);
      if (em) p.emails.push(em);
      phones = [];
      seen = {};
      addPhone = function (idx) {
        num = cellAt(row, idx);
        if (!num) return;
        dig = digits(num);
        if (dig && seen[dig]) return;
        if (dig) seen[dig] = true;
        phones.push({ number: normPhone(num), type: '' });
      };
      addPhone(m.phone);
      addPhone(m.phone2);
      addPhone(m.phone3);
      p.phones = phones;
      if (!p.name && !p.org && !p.phones.length && !p.emails.length) continue;
      people.push(p);
    }
    return people;
  }

  function normalizeStage(text) {
    var s = String(text || '').toLowerCase();
    // Lost and declined first, so "lost, funded elsewhere" is not counted as funded.
    if (/declin|reject|dead|lost|cancel|withdr|kill|elsewhere|unfunded|not funded|no longer/.test(s)) return 'closed';
    if (/pending fund|ready to fund|to be funded|funding call/.test(s)) return 'contracts';
    if (/\bfunded\b|\bpaid\b|renew|\bfunding\b/.test(s)) return 'funded';
    if (/contract|sign|closing|docs out/.test(s)) return 'contracts';
    if (/approv|offer/.test(s)) return 'approved';
    if (/underwrit|review|pending|process|in uw|\buw\b/.test(s)) return 'underwriting';
    return 'submitted';
  }

  function dealsFromTable(table, map) {
    var m = map.map || map;
    var deals = [];
    var rows = table.rows || [];
    var ri, row, merchant, stageText, amount, revenue, fico;
    for (ri = 0; ri < rows.length; ri++) {
      row = rows[ri];
      merchant = cellAt(row, m.merchant);
      if (!merchant) continue;
      stageText = cellAt(row, m.stage);
      amount = parseMoney(cellAt(row, m.amount));
      revenue = parseMoney(cellAt(row, m.revenue));
      fico = Math.round(parseMoney(cellAt(row, m.fico))) || 0;
      deals.push({
        merchant: merchant,
        owner: cellAt(row, m.owner),
        shop: cellAt(row, m.shop),
        amount: amount,
        stage: normalizeStage(stageText),
        stageText: stageText,
        date: parseDate(cellAt(row, m.date)),
        industry: cellAt(row, m.industry),
        state: stateCode(cellAt(row, m.state)),
        revenue: revenue,
        fico: fico,
        phone: normPhone(cellAt(row, m.phone)),
        email: cellAt(row, m.email)
      });
    }
    return deals;
  }

  var DROP_WORDS = {
    llc: 1, inc: 1, corp: 1, corporation: 1, co: 1, ltd: 1, the: 1, group: 1, company: 1
  };

  function normOrgKey(org) {
    var s = String(org || '').toLowerCase().replace(/&/g, ' and ');
    s = s.replace(/[^a-z0-9\s]/g, ' ');
    var parts = s.split(/\s+/), keep = [], i, w;
    for (i = 0; i < parts.length; i++) {
      w = parts[i];
      if (!w || DROP_WORDS[w]) continue;
      keep.push(w);
    }
    return keep.join('').replace(/\s+/g, '');
  }

  function personMergeKey(p) {
    var keys = [], i, d, e;
    for (i = 0; i < (p.phones || []).length; i++) {
      d = digits(p.phones[i].number);
      if (d) keys.push('p:' + d);
    }
    for (i = 0; i < (p.emails || []).length; i++) {
      e = trim(p.emails[i]).toLowerCase();
      if (e) keys.push('e:' + e);
    }
    if (p.name) keys.push('n:' + trim(p.name).toLowerCase());
    return keys;
  }

  function mergePerson(a, b) {
    var i, j, d, found, em;
    if (!a.name && b.name) a.name = b.name;
    if (!a.first && b.first) a.first = b.first;
    if (!a.last && b.last) a.last = b.last;
    if (!a.org && b.org) a.org = b.org;
    if (!a.title && b.title) a.title = b.title;
    if (!a.note && b.note) a.note = b.note;
    if (!a.state && b.state) a.state = b.state;
    if (!a.city && b.city) a.city = b.city;
    for (i = 0; i < (b.phones || []).length; i++) {
      d = digits(b.phones[i].number);
      found = false;
      for (j = 0; j < a.phones.length; j++) {
        if (digits(a.phones[j].number) === d && d) { found = true; break; }
      }
      if (!found && b.phones[i].number) a.phones.push(b.phones[i]);
    }
    for (i = 0; i < (b.emails || []).length; i++) {
      em = trim(b.emails[i]).toLowerCase();
      found = false;
      for (j = 0; j < a.emails.length; j++) {
        if (trim(a.emails[j]).toLowerCase() === em) { found = true; break; }
      }
      if (!found && b.emails[i]) a.emails.push(b.emails[i]);
    }
    return a;
  }

  function groupPeople(people) {
    var groups = {}, order = [], loose = [], i, p, key, g, spell, bestSpell, bestCount, sk, li;
    for (i = 0; i < people.length; i++) {
      p = people[i];
      if (!trim(p.org)) {
        loose.push(p);
        continue;
      }
      key = normOrgKey(p.org);
      if (!key) {
        loose.push(p);
        continue;
      }
      if (!groups[key]) {
        groups[key] = { key: key, spells: {}, spellOrder: [], list: [] };
        order.push(key);
      }
      g = groups[key];
      spell = trim(p.org);
      if (!g.spells[spell]) g.spellOrder.push(spell);
      g.spells[spell] = (g.spells[spell] || 0) + 1;
      g.list.push(p);
    }

    var companies = [];
    for (i = 0; i < order.length; i++) {
      g = groups[order[i]];
      bestSpell = g.spellOrder[0] || '';
      bestCount = -1;
      for (li = 0; li < g.spellOrder.length; li++) {
        sk = g.spellOrder[li];
        if (g.spells[sk] > bestCount) {
          bestCount = g.spells[sk];
          bestSpell = sk;
        }
      }

      var merged = [];
      var indexByKey = {};
      for (li = 0; li < g.list.length; li++) {
        p = g.list[li];
        var pkeys = personMergeKey(p);
        var matchIdx = -1, ki, pk;
        for (ki = 0; ki < pkeys.length; ki++) {
          pk = pkeys[ki];
          if (indexByKey[pk] != null) { matchIdx = indexByKey[pk]; break; }
        }
        if (matchIdx >= 0) {
          mergePerson(merged[matchIdx], p);
          for (ki = 0; ki < pkeys.length; ki++) indexByKey[pkeys[ki]] = matchIdx;
        } else {
          matchIdx = merged.length;
          merged.push({
            name: p.name, first: p.first, last: p.last, org: p.org, title: p.title,
            phones: (p.phones || []).slice(), emails: (p.emails || []).slice(),
            note: p.note, state: p.state, city: p.city
          });
          for (ki = 0; ki < pkeys.length; ki++) indexByKey[pkeys[ki]] = matchIdx;
        }
      }
      companies.push({ key: g.key, name: bestSpell, people: merged });
    }

    companies.sort(function (a, b) {
      var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    return { companies: companies, loose: loose };
  }

  var api = {
    sniff: sniff,
    parseVCards: parseVCards,
    parseTable: parseTable,
    guessMap: guessMap,
    peopleFromTable: peopleFromTable,
    dealsFromTable: dealsFromTable,
    groupPeople: groupPeople,
    normPhone: normPhone,
    digits: digits,
    parseDate: parseDate,
    parseMoney: parseMoney,
    stateCode: stateCode
  };

  root.ISOImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
