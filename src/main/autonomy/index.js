/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy hub. Builds every autonomy part with its real (or injected) dependencies, starts / stops them,
 * and is the single object the IPC handlers, Live voice and typed chat talk to. */
const nodeFs = require('fs');
const nodePath = require('path');
const nodeOs = require('os');
const { AUTONOMY_DEFAULTS } = require('./defaults');
const { ActionLog } = require('./action-log');
const { ActionExecutor, ACTIONS, APPS } = require('./actions');
const { Policy, ApprovalGate } = require('./policy');
const { Agent } = require('./agent');
const { Proactive } = require('./proactive');
const { runUpkeep } = require('./memory-upkeep');
const { ScreenHelp } = require('./screen-help');
const { Watchers } = require('./watchers');
const { AppIndex } = require('./app-index');
const { watcherChoice } = require('./voice-choice');
const { parseScreenTarget, matchWindow, voiceDecision, WINDOW_SCRIPT, parseWindowLines } = require('./screen-target');
const { spokenLine } = require('./speech');

const psEncoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
const PS_TITLE = `Add-Type @"\nusing System; using System.Runtime.InteropServices; using System.Text;\npublic class NxW { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }\n"@\n$s = New-Object System.Text.StringBuilder 256; [void][NxW]::GetWindowText([NxW]::GetForegroundWindow(), $s, 256); $s.ToString()`;
const PS_BATTERY = `$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if ($b) { "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" }`;

const CHAT_TASK = /^\s*(?:\/(?:do|task)\s+|(?:task|do)\s*:\s*)(.{3,600})$/i;
const CHAT_SCREEN = /^\s*(?:hey\s+)?(?:nexora[\s,]+)?(?:please\s+)?(?:explain|check|look at|see|show|what'?s on|enna iruku)\s+(?:my\s+|the\s+|this\s+)?(?:(.{2,30}?)\s+)?(?:screen|window|monitor|display)\b/i;

class AutonomyService {
  /** deps: { electron, windowManager, configService, memoryStore, reminderService, readApiKey, textModels, pushToMain, userDataDir,
   *          execFile, fs, path, os, platform, fetchImpl, cards (tests) } */
  constructor(deps = {}) {
    this.deps = deps; this.config = deps.configService; this.fs = deps.fs || nodeFs; this.path = deps.path || nodePath; this.os = deps.os || nodeOs;
    this.platform = deps.platform || process.platform; this.push = deps.pushToMain || (() => {});
    const el = deps.electron || {}; this.electron = el;
    const execFile = deps.execFile || require('child_process').execFile;
    this.execFile = execFile;
    const pathOf = (name) => { try { return el.app?.getPath?.(name) || null; } catch { return null; } };
    const home = this.os.homedir();
    this.folders = deps.folders || { home, downloads: pathOf('downloads') || this.path.join(home, 'Downloads'), documents: pathOf('documents') || this.path.join(home, 'Documents'), desktop: pathOf('desktop') || this.path.join(home, 'Desktop'), pictures: pathOf('pictures') || this.path.join(home, 'Pictures') };

    this.log = deps.log || new ActionLog({ filePath: this.path.join(deps.userDataDir, 'action-log.json') });
    this.cards = deps.cards || new (require('./card-center').CardCenter)({ windowManager: deps.windowManager });
    this.appIndex = deps.appIndex || new AppIndex({ fs: this.fs, path: this.path, platform: this.platform, env: deps.env || process.env, ps: (script) => this.ps(script, 12000) });
    this.executor = new ActionExecutor({ shell: el.shell, clipboard: el.clipboard, execFile, folders: this.folders, platform: this.platform, fs: this.fs, path: this.path, appIndex: this.appIndex });
    this.policy = new Policy(this.config);
    this.gate = new ApprovalGate({ policy: this.policy, cards: this.cards, log: this.log, describe: (a, args) => this.executor.describe(a, args) });
    this.gate.voiceHint = () => this.config.get('autonomy.voiceApproval') !== false;
    const apiKey = () => (deps.readApiKey ? deps.readApiKey() : null);
    const models = async () => { try { const key = apiKey(); return key && deps.textModels ? await deps.textModels(key) : null; } catch { return null; } };
    this.agent = new Agent({
      executor: this.executor, gate: this.gate, cards: this.cards, log: this.log, getApiKey: apiKey, getModels: models, fetchImpl: deps.fetchImpl,
      getLimits: () => { const a = this.config.get('autonomy.agent') || {}; return { maxSteps: Math.max(1, Math.min(12, Number(a.maxSteps) || 8)), maxSeconds: Math.max(30, Math.min(600, Number(a.maxSeconds) || 180)) }; },
      homeHint: `home=${this.folders.home}, downloads=${this.folders.downloads}, documents=${this.folders.documents}, desktop=${this.folders.desktop}`,
      onState: (task) => this.push('autonomy:changed', { task }),
    });
    this.agent.voiceHint = () => this.config.get('autonomy.voiceApproval') !== false;
    this.log.onChange = () => this.push('autonomy:changed', { log: true });
    this.proactive = new Proactive({ cards: this.cards, reminderService: deps.reminderService, memoryStore: deps.memoryStore, config: this.config, log: this.log, openPanel: (p) => this.openPanel(p) });
    this.screen = new ScreenHelp({ cards: this.cards, config: this.config, log: this.log, clipboard: el.clipboard, getApiKey: apiKey, getModels: models, capture: deps.capture || ((t) => this.captureScreen(t)), getActiveTitle: () => this.activeTitle(), getIdleSeconds: () => { try { return el.powerMonitor?.getSystemIdleTime?.() || 0; } catch { return 0; } }, fetchImpl: deps.fetchImpl });
    this.watchers = new Watchers({ cards: this.cards, config: this.config, log: this.log, clipboard: el.clipboard, fs: this.fs, path: this.path, folders: this.folders, explainText: (t, o) => this.screen.explainText(t, o), runAction: (a, args, o) => this.runAction(a, args, o), speak: (t) => this.speak(t), voiceHint: () => this.config.get('autonomy.voiceApproval') !== false, openFolder: (p) => el.shell?.openPath?.(p), getBattery: () => this.battery(), getDiskFree: () => this.diskFree() });
    this.hotkey = null; this.upkeepTimer = null; this.upkeepBoot = null;
  }

  openPanel(name) { try { this.deps.windowManager?.show?.(); } catch { /* ignore */ } this.push('autonomy:open-panel', name); }

  // ---- system probes (Windows) -------------------------------------------------------------------------------
  ps(script, timeout = 6000) { return new Promise((resolve) => { if (this.platform !== 'win32') return resolve(''); try { this.execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)], { windowsHide: true, timeout }, (e, out) => resolve(e ? '' : String(out || '').trim())); } catch { resolve(''); } }); }
  activeTitle() { return this.ps(PS_TITLE, 5000); }
  async battery() { const out = await this.ps(PS_BATTERY, 8000); const m = /^(\d{1,3})\|(\d+)$/.exec(out); return m ? { percent: Number(m[1]), charging: [2, 6, 7, 8, 9].includes(Number(m[2])) } : null; }
  async diskFree() { try { const drive = this.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/'; const s = this.fs.statfsSync(drive); return { drive: drive.replace(/\\$/, ''), freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }; } catch { return null; } }
  /** Find the top-most visible window of an app (chrome, brave, vs code, discord…) -> { proc, title, rect:{l,t,r,b}, fg } or null. */
  async findWindow(app) {
    const out = await this.ps(WINDOW_SCRIPT, 9000);
    return matchWindow(parseWindowLines(out), app, this.executor.findApp?.(app)?.id || null);
  }
  /** Which Electron display holds this physical-pixel rectangle's centre? */
  displayOfRect(rect) {
    const { screen } = this.electron; if (!screen) return null;
    let pt = { x: Math.round((rect.l + rect.r) / 2), y: Math.round((rect.t + rect.b) / 2) };
    try { if (typeof screen.screenToDipPoint === 'function') pt = screen.screenToDipPoint(pt); } catch { /* already DIP */ }
    try { return screen.getDisplayNearestPoint(pt); } catch { return null; }
  }
  /** target: { kind: 'all' | 'cursor' | 'app', app? }.
   *  all (default for "my screen") = EVERY monitor, primary first; app = the monitor that app's window is on; cursor = the monitor under the mouse.
   *  Returns { shots:[{ base64, mime, label }] } | { error } | null. Kept in memory only. */
  async captureScreen(target = { kind: 'all' }) {
    const { desktopCapturer, screen } = this.electron; if (!desktopCapturer) return null;
    const all = (screen?.getAllDisplays?.() || [screen?.getPrimaryDisplay?.()]).filter(Boolean);
    const primaryId = String(screen?.getPrimaryDisplay?.()?.id ?? '');
    let chosen = all; let note = '';
    if (target.kind === 'app') {
      const win = await this.findWindow(target.app);
      if (!win) return { error: `I can't see an open ${target.app} window right now.` };
      const d = this.displayOfRect(win.rect); chosen = d ? [d] : all.slice(0, 1); note = `${target.app} window`;
    } else if (target.kind === 'cursor') {
      try { chosen = [screen.getDisplayNearestPoint(screen.getCursorScreenPoint())]; } catch { chosen = all.slice(0, 1); } note = 'screen under the mouse';
    }
    chosen = [...chosen].sort((a, b) => (String(b.id) === primaryId) - (String(a.id) === primaryId)).slice(0, 3);
    const size = chosen.length > 1 ? { width: 1600, height: 1000 } : { width: 1920, height: 1200 };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const shots = [];
    chosen.forEach((d) => {
      const idx = all.findIndex((x) => String(x.id) === String(d.id));
      const src = sources.find((x) => String(x.display_id) === String(d.id)) || (all.length === sources.length ? sources[idx] : null) || (chosen.length === 1 ? sources[0] : null);
      if (!src || src.thumbnail.isEmpty()) return;
      const label = note ? `${note} (monitor ${idx + 1}${String(d.id) === primaryId ? ', main' : ''})` : `Monitor ${idx + 1}${String(d.id) === primaryId ? ' (main)' : ''} of ${all.length}`;
      shots.push({ base64: src.thumbnail.toJPEG(75).toString('base64'), mime: 'image/jpeg', label });
    });
    return shots.length ? { shots } : null;
  }

  // ---- one approved action (cards, watchers, UI buttons) ---------------------------------------------------------
  async runAction(action, args, { implied = false, source = 'user' } = {}) {
    const checked = this.executor.validate(action, args);
    if (!checked.ok) return { ok: false, summary: checked.error };
    const decision = await this.gate.request(action, checked.args, { implied, source });
    if (!decision.allowed) return { ok: false, summary: decision.reason || 'Not allowed.' };
    if (action === 'clipboard_write') this.watchers.ignoreNext(checked.args.text);
    const result = await this.executor.run(action, checked.args);
    this.log.add({ kind: 'action', action, summary: result.summary, ok: result.ok, source, decision: decision.via });
    return result;
  }
  /** speak (default: yes unless the Live voice session reports the result itself) -> NEXORA says "I opened Calculator." out loud. */
  runTask(goal, { source = 'chat', speak = source !== 'voice' } = {}) {
    if (this.config.get('autonomy.agent.enabled') === false) return Promise.resolve({ success: false, summary: 'Tasks are turned off in the Autonomy tab.', steps: [] });
    const run = this.agent.run(goal, { source });
    if (speak) run.then((res) => this.speakResult(res)).catch(() => {});
    return run;
  }
  /** Out-loud confirmation for tasks started from chat / the Auto tab / watchers (the Live voice reports its own tasks). */
  speakResult(res) { const line = spokenLine(res); if (line) this.speak(line); }
  speak(text) { try { this.deps.speak?.(String(text).slice(0, 400)); } catch { /* speech is best effort */ } }
  stopTask() { return this.agent.stop(); }
  isStopPhrase(text) { return this.agent.isStopPhrase(text); }
  /** o: { source, target } — target is free text from voice / chat ("chrome", "brave", "all", "this screen") or an object. */
  explainScreen(o = {}) { const t = typeof o.target === 'string' ? parseScreenTarget(o.target) : (o.target || { kind: 'all' }); return this.screen.explainScreen({ ...o, target: t }); }

  /** Spoken (or typed) "ok / allow / no" while an approval or plan card is open -> presses the matching button. The words are
   *  matched in code against a short whitelist, so a long sentence that merely contains "ok" never approves anything. */
  voiceApprove(text) {
    if (this.config.get('autonomy.voiceApproval') === false) return { handled: false };
    const card = this.cards.pending?.(['approval', 'plan']);
    if (!card) {   // v0.3.13: a watcher card (NEW DOWNLOAD: Extract / Show folder / Ignore) can be answered by voice too
      const w = this.cards.pending?.(['watcher']); const pick = w ? watcherChoice(text, w.buttons) : null;
      if (!w || !pick) return { handled: false };
      this.cards.click(w.id, pick);
      this.log.add({ kind: 'action', summary: `Voice answer “${String(text).trim().slice(0, 40)}” → ${pick}: ${w.title}`, ok: pick !== 'no', source: 'voice' });
      return { handled: true, decision: pick, title: w.title };
    }
    const decision = voiceDecision(text); if (!decision) return { handled: false };
    const ids = card.buttons.map((b) => b.id);
    const pick = decision === 'deny' ? (ids.includes('deny') ? 'deny' : ids.includes('cancel') ? 'cancel' : null)
      : decision === 'always' ? (ids.includes('always') ? 'always' : (ids.includes('allow') ? 'allow' : ids.includes('run') ? 'run' : null))
      : (ids.includes('allow') ? 'allow' : ids.includes('run') ? 'run' : null);
    if (!pick) return { handled: false };
    this.cards.click(card.id, pick);
    this.log.add({ kind: 'action', summary: `Voice answer “${String(text).trim().slice(0, 40)}” → ${pick}: ${card.title}`, ok: pick !== 'deny', source: 'voice' });
    return { handled: true, decision: pick, title: card.title };
  }
  hasPendingApproval() { return !!this.cards.pending?.(['approval', 'plan', 'watcher']); }

  /** Typed chat / spoken transcript commands. Returns { handled, text } — handled=true means skip Gemini for this message. */
  handleText(text, { source = 'chat' } = {}) {
    const t = String(text || '');
    if (this.agent.isStopPhrase(t)) { this.agent.stop(); return { handled: true, text: 'Stopped the task.' }; }
    let m;
    if (this.voiceApprove(t).handled) return { handled: true, text: 'Okay.' };
    if ((m = CHAT_TASK.exec(t))) { void this.runTask(m[1].trim(), { source }); return { handled: true, text: `Task started: ${m[1].trim().slice(0, 120)}. Watch the card at the top-right — you approve each step, and “Nexora, stop” cancels it.` }; }
    if ((m = CHAT_SCREEN.exec(t))) { void this.explainScreen({ source, target: m[1] || 'all' }); return { handled: true, text: 'Looking at your screen now — the answer will appear as a card at the top-right.' }; }
    try { this.proactive.maybeLater(t); } catch { /* ignore */ }
    return { handled: false };
  }

  // ---- state for the Autonomy tab ----------------------------------------------------------------------------
  state() {
    const cfg = this.config.get('autonomy') || {}; const { state: _s, permissions: _p, ...flags } = cfg;
    return { success: true, flags, permissions: this.policy.table(), actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, { risk: v.risk, label: this.executor.describe(k, sample(k)) }])), apps: [...new Set([...Object.values(APPS).map((a) => a.label), ...this.appIndex.list()])].slice(0, 400), task: this.agent.state(), running: this.agent.isRunning(), log: this.log.list(80), hotkey: this.hotkey, defaults: AUTONOMY_DEFAULTS.watchers };
  }
  setPermission(action, level) { const r = this.policy.set(action, level); if (r.success) this.push('autonomy:changed', { permissions: true }); return r; }
  clearLog() { return this.log.clear(); }
  briefNow() { return this.proactive.showBrief({ force: true }).then(() => ({ success: true })); }
  upkeepNow() { return runUpkeep({ memoryStore: this.deps.memoryStore, reminderService: this.deps.reminderService, log: this.log, cards: this.cards, config: this.config, openPanel: (p) => this.openPanel(p), force: true }).then((r) => ({ success: true, ...r })); }

  // ---- lifecycle -----------------------------------------------------------------------------------------------
  registerHotkey() {
    const gs = this.electron.globalShortcut; if (!gs) return;
    try { if (this.hotkey) gs.unregister(this.hotkey); } catch { /* ignore */ }
    this.hotkey = null;
    const accel = this.config.get('autonomy.screenHotkey'); if (!accel || this.config.get('autonomy.screenHelp') === false) return;
    try { if (gs.register(accel, () => { void this.explainScreen({ source: 'hotkey' }); })) this.hotkey = accel; else console.warn(`[NEXORA Autonomy] screen hotkey ${accel} is already used by another app`); } catch (e) { console.warn('[NEXORA Autonomy] hotkey failed:', e.message); }
  }
  onConfig(keyPath) { if (/^autonomy\.(screenHotkey|screenHelp)$/.test(keyPath)) this.registerHotkey(); if (keyPath === 'autonomy.screenWatch') { /* the watcher reads the flag on every step */ } }
  start() {
    this.registerHotkey(); this.proactive.start(); this.watchers.start(); this.screen.start();
    const warm = setTimeout(() => { void this.appIndex.refresh().catch(() => {}); }, 2500); if (typeof warm.unref === 'function') warm.unref();   // v0.3.10: installed apps ready before the first "open Discord"
    const upkeep = () => runUpkeep({ memoryStore: this.deps.memoryStore, reminderService: this.deps.reminderService, log: this.log, cards: this.cards, config: this.config, openPanel: (p) => this.openPanel(p) }).catch(() => {});
    this.upkeepBoot = setTimeout(upkeep, 25000); this.upkeepTimer = setInterval(upkeep, 3 * 3600000);
    for (const t of [this.upkeepBoot, this.upkeepTimer]) if (typeof t.unref === 'function') t.unref();
    console.log('[NEXORA Autonomy] ready: brief, nudges, upkeep, agent, screen help, watchers');
  }
  stop() { this.proactive.stop(); this.watchers.stop(); this.screen.stop(); clearTimeout(this.upkeepBoot); clearInterval(this.upkeepTimer); try { this.agent.stop(); } catch { /* ignore */ } try { if (this.hotkey) this.electron.globalShortcut?.unregister(this.hotkey); } catch { /* ignore */ } try { this.cards.destroy(); } catch { /* ignore */ } }
}

/** Neutral sample args so the Autonomy tab can show a one-line description of each action. */
function sample(action) { return ({ open_app: { name: 'vscode' }, open_folder: { path: '<folder>' }, open_url: { url: '<web address>' }, open_in_vscode: { path: '<folder>' }, search_files: { query: '<name>', folder: 'all' }, clipboard_read: {}, clipboard_write: { text: '<text>' }, create_folder: { name: '<name>', parent: 'documents' }, extract_zip: { path: '<file>.zip' } })[action] || {}; }

function registerAutonomyIpc(ipcMain, service, isTrustedRenderer) {
  const guard = (fn) => (event, ...a) => (isTrustedRenderer(event) ? fn(...a) : { success: false, error: 'Untrusted renderer.' });
  ipcMain.handle('autonomy:state', guard(() => service.state()));
  ipcMain.handle('autonomy:permission', guard((action, level) => service.setPermission(String(action), String(level))));
  ipcMain.handle('autonomy:run-task', guard(async (goal) => (typeof goal === 'string' ? service.runTask(goal, { source: 'ui' }) : { success: false, summary: 'Type a goal.', steps: [] })));
  ipcMain.handle('autonomy:stop', guard(() => service.stopTask()));
  ipcMain.handle('autonomy:log-clear', guard(() => service.clearLog()));
  ipcMain.handle('autonomy:explain-screen', guard(() => service.explainScreen({ source: 'ui' })));
  ipcMain.handle('autonomy:brief-now', guard(() => service.briefNow()));
  ipcMain.handle('autonomy:upkeep-now', guard(() => service.upkeepNow()));
}
module.exports = { AutonomyService, registerAutonomyIpc, CHAT_TASK, CHAT_SCREEN };
