const assert = require('assert');
const EventEmitter = require('events');
const {
  startUpdater,
  UpdaterService,
  sanitizeReleaseNotes,
  validateUpdateMetadata,
  isStableVersion,
  GITHUB_OWNER,
  GITHUB_REPO,
} = require('../../src/main/services/updater');

const cfg = (on) => ({
  data: { updates: { check: on, checkOnStart: on, autoDownload: on } },
  get: (k) => (k === 'updates.check' || k === 'updates.checkOnStart' || k === 'updates.autoDownload' ? on : undefined),
  set: () => true,
});
const quiet = { log: () => {}, warn: () => {} };

// Legacy startUpdater compatibility tests
assert.strictEqual(startUpdater({ app: { isPackaged: false }, configService: cfg(true), log: quiet }).reason, 'not-packaged');
assert.strictEqual(startUpdater({ app: { isPackaged: true }, configService: cfg(false), log: quiet }).reason, 'disabled');
assert.strictEqual(startUpdater({ app: { isPackaged: true }, configService: cfg(true), log: quiet, load: () => { throw new Error('nope'); } }).reason, 'electron-updater-missing');

let timer = null;
const autoUpdaterLegacy = { on: () => {}, checkForUpdates: () => Promise.resolve() };
const res = startUpdater({ app: { isPackaged: true }, configService: cfg(true), log: quiet, load: () => ({ autoUpdater: autoUpdaterLegacy }), setTimer: (f) => { timer = f; } });
assert.strictEqual(res.started, true);
assert.strictEqual(autoUpdaterLegacy.autoDownload, true);
assert.strictEqual(autoUpdaterLegacy.autoInstallOnAppQuit, true);
assert.strictEqual(typeof timer, 'function');

let notified = null;
const emitterLegacy = new EventEmitter();
emitterLegacy.checkForUpdates = () => Promise.resolve();
startUpdater({ app: { isPackaged: true }, configService: cfg(true), log: quiet, notify: (i) => { notified = i; }, load: () => ({ autoUpdater: emitterLegacy }), setTimer: () => {} });
emitterLegacy.emit('update-downloaded', { version: '1.0.0' });
assert.deepStrictEqual(notified, { version: '1.0.0' });

// Phase 2 UpdaterService tests
assert.strictEqual(GITHUB_OWNER, 'Codewithsempai');
assert.strictEqual(GITHUB_REPO, 'Nexora');
assert.strictEqual(isStableVersion('0.3.27'), true);
assert.strictEqual(isStableVersion('0.3.27-beta.1'), false);

const cleanedNotes = sanitizeReleaseNotes('<p>Hello <b>World</b></p><script>alert(1)</script><br/><li>Fix audio</li>');
assert(!cleanedNotes.includes('<script>'), 'Release notes must strip HTML tags');
assert(cleanedNotes.includes('Hello World') && cleanedNotes.includes('Fix audio'));

assert.strictEqual(validateUpdateMetadata({ version: '0.3.27', files: [{ url: 'https://github.com/Codewithsempai/Nexora/releases/download/v0.3.27/NEXORA-Setup-x64.exe' }] }, '0.3.26').ok, true);
assert.strictEqual(validateUpdateMetadata({ version: '0.3.25' }, '0.3.26').ok, false, 'Must reject downgrades');
assert.strictEqual(validateUpdateMetadata({ version: '0.3.27-rc.1' }, '0.3.26').ok, false, 'Must reject prereleases');
assert.strictEqual(validateUpdateMetadata({ version: '0.3.27', files: [{ url: 'https://evil.example.com/payload.exe' }] }, '0.3.26').ok, false, 'Must reject untrusted origins');
assert.strictEqual(validateUpdateMetadata({ version: '0.3.27', files: [{ url: 'http://github.com/Codewithsempai/Nexora/x.exe' }] }, '0.3.26').ok, false, 'Must reject non-HTTPS');

(async () => {
  const mockStore = { updates: { checkOnStart: true, check: true, autoDownload: false } };
  const mockConfig = {
    get: (k) => k.split('.').reduce((acc, part) => acc?.[part], mockStore),
    set: (k, v) => {
      const parts = k.split('.');
      let cur = mockStore;
      for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] ||= {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = v;
      return true;
    },
  };

  class MockAutoUpdater extends EventEmitter {
    constructor() {
      super();
      this.feed = null;
      this.quitCalled = false;
    }
    setFeedURL(f) { this.feed = f; }
    async checkForUpdates() {
      this.emit('checking-for-update');
      this.emit('update-available', {
        version: '0.3.27',
        releaseName: 'NEXORA v0.3.27',
        releaseNotes: '<p>Bug fixes &amp; performance boost</p>',
        files: [{ url: 'https://github.com/Codewithsempai/Nexora/releases/download/v0.3.27/NEXORA-Setup-x64.exe' }],
      });
    }
    async downloadUpdate() {
      this.emit('download-progress', { percent: 100, transferred: 1024, total: 1024, bytesPerSecond: 512 });
      this.emit('update-downloaded', { version: '0.3.27', releaseNotes: 'Verified update' });
    }
    quitAndInstall(silent, forceRun) {
      this.quitCalled = { silent, forceRun };
    }
  }

  const fakeUpdater = new MockAutoUpdater();
  const events = [];
  let cleanupCalled = false;
  const svc = new UpdaterService({
    currentVersion: '0.3.26',
    isPackaged: true,
    configService: mockConfig,
    loadAutoUpdater: () => ({ autoUpdater: fakeUpdater }),
    onEvent: (ch) => events.push(ch),
    onBeforeInstall: async () => { cleanupCalled = true; },
    log: quiet,
    env: {},
    startupDelayMs: 60000,
    checkIntervalMs: 3600000,
  });

  svc.start();
  assert.strictEqual(fakeUpdater.feed.provider, 'github');
  assert.strictEqual(fakeUpdater.feed.owner, 'Codewithsempai');
  assert.strictEqual(fakeUpdater.feed.repo, 'Nexora');
  assert.strictEqual(fakeUpdater.autoInstallOnAppQuit, false, 'Must require explicit user confirmation before restart/install');

  const st1 = await svc.check({ manual: true });
  assert.strictEqual(st1.status, 'available');
  assert.strictEqual(st1.availableVersion, '0.3.27');
  assert.strictEqual(st1.releaseNotes, 'Bug fixes & performance boost');

  const dl = await svc.downloadUpdate();
  assert.strictEqual(dl.success, true);
  assert.strictEqual(svc.getState().status, 'downloaded');
  assert.strictEqual(svc.getState().downloadedVersion, '0.3.27');

  const inst = await svc.installAndRestart();
  assert.strictEqual(inst.success, true);
  assert.strictEqual(cleanupCalled, true);
  await new Promise((r) => setTimeout(r, 180));
  assert.deepStrictEqual(fakeUpdater.quitCalled, { silent: true, forceRun: true });

  svc.setAutoUpdate(false);
  assert.strictEqual(mockConfig.get('updates.checkOnStart'), false);
  assert.strictEqual(mockConfig.get('updates.autoDownload'), false);
  svc.dispose();
  console.log('updater-test.js: all checks passed');
})();
