/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — desktop reminder card. A small always-on-top window (top-centre of the screen) that shows a due
 * reminder with Done / Snooze buttons EVEN WHEN the NEXORA window is hidden, minimized or behind other apps.
 * It disappears by itself when the reminder is answered anywhere (this card, the app, the tray) or the app is focused. */
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

const WIDTH = 392; const HEIGHT = 150; const MARGIN = 10;

class ReminderAlertManager {
  constructor({ reminderService, windowManager, shouldShow = () => true } = {}) {
    this.reminderService = reminderService; this.windowManager = windowManager; this.shouldShow = shouldShow;
    this.window = null; this.ready = false; this.lastKey = ''; this.dismissed = new Set();
    const mine = (event) => !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on('alert:done', (event, id) => { if (mine(event) && typeof id === 'string') this.reminderService?.done(id); this.sync(); });
    ipcMain.on('alert:snooze', (event, id, minutes) => { if (mine(event) && typeof id === 'string') this.reminderService?.snooze(id, Number(minutes) || 10); this.sync(); });
    ipcMain.on('alert:close', (event, id) => { if (mine(event) && typeof id === 'string') { const item = this.due().find((i) => i.id === id); this.dismissed.add(`${id}:${item?.lastFiredAt || 0}`); } this.sync(); });
    ipcMain.on('alert:open', (event) => { if (mine(event)) this.windowManager?.show(); });
  }

  bounds() {
    const work = screen.getPrimaryDisplay().workArea;
    // v0.3.7: top-centre of the screen, exactly where the in-app reminder card appears.
    return { x: Math.round(work.x + (work.width - WIDTH) / 2), y: work.y + MARGIN, width: WIDTH, height: HEIGHT };
  }

  due() { try { return (this.reminderService?.list() || []).filter((item) => item.status === 'fired'); } catch { return []; } }
  /** Due reminders whose card was not closed with the × button. */
  visibleDue() { return this.due().filter((item) => !this.dismissed.has(`${item.id}:${item.lastFiredAt || 0}`)); }

  create() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const win = new BrowserWindow({
      ...this.bounds(), frame: false, transparent: true, backgroundColor: '#00000000', backgroundMaterial: 'none', roundedCorners: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: true, show: false, hasShadow: false, acceptFirstMouse: true,
      webPreferences: { preload: path.join(__dirname, '../../preload/alert.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
    });
    this.window = win; this.ready = false;
    // A system Acrylic material fills this entire rectangular overlay window,
    // including the transparent margins around the rounded card. Keep the HWND clear.
    if (process.platform === 'win32' && typeof win.setBackgroundMaterial === 'function') {
      try { win.setBackgroundMaterial('none'); } catch { /* transparent CSS glass remains the fallback */ }
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    try { win.setIgnoreMouseEvents(false); } catch { /* the card must always receive clicks */ }
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => { if (this.window === win) { this.window = null; this.ready = false; } });
    win.webContents.on('did-finish-load', () => { this.ready = true; this.lastKey = ''; this.sync(); });
    win.loadFile(path.join(__dirname, '../../renderer/reminder-alert.html'));
    return win;
  }

  push(force = false) {
    if (!this.window || this.window.isDestroyed() || !this.ready) return;
    const items = this.visibleDue().map((item) => ({ id: item.id, text: item.text, dueAt: item.dueAt, repeat: item.repeat }));
    const key = JSON.stringify(items);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.window.webContents.send('alert:items', items);
  }

  /** Show / update / hide the card to match the reminders that are waiting for an answer. */
  sync() {
    try {
      const items = this.visibleDue();
      if (!items.length || !this.shouldShow()) { this.hide(); return; }
      const win = this.create();
      win.setBounds(this.bounds());
      this.push();
      if (this.ready && !win.isVisible()) win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch (error) { console.warn('[NEXORA Reminder] alert card failed:', error.message); }
  }

  hide() { this.lastKey = ''; if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide(); }
  destroy() { try { if (this.window && !this.window.isDestroyed()) this.window.destroy(); } catch { /* ignore */ } this.window = null; }
}

module.exports = { ReminderAlertManager };
