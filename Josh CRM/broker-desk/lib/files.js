// Where uploaded files live. R2 (env.FILES) when the account has it; otherwise Workers KV
// (env.FILES_KV), which needs no billing and holds files up to 25 MB. Either way the files table
// keeps the key in r2_key.
export const fileStoreReady = (env) => !!(env.FILES || env.FILES_KV);
export async function putFile(env, key, file, contentType) {
  if (env.FILES) return env.FILES.put(key, file.stream(), { httpMetadata: { contentType } });
  if (env.FILES_KV) return env.FILES_KV.put(key, await file.arrayBuffer(), { metadata: { contentType } });
  throw Object.assign(new Error('File storage is not set up.'), { expose: true, status: 501 });
}
export async function getFile(env, key) {
  if (env.FILES) { const o = await env.FILES.get(key); return o ? o.body : null; }
  if (env.FILES_KV) return env.FILES_KV.get(key, { type: 'stream' });
  return null;
}
export async function deleteFile(env, key) {
  if (env.FILES) return env.FILES.delete(key);
  if (env.FILES_KV) return env.FILES_KV.delete(key);
}
