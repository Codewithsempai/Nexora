/* ==========================================================================
   NEXORA — Robot Studio (Orb Studio section for the 3D robot Orb)
   Expressions, facial actions, eye styles, emote FX, screen VFX, face colour and body animations.
   Built from the robot runtime's own tables, so new expressions / effects appear here automatically.
   ========================================================================== */
import { loadRobotRuntime, ROBOT_PAINTS } from './robot-orb.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const OPEN_SECTIONS = new Set(['View', 'Robot paint', 'Expressions']);
const pretty = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export class RobotStudio {
  constructor(engine, root) { this.engine = engine; this.root = root; this.built = false; this.chips = new Map(); }

  /** show the studio only while the robot Orb is selected */
  async refresh() {
    if (!this.root) return;
    const on = this.engine.getProfile() === 'robot';
    this.root.hidden = !on;
    if (!on) return;
    if (!this.built) { try { await loadRobotRuntime(); } catch { this.root.textContent = 'Robot runtime could not be loaded.'; return; } this.build(); }
    this.syncActive();
  }

  get robot() { return this.engine.robot; }

  /** Collapsible section: the heading toggles it. The first few stay open, the rest start folded so the panel is easy to scan. */
  section(title, hint) {
    const s = el('div', 'rs-section'); const h = el('div', 'rs-head'); h.append(el('span', null, title)); if (hint) h.append(el('small', null, hint));
    h.setAttribute('role', 'button'); h.tabIndex = 0;
    const open = OPEN_SECTIONS.has(title); s.classList.toggle('collapsed', !open); h.setAttribute('aria-expanded', String(open));
    const toggle = () => { const c = s.classList.toggle('collapsed'); h.setAttribute('aria-expanded', String(!c)); };
    h.addEventListener('click', toggle); h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    s.append(h); this.root.append(s); return s;
  }
  chip(parent, label, onClick, key) {
    const b = el('button', 'rs-chip', label); b.type = 'button';
    b.addEventListener('click', () => { onClick(b); this.syncActive(); });
    parent.append(b); if (key) this.chips.set(key, b); return b;
  }
  row(parent) { const r = el('div', 'rs-row'); parent.append(r); return r; }
  toggle(parent, label, get, set, key) {
    const b = el('button', 'rs-chip rs-toggle', label); b.type = 'button';
    const paint = () => { b.classList.toggle('active', !!get()); b.setAttribute('aria-pressed', String(!!get())); };
    b.addEventListener('click', () => { set(!get()); paint(); }); paint(); parent.append(b); if (key) this.chips.set(key, { paint, el: b }); return b;
  }
  slider(parent, label, min, max, step, get, set) {
    const w = el('label', 'rs-slider'); const t = el('span', null, label), o = el('output'), i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = get(); o.textContent = (+i.value).toFixed(2);
    i.addEventListener('input', () => { set(+i.value); o.textContent = (+i.value).toFixed(2); }); w.append(t, i, o); parent.append(w); return w;
  }

  build() {
    const F = window.NexoraFace, S = window.NexoraFaceScreen, A = window.NexoraAnimator, root = this.root; root.textContent = ''; this.built = true;
    const head = el('div', 'rs-title'); head.append(el('span', null, 'ROBOT STUDIO'), el('small', null, 'Expressions, face effects and body animations for the NEXORA robot Orb.'));
    root.append(head);
    const R = () => this.robot;

    // ---- view ----
    let s = this.section('View');
    let r = this.row(s);
    ['auto', 'full', 'bust', 'face'].forEach((v) => this.chip(r, pretty(v), () => R()?.setView(v), 'view:' + v));
    r = this.row(s);
    this.toggle(r, 'Body acts the emotion', () => R()?.bodyActs, (v) => R()?.setBodyActs(v));

    s = this.section('Robot paint'); r = this.row(s);
    Object.entries(ROBOT_PAINTS).forEach(([id, p]) => this.chip(r, p.label, () => R()?.paint(id), 'paint:' + id));

    // ---- expressions ----
    s = this.section('Expressions', 'Held until you press Auto. Auto = the face follows the Orb state.');
    r = this.row(s); this.chip(r, '↺ Auto (follow state)', () => R()?.auto(), 'auto');
    for (const [group, ids] of Object.entries(S.EXPRESSION_GROUPS)) {
      s.append(el('div', 'rs-sub', group)); r = this.row(s);
      ids.forEach((id) => this.chip(r, S.EXPRESSIONS[id].label, () => R()?.express(id), 'ex:' + id));
    }

    // ---- facial actions ----
    s = this.section('Facial actions', 'Timed actions play once; the rest are held poses.');
    const timed = Object.keys(F.ACTIONS);
    for (const [group, list] of Object.entries(F.ACTION_GROUPS)) {
      s.append(el('div', 'rs-sub', group)); r = this.row(s);
      list.forEach((k) => this.chip(r, k, () => { if (timed.includes(k)) R()?.action(k); else R()?.pose(k); }, 'pose:' + k));
    }

    // ---- eyes ----
    s = this.section('Eye style'); r = this.row(s);
    this.chip(r, 'Normal', () => R()?.eyes(null), 'eye:');
    F.EYE_STYLES.forEach((k) => this.chip(r, pretty(k), () => R()?.eyes(k), 'eye:' + k));

    // ---- emote FX ----
    s = this.section('Emote FX', 'Particles and marks drawn on the face.'); r = this.row(s);
    S.FX_LIST.forEach((k) => this.toggle(r, pretty(k), () => R()?.screen?.fx.has(k), () => R()?.toggleFx(k), 'fx:' + k));
    r = this.row(s); this.chip(r, 'Clear FX', () => { R()?.screen?.clearFx(); });

    // ---- screen VFX ----
    s = this.section('Face screen VFX'); r = this.row(s);
    S.VFX.forEach(([id, label]) => this.toggle(r, label, () => R()?.screen?.get(id), (v) => R()?.setVfx({ [id]: v }), 'vfx:' + id));
    r = this.row(s);
    this.chip(r, '▶ Boot', () => R()?.vfx('boot')); this.chip(r, '⚡ Glitch', () => R()?.vfx('glitch'));
    this.chip(r, '⏻ Screen off', () => R()?.vfx('screenOff')); this.chip(r, '⏻ Screen on', () => R()?.vfx('screenOn'));
    this.slider(s, 'Glow', .2, 2.2, .05, () => R()?.screen?.get('glow') ?? 1, (v) => R()?.setVfx({ glow: v }));
    this.slider(s, 'Expression strength', .3, 1.5, .05, () => R()?.screen?.get('intensity') ?? 1, (v) => R()?.setVfx({ intensity: v }));
    const cw = el('label', 'rs-slider'); const ct = el('span', null, 'Face colour'), ci = el('input'); ci.type = 'color'; ci.value = '#7fe3ff';
    const st = el('button', 'rs-chip', 'State colour'); st.type = 'button';
    ci.addEventListener('input', () => R()?.setVfx({ color: ci.value })); st.addEventListener('click', () => R()?.setVfx({ color: null }));
    cw.append(ct, ci, st); s.append(cw);

    // ---- body animations ----
    s = this.section('Body animations', 'All 14 states of the robot.'); r = this.row(s);
    A.STATE_LIST.forEach((k) => this.chip(r, pretty(k), () => R()?.playBody(k)));

    this.engine.onRobotChange = () => this.syncActive();
  }

  syncActive() {
    const rb = this.robot; if (!rb || !this.built) return;
    for (const [k, c] of this.chips) {
      if (c.paint) { c.paint(); continue; }
      let on = false;
      if (k === 'auto') on = !rb.lock;
      else if (k.startsWith('view:')) on = rb.view === k.slice(5);
      else if (k.startsWith('ex:')) on = rb.expression === k.slice(3);
      else if (k.startsWith('paint:')) on = rb.paintName === k.slice(6);
      else if (k.startsWith('eye:')) on = (rb.screen?.face.eyeStyle || '') === k.slice(4);
      else if (k.startsWith('pose:')) on = rb.screen?.face.pose === k.slice(5);
      c.classList.toggle('active', on);
    }
  }
}
