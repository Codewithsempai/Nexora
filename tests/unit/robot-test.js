/* NEXORA v0.3.14 — Robot Orb: expression pack, eye styles, voice feed and profile whitelists. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
global.self = global;
const R = path.join(__dirname, '../../src/renderer/robot');
const NexoraFace = require(path.join(R, 'nexora-face.js'));
const NexoraVoiceSync = require(path.join(R, 'nexora-voice-sync.js'));
global.document = { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) };
const NexoraFaceScreen = require(path.join(R, 'nexora-face-vfx.js'));

// every expression resolves to real emotions / poses / eye styles / fx
const { EXPRESSIONS, EXPRESSION_GROUPS, FX_LIST, VFX, AUTO } = NexoraFaceScreen;
assert(Object.keys(EXPRESSIONS).length >= 22, 'expression pack');
for (const [id, e] of Object.entries(EXPRESSIONS)) {
  assert(e.emotion === 'neutral' || NexoraFace.EMOTIONS[e.emotion], id + ' emotion');
  if (e.pose) assert(NexoraFace.POSES[e.pose], id + ' pose');
  if (e.eye) assert(NexoraFace.EYE_STYLES.includes(e.eye), id + ' eye style');
  e.fx.forEach((f) => assert(FX_LIST.includes(f), id + ' fx ' + f));
}
for (const ids of Object.values(EXPRESSION_GROUPS)) ids.forEach((id) => assert(EXPRESSIONS[id], 'group id ' + id));
Object.values(AUTO).forEach((e) => { if (e.pose) assert(NexoraFace.POSES[e.pose]); if (e.eye) assert(NexoraFace.EYE_STYLES.includes(e.eye)); });
assert(VFX.length >= 12);

// the face engine accepts every expression + eye style and updates without throwing
const face = new NexoraFace();
for (const [id, e] of Object.entries(EXPRESSIONS)) {
  face.clear(); if (e.emotion) face.setEmotion(e.emotion, e.amt); if (e.pose) face.setPose(e.pose, .9); face.setEyeStyle(e.eye || null);
  for (let i = 0; i < 20; i++) face.update(.016, i * .016, null);
}
assert.throws(() => face.setEyeStyle('nope'));
face.setEyeStyle('heart'); for (let i = 0; i < 60; i++) face.update(.016, i * .016, null); assert(face._esK > .9, 'eye style fades in');
face.clear(); for (let i = 0; i < 90; i++) face.update(.016, 2 + i * .016, null); assert(face._esK < .05, 'eye style fades out');

// voice sync: external level drives the mouth, and releasing it closes the mouth
const v = new NexoraVoiceSync();
v.feed(.6); for (let i = 0; i < 40; i++) v.update(.016, i * .016);
assert(v.speaking && v.level > .2 && v.open > 0, 'feed opens the mouth');
v.feed(null); for (let i = 0; i < 60; i++) v.update(.016, 1 + i * .016);
assert(!v.speaking && v.open < .05, 'release closes the mouth');

// every shipped Orb profile is accepted by the main process
const cfg = fs.readFileSync(path.join(__dirname, '../../src/main/services/config.js'), 'utf8');
for (const f of ['src/main/services/voice-service.js', 'src/main/services/config.js', 'src/main/application/popup-window.js']) {
  assert(/'nexie', 'robot'/.test(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')), f + ' whitelists robot');
}
assert(fs.existsSync(path.join(R, 'robot-fbx.js')) && fs.statSync(path.join(R, 'robot-fbx.js')).size > 5e6, 'robot model script present');
console.log('robot-test OK');
