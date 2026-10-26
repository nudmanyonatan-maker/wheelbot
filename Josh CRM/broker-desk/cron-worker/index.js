// Broker Desk's minute timer: asks the desk to send any sequence steps that are due.
// Deploy with: cd cron-worker && npx wrangler deploy, then set DESK_URL and CRON_SECRET.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch(env.DESK_URL.replace(/\/$/, '') + '/api/cron', { method: 'POST', headers: { 'X-Cron-Secret': env.CRON_SECRET } }));
  }
};
