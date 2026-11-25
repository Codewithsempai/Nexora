#!/usr/bin/env node
/* Records the README screen recordings from the REAL NEXORA app UI (src/renderer/index.html: titlebar, tabs, orb or robot,
   live captions) using Playwright. One recording per orb: robot, nexora, nexo, nexie.
   The browser clock is stepped one frame at a time and every frame is captured, so each video is perfectly smooth (no
   dropped or stuck frames) no matter how slow the PC renders. Every output has ROUND CORNERS with a transparent outside,
   like the real frameless NEXORA window.

   Setup once:   npm i -D playwright && npx playwright install chromium     (ffmpeg must be installed)
   Run all:      npm run hero
   Run some:     node tools/record-hero.js nexo nexie
   Output:       docs/art/hero-<orb>.webp  (README, animated, transparent rounded corners)
                 docs/art/hero-<orb>.webm  (full quality, transparent rounded corners)
                 docs/art/hero-<orb>.png   (poster frame) */
const http = require('http'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'docs', 'art'), tmp = path.join(root, '.hero-tmp');
const FPS = 30, SECONDS = 10, W = 1280, H = 720, RADIUS = 28;   // RADIUS matches .nexora-app-shell in glass-redesign.css
const ORBS = ['robot', 'nexora', 'nexo', 'nexie'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// What the main process would normally send: [second, namespace, event, payload]
const SCRIPT = [
  [0.0, 'voice', 'onStatus', { mode: 'standby', wakeEnabled: true }],
  [1.0, 'voice', 'onStatus', { mode: 'wake', wakeEnabled: true }],
  [1.6, 'voice', 'onStatus', { mode: 'listening', wakeEnabled: true }],
  [1.9, 'voice', 'onCaption', { role: 'user', text: 'Hey Nexora,' }],
  [2.6, 'voice', 'onCaption', { role: 'user', text: 'Hey Nexora, remind me' }],
  [3.3, 'voice', 'onCaption', { role: 'user', text: 'Hey Nexora, remind me to call mom at 6 PM', finished: true }],
  [4.6, 'voice', 'onStatus', { mode: 'thinking', wakeEnabled: true }],
  [5.6, 'voice', 'onStatus', { mode: 'speaking', wakeEnabled: true }],
  [5.8, 'voice', 'onCaption', { role: 'model', text: 'Done. Reminder' }],
  [6.6, 'voice', 'onCaption', { role: 'model', text: 'Done. Reminder set for 6 PM.', finished: true }],
  [9.0, 'voice', 'onStatus', { mode: 'standby', wakeEnabled: true }],
];

// The recording page fills the whole frame with the app shell, so the rounded corners are cut cleanly.
const FRAME_CSS = `.nexora-app-shell{margin:0!important;width:100vw!important;height:100vh!important;border-radius:${RADIUS}px!important;box-shadow:none!important}.cap-scroll{scroll-behavior:auto!important}`;   // instant caption scroll: smooth scrolling stalls under the stepped clock

const run = (cmd, a) => { const r = spawnSync(cmd, a, { stdio: 'inherit' }); if (r.status) process.exit(r.status || 1); };
const ff = (a) => run('ffmpeg', ['-y', '-loglevel', 'error', ...a]);

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});

async function makeMask(browser, file) {   // anti-aliased rounded rectangle, transparent outside
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<body style="margin:0;background:transparent"><div style="width:${W}px;height:${H}px;border-radius:${RADIUS}px;background:#fff"></div></body>`);
  await page.screenshot({ path: file, omitBackground: true }); await page.close();
}

async function record(browser, orb, mask) {
  const frames = path.join(tmp, orb);
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.clock.install();                                         // fake timers + requestAnimationFrame, still running in real time
  await page.addInitScript(`window.__ORB = ${JSON.stringify(orb)};`);
  await page.addInitScript({ path: path.join(__dirname, 'hero', 'mock-bridge.js') });
  await page.goto(`http://127.0.0.1:${server.address().port}/src/renderer/index.html`);
  await page.addStyleTag({ content: FRAME_CSS });
  // The app migrates the old default 'nexora' profile to the robot on start, so pick the orb the way a user does: in Orb Studio.
  await page.evaluate((id) => { const sel = document.getElementById('orbPresetSelect'); if (sel && sel.value !== id) { sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, orb);
  // wait (real time) until the orb or robot is drawn on the orb canvas
  await page.waitForFunction(() => { const c = document.getElementById('orbCanvas'); if (!c || !c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 20) n++; return n > 400; }, null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(1500);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);                               // from here on, time only moves when we say so
  const total = FPS * SECONDS; let next = 0;
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    while (next < SCRIPT.length && SCRIPT[next][0] <= t + 1e-6) { const [, ns, ev, payload] = SCRIPT[next++]; await page.evaluate(([a, b, c]) => window.__emit(a, b, c), [ns, ev, payload]); }
    await page.screenshot({ path: path.join(frames, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 94, animations: 'disabled' });
    await page.clock.runFor(Math.round(((f + 1) * 1000) / FPS) - Math.round((f * 1000) / FPS));   // advance exactly one frame
    if (f % 30 === 0) console.log(`[${orb}] frame ${f}/${total}`);
  }
  await ctx.close();

  const input = ['-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'), '-framerate', String(FPS), '-loop', '1', '-t', String(SECONDS), '-i', mask];
  const cap = ['-frames:v', String(total)];   // the looped mask never ends, so cap the output at the real frame count
  const round = (tail) => `[0:v][1:v]alphamerge,${tail}`;
  const base = path.join(out, `hero-${orb}`);
  ff([...input, ...cap, '-filter_complex', round('format=yuva420p[v]'), '-map', '[v]', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '34', '-b:v', '0', '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', `${base}.webm`]);
  ff([...input, ...cap, '-filter_complex', round('fps=20,scale=960:-1:flags=lanczos,format=rgba[v]'), '-map', '[v]', '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '72', '-compression_level', '5', '-loop', '0', `${base}.webp`]);
  ff(['-i', path.join(frames, `f${String(Math.round(FPS * 8)).padStart(4, '0')}.jpg`), '-i', mask, '-filter_complex', '[0:v][1:v]alphamerge', '-frames:v', '1', `${base}.png`]);
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`wrote docs/art/hero-${orb}.webp / .webm / .png`);
}

(async () => {
  const want = process.argv.slice(2).filter((a) => ORBS.includes(a));
  const list = want.length ? want : ORBS;
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  if (spawnSync('ffmpeg', ['-version']).error) { console.error('ffmpeg is required: https://ffmpeg.org/download.html'); process.exit(1); }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const mask = path.join(tmp, 'mask.png'); await makeMask(browser, mask);
  for (const orb of list) await record(browser, orb, mask);
  await browser.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
