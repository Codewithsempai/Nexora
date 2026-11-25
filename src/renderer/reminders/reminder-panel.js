/* Owner: codewithsempai_daya — NEXORA */
/* ==========================================================================
   NEXORA — Reminders panel
   Quick add in plain words ("call mom in 10 minutes"), or pick a date/time.
   The scheduler runs in the main process, so reminders fire even when this panel is closed.
   ========================================================================== */

const REPEAT_LABEL = { none: 'Once', daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week', monthly: 'Every month' };
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function countdown(dueAt, now = Date.now()) {
  const diff = dueAt - now;
  if (diff <= 0) return 'due now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `in ${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60); if (h < 24) return `in ${h}h ${pad(m % 60)}m`;
  const d = Math.floor(h / 24); return `in ${d}d ${h % 24}h`;
}
export function whenLabel(dueAt, now = Date.now()) {
  const d = new Date(dueAt); const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const start = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const days = Math.round((start(dueAt) - start(now)) / 86400000);
  if (days === 0) return `Today · ${t}`; if (days === 1) return `Tomorrow · ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${t}`;
}

export class ReminderPanel {
  constructor(container, options = {}) {
    this.container = container; this.options = options;
    this.api = window.nexoraAPI?.reminders;
    this.items = []; this.skew = 0;
    this.render(); this.bind();
    this.unsubscribe = this.api?.onChanged?.(() => { void this.refresh(); });
    this.clock = setInterval(() => this.tickClock(), 1000);
    void this.refresh();
  }

  render() {
    this.container.innerHTML = `
      <div class="nexora-panel nexora-reminder-panel">
        <div class="panel-header">
          <div class="panel-title-cluster"><h2 class="panel-title">Reminders</h2><span class="panel-subtitle">Never miss what matters</span><span class="rem-count" id="remCount">0 upcoming</span></div>
          <div class="panel-actions"><button class="panel-btn-close" id="remClose" title="Close panel — Return to Core" aria-label="Close Reminders"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        </div>
        <div class="rem-scroll">
          <section class="rem-quick" aria-label="Quick add">
            <div class="rem-section-title"><span>QUICK ADD</span><small>type it like you would say it</small></div>
            <div class="rem-quick-row"><input id="remQuick" type="text" maxlength="300" placeholder="call mom in 10 minutes · submit report tomorrow at 9am" /><button id="remQuickAdd" type="button" class="rem-btn primary">Add</button></div>
            <details class="rem-manual"><summary>Or pick the date and time</summary>
              <div class="rem-manual-grid">
                <input id="remText" type="text" maxlength="500" placeholder="What should I remind you about?" aria-label="Reminder text" />
                <input id="remWhen" type="datetime-local" aria-label="Date and time" />
                <select id="remRepeat" aria-label="Repeat">${Object.entries(REPEAT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                <button id="remManualAdd" type="button" class="rem-btn primary">Add reminder</button>
              </div>
              <div class="rem-chips"><button type="button" data-plus="10">+10 min</button><button type="button" data-plus="30">+30 min</button><button type="button" data-plus="60">+1 hour</button><button type="button" data-tomorrow="9">Tomorrow 9 AM</button></div>
            </details>
            <div class="rem-status" id="remStatus" role="status">Tip: say “Hey Nexora, remind me to drink water in 20 minutes”.</div>
          </section>
          <section id="remDueWrap" hidden><div class="rem-section-title due"><span>DUE NOW</span></div><div class="rem-list" id="remDue"></div></section>
          <section><div class="rem-section-title"><span>TODAY</span></div><div class="rem-list" id="remUpcoming"></div></section>
          <section id="remLaterWrap" hidden><div class="rem-section-title"><span>LATER</span></div><div class="rem-list" id="remLater"></div></section>
          <section id="remDoneWrap" hidden><div class="rem-section-title"><span>DONE</span><button id="remClearDone" type="button" class="rem-link">Clear</button></div><div class="rem-list" id="remDone"></div></section>
        </div>
      </div>`;
    this.$ = (sel) => this.container.querySelector(sel);
    this.$('#remWhen').value = toLocalInput(Date.now() + 10 * 60000);
  }

  bind() {
    this.$('#remClose').addEventListener('click', () => this.options.onClose?.());
    const quick = this.$('#remQuick');
    this.$('#remQuickAdd').addEventListener('click', () => this.quickAdd());
    quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.quickAdd(); });
    this.$('#remManualAdd').addEventListener('click', () => this.manualAdd());
    this.$('#remText').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.manualAdd(); });
    this.$('#remClearDone').addEventListener('click', async () => { await this.api?.clearDone(); });
    this.container.querySelectorAll('.rem-chips button').forEach((b) => b.addEventListener('click', () => {
      const when = new Date();
      if (b.dataset.plus) when.setMinutes(when.getMinutes() + Number(b.dataset.plus));
      else { when.setDate(when.getDate() + 1); when.setHours(Number(b.dataset.tomorrow), 0, 0, 0); }
      this.$('#remWhen').value = toLocalInput(when.getTime());
    }));
  }

  setStatus(text, kind = '') { const s = this.$('#remStatus'); if (s) { s.textContent = text; s.dataset.kind = kind; } }

  async quickAdd() {
    const input = this.$('#remQuick'); const value = input.value.trim();
    const result = await this.api?.quick(value);
    if (!result?.success) { this.setStatus(result?.error || 'Could not add that reminder.', 'error'); return; }
    input.value = ''; this.setStatus(`Reminder set — ${result.item.text} · ${result.when}.`, 'ok');
  }

  async manualAdd() {
    const text = this.$('#remText').value.trim(); const whenValue = this.$('#remWhen').value;
    if (!text) { this.setStatus('Write what to remind you about.', 'error'); return; }
    const dueAt = new Date(whenValue).getTime();
    if (!Number.isFinite(dueAt)) { this.setStatus('Choose a date and time.', 'error'); return; }
    const result = await this.api?.add({ text, dueAt, repeat: this.$('#remRepeat').value });
    if (!result?.success) { this.setStatus(result?.error || 'Could not add that reminder.', 'error'); return; }
    this.$('#remText').value = ''; this.$('#remWhen').value = toLocalInput(Date.now() + 10 * 60000); this.setStatus(`Reminder set — ${result.item.text} · ${whenLabel(result.item.dueAt)}.`, 'ok');
  }

  async refresh() {
    if (!this.api) { this.setStatus('Reminder API unavailable. Restart NEXORA to load the updated preload.', 'error'); return; }
    const result = await this.api.list();
    if (!result?.success) { this.setStatus(result?.error || 'Reminders are unavailable.', 'error'); return; }
    this.items = result.items; this.skew = (result.now || Date.now()) - Date.now();
    this.renderLists(); this.options.onCount?.(this.items.filter((i) => i.status === 'fired').length);
  }
  onShow() { void this.refresh(); }

  row(item, kind) {
    const row = el('div', `rem-item rem-${kind}`); row.dataset.id = item.id;
    const main = el('div', 'rem-item-main');
    main.append(el('div', 'rem-item-text', item.text));
    const meta = el('div', 'rem-item-meta');
    const when = el('span', 'rem-when', whenLabel(item.dueAt)); meta.appendChild(when);
    if (item.repeat !== 'none') meta.appendChild(el('span', 'rem-repeat', `↻ ${REPEAT_LABEL[item.repeat]}`));
    if (kind === 'upcoming') { const cd = el('span', 'rem-countdown', countdown(item.dueAt, Date.now() + this.skew)); cd.dataset.due = String(item.dueAt); meta.appendChild(cd); }
    if (item.source === 'voice' || item.source === 'chat') meta.appendChild(el('span', 'rem-src', item.source === 'voice' ? '🎙 voice' : '💬 chat'));
    main.appendChild(meta);
    const actions = el('div', 'rem-item-actions');
    const btn = (label, cls, fn) => { const b = el('button', `rem-icon-btn ${cls || ''}`, label); b.type = 'button'; b.addEventListener('click', fn); actions.appendChild(b); };
    if (kind === 'due') { btn('Done', 'primary', () => this.api.done(item.id)); btn('+5m', '', () => this.api.snooze(item.id, 5)); btn('+1h', '', () => this.api.snooze(item.id, 60)); }
    else if (kind === 'upcoming') { btn('Done', '', () => this.api.done(item.id)); btn('Delete', 'danger', () => this.api.remove(item.id)); }
    else { btn('Delete', 'danger', () => this.api.remove(item.id)); }
    row.append(main, actions); return row;
  }

  renderLists() {
    const due = this.items.filter((i) => i.status === 'fired');
    const up = this.items.filter((i) => i.status === 'pending');
    const done = this.items.filter((i) => i.status === 'done').slice(0, 12);
    const dayKey = (value) => { const d = new Date(value); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    const todayKey = dayKey(Date.now() + this.skew);
    const today = up.filter((i) => dayKey(i.dueAt) === todayKey);
    const later = up.filter((i) => dayKey(i.dueAt) !== todayKey);
    const fill = (id, rows, kind, empty) => { const box = this.$(id); if (!box) return; box.replaceChildren(); if (!rows.length && empty) box.appendChild(el('div', 'rem-empty', empty)); rows.forEach((r) => box.appendChild(this.row(r, kind))); };
    this.$('#remDueWrap').hidden = !due.length;
    this.$('#remLaterWrap').hidden = !later.length;
    this.$('#remDoneWrap').hidden = !done.length;
    fill('#remDue', due, 'due');
    fill('#remUpcoming', today, 'upcoming', 'Nothing scheduled for today.');
    fill('#remLater', later, 'upcoming');
    fill('#remDone', done, 'done');
    this.$('#remCount').textContent = `${up.length} upcoming`;
  }

  tickClock() {
    const now = Date.now() + this.skew;
    this.container.querySelectorAll('.rem-countdown[data-due]').forEach((n) => { n.textContent = countdown(Number(n.dataset.due), now); });
  }

  destroy() { clearInterval(this.clock); this.unsubscribe?.(); }
}
