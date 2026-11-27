/* ==========================================================================
   NEXORA — GitHub release lookup (read-only helper)
   WHICH FILE RUNS?  `updater.js` (UpdaterService) is the one the app runs.
   Installed builds: UpdaterService uses electron-updater to download and install.
   Dev builds (npm start): UpdaterService calls THIS file to look at GitHub
   Releases read-only, because a dev build must never overwrite itself.
   This file never downloads or installs anything. It also owns the shared
   helpers (parseVersion, compareVersions, isReleaseUrl).
   Only one request is made: GET api.github.com/repos/<owner>/<repo>/releases/latest
   (no identifiers, no cookies, no body). Switch off: Settings -> Support & Updates.
   ========================================================================== */

const UPDATE_REPO = 'Codewithsempai/Nexora';
const CHECK_DELAY_MS = 20 * 1000;          // first check shortly after start-up
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000; // then once a day
const TIMEOUT_MS = 10 * 1000;

/** "v0.3.26" -> [0,3,26]; returns null when not a plain x.y.z version. */
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 1 if a > b, -1 if a < b, 0 if equal or either is not comparable. */
function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1; }
  return 0;
}

/** Only release pages of the configured repo may be opened from the UI. */
function isReleaseUrl(url, repo = UPDATE_REPO) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases`);
  } catch { return false; }
}

class UpdateChecker {
  /**
   * @param {object} o
   * @param {string} o.currentVersion  running app version
   * @param {object} o.configService   get/set (updates.checkOnStart, updates.skippedVersion)
   * @param {function} o.onAvailable   called with { version, name, url, notes, publishedAt }
   * @param {function} [o.fetchImpl]   injectable for tests
   * @param {boolean} [o.isPackaged]   only installed builds check on their own
   */
  constructor({ currentVersion, configService, onAvailable, fetchImpl, isPackaged = true, repo = UPDATE_REPO } = {}) {
    this.currentVersion = currentVersion;
    this.config = configService;
    this.onAvailable = onAvailable || (() => {});
    this.fetch = fetchImpl || ((...args) => fetch(...args));
    this.isPackaged = isPackaged;
    this.repo = repo;
    this.timer = null;
    this.interval = null;
    this.last = { status: 'idle', checkedAt: null, latest: null, error: null };
  }

  enabled() { return this.config?.get?.('updates.checkOnStart') !== false; }

  /** Start the background schedule (installed builds only, and only when enabled). */
  start() {
    this.stop();
    if (!this.isPackaged || !this.enabled()) return;
    this.timer = setTimeout(() => { this.check({ manual: false }); }, CHECK_DELAY_MS);
    this.interval = setInterval(() => { if (this.enabled()) this.check({ manual: false }); }, CHECK_EVERY_MS);
    this.timer.unref?.(); this.interval.unref?.();
  }

  stop() { clearTimeout(this.timer); clearInterval(this.interval); this.timer = null; this.interval = null; }

  /** Re-evaluate the schedule after the setting is toggled. */
  onConfig() { this.start(); }

  /**
   * Check GitHub once. manual=true (the "Check now" button) ignores the
   * on/off switch and the skipped version, and always reports a result.
   */
  async check({ manual = false } = {}) {
    if (!manual && !this.enabled()) return { status: 'disabled' };
    this.last = { ...this.last, status: 'checking', error: null };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await this.fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `NEXORA/${this.currentVersion}` },
          signal: ctrl.signal,
        });
      } finally { clearTimeout(t); }
      if (res.status === 404) { this.last = { status: 'none', checkedAt: Date.now(), latest: null, error: null }; return this.last; }
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const data = await res.json();
      if (data.draft || data.prerelease) { this.last = { status: 'current', checkedAt: Date.now(), latest: null, error: null }; return this.last; }
      const version = String(data.tag_name || '').replace(/^v/, '');
      const url = isReleaseUrl(data.html_url, this.repo) ? data.html_url : `https://github.com/${this.repo}/releases/latest`;
      const newer = compareVersions(version, this.currentVersion) > 0;
      const info = { version, name: data.name || `NEXORA ${version}`, url, notes: String(data.body || '').slice(0, 600), publishedAt: data.published_at || null };
      if (!newer) { this.last = { status: 'current', checkedAt: Date.now(), latest: info, error: null }; return this.last; }
      this.last = { status: 'available', checkedAt: Date.now(), latest: info, error: null };
      const skipped = this.config?.get?.('updates.skippedVersion');
      if (manual || skipped !== version) this.onAvailable(info);
      return this.last;
    } catch (error) {
      this.last = { status: 'error', checkedAt: Date.now(), latest: null, error: error?.name === 'AbortError' ? 'Timed out.' : (error?.message || 'Check failed.') };
      return this.last;
    }
  }

  skip(version) {
    if (typeof version !== 'string' || !parseVersion(version)) return false;
    return !!this.config?.set?.('updates.skippedVersion', version);
  }
}

module.exports = { UpdateChecker, parseVersion, compareVersions, isReleaseUrl, UPDATE_REPO };
