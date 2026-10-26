// Moves the first version's `records` table into the real tables (shops, contacts, deals, follow_ups,
// messages, settings). Every record goes through the same saveBook() the API uses, reading the new
// tables for real, so a record already there with a newer edit is kept and the old copy is skipped.
// That makes it safe to run again at any time: a second run changes nothing.
// Pick the database every time, there is no default: --prod (Josh's live data), --preview, or --local [--persist <dir>].
//   node scripts/migrate-records.mjs --prod             dry run: counts + SQL file, writes nothing
//   node scripts/migrate-records.mjs --prod --apply     runs it
//   node scripts/migrate-records.mjs --prod --verify    checks every old record against what /api/data now returns, and the follow-up alerts
//   --ws <id> limits it to one workspace.
// Nothing is deleted. `records` stays as it is. Needs migrations 0001 and 0002 applied first.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { saveBook, readBook, LIMITS } from '../lib/book.js';

const args = {}, argv = process.argv.slice(2), KNOWN = ['prod', 'preview', 'local', 'persist', 'apply', 'verify', 'ws'];
argv.forEach((a, i) => { if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; });
const unknown = Object.keys(args).filter((k) => KNOWN.indexOf(k) < 0), targets = ['prod', 'preview', 'local'].filter((k) => args[k]);
if (unknown.length || targets.length !== 1) {
  console.error((unknown.length ? 'Unknown option: --' + unknown.join(', --') + '. ' : '') + 'Pick exactly one database: --prod, --preview or --local [--persist <dir>].');
  process.exit(2);
}
const DB = args.preview ? ['iso-desk-preview', '--remote', '--env', 'preview'] : args.local ? ['iso-desk', '--local'].concat(args.persist ? ['--persist-to', args.persist] : []) : ['iso-desk', '--remote'];
console.log('Database: ' + (args.prod ? 'iso-desk, LIVE' : args.preview ? 'iso-desk-preview' : 'local iso-desk') + (args.apply ? ', writing' : args.verify ? ', checking' : ', dry run'));
const STMT_MAX = 95000; // D1 refuses SQL statements over 100 KB
LIMITS.param = 40 * 1024;
const wrangler = (extra) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', ...DB, '--json', ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 512 * 1024 * 1024 }));
const sql = (command) => wrangler(['--command', command])[0].results;
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const render = (s) => s.text.replace(/\?(\d+)/g, (_, n) => lit(s.args[+n - 1]));

// D1 for lib/book.js over wrangler: lookups run now, in one call per batch; writes are collected as SQL.
function wranglerDB(writes) {
  return {
    prepare: (text) => ({ text, args: [], bind(...a) { this.args = a; return this; } }),
    async batch(list) {
      const out = new Array(list.length), reads = [];
      list.forEach((s, i) => { if (/^\s*SELECT/i.test(s.text)) reads.push(i); else { writes.push(render(s) + ';'); out[i] = { results: [] }; } });
      if (reads.length) {
        const res = wrangler(['--command', reads.map((i) => render(list[i])).join(';\n')]);
        reads.forEach((i, j) => { out[i] = { results: res[j].results }; });
      }
      return out;
    }
  };
}
function runWrites(writes, label) {
  const long = writes.filter((w) => w.length > STMT_MAX);
  if (long.length) throw new Error(label + ': ' + long.length + ' statement(s) over 100 KB. A single record is too big to move this way: ' + long.map((w) => w.slice(0, 160)).join(' | '));
  mkdirSync('.wrangler', { recursive: true });
  const file = '.wrangler/migrate-records-' + label + '.sql';
  writeFileSync(file, writes.join('\n') + '\n');
  if (args.apply && writes.length) execFileSync('npx', ['wrangler', 'd1', 'execute', ...DB, '--file', file], { stdio: ['ignore', 'ignore', 'inherit'] });
  return file;
}
// Same record either way: key order, and empty or missing fields, do not count as differences.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach((k) => { const x = canon(v[k]); if (x === null || x === undefined || (Array.isArray(x) && !x.length)) return; o[k] = x; }); return o; }
  return v;
}
function firstDiff(a, b, path) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) { const d = firstDiff(a[k], b[k], path + '.' + k); if (d) return d; }
  }
  return path + ': ' + JSON.stringify(a).slice(0, 80) + ' vs ' + JSON.stringify(b).slice(0, 80);
}

const KIND_ORDER = { shops: 0, deals: 1, msgs: 2, meta: 3 };
const workspaces = sql('SELECT ws, COUNT(*) AS n FROM records WHERE deleted = 0' + (args.ws ? ' AND ws = ' + lit(args.ws) : '') + ' GROUP BY ws');
if (!workspaces.length) { console.log('No records to move.'); process.exit(0); }
let problems = 0;
for (const { ws, n } of workspaces) {
  const users = sql(`SELECT id, member, name, role FROM users WHERE ws = ${lit(ws)} ORDER BY created`);
  const members = users.map((u) => u.member);
  const manager = users.find((u) => u.role !== 'rep') || users[0];
  if (!manager) { console.log(`${ws}: no login on this workspace, skipped`); problems++; continue; }
  // Calls, texts and settings belonged to the whole workspace in the first version; they go to its first manager.
  const me = { id: manager.id, ws, member: manager.member, name: 'Moved from the first version', role: 'manager' };
  // A record the first version saved with a device clock running ahead keeps the time the server got it
  // instead, the rule the book applies to every save. Same answer every run, so reruns and --verify agree.
  const recs = sql(`SELECT kind, id, server_at, data FROM records WHERE ws = ${lit(ws)} AND deleted = 0`).map((r) => {
    const rec = JSON.parse(r.data);
    if (typeof rec.updatedAt === 'number' && rec.updatedAt > r.server_at) rec.updatedAt = r.server_at;
    return { kind: r.kind, id: r.id, rec };
  })
    .sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.id < b.id ? -1 : 1));

  if (args.verify) {
    const book = JSON.parse(await readBook({ DB: wranglerDB([]) }, me, 0));
    let same = 0; const bad = [];
    recs.forEach((r) => {
      const got = r.kind === 'meta' ? book.meta[r.id] : book[r.kind] && book[r.kind][r.id];
      const want = Object.assign({}, r.rec);
      if (r.kind === 'shops' && want.repId && !members.includes(want.repId)) want.repId = null;
      const d = got ? firstDiff(canon(want), canon(got), r.kind + ' ' + r.id) : r.kind + ' ' + r.id + ': missing';
      if (d) bad.push(d); else same++;
    });
    // Every open follow-up still has its alert at the same moment.
    const alerts = {}; sql(`SELECT fid, at FROM alerts WHERE ws = ${lit(ws)}`).forEach((a) => { alerts[a.fid] = a.at; });
    let open = 0;
    recs.forEach((r) => (r.rec.followUps || []).forEach((f) => {
      if (f.doneAt || typeof f.at !== 'number' || f.at < Date.now() - 7 * 864e5) return;
      open++; if (alerts[f.id] !== Math.round(f.at)) bad.push('alert ' + f.id + ' on ' + r.id + ': ' + (alerts[f.id] === undefined ? 'missing' : 'at ' + alerts[f.id] + ', expected ' + f.at));
    }));
    console.log(`${ws}: ${same} of ${recs.length} records match, ${open} open follow-up alerts checked` + (bad.length ? ', ' + bad.length + ' problem(s):\n  ' + bad.slice(0, 40).join('\n  ') : ', all good'));
    problems += bad.length;
    continue;
  }

  let written = 0, skipped = 0, unknown = 0, files = [];
  for (let i = 0; i < recs.length; i += 300) {
    const body = { shops: [], deals: [], msgs: [], meta: [] };
    recs.slice(i, i + 300).forEach((r) => {
      if (r.kind === 'shops' && r.rec.repId && !members.includes(r.rec.repId)) { r.rec.repId = null; unknown++; }
      if (body[r.kind]) body[r.kind].push(r.rec);
    });
    const writes = [];
    const res = await saveBook({ DB: wranglerDB(writes) }, me, body, { skipSame: true });
    written += res.written; skipped += res.rejected.length;
    files.push(runWrites(writes, ws + '-' + (i / 300 + 1)));
  }
  console.log(`${ws}: ${n} records, ${written} to write` + (skipped ? `, ${skipped} unreadable left in records` : '') + (unknown ? `, ${unknown} shops whose owner is not on the team left with nobody` : '') +
    (written < n - skipped ? `, ${n - skipped - written} already there with the same or a newer edit` : '') + '. SQL: ' + files.join(', '));
}
if (!args.verify) console.log(args.apply ? 'Done. Run again with --verify to check it.' : 'Dry run. Nothing was written. Add --apply to run it.');
process.exit(problems ? 1 : 0);
