// /u/<token>: the unsubscribe link at the bottom of every bulk email (CASL). One click to confirm;
// it takes effect at once and covers every lead with that address.
import { q, one } from '../../lib/server.js';
import { readUnsubToken } from '../../lib/compliance.js';
import { activityStmt } from '../../lib/activity.js';
const page = (title, body) => new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title><style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f3f4f1;color:#18222c;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}main{background:#fff;border:1px solid #dde1da;border-radius:14px;padding:28px;max-width:440px}h1{font-size:20px;margin:0 0 8px}button{height:42px;padding:0 18px;border-radius:8px;border:0;background:#1f4fd1;color:#fff;font:inherit;font-weight:600;cursor:pointer}p{color:#46525e}</style></head><body><main>' + body + '</main></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function onRequestGet({ env, params }) {
  const t = await readUnsubToken(env, params.token);
  if (!t) return page('Link not valid', '<h1>This link is not valid</h1><p>Reply to the email and ask to be removed, and we will take care of it.</p>');
  const ws = await one(env, 'SELECT name FROM workspaces WHERE id = ?', t.ws);
  return page('Unsubscribe', '<h1>Stop emails from ' + esc(ws && ws.name) + '?</h1><p>' + esc(t.email) + ' will not get any more of these emails.</p><form method="post"><button type="submit">Unsubscribe</button></form>');
}
export async function onRequestPost({ env, params }) {
  const t = await readUnsubToken(env, params.token);
  if (!t) return page('Link not valid', '<h1>This link is not valid</h1>');
  const now = Date.now(), leads = (await env.DB.prepare('SELECT DISTINCT id FROM leads WHERE ws = ?1 AND (email_lc = ?2 OR id IN (SELECT lead_id FROM contacts WHERE ws = ?1 AND email_lc = ?2))').bind(t.ws, t.email).all()).results || [];
  await env.DB.batch([
    q(env, 'INSERT OR IGNORE INTO suppress (ws, email_lc, reason, at) VALUES (?, ?, ?, ?)', t.ws, t.email, 'Unsubscribe link', now),
    q(env, "UPDATE enrollments SET status = 'unsubscribed', updated_at = ? WHERE ws = ? AND status = 'active' AND lead_id IN (SELECT value FROM json_each(?))", now, t.ws, JSON.stringify(leads.map((l) => l.id))),
    ...leads.map((l) => q(env, 'UPDATE leads SET email_opt_out = 1 WHERE ws = ? AND id = ?', t.ws, l.id)),
    ...leads.map((l) => activityStmt(env, t.ws, { kind: 'system', leadId: l.id, body: 'Unsubscribed from email (' + t.email + ').' }))
  ]);
  return page('Unsubscribed', '<h1>You are unsubscribed</h1><p>' + esc(t.email) + ' will not get any more of these emails.</p>');
}
