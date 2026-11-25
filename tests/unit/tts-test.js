const assert = require('assert');
const { TtsService } = require('../../src/main/services/tts-service.js');
(async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url);
    if (url.includes('/models?')) return { ok: true, json: async () => ({ models: [{ name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) };
    if (url.includes('flash-preview-tts:generateContent')) {
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.generationConfig.responseModalities[0], 'AUDIO');
      assert.strictEqual(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAAA' } }] } }] }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) };
  };
  const tts = new TtsService({ fetchImpl });
  const a = await tts.synthesize({ apiKey: 'k', text: 'Daya, Reminder! Study.', voiceName: 'Charon' });
  assert(a.success && a.data === 'AAAA' && a.sampleRate === 24000);
  const before = calls.length; const b = await tts.synthesize({ apiKey: 'k', text: 'Daya, Reminder! Study.', voiceName: 'Charon' });
  assert(b.success && calls.length === before, 'repeat is cached (no second API call)');
  assert.strictEqual((await tts.synthesize({ apiKey: null, text: 'x' })).success, false);
  // all models failing -> clean failure so the app can fall back to the local voice
  const dead = new TtsService({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'gone' } }) }) });
  assert.strictEqual((await dead.synthesize({ apiKey: 'k', text: 'hi' })).success, false);
  console.log('  gemini reminder voice (tts) ok');
})().catch((e) => { console.error(e); process.exit(1); });
