// Seals carrier and mailbox secrets before they go into D1, with AES-GCM under env.SECRET_KEY.
// Without SECRET_KEY (local demo only) values are stored as plain JSON and marked so.
import { b64url } from './server.js';

const enc = new TextEncoder(), dec = new TextDecoder();
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function keyOf(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('broker-desk:' + env.SECRET_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, obj) {
  const text = JSON.stringify(obj || {});
  if (!env.SECRET_KEY) return 'plain:' + text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(env), enc.encode(text)));
  return 'v1:' + b64url(iv) + ':' + b64url(ct);
}
export async function unseal(env, s) {
  if (!s) return {};
  if (s.startsWith('plain:')) { try { return JSON.parse(s.slice(6)); } catch { return {}; } }
  const [v, iv, ct] = s.split(':');
  if (v !== 'v1' || !env.SECRET_KEY) return {};
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, await keyOf(env), unb64url(ct)))); } catch { return {}; }
}
