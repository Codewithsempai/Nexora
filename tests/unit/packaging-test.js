const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { VALID_IPC_CHANNELS } = require('../../src/preload/contracts/api');

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const topChangelog = /^##\s+v?(\d+\.\d+\.\d+)/m.exec(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'))?.[1];
assert.strictEqual(pkg.version, topChangelog, 'package.json version must match the newest CHANGELOG.md entry');
assert.strictEqual(lock.version, pkg.version, 'package-lock.json version must match package.json');
assert.strictEqual(lock.packages?.['']?.version, pkg.version, 'package-lock.json root package version must match package.json');

assert.ok(pkg.build && pkg.build.appId === 'com.codewithsempai.nexora', 'package.json build.appId missing');
assert.strictEqual(pkg.build.productName, 'NEXORA', 'package.json productName must be NEXORA');
assert.ok(pkg.build.win && pkg.build.win.icon === 'assets/icons/nexora-app-icon.ico', 'Windows app icon missing');
assert.ok(pkg.build.nsis, 'NSIS config missing');
assert.strictEqual(pkg.build.nsis.oneClick, false, 'Installer must allow directory selection');
assert.strictEqual(pkg.build.nsis.allowToChangeInstallationDirectory, true, 'Installer must allow changing install directory');
assert.strictEqual(pkg.build.nsis.createDesktopShortcut, true, 'Desktop shortcut missing');
assert.strictEqual(pkg.build.nsis.createStartMenuShortcut, true, 'Start Menu shortcut missing');
assert.strictEqual(pkg.build.nsis.deleteAppDataOnUninstall, false, 'Must preserve userData on uninstall/update');
assert.strictEqual(pkg.build.nsis.artifactName, 'NEXORA-Setup-x64.exe', 'NSIS artifact name must be NEXORA-Setup-x64.exe');
assert.strictEqual(pkg.build.nsis.include, 'build/installer.nsh', 'Custom NSIS script must be included');

assert.ok(Array.isArray(pkg.build.asarUnpack) && pkg.build.asarUnpack.some((p) => p.includes('wakeword')), 'wakeword assets must be unpacked');
assert.ok(Array.isArray(pkg.build.extraResources) && pkg.build.extraResources.some((r) => r.from.includes('nexora-core.exe')), 'Rust sidecar must be packaged in extraResources');
assert.ok(Array.isArray(pkg.build.publish) && pkg.build.publish[0].owner === 'Codewithsempai' && pkg.build.publish[0].repo === 'Nexora', 'GitHub publish target must be Codewithsempai/Nexora');

assert.ok(pkg.dependencies['electron-updater'] && pkg.devDependencies['electron-builder'], 'updater and builder deps must exist');
assert.ok(pkg.scripts.dist && pkg.scripts.dist.includes('electron-builder'), 'npm run dist script missing');

assert.ok(fs.existsSync(path.join(root, 'assets/icons/nexora-app-icon.ico')), 'Windows icon file missing');
assert.ok(fs.existsSync(path.join(root, 'build/installer.nsh')), 'build/installer.nsh missing');
assert.ok(fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8').includes('customUnInstall'), 'installer.nsh must define uninstall hook');

for (const doc of ['LICENSE', 'NOTICE', 'PRIVACY.md', 'SECURITY.md', 'docs/BUILD_AND_RELEASE.md']) {
  const full = path.join(root, doc);
  assert.ok(fs.existsSync(full), `${doc} exists`);
  const content = fs.readFileSync(full, 'utf8');
  assert.ok(!/<your-[^>]+>/i.test(content), `${doc} must not contain unresolved <your-...> placeholder`);
}

const preload = fs.readFileSync(path.join(root, 'src/preload/index.js'), 'utf8');
for (const ch of [
  'update:check', 'update:download', 'update:install', 'update:state', 'update:setAuto', 'update:progress', 'update:downloaded',
  'ai:key:validate', 'ai:key:validate-stored', 'audio:diagnostics', 'audio:open-communications', 'autonomy:apply-preset',
  'voice:wake:test-start', 'voice:wake:test-stop', 'voice:wake-test-hit',
]) {
  assert.ok(VALID_IPC_CHANNELS.includes(ch), `${ch} must be in VALID_IPC_CHANNELS`);
  assert.ok(preload.includes(`'${ch}'`), `${ch} must be exposed in preload bridge`);
}

console.log('packaging-test.js: all checks passed');
