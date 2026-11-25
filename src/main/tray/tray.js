/* ==========================================================================
   NEXORA — System Tray Service
   Provides seamless background presence, context menus, and quick window toggle.
   ========================================================================== */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { getTrayIcon } = require('../application/app-icon');

class TrayService {
  constructor(windowManager) {
    this.windowManager = windowManager;
    this.tray = null;
  }

  create() {
    if (this.tray) return;

    // Use the NEXORA robot icon; fall back to the generated amber badge if the files are missing
    const icon = getTrayIcon() || this.createTrayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip('NEXORA — Premium AI Desktop Assistant');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'NEXORA AI (Phase 1)',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show Assistant',
        click: () => this.windowManager.show(),
      },
      {
        label: 'Hide to Tray',
        click: () => this.windowManager.hide(),
      },
      { type: 'separator' },
      {
        label: 'Toggle Listening',
        click: () => {
          const win = this.windowManager.getMainWindow();
          if (win) {
            win.show();
            win.webContents.send('assistant:toggle-listen');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit NEXORA',
        click: () => {
          this.windowManager.forceQuit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.on('double-click', () => {
      this.windowManager.toggle();
    });
  }

  createTrayIcon() {
    // 16x16 RGBA buffer for amber circular badge
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;

        if (dist <= 6.5) {
          // Amber glowing core (#F59E0B)
          buffer[idx] = 245;     // R
          buffer[idx + 1] = 158; // G
          buffer[idx + 2] = 11;  // B
          buffer[idx + 3] = dist <= 5.0 ? 255 : Math.round((6.5 - dist) * 170); // A
        } else {
          buffer[idx + 3] = 0;
        }
      }
    }

    return nativeImage.createFromBuffer(buffer, { width: size, height: size });
  }

  destroy() {
    if (this.tray) {
      try {
        this.tray.destroy();
      } catch (e) {}
      this.tray = null;
    }
  }
}

module.exports = {
  TrayService,
};
