// The book in D1: shops, contacts, deals, follow-ups, messages and settings as their own tables.
// The app still sends and receives whole records ({ shops, deals, msgs, meta }); this file splits
// them into rows on the way in and puts them back together on the way out.
//
// Who sees what: a manager sees every book. A rep sees only shops in their own book, the deals
// and people on those shops, and calls and texts on their own line. The same rule decides what
// each person may change. Every accepted change is written to the audit table in the same batch.
import '../public/data.js';
import { validRecord, KINDS } from './server.js';

export const normName = globalThis.AD.normName;
const DAY = 864e5, WEEK = 7 * DAY;
// Each JSON parameter stays well under D1's 2 MB value limit. scripts/migrate-records.mjs lowers it,
// since it writes the values into the SQL text, where D1 allows 100 KB a statement.
export const LIMITS = { param: 900 * 1024 };
const LISTS = ['contacts', 'followUps', 'activity', 'offers', 'templates', 'history', 'blocked'];
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'comcast.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'verizon.net',
  'cox.net', 'charter.net', 'optonline.net', 'earthlink.net', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com']);

export function isManager(me) { return !!me && me.role !== 'rep'; }
// Last ten digits, so +1 (305) 555-0100 and 305.555.0100 match. Short numbers never match anything.
export function phoneKey(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
// The company part of an email, blank for free mail, which says nothing about where someone works.
export function emailDomain(e) {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})$/.exec(String(e || '').trim().toLowerCase());
  return m && !FREE_MAIL.has(m[1]) ? m[1] : '';
}

const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const IN = (n) => '(SELECT value FROM json_each(?' + n + '))';
const rowsOf = (res) => (res && res.results) || [];
// One statement per slice of rows, each slice's JSON kept under LIMITS.param.
function sliced(rows, make) {
  const out = []; let cur = [], size = 2;
  rows.forEach((r) => {
    const n = JSON.stringify(r).length + 1;
    if (cur.length && size + n > LIMITS.param) { out.push(make(JSON.stringify(cur))); cur = []; size = 2; }
    cur.push(r); size += n;
  });
  if (cur.length) out.push(make(JSON.stringify(cur)));
  return out;
}
function without(rec, keys) { const o = {}; Object.keys(rec).forEach((k) => { if (keys.indexOf(k) < 0) o[k] = rec[k]; }); return o; }
// '{"a":1}' plus head fields, without parsing the stored JSON again.
function joinObj(head, data) { return '{' + head + (data && data.length > 2 ? ',' + data.slice(1) : '}'); }

// ---------- reading ----------

// Everything this person may see that changed since `since` (everything when since is 0), as the
// JSON body the app expects. Deleted records come back as { id, deleted: true, updatedAt }, as they
// always have. On a catch-up read, rows that changed but are not theirs to see come back as
// deletions too, so a shop handed to someone else drops off the old owner's devices.
export async function readBook(env, me, since) {
  const ws = me.ws, mine = !isManager(me), from = since ? since - 5000 : -1, catchUp = since > 0;
  const [shopsR, dealsR, msgsR, setR] = await env.DB.batch([
    q(env, 'SELECT id, rep_id, updated_at, deleted, data FROM shops WHERE ws = ?1 AND server_at > ?2', ws, from),
    q(env, 'SELECT d.id, d.updated_at, d.deleted, d.data, s.rep_id FROM deals d LEFT JOIN shops s ON s.ws = d.ws AND s.id = d.shop_id WHERE d.ws = ?1 AND d.server_at > ?2', ws, from),
    q(env, 'SELECT id, rep_id, updated_at, deleted, data FROM messages WHERE ws = ?1 AND server_at > ?2', ws, from),
    q(env, 'SELECT updated_at, data FROM settings WHERE ws = ?1 AND member = ?2 AND server_at > ?3', ws, me.member, from)
  ]);
  const sees = (rep) => !mine || rep === me.member;
  const out = { shops: [], deals: [], msgs: [], meta: [] }, liveShops = [], liveDeals = [];
  const gone = (id, u) => JSON.stringify(id) + ':' + JSON.stringify({ id, deleted: true, updatedAt: u });
  rowsOf(shopsR).forEach((r) => {
    if (r.deleted || !sees(r.rep_id)) { if (r.deleted || catchUp) out.shops.push(gone(r.id, r.updated_at)); return; }
    liveShops.push(r);
  });
  rowsOf(dealsR).forEach((r) => {
    if (r.deleted || !sees(r.rep_id)) { if (r.deleted || catchUp) out.deals.push(gone(r.id, r.updated_at)); return; }
    liveDeals.push(r);
  });
  rowsOf(msgsR).forEach((r) => {
    if (r.deleted || !sees(r.rep_id)) { if (r.deleted || catchUp) out.msgs.push(gone(r.id, r.updated_at)); return; }
    out.msgs.push(JSON.stringify(r.id) + ':' + r.data);
  });
  rowsOf(setR).forEach((r) => { out.meta.push('"settings":' + r.data); });

  const kids = { contacts: {}, shops: {}, deals: {} };
  if (liveShops.length || liveDeals.length) {
    const sIds = JSON.stringify(liveShops.map((r) => r.id)), dIds = JSON.stringify(liveDeals.map((r) => r.id));
    const [cR, fR] = await env.DB.batch([
      q(env, 'SELECT shop_id, data FROM contacts WHERE ws = ?1 AND shop_id IN ' + IN(2) + ' ORDER BY pos', ws, sIds),
      q(env, "SELECT parent_kind, parent_id, data FROM follow_ups WHERE ws = ?1 AND ((parent_kind = 'shops' AND parent_id IN " + IN(2) + ") OR (parent_kind = 'deals' AND parent_id IN " + IN(3) + ')) ORDER BY pos', ws, sIds, dIds)
    ]);
    rowsOf(cR).forEach((r) => { (kids.contacts[r.shop_id] = kids.contacts[r.shop_id] || []).push(r.data); });
    rowsOf(fR).forEach((r) => { const m = kids[r.parent_kind]; (m[r.parent_id] = m[r.parent_id] || []).push(r.data); });
  }
  liveShops.forEach((r) => {
    const head = '"id":' + JSON.stringify(r.id) + ',"repId":' + JSON.stringify(r.rep_id || null) + ',"updatedAt":' + r.updated_at +
      ',"contacts":[' + (kids.contacts[r.id] || []).join(',') + '],"followUps":[' + (kids.shops[r.id] || []).join(',') + ']';
    out.shops.push(JSON.stringify(r.id) + ':' + joinObj(head, r.data));
  });
  liveDeals.forEach((r) => {
    const head = '"id":' + JSON.stringify(r.id) + ',"updatedAt":' + r.updated_at + ',"followUps":[' + (kids.deals[r.id] || []).join(',') + ']';
    out.deals.push(JSON.stringify(r.id) + ':' + joinObj(head, r.data));
  });
  return '{"now":' + Date.now() + ',' + KINDS.map((k) => JSON.stringify(k) + ':{' + out[k].join(',') + '}').join(',') + '}';
}

// ---------- writing ----------

// One shop as it is stored now, put back together, for the audit diff.
function fullShop(row, contacts, fus) {
  const r = JSON.parse(row.data); r.id = row.id; r.repId = row.rep_id || null; r.updatedAt = row.updated_at;
  r.contacts = (contacts || []).map((x) => JSON.parse(x)); r.followUps = (fus || []).map((x) => JSON.parse(x)); return r;
}
function fullDeal(row, fus) { const r = JSON.parse(row.data); r.id = row.id; r.updatedAt = row.updated_at; r.followUps = (fus || []).map((x) => JSON.parse(x)); return r; }

// Calls and texts that arrive from the phone line, for the rep whose line it is: line = { ws, member }.
// A message id already stored is left as it is, since carriers retry webhooks and the rep may have
// read the text by then. Goes through saveBook, so it lands in the change log as 'Phone line'.
export function saveMessages(env, line, recs) {
  return saveBook(env, { id: null, ws: line.ws, member: line.member, name: 'Phone line', role: 'rep' }, { msgs: recs }, { insertOnly: true });
}

// Saves records for one person. `me` is { id, ws, member, name, role }. Returns what was written,
// what was refused as malformed, what was refused because it is not in this person's book, and
// `stamped`: records whose time was pulled back to the server's (see below), with the time kept.
// opts.insertOnly keeps any record whose id is already stored; opts.skipSame also skips an equally new copy.
export async function saveBook(env, me, body, opts = {}) {
  const ws = me.ws, mgr = isManager(me), now = Date.now();
  const inc = {}, rejected = [], denied = [], stamped = [];
  KINDS.forEach((k) => {
    inc[k] = [];
    (Array.isArray(body[k]) ? body[k] : []).forEach((rec) => {
      if (!validRecord(k, rec)) { rejected.push({ kind: k, id: rec && typeof rec.id === 'string' ? rec.id.slice(0, 80) : null }); return; }
      // The newest edit wins by the editing device's clock, so offline edits keep their place. A device
      // whose clock runs ahead would make everyone's later edits look older and lose, so no edit is
      // ever dated after the moment it reaches the server.
      if (rec.updatedAt > now) { rec.updatedAt = now; stamped.push({ kind: k, id: rec.id, updatedAt: now }); }
      inc[k].push(rec);
    });
  });
  const total = KINDS.reduce((t, k) => t + inc[k].length, 0);
  if (!total) return { written: 0, rejected, denied, stamped, now };

  const ids = (k) => JSON.stringify(inc[k].map((r) => r.id));
  const dealShopIds = JSON.stringify(inc.deals.filter((r) => !r.deleted).map((r) => r.shopId));
  const [dealR, shopR, msgR, setR, conR, fuR, teamR] = await env.DB.batch([
    q(env, 'SELECT id, shop_id, updated_at, deleted, data FROM deals WHERE ws = ?1 AND id IN ' + IN(2), ws, ids('deals')),
    q(env, 'SELECT id, rep_id, updated_at, deleted, data FROM shops WHERE ws = ?1 AND (id IN ' + IN(2) + ' OR id IN ' + IN(3) +
      ' OR id IN (SELECT shop_id FROM deals WHERE ws = ?1 AND id IN ' + IN(4) + '))', ws, ids('shops'), dealShopIds, ids('deals')),
    q(env, 'SELECT id, rep_id, updated_at, deleted, data FROM messages WHERE ws = ?1 AND id IN ' + IN(2), ws, ids('msgs')),
    q(env, 'SELECT updated_at, data FROM settings WHERE ws = ?1 AND member = ?2', ws, me.member),
    q(env, 'SELECT shop_id, data FROM contacts WHERE ws = ?1 AND shop_id IN ' + IN(2) + ' ORDER BY pos', ws, ids('shops')),
    q(env, "SELECT parent_kind, parent_id, data FROM follow_ups WHERE ws = ?1 AND ((parent_kind = 'shops' AND parent_id IN " + IN(2) + ") OR (parent_kind = 'deals' AND parent_id IN " + IN(3) + ')) ORDER BY pos', ws, ids('shops'), ids('deals')),
    q(env, 'SELECT member FROM users WHERE ws = ?1', ws)
  ]);
  const by = (res) => { const o = {}; rowsOf(res).forEach((r) => { o[r.id] = r; }); return o; };
  const oldDeals = by(dealR), oldShops = by(shopR), oldMsgs = by(msgR), oldSet = rowsOf(setR)[0] || null;
  const members = new Set(rowsOf(teamR).map((r) => r.member));
  const oldCon = {}, oldFu = { shops: {}, deals: {} };
  rowsOf(conR).forEach((r) => { (oldCon[r.shop_id] = oldCon[r.shop_id] || []).push(r.data); });
  rowsOf(fuR).forEach((r) => { (oldFu[r.parent_kind][r.parent_id] = oldFu[r.parent_kind][r.parent_id] || []).push(r.data); });
  const live = (row) => (row && !row.deleted ? row : null);
  const stale = (row, rec) => row && (opts.insertOnly || rec.updatedAt < row.updated_at || (opts.skipSame && rec.updatedAt === row.updated_at));
  const deny = (kind, rec, why) => { denied.push({ kind, id: rec.id, why }); rejected.push({ kind, id: rec.id }); };

  // Shops first: a deal may land on a shop created in this same save.
  const shopRepAfter = {}, audit = [], shopRows = [], conRows = [], fuRows = [], fuParents = { shops: [], deals: [] }, movedShops = [], alertRecs = [];
  Object.keys(oldShops).forEach((id) => { if (!oldShops[id].deleted) shopRepAfter[id] = oldShops[id].rep_id || null; });
  inc.shops.forEach((rec) => {
    // Whose it is comes from the stored row even when that row is a deletion, so a rep can never
    // write over, or bring back, a shop that was someone else's.
    const stored = oldShops[rec.id], old = live(stored), oldRep = old ? old.rep_id || null : null;
    if (stale(stored, rec)) return;
    if (!mgr && stored && (stored.rep_id || null) !== me.member) return deny('shops', rec, 'not-yours');
    if (rec.deleted) {
      if (!old) return;
      shopRows.push({ id: rec.id, rep: oldRep, name: '', norm: '', st: '', u: rec.updatedAt, del: 1, d: '{}' });
      fuParents.shops.push(rec.id); delete shopRepAfter[rec.id];
      audit.push(entry(me, now, 'delete', 'shops', rec.id, JSON.parse(old.data).name || 'Shop', []));
      return;
    }
    const rep = rec.repId === undefined || rec.repId === null || rec.repId === '' ? null : String(rec.repId);
    if (rep !== null && !members.has(rep)) return deny('shops', rec, 'unknown-person');
    if (!mgr && !old && rep !== me.member) return deny('shops', rec, 'not-yours');
    shopRepAfter[rec.id] = rep;
    if (old && oldRep !== rep) movedShops.push(rec.id);
    const name = String(rec.name || '').slice(0, 200);
    shopRows.push({ id: rec.id, rep, name, norm: normName(name), st: String(rec.state || '').slice(0, 2), u: rec.updatedAt, del: 0,
      d: JSON.stringify(without(rec, ['id', 'repId', 'updatedAt', 'contacts', 'followUps'])) });
    (rec.contacts || []).forEach((c, i) => conRows.push({ s: rec.id, i: c.id, p: i, n: String(c.name || '').slice(0, 120), r: String(c.role || '').slice(0, 40),
      k1: phoneKey(c.phone), k2: phoneKey(c.phone2), e: String(c.email || '').slice(0, 160).toLowerCase(), dm: emailDomain(c.email), d: JSON.stringify(c) }));
    pushFus(fuRows, 'shops', rec);
    fuParents.shops.push(rec.id);
    alertRecs.push({ kind: 'shops', rec, owner: rep });
    const before = old ? fullShop(old, oldCon[rec.id], oldFu.shops[rec.id]) : null;
    const ch = before ? diff(before, rec) : [];
    if (!before || ch.length) audit.push(entry(me, now, before ? 'update' : 'create', 'shops', rec.id, name, ch));
  });

  const dealRows = [];
  inc.deals.forEach((rec) => {
    const stored = oldDeals[rec.id], old = live(stored);
    if (stale(stored, rec)) return;
    if (!mgr && stored && (oldShops[stored.shop_id] || {}).rep_id !== me.member) return deny('deals', rec, 'not-yours');
    if (rec.deleted) {
      if (!old) return;
      dealRows.push({ id: rec.id, s: old.shop_id, st: '', m: '', mn: '', sa: '', u: rec.updatedAt, del: 1, d: '{}' });
      fuParents.deals.push(rec.id);
      audit.push(entry(me, now, 'delete', 'deals', rec.id, dealName(JSON.parse(old.data)), []));
      return;
    }
    if (!mgr && shopRepAfter[rec.shopId] !== me.member) return deny('deals', rec, 'not-yours');
    const merchant = String((rec.merchant && rec.merchant.business) || '').slice(0, 200);
    dealRows.push({ id: rec.id, s: rec.shopId, st: String(rec.stage || ''), m: merchant, mn: normName(merchant), sa: String(rec.submittedAt || ''), u: rec.updatedAt, del: 0,
      d: JSON.stringify(without(rec, ['id', 'updatedAt', 'followUps'])) });
    pushFus(fuRows, 'deals', rec);
    fuParents.deals.push(rec.id);
    alertRecs.push({ kind: 'deals', rec, owner: shopRepAfter[rec.shopId] || null });
    const before = old ? fullDeal(old, oldFu.deals[rec.id]) : null;
    const ch = before ? diff(before, rec) : [];
    if (!before || ch.length) audit.push(entry(me, now, before ? 'update' : 'create', 'deals', rec.id, merchant, ch));
  });

  const msgRows = [];
  inc.msgs.forEach((rec) => {
    const stored = oldMsgs[rec.id], old = live(stored);
    if (stale(stored, rec)) return;
    if (!mgr && stored && stored.rep_id !== me.member) return deny('msgs', rec, 'not-yours');
    const rep = stored ? stored.rep_id : me.member;
    if (rec.deleted) {
      if (!old) return;
      msgRows.push({ id: rec.id, rep, k: '', dir: '', kd: '', at: '', u: rec.updatedAt, del: 1, d: JSON.stringify({ id: rec.id, deleted: true, updatedAt: rec.updatedAt }) });
      audit.push(entry(me, now, 'delete', 'msgs', rec.id, msgName(JSON.parse(old.data)), []));
      return;
    }
    msgRows.push({ id: rec.id, rep, k: phoneKey(rec.phone), dir: rec.dir === 'out' ? 'out' : 'in', kd: rec.kind === 'call' ? 'call' : 'text', at: String(rec.at || ''), u: rec.updatedAt, del: 0, d: JSON.stringify(rec) });
    const ch = old ? diff(JSON.parse(old.data), rec) : [];
    if (!old || ch.length) audit.push(entry(me, now, old ? 'update' : 'create', 'msgs', rec.id, msgName(rec), ch));
  });

  let setRow = null;
  inc.meta.forEach((rec) => {
    if (rec.deleted || (oldSet && stale({ updated_at: oldSet.updated_at }, rec))) return;
    setRow = rec;
    const ch = oldSet ? diff(JSON.parse(oldSet.data), rec) : [];
    if (!oldSet || ch.length) audit.push(entry(me, now, oldSet ? 'update' : 'create', 'meta', 'settings', 'Settings', ch));
  });

  // Follow-up alerts for the shops and deals that changed, sent to whoever the follow-up is for.
  const open = [];
  alertRecs.forEach((x) => {
    const title = x.kind === 'shops' ? x.rec.name : x.rec.merchant && x.rec.merchant.business;
    (x.rec.followUps || []).slice(0, 60).forEach((f) => {
      if (f.doneAt || typeof f.at !== 'number' || !isFinite(f.at) || f.at < now - WEEK) return;
      const who = f.by && members.has(f.by) ? f.by : x.owner;
      open.push({ f: f.id, k: x.kind, r: x.rec.id, at: Math.round(f.at), t: String(title || 'Follow-up').slice(0, 120), b: String(f.note || 'Follow up').slice(0, 200), m: who || null });
    });
  });
  const touched = fuParents.shops.concat(fuParents.deals);

  const st = [];
  st.push(...sliced(shopRows, (j) => q(env,
    "INSERT INTO shops (ws, id, rep_id, name, norm_name, state, updated_at, server_at, deleted, data) SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.rep'), json_extract(value, '$.name'), json_extract(value, '$.norm'), json_extract(value, '$.st'), json_extract(value, '$.u'), ?2, json_extract(value, '$.del'), json_extract(value, '$.d') FROM json_each(?3) WHERE true " +
    'ON CONFLICT(ws, id) DO UPDATE SET rep_id = excluded.rep_id, name = excluded.name, norm_name = excluded.norm_name, state = excluded.state, updated_at = excluded.updated_at, server_at = excluded.server_at, deleted = excluded.deleted, data = excluded.data WHERE excluded.updated_at >= shops.updated_at',
    ws, now, j)));
  if (fuParents.shops.length) st.push(q(env, 'DELETE FROM contacts WHERE ws = ?1 AND shop_id IN ' + IN(2), ws, JSON.stringify(fuParents.shops)));
  st.push(...sliced(conRows, (j) => q(env,
    "INSERT OR REPLACE INTO contacts (ws, shop_id, id, pos, name, role, phone_key, phone2_key, email, email_domain, data) SELECT ?1, json_extract(value, '$.s'), json_extract(value, '$.i'), json_extract(value, '$.p'), json_extract(value, '$.n'), json_extract(value, '$.r'), json_extract(value, '$.k1'), json_extract(value, '$.k2'), json_extract(value, '$.e'), json_extract(value, '$.dm'), json_extract(value, '$.d') FROM json_each(?2)",
    ws, j)));
  if (movedShops.length) st.push(q(env, 'UPDATE deals SET server_at = ?2 WHERE ws = ?1 AND shop_id IN ' + IN(3), ws, now, JSON.stringify(movedShops)));
  st.push(...sliced(dealRows, (j) => q(env,
    "INSERT INTO deals (ws, id, shop_id, stage, merchant, merchant_norm, submitted_at, updated_at, server_at, deleted, data) SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.s'), json_extract(value, '$.st'), json_extract(value, '$.m'), json_extract(value, '$.mn'), json_extract(value, '$.sa'), json_extract(value, '$.u'), ?2, json_extract(value, '$.del'), json_extract(value, '$.d') FROM json_each(?3) WHERE true " +
    'ON CONFLICT(ws, id) DO UPDATE SET shop_id = excluded.shop_id, stage = excluded.stage, merchant = excluded.merchant, merchant_norm = excluded.merchant_norm, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at, server_at = excluded.server_at, deleted = excluded.deleted, data = excluded.data WHERE excluded.updated_at >= deals.updated_at',
    ws, now, j)));
  if (touched.length) st.push(q(env, "DELETE FROM follow_ups WHERE ws = ?1 AND ((parent_kind = 'shops' AND parent_id IN " + IN(2) + ") OR (parent_kind = 'deals' AND parent_id IN " + IN(3) + '))', ws, JSON.stringify(fuParents.shops), JSON.stringify(fuParents.deals)));
  st.push(...sliced(fuRows, (j) => q(env,
    "INSERT OR REPLACE INTO follow_ups (ws, parent_kind, parent_id, id, pos, by_member, due, time, at, done_at, note, data) SELECT ?1, json_extract(value, '$.pk'), json_extract(value, '$.pi'), json_extract(value, '$.i'), json_extract(value, '$.p'), json_extract(value, '$.by'), json_extract(value, '$.due'), json_extract(value, '$.tm'), json_extract(value, '$.at'), json_extract(value, '$.done'), json_extract(value, '$.n'), json_extract(value, '$.d') FROM json_each(?2)",
    ws, j)));
  st.push(...sliced(msgRows, (j) => q(env,
    "INSERT INTO messages (ws, id, rep_id, phone_key, dir, kind, at, updated_at, server_at, deleted, data) SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.rep'), json_extract(value, '$.k'), json_extract(value, '$.dir'), json_extract(value, '$.kd'), json_extract(value, '$.at'), json_extract(value, '$.u'), ?2, json_extract(value, '$.del'), json_extract(value, '$.d') FROM json_each(?3) WHERE true " +
    'ON CONFLICT(ws, id) DO UPDATE SET phone_key = excluded.phone_key, dir = excluded.dir, kind = excluded.kind, at = excluded.at, updated_at = excluded.updated_at, server_at = excluded.server_at, deleted = excluded.deleted, data = excluded.data WHERE excluded.updated_at >= messages.updated_at AND messages.rep_id IS excluded.rep_id',
    ws, now, j)));
  if (setRow) st.push(q(env, 'INSERT INTO settings (ws, member, updated_at, server_at, data) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(ws, member) DO UPDATE SET updated_at = excluded.updated_at, server_at = excluded.server_at, data = excluded.data WHERE excluded.updated_at >= settings.updated_at',
    ws, me.member, setRow.updatedAt, now, JSON.stringify(setRow)));
  if (touched.length) st.push(q(env, 'DELETE FROM alerts WHERE ws = ?1 AND rec_id IN ' + IN(2) + ' AND fid NOT IN ' + IN(3), ws, JSON.stringify(touched), JSON.stringify(open.map((o) => o.f))));
  st.push(...sliced(open, (j) => q(env,
    "INSERT INTO alerts (ws, fid, rec_kind, rec_id, at, title, body, sent_at, member) SELECT ?1, json_extract(value, '$.f'), json_extract(value, '$.k'), json_extract(value, '$.r'), json_extract(value, '$.at'), json_extract(value, '$.t'), json_extract(value, '$.b'), NULL, json_extract(value, '$.m') FROM json_each(?2) WHERE true " +
    'ON CONFLICT(ws, fid) DO UPDATE SET rec_kind = excluded.rec_kind, rec_id = excluded.rec_id, title = excluded.title, body = excluded.body, member = excluded.member, sent_at = CASE WHEN alerts.at = excluded.at THEN alerts.sent_at ELSE NULL END, at = excluded.at',
    ws, j)));
  st.push(...auditStatements(env, ws, audit));
  if (st.length) await env.DB.batch(st);
  const written = shopRows.length + dealRows.length + msgRows.length + (setRow ? 1 : 0);
  return { written, rejected, denied, stamped, now };
}

function pushFus(out, kind, rec) {
  (rec.followUps || []).forEach((f, i) => out.push({ pk: kind, pi: rec.id, i: f.id, p: i, by: typeof f.by === 'string' ? f.by.slice(0, 80) : null,
    due: typeof f.due === 'string' ? f.due.slice(0, 10) : null, tm: typeof f.time === 'string' ? f.time.slice(0, 5) : null,
    at: typeof f.at === 'number' && isFinite(f.at) ? Math.round(f.at) : null, done: typeof f.doneAt === 'string' ? f.doneAt.slice(0, 40) : null,
    n: String(f.note || '').slice(0, 300), d: JSON.stringify(f) }));
}

// ---------- audit ----------

function dealName(d) { return String((d && d.merchant && d.merchant.business) || 'Deal').slice(0, 200); }
function msgName(m) { return (m.kind === 'call' ? 'Call ' : 'Text ') + (m.dir === 'out' ? 'to ' : 'from ') + String(m.phone || '').slice(0, 30); }
export function entry(me, at, action, kind, recId, label, changes) {
  return { at, u: me.id || null, m: me.member || null, w: String(me.name || '').slice(0, 120), a: action, k: kind || null, r: recId || null,
    l: String(label || '').slice(0, 200), c: changes && changes.length ? clip(changes) : null };
}
export function auditStatements(env, ws, rows) {
  return sliced(rows, (j) => q(env,
    "INSERT INTO audit (ws, at, user_id, member, who, action, kind, rec_id, label, changes) SELECT ?1, json_extract(value, '$.at'), json_extract(value, '$.u'), json_extract(value, '$.m'), json_extract(value, '$.w'), json_extract(value, '$.a'), json_extract(value, '$.k'), json_extract(value, '$.r'), json_extract(value, '$.l'), json_extract(value, '$.c') FROM json_each(?2)",
    ws, j));
}
export async function logEvent(env, me, action, kind, recId, label, changes) {
  await env.DB.batch(auditStatements(env, me.ws, [entry(me, Date.now(), action, kind, recId, label, changes)]));
}
function clip(changes) { let s = JSON.stringify(changes); while (s.length > 6000 && changes.length > 1) { changes = changes.slice(0, -1); s = JSON.stringify(changes.concat([{ f: '...', to: 'more changes not shown' }])); } return s.slice(0, 8000); }
function short(v) {
  if (v === undefined || v === null || v === '') return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 137) + '...' : s;
}
function itemLabel(x) { return short(x.name || x.note || x.text || x.label || x.phone || (x.amount ? '$' + x.amount : '') || x.id).slice(0, 80); }
// What changed between two versions of a record: plain fields as from and to, lists of items by id
// as added, removed and changed. The time stamps the app keeps for itself are left out.
export function diff(a, b) {
  const out = [], skip = { updatedAt: 1, id: 1, deleted: 1 };
  const keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  keys.forEach((k) => {
    if (skip[k]) return;
    const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
    if (LISTS.indexOf(k) >= 0 && (Array.isArray(x) || Array.isArray(y))) {
      const xs = Array.isArray(x) ? x : [], ys = Array.isArray(y) ? y : [];
      const byId = (list) => { const o = {}; list.forEach((it) => { if (it && typeof it === 'object' && it.id) o[it.id] = it; }); return o; };
      const xa = byId(xs), ya = byId(ys);
      const added = ys.filter((it) => it && it.id && !xa[it.id]).map(itemLabel);
      const removed = xs.filter((it) => it && it.id && !ya[it.id]).map(itemLabel);
      const changed = ys.filter((it) => it && it.id && xa[it.id] && JSON.stringify(stripAt(xa[it.id])) !== JSON.stringify(stripAt(it))).map(itemLabel);
      if (!xs.some((it) => it && it.id) && !ys.some((it) => it && it.id) && JSON.stringify(xs) !== JSON.stringify(ys)) { out.push({ f: k, from: short(xs), to: short(ys) }); return; }
      if (added.length || removed.length || changed.length) out.push(Object.assign({ f: k }, added.length ? { added: added.slice(0, 20) } : {}, removed.length ? { removed: removed.slice(0, 20) } : {}, changed.length ? { changed: changed.slice(0, 20) } : {}));
      return;
    }
    if (JSON.stringify(x === undefined ? null : x) !== JSON.stringify(y === undefined ? null : y)) out.push({ f: k, from: short(x), to: short(y) });
  });
  return out;
}
function stripAt(o) { if (!o || typeof o !== 'object') return o; const c = Object.assign({}, o); delete c.at; delete c.updatedAt; return c; }

// ---------- matching for imports ----------

// Which of these names, phone numbers and email domains are already on a shop, anywhere in the
// workspace. Shops outside the caller's book come back with the owner's name and no id, so a rep
// learns that a shop is taken without seeing inside it.
export async function matchShops(env, me, names, phones, domains) {
  const ws = me.ws, mine = !isManager(me);
  const normed = {}; (names || []).slice(0, 3000).forEach((n) => { const k = normName(n); if (k) normed[k] = 1; });
  const ph = (phones || []).slice(0, 5000).map(phoneKey).filter(Boolean), dm = (domains || []).slice(0, 2000).map((d) => String(d || '').toLowerCase()).filter((d) => d && !FREE_MAIL.has(d));
  const [nR, pR, dR, tR] = await env.DB.batch([
    q(env, 'SELECT id, name, norm_name, rep_id FROM shops WHERE ws = ?1 AND deleted = 0 AND norm_name IN ' + IN(2), ws, JSON.stringify(Object.keys(normed))),
    q(env, 'SELECT c.phone_key, c.phone2_key, s.id, s.name, s.rep_id FROM contacts c JOIN shops s ON s.ws = c.ws AND s.id = c.shop_id AND s.deleted = 0 WHERE c.ws = ?1 AND (c.phone_key IN ' + IN(2) + ' OR c.phone2_key IN ' + IN(2) + ')', ws, JSON.stringify(ph)),
    q(env, 'SELECT c.email_domain, s.id, s.name, s.rep_id FROM contacts c JOIN shops s ON s.ws = c.ws AND s.id = c.shop_id AND s.deleted = 0 WHERE c.ws = ?1 AND c.email_domain IN ' + IN(2), ws, JSON.stringify(dm)),
    q(env, 'SELECT member, name FROM users WHERE ws = ?1', ws)
  ]);
  const names2 = {}; rowsOf(tR).forEach((r) => { names2[r.member] = r.name; });
  const shop = (r) => {
    const visible = !mine || r.rep_id === me.member;
    return { id: visible ? r.id : null, name: r.name, repId: r.rep_id || null, owner: r.rep_id ? names2[r.rep_id] || 'Someone' : '', yours: r.rep_id === me.member };
  };
  const out = { names: {}, phones: {}, domains: {} };
  rowsOf(nR).forEach((r) => { if (!out.names[r.norm_name] || r.rep_id === me.member) out.names[r.norm_name] = shop(r); });
  const phSet = new Set(ph);
  rowsOf(pR).forEach((r) => [r.phone_key, r.phone2_key].forEach((k) => { if (k && phSet.has(k) && (!out.phones[k] || r.rep_id === me.member)) out.phones[k] = shop(r); }));
  rowsOf(dR).forEach((r) => { if (!out.domains[r.email_domain] || r.rep_id === me.member) out.domains[r.email_domain] = shop(r); });
  return out;
}
