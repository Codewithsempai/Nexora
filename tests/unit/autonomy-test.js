/* Unit tests for the v0.3.8 autonomy engine (no real Electron / Windows needed: every system call is injected). */
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const Module = require('module'); const orig = Module._load;
const created = []; const ipc = {};
Module._load = function (r, ...a) {
  if (r === 'electron') return {
    ipcMain: { on: (ch, fn) => { ipc[ch] = fn; } }, screen: { getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1366, height: 727 } }) },
    BrowserWindow: class { constructor(o) { this.o = o; this.visible = false; this.sent = []; this.b = { ...o }; created.push(this); this.webContents = { send: (c, p) => this.sent.push([c, p]), on: (e, f) => { if (e === 'did-finish-load') this.load = f; }, setWindowOpenHandler() {} }; }
      setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} on() {} loadFile() { setTimeout(() => this.load && this.load(), 0); } setBounds(b) { this.b = b; } setIgnoreMouseEvents() {} isDestroyed() { return false; } isVisible() { return this.visible; } showInactive() { this.visible = true; } hide() { this.visible = false; } destroy() {} },
  };
  return orig.call(this, r, ...a);
};
const { ActionLog } = require('../../src/main/autonomy/action-log');
const { ActionExecutor } = require('../../src/main/autonomy/actions');
const { Policy, ApprovalGate } = require('../../src/main/autonomy/policy');
const { validatePlan, localPlan, planWithGemini } = require('../../src/main/autonomy/planner');
const { Agent } = require('../../src/main/autonomy/agent');
const { Proactive } = require('../../src/main/autonomy/proactive');
const { runUpkeep } = require('../../src/main/autonomy/memory-upkeep');
const { ScreenHelp } = require('../../src/main/autonomy/screen-help');
const { Watchers, looksLikeError } = require('../../src/main/autonomy/watchers');
const { CardCenter } = require('../../src/main/autonomy/card-center');
const { AutonomyService } = require('../../src/main/autonomy');
const { AUTONOMY_DEFAULTS, isQuietHour } = require('../../src/main/autonomy/defaults');
const { MemoryStore } = require('../../src/main/services/memory-store');
const { ReminderService } = require('../../src/main/services/reminder-service');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-auto-'));
const sleep = (ms = 15) => new Promise((r) => setTimeout(r, ms));
class FakeConfig { constructor(over = {}) { this.data = { autonomy: JSON.parse(JSON.stringify(AUTONOMY_DEFAULTS)) }; for (const [k, v] of Object.entries(over)) this.set(k, v); }
  get(p) { const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  set(p, v) { const k = p.split('.'); let o = this.data; for (const x of k.slice(0, -1)) { if (typeof o[x] !== 'object' || o[x] === null) o[x] = {}; o = o[x]; } o[k.at(-1)] = v; return true; } }
class FakeCards { constructor(answer = () => 'allow') { this.answer = answer; this.shown = []; this.closed = []; this.seq = 0; this.updates = []; }
  show(def) { const id = `f${++this.seq}`; this.shown.push({ id, ...def }); return { id, promise: Promise.resolve('x') }; }
  ask(def) { this.shown.push(def); return Promise.resolve(this.answer(def)); } notify(def) { this.shown.push({ ...def, notify: true }); return { id: 'n' }; }
  update(id, p) { this.updates.push([id, p]); return true; } close(id) { this.closed.push(id); } closeKind() {} destroy() {} }
const home = tmp(); const folders = { home, downloads: path.join(home, 'Downloads'), documents: path.join(home, 'Documents'), desktop: path.join(home, 'Desktop'), pictures: path.join(home, 'Pictures') };
for (const f of Object.values(folders)) fs.mkdirSync(f, { recursive: true });
const mkExec = (extra = {}) => { const calls = []; const clip = { text: '', readText() { return this.text; }, writeText(t) { this.text = t; } };
  const ex = new ActionExecutor({ shell: { openPath: async (p) => { calls.push(['openPath', p]); return ''; }, openExternal: async (u) => { calls.push(['openExternal', u]); } }, clipboard: clip, execFile: (cmd, args, o, cb) => { calls.push(['exec', cmd, ...args]); cb(null); }, folders, platform: 'win32', ...extra }); return { ex, calls, clip }; };

(async () => {
  // ---------- defaults / quiet hours ----------
  assert(isQuietHour(new Date(2026, 10, 21, 23).getTime())); assert(isQuietHour(new Date(2026, 10, 21, 3).getTime())); assert(!isQuietHour(new Date(2026, 10, 21, 13).getTime()));

  // ---------- action log ----------
  { const file = path.join(tmp(), 'log.json'); let t = 1000; const log = new ActionLog({ filePath: file, now: () => t }); log.add({ kind: 'action', action: 'open_app', summary: 'Opened VS Code' }); t = 5000; log.add({ kind: 'task', summary: 'x', ok: false });
    assert.strictEqual(log.list()[0].at, 5000, 'newest first'); assert.strictEqual(log.between(0, 2000).length, 1);
    assert.strictEqual(new ActionLog({ filePath: file }).list().length, 2, 'persisted'); log.clear(); assert.strictEqual(new ActionLog({ filePath: file }).list().length, 0); }

  // ---------- executor: validation is the safety layer ----------
  { const { ex, calls, clip } = mkExec();
    assert(ex.validate('open_url', { url: 'https://example.com/a' }).ok);
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'ftp://x.com', 'not a url']) assert(!ex.validate('open_url', { url: bad }).ok, bad);
    assert(!ex.validate('open_app', { name: 'powershell -c calc & del *' }).ok); assert(ex.validate('open_app', { name: 'VS Code' }).args.name === 'vscode'); assert(!ex.validate('format_disk', {}).ok);
    for (const bad of ['..', '../x', 'a/b', 'a\\b', 'con:', '']) assert(!ex.validate('create_folder', { name: bad, parent: 'documents' }).ok, `name ${bad}`);
    assert(!ex.validate('create_folder', { name: 'ok', parent: 'home' }).ok, 'only documents/desktop/downloads');
    const outside = path.join(os.tmpdir(), 'evil.zip'); fs.writeFileSync(outside, 'x'); assert(!ex.validate('extract_zip', { path: outside }).ok, 'zip outside safe roots');
    assert(!ex.validate('open_in_vscode', { path: path.join(os.tmpdir()) }).ok, 'outside home');
    fs.mkdirSync(path.join(folders.documents, 'a&b')); assert(!ex.validate('open_in_vscode', { path: path.join(folders.documents, 'a&b') }).ok, 'shell metacharacters refused');
    let r = await ex.run('create_folder', { name: 'nexora-test', parent: 'desktop' }); assert(r.ok && fs.existsSync(path.join(folders.desktop, 'nexora-test')));
    r = await ex.run('open_in_vscode', { path: path.join(folders.desktop, 'nexora-test') }); assert(r.ok); assert.deepStrictEqual(calls.at(-1).slice(0, 3), ['exec', 'cmd.exe', '/c']); assert.strictEqual(calls.at(-1)[3], 'code');
    r = await ex.run('open_app', { name: 'chrome' }); assert.deepStrictEqual(calls.at(-1), ['exec', 'cmd.exe', '/c', 'start', '', 'chrome']);
    r = await ex.run('open_url', { url: 'https://example.com' }); assert.deepStrictEqual(calls.at(-1), ['openExternal', 'https://example.com/']);
    fs.writeFileSync(path.join(folders.downloads, 'Quarterly Report final.pdf'), 'x'); fs.mkdirSync(path.join(folders.documents, 'deep', 'er'), { recursive: true }); fs.writeFileSync(path.join(folders.documents, 'deep', 'er', 'report notes.txt'), 'x');
    r = await ex.run('search_files', { query: 'report', folder: 'all' }); assert.strictEqual(r.data.files.length, 2, 'finds files by words in all safe roots');
    r = await ex.run('clipboard_write', { text: 'hello' }); assert(r.ok && clip.text === 'hello'); r = await ex.run('clipboard_read', {}); assert.strictEqual(r.data.text, 'hello');
    const zip = path.join(folders.downloads, 'proj.zip'); fs.writeFileSync(zip, 'zip'); r = await ex.run('extract_zip', { path: zip }); assert(r.ok); assert.deepStrictEqual(calls.at(-1).slice(0, 2), ['exec', 'tar']);
    assert(fs.existsSync(path.join(folders.downloads, 'proj')), 'extract target created next to the zip');
    const lin = mkExec({ platform: 'linux' }).ex; assert(!(await lin.run('open_app', { name: 'chrome' })).ok, 'open_app is Windows-only'); }

  // ---------- policy + approval gate ----------
  { const cfg = new FakeConfig(); const policy = new Policy(cfg); const { ex } = mkExec(); const log = new ActionLog({ filePath: path.join(tmp(), 'l.json') });
    assert.strictEqual(policy.level('open_url'), 'once'); assert.strictEqual(policy.level('create_folder'), 'ask'); assert(!policy.set('nope', 'always').success); assert(!policy.set('open_url', 'sometimes').success);
    let cards = new FakeCards(() => 'allow'); let gate = new ApprovalGate({ policy, cards, log, describe: (a, x) => ex.describe(a, x) });
    let d = await gate.request('open_url', { url: 'https://a.com/' }); assert(d.allowed && d.via === 'user' && cards.shown.length === 1);
    d = await gate.request('open_url', { url: 'https://b.com/' }); assert(d.allowed && d.via === 'session' && cards.shown.length === 1, 'once = asked a single time per session');
    d = await gate.request('create_folder', { name: 'x', parent: 'documents' }); assert(d.allowed && cards.shown.length === 2); d = await gate.request('create_folder', { name: 'y', parent: 'documents' }); assert(cards.shown.length === 3, 'ask = every time');
    assert(!cards.shown[2].buttons.some((b) => b.id === 'always'), 'medium risk offers no one-click Always');
    cards = new FakeCards(() => 'deny'); gate = new ApprovalGate({ policy: new Policy(new FakeConfig()), cards, log, describe: (a, x) => ex.describe(a, x) }); d = await gate.request('open_app', { name: 'chrome' }); assert(!d.allowed && d.via === 'denied');
    cards = new FakeCards(() => 'timeout'); gate = new ApprovalGate({ policy: new Policy(new FakeConfig()), cards, log, describe: (a, x) => ex.describe(a, x) }); d = await gate.request('open_app', { name: 'chrome' }); assert(!d.allowed && d.via === 'timeout', 'no answer never means yes');
    const c2 = new FakeConfig({ 'autonomy.permissions.open_app': 'always', 'autonomy.permissions.open_url': 'deny' }); cards = new FakeCards(() => { throw new Error('must not ask'); }); gate = new ApprovalGate({ policy: new Policy(c2), cards, log, describe: (a, x) => ex.describe(a, x) });
    assert((await gate.request('open_app', { name: 'chrome' })).via === 'always'); assert(!(await gate.request('open_url', { url: 'https://x.com/' })).allowed, 'deny level blocks without asking');
    const c3 = new FakeConfig(); cards = new FakeCards(() => 'always'); gate = new ApprovalGate({ policy: new Policy(c3), cards, log, describe: (a, x) => ex.describe(a, x) }); await gate.request('open_app', { name: 'chrome' }); assert.strictEqual(c3.get('autonomy.permissions.open_app'), 'always', '"Always allow" is saved');
    assert((await gate.request('open_app', { name: 'edge' }, { implied: true })).allowed); }

  // ---------- planner ----------
  { const { ex } = mkExec(); let p = localPlan('open VS Code and Chrome', ex); assert.deepStrictEqual(p.steps.map((s) => s.action), ['open_app', 'open_app']);
    p = localPlan('please open downloads folder', ex); assert.strictEqual(p.steps[0].action, 'open_folder'); p = localPlan('open github.com', ex); assert.strictEqual(p.steps[0].args.url, 'https://github.com/');
    p = localPlan('find files for resume', ex); assert.strictEqual(p.steps[0].action, 'search_files'); assert.strictEqual(localPlan('open the pod bay doors', ex), null); assert.strictEqual(localPlan('delete everything', ex), null);
    const v = validatePlan({ steps: [{ action: 'rm_rf', args: {} }, { action: 'open_url', args: { url: 'javascript:1' } }, { action: 'open_app', args: { name: 'notepad' } }] }, ex); assert.strictEqual(v.steps.length, 1); assert.strictEqual(v.dropped.length, 2);
    assert.strictEqual(validatePlan({ steps: Array.from({ length: 20 }, () => ({ action: 'open_app', args: { name: 'notepad' } })) }, ex, 5).steps.length, 5, 'step limit');
    const fetchImpl = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n{"steps":[{"action":"create_folder","args":{"name":"nexora-test","parent":"desktop"},"why":"new project"},{"action":"hack","args":{}}],"say":"seri"}\n```' }] } }] }) });
    const g = await planWithGemini({ apiKey: 'k', goal: 'make folder', executor: ex, fetchImpl }); assert.strictEqual(g.steps.length, 1); assert.strictEqual(g.say, 'seri');
    assert.strictEqual((await planWithGemini({ apiKey: '', goal: 'x', executor: ex })).error, 'no-key'); }

  // ---------- agent ----------
  { const { ex, calls } = mkExec(); const log = new ActionLog({ filePath: path.join(tmp(), 'a.json') });
    const mk = (answer, extra = {}) => { const cards = new FakeCards(answer); const gate = new ApprovalGate({ policy: new Policy(new FakeConfig(extra)), cards, log, describe: (a, x) => ex.describe(a, x) }); return { cards, agent: new Agent({ executor: ex, gate, cards, log, getApiKey: () => null }) }; };
    let { agent, cards } = mk((c) => (c.kind === 'plan' ? 'run' : 'allow'));
    let r = await agent.run('open notepad and chrome'); assert(r.success && r.steps.length === 2, r.summary); assert(cards.shown.some((c) => c.kind === 'plan'), 'multi-step shows a plan card'); assert(calls.filter((c) => c[0] === 'exec' && c[3] === 'start').length >= 2);
    assert(!agent.isRunning());
    ({ agent, cards } = mk(() => 'cancel')); r = await agent.run('open notepad and chrome'); assert(r.cancelled && !r.success);
    ({ agent, cards } = mk((c) => (c.kind === 'plan' ? 'run' : 'deny'), { 'autonomy.permissions.open_app': 'ask' })); r = await agent.run('open notepad and chrome'); assert(!r.success && /Stopped at step 1/.test(r.summary), r.summary);
    ({ agent, cards } = mk((c) => (c.kind === 'plan' ? 'run' : 'deny'))); r = await agent.run('open notepad and chrome'); assert(r.success, 'approving the plan covers once-level steps');
    ({ agent, cards } = mk(() => 'allow')); r = await agent.run('open notepad'); assert(r.success && !cards.shown.some((c) => c.kind === 'plan'), 'one step = only the approval card');
    ({ agent, cards } = mk(() => 'allow')); r = await agent.run('do my taxes'); assert(!r.success && /Gemini|cannot/i.test(r.summary), 'unplannable without a key says so');
    // stop word + stop during a run
    { let release; const gateFn = async () => { await new Promise((res) => { release = res; }); return { allowed: true, via: 'user' }; };
      const cards2 = new FakeCards(() => 'run'); const ag = new Agent({ executor: ex, gate: { request: gateFn }, cards: cards2, log, getApiKey: () => null });
      assert(!ag.isStopPhrase('stop'), 'stop phrase ignored when nothing runs'); const running = ag.run('open notepad and chrome'); await sleep(30);
      assert(ag.isRunning() && ag.isStopPhrase('Nexora, stop') && !ag.isStopPhrase('please stop talking about the weather and tell me a long story now ok')); assert((await ag.run('open edge')).summary.includes('already running'));
      ag.stop(); release(); const res = await running; assert(!res.success && /Stopped by you/.test(res.summary), res.summary); assert(!ag.isRunning()); }
    ({ agent, cards } = mk(() => 'allow')); agent.getLimits = () => ({ maxSteps: 1 }); r = await agent.run('open notepad and chrome'); assert(r.steps.length <= 1, 'maxSteps respected'); }

  // ---------- proactive ----------
  { const dir = tmp(); let t = new Date(2026, 10, 21, 9, 0).getTime(); const cfg = new FakeConfig(); const cards = new FakeCards(() => 'reminders');
    const mem = new MemoryStore({ filePath: path.join(dir, 'm.vault'), safeStorage: { isEncryptionAvailable: () => false } }); mem.add('personal', "The user's name is Daya", { key: 'name', value: 'Daya' }); mem.add('projects', 'The user is working on updating Nexora');
    const rs = new ReminderService({ filePath: path.join(dir, 'r.json'), now: () => t }); const r1 = rs.add({ text: 'submit report', dueAt: t + 3600000 }).item;
    const opened = []; const pro = new Proactive({ cards, reminderService: rs, memoryStore: mem, config: cfg, log: null, now: () => t, openPanel: (p) => opened.push(p) });
    const brief = pro.buildBrief(); assert.strictEqual(brief.title, 'Good morning, Daya!'); assert(brief.lines.some((l) => /10:00 — submit report/.test(l))); assert(brief.lines.some((l) => /Project: Working on updating Nexora/i.test(l)));
    assert(await pro.showBrief()); assert.deepStrictEqual(opened, ['reminder']); assert(!(await pro.showBrief()), 'only once per day'); assert(await pro.showBrief({ force: true }));
    t = new Date(2026, 10, 22, 23, 0).getTime(); assert(!(await pro.showBrief()), 'quiet hours: no brief');
    // nudge after two snoozes
    t = new Date(2026, 10, 21, 11, 0).getTime(); rs.snooze(r1.id, 10); t += 1000; rs.snooze(r1.id, 10);
    const cards2 = new FakeCards(() => 'tom'); const pro2 = new Proactive({ cards: cards2, reminderService: rs, memoryStore: mem, config: cfg, now: () => t }); await pro2.tick(); await sleep();
    assert(cards2.shown.some((c) => /snoozed/.test(c.title)), 'nudge shown'); assert(rs.list().find((i) => i.id === r1.id).dueAt > t + 3600000 * 12, 'moved to tomorrow 9 AM'); await pro2.tick(); await sleep(); assert.strictEqual(cards2.shown.length, 1, 'no repeat nudge');
    // later
    const r2 = rs.add({ text: 'call mom', dueAt: t + 1000 }).item; t += 2000; rs.tick(t); const cards3 = new FakeCards(() => 'h1'); const pro3 = new Proactive({ cards: cards3, reminderService: rs, memoryStore: mem, config: cfg, now: () => t });
    assert(!pro3.maybeLater('what is the weather')); assert(pro3.maybeLater('apram pannren')); await sleep(); assert(rs.list().find((i) => i.id === r2.id).dueAt >= t + 3500000, 'rescheduled +1h');
    // habits (opt-in)
    const c4 = new FakeConfig({ 'autonomy.habits.water.enabled': true, 'autonomy.habits.water.everyMin': 30 }); const cards4 = new FakeCards(() => 'ok'); const pro4 = new Proactive({ cards: cards4, reminderService: new ReminderService({ filePath: path.join(dir, 'empty.json'), now: () => t }), memoryStore: mem, config: c4, now: () => t });
    assert.strictEqual(await pro4.tick(), 0); t += 31 * 60000; assert.strictEqual(await pro4.tick(), 1); await sleep(); assert(/Water/.test(cards4.shown.at(-1).title)); }

  // ---------- memory upkeep ----------
  { const dir = tmp(); const day = 86400000; let t = new Date(2026, 10, 21, 10).getTime(); const cfg = new FakeConfig();
    const mem = new MemoryStore({ filePath: path.join(dir, 'm.vault'), safeStorage: { isEncryptionAvailable: () => false } });
    mem.add('knowledge', 'Tea is good'); const raw = mem.readAll().items; raw.push({ ...raw[0], id: 'dup-1', text: 'tea is good!', updatedAt: raw[0].updatedAt - 5 }); mem.write(raw);
    mem.add('conversations', 'old chat note'); mem.add('personal', 'The user lives in Tiruchirappalli', { key: 'location', value: 'Tiruchirappalli' });
    const all = mem.readAll().items; all.find((i) => i.text === 'old chat note').updatedAt = t - 60 * day; all.find((i) => i.key === 'location').updatedAt = t - 120 * day; mem.write(all);
    const rs = new ReminderService({ filePath: path.join(dir, 'r.json'), now: () => t - day }); const rem = rs.add({ text: 'study', dueAt: t - day + 1000 }).item; rs.tick(t - day + 2000); rs.done(rem.id);
    const log = new ActionLog({ filePath: path.join(dir, 'l.json'), now: () => t - day + 5000 }); log.add({ kind: 'action', action: 'open_app', summary: 'Opened VS Code', ok: true });
    const cards = new FakeCards(() => 'no'); const opened = [];
    const out = await runUpkeep({ memoryStore: mem, reminderService: rs, log, cards, config: cfg, now: () => t, openPanel: (p) => opened.push(p) });
    assert.strictEqual(out.deduped, 1, 'duplicate merged'); assert.strictEqual(out.retired, 1, 'stale chat note retired'); assert(/^Daily summary 2026-11-20: .*ran 1 action.*completed 1 reminder/.test(out.summary), out.summary);
    assert.deepStrictEqual(out.asked.answer, 'no'); assert(!mem.readAll().items.some((i) => i.key === 'location'), '"No, remove" removes the fact only after the tap'); assert(cards.shown[0].title === 'Is this still true?');
    const again = await runUpkeep({ memoryStore: mem, reminderService: rs, log, cards, config: cfg, now: () => t }); assert.strictEqual(again.summary, null, 'one summary per day'); assert.strictEqual(again.asked, null, 'one question per day');
    const off = new FakeConfig({ 'autonomy.memoryUpkeep': false }); assert.strictEqual((await runUpkeep({ memoryStore: mem, config: off, now: () => t })).deduped, 0); }

  // ---------- screen help ----------
  { let t = 1e12; const cards = new FakeCards(() => 'close'); const calls = []; const cfg = new FakeConfig({ 'autonomy.screenWatch': true });
    const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Terminal-la error: module missing. 1. npm install' }] } }] }) }; };
    const sh = new ScreenHelp({ cards, config: cfg, getApiKey: () => 'key', getModels: async () => ['gemini-2.5-flash'], capture: async () => ({ base64: 'QUJD', mime: 'image/jpeg' }), fetchImpl, now: () => t, getIdleSeconds: () => 5 });
    const r = await sh.explainScreen(); assert(r.success && /module missing/.test(r.text)); assert(calls[0].contents[0].parts[0].inlineData.data === 'QUJD'); assert(cards.shown.some((c) => c.label === 'SCREEN HELP' && c.buttons?.length)); assert(!(await new ScreenHelp({ cards, config: new FakeConfig({ 'autonomy.screenHelp': false }), capture: async () => ({}) }).explainScreen()).success);
    assert.strictEqual((await new ScreenHelp({ cards, config: cfg, getApiKey: () => null, capture: async () => ({ base64: 'x' }) }).explainScreen()).error.includes('API key'), true);
    assert.strictEqual(await sh.watchStep('NEXORA — Holographic'), null); assert.strictEqual(await sh.watchStep('server.js — Unhandled Exception - VS Code'), 'error'); assert.strictEqual(await sh.watchStep('server.js — Unhandled Exception - VS Code'), null, 'no repeat');
    t += 21 * 60000; assert.strictEqual(await sh.watchStep('server.js — VS Code'), null); t += 21 * 60000; assert.strictEqual(await sh.watchStep('server.js — VS Code'), 'stuck');
    assert.strictEqual(await new ScreenHelp({ cards, config: new FakeConfig(), now: () => t }).watchStep('Fatal error'), null, 'watcher is off by default'); }

  // ---------- watchers ----------
  { assert(looksLikeError('Traceback (most recent call last):\n  File "a.py", line 1, in <module>\nValueError: bad')); assert(looksLikeError("TypeError: Cannot read properties of undefined (reading 'x')")); assert(!looksLikeError('Meeting at 5 PM about the error budget')); assert(!looksLikeError('short Error'));
    let t = 1e12; const cfg = new FakeConfig({ 'autonomy.watchers.clipboardErrors': true }); const clip = { text: '', readText() { return this.text; } }; const explained = []; const cards = new FakeCards(() => 'explain');
    const w = new Watchers({ cards, config: cfg, clipboard: clip, explainText: async (x) => explained.push(x), now: () => t, folders });
    assert.strictEqual(w.checkClipboard(), null); clip.text = 'ModuleNotFoundError: No module named "flask" while importing app'; assert.strictEqual(w.checkClipboard(), 'offered'); await sleep(); assert.strictEqual(explained.length, 1); assert.strictEqual(w.checkClipboard(), null, 'same text is not offered twice');
    w.ignoreNext('Traceback (most recent call last): NEXORA copied this itself TypeError'); clip.text = 'Traceback (most recent call last): NEXORA copied this itself TypeError'; t += 120000; assert.strictEqual(w.checkClipboard(), null, 'own clipboard writes are ignored');
    assert.strictEqual(new Watchers({ cards, config: new FakeConfig(), clipboard: clip, now: () => t }).checkClipboard(), null, 'clipboard watcher off by default');
    // downloads
    const ran = []; const w2 = new Watchers({ cards: new FakeCards(() => 'extract'), config: new FakeConfig(), folders, runAction: async (a, args, o) => { ran.push([a, args, o]); return { ok: true, summary: 'Extracted' }; } });
    const z = path.join(folders.downloads, 'new-build.zip'); fs.writeFileSync(z, Buffer.alloc(500, 1)); const outcome = await w2.settle('new-build.zip'); await sleep(); assert.strictEqual(outcome, 'extract'); assert.strictEqual(ran[0][0], 'extract_zip'); assert.strictEqual(ran[0][2].implied, true); assert.strictEqual(await w2.settle('new-build.zip'), null, 'same file not offered twice');
    // battery + disk
    let batt = { percent: 18, charging: false }; const c5 = new FakeCards(); const cfg5 = new FakeConfig(); let t5 = new Date(2026, 10, 21, 14).getTime(); const w3 = new Watchers({ cards: c5, config: cfg5, log: null, getBattery: async () => batt, getDiskFree: async () => ({ freeBytes: 3e9, totalBytes: 5e11, drive: 'C:' }), now: () => t5 });
    assert.strictEqual(await w3.checkBattery(), 'low'); assert.strictEqual(await w3.checkBattery(), null, 'cooldown'); batt = { percent: 8, charging: false }; assert.strictEqual(await w3.checkBattery(), 'critical'); batt = { percent: 5, charging: true }; t5 += 3600000; assert.strictEqual(await w3.checkBattery(), null, 'charging = no alert');
    assert.strictEqual(await w3.checkDisk(), 'low'); assert.strictEqual(await w3.checkDisk(), null, 'once a day'); }

  // ---------- card center (real class, mocked window) ----------
  { const cc = new CardCenter({}); const p = cc.ask({ kind: 'approval', label: 'X', title: 'Open Chrome', buttons: [{ id: 'allow', label: 'Allow', primary: true }, { id: 'deny', label: 'Deny' }] });
    await sleep(); const win = created.at(-1); assert(win.visible, 'window shown'); assert.strictEqual(win.b.x + win.b.width + 10, 1366, 'top-right'); assert(win.b.y <= 16);
    const cardId = win.sent.at(-1)[1][0].id; ipc['card:click']({ sender: win.webContents }, cardId, 'allow'); assert.strictEqual(await p, 'allow'); assert(!win.visible, 'hidden when no cards left');
    ipc['card:click']({ sender: {} }, cardId, 'allow'); // foreign sender ignored
    const q = cc.ask({ kind: 'approval', title: 'T', buttons: [{ id: 'a', label: 'A' }], timeoutMs: 30 }); assert.strictEqual(await q, 'timeout');
    const s = cc.show({ kind: 'task', title: 'Task', buttons: [{ id: 'stop', label: 'Stop' }], keepOpen: true, timeoutMs: 0, onButton: (id) => { s.pressed = id; } }); ipc['card:click']({ sender: created.at(-1).webContents }, s.id, 'stop'); assert.strictEqual(s.pressed, 'stop'); assert(cc.has(s.id), 'keepOpen stays'); assert(cc.update(s.id, { text: 'Step 2' })); cc.closeKind('task'); assert(!cc.has(s.id)); cc.destroy(); }

  // ---------- hub: typed chat / voice routing ----------
  { const dir = tmp(); const opened = []; const pushes = []; const spoken = []; const cards = new FakeCards(() => 'allow'); const cfg = new FakeConfig();
    const mem = new MemoryStore({ filePath: path.join(dir, 'm.vault'), safeStorage: { isEncryptionAvailable: () => false } }); const rs = new ReminderService({ filePath: path.join(dir, 'r.json') });
    const svc = new AutonomyService({ electron: { shell: { openExternal: async (u) => opened.push(u), openPath: async () => '' }, clipboard: { readText: () => '', writeText() {} }, app: { getPath: () => dir } }, configService: cfg, memoryStore: mem, reminderService: rs, pushToMain: (c, p) => pushes.push([c, p]), userDataDir: dir, execFile: (c, a, o, cb) => cb(null), folders, cards, platform: 'win32', speak: (t) => spoken.push(t) });
    assert(!svc.handleText('what is the weather').handled); const h = svc.handleText('/do open github.com'); assert(h.handled && /Task started/.test(h.text)); await sleep(40); assert.deepStrictEqual(opened, ['https://github.com/']); assert(svc.log.list().some((e) => e.kind === 'action' && e.ok), 'logged'); assert.deepStrictEqual(spoken, ['I opened github.com.'], 'typed tasks are confirmed out loud');
    assert(svc.handleText('explain my screen').handled, 'screen request is routed locally'); assert(svc.state().success && svc.state().permissions.length === 10); assert(svc.setPermission('open_url', 'always').success && cfg.get('autonomy.permissions.open_url') === 'always');
    assert((await svc.runAction('create_folder', { name: 'via-action', parent: 'documents' })).ok, 'runAction goes through the gate'); cfg.set('autonomy.agent.enabled', false); assert(!(await svc.runTask('open notepad')).success); }
  console.log('Autonomy tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
