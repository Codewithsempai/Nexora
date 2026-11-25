/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — reminder store + scheduler (main process, no Electron dependency so it can be unit tested).
 * Reminders live in a small JSON file in the user-data folder, are checked every second, and survive restarts.
 * A reminder that came due while NEXORA was closed fires once on the next start (flagged late). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const MAX_ITEMS = 500;
const MAX_TEXT = 500;
const LATE_AFTER_MS = 90 * 1000;

/** Next time after `after` that keeps the same local wall-clock time for the repeat rule. */
function nextOccurrence(dueAt, repeat, after) {
  const d = new Date(dueAt);
  let guard = 0;
  do {
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (repeat === 'weekdays') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else return null;
  } while (d.getTime() <= after && ++guard < 4000);
  return d.getTime();
}

class ReminderService {
  constructor({ filePath, fileSystem = fs, now = () => Date.now(), onFire = null, onChange = null } = {}) {
    if (!filePath) throw new Error('ReminderService requires a filePath.');
    this.filePath = filePath; this.fs = fileSystem; this.now = now;
    this.onFire = onFire; this.onChange = onChange;
    this.timer = null; this.items = this.load();
  }

  load() {
    try {
      if (!this.fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      return items.filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string' && Number.isFinite(i.dueAt)).slice(-MAX_ITEMS);
    } catch (error) {
      try { this.fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return [];
    }
  }

  save() {
    try {
      this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      const data = JSON.stringify({ version: 1, items: this.items.slice(-MAX_ITEMS) }, null, 2);
      if (typeof this.fs.openSync === 'function' && typeof this.fs.fsyncSync === 'function') {
        const fd = this.fs.openSync(tmp, 'w'); try { this.fs.writeSync(fd, data); this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
      } else this.fs.writeFileSync(tmp, data, 'utf8');
      this.fs.renameSync(tmp, this.filePath);
      return true;
    } catch (error) { return false; }
  }

  emitChange(event) { try { this.onChange?.(event); } catch { /* UI errors must never break the scheduler */ } }
  snapshot(item) { return item ? { ...item } : null; }

  list() {
    const order = { fired: 0, pending: 1, done: 2 };
    return this.items.map((i) => this.snapshot(i)).sort((a, b) => (order[a.status] - order[b.status]) || (a.status === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : a.dueAt - b.dueAt));
  }

  summary() {
    const pending = this.items.filter((i) => i.status === 'pending');
    return { pending: pending.length, fired: this.items.filter((i) => i.status === 'fired').length, done: this.items.filter((i) => i.status === 'done').length, nextDueAt: pending.length ? Math.min(...pending.map((i) => i.dueAt)) : null };
  }

  validate({ text, dueAt, repeat = 'none' }) {
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!clean || clean.length > MAX_TEXT) return { error: `Reminder text must contain 1–${MAX_TEXT} characters.` };
    if (!Number.isFinite(dueAt) || dueAt <= 0) return { error: 'Choose a valid date and time.' };
    if (!REPEATS.includes(repeat)) return { error: 'Invalid repeat option.' };
    return { clean };
  }

  add({ text, dueAt, repeat = 'none', source = 'manual' } = {}) {
    const checked = this.validate({ text, dueAt: Number(dueAt), repeat });
    if (checked.error) return { success: false, error: checked.error };
    if (Number(dueAt) < this.now() - 1000 && repeat === 'none') return { success: false, error: 'That time has already passed.' };
    const now = this.now();
    const item = { id: crypto.randomUUID(), text: checked.clean, dueAt: Number(dueAt), repeat, status: 'pending', createdAt: now, source: String(source || 'manual').slice(0, 20) };
    if (this.items.length >= MAX_ITEMS) { const idx = this.items.findIndex((i) => i.status === 'done'); this.items.splice(idx >= 0 ? idx : 0, 1); }
    this.items.push(item);
    this.save(); this.emitChange({ type: 'add', item: this.snapshot(item), source: item.source });
    return { success: true, item: this.snapshot(item) };
  }

  update(id, patch = {}) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { success: false, error: 'Reminder not found.' };
    const next = { text: patch.text ?? item.text, dueAt: patch.dueAt !== undefined ? Number(patch.dueAt) : item.dueAt, repeat: patch.repeat ?? item.repeat };
    const checked = this.validate(next);
    if (checked.error) return { success: false, error: checked.error };
    const timeChanged = next.dueAt !== item.dueAt;
    item.text = checked.clean; item.dueAt = next.dueAt; item.repeat = next.repeat;
    if (timeChanged && item.status !== 'pending') { item.status = 'pending'; delete item.doneAt; }
    this.save(); this.emitChange({ type: 'update', item: this.snapshot(item) });
    return { success: true, item: this.snapshot(item) };
  }

  remove(id) {
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) return { success: false, error: 'Reminder not found.' };
    const [item] = this.items.splice(index, 1);
    this.save(); this.emitChange({ type: 'remove', item: this.snapshot(item) });
    return { success: true };
  }

  done(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { success: false, error: 'Reminder not found.' };
    if (item.repeat !== 'none' && item.status === 'pending') {
      // Marking a repeating reminder done skips to its next occurrence instead of ending the series.
      item.dueAt = nextOccurrence(item.dueAt, item.repeat, this.now()) || item.dueAt;
    } else { item.status = 'done'; item.doneAt = this.now(); }
    this.save(); this.emitChange({ type: 'done', item: this.snapshot(item) });
    return { success: true, item: this.snapshot(item) };
  }

  snooze(id, minutes = 10) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { success: false, error: 'Reminder not found.' };
    const mins = Math.max(1, Math.min(24 * 60, Math.round(Number(minutes) || 10)));
    item.dueAt = this.now() + mins * 60000; item.status = 'pending'; item.snoozed = (item.snoozed || 0) + 1; delete item.doneAt;
    this.save(); this.emitChange({ type: 'snooze', item: this.snapshot(item) });
    return { success: true, item: this.snapshot(item) };
  }

  clearDone() {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.status !== 'done');
    this.save(); this.emitChange({ type: 'clear' });
    return { success: true, removed: before - this.items.length };
  }

  /** Fire everything that is due. Public so tests (and the 1-second timer) share one code path. */
  tick(at = this.now()) {
    const fired = [];
    for (const item of this.items) {
      if (item.status !== 'pending' || item.dueAt > at) continue;
      const late = at - item.dueAt > LATE_AFTER_MS;
      const dueWas = item.dueAt;
      item.lastFiredAt = at;
      if (item.repeat !== 'none') item.dueAt = nextOccurrence(item.dueAt, item.repeat, at) || at + 86400000;
      else item.status = 'fired';
      fired.push({ item: this.snapshot(item), late, dueWas });
    }
    if (fired.length) {
      this.save();
      for (const entry of fired) {
        try { this.onFire?.(entry.item, { late: entry.late, dueWas: entry.dueWas }); } catch { /* ignore */ }
        this.emitChange({ type: 'fired', item: entry.item, late: entry.late });
      }
    }
    return fired;
  }

  start(intervalMs = 1000) {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { ReminderService, nextOccurrence, REPEATS };
