const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_CONFIG, ConfigService } = require('../../src/main/services/config');
const { ACTIONS } = require('../../src/main/autonomy/actions');

const root = path.resolve(__dirname, '../..');

// 1. Config defaults & update preservation across restarts
assert.strictEqual(DEFAULT_CONFIG.setup.completed, false);
assert.strictEqual(DEFAULT_CONFIG.setup.permissionPreset, 'ask_every_time');
assert.strictEqual(DEFAULT_CONFIG.updates.autoDownload, true);
assert.strictEqual(DEFAULT_CONFIG.audio.outputProfile, 'medium');
assert.strictEqual(DEFAULT_CONFIG.audio.masterVolume, 0.55);
assert.strictEqual(DEFAULT_CONFIG.audio.echoCancellation, false);
assert.strictEqual(DEFAULT_CONFIG.audio.autoGainControl, false);
assert.strictEqual(DEFAULT_CONFIG.audio.voiceOutputVolume, 0.75);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-setup-test-'));
try {
  const cfgPath = path.join(tempDir, 'nexora-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    version: '0.3.24',
    setup: { completed: true, permissionPreset: 'trusted_actions', version: '0.3.24' },
    voice: { wakeWordEnabled: false },
    appearance: { orbProfile: 'robot' },
    audio: { outputProfile: 'low', masterVolume: 0.3, soundEffects: { wake: false }, sfxVolumes: { wake: 0.2 } },
  }));
  const cfg = new ConfigService({ configPath: cfgPath });
  assert.strictEqual(cfg.get('setup.completed'), true, 'Existing setup.completed must survive updates');
  assert.strictEqual(cfg.get('setup.permissionPreset'), 'trusted_actions');
  assert.strictEqual(cfg.get('appearance.orbProfile'), 'robot');
  assert.strictEqual(cfg.get('voice.wakeWordEnabled'), false);
  assert.strictEqual(cfg.get('audio.outputProfile'), 'low');
  assert.strictEqual(cfg.get('audio.masterVolume'), 0.3);
  assert.strictEqual(cfg.get('audio.soundEffects.wake'), false);
  assert.strictEqual(cfg.get('audio.sfxVolumes.wake'), 0.2);
  assert.strictEqual(cfg.get('audio.soundEffects.startup'), true, 'Missing new fields should back-fill cleanly');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// 2. Setup Wizard source structure & security invariants
const wizardSrc = fs.readFileSync(path.join(root, 'src/renderer/setup/setup-wizard.js'), 'utf8');
for (const title of ['Welcome', 'Gemini API Key', 'Microphone Test', 'Wake Word Setup', 'Assistant Appearance', 'Computer Permissions', 'Complete Setup']) {
  assert.ok(wizardSrc.includes(title), `Wizard step "${title}" missing`);
}
assert.ok(wizardSrc.includes('NEXORA IS READY'), 'Final wizard step heading missing');
assert.ok(wizardSrc.includes('Your Personal AI Desktop Assistant'), 'Welcome step subtitle missing');
assert.ok(wizardSrc.includes('ask_every_time') && wizardSrc.includes('trusted_actions') && wizardSrc.includes('advanced_autonomy'), 'All 3 permission presets must be present');
assert.ok(wizardSrc.includes('startWakeTest') && wizardSrc.includes('stopWakeTest'), 'Wizard must test offline wake word without calling Gemini Live');
assert.ok(wizardSrc.includes('new OrbEngine'), 'Appearance preview must render real OrbEngine & Robot');
assert.ok(!wizardSrc.includes('setup-orb-emblem'), 'Legacy blue sphere emblem must be removed from wizard');
assert.ok(wizardSrc.includes('setup-brand-emblem') && wizardSrc.includes('nexora-app-icon.png'), 'Wizard must display actual NEXORA brand icon');
assert.ok(wizardSrc.includes('wizardRetryKeyBtn'), 'API key step must support explicit Retry action');
assert.ok(!/console\.(log|warn|error).*candidate|rawKey/i.test(wizardSrc), 'Wizard must never log raw API key');

const glassCss = fs.readFileSync(path.join(root, 'src/renderer/styles/glass-redesign.css'), 'utf8');
assert.ok(!glassCss.includes('--sw-cyan'), 'Wizard CSS must not use legacy cyan/blue theme variables');

const robotOrbSrc = fs.readFileSync(path.join(root, 'src/renderer/orb/robot-orb.js'), 'utf8');
assert.ok(robotOrbSrc.includes('cachedFbxBuffer') && robotOrbSrc.includes('dispose()'), 'RobotOrb must cache decoded FBX buffer across instances and dispose cleanly');

// 3. Renderer shell, IPC, and VoiceService wake-test invariants
const indexHtml = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
assert.ok(indexHtml.includes('id="setupWizardContainer"'), 'index.html must include setupWizardContainer');

const ipcSrc = fs.readFileSync(path.join(root, 'src/main/ipc/ipc-handlers.js'), 'utf8');
assert.ok(ipcSrc.includes("ipcMain.handle('ai:key:validate'"), 'API key validation handler missing');
assert.ok(ipcSrc.includes("'x-goog-api-key': key"), 'Gemini validation must use x-goog-api-key header, not URL query param');
assert.ok(ipcSrc.includes("ipcMain.handle('autonomy:apply-preset'"), 'Permission preset IPC handler missing');
assert.ok(Object.keys(ACTIONS).length >= 8, 'Existing autonomy ACTIONS catalogue must remain intact');

const voiceSvcSrc = fs.readFileSync(path.join(root, 'src/main/services/voice-service.js'), 'utf8');
assert.ok(voiceSvcSrc.includes('setWakeTestMode') && voiceSvcSrc.includes("'wake-test-hit'"), 'VoiceService must support offline wake test hits without starting Live');

console.log('setup-wizard-test.js: all checks passed');
