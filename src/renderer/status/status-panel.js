/* ==========================================================================
   NEXORA — Telemetry panel (v0.3.35 · smooth real-time renderer)
   Live CPU / memory / latency cards with sparklines, a 5-minute runtime chart,
   service health and a system log. Every number comes from the main process
   (system:get-status) — nothing here is simulated.

   Why it is smooth now
   • Sampling (1 s) and drawing (display rate) are fully decoupled.
   • The charts are <canvas>, redrawn from a single requestAnimationFrame loop.
     No SVG path strings, no innerHTML and no layout work happen per frame.
   • Time scrolls continuously. The head of every line is a *real* point
     interpolated between the two newest samples (render delay ≈ 1.3 s), so the
     lines glide instead of jumping once per poll. Nothing is extrapolated.
   • Curves use monotone cubic interpolation (no overshoot, no fake peaks).
   • Axis ranges, big numbers and sparkline scales ease toward their targets.
   • The loop runs only while the page is open, visible and on screen, and it
     drops itself to 30 fps if a slow GPU/CPU can't keep up.
   • While the page is closed a tiny 5 s sampler keeps the 5-min history filled,
     so the chart is already populated when you open it.
   ========================================================================== */

const WINDOW_MS = 5 * 60 * 1000;
const SPARK_MS = 45 * 1000;
const RENDER_DELAY = 1300;          // draw slightly in the past so the head is always interpolated between real samples
const FAST_MS = 1000;               // sample interval while the page is open
const SLOW_MS = 5000;               // sample interval while the page is closed
const GAP_MS = 12000;               // a bigger hole than this breaks the line (app hidden / asleep)
const MAX_POINTS = 420;
const MAX_LOG = 80;
const pad = (n) => String(n).padStart(2, '0');
const clock = (t, seconds = true) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`; };
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtNum = (v) => (Math.abs(v) < 10 && v % 1 !== 0 ? v.toFixed(1) : String(Math.round(v)));

/* ---------- curve helpers ------------------------------------------------ */

/** Fritsch–Carlson monotone tangents (slope per pixel) for one run of {x,y} points. */
function monotoneSlopes(p) {
  const n = p.length; const m = new Array(n).fill(0);
  if (n < 2) return m;
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) { const dx = p[i + 1].x - p[i].x; d[i] = dx > 0 ? (p[i + 1].y - p[i].y) / dx : 0; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i]; const b = m[i + 1] / d[i]; const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
}

/**
 * Build Path2D objects for one series.
 * samples: [{t,...}] sorted; get(sample) → value; xOf(t) / yOf(v) → pixels.
 * The line ends exactly at `headT` (an interpolated, real position).
 */
function buildSeries(samples, get, xOf, yOf, startT, headT, fillBottom) {
  const stroke = new Path2D(); const fill = fillBottom !== undefined ? new Path2D() : null;
  let head = null;
  // 1. visible slice (+1 before the left edge, +1 after the head so the head segment has a true tangent)
  let i0 = samples.length;
  while (i0 > 0 && samples[i0 - 1].t >= startT) i0--;
  if (i0 > 0) i0--;
  let runs = []; let cur = []; let prevT = null;
  for (let i = i0; i < samples.length; i++) {
    const s = samples[i];
    if (prevT !== null && s.t - prevT > GAP_MS) { runs.push(cur); cur = []; }
    cur.push({ t: s.t, x: xOf(s.t), y: yOf(get(s)) }); prevT = s.t;
    if (s.t > headT) break;
  }
  if (cur.length) runs.push(cur);
  for (const run of runs) {
    if (run.length < 2) { if (run.length === 1 && run[0].t <= headT) head = { x: run[0].x, y: run[0].y }; continue; }
    const m = monotoneSlopes(run);
    stroke.moveTo(run[0].x, run[0].y);
    if (fill) fill.moveTo(run[0].x, fillBottom), fill.lineTo(run[0].x, run[0].y);
    let endX = run[0].x;
    for (let k = 0; k < run.length - 1; k++) {
      const a = run[k]; const b = run[k + 1];
      if (a.t >= headT) break;
      const dx = (b.x - a.x) / 3;
      let P1x = a.x + dx; let P1y = a.y + m[k] * dx; let P2x = b.x - dx; let P2y = b.y - m[k + 1] * dx; let P3x = b.x; let P3y = b.y;
      if (b.t > headT) { // split the Bézier at u so the line ends exactly at the interpolated head
        const u = clamp((headT - a.t) / (b.t - a.t), 0, 1);
        const lerp = (p, q) => p + (q - p) * u;
        const q0x = lerp(a.x, P1x), q0y = lerp(a.y, P1y), q1x = lerp(P1x, P2x), q1y = lerp(P1y, P2y), q2x = lerp(P2x, P3x), q2y = lerp(P2y, P3y);
        const r0x = lerp(q0x, q1x), r0y = lerp(q0y, q1y), r1x = lerp(q1x, q2x), r1y = lerp(q1y, q2y);
        P3x = lerp(r0x, r1x); P3y = lerp(r0y, r1y); P1x = q0x; P1y = q0y; P2x = r0x; P2y = r0y;
      }
      stroke.bezierCurveTo(P1x, P1y, P2x, P2y, P3x, P3y);
      if (fill) fill.bezierCurveTo(P1x, P1y, P2x, P2y, P3x, P3y);
      endX = P3x; head = { x: P3x, y: P3y };
    }
    if (fill) { fill.lineTo(endX, fillBottom); fill.closePath(); }
  }
  return { stroke, fill, head };
}

/** Linear value at time t (used for hover read-outs). */
function valueAt(samples, key, t) {
  if (!samples.length) return null;
  let i = samples.length - 1;
  while (i > 0 && samples[i].t > t) i--;
  const a = samples[i]; const b = samples[i + 1];
  if (!b || b.t - a.t > GAP_MS || t <= a.t) return a[key];
  return a[key] + (b[key] - a[key]) * ((t - a.t) / (b.t - a.t));
}

const CPU_STEPS = [4, 8, 20, 40, 100];
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

export class StatusPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();
    this.history = [];
    this.log = [];
    this.logRendered = 0;
    this.prevServices = {};
    this.svcRows = new Map();
    this.lastResourceLog = 0;
    this.lastWarn = 0;
    this.busy = false;
    this.open = false;
    this.timer = null;
    this.raf = 0;
    this.lastTs = 0;
    this.lowFps = false;
    this.costEma = 0;
    this.frameN = 0;
    this.inView = true;
    this.hover = null;
    this.dirtyOnce = true;
    this.cv = {};
    // eased display state
    this.ax = { cpuMax: 8, memLo: 0, memHi: 200, cpuMaxT: 8, memLoT: 0, memHiT: 200, memStep: 50 };
    this.num = { cpu: { v: 0, t: 0, s: '' }, mem: { v: 0, t: 0, s: '' }, lat: { v: 0, t: 0, s: '' } };
    this.sp = { cpu: { lo: 0, hi: 5 }, mem: { lo: 0, hi: 20 }, lat: { lo: 0, hi: 2 } };
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    this._frame = this._frame.bind(this);
    this._onVis = () => { if (!document.hidden) this._schedule(0); this._syncLoop(); };
    document.addEventListener('visibilitychange', this._onVis);
    this.render();
    this.initEvents();
    this.addLog('INFO', 'Telemetry ready');
    this._schedule(1200); // light background sampler keeps the 5-minute history filled
  }

  /* ---------- DOM ------------------------------------------------------- */

  render() {
    this.container.innerHTML = `
      <div class="nexora-panel nexora-status-panel">
        <div class="panel-header">
          <div class="panel-title-cluster">
            <h2 class="panel-title">Telemetry</h2><span class="panel-subtitle">System, services and runtime insights</span>
            <span class="telemetry-live-badge">REAL-TIME</span>
          </div>
          <button class="panel-btn-close" id="btnCloseStatus" title="Close panel — Return to Core" aria-label="Close Telemetry"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
        <div class="panel-scroll-content tele-layout">
          <div class="tele-stats">
            ${this.statCard('cpu', 'CPU')}${this.statCard('mem', 'MEMORY')}${this.statCard('lat', 'LATENCY')}
            <div class="tele-stat tele-stat-core"><span class="tele-label">NATIVE CORE</span><strong class="tele-value" id="teleCore">—</strong></div>
          </div>
          <section class="tele-card tele-chart-card" aria-label="Runtime chart">
            <header class="tele-card-head"><span class="tele-label">RUNTIME (LAST 5 MIN)</span>
              <span class="tele-legend"><i class="lg lg-cpu"></i>CPU (%)<i class="lg lg-mem"></i>MEMORY (MB)</span></header>
            <div class="tele-chart"><canvas class="tele-canvas" id="teleCanvas" role="img" aria-label="CPU and memory over the last five minutes"></canvas></div>
          </section>
          <div class="tele-bottom">
            <section class="tele-card"><header class="tele-card-head"><span class="tele-label">SERVICES</span><span class="tele-count" id="teleActive">0 ACTIVE</span></header><ul class="tele-services" id="teleServices"></ul></section>
            <section class="tele-card"><header class="tele-card-head"><span class="tele-label">SYSTEM LOG</span><span class="tele-count">LIVE</span></header><div class="tele-log" id="teleLog" role="log" aria-live="off"></div></section>
          </div>
        </div>
      </div>`;
    const q = (s) => this.container.querySelector(s);
    this.el = {
      cpu: q('#teleCpu'), mem: q('#teleMem'), lat: q('#teleLat'), core: q('#teleCore'),
      services: q('#teleServices'), active: q('#teleActive'), logBox: q('#teleLog'),
    };
    const mk = (key, el) => { const c = { el, ctx: el.getContext('2d'), w: 0, h: 0, dpr: 1 }; this.cv[key] = c; return c; };
    mk('chart', q('#teleCanvas')); mk('cpu', q('#sparkCpu')); mk('mem', q('#sparkMem')); mk('lat', q('#sparkLat'));
    const cs = getComputedStyle(document.documentElement);
    this.mono = (cs.getPropertyValue('--nexora-font-mono') || '').trim() || 'ui-monospace, Consolas, monospace';

    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this._resize());
    Object.values(this.cv).forEach((c) => this.ro.observe(c.el));
    this.io?.disconnect();
    this.io = new IntersectionObserver((entries) => { this.inView = entries.some((e) => e.isIntersecting); this._syncLoop(); }, { threshold: 0 });
    this.io.observe(this.cv.chart.el);
    this._onWinResize = () => this._resize();
    window.addEventListener('resize', this._onWinResize);

    const chart = this.cv.chart.el;
    chart.addEventListener('pointermove', (e) => { const r = chart.getBoundingClientRect(); this.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.dirtyOnce = true; });
    chart.addEventListener('pointerleave', () => { this.hover = null; this.dirtyOnce = true; });

    this.renderLog(true);
    this._resize();
  }

  statCard(key, label) {
    const id = key[0].toUpperCase() + key.slice(1);
    return `<div class="tele-stat"><span class="tele-label">${label}</span><div class="tele-stat-row"><strong class="tele-value" id="tele${id}">—</strong>
      <canvas class="tele-spark" id="spark${id}" aria-hidden="true"></canvas></div></div>`;
  }

  initEvents() {
    this.container.querySelector('#btnCloseStatus')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.options.onSound?.('panelClose'); this.options.onClose?.();
    });
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of Object.values(this.cv)) {
      const w = c.el.clientWidth; const h = c.el.clientHeight;
      if (!w || !h) { c.w = 0; c.h = 0; continue; }
      const pw = Math.round(w * dpr); const ph = Math.round(h * dpr);
      if (c.el.width !== pw || c.el.height !== ph) { c.el.width = pw; c.el.height = ph; }
      c.w = w; c.h = h; c.dpr = dpr;
    }
    this.dirtyOnce = true;
    this._syncLoop();
  }

  /* ---------- log ------------------------------------------------------- */

  /** Public: other modules (voice, model ladder…) can push lines into the system log. */
  addLog(level, message) {
    this.log.push({ t: Date.now(), level, message: String(message || '').slice(0, 220) });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.renderLog(false);
  }

  renderLog(full) {
    const box = this.el?.logBox; if (!box) return;
    if (full) { box.innerHTML = ''; this.logRendered = 0; }
    const start = Math.max(this.logRendered, this.log.length - MAX_LOG);
    const rows = this.log.slice(start);
    if (!rows.length) return;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
    box.insertAdjacentHTML('beforeend', rows.map((r) => `<div class="tele-log-row"><time>${clock(r.t)}</time><b class="lv-${r.level.toLowerCase()}">[${r.level}]</b><span>${esc(r.message)}</span></div>`).join(''));
    while (box.children.length > MAX_LOG) box.firstElementChild.remove();
    this.logRendered = this.log.length;
    if (stick || full) box.scrollTop = box.scrollHeight;
  }

  /* ---------- lifecycle ------------------------------------------------- */

  startPolling() {
    if (!this.open) this.addLog('INFO', 'Telemetry stream started');
    this.open = true;
    this._schedule(0);
    requestAnimationFrame(() => { this._resize(); this._syncLoop(); });
  }

  stopPolling() {
    this.open = false;
    this._syncLoop();
    this._schedule(SLOW_MS);
  }

  destroy() {
    this.open = false; clearTimeout(this.timer); cancelAnimationFrame(this.raf); this.raf = 0;
    this.ro?.disconnect(); this.io?.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('resize', this._onWinResize);
  }

  recordFrame() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.lastFpsUpdate);
      this.frameCount = 0; this.lastFpsUpdate = now;
    }
  }

  _schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (!document.hidden) await this.updateStatus();
      this._schedule(this.open ? FAST_MS : SLOW_MS);
    }, delay);
  }

  _syncLoop() {
    const want = this.open && !document.hidden && this.inView && this.cv.chart?.w > 0;
    if (want && !this.raf) { this.lastTs = 0; this.raf = requestAnimationFrame(this._frame); }
    else if (!want && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  /* ---------- sampling -------------------------------------------------- */

  computeServices(status, ipcMs) {
    const sv = status.services || {}; const voice = sv.voice || null; const sc = status.sidecar || {};
    const keyed = !!sv.geminiKey;
    const orb = this.options.orbStateManager?.getState?.();
    return [
      { id: 'gemini', name: 'Gemini Service', ok: keyed, text: keyed ? 'Running' : 'No API key', ms: null },
      { id: 'stt', name: 'STT (Live)', ok: !!voice?.liveActive, text: voice?.liveActive ? 'Running' : (voice?.mode === 'connecting' ? 'Connecting' : 'Idle'), ms: null },
      { id: 'tts', name: 'TTS (Gemini)', ok: keyed, text: keyed ? 'Running' : 'No API key', ms: null },
      { id: 'wake', name: 'Wake Listener', ok: !!voice?.wakeEnabled, text: voice?.wakeEnabled ? 'Running' : 'Off', ms: null },
      { id: 'ipc', name: 'IPC Bridge', ok: true, text: 'Running', ms: ipcMs },
      { id: 'native', name: 'Native Core', ok: sc.status === 'online', text: sc.status === 'online' ? 'Running' : (sc.status === 'error' ? 'Error' : 'Simulated'), ms: sc.status === 'online' ? (sc.latencyMs || 0) : null },
      { id: 'orb', name: 'Orb Engine', ok: true, text: orb ? String(orb).toLowerCase() : 'Running', ms: null, extra: `${this.fps.toFixed(0)} fps` },
    ];
  }

  async updateStatus() {
    if (this.busy) return;
    const api = window.nexoraAPI?.system;
    if (!api?.getStatus) return;
    this.busy = true;
    try {
      const t0 = performance.now();
      const status = await api.getStatus();
      const t1 = performance.now();
      const ipcMs = Math.max(0, t1 - t0);
      if (!status || status.error) {
        if (Date.now() - this.lastWarn > 30000) { this.lastWarn = Date.now(); this.addLog('WARN', status?.error || 'Status unavailable'); }
        return;
      }
      const now = Date.now();
      const m = status.metrics || {};
      const mem = Number.isFinite(m.memoryMB) ? m.memoryMB : Math.round((status.memory?.rss || 0) / 1048576);
      const cpu = Number.isFinite(m.cpuPercent) ? m.cpuPercent : 0;
      const last = this.history[this.history.length - 1];
      if (last && now <= last.t) return;
      this.history.push({ t: now, cpu, mem, lat: ipcMs });
      const cutoff = now - WINDOW_MS - 15000;
      let drop = 0;
      while (drop < this.history.length - 1 && this.history[drop].t < cutoff) drop++;
      if (this.history.length - drop > MAX_POINTS) drop = this.history.length - MAX_POINTS;
      if (drop > 0) this.history.splice(0, drop);

      this._retarget(now);
      this.num.cpu.t = cpu; this.num.mem.t = mem; this.num.lat.t = ipcMs;
      if (this.open) {
        const services = this.computeServices(status, ipcMs);
        this.logServiceChanges(services);
        if (now - this.lastResourceLog > 20000) { this.lastResourceLog = now; this.addLog('INFO', `System resources: CPU ${cpu.toFixed(0)}% | MEM ${mem} MB`); }
        this.paintCore(status);
        this.paintServices(services);
      } else {
        this.logServiceChanges(this.computeServices(status, ipcMs));
      }
      this.dirtyOnce = true;
    } catch (error) {
      this.addLog('ERROR', `Telemetry poll failed: ${error?.message || error}`);
    } finally { this.busy = false; }
  }

  logServiceChanges(services) {
    for (const s of services) {
      const prev = this.prevServices[s.id];
      if (prev !== undefined && prev !== s.text) this.addLog(s.ok ? 'INFO' : 'WARN', `${s.name}: ${s.text.toLowerCase()}`);
      this.prevServices[s.id] = s.text;
    }
  }

  /** Decide axis targets once per sample (with hysteresis, so axes don't twitch). */
  _retarget(now) {
    const start = now - WINDOW_MS; let cpuPeak = 0; let lo = Infinity; let hi = -Infinity;
    for (const p of this.history) { if (p.t < start) continue; cpuPeak = Math.max(cpuPeak, p.cpu); lo = Math.min(lo, p.mem); hi = Math.max(hi, p.mem); }
    if (!Number.isFinite(lo)) return;
    const a = this.ax;
    const needCpu = CPU_STEPS.find((s) => s >= cpuPeak * 1.2) || 100;
    if (needCpu > a.cpuMaxT || cpuPeak * 1.2 < a.cpuMaxT * 0.45) a.cpuMaxT = needCpu;
    const span = Math.max(hi - lo, 40); const step = niceStep((span * 1.5) / 4);
    const nLo = Math.max(0, Math.floor((lo - span * 0.25) / step) * step);
    const nHi = Math.max(nLo + step * 4, Math.ceil((hi + span * 0.25) / step) * step);
    const inside = lo >= a.memLoT + (a.memHiT - a.memLoT) * 0.06 && hi <= a.memHiT - (a.memHiT - a.memLoT) * 0.06;
    const tooBig = (a.memHiT - a.memLoT) > (nHi - nLo) * 2.2;
    if (!inside || tooBig || a.memHiT - a.memLoT <= 0) { a.memLoT = nLo; a.memHiT = nHi; }
  }

  paintCore(status) {
    const sc = status.sidecar?.status;
    const txt = sc === 'online' ? 'ONLINE' : (sc === 'error' ? 'ERROR' : 'SIMULATED');
    if (this.el.core.textContent !== txt) this.el.core.textContent = txt;
  }

  /** Keyed service rows: created once, then only changed text nodes are touched. */
  paintServices(services) {
    const active = services.filter((s) => s.ok).length;
    const activeTxt = `${active} ACTIVE`;
    if (this.el.active.textContent !== activeTxt) this.el.active.textContent = activeTxt;
    for (const s of services) {
      let row = this.svcRows.get(s.id);
      if (!row) {
        const li = document.createElement('li');
        li.innerHTML = '<i class="tele-dot"></i><span class="tele-svc-name"></span><span class="tele-svc-state"></span><span class="tele-svc-ms"></span>';
        row = { li, name: li.children[1], state: li.children[2], ms: li.children[3], cls: '', n: '', st: '', m: '' };
        this.svcRows.set(s.id, row); this.el.services.appendChild(li);
      }
      const cls = s.ok ? 'is-on' : 'is-off'; if (row.cls !== cls) { row.li.className = cls; row.cls = cls; }
      if (row.n !== s.name) { row.name.textContent = s.name; row.n = s.name; }
      if (row.st !== s.text) { row.state.textContent = s.text; row.st = s.text; }
      const ms = s.ms !== null && s.ms !== undefined ? `${s.ms < 10 ? Number(s.ms).toFixed(1) : Math.round(s.ms)} ms` : (s.extra || '—');
      if (row.m !== ms) { row.ms.textContent = ms; row.m = ms; }
    }
  }

  /* ---------- animation loop ------------------------------------------- */

  _frame(ts) {
    this.raf = requestAnimationFrame(this._frame);
    if (this.reduceMotion && !this.dirtyOnce) return;
    const minDt = this.lowFps ? 32 : 0;
    if (this.lastTs && ts - this.lastTs < minDt - 3) return;
    const dt = this.lastTs ? Math.min(100, ts - this.lastTs) : 16; this.lastTs = ts;
    const t0 = performance.now();
    this.dirtyOnce = false;
    this._ease(dt);
    const headT = this.reduceMotion && this.history.length ? this.history[this.history.length - 1].t : Date.now() - RENDER_DELAY;
    this._drawChart(headT, ts);
    this._drawSpark('cpu', headT, ts, (p) => p.cpu, 5);
    this._drawSpark('mem', headT, ts, (p) => p.mem, 20);
    this._drawSpark('lat', headT, ts, (p) => p.lat, 2);
    this._paintNumbers();
    // adaptive quality: if drawing costs too much, fall back to 30 fps (and recover when it's cheap again)
    this.costEma = this.costEma * 0.9 + (performance.now() - t0) * 0.1;
    if (++this.frameN % 45 === 0) {
      if (!this.lowFps && this.costEma > 9) this.lowFps = true;
      else if (this.lowFps && this.costEma < 3.5) this.lowFps = false;
    }
  }

  _ease(dt) {
    const a = this.ax; const k = 1 - Math.exp(-dt / 320);
    a.cpuMax += (a.cpuMaxT - a.cpuMax) * k; a.memLo += (a.memLoT - a.memLo) * k; a.memHi += (a.memHiT - a.memHi) * k;
    const kn = 1 - Math.exp(-dt / 220);
    for (const n of Object.values(this.num)) n.v += (n.t - n.v) * kn;
  }

  _paintNumbers() {
    const { cpu, mem, lat } = this.num;
    const c = `${fmtNum(Math.max(0, cpu.v))}%`; if (c !== cpu.s) { cpu.s = c; this.el.cpu.textContent = c; }
    const m = `${Math.round(mem.v)} MB`; if (m !== mem.s) { mem.s = m; this.el.mem.textContent = m; }
    const l = `${lat.v < 10 ? lat.v.toFixed(1) : Math.round(lat.v)} MS`; if (l !== lat.s) { lat.s = l; this.el.lat.textContent = l; }
  }

  _drawChart(headT, ts) {
    const c = this.cv.chart; if (!c.w) return;
    const ctx = c.ctx; const W = c.w; const H = c.h; const a = this.ax;
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const compact = W < 520;
    const L = compact ? 30 : 42; const R = compact ? 34 : 48; const T = 8; const B = compact ? 22 : 26;
    const x0 = L; const x1 = W - R; const y0 = T; const y1 = H - B; const pw = x1 - x0; const ph = y1 - y0;
    if (pw < 40 || ph < 40) return;
    const startT = headT - WINDOW_MS;
    const xOf = (t) => x0 + ((t - startT) / WINDOW_MS) * pw;
    const cpuY = (v) => y1 - clamp(v / a.cpuMax, -0.05, 1.05) * ph;
    const memRange = Math.max(1, a.memHi - a.memLo);
    const memY = (v) => y1 - ((v - a.memLo) / memRange) * ph;
    const small = compact ? 9 : 11;

    // grid
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.075)'; ctx.beginPath();
    for (let i = 0; i <= 4; i++) { const y = Math.round(y0 + (ph * i) / 4) + 0.5; ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    const firstMin = Math.ceil(startT / 60000) * 60000;
    const ticks = [];
    for (let t = firstMin; t <= headT; t += 60000) { const x = Math.round(xOf(t)) + 0.5; ticks.push([t, x]); ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    ctx.stroke();

    // axis labels
    ctx.font = `400 ${small}px ${this.mono}`; ctx.fillStyle = '#a6a6ab'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText(String(Math.round(((a.cpuMax * (4 - i)) / 4) * 10) / 10), x0 - 7, y0 + (ph * i) / 4);
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) ctx.fillText(String(Math.round(a.memLo + (memRange * (4 - i)) / 4)), x1 + 7, y0 + (ph * i) / 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const [t, x] of ticks) {
      const edge = Math.min(x - x0, x1 - x); const alpha = clamp(edge / 26, 0, 1);
      if (alpha <= 0.02) continue;
      ctx.globalAlpha = alpha; ctx.fillText(clock(t, false), x, y1 + 8);
    }
    ctx.globalAlpha = 1;

    // series (clipped to the plot)
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 - 4, pw, ph + 8); ctx.clip();
    const h = this.history;
    const mem = buildSeries(h, (s) => s.mem, xOf, memY, startT, headT, y1);
    const cpu = buildSeries(h, (s) => s.cpu, xOf, cpuY, startT, headT, y1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (mem.fill) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(255,255,255,.075)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fill(mem.fill); }
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.stroke(mem.stroke);
    if (cpu.fill) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fill(cpu.fill); }
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 6; ctx.stroke(cpu.stroke);   // soft glow (cheap: no shadowBlur)
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2; ctx.stroke(cpu.stroke);
    ctx.restore();

    // live head dots with a gentle pulse
    const pulse = (Math.sin(ts / 420) + 1) / 2;
    for (const [s, col] of [[mem, 'rgba(255,255,255,.7)'], [cpu, '#fff']]) {
      if (!s.head) continue;
      ctx.beginPath(); ctx.arc(s.head.x, s.head.y, 3.6 + pulse * 4, 0, 6.2832); ctx.fillStyle = `rgba(255,255,255,${0.16 - pulse * 0.12})`; ctx.fill();
      ctx.beginPath(); ctx.arc(s.head.x, s.head.y, 2.6, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
    }

    if (!h.length) { ctx.fillStyle = '#8f8f95'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `400 12px ${this.mono}`; ctx.fillText('Waiting for first sample…', x0 + pw / 2, y0 + ph / 2); }

    // hover read-out
    const hv = this.hover;
    if (hv && hv.x >= x0 && hv.x <= x1 && h.length) {
      const t = startT + ((hv.x - x0) / pw) * WINDOW_MS;
      const firstT = h[0].t; const lastT = Math.min(headT, h[h.length - 1].t);
      if (t >= firstT && t <= lastT) {
        const cv = valueAt(h, 'cpu', t); const mv = valueAt(h, 'mem', t); const lv = valueAt(h, 'lat', t);
        const x = Math.round(hv.x) + 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
        for (const [y, col] of [[cpuY(cv), '#fff'], [memY(mv), 'rgba(255,255,255,.75)']]) { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.2832); ctx.fillStyle = col; ctx.fill(); }
        const lines = [clock(t), `CPU  ${cv.toFixed(1)} %`, `MEM  ${Math.round(mv)} MB`, `LAT  ${lv < 10 ? lv.toFixed(1) : Math.round(lv)} ms`];
        ctx.font = `400 11px ${this.mono}`; const bw = 138; const bh = 12 + lines.length * 16;
        let bx = x + 12; if (bx + bw > x1) bx = x - 12 - bw; const by = clamp(hv.y - bh / 2, y0, y1 - bh);
        ctx.fillStyle = 'rgba(24,24,27,.92)'; ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 9); else ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        lines.forEach((ln, i) => { ctx.fillStyle = i === 0 ? '#a6a6ab' : '#f1f1f3'; ctx.fillText(ln, bx + 11, by + 16 + i * 16); });
      }
    }
  }

  _drawSpark(key, headT, ts, get, minRange) {
    const c = this.cv[key]; if (!c || !c.w) return;
    const ctx = c.ctx; const W = c.w; const H = c.h;
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const h = this.history; if (!h.length) return;
    const startT = headT - SPARK_MS;
    let lo = Infinity; let hi = -Infinity;
    for (let i = h.length - 1; i >= 0; i--) { const v = get(h[i]); lo = Math.min(lo, v); hi = Math.max(hi, v); if (h[i].t < startT) break; }
    if (hi - lo < minRange) { const mid = (hi + lo) / 2; lo = mid - minRange / 2; hi = mid + minRange / 2; }
    const s = this.sp[key]; const k = 0.06; s.lo += (lo - s.lo) * k; s.hi += (hi - s.hi) * k;
    const padX = 4; const padY = 4; const pw = W - padX * 2; const ph = H - padY * 2;
    const xOf = (t) => padX + ((t - startT) / SPARK_MS) * pw;
    const yOf = (v) => padY + ph - ((v - s.lo) / Math.max(1e-6, s.hi - s.lo)) * ph;
    const ser = buildSeries(h, (p) => get(p), xOf, yOf, startT, headT, undefined);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.82)'; ctx.lineWidth = 1.5; ctx.stroke(ser.stroke);
    ctx.restore();
    if (ser.head) { const pulse = (Math.sin(ts / 420) + 1) / 2; ctx.beginPath(); ctx.arc(ser.head.x, ser.head.y, 2.2 + pulse * 2.2, 0, 6.2832); ctx.fillStyle = `rgba(255,255,255,${0.14 - pulse * 0.1})`; ctx.fill(); ctx.beginPath(); ctx.arc(ser.head.x, ser.head.y, 1.7, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill(); }
  }
}
