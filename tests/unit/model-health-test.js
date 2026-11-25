/* v0.3.12: a model that answers 404 / 429 is skipped by EVERY background helper (memory, planner), not retried on each sentence. */
const assert = require('assert');
const { ModelDirectory } = require('../../src/main/services/model-ladder');
const health = require('../../src/main/services/model-health');
const { extractWithGemini, pickExtractModels } = require('../../src/main/services/memory-extractor');
const { planWithGemini } = require('../../src/main/autonomy/planner');
(async () => {
  const dir = new ModelDirectory(); health.bind(dir);
  const calls = [];
  const fetchImpl = async (url) => { const m = /models\/([^:]+):/.exec(url)[1]; calls.push(m); return m === 'gemini-2.5-flash-lite' ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"facts":[],"forget":[],"reminder":null}' }] } }] }) }; };
  const text = 'my name is Daya';
  await extractWithGemini({ apiKey: 'k', text, fetchImpl, models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] });
  assert.deepStrictEqual(calls, ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], 'first sentence tries the bad model once');
  assert(dir.isCooling('gemini-2.5-flash-lite'), '404 puts the model on the cooldown list');
  calls.length = 0;
  for (let i = 0; i < 5; i++) await extractWithGemini({ apiKey: 'k', text, fetchImpl, models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'] });
  assert(!calls.includes('gemini-2.5-flash-lite'), 'later sentences never touch the 404 model again');
  // planner shares the same list
  calls.length = 0; await planWithGemini({ apiKey: 'k', goal: 'play a song', executor: { validate: () => ({ ok: false, error: 'x' }) }, models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'], fetchImpl });
  assert(!calls.includes('gemini-2.5-flash-lite'));
  // memory model order keeps the chat model first (no "lite first" re-sort)
  const order = await pickExtractModels(new ModelDirectory(), 'k', 'gemini-2.5-flash'); assert.strictEqual(order[0], 'gemini-2.5-flash');
  console.log('  v0.3.12 shared model health (404 is not retried on every sentence) ok');
})().catch((e) => { console.error(e); process.exit(1); });
