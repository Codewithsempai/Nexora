/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy (6) — background watchers: copied errors (opt-in), new .zip downloads, low battery, low disk.
 * Each one only SHOWS a card; nothing is done until you press a button. Every watcher has its own switch. */
const nodeFs = require('fs');
const nodePath = require('path');
const { isQuietHour, dayKey } = require('./defaults');
const ERROR_TEXT = /(?:Traceback \(most recent call last\)|\n\s+at\s+\S+\s+\(.*:\d+:\d+\)|\b(?:TypeError|ReferenceError|SyntaxError|ModuleNotFoundError|ImportError|AttributeError|NameError|ValueError|KeyError|NullPointerException|Cannot find module|Uncaught \w*Error|Unhandled (?:Rejection|Exception))\b|\bnpm ERR!|\berror\[E\d{4}\]|\bpanicked at\b|\bfatal error\b|Exception in thread)/;
function looksLikeError(text) { const t = String(text || ''); return t.length >= 30 && t.length <= 6000 && ERROR_TEXT.test(t); }
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
const GB = 1024 ** 3;

class Watchers {
  constructor({ cards, config, log, clipboard = null, fs = nodeFs, path = nodePath, folders = {}, explainText = null, runAction = null, openFolder = null, speak = null, voiceHint = () => false, getBattery = async () => null, getDiskFree = async () => null, now = () => Date.now() } = {}) {
    Object.assign(this, { cards, config, log, clipboard, fs, path, folders, explainText, runAction, openFolder, speak, voiceHint, getBattery, getDiskFree, now });
    this.lastClip = ''; this.ignoreClip = ''; this.lastClipOffer = 0; this.offeredClips = new Set();
    this.timers = []; this.fsWatcher = null; this.pending = new Map(); this.seenFiles = new Set(); this.batteryAt = 0; this.batteryCritAt = 0;
  }
  on(name) { return this.config?.get?.(`autonomy.watchers.${name}`) === true; }
  quiet() { return isQuietHour(this.now(), this.config?.get?.('autonomy.quietHours')); }
  /** NEXORA wrote this to the clipboard itself, so do not treat it as something the user copied. */
  ignoreNext(text) { this.ignoreClip = String(text || ''); }

  // --- copied errors --------------------------------------------------------------------------------------------
  checkClipboard() {
    if (!this.on('clipboardErrors') || !this.clipboard) return null;
    let text = ''; try { text = String(this.clipboard.readText() || ''); } catch { return null; }
    if (!text || text === this.lastClip) return null;
    this.lastClip = text;
    if (text === this.ignoreClip || !looksLikeError(text)) return null;
    const h = hash(text); const at = this.now();
    if (this.offeredClips.has(h) || at - this.lastClipOffer < 60000) return null;
    this.offeredClips.add(h); this.lastClipOffer = at;
    const preview = text.trim().split(/\r?\n/).find((l) => l.trim()) || text; 
    void this.cards.ask({ kind: 'watcher', label: 'YOU COPIED AN ERROR', title: 'Want me to explain it?', text: preview.slice(0, 140), buttons: [{ id: 'explain', label: 'Explain it', primary: true }, { id: 'no', label: 'Ignore' }], timeoutMs: 30000 })
      .then((a) => { if (a === 'explain') void this.explainText?.(text, { source: 'clipboard' }); });
    return 'offered';
  }

  // --- downloads ------------------------------------------------------------------------------------------------
  onDownloadEvent(name) {
    if (!this.on('downloads') || !name || !/\.zip$/i.test(name)) return;
    clearTimeout(this.pending.get(name));
    this.pending.set(name, setTimeout(() => { this.pending.delete(name); void this.settle(name); }, 2000));
  }
  async settle(name) {
    const dir = this.folders.downloads; if (!dir) return null;
    const file = this.path.join(dir, name);
    try {
      const a = this.fs.statSync(file); if (!a.isFile() || a.size < 100) return null;
      await new Promise((r) => setTimeout(r, 1200));
      const b = this.fs.statSync(file); if (b.size !== a.size) { this.onDownloadEvent(name); return null; } // still downloading
      const key = `${name}:${b.size}:${Math.round(b.mtimeMs)}`; if (this.seenFiles.has(key)) return null; this.seenFiles.add(key);
      return this.offerExtract(file);
    } catch { return null; }
  }
  offerExtract(file) {
    const name = this.path.basename(file);
    const hint = this.voiceHint?.() ? ' Or say “Extract”, “Show folder” or “Ignore”.' : '';
    const asked = this.cards.ask({ kind: 'watcher', label: 'NEW DOWNLOAD', title: name, text: `A zip file just finished downloading. Extract it into a new folder next to it?${hint}`, buttons: [{ id: 'extract', label: 'Extract', primary: true }, { id: 'folder', label: 'Show folder' }, { id: 'no', label: 'Ignore' }], timeoutMs: 60000 });
    // v0.3.13: NEXORA says it out loud (short name, no path) so you can answer by voice without looking at the screen.
    if (!this.quiet() && this.speak && this.voiceHint?.()) { try { this.speak(`${name.replace(/\.zip$/i, '').replace(/[_]+/g, ' ').slice(0, 50)} zip download aayiduchu. Say extract, show folder, or ignore.`); } catch { /* speech is best effort */ } }
    return asked.then(async (a) => {
      if (a === 'extract' && this.runAction) { const r = await this.runAction('extract_zip', { path: file }, { implied: true, source: 'watcher' }); this.cards.notify({ kind: 'watcher', label: 'DOWNLOADS', title: r.ok ? 'Extracted' : 'Could not extract', text: r.summary, timeoutMs: 8000 }); if (this.speak) { try { this.speak(r.ok ? 'Extract pannitten.' : 'Sorry, extract panna mudiyala.'); } catch { /* ignore */ } } }
      else if (a === 'folder' && this.openFolder) this.openFolder(this.path.dirname(file));
      return a;
    });
  }

  // --- battery / disk -------------------------------------------------------------------------------------------
  async checkBattery() {
    if (!this.on('battery')) return null;
    const b = await this.getBattery(); if (!b || typeof b.percent !== 'number' || b.charging) return null;
    const at = this.now();
    if (b.percent <= 10 && at - this.batteryCritAt > 10 * 60000) { this.batteryCritAt = at; this.cards.notify({ kind: 'watcher', label: 'BATTERY', title: `Battery critically low (${b.percent}%)`, text: 'Plug in your charger now — save your work.', timeoutMs: 15000 }); this.log?.add({ kind: 'watcher', summary: `Battery critical ${b.percent}%`, source: 'auto' }); return 'critical'; }
    if (b.percent <= 20 && b.percent > 10 && at - this.batteryAt > 30 * 60000 && !this.quiet()) { this.batteryAt = at; this.cards.notify({ kind: 'watcher', label: 'BATTERY', title: `Battery low (${b.percent}%)`, text: 'Time to plug in your charger.', timeoutMs: 10000 }); this.log?.add({ kind: 'watcher', summary: `Battery low ${b.percent}%`, source: 'auto' }); return 'low'; }
    return null;
  }
  async checkDisk() {
    if (!this.on('disk')) return null;
    const d = await this.getDiskFree(); if (!d || !d.totalBytes) return null;
    const pct = (d.freeBytes / d.totalBytes) * 100;
    if (d.freeBytes >= 10 * GB && pct >= 8) return null;
    const today = dayKey(this.now()); if (this.config.get('autonomy.state.lastDiskAlert') === today || this.quiet()) return null;
    this.config.set('autonomy.state.lastDiskAlert', today);
    this.cards.notify({ kind: 'watcher', label: 'DISK SPACE', title: `Only ${(d.freeBytes / GB).toFixed(1)} GB free on ${d.drive || 'your system drive'}`, text: 'Clean up Downloads or old projects before it fills up.', timeoutMs: 12000 });
    this.log?.add({ kind: 'watcher', summary: `Low disk space: ${(d.freeBytes / GB).toFixed(1)} GB free`, source: 'auto' });
    return 'low';
  }

  start() {
    this.stop();
    const every = (ms, fn) => { const t = setInterval(() => { Promise.resolve().then(fn).catch(() => {}); }, ms); if (typeof t.unref === 'function') t.unref(); this.timers.push(t); };
    every(1500, () => this.checkClipboard()); every(5 * 60000, () => this.checkBattery()); every(30 * 60000, () => this.checkDisk());
    const boot = setTimeout(() => { void this.checkBattery(); void this.checkDisk(); }, 15000); if (typeof boot.unref === 'function') boot.unref(); this.timers.push(boot);
    try { if (this.folders.downloads && this.fs.existsSync(this.folders.downloads)) { this.fsWatcher = this.fs.watch(this.folders.downloads, { persistent: false }, (evt, name) => { if (name) this.onDownloadEvent(String(name)); }); this.fsWatcher.on?.('error', () => {}); } } catch { /* folder watching is best effort */ }
  }
  stop() { for (const t of this.timers) { clearInterval(t); clearTimeout(t); } this.timers = []; for (const t of this.pending.values()) clearTimeout(t); this.pending.clear(); try { this.fsWatcher?.close(); } catch { /* ignore */ } this.fsWatcher = null; }
}
module.exports = { Watchers, looksLikeError };
