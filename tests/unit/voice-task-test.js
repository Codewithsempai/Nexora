// v0.3.9: Live voice tasks — Gemini gets the RESULT (so it says "I opened Calculator" at once); slow tasks are announced later.
const assert = require('assert');
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { app: { getPath: () => '/tmp' }, safeStorage: { isEncryptionAvailable: () => false } }; return orig.call(this, r, ...a); };
const { VoiceService } = require('../../src/main/services/voice-service.js');
const { spokenLine } = require('../../src/main/autonomy/speech.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (runTask) => { const v = Object.create(VoiceService.prototype); const sent = []; v.liveSocket = { readyState: 1, send: (x) => sent.push(JSON.parse(x)) }; v.liveReady = true; v.emit = () => {}; v.taskWaitMs = 80; v.spoken = [];
  v.autonomy = { runTask, speak: (t) => v.spoken.push(t), explainScreen: async () => ({ success: true, text: 'Terminal-la error: module missing.' }) }; return { v, sent }; };
(async () => {
  assert.strictEqual(spokenLine({ success: true, steps: [{ ok: true, summary: 'Opened Calculator' }] }), 'I opened Calculator.');
  assert.strictEqual(spokenLine({ success: true, steps: [{ ok: true, summary: 'Created C:\\Users\\Daya\\Desktop\\nexora-test' }, { ok: true, summary: 'Opened C:\\Users\\Daya\\Desktop\\nexora-test in VS Code' }] }), 'I created nexora-test. I opened nexora-test in VS Code.');
  assert(/^Okay/.test(spokenLine({ cancelled: true }))); assert(/Sorry, I could not finish: The folder does not exist/.test(spokenLine({ success: false, steps: [{ ok: false, summary: 'The folder does not exist.' }] })));
  // 1) quick task: the tool response carries the result for Gemini to say
  { const { v, sent } = mk(async () => ({ success: true, steps: [{ ok: true, summary: 'Opened Calculator' }] }));
    await v.handleLiveToolCall({ functionCalls: [{ id: 't1', name: 'run_task', args: { goal: 'open calculator' } }] });
    const r = sent[0].toolResponse.functionResponses[0].response; assert.strictEqual(r.result, 'done'); assert.strictEqual(r.summary, 'I opened Calculator.'); assert(/Tanglish/.test(r.instruction)); }
  // 2) slow task (waiting for the user to press Allow): "waiting" now, spoken announcement when it finishes
  { let finish; const { v, sent } = mk(() => new Promise((res) => { finish = res; }));
    await v.handleLiveToolCall({ functionCalls: [{ id: 't2', name: 'run_task', args: { goal: 'open vs code and chrome' } }] });
    assert.strictEqual(sent[0].toolResponse.functionResponses[0].response.result, 'waiting'); finish({ success: true, steps: [{ ok: true, summary: 'Opened VS Code' }, { ok: true, summary: 'Opened Chrome' }] }); await sleep(20);
    const note = sent[1].clientContent; assert.strictEqual(note.turnComplete, true, 'makes Gemini speak'); assert(/I opened VS Code\. I opened Chrome\./.test(note.turns[0].parts[0].text)); }
  // 3) Live session closed: falls back to the Gemini TTS voice through autonomy.speak
  { let finish; const { v, sent } = mk(() => new Promise((res) => { finish = res; })); v.liveSocket = null; v.announceTask({ success: true, steps: [{ ok: true, summary: 'Opened Notepad' }] }); assert.deepStrictEqual(v.spoken, ['I opened Notepad.']); assert.strictEqual(sent.length, 0); }
  // 4) explain_screen returns the answer for Gemini to explain
  { const { v, sent } = mk(async () => ({})); await v.handleLiveToolCall({ functionCalls: [{ id: 's1', name: 'explain_screen', args: {} }] }); const r = sent[0].toolResponse.functionResponses[0].response; assert.strictEqual(r.result, 'ok'); assert(/module missing/.test(r.screen)); }
  console.log('  live voice task replies ok');
})().catch((e) => { console.error(e); process.exit(1); });
