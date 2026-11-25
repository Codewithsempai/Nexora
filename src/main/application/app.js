/* ==========================================================================
   NEXORA — Electron Main Process
   Coordinates startup, single instance locking, services, window, and clean shutdown.
   ========================================================================== */

const { app, Notification } = require('electron');
const path = require('path');
const { WindowManager } = require('./window');
const { getConfigService } = require('../services/config');
const { getSidecarManager } = require('../services/sidecar');
const { HotkeyService } = require('../hotkeys/hotkeys');
const { TrayService } = require('../tray/tray');
const { registerIpcHandlers } = require('../ipc/ipc-handlers');
const { PopupWindowManager } = require('./popup-window');
const { VoiceService } = require('../services/voice-service');
const { ModelDirectory } = require('../services/model-ladder');
const { ReminderService } = require('../services/reminder-service');
const { ReminderAlertManager } = require('./reminder-alert');

// v0.3.12: voice must never be slowed by Chromium when the window is hidden, minimised or behind another app (tray / wake popup use).
for (const flag of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag);
// Audio isolation: prevent Chromium media-session focus requests, WebRTC mic auto-gain hijacking Windows endpoints, and loopback echo processing.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,WebRtcAllowInputVolumeAdjustment,ChromeWideEchoCancellation');

// Windows needs an app id for toast notifications (reminders) to show when started with `electron .`
if (process.platform === 'win32') app.setAppUserModelId('NEXORA');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[NEXORA Main] Another instance is already running. Exiting.');
  app.quit();
  process.exit(0);
}

// v0.3.6: pin the data folder so memory / reminders / settings are ALWAYS read from the same place
// (it used to depend on how the app was launched, so a different launch looked like "memory forgot everything").
try {
  const customUserData = process.env.NEXORA_USER_DATA && process.env.NEXORA_USER_DATA.trim();
  app.setPath('userData', customUserData ? path.resolve(customUserData) : path.join(app.getPath('appData'), 'nexora'));
} catch { /* keep Electron default */ }

// Global service singletons
const configService = getConfigService();
const sidecarManager = getSidecarManager();
const windowManager = new WindowManager(configService);
const hotkeyService = new HotkeyService(windowManager, configService);
const trayService = new TrayService(windowManager);
const popupManager = new PopupWindowManager();
const modelDirectory = new ModelDirectory();
require('../services/model-health').bind(modelDirectory);   // v0.3.12: every background Gemini call reports failures to the same cooldown list
const voiceService = new VoiceService({ windowManager, popupManager, configService, modelDirectory });
let reminderService = null;
let autonomyService = null;
let alertManager = null;

// Handle second instance launch (focus existing window)
app.on('second-instance', () => {
  windowManager.show();
});

// App Lifecycle
app.whenReady().then(async () => {
  console.log('[NEXORA Main] Initializing NEXORA Phase 3 Desktop Assistant...');

  // 0. Reminder scheduler (file in the user-data folder, checked every second)
  reminderService = new ReminderService({ filePath: path.join(app.getPath('userData'), 'reminders.json') });
  // v0.3.6g: a desktop reminder card (Done / Snooze) shows even when NEXORA is hidden, minimized or behind other apps.
  alertManager = new ReminderAlertManager({
    reminderService, windowManager,
    shouldShow: () => { const w = windowManager.getMainWindow(); return !(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()); },
  });
  reminderService.onChange = () => alertManager.sync();
  reminderService.onFire = (item, info = {}) => {
    setTimeout(() => alertManager?.sync(), 50);
    const win = windowManager.getMainWindow();
    const windowUsable = !!win && !win.isDestroyed();
    const visible = windowUsable && win.isVisible() && !win.isMinimized();
    if (windowUsable && !win.webContents.isDestroyed()) win.webContents.send('reminder:fired', { item, late: !!info.late });
    if (configService.get('reminders.nativeNotifications') !== false && Notification.isSupported()) {
      try {
        const toast = new Notification({ title: info.late ? 'NEXORA reminder (missed)' : 'NEXORA reminder', body: item.text, silent: false });
        toast.on('click', () => windowManager.show());
        toast.show();
      } catch { /* notifications are best-effort */ }
    }
    if (!visible && configService.get('reminders.popupOrb') !== false) popupManager.flash('wake', 7000);
  };

  // 1. Register IPC Handlers
  const registered = registerIpcHandlers(windowManager, configService, sidecarManager, hotkeyService, popupManager, voiceService, modelDirectory, { reminderService });
  autonomyService = registered?.autonomy || null;

  // 2. Spawn Native Rust Core Sidecar
  sidecarManager.start();

  // 3. Create Main Window
  windowManager.createWindow();
  // The floating Orb appears on wake ONLY while the main window is closed (tray), hidden or minimized;
  // while the main window is open it has its own Orb, so no second Orb is drawn over it.
  popupManager.getSize = () => configService.get('appearance.popupOrbSize') || 200;
  popupManager.getPerformanceMode = () => configService.get('performance.mode') || 'medium';
  popupManager.keepOpen = () => voiceService.liveReady || voiceService.liveConnecting;
  popupManager.getPosition = () => configService.get('appearance.popupOrbPosition') || 'bottom-center';
  popupManager.getProfileOverride = () => configService.get('appearance.popupOrbProfile') || 'same';
  popupManager.suppressWhen = () => { const w = windowManager.getMainWindow(); return !!(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized()); };
  const mainWin = windowManager.getMainWindow();
  const liveActive = () => voiceService.liveReady || voiceService.liveConnecting;
  const showPopupIfLive = () => { if (liveActive()) popupManager.show(voiceService.popupState || 'listen', configService.get('appearance.orbProfile') || 'nexora'); };
  mainWin.on('focus', () => alertManager?.sync());
  mainWin.on('blur', () => alertManager?.sync());
  mainWin.on('minimize', () => alertManager?.sync());
  mainWin.on('hide', () => alertManager?.sync());
  mainWin.on('hide', showPopupIfLive);
  mainWin.on('minimize', showPopupIfLive);
  mainWin.on('show', () => popupManager.hide());
  mainWin.on('restore', () => popupManager.hide());

  // 4. Register System Tray
  trayService.create();

  // 5. Register Global Hotkey
  hotkeyService.register();

  // 6. Start reminders last, so a reminder that came due while NEXORA was closed is delivered to a ready window
  const startReminders = () => reminderService.start();
  // 7. Autonomy (brief, nudges, memory upkeep, agent, screen help, watchers) starts after the window exists
  try { autonomyService?.start(); } catch (error) { console.warn('[NEXORA Autonomy] start failed:', error.message); }
  if (mainWin.webContents.isLoading()) mainWin.webContents.once('did-finish-load', () => setTimeout(startReminders, 1200)); else setTimeout(startReminders, 1200);

  console.log('[NEXORA Main] Phase 3 Gemini Live + Wake Word shell ready.');
});

app.on('activate', () => {
  if (!windowManager.getMainWindow()) {
    windowManager.createWindow();
  } else {
    windowManager.show();
  }
});

// Clean shutdown
app.on('before-quit', () => {
  windowManager.isQuitting = true;
});

app.on('will-quit', () => {
  const safe = (fn) => { try { fn(); } catch { /* keep shutting down */ } };
  safe(() => reminderService?.stop());
  safe(() => autonomyService?.stop());
  safe(() => autonomyService?.cards?.destroy?.());
  safe(() => alertManager?.destroy());
  safe(() => hotkeyService.unregisterAll());
  safe(() => trayService.destroy());
  safe(() => sidecarManager.stop());
  safe(() => { void voiceService.shutdown().catch(() => {}); });
  safe(() => popupManager.destroy());
  console.log('[NEXORA Main] NEXORA shutdown complete.');
  // v0.3.33: guarantee the process really ends (no orphan Electron process holding the single-instance lock).
  const hardExitDelay = global.__nexoraUpdating ? 4500 : 1200;
  const hardExit = setTimeout(() => { try { app.exit(0); } catch { process.exit(0); } }, hardExitDelay);
  hardExit.unref?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !configService.get('application.closeToTray')) {
    app.quit();
  }
});
