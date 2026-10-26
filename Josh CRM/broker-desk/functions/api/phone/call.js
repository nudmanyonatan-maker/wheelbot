// POST  /api/phone/call { leadId, to } -> logs the call and returns what the browser dials.
// PATCH /api/phone/call { id, status, duration, outcome, note, leadStatus } -> the result.
import { route, json } from '../../../lib/server.js';
import { startCall, finishCall } from '../../../lib/phone.js';
export const { onRequestPost, onRequestPatch } = route({
  async post({ env, me, body, url }) { return json({ ok: true, ...(await startCall(env, me, { leadId: body.leadId, to: body.to, base: url.origin })) }); },
  async patch({ env, me, body }) { return json({ ok: true, ...(await finishCall(env, me, String(body.id || ''), body)) }); }
});
