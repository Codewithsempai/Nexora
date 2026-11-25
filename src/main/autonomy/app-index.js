/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — installed-app index. Lets "open Discord / WhatsApp / Steam / Word…" work for ANY app on the PC.
 *  · Desktop apps: every shortcut (.lnk) in the two Start Menu folders (read with plain fs — instant).
 *  · Store apps (WhatsApp, Spotify Store build, Calculator…): `Get-StartApps` through PowerShell (background, cached).
 * Nothing is executed here; the index only answers "which installed app does this name mean?" with a launch target.
 * Original NEXORA code. All system access is injected so it is unit-testable on any OS. */
const nodeFs = require('fs');
const nodePath = require('path');

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const SKIP = /\b(uninstall|uninstaller|setup|installer|update|updater|readme|release notes|help|documentation|license|website|web site|repair|crash)\b/i;
const FILLER = /^(?:the|my|an?)\s+|\s+(?:app|application|software|program|desktop app)$/g;
const cleanQuery = (name) => { let t = norm(name); for (let i = 0; i < 3; i++) t = t.replace(FILLER, '').trim(); return t; };

class AppIndex {
  /** deps: { fs, path, platform, env, ps (script)=>Promise<string>, now } */
  constructor(deps = {}) {
    this.fs = deps.fs || nodeFs; this.path = deps.path || nodePath; this.platform = deps.platform || process.platform;
    this.env = deps.env || process.env; this.ps = deps.ps || (async () => ''); this.now = deps.now || (() => Date.now());
    this.apps = []; this.loadedAt = 0; this.loading = null; this.fullLoaded = false; this.ttl = deps.ttlMs || 10 * 60000;
  }

  startMenuDirs() {
    const out = []; const p = this.path;
    if (this.env.ProgramData) out.push(p.join(this.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    if (this.env.APPDATA) out.push(p.join(this.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    return out;
  }

  scanShortcuts() {
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 4 || found.length > 4000) return;
      let entries; try { entries = this.fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = this.path.join(dir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        if (!/\.lnk$/i.test(e.name)) continue;
        const name = e.name.replace(/\.lnk$/i, '');
        if (SKIP.test(name)) continue;
        found.push({ name, kind: 'lnk', target: full });
      }
    };
    for (const d of this.startMenuDirs()) walk(d, 0);
    return found;
  }

  parseStartApps(text) {
    const apps = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const i = line.indexOf('|'); if (i < 1) continue;
      const name = line.slice(0, i).trim(); const id = line.slice(i + 1).trim();
      if (!name || !id || SKIP.test(name) || /[\r\n"<>|&^%]/.test(id)) continue;
      apps.push({ name, kind: 'uwp', target: id });
    }
    return apps;
  }

  merge(list) {
    const seen = new Map();
    for (const a of list) {
      const key = norm(a.name); if (!key) continue;
      const have = seen.get(key);
      if (!have || (have.kind === 'uwp' && a.kind === 'lnk')) seen.set(key, { ...a, key });   // a real shortcut beats a Store entry of the same name
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Quick: shortcuts only (sync). */
  loadQuick() { this.apps = this.merge([...this.apps.filter((a) => a.kind === 'uwp'), ...this.scanShortcuts()]); this.loadedAt = this.now(); return this.apps; }

  /** Full refresh: shortcuts first, then Store apps. Several callers share one run. */
  refresh() {
    if (this.platform !== 'win32') return Promise.resolve(this.apps);
    if (this.loading) return this.loading;
    this.loadQuick();
    this.loading = (async () => {
      try { const text = await this.ps('Get-StartApps | ForEach-Object { "$($_.Name)|$($_.AppID)" }'); this.apps = this.merge([...this.scanShortcuts(), ...this.parseStartApps(text)]); this.loadedAt = this.now(); }
      catch { /* keep the shortcut list */ }
      finally { this.loading = null; this.fullLoaded = true; }
      return this.apps;
    })();
    return this.loading;
  }

  /** Wait (at most waitMs) for a usable index. Stale data is served at once and refreshed in the background. */
  async ensure(waitMs = 3500) {
    if (this.platform !== 'win32') return this.apps;
    const fresh = this.apps.length && this.now() - this.loadedAt < this.ttl;
    if (fresh && this.fullLoaded) return this.apps;
    const run = this.refresh();
    if (this.apps.length && this.fullLoaded) return this.apps;       // stale but complete: serve it, refresh in the background
    await Promise.race([run, new Promise((r) => { const t = setTimeout(r, waitMs); if (typeof t.unref === 'function') t.unref(); })]);   // first run: wait for the Store-app list too
    return this.apps;
  }

  /** Best installed app for a spoken name, or null. Exact > starts-with > all words > fuzzy (typo / STT spelling). */
  find(name) {
    const q = cleanQuery(name); if (q.length < 2) return null;
    const words = q.split(' ');
    let best = null; let bestScore = 0;
    for (const app of this.apps) {
      const k = app.key || norm(app.name); let score = 0;
      if (k === q) score = 100;
      else if (k.startsWith(`${q} `) || k.startsWith(q)) score = 80 - Math.min(20, k.length - q.length);
      else if (words.every((w) => k.includes(w))) score = 60 - Math.min(20, k.length - q.length);
      else if (q.length >= 4 && k.split(' ').some((w) => w.length >= 4 && editDistance(w, q.replace(/ /g, '')) <= (q.length >= 7 ? 2 : 1))) score = 45;
      else if (q.length >= 4 && editDistance(k.replace(/ /g, ''), q.replace(/ /g, '')) <= (q.length >= 7 ? 2 : 1)) score = 45;
      if (score > bestScore) { best = app; bestScore = score; }
    }
    return bestScore >= 45 ? best : null;
  }

  /** Several close candidates, for "which one?" messages. */
  suggest(name, n = 3) { const q = cleanQuery(name); return this.apps.filter((a) => (a.key || norm(a.name)).includes(q.split(' ')[0] || '~')).slice(0, n).map((a) => a.name); }
  list() { return this.apps.map((a) => a.name); }
}

function editDistance(a, b) {
  if (a === b) return 0; if (Math.abs(a.length - b.length) > 3) return 9;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; } }
  return row[b.length];
}
module.exports = { AppIndex, norm, cleanQuery, editDistance };
