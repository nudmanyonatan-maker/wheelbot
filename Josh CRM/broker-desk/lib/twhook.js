// Shared by the Twilio webhooks: read the form body, find the brokerage, check the signature.
import { phoneAccount } from './carrier/index.js';
import { twilio } from './carrier/twilio.js';
export async function hook(request, env) {
  const url = new URL(request.url), ws = url.searchParams.get('ws') || '';
  const form = await request.formData().catch(() => null), params = {};
  if (form) for (const [k, v] of form.entries()) params[k] = String(v);
  const acct = ws ? await phoneAccount(env, ws, { create: false }) : null;
  if (!acct || acct.provider !== 'twilio' || !(await twilio.verify(request, env, acct, params))) return { reply: new Response('Forbidden', { status: 403 }) };
  return { ws, acct, params, url };
}
