/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — card center. ONE small always-on-top window (top-right of the screen) that stacks the cards
 * NEXORA needs to show OUTSIDE the main window: approvals, the morning brief, nudges, watcher offers, task progress.
 * Same look as the reminder card. ask() returns a Promise for the pressed button; nothing is ever auto-approved. */
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 410; const MIN_WIDTH = 260; const MARGIN = 10; const MIN_H = 90; const MAX_H = 640;

class CardCenter {
  constructor({ windowManager = null } = {}) {
    this.windowManager = windowManager; this.window = null; this.ready = false; this.height = 170;
    this.cards = new Map(); this.seq = 0; this.lastKey = '';
    const mine = (event) => !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on('card:click', (event, cardId, buttonId) => { if (mine(event) && typeof cardId === 'string' && typeof buttonId === 'string') this.click(cardId, buttonId); });
    ipcMain.on('card:close', (event, cardId) => { if (mine(event) && typeof cardId === 'string') this.close(cardId, 'dismiss'); });
    ipcMain.on('card:size', (event, h) => { if (mine(event)) { this.height = Math.max(MIN_H, Math.min(MAX_H * 2, Math.round(Number(h) || MIN_H))); this.place(); } });
  }

  /** v0.3.10: cards appear on the monitor you are using (the one under the mouse), not always the main one. */
  bounds() {
    let display; try { display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); } catch { display = null; }
    const work = (display || screen.getPrimaryDisplay()).workArea;
    // v0.3.26: responsive — never wider/taller than the screen's work area (small laptops, high DPI scaling, snapped layouts).
    const width = Math.max(MIN_WIDTH, Math.min(WIDTH, work.width - MARGIN * 2));
    const maxH = Math.max(MIN_H, Math.min(MAX_H, work.height - MARGIN * 2));
    const height = Math.max(MIN_H, Math.min(maxH, this.height));
    return { x: work.x + work.width - width - MARGIN, y: work.y + MARGIN, width, height };
  }
  place() { try { if (this.window && !this.window.isDestroyed()) this.window.setBounds(this.bounds()); } catch { /* ignore */ } }

  create() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const win = new BrowserWindow({
      ...this.bounds(), frame: false, transparent: true, backgroundColor: '#00000000', backgroundMaterial: 'none', roundedCorners: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: true, show: false, hasShadow: false, acceptFirstMouse: true,
      webPreferences: { preload: path.join(__dirname, '../../preload/card.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
    });
    this.window = win; this.ready = false;
    // A system Acrylic material fills this entire rectangular overlay window,
    // including the transparent margins around the rounded card. Keep the HWND clear.
    if (process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
      try { win.setBackgroundMaterial('none'); } catch { /* transparent CSS glass remains the fallback */ }
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    try { win.setIgnoreMouseEvents(false); } catch { /* cards must always receive clicks */ }
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { if (this.window === win) { this.window = null; this.ready = false; } });
    win.webContents.on('did-finish-load', () => { this.ready = true; this.lastKey = ''; this.sync(); });
    win.loadFile(path.join(__dirname, '../../renderer/card.html'));
    return win;
  }

  view() { return [...this.cards.values()].map(({ card }) => ({ id: card.id, kind: card.kind, label: card.label, title: card.title, text: card.text, lines: card.lines, progress: card.progress, buttons: card.buttons, expiresAt: card.expiresAt || 0 })); }
  sync() {
    try {
      if (!this.cards.size) { this.lastKey = ''; if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide(); return; }
      const win = this.create(); this.place();
      const items = this.view(); const key = JSON.stringify(items);
      if (this.ready && key !== this.lastKey) { this.lastKey = key; win.webContents.send('card:items', items); }
      if (this.ready && !win.isVisible()) win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch (error) { console.warn('[NEXORA Cards] failed:', error.message); }
  }

  /** show({ kind, label, title, text, lines, buttons:[{id,label,primary,danger}], timeoutMs, keepOpen, onButton }) -> { id, promise } */
  show(def = {}) {
    const id = def.id || `c${++this.seq}`;
    if (this.cards.has(id)) this.close(id, 'replaced');
    const card = {
      id, kind: String(def.kind || 'info'), label: String(def.label || 'NEXORA').slice(0, 40), title: def.title ? String(def.title).slice(0, 140) : '', text: String(def.text || '').slice(0, 600),
      lines: Array.isArray(def.lines) ? def.lines.slice(0, 12).map((l) => String(l).slice(0, 200)) : [], progress: def.progress,
      buttons: (Array.isArray(def.buttons) ? def.buttons : []).slice(0, 4).map((b) => ({ id: String(b.id).slice(0, 30), label: String(b.label).slice(0, 30), primary: !!b.primary, danger: !!b.danger })),
      keepOpen: !!def.keepOpen, onButton: typeof def.onButton === 'function' ? def.onButton : null,
    };
    let resolve; const promise = new Promise((r) => { resolve = r; });
    const entry = { card, resolve, timer: null };
    const timeout = def.timeoutMs === undefined ? (card.buttons.length ? 0 : 12000) : Number(def.timeoutMs);
    if (timeout > 0) { entry.timer = setTimeout(() => this.close(id, 'timeout'), timeout); card.expiresAt = Date.now() + timeout; }
    this.cards.set(id, entry); this.sync();
    return { id, promise };
  }
  /** ask(...) -> Promise<'buttonId' | 'timeout' | 'dismiss' | 'replaced'>; times out (default 60 s) so a forgotten card never blocks. */
  ask(def = {}) { return this.show({ timeoutMs: 60000, ...def }).promise; }
  notify(def = {}) { return this.show({ buttons: [], timeoutMs: 9000, ...def }); }
  update(id, patch = {}) {
    const entry = this.cards.get(id); if (!entry) return false;
    for (const k of ['label', 'title', 'text']) if (patch[k] !== undefined) entry.card[k] = String(patch[k]).slice(0, k === 'text' ? 600 : 140);
    if (Array.isArray(patch.lines)) entry.card.lines = patch.lines.slice(0, 12).map((l) => String(l).slice(0, 200));
    if (patch.progress !== undefined) entry.card.progress = patch.progress;
    if (Array.isArray(patch.buttons)) entry.card.buttons = patch.buttons.slice(0, 4).map((b) => ({ id: String(b.id), label: String(b.label), primary: !!b.primary, danger: !!b.danger }));
    if (patch.timeoutMs !== undefined) { clearTimeout(entry.timer); entry.timer = patch.timeoutMs > 0 ? setTimeout(() => this.close(id, 'timeout'), patch.timeoutMs) : null; entry.card.expiresAt = patch.timeoutMs > 0 ? Date.now() + patch.timeoutMs : 0; }
    this.sync(); return true;
  }
  click(cardId, buttonId) {
    const entry = this.cards.get(cardId); if (!entry || !entry.card.buttons.some((b) => b.id === buttonId)) return;
    try { entry.card.onButton?.(buttonId); } catch { /* never break the UI */ }
    if (entry.card.keepOpen) return;
    this.close(cardId, buttonId);
  }
  close(id, result = 'dismiss') {
    const entry = this.cards.get(id); if (!entry) return false;
    clearTimeout(entry.timer); this.cards.delete(id); entry.resolve(result); this.sync(); return true;
  }
  closeKind(kind, result = 'dismiss') { for (const [id, e] of [...this.cards.entries()]) if (e.card.kind === kind) this.close(id, result); }
  closeAll(result = 'dismiss') { for (const id of [...this.cards.keys()]) this.close(id, result); }
  has(id) { return this.cards.has(id); }
  /** Oldest open card of one of these kinds that is waiting for a button press -> { id, kind, title, buttons } | null (voice "ok" answers it). */
  pending(kinds = ['approval', 'plan']) { for (const { card } of this.cards.values()) if (kinds.includes(card.kind) && card.buttons.length) return { id: card.id, kind: card.kind, title: card.title, buttons: card.buttons.map((b) => ({ id: b.id, label: b.label })) }; return null; }
  destroy() { this.closeAll('dismiss'); try { if (this.window && !this.window.isDestroyed()) this.window.destroy(); } catch { /* ignore */ } this.window = null; }
}
module.exports = { CardCenter };
