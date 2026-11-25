/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — the ONLY computer actions NEXORA can perform. A fixed, validated catalogue: no free-form shell,
 * no arbitrary commands. Every argument is checked here before anything runs. All system access is injected, so
 * this file is unit-testable on any OS. */
const nodeFs = require('fs');
const nodePath = require('path');

const APPS = {
  vscode: { exe: 'code', label: 'VS Code', aliases: ['vs code', 'visual studio code', 'code', 'vscode'] },
  chrome: { exe: 'chrome', label: 'Chrome', aliases: ['google chrome', 'chrome'] },
  edge: { exe: 'msedge', label: 'Edge', aliases: ['microsoft edge', 'edge'] },
  brave: { exe: 'brave', label: 'Brave', aliases: ['brave browser', 'brave'] },
  firefox: { exe: 'firefox', label: 'Firefox', aliases: ['firefox'] },
  notepad: { exe: 'notepad', label: 'Notepad', aliases: ['notepad'] },
  calculator: { exe: 'calc', label: 'Calculator', aliases: ['calculator', 'calc'] },
  explorer: { exe: 'explorer', label: 'File Explorer', aliases: ['file explorer', 'explorer', 'files'] },
  terminal: { exe: 'wt', label: 'Windows Terminal', aliases: ['windows terminal', 'terminal'] },
  powershell: { exe: 'powershell', label: 'PowerShell', aliases: ['powershell'] },
  paint: { exe: 'mspaint', label: 'Paint', aliases: ['paint', 'mspaint'] },
  spotify: { exe: 'spotify', label: 'Spotify', aliases: ['spotify'] },
  settings: { exe: 'ms-settings:', label: 'Windows Settings', aliases: ['settings', 'windows settings'] },
};
const FOLDER_ALIASES = ['downloads', 'documents', 'desktop', 'pictures', 'home'];
const SAFE_ROOTS = ['downloads', 'documents', 'desktop'];   // where files may be created / extracted
const SHELL_META = /[&|<>^%"`\r\n]/;                        // never allowed in anything handed to cmd.exe

function resolveApp(name) {
  const key = String(name || '').toLowerCase().replace(/\s+/g, ' ').replace(/^(?:the|my)\s+/, '').replace(/\s+app$/, '').trim();
  for (const [id, app] of Object.entries(APPS)) if (id === key || app.aliases.includes(key)) return id;
  return null;
}

/** Action catalogue: label, risk, default permission, how to describe it on an approval card. */
const ACTIONS = {
  open_app: { risk: 'low', defaultLevel: 'once', help: 'open_app {name: ANY installed app by its name, e.g. ' + Object.keys(APPS).join(', ') + ', Discord, WhatsApp, Steam, Word, Excel, Telegram — NEXORA finds it in the Start Menu}' },
  open_folder: { risk: 'low', defaultLevel: 'once', help: 'open_folder {path?: downloads|documents|desktop|pictures|home or an absolute path like D:\\ or D:\\Anime; OR name?: a folder name to find, drive?: a drive letter like D to look on}' },
  open_url: { risk: 'low', defaultLevel: 'once', help: 'open_url {url: http(s) address}' },
  open_in_vscode: { risk: 'low', defaultLevel: 'once', help: 'open_in_vscode {path: folder inside the user home}' },
  search_files: { risk: 'low', defaultLevel: 'once', help: 'search_files {query: words from the file name, folder?: downloads|documents|desktop|pictures}' },
  clipboard_read: { risk: 'medium', defaultLevel: 'ask', help: 'clipboard_read {}' },
  clipboard_write: { risk: 'medium', defaultLevel: 'ask', help: 'clipboard_write {text: up to 5000 characters}' },
  create_folder: { risk: 'medium', defaultLevel: 'ask', help: 'create_folder {name, parent?: documents|desktop|downloads (default documents)}' },
  write_note: { risk: 'medium', defaultLevel: 'ask', help: 'write_note {title: short file name, content: the FULL text to write (you compose it yourself, e.g. 10 lines about a topic), folder?: desktop|documents (default desktop)} — saves a .txt file and opens it in Notepad. Use this whenever the user asks to type / write / note something in Notepad.' },
  extract_zip: { risk: 'medium', defaultLevel: 'ask', help: 'extract_zip {path: .zip file inside downloads/documents/desktop}' },
};
const LEVELS = ['ask', 'once', 'always', 'deny'];

class ActionExecutor {
  /** deps: { shell:{openPath,openExternal}, clipboard:{readText,writeText}, execFile, folders:{home,downloads,documents,desktop,pictures}, platform, fs, path } */
  constructor(deps = {}) {
    this.shell = deps.shell; this.clipboard = deps.clipboard; this.execFile = deps.execFile;
    this.fs = deps.fs || nodeFs; this.path = deps.path || nodePath; this.platform = deps.platform || process.platform;
    this.folders = deps.folders || {};
    this.appIndex = deps.appIndex || null;           // v0.3.10: installed-app finder (Start Menu + Store apps)
    this.driveMap = deps.driveMap || (() => this.windowsDrives());
  }

  /** Load the installed-app list before planning (instant when already cached). */
  async warm() { try { await this.appIndex?.ensure?.(); } catch { /* the built-in apps still work */ } }
  /** { id, label, installed } when `name` is a built-in or installed app, else null. */
  findApp(name) {
    const id = resolveApp(name); if (id) return { id, label: APPS[id].label, builtin: true };
    const hit = this.appIndex?.find?.(name); return hit ? { id: null, label: hit.name, hit } : null;
  }
  windowsDrives() { const out = {}; if (this.platform !== 'win32') return out; for (let c = 67; c <= 90; c++) { const L = String.fromCharCode(c); const root = `${L}:\\`; try { if (this.fs.existsSync(root)) out[L] = root; } catch { /* absent drive */ } } return out; }
  /** "D drive" / "D:" / "d:\\" / "D" -> "D" or null. */
  parseDrive(text) { const m = /^(?:the\s+)?([a-z])\s*(?::\\?|\s*drive)?\s*(?:drive)?$/i.exec(String(text || '').trim()); if (!m) return null; if (m[0].trim().length === 1) return null; return m[1].toUpperCase(); }

  folderPath(alias) { const key = String(alias || '').toLowerCase(); return FOLDER_ALIASES.includes(key) ? (this.folders[key] || null) : null; }
  isDir(p) { try { return this.fs.statSync(p).isDirectory(); } catch { return false; } }
  isFile(p) { try { return this.fs.statSync(p).isFile(); } catch { return false; } }
  within(child, parent) { if (!parent) return false; const rel = this.path.relative(this.path.resolve(parent), this.path.resolve(child)); return !!rel && !rel.startsWith('..') && !this.path.isAbsolute(rel); }
  inRoots(p, roots = SAFE_ROOTS) { return roots.some((r) => this.within(p, this.folders[r])); }

  /** -> { ok, args } with cleaned arguments, or { ok:false, error }. Never throws. */
  validate(action, raw = {}) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    try {
      switch (action) {
        case 'open_app': {
          const raw = str(a.name, 60); const id = resolveApp(raw); if (id) return { ok: true, args: { name: id } };
          // v0.3.10: any installed app. The name is only ever used to LOOK UP a Start Menu entry, never handed to a shell.
          if (raw.length < 2 || SHELL_META.test(raw) || /[\\/;]/.test(raw)) return { ok: false, error: 'Tell me the app name, for example “Discord” or “WhatsApp”.' };
          return { ok: true, args: { name: raw.replace(/^(?:the|my)\s+/i, '').replace(/\s+app$/i, '').trim() || raw } };
        }
        case 'open_folder': {
          const text = str(a.path).replace(/\s*folder$/i, '');
          const drives = this.driveMap();
          const letter = (a.drive ? String(a.drive).trim().replace(/[^a-z]/gi, '').slice(0, 1).toUpperCase() : '') || this.parseDrive(text) || '';
          if (a.drive && !drives[letter]) return { ok: false, error: `I can't see a ${letter || '?'}: drive on this PC.` };
          const name = str(a.name, 80).replace(/\s*folder$/i, '').replace(/^(?:my|the)\s+/i, '');
          if (name) {                                        // find a folder by NAME (optionally only on one drive)
            if (/[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name)) return { ok: false, error: 'That folder name has characters Windows does not allow.' };
            return { ok: true, args: { name, ...(letter ? { drive: letter } : {}) } };
          }
          const alias = this.folderPath(text);
          const driveRoot = !alias && this.parseDrive(text) ? drives[this.parseDrive(text)] : null;
          const target = alias || driveRoot || (this.path.isAbsolute(text) || /^[a-z]:[\\/]/i.test(text) ? this.path.resolve(text) : null);
          if (!target || !this.isDir(target)) return { ok: false, error: this.parseDrive(text) && !driveRoot ? `I can't see a ${this.parseDrive(text)}: drive on this PC.` : 'That folder does not exist.' };
          return { ok: true, args: { path: target } };
        }
        case 'open_url': {
          let u; try { u = new URL(str(a.url, 800)); } catch { return { ok: false, error: 'That is not a valid web address.' }; }
          if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, error: 'Only http / https addresses can be opened.' };
          return { ok: true, args: { url: u.href } };
        }
        case 'open_in_vscode': {
          const text = str(a.path); const target = this.folderPath(text) || (this.path.isAbsolute(text) ? this.path.resolve(text) : null);
          if (!target || !this.isDir(target)) return { ok: false, error: 'That folder does not exist.' };
          if (SHELL_META.test(target)) return { ok: false, error: 'That folder name has characters I will not pass to the shell.' };
          if (!this.folders.home || (!this.within(target, this.folders.home) && target !== this.path.resolve(this.folders.home))) return { ok: false, error: 'I only open folders inside your user folder in VS Code.' };
          return { ok: true, args: { path: target } };
        }
        case 'search_files': {
          const query = str(a.query, 80); if (query.length < 2) return { ok: false, error: 'Tell me part of the file name (2+ letters).' };
          const folder = a.folder ? String(a.folder).toLowerCase() : 'all';
          if (folder !== 'all' && !['downloads', 'documents', 'desktop', 'pictures'].includes(folder)) return { ok: false, error: 'Search folder must be downloads, documents, desktop or pictures.' };
          return { ok: true, args: { query, folder } };
        }
        case 'clipboard_read': return { ok: true, args: {} };
        case 'clipboard_write': { const text = typeof a.text === 'string' ? a.text.slice(0, 5000) : ''; return text.trim() ? { ok: true, args: { text } } : { ok: false, error: 'Nothing to copy.' }; }
        case 'create_folder': {
          const name = str(a.name, 80); const parent = String(a.parent || 'documents').toLowerCase();
          if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..' || /^\.+$/.test(name)) return { ok: false, error: 'Folder name has characters Windows does not allow.' };
          if (!SAFE_ROOTS.includes(parent) || !this.folders[parent]) return { ok: false, error: 'I can create folders only in documents, desktop or downloads.' };
          return { ok: true, args: { name, parent } };
        }
        case 'write_note': {
          const content = typeof a.content === 'string' ? a.content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 20000) : '';
          if (!content.trim()) return { ok: false, error: 'There is no text to write.' };
          const title = (str(a.title, 60).replace(/[\\/:*?"<>|&%^`\r\n]/g, ' ').replace(/\.txt$/i, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'NEXORA note');
          const folder = String(a.folder || 'desktop').toLowerCase();
          if (!['desktop', 'documents'].includes(folder) || !this.folders[folder]) return { ok: false, error: 'I can write notes only in desktop or documents.' };
          return { ok: true, args: { title, content, folder } };
        }
        case 'extract_zip': {
          const text = str(a.path, 600); const file = this.path.isAbsolute(text) ? this.path.resolve(text) : null;
          if (!file || !/\.zip$/i.test(file) || !this.isFile(file)) return { ok: false, error: 'That .zip file was not found.' };
          if (!this.inRoots(file)) return { ok: false, error: 'I only extract zip files from downloads, documents or desktop.' };
          if (SHELL_META.test(file)) return { ok: false, error: 'That file name has characters I will not pass to the shell.' };
          return { ok: true, args: { path: file } };
        }
        default: return { ok: false, error: `Unknown action “${String(action).slice(0, 30)}”.` };
      }
    } catch (error) { return { ok: false, error: 'Invalid arguments.' }; }
  }

  /** Human sentence for approval cards, the plan card and the log. Expects VALIDATED args. */
  describe(action, args = {}) {
    switch (action) {
      case 'open_app': return `Open ${APPS[args.name]?.label || this.appIndex?.find?.(args.name)?.name || args.name}`;
      case 'open_folder': return args.name ? `Open the “${args.name}” folder${args.drive ? ` on drive ${args.drive}:` : ''}` : `Open folder ${args.path}`;
      case 'open_url': return `Open ${args.url} in your browser`;
      case 'open_in_vscode': return `Open ${args.path} in VS Code`;
      case 'search_files': return `Search ${args.folder === 'all' ? 'your Downloads, Documents and Desktop' : args.folder} for “${args.query}”`;
      case 'clipboard_read': return 'Read the text currently on your clipboard';
      case 'clipboard_write': return `Copy to clipboard: “${String(args.text || '').slice(0, 80)}${String(args.text || '').length > 80 ? '…' : ''}”`;
      case 'create_folder': return `Create folder “${args.name}” in ${args.parent}`;
      case 'write_note': return `Write “${args.title}” (${String(args.content || '').split(/\n/).filter((l) => l.trim()).length} lines) and open it in Notepad`;
      case 'extract_zip': return `Extract ${this.path.basename(args.path || '')} into a new folder next to it`;
      default: return String(action);
    }
  }

  uniqueDir(base) { let dir = base; for (let i = 2; this.fs.existsSync(dir) && i < 200; i++) dir = `${base} (${i})`; return dir; }

  /** Runs ONE already-approved action. Always resolves { ok, summary, data? }. */
  async run(action, rawArgs) {
    const checked = this.validate(action, rawArgs);
    if (!checked.ok) return { ok: false, summary: checked.error };
    const args = checked.args;
    try {
      switch (action) {
        case 'open_app': return await this.openApp(args.name);
        case 'open_folder': {
          let target = args.path;
          if (!target) { const found = this.findFolder(args.name, args.drive); if (!found) return { ok: false, summary: `I could not find a folder named “${args.name}”${args.drive ? ` on the ${args.drive}: drive` : ''}.` }; target = found; }
          const err = await this.shell.openPath(target); return err ? { ok: false, summary: `Could not open the folder: ${err}` } : { ok: true, summary: `Opened ${target}`, data: { path: target } };
        }
        case 'open_url': await this.shell.openExternal(args.url); return { ok: true, summary: `Opened ${args.url}` };
        case 'open_in_vscode': return await this.cmd(['/c', 'code', args.path], `Opened ${args.path} in VS Code`);
        case 'search_files': { const found = this.searchFiles(args); return { ok: true, summary: found.length ? `Found ${found.length} file(s) for “${args.query}”` : `No files matched “${args.query}”`, data: { files: found } }; }
        case 'clipboard_read': { const text = String(this.clipboard.readText() || ''); return { ok: true, summary: text ? `Read ${text.length} characters from the clipboard` : 'The clipboard is empty', data: { text: text.slice(0, 5000) } }; }
        case 'clipboard_write': this.clipboard.writeText(args.text); return { ok: true, summary: `Copied ${args.text.length} characters to the clipboard` };
        case 'create_folder': { const dir = this.path.join(this.folders[args.parent], args.name); if (this.fs.existsSync(dir)) return { ok: true, summary: `Folder already exists: ${dir}`, data: { path: dir } }; this.fs.mkdirSync(dir, { recursive: true }); return { ok: true, summary: `Created ${dir}`, data: { path: dir } }; }
        case 'write_note': {
          const base = this.path.join(this.folders[args.folder], args.title); let file = `${base}.txt`;
          for (let i = 2; this.fs.existsSync(file) && i < 200; i++) file = `${base} (${i}).txt`;
          this.fs.writeFileSync(file, `\uFEFF${args.content.replace(/\r?\n/g, '\r\n')}`, 'utf8');
          const opened = await this.cmd(['/c', 'start', '', 'notepad', file], `Opened ${file} in Notepad`);
          return opened.ok ? { ok: true, summary: `Opened ${this.path.basename(file)} in Notepad`, data: { path: file } } : { ok: true, summary: `Saved ${file}, but Notepad did not open (${opened.summary})`, data: { path: file } };
        }
        case 'extract_zip': return await this.extractZip(args.path);
        default: return { ok: false, summary: 'Unknown action.' };
      }
    } catch (error) { return { ok: false, summary: `Failed: ${String(error?.message || error).slice(0, 160)}` }; }
  }

  /** Built-in names start through cmd; every other app is looked up in the installed-app index and launched from its Start Menu entry. */
  async openApp(name) {
    if (this.platform !== 'win32') return { ok: false, summary: 'Opening apps is supported on Windows only.' };
    if (APPS[name]) return this.cmd(['/c', 'start', '', APPS[name].exe], `Opened ${APPS[name].label}`);
    try { await this.appIndex?.ensure?.(); } catch { /* fall through */ }
    const hit = this.appIndex?.find?.(name);
    if (!hit) { const maybe = this.appIndex?.suggest?.(name) || []; return { ok: false, summary: `I could not find an app named “${name}” on this PC.${maybe.length ? ` Did you mean ${maybe.join(', ')}?` : ''}` }; }
    if (hit.kind === 'uwp') return this.launchStoreApp(hit);
    const err = await this.shell.openPath(hit.target);
    return err ? { ok: false, summary: `Could not start ${hit.name}: ${String(err).slice(0, 100)}` } : { ok: true, summary: `Opened ${hit.name}` };
  }
  launchStoreApp(hit) {
    return new Promise((resolve) => {
      if (/[\r\n"<>|&^%]/.test(hit.target)) return resolve({ ok: false, summary: 'Blocked: unsafe app id.' });
      try { this.execFile('explorer.exe', [`shell:AppsFolder\\${hit.target}`], { windowsHide: true, timeout: 15000 }, () => resolve({ ok: true, summary: `Opened ${hit.name}` })); }   // explorer returns 1 even on success
      catch (error) { resolve({ ok: false, summary: `Could not start ${hit.name}: ${String(error.message).slice(0, 100)}` }); }
    });
  }

  /** Find a folder by name: your own folders first, then drives. Shallowest, closest-named match wins. Bounded: depth 3, ~12k entries. */
  findFolder(name, driveLetter) {
    const words = String(name || '').toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return null;
    const SKIP_DIR = /^(?:windows|\$recycle\.bin|system volume information|program files(?: \(x86\))?|programdata|appdata|node_modules|\.git|recovery|\$winreagent|config\.msi)$/i;
    const drives = this.driveMap();
    const roots = driveLetter ? [drives[driveLetter]].filter(Boolean) : [...['desktop', 'documents', 'downloads', 'pictures'].map((k) => this.folders[k]).filter(Boolean), ...Object.values(drives)];
    let scanned = 0; let best = null; let bestScore = -1;
    const score = (n, depth) => { const l = n.toLowerCase(); const joined = words.join(' '); if (!words.every((w) => l.includes(w))) return -1; return (l === joined ? 300 : l.startsWith(joined) ? 200 : 100) - depth * 20 - Math.min(40, l.length - joined.length); };
    for (const root of roots) {
      let level = [root];
      for (let depth = 0; depth <= 3 && level.length && scanned < 12000; depth++) {
        const next = [];
        for (const dir of level) {
          let entries; try { entries = this.fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
          for (const e of entries) {
            if (++scanned > 12000) break;
            if (!e.isDirectory() || SKIP_DIR.test(e.name) || (e.name.startsWith('.') && e.name.length > 1)) continue;
            const full = this.path.join(dir, e.name); const sc = score(e.name, depth);
            if (sc > bestScore) { best = full; bestScore = sc; }
            next.push(full);
          }
        }
        if (bestScore >= 200) return best;               // an exact / prefix match at a shallow depth is good enough
        level = next;
      }
      if (best && bestScore >= 100 && roots.indexOf(root) === 0 && !driveLetter) return best;
    }
    return best;
  }
  cmd(args, okText) {
    return new Promise((resolve) => {
      if (this.platform !== 'win32') return resolve({ ok: false, summary: 'This action is supported on Windows only.' });
      if (args.some((x) => SHELL_META.test(String(x)))) return resolve({ ok: false, summary: 'Blocked: unsafe characters.' });
      try { this.execFile('cmd.exe', args, { windowsHide: true, timeout: 15000 }, (error) => resolve(error && error.killed ? { ok: false, summary: 'The app did not start in time.' } : { ok: true, summary: okText })); }
      catch (error) { resolve({ ok: false, summary: `Could not start: ${String(error.message).slice(0, 120)}` }); }
    });
  }
  extractZip(file) {
    return new Promise((resolve) => {
      const dest = this.uniqueDir(this.path.join(this.path.dirname(file), this.path.basename(file, this.path.extname(file))));
      try { this.fs.mkdirSync(dest, { recursive: true }); } catch (error) { return resolve({ ok: false, summary: `Could not create ${dest}` }); }
      // Windows 10/11 ship bsdtar (`tar`), which reads .zip and refuses paths that escape the target folder.
      try { this.execFile('tar', ['-xf', file, '-C', dest], { windowsHide: true, timeout: 120000 }, (error) => resolve(error ? { ok: false, summary: `Extract failed: ${String(error.message).slice(0, 120)}` } : { ok: true, summary: `Extracted to ${dest}`, data: { path: dest } })); }
      catch (error) { resolve({ ok: false, summary: `Extract failed: ${String(error.message).slice(0, 120)}` }); }
    });
  }

  /** Bounded file-name search: depth <= 4, <= 5000 entries looked at, <= 15 results. */
  searchFiles({ query, folder }) {
    const roots = folder === 'all' ? SAFE_ROOTS : [folder];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = []; let scanned = 0;
    const walk = (dir, depth) => {
      if (depth > 4 || hits.length >= 15 || scanned > 5000) return;
      let entries; try { entries = this.fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (hits.length >= 15 || ++scanned > 5000) return;
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = this.path.join(dir, e.name);
        const lower = e.name.toLowerCase();
        if (words.every((w) => lower.includes(w))) hits.push(full);
        if (e.isDirectory()) walk(full, depth + 1);
      }
    };
    for (const r of roots) if (this.folders[r]) walk(this.folders[r], 0);
    return hits;
  }
}
module.exports = { ActionExecutor, ACTIONS, APPS, LEVELS, FOLDER_ALIASES, SAFE_ROOTS, resolveApp };
