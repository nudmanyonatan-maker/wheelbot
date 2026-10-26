// Fresh invite for the Excel pitch: a made-up "Excel Team" user in its own empty workspace.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const EMAIL = 'team@example.com', P = process.argv[2];
const sql = (s) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'iso-desk', '--local', '--command', s], { stdio: ['ignore', 'ignore', 'inherit'] });
sql("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '" + EMAIL + "'); DELETE FROM users WHERE email = '" + EMAIL + "'; DELETE FROM attempts;");
const link = execFileSync('node', ['scripts/invite.mjs', '--local', '--email', EMAIL, '--name', 'Excel Team', '--ws', 'excel' + Date.now().toString(36), '--wsname', 'Excel Capital', '--member', 'u1', '--phone', '020 7946 0123', '--role', 'manager'], { encoding: 'utf8' }).trim();
const cfg = JSON.parse(fs.readFileSync(P + '/config.json', 'utf8'));
cfg.capture.startPath = '/#invite=' + link.split('#invite=')[1];
fs.writeFileSync(P + '/config.json', JSON.stringify(cfg, null, 1));
console.log(cfg.capture.startPath);
