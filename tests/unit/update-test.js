/* v0.3.36 — update notifier: check + notify only, never installs. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { UpdateChecker, compareVersions, parseVersion, isReleaseUrl } = require('../../src/main/services/update-checker');
const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

assert.deepStrictEqual(parseVersion('v0.3.26'), [0, 3, 26]);
assert.strictEqual(parseVersion('nightly'), null);
assert.strictEqual(compareVersions('0.3.26', '0.3.25'), 1);
assert.strictEqual(compareVersions('v0.10.0', '0.9.9'), 1);
assert.strictEqual(compareVersions('0.3.25', '0.3.25'), 0);
assert.strictEqual(compareVersions('0.3.24', '0.3.25'), -1);
assert(isReleaseUrl('https://github.com/Codewithsempai/Nexora/releases/tag/v1.0.0'));
assert(!isReleaseUrl('https://evil.example/Codewithsempai/Nexora/releases'));
assert(!isReleaseUrl('http://github.com/Codewithsempai/Nexora/releases'));
assert(!isReleaseUrl('file:///C:/Windows/System32/calc.exe'));

const mkCfg = (init = {}) => { const m = { ...init }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; return true; } }; };
const reply = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const rel = { tag_name: 'v0.4.0', name: 'NEXORA 0.4.0', html_url: 'https://github.com/Codewithsempai/Nexora/releases/tag/v0.4.0', body: 'notes', draft: false, prerelease: false };

(async () => {
  let got = []; const cfg = mkCfg();
  let u = new UpdateChecker({ currentVersion: '0.3.25', configService: cfg, onAvailable: (i) => got.push(i), fetchImpl: reply(rel) });
  let r = await u.check(); assert.strictEqual(r.status, 'available'); assert.strictEqual(got.length, 1); assert.strictEqual(got[0].version, '0.4.0');

  got = []; u = new UpdateChecker({ currentVersion: '0.4.0', configService: cfg, onAvailable: (i) => got.push(i), fetchImpl: reply(rel) });
  assert.strictEqual((await u.check()).status, 'current'); assert.strictEqual(got.length, 0, 'no notice when up to date');

  got = []; const off = mkCfg({ 'updates.checkOnStart': false });
  u = new UpdateChecker({ currentVersion: '0.3.25', configService: off, onAvailable: (i) => got.push(i), fetchImpl: reply(rel) });
  assert.strictEqual((await u.check()).status, 'disabled'); assert.strictEqual(got.length, 0, 'switched off = no request');
  assert.strictEqual((await u.check({ manual: true })).status, 'available', 'manual check works even when switched off');

  got = []; u = new UpdateChecker({ currentVersion: '0.3.25', configService: cfg, onAvailable: (i) => got.push(i), fetchImpl: reply(rel) });
  assert(u.skip('0.4.0')); await u.check(); assert.strictEqual(got.length, 0, 'skipped version is not shown again');
  await u.check({ manual: true }); assert.strictEqual(got.length, 1, 'manual check still reports a skipped version');

  got = []; u = new UpdateChecker({ currentVersion: '0.3.25', configService: mkCfg(), onAvailable: (i) => got.push(i), fetchImpl: reply({ ...rel, prerelease: true }) });
  assert.strictEqual((await u.check()).status, 'current'); assert.strictEqual(got.length, 0, 'pre-releases are ignored');

  u = new UpdateChecker({ currentVersion: '0.3.25', configService: mkCfg(), fetchImpl: reply({}, 404) });
  assert.strictEqual((await u.check()).status, 'none');
  u = new UpdateChecker({ currentVersion: '0.3.25', configService: mkCfg(), fetchImpl: async () => { throw new Error('offline'); } });
  assert.strictEqual((await u.check()).status, 'error');

  u = new UpdateChecker({ currentVersion: '0.3.25', configService: mkCfg(), isPackaged: false, fetchImpl: reply(rel) });
  u.start(); assert.strictEqual(u.timer, null, 'dev builds never schedule checks'); u.stop();

  // Wiring + honesty checks.
  const svc = read('src/main/services/update-checker.js');
  assert(!/autoUpdater|quitAndInstall|createWriteStream|child_process|\.exe\b/.test(svc), 'notifier must never download or install');
  for (const ch of ['update:check', 'update:state', 'update:open', 'update:skip', 'update:available']) assert(read('src/preload/contracts/api.js').includes(`'${ch}'`), ch);
  assert(read('src/renderer/settings/settings-panel.js').includes('Support & Updates'));
  assert(/GitHub Releases/.test(read('PRIVACY.md')) && /Support & Updates/.test(read('README.md')));
  console.log('update-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
