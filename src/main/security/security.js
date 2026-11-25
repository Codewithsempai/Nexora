/* ==========================================================================
   NEXORA — Security Infrastructure
   Enforces Content Security Policy, navigation guards, and permission restrictions.
   ========================================================================== */

const { session } = require('electron');

function configureSecurity(mainWindow) {
  // 1. Strict Content Security Policy (CSP)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob:; " +
          "font-src 'self' data:; " +
          "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; " +
          "media-src 'self' blob:; " +
          "object-src 'none'; " +
          "base-uri 'self';"
        ],
      },
    });
  });

  // 2. Prevent arbitrary navigations and new windows
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    // Only allow navigating to local files within application
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
      console.warn(`[NEXORA Security] Blocked external navigation to: ${navigationUrl}`);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[NEXORA Security] Blocked popup window to: ${url}`);
    return { action: 'deny' };
  });

  // 3. Strict Permission Policy
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = String(details?.requestingUrl || webContents.getURL?.() || '');
    // Permit microphone/media only for the app's own local file renderer.
    callback(permission === 'media' && origin.startsWith('file:'));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === 'media' && String(requestingOrigin || '').startsWith('file:');
  });
}

module.exports = {
  configureSecurity,
};
