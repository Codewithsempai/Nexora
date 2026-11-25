/* ==========================================================================
   NEXORA — Window Manager
   Creates and manages the Windows 11 frameless glassmorphic desktop window.
   ========================================================================== */

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { configureSecurity } = require('../security/security');
const { getAppIcon } = require('./app-icon');

class WindowManager {
  constructor(configService) {
    this.configService = configService;
    this.mainWindow = null;
    this.isQuitting = false;
    this.manualRestoreBounds = null;
  }

  createWindow() {
    const savedBounds = this.configService.get('windowBounds') || {
      width: 1060,
      height: 740,
    };

    this.mainWindow = new BrowserWindow({
      width: savedBounds.width || 1060,
      height: savedBounds.height || 740,
      x: savedBounds.x,
      y: savedBounds.y,
      minWidth: 920,
      minHeight: 640,
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: true,
      frame: false, // Premium frameless desktop window
      // Keep the native HWND transparent and rounded. DWM Acrylic paints a rectangular
      // backdrop behind the whole frameless window and breaks the CSS glass corners.
      transparent: true,
      backgroundColor: '#00000000',
      backgroundMaterial: 'none',
      roundedCorners: true,
      hasShadow: true,
      show: false, // Reveal when ready to prevent blank flash
      title: 'NEXORA',
      icon: getAppIcon(), // Glossy Robot + Orb: taskbar, Alt-Tab and window icon
      webPreferences: {
        preload: path.join(__dirname, '../../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });

    // Explicitly remove any system backdrop material. Native Acrylic is rectangular
    // on transparent frameless windows in Electron and causes square/grey corners.
    if (process.platform === 'win32' && typeof this.mainWindow.setBackgroundMaterial === 'function') {
      try { this.mainWindow.setBackgroundMaterial('none'); } catch (error) {
        console.warn('[NEXORA Window] Could not disable system backdrop:', error.message);
      }
    }

    // Configure security policies
    configureSecurity(this.mainWindow);

    // Load Renderer HTML
    const indexPath = path.join(__dirname, '../../renderer/index.html');
    this.mainWindow.loadFile(indexPath);

    // Keep custom titlebar controls synchronized with native window state.
    const publishMaximizedState = () => this.publishMaximized();
    // A manual (work-area) maximize is cancelled as soon as the user drags or resizes the window.
    this.mainWindow.on('will-move', () => { this.manualRestoreBounds = null; publishMaximizedState(); });
    this.mainWindow.on('will-resize', () => { this.manualRestoreBounds = null; publishMaximizedState(); });
    this.mainWindow.on('maximize', publishMaximizedState);
    this.mainWindow.on('unmaximize', publishMaximizedState);
    this.mainWindow.on('enter-full-screen', publishMaximizedState);
    this.mainWindow.on('leave-full-screen', publishMaximizedState);

    // Save window dimensions on change
    const saveBounds = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
      if (this.manualRestoreBounds) return;
      const bounds = this.mainWindow.getBounds();
      const isMaximized = this.mainWindow.isMaximized();
      this.configService.set('windowBounds', {
        ...bounds,
        isMaximized,
      });
    };

    this.mainWindow.on('resize', saveBounds);
    this.mainWindow.on('maximize', saveBounds);
    this.mainWindow.on('unmaximize', saveBounds);
    this.mainWindow.on('move', saveBounds);

    this.mainWindow.once('ready-to-show', () => {
      if (savedBounds.isMaximized) {
        this.mainWindow.maximize();
      }
      this.mainWindow.show();
      this.mainWindow.focus();
    });

    // Handle close to tray
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting && this.configService.get('application.closeToTray')) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    return this.mainWindow;
  }

  /** Native maximize, full screen, or the manual work-area maximize used when Windows ignores maximize() on transparent frameless windows. */
  isWindowMaximized() {
    const w = this.mainWindow;
    if (!w || w.isDestroyed()) return false;
    return w.isMaximized() || w.isFullScreen() || !!this.manualRestoreBounds;
  }

  publishMaximized() {
    const w = this.mainWindow;
    if (!w || w.isDestroyed()) return;
    try { w.webContents.send('window:maximized-changed', this.isWindowMaximized()); } catch { /* ignore */ }
  }

  toggleMaximize() {
    const w = this.mainWindow;
    if (!w || w.isDestroyed()) return false;
    if (this.manualRestoreBounds) {
      const back = this.manualRestoreBounds; this.manualRestoreBounds = null;
      w.setBounds(back); this.publishMaximized(); return true;
    }
    if (w.isFullScreen()) { w.setFullScreen(false); return true; }
    if (w.isMaximized()) { w.unmaximize(); setTimeout(() => this.publishMaximized(), 60); return true; }
    w.maximize();
    setTimeout(() => {
      if (w.isDestroyed() || w.isMaximized() || this.manualRestoreBounds) { this.publishMaximized(); return; }
      this.manualRestoreBounds = w.getBounds();
      try { w.setBounds(screen.getDisplayMatching(this.manualRestoreBounds).workArea); } catch { this.manualRestoreBounds = null; }
      this.publishMaximized();
    }, 120);
    return true;
  }

  getMainWindow() {
    return this.mainWindow;
  }

  show() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  hide() {
    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  toggle() {
    if (this.mainWindow) {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.hide();
      } else {
        this.show();
      }
    }
  }

  forceQuit() {
    this.isQuitting = true;
    const { app } = require('electron');
    // Close every NEXORA window (main, wake orb, notification cards, reminder alerts) so none can block the quit.
    try { for (const win of BrowserWindow.getAllWindows()) { try { if (!win.isDestroyed()) win.destroy(); } catch { /* ignore */ } } } catch { /* ignore */ }
    app.quit();
    // Last resort if a handler stalls: end the process so the next launch is never blocked by an orphan.
    const t = setTimeout(() => { try { app.exit(0); } catch { process.exit(0); } }, 2500); t.unref?.();
  }
}

module.exports = {
  WindowManager,
};
