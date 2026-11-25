/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — Autonomy tab: run a task, switch features on/off, set permission levels, read the action log. */
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const FEATURES = [
  { group: '1 · Proactive', items: [
    { path: 'morningBrief', label: 'Morning brief', hint: 'One card a day: reminders, project, yesterday’s summary' },
    { path: 'nudges', label: 'Reminder nudges', hint: 'Offers a new time after you snooze twice, or say “later”' },
    { path: 'habits.water.enabled', label: 'Water check-ins', hint: 'Every', every: 'habits.water.everyMin' },
    { path: 'habits.stretch.enabled', label: 'Stretch check-ins', hint: 'Every', every: 'habits.stretch.everyMin' } ] },
  { group: '2 · Memory upkeep', items: [
    { path: 'memoryUpkeep', label: 'Auto upkeep', hint: 'Merge duplicates, retire old chat notes, daily summary' },
    { path: 'confirmStaleFacts', label: 'Confirm old facts', hint: 'Asks “is this still true?” (never removes without your tap)' } ] },
  { group: '3 + 5 · Computer actions and tasks', items: [
    { path: 'agent.enabled', label: 'Allow tasks', hint: 'Plan → you approve → NEXORA runs step by step. “Nexora, stop” cancels.' },
    { path: 'voiceApproval', label: 'Approve by voice', hint: 'When a permission card shows, say “OK” / “allow” / “seri” to allow it or “no” / “venam” to deny — no mouse needed' } ] },
  { group: '4 · Screen awareness', items: [
    { path: 'screenHelp', label: 'Explain my screen', hint: 'Hotkey / voice / “explain my screen” (every monitor) or “see my Chrome screen” / “see the Brave screen” (that app’s monitor) — screenshots go to Gemini, never saved' },
    { path: 'screenWatch', label: 'Window-title watcher', hint: 'Offers help for error windows or 20+ min on one window (titles only, no screenshots)' } ] },
  { group: '6 · Watchers', items: [
    { path: 'watchers.downloads', label: 'New .zip downloads', hint: 'Offers to extract' },
    { path: 'watchers.battery', label: 'Battery', hint: 'Low / critical alerts' },
    { path: 'watchers.disk', label: 'Disk space', hint: 'Once a day when nearly full' },
    { path: 'watchers.clipboardErrors', label: 'Copied errors', hint: 'Reads clipboard text locally to spot error messages (off by default)' } ] },
];
const LEVEL_LABEL = { ask: 'Ask every time', once: 'Ask once per session', always: 'Always allow', deny: 'Never allow' };
const KIND_ICON = { action: '⚙', task: '▶', proactive: '💡', watcher: '👁', memory: '🧠', screen: '🖥' };
const fmtTime = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export class AutonomyPanel {
  constructor(container, options = {}) {
    this.container = container; this.options = options; this.api = window.nexoraAPI?.autonomy; this.cfg = window.nexoraAPI?.config; this.data = null;
    this.render(); this.bind();
    this.unsubscribe = this.api?.onChanged?.((p) => { if (p?.task !== undefined) this.paintTask(p.task); else void this.refresh(); });
    void this.refresh();
  }
  render() {
    this.container.innerHTML = `
      <div class="nexora-panel nexora-autonomy-panel">
        <div class="panel-header">
          <div class="panel-title-cluster"><h2 class="panel-title">Auto</h2><span class="panel-subtitle">Autonomous actions with your control</span><span class="rem-count" id="auStatus">idle</span></div>
          <div class="panel-actions"><button class="panel-btn-close" id="auClose" title="Close panel — Return to Core" aria-label="Close Autonomy">×</button></div>
        </div>
        <div class="rem-scroll">
          <section><div class="rem-section-title"><span>RUN A TASK</span><small>you approve before anything runs</small></div>
            <div class="rem-quick-row"><input id="auGoal" type="text" maxlength="500" placeholder="open VS Code and Chrome · create a folder nexora-test on the desktop and open it in VS Code" /><button id="auRun" type="button" class="rem-btn primary">Run</button></div>
            <div class="rem-chips"><button type="button" data-goal="open VS Code and Chrome">VS Code + Chrome</button><button type="button" data-goal="open downloads folder">Downloads</button><button type="button" data-goal="search files for report">Find “report”</button><button type="button" data-goal="open Discord">Discord</button><button type="button" data-goal="open D drive">D drive</button></div>
            <div class="au-task" id="auTask" hidden></div><div class="au-msg" id="auMsg"></div>
            <div class="rem-chips"><button type="button" id="auStop" class="au-stop" hidden>■ Stop task</button><button type="button" id="auShot">Explain my screen</button><button type="button" id="auBrief">Show morning brief</button><button type="button" id="auUpkeep">Run memory upkeep</button></div>
            <div class="au-hint">Chat shortcuts: <code>/do open VS Code</code> · <code>explain my screen</code> · say “Nexora, stop”. Screen hotkey: <b id="auHotkey">—</b></div></section>
          <section><div class="rem-section-title"><span>FEATURES</span><small>every switch is yours</small></div><div id="auFeatures"></div></section>
          <section><div class="rem-section-title"><span>PERMISSIONS</span><small>per action</small></div><div id="auPerms"></div></section>
          <section><div class="rem-section-title"><span>ACTION LOG</span><button id="auClear" type="button" class="rem-icon-btn">Clear</button></div><div id="auLog"></div></section>
        </div>
      </div>`;
  }
  $(id) { return this.container.querySelector('#' + id); }
  bind() {
    this.$('auClose').addEventListener('click', () => this.options.onClose?.());
    const run = async (goal) => {
      const text = (goal ?? this.$('auGoal').value).trim(); if (!text) return;
      this.$('auMsg').textContent = 'Planning… watch the card at the top-right of your screen.'; this.$('auRun').disabled = true;
      const r = await this.api?.runTask?.(text); this.$('auRun').disabled = false;
      this.$('auMsg').textContent = r?.summary || ''; void this.refresh();
    };
    this.$('auRun').addEventListener('click', () => run());
    this.$('auGoal').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    this.container.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', () => { this.$('auGoal').value = b.dataset.goal; run(b.dataset.goal); }));
    this.$('auStop').addEventListener('click', () => this.api?.stop?.());
    this.$('auShot').addEventListener('click', async () => { const r = await this.api?.explainScreen?.(); this.$('auMsg').textContent = r?.success ? 'Answer shown as a card.' : (r?.error || ''); });
    this.$('auBrief').addEventListener('click', () => this.api?.briefNow?.());
    this.$('auUpkeep').addEventListener('click', async () => { const r = await this.api?.upkeepNow?.(); this.$('auMsg').textContent = r?.success ? `Upkeep done: ${r.deduped} duplicate(s) merged, ${r.retired} old note(s) retired${r.summary ? ', summary saved' : ''}.` : ''; });
    this.$('auClear').addEventListener('click', async () => { await this.api?.clearLog?.(); void this.refresh(); });
  }
  onShow() { void this.refresh(); }
  async refresh() { const s = await this.api?.state?.(); if (!s?.success) return; this.data = s; this.paint(); }
  paint() {
    const d = this.data; if (!d) return;
    this.$('auHotkey').textContent = d.hotkey || 'not set / in use';
    this.paintTask(d.task); this.paintFeatures(); this.paintPerms(); this.paintLog();
  }
  paintTask(task) {
    const box = this.$('auTask'), stop = this.$('auStop'), status = this.$('auStatus'); if (!box) return;
    box.hidden = !task; stop.hidden = !task; status.textContent = task ? (task.status === 'planning' ? 'planning…' : `step ${task.step}/${task.total}`) : 'idle';
    box.replaceChildren(); if (!task) return;
    box.append(el('div', 'au-task-goal', task.goal));
    for (const s of task.steps || []) box.append(el('div', `au-step ${s.state}`, `${{ pending: '○', running: '◐', done: '✓', failed: '✗', denied: '⛔' }[s.state] || '○'} ${s.text}`));
  }
  paintFeatures() {
    const host = this.$('auFeatures'); host.replaceChildren();
    for (const g of FEATURES) {
      host.append(el('div', 'au-group', g.group));
      for (const f of g.items) {
        const row = el('label', 'au-row'); const box = el('input'); box.type = 'checkbox'; box.checked = getPath(this.data.flags, f.path) === true;
        box.addEventListener('change', async () => { await this.cfg?.set?.(`autonomy.${f.path}`, box.checked); void this.refresh(); });
        const text = el('span', 'au-row-text'); text.append(el('b', '', f.label), el('small', '', f.hint));
        row.append(box, text);
        if (f.every) { const sel = el('select'); for (const m of [30, 45, 60, 90, 120]) { const o = el('option', '', `${m} min`); o.value = String(m); sel.append(o); } sel.value = String(getPath(this.data.flags, f.every) || 60); sel.addEventListener('change', () => this.cfg?.set?.(`autonomy.${f.every}`, Number(sel.value))); sel.addEventListener('click', (e) => e.stopPropagation()); row.append(sel); }
        host.append(row);
      }
    }
  }
  paintPerms() {
    const host = this.$('auPerms'); host.replaceChildren();
    for (const p of this.data.permissions) {
      const row = el('div', 'au-perm'); const info = el('span', 'au-row-text'); info.append(el('b', '', (this.data.actions[p.action]?.label || p.action)), el('small', '', `${p.action} · ${p.risk} risk`));
      const sel = el('select'); for (const [k, v] of Object.entries(LEVEL_LABEL)) { const o = el('option', '', v); o.value = k; sel.append(o); } sel.value = p.level;
      sel.addEventListener('change', async () => { await this.api?.setPermission?.(p.action, sel.value); });
      row.append(info, sel); host.append(row);
    }
  }
  paintLog() {
    const host = this.$('auLog'); host.replaceChildren();
    if (!this.data.log.length) { host.append(el('div', 'rem-empty', 'Nothing yet. Everything NEXORA does on its own or with your approval is listed here.')); return; }
    for (const e of this.data.log) { const row = el('div', `au-log ${e.ok ? '' : 'bad'}`); row.append(el('span', 'au-log-ico', KIND_ICON[e.kind] || '•'), el('span', 'au-log-text', e.summary), el('time', '', fmtTime(e.at))); host.append(row); }
  }
}
