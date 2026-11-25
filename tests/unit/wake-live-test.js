/* v0.3.11: wake word through a throwaway Gemini Live session (JARVIS reference), text fallback, mic gain, idle sleep. */
const assert = require('assert'); const os = require('os');
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { app: { getPath: () => os.tmpdir() }, safeStorage: { isEncryptionAvailable: () => false } }; return orig.call(this, r, ...a); };
const { EventEmitter } = require('events');
const { transcribeClipLive } = require('../../src/main/services/live-oneshot');
const { boostPcm } = require('../../src/main/services/voice-utils');
const { VoiceService } = require('../../src/main/services/voice-service');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fake Gemini Live server. script(msgSender, sentMessages) decides how it answers. */
function fakeWS(script) {
  return class FakeWS extends EventEmitter {
    constructor(url) { super(); this.url = url; this.sent = []; this.closed = false; FakeWS.last = this; setImmediate(() => this.emit('open')); }
    send(raw) {
      const msg = JSON.parse(raw); this.sent.push(msg);
      script({ reply: (m) => setImmediate(() => this.emit('message', Buffer.from(JSON.stringify(m)))), fail: (c, r) => setImmediate(() => this.emit('close', c, Buffer.from(r || ''))), msg, ws: this });
    }
    close() { this.closed = true; } terminate() { this.closed = true; }
  };
}
const pcm = Buffer.alloc(16000 * 2); for (let i = 0; i < 16000; i++) pcm.writeInt16LE(i % 2 ? 3000 : -3000, i * 2);

(async () => {
  // 1. Live transcribes the clip: setup -> audio chunks -> audioStreamEnd, transcript comes back, session is closed.
  let WS = fakeWS(({ reply, msg }) => {
    if (msg.setup) reply({ setupComplete: {} });
    if (msg.realtimeInput?.audioStreamEnd) { reply({ serverContent: { inputTranscription: { text: 'Hey ' } } }); reply({ serverContent: { inputTranscription: { text: 'Nexora' } } }); reply({ serverContent: { modelTurn: { parts: [{ text: '.' }] } } }); }
  });
  let heard = await transcribeClipLive({ WebSocket: WS, apiKey: 'k', model: 'gemini-3.8-live', pcm });
  assert.strictEqual(heard, 'hey nexora');
  assert(WS.last.closed, 'throwaway session is closed');
  const setup = WS.last.sent[0].setup; assert.strictEqual(setup.model, 'models/gemini-3.8-live'); assert(setup.inputAudioTranscription && !setup.tools, 'transcription only, no tools');
  assert(WS.last.sent.filter((m) => m.realtimeInput?.audio).length >= 10, 'clip + trailing silence are streamed');
  assert(!/key=k/.test('') && /key=k/.test(WS.last.url));

  // 2. no speech -> '' (not an error); quota error -> rejects with status so the ladder moves on.
  WS = fakeWS(({ reply, msg }) => { if (msg.setup) reply({ setupComplete: {} }); if (msg.realtimeInput?.audioStreamEnd) reply({ serverContent: { turnComplete: true } }); });
  assert.strictEqual(await transcribeClipLive({ WebSocket: WS, apiKey: 'k', model: 'm', pcm }), '');
  WS = fakeWS(({ reply, msg }) => { if (msg.setup) reply({ error: { code: 429, message: 'RESOURCE_EXHAUSTED quota' } }); });
  await assert.rejects(transcribeClipLive({ WebSocket: WS, apiKey: 'k', model: 'm', pcm }), (e) => e.status === 429);
  WS = fakeWS(({ fail, msg }) => { if (msg.setup) fail(1013, 'try later'); });
  await assert.rejects(transcribeClipLive({ WebSocket: WS, apiKey: 'k', model: 'm', pcm }), (e) => e.status === 429);
  WS = fakeWS(() => {});
  await assert.rejects(transcribeClipLive({ WebSocket: WS, apiKey: 'k', model: 'm', pcm, setupTimeoutMs: 60, timeoutMs: 200 }), (e) => e.status === 504);

  // 3. mic auto-gain: a quiet clip is lifted, a loud one is untouched.
  const quiet = Buffer.alloc(200); for (let i = 0; i < 100; i++) quiet.writeInt16LE(i % 2 ? 400 : -400, i * 2);
  assert(Math.abs(boostPcm(quiet).readInt16LE(2)) > 4000); const loud = Buffer.alloc(8); loud.writeInt16LE(20000, 0); assert.strictEqual(boostPcm(loud), loud);

  // 4. VoiceService wake flow: Live first, text fallback, standby survives when both fail.
  const mk = (cfg = {}) => {
    const vs = Object.create(VoiceService.prototype); const modes = [];
    Object.assign(vs, { wakeEnabled: true, liveReady: false, liveConnecting: false, liveSocket: null, pendingAudio: [], mode: 'standby', 
      configService: { get: (k) => ({ 'voice.wakeEngine': cfg.engine, 'ai': { chatModel: 'gemini-2.5-flash', liveModel: 'gemini-3.8-live' } })[k], set() {} },
      modelDirectory: { liveOrder: async () => ['gemini-3.8-live'], textOrder: async () => ['gemini-2.5-flash'], isCooling: () => false, markGood() {}, markBad(m, k) { (vs.bad ||= []).push([m, k]); } },
      popupManager: { show() {}, hide() {} }, wakeWord: { reset() {} }, getApiKey: () => 'key', emit() {}, emitModelSwitch() {} });
    vs.setMode = (mode, d) => { vs.mode = mode; modes.push([mode, d?.message]); }; vs.startLive = async (o) => { vs.started = o; };
    return { vs, modes };
  };
  const okText = (t) => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: t }) }] } }] }) });
  // v0.3.25: wake is detected OFFLINE by the ONNX engine; the service only reacts to a hit.
  { const { vs, modes } = mk(); let shown = null; vs.popupManager = { show: (...a) => { shown = a; }, hide() {} }; vs.wakeWord = { reset() {} };
    await vs.onWakeWord({ word: 'Hey Nexora', score: 0.93 });
    assert(vs.started && Array.isArray(vs.started.initialAudio), 'an ONNX wake hit starts Live'); assert(shown && shown[0] === 'wake', 'wake popup is shown'); assert.strictEqual(modes.at(-1)[0], 'wake'); }
  { const { vs } = mk(); vs.wakeEnabled = false; await vs.onWakeWord({ word: 'Nexo', score: 0.99 }); assert(!vs.started, 'a hit while standby is off is ignored'); }
  { const { vs } = mk(); vs.liveConnecting = true; await vs.onWakeWord({ word: 'Nexo', score: 0.99 }); assert(!vs.started, 'a hit while Live is already connecting is ignored'); }

  // 5. idle auto-sleep returns to standby.
  { const { vs } = mk(); let stopped = null; Object.assign(vs, { liveReady: true, liveSocket: { readyState: 1 }, mode: 'listening', autonomy: null });
    vs.configService.get = (k) => (k === 'voice.autoSleepSeconds' ? 30 : undefined); vs.stopLive = async (o) => { stopped = o; };
    vs.startIdleWatch(); vs.lastActivityAt = Date.now() - 60000; await sleep(5200); vs.stopIdleWatch();
    assert(stopped && stopped.returnToStandby === true && /sleep/.test(stopped.message), 'idle -> standby'); }
  console.log('  v0.3.25 offline ONNX wake flow + idle sleep + live one-shot helper ok');
})().catch((e) => { console.error(e); process.exit(1); });
