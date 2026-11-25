/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — action log. Every autonomous or approved action is written here so the user can always see
 * what NEXORA did. Small JSON file in the user-data folder, capped, atomic writes. No Electron dependency. */
const fs = require('fs');
const path = require('path');
const MAX_ENTRIES = 300;

class ActionLog {
  constructor({ filePath, fileSystem = fs, now = () => Date.now() } = {}) {
    if (!filePath) throw new Error('ActionLog requires a filePath.');
    this.filePath = filePath; this.fs = fileSystem; this.now = now; this.onChange = null; this.items = this.load();
  }
  load() {
    try {
      if (!this.fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      return (Array.isArray(parsed.items) ? parsed.items : []).filter((i) => i && typeof i.at === 'number' && typeof i.kind === 'string').slice(-MAX_ENTRIES);
    } catch { return []; }
  }
  save() {
    try {
      this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      this.fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items.slice(-MAX_ENTRIES) }, null, 2), 'utf8');
      this.fs.renameSync(tmp, this.filePath);
      return true;
    } catch { return false; }
  }
  /** add({ kind: 'action'|'task'|'proactive'|'watcher'|'memory'|'screen', action, summary, ok, source, decision }) */
  add(entry = {}) {
    const item = {
      at: this.now(), kind: String(entry.kind || 'action').slice(0, 20), action: entry.action ? String(entry.action).slice(0, 40) : undefined,
      summary: String(entry.summary || '').slice(0, 300), ok: entry.ok !== false, source: String(entry.source || 'user').slice(0, 20),
      decision: entry.decision ? String(entry.decision).slice(0, 30) : undefined,
    };
    this.items.push(item); if (this.items.length > MAX_ENTRIES) this.items.splice(0, this.items.length - MAX_ENTRIES);
    this.save(); try { this.onChange?.(item); } catch { /* UI errors never break the log */ }
    return item;
  }
  list(limit = 100) { return this.items.slice(-Math.max(1, Math.min(MAX_ENTRIES, limit))).reverse().map((i) => ({ ...i })); }
  between(from, to) { return this.items.filter((i) => i.at >= from && i.at < to).map((i) => ({ ...i })); }
  clear() { this.items = []; this.save(); try { this.onChange?.(null); } catch { /* ignore */ } return { success: true }; }
}
module.exports = { ActionLog, MAX_ENTRIES };
