/* NEXORA — optional auto-update (v0.4.0). Only runs in the installed app, can be switched off in Settings (updates.check),
 * and only talks to the GitHub Releases feed baked into the installer. Never throws. */
function startUpdater({ app, configService, log = console, notify = () => {}, load = () => require('electron-updater'), delayMs = 15000, setTimer = setTimeout } = {}) {
  if (!app?.isPackaged) return { started: false, reason: 'not-packaged' };
  if (configService?.get?.('updates.check') === false) return { started: false, reason: 'disabled' };
  let autoUpdater;
  try { autoUpdater = load().autoUpdater; } catch (error) { return { started: false, reason: 'electron-updater-missing' }; }
  if (!autoUpdater) return { started: false, reason: 'electron-updater-missing' };
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => log.log?.(`[NEXORA Update] ${m}`), warn: (m) => log.warn?.(`[NEXORA Update] ${m}`), error: (m) => log.warn?.(`[NEXORA Update] ${m}`), debug: () => {} };
    autoUpdater.on('error', (error) => log.warn?.(`[NEXORA Update] ${error?.message || error}`));
    autoUpdater.on('update-downloaded', (info) => { log.log?.(`[NEXORA Update] ${info?.version} downloaded; it installs when NEXORA quits.`); try { notify(info); } catch { /* ignore */ } });
    setTimer(() => { Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch((error) => log.warn?.(`[NEXORA Update] check failed: ${error?.message || error}`)); }, delayMs);
    return { started: true };
  } catch (error) { return { started: false, reason: error.message }; }
}
module.exports = { startUpdater };
