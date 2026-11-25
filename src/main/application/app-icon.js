/* ==========================================================================
   NEXORA — Application icon helper
   Single source of truth for the window / taskbar / tray icon (Glossy Robot + Orb).
   Windows prefers the multi-size .ico; other platforms use the 512px PNG.
   ========================================================================== */

const path = require('path');
const fs = require('fs');
const { nativeImage } = require('electron');

const ICON_DIR = path.join(__dirname, '../../../assets/icons');
const ICO_PATH = path.join(ICON_DIR, 'nexora-app-icon.ico');
const PNG_PATH = path.join(ICON_DIR, 'nexora-app-icon.png');

/** Absolute path of the best icon file for this platform ('' when missing). */
function getIconPath() {
  if (process.platform === 'win32' && fs.existsSync(ICO_PATH)) return ICO_PATH;
  if (fs.existsSync(PNG_PATH)) return PNG_PATH;
  return '';
}

/** nativeImage for BrowserWindow `icon`, or undefined so Electron falls back to its default. */
function getAppIcon() {
  const file = getIconPath();
  if (!file) return undefined;
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? undefined : image;
}

/** Small image for the system tray; null when the icon files are unavailable. */
function getTrayIcon() {
  const file = getIconPath();
  if (!file) return null;
  let image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return null;
  // The .ico already holds 16/24/32px frames; a PNG must be scaled down explicitly.
  if (file === PNG_PATH) image = image.resize({ width: 32, height: 32, quality: 'best' });
  return image;
}

module.exports = { getIconPath, getAppIcon, getTrayIcon };
