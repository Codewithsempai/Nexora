/* ========================================================================
 * NEXORA Gemini model directory + automatic fallback ladders.
 * Discovers models enabled for this API key, filters by supported methods,
 * remembers short-lived failures, and never stores the API key.
 * ======================================================================== */
const crypto = require('crypto');

// Ladder taken from the measured-healthy list in Nexora_until_done (shared/constants.ts).
// Pinned names first; rolling aliases last because they returned 503/504 on real keys.
const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';
const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
const TEXT_FALLBACK_MODELS = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
]);
// Only model codes printed in Google's Live documentation.
const LIVE_FALLBACK_MODELS = Object.freeze([
  'gemini-3.8-live',
  'gemini-2.5-flash-native-audio-preview-12-2025',
]);
const MAX_TEXT_RUNGS = 4;
const MAX_LIVE_RUNGS = 3;
// Models that list generateContent but are not chat models (speech, image, embeddings, robotics...).
const NON_CHAT_MODEL = /(tts|image|imagen|veo|embed|aqa|robotics|computer-use|native-audio|live|audio|learnlm|gemma|vision|banana)/i;
const MODEL_LIST_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = Object.freeze({ model: 30 * 60_000, quota: 10 * 60_000, server: 2 * 60_000, timeout: 2 * 60_000 });
const SWITCHABLE_FAILURES = new Set(['model', 'quota', 'server', 'timeout']);

function safeModelName(name) {
  const value = String(name || '').replace(/^models\//, '').trim();
  return /^[a-zA-Z0-9._-]{3,120}$/.test(value) ? value : '';
}

function classifyFailure(error) {
  const status = Number(error?.statusCode || error?.status || error?.code || 0);
  const errorCode = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  if (status === 401 || status === 403 || /api key|permission denied|unauthenticated|invalid credential/.test(message)) return 'auth';
  if (status === 429 || /resource_exhausted|quota|rate.?limit|too many requests/.test(message)) return 'quota';
  if (status === 408 || status === 504 || /timed? ?out|timeout|deadline exceeded/.test(message)) return 'timeout';
  if (status === 404 || /model.*(not found|unavailable|does not exist)|not supported for.*(method|generate|live)|unsupported model|unknown model/.test(message)) return 'model';
  if (status === 400 && /(unsupported|not supported|invalid.*modality|audio.*not supported)/.test(message)) return 'model';
  if (status >= 500 || /high demand|overloaded|temporarily unavailable|internal server|service unavailable/.test(message)) return 'server';
  if (/econnreset|enotfound|network|fetch failed|socket hang up|offline/.test(`${message} ${errorCode}`)) return 'offline';
  return 'other';
}

function rankTextModels(names) {
  const unique = [...new Set((names || []).map(safeModelName).filter(Boolean))].filter((name) => !NON_CHAT_MODEL.test(name));
  const pinned = TEXT_FALLBACK_MODELS.filter((name) => unique.includes(name));
  const score = (name) => /flash-lite/i.test(name) ? 2 : /flash/i.test(name) ? 1 : /pro/i.test(name) ? 3 : 4;
  const rest = unique.filter((name) => !pinned.includes(name) && !/preview|exp|latest/i.test(name)).sort((a, b) => score(a) - score(b) || b.localeCompare(a));
  return [...pinned, ...rest];
}

function rankLiveModels(names) {
  const unique = [...new Set((names || []).map(safeModelName).filter(Boolean))];
  const score = (name) => name === DEFAULT_LIVE_MODEL ? -1 : /native-audio/i.test(name) ? 0 : /live/i.test(name) ? 1 : 2;
  return unique.sort((a, b) => score(a) - score(b) || b.localeCompare(a));
}

class ModelDirectory {
  constructor({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cache = new Map(); // SHA-256 key fingerprint -> model inventory + expiry
    this.bad = new Map(); // model -> { kind, until, detail }
  }

  fingerprint(apiKey) { return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex'); }

  /** Cached inventory if we have one; otherwise start discovery in the background and answer at once. */
  discoverFast(apiKey) {
    if (!apiKey) return { textModels: [], liveModels: [], discovered: false };
    const cached = this.cache.get(this.fingerprint(apiKey));
    if (cached && cached.expiresAt > this.now()) return cached.inventory;
    void this.discover(apiKey).catch(() => {});
    return { textModels: [], liveModels: [], discovered: false };
  }

  async discover(apiKey, { force = false } = {}) {
    if (!apiKey) return { textModels: [], liveModels: [], discovered: false, warning: 'API key not configured.' };
    const keyId = this.fingerprint(apiKey);
    const cached = this.cache.get(keyId);
    if (!force && cached && cached.expiresAt > this.now()) return cached.inventory;
    const textModels = new Set();
    const liveModels = new Set();
    let pageToken = '';
    let pageCount = 0;
    try {
      do {
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error('Gemini model discovery timed out.')), 12000);
        let response;
        try { response = await this.fetchImpl(url.toString(), { headers: { 'x-goog-api-key': apiKey }, signal: controller.signal }); }
        finally { clearTimeout(timeout); }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload?.error?.message || `Model discovery failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        for (const model of payload.models || []) {
          const name = safeModelName(model.name);
          if (!name) continue;
          const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
          if (methods.includes('generateContent') && !NON_CHAT_MODEL.test(name)) textModels.add(name);
          if (methods.includes('bidiGenerateContent')) liveModels.add(name);
        }
        pageToken = String(payload.nextPageToken || '');
        pageCount++;
      } while (pageToken && pageCount < 8);
      const inventory = {
        textModels: rankTextModels([...textModels]),
        liveModels: rankLiveModels([...liveModels]),
        discovered: true,
        warning: pageToken ? 'Model discovery stopped at the safety page limit.' : '',
        discoveredAt: this.now(),
      };
      this.cache.set(keyId, { inventory, expiresAt: this.now() + MODEL_LIST_TTL_MS });
      return inventory;
    } catch (error) {
      const inventory = {
        textModels: [], liveModels: [], discovered: false,
        warning: String(error?.message || 'Model discovery failed. Using built-in fallback ladder.').slice(0, 240),
        discoveredAt: this.now(),
      };
      this.cache.set(keyId, { inventory, expiresAt: this.now() + 60_000 });
      return inventory;
    }
  }

  async list(apiKey, { force = false } = {}) {
    const inventory = await this.discover(apiKey, { force });
    const text = inventory.textModels.length ? inventory.textModels : [...TEXT_FALLBACK_MODELS];
    const live = inventory.liveModels.length ? inventory.liveModels : [...LIVE_FALLBACK_MODELS];
    return {
      success: true,
      discovered: inventory.discovered,
      warning: inventory.warning,
      textModels: this.withStates(text, 'text'),
      liveModels: this.withStates(live, 'live'),
      defaults: { text: DEFAULT_TEXT_MODEL, live: DEFAULT_LIVE_MODEL },
    };
  }

  isCooling(model) {
    const entry = this.bad.get(model);
    if (!entry) return false;
    if (entry.until <= this.now()) { this.bad.delete(model); return false; }
    return true;
  }

  markBad(model, kind, detail = '') {
    const duration = COOLDOWN_MS[kind];
    if (duration && SWITCHABLE_FAILURES.has(kind)) this.bad.set(model, { kind, detail: String(detail || kind).slice(0, 180), until: this.now() + duration });
  }

  markGood(model) { this.bad.delete(model); }

  withStates(names, type) {
    return names.map((name) => {
      const entry = this.bad.get(name);
      return entry && entry.until > this.now()
        ? { name, state: 'cooling', reason: entry.kind, retryInSeconds: Math.ceil((entry.until - this.now()) / 1000) }
        : { name, state: 'ready', type };
    });
  }

  async textOrder(apiKey, selected = DEFAULT_TEXT_MODEL) {
    const inventory = this.discoverFast(apiKey);
    const preferred = safeModelName(selected) || DEFAULT_TEXT_MODEL;
    const known = inventory.discovered && inventory.textModels.length ? new Set(inventory.textModels) : null;
    // Pinned ladder (dropping rungs Google does not offer this key), then any other discovered chat model.
    const ladder = TEXT_FALLBACK_MODELS.filter((name) => !known || known.has(name));
    const extra = known ? inventory.textModels.filter((name) => !ladder.includes(name)) : [];
    const all = [preferred, ...ladder.filter((name) => name !== preferred), ...extra.filter((name) => name !== preferred)];
    const ready = all.filter((name) => !this.isCooling(name));
    return (ready.length ? ready : [preferred]).slice(0, MAX_TEXT_RUNGS);
  }

  async liveOrder(apiKey, selected = DEFAULT_LIVE_MODEL, { exclude = [] } = {}) {
    const inventory = this.discoverFast(apiKey);
    const discovered = inventory.liveModels.length ? inventory.liveModels : [...LIVE_FALLBACK_MODELS];
    const preferred = safeModelName(selected) || DEFAULT_LIVE_MODEL;
    const skip = new Set(exclude);
    const all = [preferred, ...rankLiveModels(discovered).filter((name) => name !== preferred)];
    if (!inventory.liveModels.length) for (const name of LIVE_FALLBACK_MODELS) if (!all.includes(name)) all.push(name);
    const ready = all.filter((name) => !this.isCooling(name) && !skip.has(name));
    if (ready.length) return ready.slice(0, MAX_LIVE_RUNGS);
    return skip.has(preferred) ? [] : [preferred];
  }

  getCoolingSnapshot() {
    const now = this.now();
    return [...this.bad.entries()].filter(([, item]) => item.until > now).map(([model, item]) => ({ model, kind: item.kind, detail: item.detail, retryInSeconds: Math.ceil((item.until - now) / 1000) }));
  }
}

module.exports = {
  ModelDirectory,
  DEFAULT_TEXT_MODEL,
  DEFAULT_LIVE_MODEL,
  TEXT_FALLBACK_MODELS,
  LIVE_FALLBACK_MODELS,
  MAX_TEXT_RUNGS,
  MAX_LIVE_RUNGS,
  SWITCHABLE_FAILURES,
  classifyFailure,
  rankTextModels,
  rankLiveModels,
};
