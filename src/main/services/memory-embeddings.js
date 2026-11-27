/* NEXORA — semantic ("by meaning") memory recall.
 * Adds neural embeddings on top of the offline keyword ranking in memory-search.js.
 *   "what do I do to relax?"  ->  "The user enjoys playing chess in the evening"   (no shared words)
 * HOW IT WORKS
 *  - Each note is turned into a 256-number vector by the Gemini embedding model (your own API key, same as chat).
 *  - Vectors are cached in an encrypted file next to the vault (<vault>.vec). Only new or edited notes are embedded.
 *  - A question is embedded once, compared with the cached vectors, and the result is fused with the keyword
 *    ranking (reciprocal rank fusion). Keyword hits always stay; meaning hits are added.
 *  - Anything goes wrong (no key, offline, quota, timeout)? Recall silently falls back to keyword ranking.
 * PRIVACY: note text and the question are sent to Google's embedding endpoint (see PRIVACY.md).
 *          Turn it off with Settings -> Memory Vault -> "Smarter recall" (config memory.semanticRecall).
 * No Electron dependency, so it is unit-testable with a fake fetch. Never throws. */
const crypto = require('crypto');

const EMBED_MODEL = 'gemini-embedding-001';
const DIMS = 256;                 // truncated output: ~256 bytes per note once quantised
const BATCH = 50;
const QUERY_TIMEOUT_MS = 3500;    // chat must never wait long for recall
const INDEX_TIMEOUT_MS = 15000;
const COOLDOWN_MS = 5 * 60 * 1000; // after a failure, stay on keyword recall for a while
const MIN_COSINE = 0.5;           // a note must be at least this similar to count as a meaning match...
const MARGIN = 0.12;              // ...and within this distance of the best match (tunable, see tests)
const RRF_K = 60;

const textHash = (text) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
function normalize(vec) {
  let sum = 0; for (const x of vec) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return Float32Array.from(vec, (x) => x / n);
}
function cosine(a, b) { let d = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) d += a[i] * b[i]; return d; }
function quantize(vec) { return Buffer.from(Int8Array.from(vec, (x) => Math.max(-127, Math.min(127, Math.round(x * 127))))).toString('base64'); }
function dequantize(b64) { const i8 = new Int8Array(Buffer.from(b64, 'base64')); return normalize(Float32Array.from(i8, (x) => x / 127)); }

/** Reciprocal-rank fusion of ordered item lists. Items found by several lists rise to the top. */
function fuse(lists, limit = 8) {
  const score = new Map(); const byId = new Map();
  for (const list of lists) list.forEach((item, rank) => { byId.set(item.id, item); score.set(item.id, (score.get(item.id) || 0) + 1 / (RRF_K + rank + 1)); });
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => byId.get(id));
}

/** Gemini batchEmbedContents. Returns an array of Float32Array (normalised) or null on any failure. */
async function embedTexts({ apiKey, texts, task, fetchImpl, timeoutMs, model = EMBED_MODEL }) {
  if (!apiKey || !Array.isArray(texts) || !texts.length) return null;
  try {
    const body = { requests: texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text: String(text).slice(0, 2000) }] }, taskType: task, outputDimensionality: DIMS })) };
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = (data.embeddings || []).map((e) => (Array.isArray(e?.values) && e.values.length ? normalize(e.values) : null));
    return out.length === texts.length && out.every(Boolean) ? out : null;
  } catch { return null; }
}

class SemanticMemory {
  /**
   * @param {object} o
   * @param {object} o.store        MemoryStore (list(), lexicalRank(), buildContext(), encode/decode, fs)
   * @param {string} o.filePath     where the encrypted vector cache lives
   * @param {function} o.getApiKey  () => string|null
   * @param {function} [o.isEnabled] () => boolean  (the Settings switch)
   * @param {function} [o.fetchImpl]
   */
  constructor({ store, filePath, getApiKey, isEnabled = () => true, fetchImpl, now = () => Date.now() } = {}) {
    this.store = store; this.filePath = filePath; this.getApiKey = getApiKey || (() => null);
    this.isEnabled = isEnabled; this.fetch = fetchImpl || ((...a) => fetch(...a)); this.now = now;
    this.vectors = new Map();   // id -> { h, v: Float32Array }
    this.loaded = false; this.syncing = null; this.timer = null; this.coolUntil = 0; this.lastError = null;
  }

  active() { return !!this.isEnabled() && !!this.getApiKey() && this.now() >= this.coolUntil; }
  fail(reason) { this.lastError = reason; this.coolUntil = this.now() + COOLDOWN_MS; }

  load() {
    if (this.loaded) return; this.loaded = true;
    try {
      const fsx = this.store.fs;
      if (!fsx.existsSync(this.filePath)) return;
      const parsed = JSON.parse(this.store.decode(fsx.readFileSync(this.filePath)));
      if (parsed?.model !== EMBED_MODEL || parsed?.dims !== DIMS) return;   // other model/size: rebuild
      for (const [id, e] of Object.entries(parsed.items || {})) if (e?.h && e?.q) this.vectors.set(id, { h: e.h, v: dequantize(e.q) });
    } catch { this.vectors.clear(); }
  }
  save() {
    try {
      const items = {}; for (const [id, e] of this.vectors) items[id] = { h: e.h, q: quantize(e.v) };
      this.store.fs.mkdirSync(require('path').dirname(this.filePath), { recursive: true });
      this.store.durableWrite(this.filePath, this.store.encode(JSON.stringify({ model: EMBED_MODEL, dims: DIMS, items })));
    } catch { /* cache is optional */ }
  }

  /** Embed notes that are new or edited, drop vectors of deleted notes. Safe to call often. */
  async sync() {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      this.load();
      const listed = this.store.list('all'); if (!listed.success) return { embedded: 0 };
      const live = new Map(listed.items.map((i) => [i.id, i]));
      let changed = false;
      for (const id of [...this.vectors.keys()]) if (!live.has(id)) { this.vectors.delete(id); changed = true; }
      let embedded = 0;
      if (this.active()) {
        const todo = listed.items.filter((i) => this.vectors.get(i.id)?.h !== textHash(i.text));
        for (let i = 0; i < todo.length; i += BATCH) {
          const chunk = todo.slice(i, i + BATCH);
          const vecs = await embedTexts({ apiKey: this.getApiKey(), texts: chunk.map((c) => c.text), task: 'RETRIEVAL_DOCUMENT', fetchImpl: this.fetch, timeoutMs: INDEX_TIMEOUT_MS });
          if (!vecs) { this.fail('Embedding request failed.'); break; }
          chunk.forEach((c, j) => this.vectors.set(c.id, { h: textHash(c.text), v: vecs[j] }));
          embedded += chunk.length; changed = true; this.lastError = null;
        }
      }
      if (changed) this.save();
      return { embedded };
    })().catch(() => ({ embedded: 0 })).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  /** Call after the vault changes: indexes in the background a moment later (many saves = one batch). */
  scheduleSync(delayMs = 1500) {
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.sync(); }, delayMs); this.timer.unref?.();
  }

  /** Forget every stored vector (the user switched "Smarter recall" off, or wants a rebuild). */
  clearCache() {
    this.vectors.clear(); this.loaded = true; this.lastError = null;
    try { if (this.store.fs.existsSync(this.filePath)) this.store.fs.unlinkSync(this.filePath); } catch { /* ignore */ }
  }

  /** Notes ranked by MEANING only (cosine). [] when unavailable. */
  async semanticRank(query, items) {
    if (!this.active() || typeof query !== 'string' || !query.trim()) return [];
    this.load();
    const [q] = (await embedTexts({ apiKey: this.getApiKey(), texts: [query], task: 'RETRIEVAL_QUERY', fetchImpl: this.fetch, timeoutMs: QUERY_TIMEOUT_MS })) || [];
    if (!q) { this.fail('Query embedding failed.'); return []; }
    const scored = [];
    for (const item of items) { const e = this.vectors.get(item.id); if (e && e.h === textHash(item.text)) scored.push({ item, score: cosine(q, e.v) }); }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]?.score ?? 0;
    return scored.filter((s) => s.score >= MIN_COSINE && s.score >= best - MARGIN).map((s) => s.item);
  }

  /** Keyword ranking + meaning ranking, fused. Falls back to keyword-only. Never throws. */
  async rank(query, category = 'all', limit = 6) {
    try {
      const listed = this.store.list(category); if (!listed.success) return listed;
      const lexical = this.store.lexicalRank(query, listed.items);
      const semantic = await this.semanticRank(query, listed.items);
      const items = semantic.length ? fuse([lexical, semantic], 20) : lexical;
      return { success: true, items: items.slice(0, Math.max(1, Math.min(20, limit))), semantic: semantic.length > 0 };
    } catch { return this.store.search(query, category, limit); }
  }

  /** The memory block that goes to the model for a typed question. */
  async buildContext(query) {
    try {
      if (!String(query || '').trim() || !this.active()) return this.store.buildContext(query);
      const r = await this.rank(query, 'all', 8);
      return this.store.buildContext(query, { matches: r.success ? r.items : null });
    } catch { return this.store.buildContext(query); }
  }

  stats() {
    this.load();
    const total = this.store.list('all').items?.length || 0;
    return { enabled: !!this.isEnabled(), hasKey: !!this.getApiKey(), indexed: this.vectors.size, total, model: EMBED_MODEL, lastError: this.lastError };
  }
}

module.exports = { SemanticMemory, embedTexts, fuse, cosine, normalize, quantize, dequantize, EMBED_MODEL, DIMS, MIN_COSINE, MARGIN };
