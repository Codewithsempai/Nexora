/* v0.3.10 tests: any installed app, folders on any drive, faster planning, approve-by-voice, per-monitor screen capture,
 * and the Live wake fix (words spoken right after "Hey Nexora" are no longer lost). Every system call is injected. */
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'electron') return { app: { getPath: () => os.tmpdir() }, safeStorage: { isEncryptionAvailable: () => false }, ipcMain: { on() {} }, BrowserWindow: class {}, screen: {} };
  return orig.call(this, r, ...a);
};
const { AppIndex } = require('../../src/main/autonomy/app-index');
const { ActionExecutor } = require('../../src/main/autonomy/actions');
const { localPlan } = require('../../src/main/autonomy/planner');
const { parseScreenTarget, parseWindowLines, matchWindow, voiceDecision } = require('../../src/main/autonomy/screen-target');
const { AutonomyService } = require('../../src/main/autonomy');
const { AUTONOMY_DEFAULTS } = require('../../src/main/autonomy/defaults');
const { matchWakePhrase, WakeClipDetector } = require('../../src/main/services/voice-utils');
const { VoiceService } = require('../../src/main/services/voice-service');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-v310-'));
const sleep = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const touch = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); };

(async () => {
  // ---------- 1. installed-app index ----------
  const pd = tmp(), ad = tmp();
  for (const f of ['Discord Inc/Discord.lnk', 'Steam/Steam.lnk', 'Steam/Uninstall Steam.lnk', 'Microsoft Word.lnk', 'Visual Studio Code/Visual Studio Code.lnk']) touch(path.join(pd, 'Microsoft/Windows/Start Menu/Programs', f));
  touch(path.join(ad, 'Microsoft/Windows/Start Menu/Programs/Telegram Desktop.lnk'));
  const storeText = 'WhatsApp|5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App\nCalculator|Microsoft.WindowsCalculator_8wekyb3d8bbwe!App\nDiscord|Store.Discord!App\nBad|evil" & calc';
  const idx = new AppIndex({ fs, path, platform: 'win32', env: { ProgramData: pd, APPDATA: ad }, ps: async () => storeText });
  await idx.ensure();
  const names = idx.list();
  for (const n of ['Discord', 'Steam', 'Microsoft Word', 'Telegram Desktop', 'WhatsApp', 'Calculator']) assert(names.includes(n), `index has ${n}: ${names}`);
  assert(!names.includes('Uninstall Steam') && !names.includes('Bad'), 'uninstallers and unsafe ids are skipped');
  assert.strictEqual(idx.find('discord').kind, 'lnk', 'a real shortcut beats the Store entry of the same name');
  assert.strictEqual(idx.find('the Discord app').name, 'Discord');
  assert.strictEqual(idx.find('discrod').name, 'Discord', 'speech-to-text typo');
  assert.strictEqual(idx.find('word').name, 'Microsoft Word');
  assert.strictEqual(idx.find('visual studio code').name, 'Visual Studio Code');
  assert.strictEqual(idx.find('telegram').name, 'Telegram Desktop');
  assert.strictEqual(idx.find('whatsapp').kind, 'uwp');
  assert.strictEqual(idx.find('photoshop'), null, 'not installed -> null');

  // ---------- 2. open any app ----------
  const calls = [];
  const mkEx = (extra = {}) => new ActionExecutor({ shell: { openPath: async (p) => { calls.push(['openPath', p]); return ''; }, openExternal: async () => {} }, execFile: (c, a, o, cb) => { calls.push(['exec', c, ...a]); cb(null); }, folders: { home: tmp() }, platform: 'win32', fs, path, appIndex: idx, ...extra });
  const ex = mkEx();
  assert(ex.validate('open_app', { name: 'Discord' }).ok);
  for (const bad of ['calc & del *', 'a|b', 'x"y', '..\\evil', '', 'x']) assert(!ex.validate('open_app', { name: bad }).ok, `blocked: ${bad}`);
  assert.strictEqual(ex.describe('open_app', { name: 'discrod' }), 'Open Discord', 'approval card shows the real app name');
  let r = await ex.run('open_app', { name: 'Discord' }); assert(r.ok && /Opened Discord/.test(r.summary), r.summary); assert.strictEqual(calls.at(-1)[0], 'openPath'); assert(/Discord\.lnk$/.test(calls.at(-1)[1]));
  r = await ex.run('open_app', { name: 'WhatsApp' }); assert(r.ok); assert.deepStrictEqual(calls.at(-1), ['exec', 'explorer.exe', 'shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App']);
  r = await ex.run('open_app', { name: 'Photoshop' }); assert(!r.ok && /could not find an app named/.test(r.summary), r.summary);
  r = await ex.run('open_app', { name: 'chrome' }); assert.deepStrictEqual(calls.at(-1), ['exec', 'cmd.exe', '/c', 'start', '', 'chrome'], 'built-in apps still start the old way');

  // ---------- 3. folders on any drive ----------
  const dRoot = tmp(); fs.mkdirSync(path.join(dRoot, 'Anime'), { recursive: true }); fs.mkdirSync(path.join(dRoot, 'Stuff/Old/anime-backup'), { recursive: true }); fs.mkdirSync(path.join(dRoot, '$Recycle.Bin/anime'), { recursive: true });
  const exD = mkEx({ driveMap: () => ({ D: dRoot }) });
  let v = exD.validate('open_folder', { path: 'D drive' }); assert(v.ok && v.args.path === dRoot, 'D drive -> root');
  assert(exD.validate('open_folder', { path: 'd:' }).ok);
  assert(!exD.validate('open_folder', { path: 'Z drive' }).ok, 'missing drive says so');
  assert(/Z: drive/.test(exD.validate('open_folder', { path: 'Z drive' }).error));
  v = exD.validate('open_folder', { name: 'anime', drive: 'D' }); assert(v.ok && v.args.name === 'anime' && v.args.drive === 'D');
  assert(!exD.validate('open_folder', { name: '..\\..', drive: 'D' }).ok);
  assert.strictEqual(exD.describe('open_folder', v.args), 'Open the “anime” folder on drive D:');
  r = await exD.run('open_folder', v.args); assert(r.ok && r.data.path === path.join(dRoot, 'Anime'), `found the shallowest exact match, not the recycle bin: ${r.summary}`);
  assert.strictEqual(calls.at(-1)[1], path.join(dRoot, 'Anime'));
  r = await exD.run('open_folder', { name: 'nothing-here', drive: 'D' }); assert(!r.ok && /could not find a folder named/.test(r.summary));
  // plans: no Gemini needed
  let p = localPlan('open the anime folder in the D drive', exD); assert.deepStrictEqual(p.steps.map((s) => [s.action, s.args.name, s.args.drive]), [['open_folder', 'anime', 'D']]);
  p = localPlan('open D drive', exD); assert.strictEqual(p.steps[0].args.path, dRoot);
  p = localPlan('open Discord', exD); assert.deepStrictEqual(p.steps.map((s) => [s.action, s.args.name]), [['open_app', 'Discord']]);
  p = localPlan('open discord and whatsapp', exD); assert.strictEqual(p.steps.length, 2);
  p = localPlan('open youtube and play Kalyani song', exD); assert(/youtube\.com\/results\?search_query=Kalyani%20song/.test(p.steps[0].args.url), 'YouTube search is planned offline');
  p = localPlan('open youtube', exD); assert(/^https:\/\/www\.youtube\.com\/$/.test(p.steps[0].args.url));
  assert.strictEqual(localPlan('rearrange my wardrobe photos', exD), null, 'unknown goals still go to Gemini');

  // ---------- 4. screen targets / windows / voice answers ----------
  assert.deepStrictEqual(parseScreenTarget('chrome'), { kind: 'app', app: 'chrome' });
  assert.deepStrictEqual(parseScreenTarget('the brave screen'), { kind: 'app', app: 'brave' });
  assert.deepStrictEqual(parseScreenTarget('my screen'), { kind: 'all' });
  assert.deepStrictEqual(parseScreenTarget('entire screen'), { kind: 'all' });
  assert.deepStrictEqual(parseScreenTarget('this screen'), { kind: 'cursor' });
  assert.deepStrictEqual(parseScreenTarget(undefined), { kind: 'all' });
  const wins = parseWindowLines('chrome\tFix Gemini - Google Chrome\t-1920\t0\t0\t1040\t0\nbrave\tNew Tab - Brave\t0\t0\t1366\t728\t1\ncode\tapp.js - Visual Studio Code\t10\t10\t900\t700\t0\nelectron\tNEXORA\t0\t0\t900\t700\t0');
  assert.strictEqual(matchWindow(wins, 'chrome').rect.l, -1920, 'Chrome is on the monitor to the left');
  assert.strictEqual(matchWindow(wins, 'brave').rect.l, 0);
  assert.strictEqual(matchWindow(wins, 'vs code', 'vscode').proc, 'code');
  assert.strictEqual(matchWindow(wins, 'nexora'), null, 'never looks at itself');
  assert.strictEqual(matchWindow(wins, 'discord'), null);
  const yes = ['ok', 'OK da!', 'okay', 'allow', 'seri', 'sari da', 'Yes allow it', 'ok that allow these session only', 'go ahead', 'சரி', 'ஓகே', 'allow for this session'];
  for (const t of yes) assert.strictEqual(voiceDecision(t), 'allow', t);
  assert.strictEqual(voiceDecision('always allow'), 'always');
  for (const t of ['no', 'deny', 'venam', 'வேண்டாம்', "don't allow", 'cancel']) assert.strictEqual(voiceDecision(t), 'deny', t);
  for (const t of ['ok open chrome and then close it', 'what is the weather', 'ok so can you tell me a joke', 'hello', '', 'it']) assert.strictEqual(voiceDecision(t), null, `not an answer: ${t}`);

  // ---------- 5. voice approval through the service (typed "ok" too) ----------
  const dir = tmp(); const clicks = []; const cfgData = { autonomy: JSON.parse(JSON.stringify(AUTONOMY_DEFAULTS)) };
  const cfg = { get: (k) => k.split('.').reduce((o, x) => (o == null ? undefined : o[x]), cfgData), set: (k, val) => { const a = k.split('.'); let o = cfgData; for (const x of a.slice(0, -1)) o = o[x] = o[x] || {}; o[a.at(-1)] = val; return true; } };
  let pendingCard = { id: 'c1', kind: 'approval', title: 'Open Discord', buttons: [{ id: 'allow', label: 'Allow for this session' }, { id: 'always', label: 'Always allow' }, { id: 'deny', label: 'Deny' }] };
  const cards = { pending: () => pendingCard, click: (id, b) => { clicks.push([id, b]); pendingCard = null; }, show: () => ({ id: 'x', promise: Promise.resolve() }), ask: async () => 'allow', notify() {}, update() {}, close() {}, closeKind() {}, destroy() {} };
  const svc = new AutonomyService({ electron: { shell: {}, clipboard: {}, app: { getPath: () => dir } }, configService: cfg, pushToMain() {}, userDataDir: dir, execFile: (c, a, o, cb) => cb(null), folders: { home: dir }, cards, platform: 'win32', env: { ProgramData: pd, APPDATA: ad } });
  assert(svc.hasPendingApproval());
  assert(!svc.voiceApprove('ok open chrome and tell me the news').handled, 'a long sentence never approves');
  assert(svc.voiceApprove('ok da').handled); assert.deepStrictEqual(clicks.at(-1), ['c1', 'allow']);
  pendingCard = { id: 'c2', kind: 'approval', title: 'Open Chrome', buttons: [{ id: 'allow' }, { id: 'deny' }] }; assert(svc.voiceApprove('venam').handled); assert.deepStrictEqual(clicks.at(-1), ['c2', 'deny']);
  pendingCard = { id: 'c3', kind: 'approval', title: 'Create folder', buttons: [{ id: 'allow' }, { id: 'deny' }] }; svc.voiceApprove('always allow'); assert.deepStrictEqual(clicks.at(-1), ['c3', 'allow'], '"always" only when the card offers it');
  pendingCard = { id: 'c4', kind: 'plan', title: 'plan', buttons: [{ id: 'run' }, { id: 'cancel' }] }; svc.voiceApprove('seri'); assert.deepStrictEqual(clicks.at(-1), ['c4', 'run']);
  pendingCard = { id: 'c5', kind: 'plan', title: 'plan', buttons: [{ id: 'run' }, { id: 'cancel' }] }; svc.voiceApprove('no'); assert.deepStrictEqual(clicks.at(-1), ['c5', 'cancel']);
  pendingCard = { id: 'c6', kind: 'approval', title: 'x', buttons: [{ id: 'allow' }] }; cfg.set('autonomy.voiceApproval', false); assert(!svc.voiceApprove('ok').handled, 'the switch turns it off'); cfg.set('autonomy.voiceApproval', true);
  pendingCard = null; assert(!svc.voiceApprove('ok').handled && !svc.hasPendingApproval(), 'no card, nothing to answer');
  assert(svc.handleText('/do open discord').handled);

  // ---------- 6. per-monitor screen capture ----------
  const mkDisplay = (id, x) => ({ id, bounds: { x, y: 0, width: 1920, height: 1080 }, workArea: { x, y: 0, width: 1920, height: 1040 } });
  const displays = [mkDisplay(1, 0), mkDisplay(2, -1920)];
  const grabbed = [];
  const screenApi = { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0], getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: (pt) => displays.find((d) => pt.x >= d.bounds.x && pt.x < d.bounds.x + d.bounds.width) || displays[0], screenToDipPoint: (pt) => pt };
  const shot = (name) => ({ display_id: name, thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from(`img-${name}`) } });
  const desktopCapturer = { getSources: async (o) => { grabbed.push(o); return [shot('1'), shot('2')]; } };
  const winText = 'chrome\tFix - Google Chrome\t-1900\t10\t-100\t1000\t0\nbrave\tNew Tab - Brave\t50\t10\t1500\t900\t1';
  const svc2 = new AutonomyService({ electron: { shell: {}, clipboard: {}, app: { getPath: () => dir }, desktopCapturer, screen: screenApi }, configService: cfg, pushToMain() {}, userDataDir: dir, execFile: (c, a, o, cb) => cb(null), folders: { home: dir }, cards, platform: 'win32', env: {} });
  svc2.ps = async () => winText;
  let cap = await svc2.captureScreen({ kind: 'all' }); assert.strictEqual(cap.shots.length, 2, '"my screen" = every monitor'); assert(/Monitor 1 \(main\)/.test(cap.shots[0].label) && /Monitor 2 of 2/.test(cap.shots[1].label));
  cap = await svc2.captureScreen({ kind: 'app', app: 'chrome' }); assert.strictEqual(cap.shots.length, 1); assert.strictEqual(Buffer.from(cap.shots[0].base64, 'base64').toString(), 'img-2', 'Chrome screen = the left monitor'); assert(/chrome window \(monitor 2/.test(cap.shots[0].label));
  cap = await svc2.captureScreen({ kind: 'app', app: 'brave' }); assert.strictEqual(Buffer.from(cap.shots[0].base64, 'base64').toString(), 'img-1', 'Brave screen = the main monitor');
  cap = await svc2.captureScreen({ kind: 'app', app: 'discord' }); assert(/can't see an open discord window/i.test(cap.error));
  cap = await svc2.captureScreen({ kind: 'cursor' }); assert.strictEqual(cap.shots.length, 1);
  // explainScreen sends labelled images and names the screens
  const sent = []; svc2.screen.getApiKey = () => 'k'; svc2.screen.getModels = async () => ['gemini-2.5-flash']; svc2.screen.fetchImpl = async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Two screens.' }] } }] }) }; };
  let res = await svc2.explainScreen({ source: 'voice', target: 'all' }); assert(res.success); const parts = sent.at(-1).contents[0].parts; assert.strictEqual(parts.filter((x) => x.inlineData).length, 2); assert(parts.some((x) => /Monitor 2/.test(x.text || '')));
  res = await svc2.explainScreen({ source: 'voice', target: 'brave' }); assert(res.success); assert.strictEqual(sent.at(-1).contents[0].parts.filter((x) => x.inlineData).length, 1);
  res = await svc2.explainScreen({ source: 'voice', target: 'discord' }); assert(!res.success && /discord/i.test(res.error));
  assert(svc2.handleText('see the brave screen').handled && svc2.handleText('explain my chrome screen').handled && svc2.handleText('explain my screen').handled);

  // ---------- 7. Live wake: the command spoken with / right after the wake word is kept ----------
  let w = matchWakePhrase('Hey Nexora, open Chrome'); assert(w.matched && w.command === 'open chrome', JSON.stringify(w));
  assert.strictEqual(matchWakePhrase('hey nexora').command, ''); assert(!matchWakePhrase('next thing please').matched);
  { const ends = []; const d = new WakeClipDetector((clip, meta) => { ends.push(meta.endedAt); return Promise.resolve(); });
    const loud = Buffer.alloc(1280); for (let i = 0; i < 640; i++) loud.writeInt16LE(i % 2 ? 9000 : -9000, i * 2); const quiet = Buffer.alloc(1280);
    for (let i = 0; i < 12; i++) d.feed(loud); for (let i = 0; i < 20; i++) d.feed(quiet); await sleep(5); assert.strictEqual(ends.length, 1); assert(Math.abs(ends[0] - Date.now()) < 1000, 'the clip end time is passed along'); }
  { const vs = Object.create(VoiceService.prototype); const sentMsgs = [];
    let fed = 0; Object.assign(vs, { wakeEnabled: true, liveReady: false, liveConnecting: false, pendingAudio: [], wakeWord: { feed: (b) => { fed += b.length; } } });
    const pcm = Buffer.alloc(640).toString('base64');
    for (let i = 0; i < 5; i++) vs.pushAudio(pcm); assert.strictEqual(fed, 5 * 640, 'standby mic audio goes to the offline ONNX wake detector');
    vs.liveConnecting = true; for (let i = 0; i < 300; i++) vs.pushAudio(pcm); assert.strictEqual(vs.pendingAudio.length, 240, 'audio spoken while Live connects is queued (was 18 chunks = under a second)'); }
  console.log('  v0.3.10 apps / drives / voice approval / monitors / wake tail ok');
})().catch((e) => { console.error(e); process.exit(1); });
