const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getWindowsAudioDiagnostics } = require('../../src/main/services/audio-diagnostics');

const root = path.resolve(__dirname, '../..');

function createMockAudioContext() {
  const createdGains = [];
  const createdCompressors = [];
  return {
    state: 'running',
    currentTime: 1.0,
    sampleRate: 48000,
    destination: { nodeType: 'destination' },
    createGain() {
      const gainObj = {
        value: 1,
        calls: [],
        setValueAtTime(v, t) { this.value = v; this.calls.push({ op: 'set', v, t }); },
        linearRampToValueAtTime(v, t) { this.value = v; this.calls.push({ op: 'linear', v, t }); },
        exponentialRampToValueAtTime(v, t) { this.value = v; this.calls.push({ op: 'exp', v, t }); },
        setTargetAtTime(v, t, tc) { this.value = v; this.calls.push({ op: 'target', v, t, tc }); },
        cancelScheduledValues(t) { this.calls.push({ op: 'cancel', t }); },
      };
      const node = { gain: gainObj, connected: [], connect(d) { this.connected.push(d); return d; }, disconnect() {} };
      createdGains.push(node);
      return node;
    },
    createDynamicsCompressor() {
      const node = {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 1 },
        attack: { value: 0 },
        release: { value: 0 },
        connected: [],
        connect(d) { this.connected.push(d); return d; },
        disconnect() {},
      };
      createdCompressors.push(node);
      return node;
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 440, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() {},
        stop() {},
        disconnect() {},
        onended: null,
      };
    },
    createBuffer(ch, len, rate) {
      const data = new Float32Array(len);
      return { duration: len / rate, getChannelData: () => data };
    },
    createBufferSource() {
      return { buffer: null, connect() {}, start() {}, stop() {}, disconnect() {}, onended: null };
    },
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; },
    _gains: createdGains,
    _compressors: createdCompressors,
  };
}

(async () => {
  // 1. Verify main-process Chromium audio isolation flags
  const mainAppSrc = fs.readFileSync(path.join(root, 'src/main/application/app.js'), 'utf8');
  assert.ok(mainAppSrc.includes('HardwareMediaKeyHandling'), 'Must disable HardwareMediaKeyHandling');
  assert.ok(mainAppSrc.includes('MediaSessionService'), 'Must disable MediaSessionService');
  assert.ok(mainAppSrc.includes('WebRtcAllowInputVolumeAdjustment'), 'Must disable WebRTC auto mic gain adjustment');
  assert.ok(mainAppSrc.includes('ChromeWideEchoCancellation'), 'Must disable ChromeWideEchoCancellation render loopback');

  // 2. Verify Windows diagnostics module is read-only unless user clicks button
  const diagSrc = fs.readFileSync(path.join(root, 'src/main/services/audio-diagnostics.js'), 'utf8');
  assert.ok(!/reg\s+add|Set-ItemProperty|New-ItemProperty/i.test(diagSrc), 'Audio diagnostics must never silently mutate Windows registry');
  const diagResult = await getWindowsAudioDiagnostics();
  assert.strictEqual(typeof diagResult.duckingLabel, 'string');

  // 3. Verify VoiceAudio & SoundSystem use decoupled graphs without silentGain -> context.destination
  const voiceSrc = fs.readFileSync(path.join(root, 'src/renderer/audio/voice-audio.js'), 'utf8');
  assert.ok(!voiceSrc.includes('silentGain'), 'Must not route silentGain to speaker destination');
  assert.ok(voiceSrc.includes('MediaStreamTrackProcessor'), 'Capture should prefer MediaStreamTrackProcessor');
  assert.ok(voiceSrc.includes('createMediaStreamDestination'), 'Fallback capture must terminate in MediaStreamAudioDestinationNode, not speakers');

  let contextCreations = 0;
  globalThis.window = {
    AudioContext: function MockCtx() {
      contextCreations++;
      return createMockAudioContext();
    },
  };

  const { PlaybackBus, OUTPUT_PROFILE_GAINS } = await import(pathToFileURL(path.join(root, 'src/renderer/audio/playback-bus.js')).href);
  const { SoundSystem, SFX_CATEGORIES } = await import(pathToFileURL(path.join(root, 'src/renderer/audio/sound-system.js')).href);
  const { VoiceAudio } = await import(pathToFileURL(path.join(root, 'src/renderer/audio/voice-audio.js')).href);

  const bus = new PlaybackBus();
  const sfx = new SoundSystem({ playbackBus: bus });
  const voice = new VoiceAudio({ playbackBus: bus });

  assert.strictEqual(OUTPUT_PROFILE_GAINS.low < OUTPUT_PROFILE_GAINS.medium && OUTPUT_PROFILE_GAINS.medium < OUTPUT_PROFILE_GAINS.high, true);
  assert.strictEqual(SFX_CATEGORIES.length, 8, 'Must support all 8 independent SFX categories');

  sfx.applyConfig({
    enabled: true,
    masterVolume: 0.5,
    outputProfile: 'low',
    sfxVolumes: {
      startup: 0.4,
      error: 0.8,
    },
    soundEffects: {
      startup: true,
      error: false,
    },
  });
  assert.strictEqual(sfx.getEffectVolume('startup'), 0.4);
  assert.strictEqual(sfx.getEffectVolume('error'), 0.8);
  assert.strictEqual(sfx.perEffect.error, false);

  // Play multiple overlapping effects + Gemini voice PCM and verify single AudioContext + limiter
  sfx.playStartup();
  sfx.playPanel();
  sfx.playWake();
  const pcmBytes = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) pcmBytes.writeInt16LE(32767, i * 2);
  await voice.playPcm({ data: pcmBytes.toString('base64'), sampleRate: 24000 });

  assert.strictEqual(contextCreations, 1, 'SoundSystem and VoiceAudio must share one single playback AudioContext without recreating it');
  assert.ok(bus.limiterNode && bus.limiterNode.threshold.value < 0, 'PlaybackBus must insert a DynamicsCompressorNode peak limiter');

  // Verify default mic constraints avoid WebRTC AGC / AEC
  const constraints = voice.buildConstraints(true);
  assert.strictEqual(constraints.audio.echoCancellation, false);
  assert.strictEqual(constraints.audio.autoGainControl, false);
  assert.strictEqual(constraints.audio.noiseSuppression, true);

  voice.destroy();
  delete globalThis.window;
  console.log('audio-isolation-test.js: all checks passed');
})();
