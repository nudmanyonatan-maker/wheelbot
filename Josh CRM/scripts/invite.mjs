// Makes a one-time link that lets someone set their password and sign in. The same command on an
// existing email makes a password reset link. Links expire after 7 days. After the first manager is
// in, they add their reps from Settings, Team, so this is mostly for the first login.
//   node scripts/invite.mjs --email josh@mnrcapitalgroup.com --name "Josh Abecassis" --ws mnr --wsname "MNR Capital Group" --member u1 --phone "(305) 280-5556"
//   --role manager (default, sees every book) or --role rep (sees only their own)
//   add --local to write to the local dev database (with --persist <dir> if dev runs with --persist-to), or --preview for the preview database.
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true; });
const email = String(args.email || '').trim().toLowerCase();
if (!email || !args.name) { console.error('Usage: node scripts/invite.mjs --email you@example.com --name "Full Name" [--ws id] [--wsname "Company"] [--member u1] [--phone "(305) 555-0100"] [--role manager|rep] [--local|--preview]'); process.exit(1); }
const ws = args.ws || 'main', member = args.member || 'u1', now = Date.now();
const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = `INSERT OR IGNORE INTO workspaces (id, name, created) VALUES (${q(ws)}, ${q(args.wsname || ws)}, ${now});
INSERT INTO invites (token, ws, email, name, member, phone, role, expires) VALUES (${q(hash)}, ${q(ws)}, ${q(email)}, ${q(args.name)}, ${q(member)}, ${q(args.phone || '')}, ${q(args.role === 'rep' ? 'rep' : 'manager')}, ${now + 7 * 864e5});`;
const db = args.preview ? ['iso-desk-preview', '--remote', '--env', 'preview'] : ['iso-desk', args.local ? '--local' : '--remote'].concat(args.local && args.persist ? ['--persist-to', args.persist] : []);
execFileSync('npx', ['wrangler', 'd1', 'execute', ...db, '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] });
const base = args.base || (args.local ? 'http://localhost:8788' : args.preview ? 'https://book-roles.iso-desk-josh.pages.dev' : 'https://iso-desk-josh.pages.dev');
console.log(base + '/#invite=' + token);
