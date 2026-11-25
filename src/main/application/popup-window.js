/* ========================================================================== 
 * NEXORA floating Orb popup. Appears on wake-word activation and stays above
 * other windows while Live voice is active. Uses the existing OrbEngine.
 * ========================================================================== */
const { BrowserWindow, screen } = require('electron');
const path = require('path');
// v0.3.14d: the popup is sized from the usable height (DIPs, taskbar excluded) of the monitor it appears on, so a laptop
// screen and big external monitors each get a fitting robot. The size setting (200 = default) is a relative scale on top.
const ROBOT_FRAC = 0.28, ROBOT_MIN = 200, ROBOT_MAX = 400;   // Default robot height = 28% of the work area, kept within 200..400 px
const ORB_REF_H = 1040, ORB_K_MIN = 0.75, ORB_K_MAX = 1.3;    // round orbs scale against a 1080p work area

class PopupWindowManager {
  constructor() {
    this.window = null;
    this.ready = false;
    this.visible = false;
    this.state = 'idle';
    this.profile = 'nexora';
    this.getSize = () => 200; // visible Orb diameter in px (config appearance.popupOrbSize)
    this.getPerformanceMode = () => 'medium';
    this.getPosition = () => 'bottom-center';
    this.getProfileOverride = () => 'same';
    this.previewing = false;
    this.suppressWhen = null; // () => true while the main window already shows the Orb
    this.keepOpen = null; // () => true while Live voice is active (flash() must not hide the Orb then)
  }
  /** The Orb art fills 68% of its canvas, so the canvas is sized to make the VISIBLE Orb equal to the chosen px. */
  /** Work area of the monitor the user is on (the one with the mouse pointer); cached briefly so size and position agree. */
  work() {
    const t = Date.now();
    if (!this._w || t - this._wt > 150) {
      let d; try { d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); } catch { d = screen.getPrimaryDisplay(); }
      this._w = (d || screen.getPrimaryDisplay()).workArea; this._wt = t;
    }
    return this._w;
  }
  geometry() {
    // Never taller than the usable screen (taskbar excluded), so a huge setting cannot push the Orb off-screen.
    const work = this.work();
    const wanted = Math.max(40, Math.min(500, Math.round(Number(this.getSize?.()) || 200)));
    const rel = wanted / 200;
    // v0.3.14c: the 3D robot is a tall figure that fills its whole canvas (no round-orb padding), and the chosen size is the
    // robot's HEIGHT. A boost makes the popup robot clearly bigger than the old tiny one at the same slider value.
    if (this.resolveProfile(this.profile) === 'robot') {
      const base = Math.max(ROBOT_MIN, Math.min(ROBOT_MAX, Math.round(work.height * ROBOT_FRAC)));
      const robot = Math.max(90, Math.min(Math.floor(work.height * 0.85), Math.floor(work.width * 0.5), Math.round(base * rel)));
      return { size: robot, canvas: robot, win: robot + 4, pad: 0 };
    }
    const k = Math.max(ORB_K_MIN, Math.min(ORB_K_MAX, work.height / ORB_REF_H));
    const fit = Math.floor((work.height - 36) * 0.68);
    const size = Math.max(40, Math.min(fit, Math.round(wanted * k)));
    const canvas = Math.round(size / 0.68);
    return { size, canvas, win: canvas + 4, pad: Math.max(0, Math.round((canvas + 4 - size) / 2)) };
  }
  bounds() {
    const g = this.geometry(); const work = this.work(); const m = 18;
    // v0.3.6e: the window is larger than the visible Orb (transparent padding), so bottom positions are placed by the
    // VISIBLE Orb: it rests just above the taskbar (gap px) instead of floating up the screen.
    const pad = g.pad; const gap = 6;
    const pos = String(this.getPosition?.() || 'bottom-center');
    const [v, h] = pos === 'center' ? ['middle', 'center'] : pos.split('-');
    const x = h === 'left' ? work.x + m : h === 'right' ? work.x + work.width - g.win - m : Math.round(work.x + (work.width - g.win) / 2);
    const y = v === 'top' ? work.y + m : v === 'middle' ? Math.round(work.y + (work.height - g.win) / 2) : Math.max(work.y + 12, Math.round(work.y + work.height - g.win + pad - gap));
    return { x, y, width: g.win, height: g.win };
  }
  resolveProfile(profile) {
    const override = this.getProfileOverride?.();
    const ok = (p) => ['nexora', 'nexo', 'nexie', 'robot'].includes(p);
    return ok(override) ? override : (ok(profile) ? profile : 'nexora');
  }
  /** Re-apply size / position / preset after the Popup Orb Studio changed a setting. */
  applyLayout() {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    win.setBounds(this.bounds());
    this.profile = this.resolveProfile(this.profile);
    this.sendInit();
  }
  /** Popup Orb Studio preview: shows the popup for a few seconds even while the main window is open. */
  preview(state = 'wake') {
    this.state = state;
    this.previewing = true;
    const win = this.create();
    if (this.ready && !win.isDestroyed()) { this.applyLayout(); win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); }
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.stopPreview(), 4000);
  }
  /** Reminder alert: bring the floating Orb up for a few seconds when the main window is hidden. */
  flash(state = 'wake', ms = 7000) {
    this.show(state);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { if (!this.keepOpen?.()) this.hide(); }, ms);
  }
  stopPreview() {
    clearTimeout(this.previewTimer); this.previewing = false;
    if (!this.visible && this.window && !this.window.isDestroyed()) this.window.hide();
  }
  create() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    if (!this._displayHooks) {   // monitor plugged/unplugged, resolution or scaling changed -> re-fit the popup
      this._displayHooks = true;
      const refit = () => { this._w = null; this.applyLayout(); };
      for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, refit);
    }
    const { x, y, width, height } = this.bounds();
    const win = new BrowserWindow({
      x, y, width, height,
      frame: false, transparent: true, backgroundColor: '#00000000', backgroundMaterial: 'none', roundedCorners: true,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, show: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, '../../preload/index.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: true
      }
    });
    this.window = win;
    this.ready = false;
    win.webContents.on('will-navigate', (event, navigationUrl) => {
      if (!String(navigationUrl).startsWith('file:')) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setContentProtection(true);
    win.setIgnoreMouseEvents(true, { forward: true });
    win.on('closed', () => { if (this.window === win) { this.window = null; this.ready = false; this.visible = false; } });
    win.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.applyLayout();
      if ((this.visible || this.previewing) && !win.isDestroyed()) win.showInactive();
    });
    win.once('ready-to-show', () => { if ((this.visible || this.previewing) && !win.isDestroyed()) win.showInactive(); });
    win.loadFile(path.join(__dirname, '../../renderer/popup.html'));
    return win;
  }
  sendInit() {
    if (!this.window || this.window.isDestroyed() || !this.ready) return;
    this.window.webContents.send('popup:init', { state: this.state, profile: this.profile, canvas: this.geometry().canvas, performanceMode: this.getPerformanceMode?.() || 'medium' });
  }
  show(state = 'wake', profile = this.profile) {
    this.state = state;
    this.profile = this.resolveProfile(profile);
    // No second Orb on top of the main window: it already has its own live Orb.
    if (typeof this.suppressWhen === 'function' && this.suppressWhen()) { this.hide(); return; }
    this.visible = true;
    const win = this.create();
    if (this.ready && !win.isDestroyed()) {
      this.applyLayout();
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }
  hide() {
    this.visible = false;
    if (this.window && !this.window.isDestroyed() && !this.previewing) this.window.hide();
  }
  setState(state) {
    this.state = state;
    if (this.window && !this.window.isDestroyed() && this.ready) this.window.webContents.send('popup:state', state);
  }
  setLevel(level) {
    if (this.visible && this.window && !this.window.isDestroyed() && this.ready) this.window.webContents.send('popup:level', level);
  }
  setProfile(profile) {
    if (!['nexora', 'nexo', 'nexie', 'robot'].includes(profile)) return;
    this.profile = this.resolveProfile(profile);
    if (this.window && !this.window.isDestroyed() && this.ready) { this.window.setBounds(this.bounds()); this.window.webContents.send('popup:profile', this.profile); this.sendInit(); }
  }
  destroy() {
    this.visible = false;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null; this.ready = false;
  }
  isSender(sender) { return !!this.window && !this.window.isDestroyed() && sender === this.window.webContents; }
}
module.exports = { PopupWindowManager };
