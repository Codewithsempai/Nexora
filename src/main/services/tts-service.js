/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — Gemini text-to-speech (the same Gemini voices as Live, e.g. "Charon") for spoken reminders.
 * No Electron dependency (unit-testable with a fake fetch). Never throws; returns { success, data, sampleRate } or { success:false, error }. */
const TTS_FALLBACK_MODELS = Object.freeze(['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-preview-tts']);
const VOICES = new Set(['Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat', 'Callirrhoe', 'Autonoe']);
const MODEL_TTL = 10 * 60 * 1000;

class TtsService {
  constructor({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl; this.now = now;
    this.models = null; this.modelsAt = 0; this.bad = new Map(); this.cache = new Map();
  }

  /** TTS models this key can use (discovered from Google, with a pinned fallback list). */
  async listModels(apiKey) {
    if (this.models && this.now() - this.modelsAt < MODEL_TTL) return this.models;
    let found = [];
    try {
      const response = await this.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const payload = await response.json();
        found = (payload.models || []).filter((m) => /tts/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
      }
    } catch { /* use the pinned list */ }
    const rank = (n) => (/flash/i.test(n) ? 0 : 1); // flash = fastest
    this.models = [...found.sort((a, b) => rank(a) - rank(b)), ...TTS_FALLBACK_MODELS.filter((n) => !found.includes(n))];
    this.modelsAt = this.now();
    return this.models;
  }

  async synthesize({ apiKey, text, voiceName = 'Charon' } = {}) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!apiKey) return { success: false, error: 'No Gemini API key.' };
    if (!clean) return { success: false, error: 'Nothing to say.' };
    if (typeof this.fetch !== 'function') return { success: false, error: 'fetch unavailable.' };
    const voice = VOICES.has(voiceName) ? voiceName : 'Charon';
    const cacheKey = `${voice}|${clean}`;
    const hit = this.cache.get(cacheKey);
    if (hit) return hit;
    const body = {
      contents: [{ parts: [{ text: `Say this clearly, warmly and a little urgently, like a friendly Chennai friend reminding someone: ${clean}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    };
    let lastError = 'Gemini voice unavailable.';
    for (const model of (await this.listModels(apiKey)).filter((m) => (this.bad.get(m) || 0) < this.now()).slice(0, 3)) {
      try {
        const response = await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
          lastError = payload?.error?.message || `HTTP ${response.status}`;
          if ([400, 403, 404, 429, 500, 503].includes(response.status)) this.bad.set(model, this.now() + 5 * 60 * 1000);
          console.warn(`[NEXORA Voice] Gemini TTS ${model}: ${lastError}`);
          continue;
        }
        const part = (payload?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
        if (!part) { lastError = 'Gemini returned no audio.'; continue; }
        const rate = Number(/rate=(\d{4,6})/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
        const result = { success: true, data: part.inlineData.data, sampleRate: rate, model };
        if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(cacheKey, result);
        return result;
      } catch (error) { lastError = error.message || String(error); console.warn(`[NEXORA Voice] Gemini TTS ${model} failed: ${lastError}`); }
    }
    return { success: false, error: lastError };
  }
}

module.exports = { TtsService, TTS_FALLBACK_MODELS, VOICES };
