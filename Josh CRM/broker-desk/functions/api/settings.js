// GET  /api/settings -> the brokerage's settings.
// POST /api/settings { key, data } -> saves one key (managers only, except a person's own 'mine').
import { route, json, fail, isManager, putSetting, q, SH } from '../../lib/server.js';
import { wsSettings, putMemberSettings } from '../../lib/defaults.js';

// Saved lists. A manager saves the whole set. Anyone else can only add, rename or delete their own
// private lists: everything else is kept as stored, whatever the request says about it.
async function saveLists(env, me, data) {
  if (!Array.isArray(data)) throw fail('Lists must be a list.');
  if (JSON.stringify(data).length > 200 * 1024) throw fail('That setting is too large.');
  const clean = (l) => ({
    id: String((l && l.id) || '').slice(0, 40), name: String((l && l.name) || '').trim().slice(0, 60),
    filter: l && l.filter && typeof l.filter === 'object' && !Array.isArray(l.filter) ? l.filter : {},
    sort: String((l && l.sort) || 'recent').slice(0, 20), shared: !(l && l.shared === false), owner: l && l.owner ? String(l.owner).slice(0, 40) : null
  });
  let next = data.slice(0, 200).map(clean).filter((l) => l.id && l.name);
  if (!isManager(me)) {
    const mine = (l) => !l.shared && l.owner === me.member;
    const cur = (await wsSettings(env, me.ws)).lists.map(clean), taken = new Set(cur.filter((l) => !mine(l)).map((l) => l.id));
    next = [...cur.filter((l) => !mine(l)), ...next.filter((l) => mine(l) && !taken.has(l.id))];
  }
  await putSetting(env, me.ws, 'lists', next);
  return next;
}

const KEYS = ['statuses', 'lists', 'templates', 'compliance', 'phone', 'form', 'routing'];
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) { return json({ ok: true, settings: await wsSettings(env, me.ws) }); },
  async post({ env, me, body }) {
    if (body.key === 'mine') {
      const d = body.data || {}, patch = {};
      if (Array.isArray(d.pinned)) patch.pinned = d.pinned.filter((x) => typeof x === 'string').slice(0, 30);
      if (d.lines !== undefined) patch.lines = Math.max(1, Math.min(5, d.lines | 0));
      if (d.signature !== undefined) patch.signature = String(d.signature || '').slice(0, 1000);
      if (d.forwardTo !== undefined) patch.forwardTo = SH.phoneKey(d.forwardTo) ? SH.e164(d.forwardTo) : '';
      if (d.voicemailDrop !== undefined) patch.voicemailDrop = !!d.voicemailDrop;
      return json({ ok: true, mine: await putMemberSettings(env, me.ws, me.member, patch) });
    }
    if (body.key === 'brand') {
      if (!isManager(me)) throw fail('Only a manager can change this.', 403);
      const b = body.data || {}, brand = { color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#1f4fd1', logoText: String(b.logoText || '').slice(0, 40) };
      const name = String(b.name || '').trim().slice(0, 120);
      await q(env, 'UPDATE workspaces SET brand = ?, name = COALESCE(NULLIF(?, \'\'), name) WHERE id = ?', JSON.stringify(brand), name, me.ws).run();
      return json({ ok: true });
    }
    if (!KEYS.includes(body.key)) throw fail('Unknown setting.');
    if (body.key === 'lists') return json({ ok: true, lists: await saveLists(env, me, body.data) });
    if (!isManager(me)) throw fail('Only a manager can change this.', 403);
    const data = body.data;
    if (data == null || JSON.stringify(data).length > 200 * 1024) throw fail('That setting is too large.');
    await putSetting(env, me.ws, body.key, data);
    return json({ ok: true });
  }
});
