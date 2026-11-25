/* NEXORA — Production Auto-Update Service (electron-updater + GitHub Releases)
 * Keeps all update transport, metadata validation, download tracking, and restart
 * logic strictly inside the Electron main process. Preserves userData across updates. */

const { UpdateChecker, parseVersion, compareVersions, isReleaseUrl, UPDATE_REPO } = require('./update-checker');

const [GITHUB_OWNER, GITHUB_REPO] = UPDATE_REPO.split('/');
const RELEASE_BASE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const DEFAULT_STARTUP_DELAY_MS = 12000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function isLoopbackTestUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

function isStableVersion(raw) {
  const clean = String(raw || '').trim().replace(/^v/i, '');
  if (!parseVersion(clean)) return false;
  return !clean.includes('-');
}

function sanitizeReleaseNotes(raw) {
  let text = '';
  if (Array.isArray(raw)) {
    text = raw
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') {
          const ver = entry.version ? `v${String(entry.version).replace(/^v/i, '')}: ` : '';
          return `${ver}${entry.note || ''}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  } else if (typeof raw === 'string') {
    text = raw;
  }
  const stripped = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripped.slice(0, 4000);
}

function formatReleaseUrl(version) {
  const clean = String(version || '').trim().replace(/^v/i, '');
  const candidate = clean && parseVersion(clean)
    ? `${RELEASE_BASE_URL}/tag/v${clean}`
    : `${RELEASE_BASE_URL}/latest`;
  return isReleaseUrl(candidate, UPDATE_REPO) ? candidate : `${RELEASE_BASE_URL}/latest`;
}

function validateUpdateMetadata(info, currentVersion, { allowTestFeed = false } = {}) {
  if (!info || typeof info !== 'object') {
    return { ok: false, reason: 'Update metadata is empty.' };
  }
  const version = String(info.version || '').trim().replace(/^v/i, '');
  if (!parseVersion(version) || !isStableVersion(version)) {
    return { ok: false, reason: `Invalid or non-stable release version: ${info.version || 'unknown'}` };
  }
  if (currentVersion && parseVersion(currentVersion) && compareVersions(version, currentVersion) <= 0) {
    return { ok: false, reason: `Release v${version} is not newer than v${currentVersion}.` };
  }
  if (Array.isArray(info.files)) {
    for (const file of info.files) {
      const target = String(file?.url || file || '').trim();
      if (!target) continue;
      if (target.includes('..') || target.includes('\\')) {
        return { ok: false, reason: 'Untrusted relative path in update metadata.' };
      }
      if (/^[a-z]+:/i.test(target)) {
        try {
          const parsed = new URL(target);
          const trustedGithub = parsed.protocol === 'https:' && (
            parsed.hostname === 'github.com' ||
            parsed.hostname.endsWith('.githubusercontent.com')
          );
          const trustedTest = allowTestFeed && isLoopbackTestUrl(target);
          if (!trustedGithub && !trustedTest) {
            return { ok: false, reason: `Untrusted update asset origin: ${parsed.origin}` };
          }
        } catch {
          return { ok: false, reason: 'Malformed update asset URL.' };
        }
      }
    }
  }
  return { ok: true, version };
}

function friendlyUpdateError(error) {
  const msg = String(error?.message || error || '').trim();
  if (!msg) return 'Update check failed.';
  if (/404|Cannot find latest\.yml|No published versions|releases\/latest/i.test(msg)) {
    return 'No published GitHub release assets found yet.';
  }
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(msg)) {
    return 'Could not reach GitHub Releases (check your internet connection).';
  }
  if (/sha512|checksum|signature|publisher/i.test(msg)) {
    return 'Update verification failed: binary signature or checksum mismatch.';
  }
  return msg.slice(0, 220);
}

class UpdaterService {
  constructor({
    app,
    currentVersion,
    isPackaged,
    configService,
    loadAutoUpdater = () => require('electron-updater'),
    updateCheckerClass = UpdateChecker,
    onStateChange = () => {},
    onEvent = () => {},
    onBeforeInstall = async () => {},
    log = console,
    env = process.env,
    startupDelayMs = DEFAULT_STARTUP_DELAY_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  } = {}) {
    this.app = app || null;
    this.currentVersion = String(currentVersion || app?.getVersion?.() || '0.3.25');
    this.isPackaged = typeof isPackaged === 'boolean' ? isPackaged : !!app?.isPackaged;
    this.configService = configService || null;
    this.loadAutoUpdater = loadAutoUpdater;
    this.updateChecker = new updateCheckerClass({
      currentVersion: this.currentVersion,
      configService: this.configService,
      isPackaged: true,
      repo: UPDATE_REPO,
    });
    this.onStateChange = onStateChange;
    this.onEvent = onEvent;
    this.onBeforeInstall = onBeforeInstall;
    this.log = log;
    this.env = env || {};
    this.startupDelayMs = startupDelayMs;
    this.checkIntervalMs = checkIntervalMs;

    this.autoUpdater = null;
    this.updaterBound = false;
    this.startupTimer = null;
    this.periodicTimer = null;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.manualCheckPending = false;
    this.installing = false;
    this.lastProgressEmit = 0;

    this.state = {
      status: 'idle',
      currentVersion: this.currentVersion,
      availableVersion: null,
      downloadedVersion: null,
      releaseName: null,
      releaseNotes: '',
      releaseDate: null,
      releaseUrl: `${RELEASE_BASE_URL}/latest`,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      autoCheck: this.isAutoCheckEnabled(),
      autoDownload: this.isAutoDownloadEnabled(),
      packaged: this.isPackaged,
      updateAvailable: false,
      updateDownloaded: false,
      lastCheckedAt: null,
      error: null,
    };
  }

  hasTestFeed() {
    return this.env?.NEXORA_ALLOW_TEST_FEED === '1' && isLoopbackTestUrl(this.env?.NEXORA_TEST_FEED_URL);
  }

  isAutoCheckEnabled() {
    if (!this.configService?.get) return true;
    return this.configService.get('updates.checkOnStart') !== false && this.configService.get('updates.check') !== false;
  }

  isAutoDownloadEnabled() {
    if (!this.isAutoCheckEnabled()) return false;
    if (!this.configService?.get) return true;
    return this.configService.get('updates.autoDownload') !== false;
  }

  getState() {
    return {
      ...this.state,
      autoCheck: this.isAutoCheckEnabled(),
      autoDownload: this.isAutoDownloadEnabled(),
      packaged: this.isPackaged,
      progress: { ...this.state.progress },
    };
  }

  emitState(eventName = 'update:state', payload = null) {
    const snapshot = this.getState();
    try { this.onStateChange(snapshot); } catch { /* ignore */ }
    if (eventName) {
      try { this.onEvent(eventName, payload ?? snapshot); } catch { /* ignore */ }
    }
    return snapshot;
  }

  updateState(patch, eventName = 'update:state', payload = null) {
    Object.assign(this.state, patch);
    return this.emitState(eventName, payload);
  }

  ensureAutoUpdater() {
    if (this.autoUpdater) return this.autoUpdater;
    if (!this.isPackaged && !this.hasTestFeed()) return null;

    let mod;
    try {
      mod = this.loadAutoUpdater();
    } catch (error) {
      this.log.warn?.(`[NEXORA Update] electron-updater unavailable: ${error?.message || error}`);
      return null;
    }
    const autoUpdater = mod?.autoUpdater;
    if (!autoUpdater) return null;

    autoUpdater.autoDownload = false; // Validate metadata before downloading
    autoUpdater.autoInstallOnAppQuit = false; // Install only when user confirms Update Now
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: (m) => this.log.log?.(`[NEXORA Update] ${m}`),
      warn: (m) => this.log.warn?.(`[NEXORA Update] ${m}`),
      error: (m) => this.log.warn?.(`[NEXORA Update] ${m}`),
      debug: () => {},
    };

    if (this.hasTestFeed()) {
      autoUpdater.forceDevUpdateConfig = true;
      autoUpdater.setFeedURL({ provider: 'generic', url: String(this.env.NEXORA_TEST_FEED_URL) });
    } else {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        releaseType: 'release',
      });
    }

    if (!this.updaterBound) {
      this.bindAutoUpdaterEvents(autoUpdater);
      this.updaterBound = true;
    }

    this.autoUpdater = autoUpdater;
    return autoUpdater;
  }

  bindAutoUpdaterEvents(autoUpdater) {
    autoUpdater.on('checking-for-update', () => {
      if (this.state.status !== 'downloading' && this.state.status !== 'downloaded') {
        this.updateState({ status: 'checking', error: null });
      }
    });

    autoUpdater.on('update-available', (info) => {
      const valid = validateUpdateMetadata(info, this.currentVersion, { allowTestFeed: this.hasTestFeed() });
      if (!valid.ok) {
        this.log.warn?.(`[NEXORA Update] Rejected update metadata: ${valid.reason}`);
        this.updateState({ status: 'error', error: valid.reason }, 'update:error', { error: valid.reason });
        return;
      }

      const skipped = this.configService?.get?.('updates.skippedVersion');
      const notes = sanitizeReleaseNotes(info.releaseNotes);
      const releaseUrl = formatReleaseUrl(valid.version);
      const patch = {
        status: 'available',
        availableVersion: valid.version,
        releaseName: String(info.releaseName || `NEXORA v${valid.version}`),
        releaseNotes: notes,
        releaseDate: info.releaseDate || null,
        releaseUrl,
        updateAvailable: true,
        lastCheckedAt: Date.now(),
        error: null,
      };
      const snap = this.updateState(patch, 'update:available', {
        version: valid.version,
        name: patch.releaseName,
        notes,
        url: releaseUrl,
        releaseDate: patch.releaseDate,
      });

      const isManual = this.manualCheckPending;
      this.manualCheckPending = false;
      if (this.isAutoDownloadEnabled() && (isManual || skipped !== valid.version)) {
        void this.downloadUpdate().catch((err) => {
          this.log.warn?.(`[NEXORA Update] Background download failed: ${err?.message || err}`);
        });
      }
      return snap;
    });

    autoUpdater.on('update-not-available', () => {
      this.manualCheckPending = false;
      if (this.state.status === 'downloaded') return;
      this.updateState({
        status: 'up-to-date',
        availableVersion: null,
        updateAvailable: false,
        releaseNotes: '',
        lastCheckedAt: Date.now(),
        error: null,
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      const now = Date.now();
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
      if (percent < 100 && now - this.lastProgressEmit < 150) return;
      this.lastProgressEmit = now;
      this.updateState({
        status: 'downloading',
        progress: {
          percent,
          transferred: Number(progress?.transferred) || 0,
          total: Number(progress?.total) || 0,
          bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
        },
        error: null,
      }, 'update:progress');
    });

    autoUpdater.on('update-downloaded', (info) => {
      const valid = validateUpdateMetadata(info, this.currentVersion, { allowTestFeed: this.hasTestFeed() });
      if (!valid.ok) {
        this.log.warn?.(`[NEXORA Update] Downloaded metadata rejected: ${valid.reason}`);
        this.updateState({ status: 'error', error: valid.reason }, 'update:error', { error: valid.reason });
        return;
      }
      const notes = sanitizeReleaseNotes(info.releaseNotes) || this.state.releaseNotes;
      this.updateState({
        status: 'downloaded',
        availableVersion: valid.version,
        downloadedVersion: valid.version,
        releaseName: String(info.releaseName || this.state.releaseName || `NEXORA v${valid.version}`),
        releaseNotes: notes,
        releaseUrl: formatReleaseUrl(valid.version),
        updateAvailable: true,
        updateDownloaded: true,
        progress: { ...this.state.progress, percent: 100 },
        error: null,
      }, 'update:downloaded');
    });

    autoUpdater.on('error', (error) => {
      this.manualCheckPending = false;
      const friendly = friendlyUpdateError(error);
      this.log.warn?.(`[NEXORA Update] ${error?.message || error}`);
      this.updateState({
        status: this.state.updateDownloaded ? 'downloaded' : 'error',
        error: friendly,
      }, 'update:error', { error: friendly });
    });
  }

  start() {
    this.ensureAutoUpdater();
    this.scheduleTimers();
  }

  scheduleTimers() {
    this.clearTimers();
    if (!this.isPackaged && !this.hasTestFeed()) return;

    this.startupTimer = setTimeout(() => {
      if (this.isAutoCheckEnabled()) {
        void this.check({ manual: false });
      }
    }, this.startupDelayMs);
    this.startupTimer.unref?.();

    this.periodicTimer = setInterval(() => {
      if (this.isAutoCheckEnabled() && this.state.status !== 'downloading' && this.state.status !== 'downloaded') {
        void this.check({ manual: false });
      }
    }, this.checkIntervalMs);
    this.periodicTimer.unref?.();
  }

  clearTimers() {
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
    if (this.periodicTimer) { clearInterval(this.periodicTimer); this.periodicTimer = null; }
  }

  async check({ manual = false } = {}) {
    if (this.checkPromise) return this.checkPromise;
    if (!manual && !this.isAutoCheckEnabled()) {
      return { ...this.getState(), status: 'disabled' };
    }
    if (this.state.updateDownloaded && this.state.downloadedVersion) {
      return this.getState();
    }

    this.manualCheckPending = !!manual;
    this.checkPromise = (async () => {
      try {
        if (!this.isPackaged && !this.hasTestFeed()) {
          // Dev build: inspect GitHub Releases read-only via HTTPS without attempting binary overwrite.
          this.updateState({ status: 'checking', error: null });
          const res = await this.updateChecker.check({ manual: true });
          if (res.status === 'available' && res.info) {
            const notes = sanitizeReleaseNotes(res.info.notes);
            const url = isReleaseUrl(res.info.url, UPDATE_REPO) ? res.info.url : formatReleaseUrl(res.info.version);
            return this.updateState({
              status: 'available',
              availableVersion: res.info.version,
              releaseName: res.info.name || `NEXORA v${res.info.version}`,
              releaseNotes: notes,
              releaseDate: res.info.publishedAt || null,
              releaseUrl: url,
              updateAvailable: true,
              lastCheckedAt: Date.now(),
              error: null,
            }, 'update:available', { version: res.info.version, name: res.info.name, notes, url });
          }
          if (res.status === 'error') {
            return this.updateState({ status: 'error', lastCheckedAt: Date.now(), error: res.error || 'Could not reach GitHub Releases.' }, 'update:error', { error: res.error });
          }
          return this.updateState({
            status: 'up-to-date',
            availableVersion: null,
            updateAvailable: false,
            lastCheckedAt: Date.now(),
            error: null,
          });
        }

        const autoUpdater = this.ensureAutoUpdater();
        if (!autoUpdater) {
          return this.updateState({ status: 'error', error: 'Auto-updater module unavailable.' });
        }
        this.updateState({ status: 'checking', error: null });
        await autoUpdater.checkForUpdates();
        return this.getState();
      } catch (error) {
        const friendly = friendlyUpdateError(error);
        return this.updateState({
          status: this.state.updateDownloaded ? 'downloaded' : 'error',
          lastCheckedAt: Date.now(),
          error: friendly,
        }, 'update:error', { error: friendly });
      } finally {
        this.manualCheckPending = false;
        this.checkPromise = null;
      }
    })();

    return this.checkPromise;
  }

  async downloadUpdate() {
    if (this.downloadPromise) return this.downloadPromise;
    if (this.state.updateDownloaded) return { success: true, alreadyDownloaded: true, state: this.getState() };

    const autoUpdater = this.ensureAutoUpdater();
    if (!autoUpdater) {
      return {
        success: false,
        error: 'One-click download & install is available in the installed NEXORA desktop app. You can view the release on GitHub.',
      };
    }

    this.downloadPromise = (async () => {
      try {
        this.updateState({ status: 'downloading', error: null });
        await autoUpdater.downloadUpdate();
        return { success: true, state: this.getState() };
      } catch (error) {
        const friendly = friendlyUpdateError(error);
        this.updateState({ status: 'error', error: friendly }, 'update:error', { error: friendly });
        return { success: false, error: friendly };
      } finally {
        this.downloadPromise = null;
      }
    })();

    return this.downloadPromise;
  }

  async installAndRestart() {
    if (this.installing) return { success: false, error: 'Restart already in progress.' };
    if (!this.autoUpdater || this.state.status !== 'downloaded' || !this.state.updateDownloaded) {
      return { success: false, error: 'No downloaded update is ready to install yet.' };
    }
    this.installing = true;
    try {
      await this.onBeforeInstall();
    } catch (err) {
      this.log.warn?.(`[NEXORA Update] Pre-install cleanup warning: ${err?.message || err}`);
    }
    const timer = setTimeout(() => {
      try {
        this.autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        this.installing = false;
        const msg = friendlyUpdateError(error);
        this.updateState({ status: 'error', error: msg }, 'update:error', { error: msg });
      }
    }, 120);
    timer.unref?.();
    return { success: true };
  }

  setAutoUpdate(enabled) {
    const flag = !!enabled;
    this.configService?.set?.('updates.checkOnStart', flag);
    this.configService?.set?.('updates.check', flag);
    this.configService?.set?.('updates.autoDownload', flag);
    if (flag) this.scheduleTimers();
    else this.clearTimers();
    return this.emitState('update:state');
  }

  skipVersion(version) {
    if (!parseVersion(version)) return false;
    this.configService?.set?.('updates.skippedVersion', String(version).replace(/^v/i, ''));
    this.updateState({ status: 'up-to-date', updateAvailable: false });
    return true;
  }

  dispose() {
    this.clearTimers();
  }
}

/* Preserved helper for unit-test compatibility */
function startUpdater({ app, configService, log = console, notify = () => {}, load = () => require('electron-updater'), delayMs = 15000, setTimer = setTimeout } = {}) {
  if (!app?.isPackaged) return { started: false, reason: 'not-packaged' };
  if (configService?.get?.('updates.check') === false) return { started: false, reason: 'disabled' };
  let autoUpdater;
  try { autoUpdater = load().autoUpdater; } catch { return { started: false, reason: 'electron-updater-missing' }; }
  if (!autoUpdater) return { started: false, reason: 'electron-updater-missing' };
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => log.log?.(`[NEXORA Update] ${m}`), warn: (m) => log.warn?.(`[NEXORA Update] ${m}`), error: (m) => log.warn?.(`[NEXORA Update] ${m}`), debug: () => {} };
    autoUpdater.on?.('error', (error) => log.warn?.(`[NEXORA Update] ${error?.message || error}`));
    autoUpdater.on?.('update-downloaded', (info) => { log.log?.(`[NEXORA Update] ${info?.version} downloaded; it installs when NEXORA quits.`); try { notify(info); } catch { /* ignore */ } });
    setTimer(() => { Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch((error) => log.warn?.(`[NEXORA Update] check failed: ${error?.message || error}`)); }, delayMs);
    return { started: true };
  } catch (error) { return { started: false, reason: error.message }; }
}

module.exports = {
  UpdaterService,
  startUpdater,
  sanitizeReleaseNotes,
  validateUpdateMetadata,
  isStableVersion,
  formatReleaseUrl,
  isLoopbackTestUrl,
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASE_BASE_URL,
};
