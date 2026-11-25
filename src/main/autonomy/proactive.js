/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy (1) — proactive reminders and briefings: a morning brief once a day, "you snoozed this twice"
 * nudges, "I'll do it later" follow-ups and opt-in habit check-ins. Cards only — nothing is changed without a button press. */
const { isQuietHour, dayKey, startOfDay } = require('./defaults');
const LATER = /(?:\b(?:later|apram|appuram|aprm|after sometime|konjam neram|konja neram)\b|பிறகு|அப்புறம்|அப்றம்)/i;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const HABITS = { water: { title: 'Water break 💧', text: 'Time for a glass of water.' }, stretch: { title: 'Stretch break', text: 'Stand up, roll your shoulders and rest your eyes for a minute.' } };

class Proactive {
  constructor({ cards, reminderService, memoryStore, config, log, now = () => Date.now(), openPanel = () => {} } = {}) {
    Object.assign(this, { cards, reminderService, memoryStore, config, log, now, openPanel });
    this.nudged = new Set(); this.habitAt = {}; this.startedAt = now(); this.timer = null;
  }
  cfg(key, fallback) { const v = this.config?.get?.(`autonomy.${key}`); return v === undefined ? fallback : v; }
  quiet(at = this.now()) { return isQuietHour(at, this.cfg('quietHours')); }
  userName() { try { const hit = this.memoryStore?.list('personal')?.items?.find((i) => i.key === 'name' && i.value); return hit?.value || ''; } catch { return ''; } }

  buildBrief(at = this.now()) {
    const hour = new Date(at).getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const name = this.userName();
    const lines = []; let items = [];
    try { items = this.reminderService?.list?.() || []; } catch { items = []; }
    const dayStart = startOfDay(at), dayEnd = dayStart + 86400000;
    const today = items.filter((i) => i.status === 'pending' && i.dueAt >= at - 60000 && i.dueAt < dayEnd).sort((a, b) => a.dueAt - b.dueAt);
    const waiting = items.filter((i) => i.status === 'fired').length;
    if (waiting) lines.push(`${waiting} reminder${waiting > 1 ? 's' : ''} still waiting for you (Done / Snooze).`);
    for (const r of today.slice(0, 4)) lines.push(`${hhmm(r.dueAt)} — ${r.text}`);
    if (today.length > 4) lines.push(`+${today.length - 4} more today`);
    let projects = []; let summary = null;
    try {
      projects = (this.memoryStore?.list('projects')?.items || []).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2);
      summary = (this.memoryStore?.list('conversations')?.items || []).filter((i) => /^Daily summary/i.test(i.text)).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    } catch { /* memory is optional */ }
    for (const p of projects) lines.push(`Project: ${p.text.replace(/^The user (?:is |has )?/i, '').replace(/^./, (c) => c.toUpperCase())}`);
    if (summary) lines.push(`Yesterday: ${summary.text.replace(/^Daily summary \d{4}-\d{2}-\d{2}:?\s*/i, '')}`);
    const text = today.length || waiting ? `You have ${today.length} reminder${today.length === 1 ? '' : 's'} today.` : 'No reminders today — a clear day.';
    return { title: `${hello}${name ? `, ${name}` : ''}!`, text, lines };
  }

  async showBrief({ force = false } = {}) {
    const at = this.now();
    if (!force) {
      if (!this.cfg('morningBrief', true)) return false;
      if (this.cfg('state.lastBrief') === dayKey(at)) return false;
      if (this.quiet(at)) return false;
    }
    this.config?.set?.('autonomy.state.lastBrief', dayKey(at));
    const brief = this.buildBrief(at);
    this.log?.add({ kind: 'proactive', summary: `Morning brief shown`, source: 'auto' });
    const answer = await this.cards.ask({ kind: 'brief', label: 'TODAY WITH NEXORA', title: brief.title, text: brief.text, lines: brief.lines, buttons: [{ id: 'reminders', label: 'Open reminders', primary: true }, { id: 'ok', label: 'Thanks' }], timeoutMs: 45000 });
    if (answer === 'reminders') this.openPanel('reminder');
    return true;
  }

  tomorrow9(at = this.now()) { const d = new Date(at); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }

  /** Offer new times for a reminder. Pressing a button is the ONLY thing that changes it. */
  async offerReschedule(item, { title, text }) {
    const at = this.now();
    const answer = await this.cards.ask({ kind: 'proactive', label: 'NEXORA SUGGESTS', title, text, buttons: [{ id: 'h1', label: 'In 1 hour', primary: true }, { id: 'tom', label: 'Tomorrow 9 AM' }, { id: 'done', label: 'Mark done' }, { id: 'keep', label: 'Keep as is' }], timeoutMs: 90000 });
    let note = '';
    if (answer === 'h1') { this.reminderService.update(item.id, { dueAt: at + 3600000 }); note = 'moved to in 1 hour'; }
    else if (answer === 'tom') { this.reminderService.update(item.id, { dueAt: this.tomorrow9(at) }); note = 'moved to tomorrow 9 AM'; }
    else if (answer === 'done') { this.reminderService.done(item.id); note = 'marked done'; }
    if (note) this.log?.add({ kind: 'proactive', summary: `Reminder “${item.text.slice(0, 60)}” ${note}`, source: 'auto', decision: answer });
    return note;
  }

  /** Called every ~30 s. */
  async tick() {
    const at = this.now(); let started = 0;
    try {
      if (this.cfg('nudges', true) && !this.quiet(at)) {
        for (const item of this.reminderService?.list?.() || []) {
          const key = `${item.id}:${item.snoozed || 0}`;
          if (item.status !== 'pending' || (item.snoozed || 0) < 2 || this.nudged.has(key) || item.dueAt - at < 60000) continue;
          this.nudged.add(key); started++;
          void this.offerReschedule(item, { title: `You snoozed “${item.text.slice(0, 60)}” ${item.snoozed} times`, text: 'Want a firmer time so it stops coming back?' });
          break; // one nudge per tick
        }
      }
      if (!this.quiet(at)) {
        for (const [name, meta] of Object.entries(HABITS)) {
          const habit = this.cfg(`habits.${name}`); if (!habit?.enabled) continue;
          const every = Math.max(15, Math.min(240, Number(habit.everyMin) || 60)) * 60000;
          const last = this.habitAt[name] || this.startedAt;
          if (at - last < every) continue;
          this.habitAt[name] = at; started++;
          void this.cards.ask({ kind: 'proactive', label: 'CHECK-IN', title: meta.title, text: meta.text, buttons: [{ id: 'ok', label: 'Done', primary: true }, { id: 'later', label: 'In 10 min' }], timeoutMs: 40000 })
            .then((a) => { if (a === 'later') this.habitAt[name] = this.now() - every + 10 * 60000; this.log?.add({ kind: 'proactive', summary: `${meta.title}: ${a}`, source: 'auto' }); });
          break;
        }
      }
    } catch { /* proactive features must never break the app */ }
    return started;
  }

  /** "I'll do it later" while a reminder is waiting -> offer a time. Returns true when a card was shown. */
  maybeLater(text) {
    const t = String(text || '').trim();
    if (!this.cfg('nudges', true) || !t || t.split(/\s+/).length > 9 || !LATER.test(t)) return false;
    const waiting = (this.reminderService?.list?.() || []).filter((i) => i.status === 'fired').sort((a, b) => (b.lastFiredAt || 0) - (a.lastFiredAt || 0))[0];
    if (!waiting || this.now() - (waiting.lastFiredAt || 0) > 30 * 60000) return false;
    void this.offerReschedule(waiting, { title: `Later for “${waiting.text.slice(0, 60)}”?`, text: 'When should I remind you again?' });
    return true;
  }

  start(intervalMs = 30000, briefDelayMs = 6000) {
    this.stop();
    this.timer = setInterval(() => { void this.tick(); }, intervalMs); if (typeof this.timer.unref === 'function') this.timer.unref();
    this.briefTimer = setTimeout(() => { void this.showBrief(); }, briefDelayMs); if (typeof this.briefTimer.unref === 'function') this.briefTimer.unref();
  }
  stop() { clearInterval(this.timer); clearTimeout(this.briefTimer); this.timer = null; this.briefTimer = null; }
}
module.exports = { Proactive, LATER, HABITS };
