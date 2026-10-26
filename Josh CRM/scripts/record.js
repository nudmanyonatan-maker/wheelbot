// Records a narrated video of ISO Desk against the local dev server (npm run dev, port 8788).
//   node scripts/record.js walkthrough   ->  public/tour/iso-desk-walkthrough.mp4 (Josh, start to finish)
//   node scripts/record.js promo         ->  public/tour/iso-desk-promo.mp4 (short, for anyone)
// Each scene's narration is made first with edge-tts, so the scene lasts at least as long as its
// voice. The screencast frames become the video and each voice clip is placed at its scene's start.
// Uses a fresh local workspace every run, so nothing real is touched.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const NAME = process.argv[2] || 'walkthrough';
const V = require('./videos/' + NAME);
const BASE = process.env.TOUR_URL || 'http://localhost:8788';
const ROOT = path.join(__dirname, '..');
const WORK = path.join(ROOT, '.tour-frames-' + NAME);
const VOICE_DIR = path.join(ROOT, '.tour-voice');
const TTS = process.env.EDGE_TTS || 'edge-tts'; // pip install edge-tts

const DEMO_CSS = `
  .spec-fab { display: none !important; }
  .toast { bottom: 104px !important; }
  #demo-cap { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(8px); z-index: 2147483600; max-width: 920px; width: max-content;
    background: rgba(20, 28, 37, .94); color: #fff; font: 600 21px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 13px 22px; border-radius: 14px;
    box-shadow: 0 14px 40px rgba(0,0,0,.25); opacity: 0; transition: opacity .25s ease, transform .25s ease; text-align: center; pointer-events: none; }
  #demo-cap.top { bottom: auto; top: 72px; }
  #demo-cap.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  #demo-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; z-index: 2147483647; pointer-events: none;
    background: rgba(42, 67, 196, .28); border: 2px solid #2a43c4; transition: transform .5s cubic-bezier(.3,.7,.2,1); }
  #demo-cursor.tap::after { content: ""; position: absolute; inset: -12px; border-radius: 50%; border: 2px solid rgba(42,67,196,.6); animation: demo-ring .45s ease-out forwards; }
  @keyframes demo-ring { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.3); opacity: 0; } }
  #demo-card { position: fixed; inset: 0; z-index: 2147483500; background: #f3f4f1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18222c; transition: opacity .45s ease; text-align: center; padding: 40px; }
  #demo-card .mark { width: 64px; height: 64px; }
  #demo-card h1 { margin: 0; font-size: 50px; letter-spacing: -.02em; }
  #demo-card p { margin: 0; font-size: 23px; color: #46525e; max-width: 780px; }
  #demo-card small { font-size: 16px; color: #76808a; }
  #demo-phone { position: fixed; top: 76px; right: 28px; width: 360px; z-index: 2147483550; background: rgba(248, 248, 250, .97); border-radius: 18px; padding: 12px 14px;
    box-shadow: 0 18px 50px rgba(0,0,0,.28); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; transform: translateY(-16px); opacity: 0;
    transition: opacity .3s ease, transform .3s ease; pointer-events: none; }
  #demo-phone.on { opacity: 1; transform: none; }
  #demo-phone .h { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6b6b70; text-transform: none; margin-bottom: 4px; }
  #demo-phone .h svg { width: 20px; height: 20px; border-radius: 5px; }
  #demo-phone b { display: block; font-size: 15px; }
  #demo-phone span { font-size: 14px; color: #333; }
  #demo-phone .tag { position: absolute; top: -22px; right: 6px; font-size: 12px; color: #fff; background: rgba(20,28,37,.8); padding: 2px 8px; border-radius: 8px; }
`;
const DEMO_JS = () => {
  const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.appendChild(cap);
  const cur = document.createElement('div'); cur.id = 'demo-cursor'; document.body.appendChild(cur);
  cur.style.transform = 'translate(640px, 420px)';
  const mark = '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2a43c4"/><path d="M7 7.5h10M7 12h10M7 16.5h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
  window.__demo = {
    cap(t) { if (!t) { cap.classList.remove('on'); return; } cap.classList.remove('on'); setTimeout(() => { cap.textContent = t; cap.classList.add('on'); }, 120); },
    pos(where) { cap.classList.toggle('top', where === 'top'); },
    move(x, y) { cur.style.transform = 'translate(' + x + 'px,' + y + 'px)'; },
    tap() { cur.classList.remove('tap'); void cur.offsetWidth; cur.classList.add('tap'); },
    card(title, sub, small) {
      let c = document.getElementById('demo-card');
      if (!title) { if (c) { c.style.opacity = '0'; setTimeout(() => c.remove(), 500); } return; }
      if (!c) { c = document.createElement('div'); c.id = 'demo-card'; document.body.appendChild(c); }
      c.style.opacity = '1';
      c.innerHTML = mark.replace('<svg', '<svg class="mark"') + '<h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + (small ? '<small>' + small + '</small>' : '');
    },
    phone(title, body) {
      let p = document.getElementById('demo-phone');
      if (!title) { if (p) p.classList.remove('on'); return; }
      if (!p) { p = document.createElement('div'); p.id = 'demo-phone'; document.body.appendChild(p); }
      p.innerHTML = '<div class="tag">On your phone</div><div class="h">' + mark + 'ISO DESK, now</div><b>' + title + '</b><span>' + body + '</span>';
      requestAnimationFrame(() => p.classList.add('on'));
    }
  };
};

function sh(cmd, args) { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function voiceFor(text) {
  fs.mkdirSync(VOICE_DIR, { recursive: true });
  const id = crypto.createHash('sha1').update(V.voice + '|' + (V.rate || '+0%') + '|' + text).digest('hex').slice(0, 16);
  const file = path.join(VOICE_DIR, id + '.mp3');
  if (!fs.existsSync(file)) sh(TTS, ['--voice', V.voice, '--rate=' + (V.rate || '+0%'), '--text', text, '--write-media', file]);
  const dur = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
  return { file, dur };
}
async function deriveKey(email, pw) {
  const te = new TextEncoder();
  const k = await crypto.webcrypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('isodesk:v1:' + email), iterations: 200000 }, k, 256);
  return Buffer.from(bits).toString('base64url');
}
// A fresh local workspace with its own sign-in, so every recording starts clean.
async function makeAccount() {
  const stamp = Date.now().toString(36), email = V.account.email, pw = 'Tour-' + crypto.randomBytes(8).toString('base64url');
  const q = "'" + email.replace(/'/g, "''") + "'";
  sh('npx', ['wrangler', 'd1', 'execute', 'iso-desk', '--local', '--command', 'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ' + q + '); DELETE FROM users WHERE email = ' + q + ';']);
  const link = sh('node', [path.join(__dirname, 'invite.mjs'), '--local', '--email', email, '--name', V.account.name, '--ws', NAME + stamp, '--wsname', V.account.ws, '--member', 'u1', '--phone', V.account.phone]).trim();
  const token = link.split('#invite=')[1];
  const r = await fetch(BASE + '/api/auth/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ token, key: await deriveKey(email, pw) }) });
  if (!(await r.json()).ok) throw new Error('could not create the recording account');
  return { email, pw };
}

(async () => {
  for (const s of V.scenes) if (s.say) s.voice = voiceFor(s.say);
  const talk = V.scenes.reduce((t, s) => t + (s.voice ? s.voice.dur : 0), 0);
  console.log(NAME + ': ' + V.scenes.length + ' scenes, ' + talk.toFixed(1) + 's of narration');

  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  const acct = await makeAccount();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--window-size=1280,800', '--force-device-scale-factor=2'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  // Headless Chrome stalls the next click after handing a tel: or sms: link to the system, and there
  // is no phone to dial here anyway, so the recording skips the hand-off. The desk does everything else.
  await ctx.addInitScript(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (/^(tel|sms):/.test(this.getAttribute('href') || '')) return; return c.call(this); }; });
  if (V.addInit) await ctx.addInitScript(V.addInit);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  const wait = (ms) => page.waitForTimeout(ms);
  const h = {
    page, wait, acct,
    cap: (t, where) => page.evaluate(([x, w]) => { window.__demo.pos(w || 'bottom'); window.__demo.cap(x); }, [t, where]),
    card: (a, b, c) => page.evaluate(([x, y, z]) => window.__demo.card(x, y, z), [a || null, b || null, c || null]),
    phone: (t, b) => page.evaluate(([x, y]) => window.__demo.phone(x, y), [t || null, b || null]),
    async point(loc) { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await page.evaluate(([x, y]) => window.__demo.move(x, y), [b.x + b.width / 2, b.y + b.height / 2]); await wait(550); },
    async click(loc) { await h.point(loc); await page.evaluate(() => window.__demo.tap()); await loc.click(); await wait(420); },
    async type(text, delay) { await page.keyboard.type(text, { delay: delay || 50 }); await wait(200); },
    async decorate() { await page.addStyleTag({ content: DEMO_CSS }); await page.evaluate(DEMO_JS); },
    async ready() { await page.waitForFunction(() => window.__ISO_READY === true); await wait(300); },
    async go(url) { await page.goto(BASE + url); await h.ready(); await h.decorate(); },
    async signIn() {
      await page.fill('input[name=email]', acct.email); await page.fill('input[name=pw]', acct.pw); await page.click('button[type=submit]');
      await page.waitForFunction(() => window.ISODESK && window.ISODESK.session && window.ISODESK.session());
    },
    // Fills the workspace with the demo book (Josh's shops and their deals), as if a few weeks had passed.
    async seed(settings) {
      await page.evaluate(async (settings) => {
        const s = window.AD.buildSeed(), keep = {}, now = Date.now(), phones = {};
        // No follow-up may come due by surprise mid-recording; scenes trigger the ones they show.
        const later = (r) => (r.followUps || []).forEach((f) => { if (f.doneAt) return; const [y, mo, d] = f.due.split('-').map(Number), [hh, mm] = (f.time || '09:00').split(':').map(Number); const t = new Date(y, mo - 1, d, hh, mm).getTime(); if (t > now - 60000 && t < now + 20 * 60000) { const n = new Date(now + 864e5); f.due = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); f.time = '09:00'; } });
        s.shops.forEach(later); s.deals.forEach(later);
        const shops = s.shops.filter((x) => x.repId === 'u1'); shops.forEach((x) => { keep[x.id] = 1; x.contacts.forEach((c) => { phones[c.phone.replace(/\D/g, '')] = 1; }); });
        const deals = s.deals.filter((d) => keep[d.shopId]);
        const msgs = s.msgs.filter((m) => m.dir === 'out' && phones[m.phone.replace(/\D/g, '')]);
        const meta = [Object.assign(s.meta[0], settings || {}, { updatedAt: now })];
        const post = (body) => fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        for (const [kind, list] of [['shops', shops], ['deals', deals], ['msgs', msgs], ['meta', meta]]) {
          for (let i = 0; i < list.length; i += 100) { const b = {}; b[kind] = list.slice(i, i + 100).map((r) => Object.assign(r, { updatedAt: now })); await post(b); }
        }
      }, settings || null);
      await page.reload(); await h.ready(); await h.decorate();
    },
    async file(name, text) {
      await page.evaluate(([n, t]) => { const input = document.querySelector('[data-in="import-file"]'); const dt = new DataTransfer(); dt.items.add(new File([t], n, { type: 'text/plain' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }, [name, text]);
      await wait(500);
    },
    async dueNow(dealOrShop) { await page.evaluate((id) => { const db = window.ISODESK.db(), r = db.deals[id] || db.shops[id], f = r.followUps.filter((x) => !x.doneAt)[0], n = new Date(Date.now() - 30000);
      f.due = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); f.time = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); window.ISODESK.checkAlerts(); }, dealOrShop); }
  };
  await V.before(h);

  const client = await ctx.newCDPSession(page);
  const frames = [];
  client.on('Page.screencastFrame', async (f) => {
    const file = path.join(WORK, String(frames.length).padStart(5, '0') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) { /* page closing */ }
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 });
  await wait(400);

  const placed = [];
  for (let i = 0; i < V.scenes.length; i++) {
    const s = V.scenes[i], start = Date.now();
    if (s.voice) placed.push({ file: s.voice.file, at: start / 1000 });
    if (s.cap !== undefined) await h.cap(s.cap, s.capPos);
    if (s.run) await s.run(h);
    const end = start + (s.voice ? s.voice.dur * 1000 : 0) + (s.pad === undefined ? 450 : s.pad);
    if (Date.now() < end) await wait(end - Date.now());
    process.stdout.write('.');
  }
  await wait(1200);
  const stopAt = Date.now() / 1000; // a still screen sends no frames, so the last one holds until here
  await client.send('Page.stopScreencast');
  await browser.close();
  console.log('');

  // Rebuild the screencast on an exact 30 fps clock: output frame k shows whatever was on screen at
  // t0 + k/30. Encoding the raw frames with per-frame durations stretched fast bursts and let the
  // picture drift seconds behind the voice.
  const t0 = frames[0].t, FPS = 30, seq = path.join(WORK, 'seq');
  fs.mkdirSync(seq);
  for (let k = 0, j = 0, n = Math.ceil((stopAt - t0) * FPS); k < n; k++) {
    const t = t0 + k / FPS;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    fs.linkSync(frames[j].file, path.join(seq, String(k).padStart(6, '0') + '.jpg'));
  }
  const silent = path.join(WORK, 'silent.mp4'), out = path.join(ROOT, V.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(seq, '%06d.jpg'),
    '-vf', 'scale=1920:1200:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-r', String(FPS), silent], { stdio: 'inherit' });
  // Narration: every clip delayed to its scene's start, mixed, and levelled for phone speakers.
  const args = ['-y', '-loglevel', 'error', '-i', silent];
  if (process.env.TOUR_DEBUG) console.log('first frame', (frames[0].t - placed[0].at).toFixed(2), 'scenes at', placed.map((p) => (p.at - t0).toFixed(1)).join(' '), 'stop at', (stopAt - t0).toFixed(1), 'last frame at', (frames[frames.length - 1].t - t0).toFixed(1), 'frames', frames.length);
  placed.forEach((p) => args.push('-i', p.file));
  const chains = placed.map((p, i) => { const ms = Math.max(0, Math.round((p.at - t0) * 1000)); return '[' + (i + 1) + ':a]adelay=' + ms + '|' + ms + ',aformat=channel_layouts=stereo[a' + i + ']'; });
  const mix = placed.map((p, i) => '[a' + i + ']').join('') + 'amix=inputs=' + placed.length + ':normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[aout]';
  args.push('-filter_complex', chains.concat([mix]).join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  if (V.poster) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(V.posterAt || 8), '-i', out, '-frames:v', '1', '-vf', 'scale=1280:-2', path.join(ROOT, V.poster)], { stdio: 'inherit' });
  const info = sh('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv=p=0', out]).trim().split('\n').join(' | ');
  console.log(V.out + ': ' + info + ', ' + (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
  fs.rmSync(WORK, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
