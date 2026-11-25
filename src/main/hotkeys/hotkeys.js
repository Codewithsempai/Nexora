/* ==========================================================================
   NEXORA — Global Hotkey Service
   Registers system-wide activation shortcut to toggle or focus the NEXORA window.
   ========================================================================== */

const { globalShortcut } = require('electron');

class HotkeyService {
  constructor(windowManager, configService) {
    this.windowManager = windowManager;
    this.configService = configService;
    this.currentShortcut = null;
  }

  register() {
    const shortcut = this.configService.get('application.globalHotkey') || 'CommandOrControl+Shift+Space';
    this.unregister();

    try {
      const ok = globalShortcut.register(shortcut, () => {
        this.onTriggered();
      });

      if (ok) {
        this.currentShortcut = shortcut;
        console.log(`[NEXORA Hotkey] Global activation shortcut registered: ${shortcut}`);
      } else {
        console.warn(`[NEXORA Hotkey] Failed to register global shortcut: ${shortcut} (conflict detected)`);
      }
    } catch (err) {
      console.error('[NEXORA Hotkey] Error registering global shortcut:', err.message);
    }
  }

  unregister() {
    if (this.currentShortcut) {
      try {
        globalShortcut.unregister(this.currentShortcut);
      } catch (e) {}
      this.currentShortcut = null;
    }
  }

  unregisterAll() {
    try {
      globalShortcut.unregisterAll();
    } catch (e) {}
  }

  onTriggered() {
    const win = this.windowManager.getMainWindow();
    if (!win) return;

    if (win.isMinimized()) {
      win.restore();
      win.focus();
    } else if (!win.isVisible()) {
      win.show();
      win.focus();
    } else if (win.isFocused()) {
      win.hide();
    } else {
      win.focus();
    }

    // Broadcast wake trigger to renderer
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('hotkey:activated', {
        timestamp: Date.now(),
        shortcut: this.currentShortcut,
      });
    }
  }

  updateShortcut(newShortcut) {
    if (!newShortcut) return false;
    this.configService.set('application.globalHotkey', newShortcut);
    this.register();
    return this.currentShortcut === newShortcut;
  }
}

module.exports = {
  HotkeyService,
};
