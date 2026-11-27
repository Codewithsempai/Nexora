/* v0.4.0 — release fixes, update experience, voice command, semantic memory. */
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter } = require('events');
const root = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

(async () => {
  // ---- 1. release hygiene
  const pkg = JSON.parse(read('package.json'));
  assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package.json version must be semver');
  assert.ok(pkg.build.files.includes('CHANGELOG.md'), 'CHANGELOG.md must ship so the What\'s new popup can read it');
  assert.strictEqual(pkg.build.directories.output, 'dist');
  const ignore = read('.gitignore').split(/\r?\n/);
  for (const entry of ['native/rust/target/', 'target/', 'release/', 'dist/']) assert.ok(ignore.includes(entry), `.gitignore must list ${entry}`);
  for (const doc of ['docs/BUILD_AND_RELEASE.md', 'docs/architecture/ARCHITECTURE.md', 'README.md']) assert.ok(!/`release\/NEXORA/.test(read(doc)), `${doc} must point at dist/`);
  assert.ok(/UpdaterService.*the one the app runs|THIS is the updater the app runs/s.test(read('src/main/services/updater.js')));
  assert.ok(/never downloads or installs/i.test(read('src/main/services/update-checker.js')) && /updater\.js/.test(read('src/main/services/update-checker.js')));

  // ---- 2. What's new
  const { parseChangelog, getWhatsNew, markWhatsNewSeen } = require('../../src/main/services/whats-new');
  const log = path.join(root, 'CHANGELOG.md');
  const sections = parseChangelog(read('CHANGELOG.md'));
  assert.strictEqual(sections[0].version, pkg.version, 'newest CHANGELOG section matches package.json');
  const s040 = sections.find((x) => x.version === '0.4.0'); assert.ok(s040 && s040.body.includes('Packaging and releases'));
  const mkCfg = (init = {}) => { const m = { ...init }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; return true; }, m }; };
  let cfg = mkCfg({ 'setup.completed': true, 'updates.lastSeenVersion': '0.3.26' });
  let wn = getWhatsNew({ configService: cfg, currentVersion: '0.4.0', changelogPath: log });
  assert.ok(wn.show && wn.text.includes('0.4.0'), 'upgrade shows notes');
  assert.ok(markWhatsNewSeen({ configService: cfg, currentVersion: '0.4.0' }));
  assert.strictEqual(getWhatsNew({ configService: cfg, currentVersion: '0.4.0', changelogPath: log }).show, false, 'only once per version');
  cfg = mkCfg({ 'setup.completed': false });
  assert.strictEqual(getWhatsNew({ configService: cfg, currentVersion: '0.4.0', changelogPath: log }).show, false, 'brand-new install: no popup');
  assert.strictEqual(cfg.m['updates.lastSeenVersion'], '0.4.0');
  assert.strictEqual(getWhatsNew({ configService: mkCfg({ 'setup.completed': true }), currentVersion: '0.4.0', changelogPath: '/nope/CHANGELOG.md' }).show, false, 'missing file never throws');

  // ---- 3. Skip this version + badge state
  const { UpdaterService } = require('../../src/main/services/updater');
  const fakeAU = new EventEmitter(); Object.assign(fakeAU, { setFeedURL() {}, async checkForUpdates() { fakeAU.emit('update-available', { version: '0.5.0', releaseNotes: 'x' }); }, async downloadUpdate() {} });
  const events = [];
  const ucfg = mkCfg({ 'updates.checkOnStart': true, 'updates.autoDownload': false });
  const up = new UpdaterService({ currentVersion: '0.4.0', isPackaged: true, configService: ucfg, loadAutoUpdater: () => ({ autoUpdater: fakeAU }), onEvent: (c, p) => events.push(c), startupDelayMs: 1e9 });
  await up.check({ manual: true });
  assert.ok(up.getState().updateAvailable && up.getState().status === 'available', 'manual check shows the update');
  assert.ok(up.skipVersion('0.5.0'));
  assert.strictEqual(up.getState().updateAvailable, false, 'skip clears the badge');
  assert.strictEqual(up.getState().skippedVersion, '0.5.0');
  await up.check({ manual: false });
  assert.strictEqual(up.getState().updateAvailable, false, 'background check stays quiet for a skipped version');
  await up.check({ manual: true });
  assert.strictEqual(up.getState().updateAvailable, true, '"Check now" still shows it');
  up.dispose();

  // dev builds: read-only checker path returns the release (was broken: it read res.info)
  const dev = new UpdaterService({ currentVersion: '0.4.0', isPackaged: false, configService: mkCfg(), env: {}, updateCheckerClass: class { async check() { return { status: 'available', latest: { version: '0.5.0', name: 'N', url: 'https://github.com/Codewithsempai/Nexora/releases/tag/v0.5.0', notes: 'n', publishedAt: null } }; } } });
  await dev.check({ manual: true });
  assert.strictEqual(dev.getState().availableVersion, '0.5.0'); dev.dispose();

  // ---- 4. "Nexora, check for updates"
  const ac = require('../../src/main/services/assistant-commands');
  for (const t of ['Nexora, check for updates', 'any updates?', 'is there a new version', 'am I up to date', 'update yourself']) assert.ok(ac.isUpdateCheckCommand(t), t);
  for (const t of ['remember that I check for updates on Fridays', 'remind me to check for updates at 5pm', 'what is the weather', 'update my name to Ravi']) assert.ok(!ac.isUpdateCheckCommand(t), t);
  let announced = null;
  const fakeUpdater = { async check() { return {}; }, getState: () => ({ status: 'up-to-date', currentVersion: '0.4.0', packaged: true }), announce: (r) => { announced = r; } };
  const out = await ac.applyAssistantCommandsSmart({ updater: fakeUpdater, text: 'Nexora, check for updates' });
  assert.strictEqual(out.updateCheck.status, 'up-to-date'); assert.strictEqual(announced.status, 'up-to-date');
  assert.ok(/latest version/.test(ac.commandNotice(out)) && /up to date/i.test(ac.updateSummary(out.updateCheck)));
  const out2 = await ac.applyAssistantCommandsSmart({ updater: { ...fakeUpdater, getState: () => ({ status: 'available', availableVersion: '0.5.0', updateAvailable: true, packaged: true, currentVersion: '0.4.0' }) }, text: 'check for updates' });
  assert.strictEqual(out2.updateCheck.status, 'available'); assert.strictEqual(out2.updateCheck.version, '0.5.0');
  assert.strictEqual((await ac.applyAssistantCommandsSmart({ text: 'check for updates' })).updateCheck, null, 'no updater -> ignored');
  assert.ok(read('src/main/services/voice-service.js').includes('updater: this.updater'), 'voice path passes the updater');

  // ---- 5. wiring: channels, badge, skip button, setup step
  const contracts = read('src/preload/contracts/api.js');
  for (const ch of ['update:whats-new', 'update:whats-new-seen', 'update:command-result']) assert.ok(contracts.includes(`'${ch}'`) && read('src/preload/index.js').includes(`'${ch}'`), ch);
  assert.ok(read('src/renderer/components/titlebar.js').includes('titlebarUpdateBadge') && read('src/renderer/app/app.js').includes('setUpdateBadge'));
  assert.ok(read('src/renderer/settings/settings-panel.js').includes('Skip this version'));
  assert.ok(/Hey NEXORA/.test(read('src/renderer/setup/setup-wizard.js')) && read('src/renderer/setup/setup-wizard.js').includes('check for updates'));

  // ---- 6. semantic memory (fake Gemini embedding endpoint: words -> concepts)
  const { MemoryStore } = require('../../src/main/services/memory-store');
  const { SemanticMemory, fuse, DIMS } = require('../../src/main/services/memory-embeddings');
  const CONCEPTS = [['chess', 'relax', 'unwind', 'hobby', 'game'], ['coffee', 'drink', 'morning', 'caffeine'], ['father', 'dad', 'parent'], ['college', 'university', 'study']];
  const vec = (text) => { const v = new Array(DIMS).fill(0.001); const t = text.toLowerCase(); CONCEPTS.forEach((words, i) => { for (const w of words) if (t.includes(w)) v[i] += 1; }); return v; };
  let calls = 0; let offline = false;
  const fakeFetch = async (url, init) => {
    calls += 1; if (offline) throw new Error('offline');
    assert.ok(/batchEmbedContents/.test(url) && init.headers['x-goog-api-key'] === 'KEY' && !/key=/.test(url), 'key travels in a header, not the URL');
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ embeddings: body.requests.map((r) => ({ values: vec(r.content.parts[0].text) })) }) };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-sem-'));
  const store = new MemoryStore({ filePath: path.join(dir, 'vault.bin'), safeStorage: null });
  store.add('preferences', 'The user enjoys playing chess in the evening', { source: 'manual' });
  store.add('preferences', 'The user drinks filter coffee every morning', { source: 'manual' });
  store.add('personal', 'The user\'s father works as a bank manager', { source: 'manual' });
  let enabled = true;
  const sem = new SemanticMemory({ store, filePath: path.join(dir, 'vault.bin.vec'), getApiKey: () => 'KEY', isEnabled: () => enabled, fetchImpl: fakeFetch });
  const q = 'what do I do to relax?';
  assert.deepStrictEqual(store.search(q).items, [], 'keywords alone cannot answer this');
  await sem.sync(); assert.strictEqual(sem.stats().indexed, 3);
  const hit = await sem.rank(q, 'all', 3);
  assert.ok(hit.semantic && /chess/.test(hit.items[0].text), 'meaning match found with no shared words');
  assert.ok((await sem.buildContext(q)).includes('chess'));
  const before = calls; await sem.sync(); assert.strictEqual(calls, before, 'unchanged notes are not embedded again');
  // cache survives a restart (encrypted file), edits re-embed only the changed note
  assert.ok(fs.existsSync(path.join(dir, 'vault.bin.vec')) && !fs.readFileSync(path.join(dir, 'vault.bin.vec'), 'utf8').includes('chess'), 'cache is encrypted and holds no note text');
  const sem2 = new SemanticMemory({ store, filePath: path.join(dir, 'vault.bin.vec'), getApiKey: () => 'KEY', fetchImpl: fakeFetch });
  const c0 = calls; await sem2.sync(); assert.strictEqual(calls, c0, 'restart reuses the cache');
  store.add('knowledge', 'My college is Anna University', { source: 'manual' });
  const c1 = calls; await sem2.sync(); assert.strictEqual(calls, c1 + 1); assert.strictEqual(sem2.stats().indexed, 4);
  // keyword hits are never lost, and a note appearing in both lists ranks first
  assert.ok((await sem2.rank('coffee', 'all', 3)).items[0].text.includes('coffee'));
  assert.strictEqual(fuse([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]])[0].id, 'b');
  // deleted notes leave the index
  store.forget('chess'); await sem2.sync(); assert.strictEqual(sem2.stats().indexed, 3);
  // fallbacks: offline -> keyword ranking, then a cool-down (no repeated waits); switch off -> no calls at all
  offline = true; const semOff = new SemanticMemory({ store, filePath: path.join(dir, 'x.vec'), getApiKey: () => 'KEY', fetchImpl: fakeFetch });
  const r = await semOff.rank('coffee', 'all', 3); assert.ok(!r.semantic && /coffee/.test(r.items[0].text));
  const c2 = calls; await semOff.rank('coffee', 'all', 3); assert.strictEqual(calls, c2, 'cool-down after a failure');
  offline = false; enabled = false; const c3 = calls;
  const r2 = await sem.rank('coffee', 'all', 3); await sem.sync(); assert.strictEqual(calls, c3, 'switched off -> no network calls'); assert.ok(!r2.semantic);
  sem.clearCache(); assert.ok(!fs.existsSync(path.join(dir, 'vault.bin.vec')));
  assert.ok(new SemanticMemory({ store, filePath: path.join(dir, 'n.vec'), getApiKey: () => null, fetchImpl: fakeFetch }).active() === false, 'no key -> inactive');
  assert.strictEqual(require('../../src/main/services/config').DEFAULT_CONFIG.memory.semanticRecall, true);

  console.log('v040-test.js: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
