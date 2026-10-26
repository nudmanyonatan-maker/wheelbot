// POST /api/dialer { listId | filter, title, lines } -> starts a dial session over a saved list.
// GET  /api/dialer -> the abandoned-call guard for this month.
import { route, json } from '../../../lib/server.js';
import { startSession } from '../../../lib/dialer.js';
import { abandonState } from '../../../lib/compliance.js';
import { putMemberSettings } from '../../../lib/defaults.js';
export const { onRequestGet, onRequestPost } = route({
  async get({ env, me }) { return json({ ok: true, guard: await abandonState(env, me.ws) }); },
  async post({ env, me, body }) {
    const s = await startSession(env, me, body);
    await putMemberSettings(env, me.ws, me.member, { lines: s.asked });
    return json({ ok: true, session: s });
  }
});
