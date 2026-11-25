/* ==========================================================================
   NEXORA — Orb Studio panels (v0.3.24)
   Splits Orb Studio into separate panels (Orb / Quality / Robot / Popup) behind a tab bar, and runs the
   live Render Quality panel (Low / Medium / High / Very High) with real-time stats.
   ========================================================================== */
import { PERFORMANCE_PROFILES } from './orb-engine.js';

const TAB_KEY = 'nexora-orb-studio-tab';
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage can be unavailable */ } };

export class StudioPanels {
  /** @param {{engine: object, root: HTMLElement, onQuality: (mode: string) => void}} o */
  constructor({ engine, root, onQuality }) {
    this.engine = engine; this.root = root; this.onQuality = onQuality;
    this.tabs = [...root.querySelectorAll('.studio-tab')];
    this.panes = [...root.querySelectorAll('.studio-pane')];
    this.robotTab = root.querySelector('#studioTabRobot');
    this.grid = root.querySelector('#qualityGrid');
    this.note = root.querySelector('#qualityNote');
    this.hint = root.querySelector('#qualityHint');
    this.stats = {}; root.querySelectorAll('[data-stat]').forEach((n) => { this.stats[n.dataset.stat] = n; });
    this.active = 'orb';
    this.bind();
    this.syncRobotTab();
    this.syncQuality(engine.getPerformanceMode());
    this.show(this.validTab(safeGet(TAB_KEY)) || 'orb', false);
    this.timer = setInterval(() => this.tickStats(), 500);
  }

  validTab(name) { return this.tabs.some((t) => t.dataset.tab === name) && !(name === 'robot' && this.robotTab?.hidden) ? name : null; }

  bind() {
    this.tabs.forEach((t) => t.addEventListener('click', () => this.show(t.dataset.tab, true)));
    // arrow-key navigation across the tab bar
    this.root.querySelector('#studioTabs')?.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const vis = this.tabs.filter((t) => !t.hidden); const i = vis.findIndex((t) => t.dataset.tab === this.active); if (i < 0) return;
      const next = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]; next.focus(); this.show(next.dataset.tab, true); e.preventDefault();
    });
    this.grid?.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => this.onQuality?.(b.dataset.quality)));
  }

  show(name, remember = true) {
    if (!this.validTab(name)) name = 'orb';
    this.active = name;
    this.tabs.forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    this.panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
    if (remember) safeSet(TAB_KEY, name);
    if (name === 'quality') this.tickStats();
  }

  /** The Robot tab exists only while the 3D robot Orb is selected. Call after the preset changes. */
  syncRobotTab() {
    const on = this.engine.getProfile() === 'robot';
    if (this.robotTab) this.robotTab.hidden = !on;
    if (!on && this.active === 'robot') this.show('orb', false);
    if (this.hint) this.hint.hidden = on;
  }

  /** Highlights the chosen tier and describes what it does. Safe to call from any source (Settings, saved config...). */
  syncQuality(mode) {
    const q = PERFORMANCE_PROFILES[mode] || PERFORMANCE_PROFILES.medium;
    this.grid?.querySelectorAll('[data-quality]').forEach((b) => { const on = b.dataset.quality === q.id; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    if (this.note) this.note.textContent = `${q.label}: ${q.note}.`;
    const set = (k, v) => { if (this.stats[k]) this.stats[k].textContent = v; };
    set('aa', q.aa ? 'Multisampled' : 'Off');
    set('ss', q.ssaa > 1 ? q.ssaa + '×' : 'None');
    set('env', q.env > 0 ? Math.round(q.env * 100) + '%' : 'Off');
    set('cap', q.fps + ' FPS');
    this.syncRobotTab();
    this.tickStats();
  }

  tickStats() {
    if (this.active !== 'quality' || document.hidden) return;
    const s = this.engine.getStats();
    if (this.stats.fps) this.stats.fps.textContent = s.fps ? s.fps + ' FPS' : '-';
    if (this.stats.px) this.stats.px.textContent = s.robotActive && s.renderPx ? s.renderPx + ' × ' + s.renderPx + ' px' : (s.robotActive ? 'Loading…' : 'Robot Orb off');
  }

  destroy() { clearInterval(this.timer); }
}
