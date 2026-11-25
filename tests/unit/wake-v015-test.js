/* v0.3.15: cut-off JSON from the wake STT, and two-near-miss wake. */
const assert = require('assert');
const { extractTranscript, isWakeNearMiss, matchWakePhrase } = require('../../src/main/services/voice-utils');

// truncated / odd Gemini answers (these were logged as "heard: {  "transcript"" before)
assert.deepStrictEqual(extractTranscript('{\n  "transcript"'), { transcript: '', wake: null });
assert.deepStrictEqual(extractTranscript('{"transcript": "Hey Nex'), { transcript: 'Hey Nex', wake: null });
assert.strictEqual(extractTranscript('{"transcript":"Hey Nexora","wake":true}').wake, true);
assert.strictEqual(extractTranscript('```json\n{"transcript":"hello"}\n```').transcript, 'hello');
assert.strictEqual(extractTranscript('Hey Nexora').transcript, 'Hey Nexora');
assert.strictEqual(extractTranscript('').transcript, '');
assert.strictEqual(extractTranscript('{"transcript":"say \\"hi\\" now"}').transcript, 'say "hi" now');

// near-misses from the real log wake only in pairs (the caller enforces the pair); real words never count
for (const t of ['enexo', 'anexo', 'plexo', 'enexora']) assert(isWakeNearMiss(t), `near-miss: ${t}`);
for (const t of ['mhm', 'Her', 'H', 'next', 'nexus', 'alexa', 'texas', 'flexo is a word in a long sentence', 'extra', 'hello nexora there friend']) assert(!isWakeNearMiss(t), `not a near-miss: ${t}`);
for (const t of ['Hey Nexora', 'Nexora', 'hey nexo', 'Nexa']) assert(!isWakeNearMiss(t) && matchWakePhrase(t).matched, `normal wake still works: ${t}`);
console.log('  v0.3.15 wake: cut-off JSON + near-miss pairs ok');
