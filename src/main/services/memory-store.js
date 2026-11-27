/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA encrypted, user-managed persistent memory vault. */
const fs = require('fs');
const { tamilToLatin } = require('./memory-learner');
const { rank: rankNotes } = require('./memory-search');
const path = require('path');
const crypto = require('crypto');
const MEMORY_CATEGORIES = ['personal', 'preferences', 'knowledge', 'projects', 'conversations'];
const MAX_ITEMS = 500;
const MAX_TEXT_LENGTH = 4000;
const CONTEXT_CHAR_BUDGET = 2200;
const STOP_WORDS = new Set(['the','and','for','you','are','was','were','what','who','whom','how','can','could','does','did','with','that','this','have','has','had','not','but','tell','about','please','nexora','nexo','hey','okay','ok','my','me','mine','your','its','his','her','our','their','is','am','it','a','an','of','to','in','on','at','do','be','by','as','or','if','so','we','he','she','they','them','from','will','would','should','there','here','when','where','why','which','any','all','some','just','like','know','remember','user','users']);

/** Unicode-aware tokenizer (works for English, Tamil and Tanglish) with a light plural stem. */
function tokenize(text) {
  const raw = String(text || '').toLowerCase().normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  const out = [];
  for (let word of raw) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    if (word.length > 3 && /^[a-z]+$/.test(word) && word.endsWith('s') && !word.endsWith('ss')) word = word.slice(0, -1);
    out.push(word);
  }
  return [...new Set(out)];
}
const normalizeText = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.!?\s]+$/g, '').trim();

class MemoryStore {
  constructor({ filePath, safeStorage, fileSystem = fs } = {}) {
    if (!filePath) throw new Error('MemoryStore requires a filePath.');
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.fs = fileSystem;
    this.onChange = null; // (event) => void — lets the UI show saves live
  }

  emitChange(event) { try { this.onChange?.(event); } catch { /* UI errors must never break the vault */ } }

  /** Memory always works. v0.3.6: the vault is ALWAYS written with the stable app key (never switches between
   *  OS-secure and app-key between runs, which used to make the old vault unreadable and wipe it). Vaults written
   *  by older versions with OS secure storage are still read and silently migrated on the next save. */
  isAvailable() { return true; }
  osSecure() { try { return !!this.safeStorage?.isEncryptionAvailable?.(); } catch { return false; } }
  storageInfo() { return { mode: 'app-key', filePath: this.filePath, backup: `${this.filePath}.bak` }; }

  fallbackKey() {
    if (this._key) return this._key;
    const keyPath = `${this.filePath}.key`;
    try { if (this.fs.existsSync(keyPath)) { const k = Buffer.from(String(this.fs.readFileSync(keyPath, 'utf8')).trim(), 'hex'); if (k.length === 32) { this._key = k; return k; } } } catch { /* regenerate below */ }
    const key = crypto.randomBytes(32);
    this.fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    // Keep the old (unreadable) key file instead of overwriting it, then write the new one durably.
    try { if (this.fs.existsSync(keyPath)) this.fs.copyFileSync(keyPath, `${keyPath}.old-${Date.now()}`); } catch { /* ignore */ }
    this.durableWrite(keyPath, key.toString('hex'));
    this._key = key;
    return key;
  }
  encode(json) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.fallbackKey(), iv);
    const body = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from('NXM1'), iv, cipher.getAuthTag(), body]);
  }
  decode(buffer) {
    if (buffer.length > 32 && buffer.subarray(0, 4).toString() === 'NXM1') {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.fallbackKey(), buffer.subarray(4, 16));
      decipher.setAuthTag(buffer.subarray(16, 32));
      return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]).toString('utf8');
    }
    if (buffer[0] === 0x7b) return buffer.toString('utf8'); // plain JSON
    return this.safeStorage.decryptString(buffer); // vault from an older version (OS secure storage)
  }

  /** Write to a temp file, flush it to the physical disk (fsync), then atomically replace the target. */
  durableWrite(target, data) {
    const tmp = `${target}.tmp`;
    const fsx = this.fs;
    if (typeof fsx.openSync === 'function' && typeof fsx.fsyncSync === 'function') {
      const fd = fsx.openSync(tmp, 'w', 0o600);
      try { fsx.writeSync(fd, Buffer.isBuffer(data) ? data : Buffer.from(String(data))); fsx.fsyncSync(fd); } finally { fsx.closeSync(fd); }
    } else fsx.writeFileSync(tmp, data, { mode: 0o600 });
    if (typeof fsx.renameSync === 'function') fsx.renameSync(tmp, target); else fsx.writeFileSync(target, data, { mode: 0o600 });
  }

  parseVault(buffer) {
    const parsed = JSON.parse(this.decode(buffer));
    const items = Array.isArray(parsed.items) ? parsed.items.filter((item) => item && MEMORY_CATEGORIES.includes(item.category) && typeof item.text === 'string') : [];
    // v0.3.6: memory is English. Older Tamil-script entries are converted to English letters when loaded.
    for (const item of items) {
      if (!/[\u0B80-\u0BFF]/.test(item.text)) continue;
      if (typeof item.value === 'string') item.value = tamilToLatin(item.value);
      item.text = item.key === 'name' && item.value ? `The user's name is ${item.value}` : tamilToLatin(item.text);
    }
    return items;
  }
  /** Read a file, retrying briefly: antivirus / sync tools can lock it for a moment and that is NOT corruption. */
  readBuffer(file) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return this.fs.readFileSync(file); } catch (error) {
        lastError = error;
        if (error.code === 'ENOENT') throw error;
        const until = Date.now() + 40 * (attempt + 1); while (Date.now() < until) { /* short sync wait */ }
      }
    }
    throw lastError;
  }

  readAll() {
    try {
      if (!this.fs.existsSync(this.filePath)) {
        // Main file missing (deleted / crash between steps): recover from the last good backup if there is one.
        const bak = `${this.filePath}.bak`;
        if (this.fs.existsSync(bak)) { try { const items = this.parseVault(this.readBuffer(bak)); this.cache = items; return { success: true, items: items.slice(-MAX_ITEMS), recovered: true }; } catch { /* fall through */ } }
        return { success: true, items: [] };
      }
      const stat = this.fs.statSync(this.filePath);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (this.cache && this.cacheStamp === stamp) return { success: true, items: this.cache.slice(-MAX_ITEMS) };
      const items = this.parseVault(this.readBuffer(this.filePath));
      this.cache = items; this.cacheStamp = stamp;
      return { success: true, items: items.slice(-MAX_ITEMS) };
    } catch (error) {
      this.lastError = error.message;
      // Transient I/O problem: never treat it as corruption and never wipe anything.
      if (error.code && error.code !== 'ENOENT' && !/auth|decrypt|JSON|Unsupported state|Unexpected/i.test(error.message)) return { success: false, error: `Memory vault is temporarily unreadable: ${error.message}` };
      // Really unreadable: try the last good backup first.
      try {
        const items = this.parseVault(this.readBuffer(`${this.filePath}.bak`));
        this.cache = items; this.cacheStamp = null;
        return { success: true, items: items.slice(-MAX_ITEMS), recovered: true };
      } catch { /* no usable backup */ }
      // Keep a COPY of the unreadable file (never delete it), then start fresh so saving is never blocked.
      try { this.fs.copyFileSync(this.filePath, `${this.filePath}.unreadable-${Date.now()}`); } catch { /* ignore */ }
      this.cache = []; this.cacheStamp = null;
      return { success: true, items: [], recovered: true };
    }
  }

  write(items) {
    try {
      this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const kept = items.slice(-MAX_ITEMS);
      const encrypted = this.encode(JSON.stringify({ version: 2, savedAt: Date.now(), items: kept }));
      // Keep the previous good vault as a backup before replacing it.
      try { if (this.fs.existsSync(this.filePath)) this.fs.copyFileSync(this.filePath, `${this.filePath}.bak`); } catch { /* backup is best-effort */ }
      this.durableWrite(this.filePath, encrypted);
      this.cache = kept;
      try { const st = this.fs.statSync(this.filePath); this.cacheStamp = `${st.mtimeMs}:${st.size}`; } catch { this.cacheStamp = null; }
      return { success: true };
    } catch (error) { return { success: false, error: `Memory vault could not be saved: ${error.message}` }; }
  }

  list(category = 'all') {
    const result = this.readAll();
    if (!result.success) return result;
    return { success: true, items: category === 'all' ? result.items : result.items.filter((item) => item.category === category) };
  }

  add(category, text, options = {}) {
    if (!MEMORY_CATEGORIES.includes(category)) return { success: false, error: 'Choose a valid memory category.' };
    if (typeof text !== 'string' || !text.trim() || text.trim().length > MAX_TEXT_LENGTH) return { success: false, error: `Memory text must contain 1–${MAX_TEXT_LENGTH} characters.` };
    const result = this.readAll();
    if (!result.success) return result;
    const now = Date.now();
    const clean = text.trim();
    const key = typeof options.key === 'string' && options.key ? options.key.slice(0, 60) : undefined;
    // Same fact again: just refresh it instead of piling up duplicates.
    const same = result.items.find((item) => normalizeText(item.text) === normalizeText(clean));
    if (same) {
      same.updatedAt = now; if (key && !same.key) same.key = key;
      if (typeof options.value === 'string' && options.value.trim()) same.value = options.value.trim().slice(0, 120);
      const saved = this.write(result.items);
      if (saved.success) this.emitChange({ type: 'touch', item: { ...same }, source: options.source || 'manual' });
      return saved.success ? { success: true, item: same, duplicate: true } : saved;
    }
    // A keyed fact (name, city, job, favourite X) replaces the older value instead of contradicting it.
    const kept = key ? result.items.filter((item) => item.key !== key) : result.items;
    const item = { id: crypto.randomUUID(), category, text: clean, createdAt: now, updatedAt: now, source: ['chat', 'voice', 'manual', 'tool'].includes(options.source) ? options.source : 'manual' };
    if (key) item.key = key;
    if (typeof options.value === 'string' && options.value.trim()) item.value = options.value.trim().slice(0, 120);
    const save = this.write([...kept, item]);
    if (save.success) this.emitChange({ type: 'add', item: { ...item }, source: item.source, replaced: result.items.length - kept.length });
    return save.success ? { success: true, item, replaced: result.items.length - kept.length } : save;
  }

  remove(id) {
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid memory id.' };
    const result = this.readAll();
    if (!result.success) return result;
    const gone = result.items.find((item) => item.id === id);
    const items = result.items.filter((item) => item.id !== id);
    if (items.length === result.items.length) return { success: false, error: 'Memory item not found.' };
    const saved = this.write(items);
    if (saved.success) this.emitChange({ type: 'remove', item: { ...gone }, source: 'manual' });
    return saved;
  }

  /** Edit the text and/or category of one memory. */
  update(id, patch = {}) {
    if (typeof id !== 'string' || !id) return { success: false, error: 'Invalid memory id.' };
    const result = this.readAll();
    if (!result.success) return result;
    const item = result.items.find((entry) => entry.id === id);
    if (!item) return { success: false, error: 'Memory item not found.' };
    const text = patch.text === undefined ? item.text : patch.text;
    const category = patch.category === undefined ? item.category : patch.category;
    if (!MEMORY_CATEGORIES.includes(category)) return { success: false, error: 'Choose a valid memory category.' };
    if (typeof text !== 'string' || !text.trim() || text.trim().length > MAX_TEXT_LENGTH) return { success: false, error: `Memory text must contain 1–${MAX_TEXT_LENGTH} characters.` };
    item.text = text.trim(); item.category = category; item.updatedAt = Date.now();
    const saved = this.write(result.items);
    if (saved.success) this.emitChange({ type: 'update', item: { ...item }, source: 'manual' });
    return saved.success ? { success: true, item } : saved;
  }

  /** Everything in the vault as a plain, portable object (the Memory panel saves it as JSON). */
  exportData() {
    const result = this.readAll();
    if (!result.success) return result;
    return { success: true, data: { format: 'nexora-memory', version: 1, exportedAt: new Date().toISOString(), items: result.items.map((item) => ({ ...item })) } };
  }

  /** Merge notes from an export. Skips duplicates, validates every note, never overwrites what is already saved. */
  importItems(data) {
    const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
    if (!incoming) return { success: false, error: 'This file is not a NEXORA memory export.' };
    const result = this.readAll();
    if (!result.success) return result;
    const items = result.items.slice();
    const seen = new Set(items.map((item) => normalizeText(item.text)));
    let added = 0; let skipped = 0; let invalid = 0;
    for (const raw of incoming) {
      const ok = raw && typeof raw === 'object' && MEMORY_CATEGORIES.includes(raw.category) && typeof raw.text === 'string' && raw.text.trim() && raw.text.trim().length <= MAX_TEXT_LENGTH;
      if (!ok) { invalid += 1; continue; }
      const text = raw.text.trim();
      if (seen.has(normalizeText(text))) { skipped += 1; continue; }
      seen.add(normalizeText(text));
      const now = Date.now();
      const item = { id: crypto.randomUUID(), category: raw.category, text, createdAt: Number(raw.createdAt) || now, updatedAt: Number(raw.updatedAt) || now, source: 'manual' };
      if (typeof raw.key === 'string' && raw.key) item.key = raw.key.slice(0, 60);
      if (typeof raw.value === 'string' && raw.value.trim()) item.value = raw.value.trim().slice(0, 120);
      items.push(item); added += 1;
    }
    if (added) { const saved = this.write(items); if (!saved.success) return saved; this.emitChange({ type: 'import', count: added, source: 'manual' }); }
    return { success: true, added, skipped, invalid };
  }

  /** Counts for the Memory panel header. */
  stats() {
    const result = this.readAll();
    if (!result.success) return result;
    const byCategory = Object.fromEntries(MEMORY_CATEGORIES.map((c) => [c, 0]));
    let latest = 0;
    for (const item of result.items) { byCategory[item.category] += 1; latest = Math.max(latest, item.updatedAt || 0); }
    return { success: true, total: result.items.length, byCategory, latestAt: latest || null, storage: this.storageInfo() };
  }

  clear(category = 'all') {
    if (category !== 'all' && !MEMORY_CATEGORIES.includes(category)) return { success: false, error: 'Invalid memory category.' };
    const result = this.readAll();
    if (!result.success) return result;
    const items = category === 'all' ? [] : result.items.filter((item) => item.category !== category);
    const saved = this.write(items);
    if (saved.success) this.emitChange({ type: 'clear', category, count: result.items.length - items.length, source: 'manual' });
    return saved;
  }

  scoreItem(item, terms) {
    if (!terms.length) return 0;
    const words = new Set(tokenize(item.text));
    const haystack = item.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (words.has(term)) score += 2;
      else if (term.length >= 4 && haystack.includes(term)) score += 1;
    }
    return score;
  }

  /** Keyword + synonym + typo-tolerant ranking (BM25). Returns items, best first. Offline. */
  lexicalRank(query, items) {
    return rankNotes(query, items, { tokenize, toLatin: tamilToLatin }).map((entry) => entry.item);
  }

  search(query, category = 'all', limit = 6) {
    if (typeof query !== 'string' || !query.trim()) return { success: true, items: [] };
    const result = this.list(category);
    if (!result.success) return result;
    const ranked = this.lexicalRank(query, result.items);
    return { success: true, items: ranked.slice(0, Math.max(1, Math.min(20, limit))) };
  }

  /** Remove memories that clearly match a "forget ..." request. Returns the removed texts. */
  forget(query) {
    const terms = tokenize(query);
    if (!terms.length) return { success: true, removed: [] };
    const result = this.readAll();
    if (!result.success) return result;
    // "forget my age / name / college / father" -> remove the fact stored under that key.
    const KEY_WORDS = { name: 'name', peru: 'name', peyar: 'name', age: 'age', vayasu: 'age', vayathu: 'age', birthday: 'birthday', dob: 'birthday', city: 'location', location: 'location', work: 'work', job: 'work', college: 'edu:college', school: 'edu:school', university: 'edu:university', company: 'edu:company', father: 'rel:father', dad: 'rel:father', mother: 'rel:mother', mom: 'rel:mother', brother: 'rel:brother', sister: 'rel:sister', wife: 'rel:wife', husband: 'rel:husband' };
    const wanted = new Set(String(query).toLowerCase().split(/[^a-z]+/).map((w) => KEY_WORDS[w]).filter(Boolean));
    if (wanted.size && terms.length <= 3) {
      const byKey = result.items.filter((item) => item.key && wanted.has(item.key));
      if (byKey.length) {
        const ids = new Set(byKey.map((item) => item.id));
        const saved = this.write(result.items.filter((item) => !ids.has(item.id)));
        if (saved.success) this.emitChange({ type: 'forget', removed: byKey.map((item) => item.text), source: 'chat' });
        return saved.success ? { success: true, removed: byKey.map((item) => item.text) } : saved;
      }
    }
    const need = Math.max(2, Math.ceil(terms.length * 2 * 0.6));
    const doomed = result.items.filter((item) => this.scoreItem(item, terms) >= Math.min(need, terms.length * 2));
    if (!doomed.length) return { success: true, removed: [] };
    const ids = new Set(doomed.map((item) => item.id));
    const saved = this.write(result.items.filter((item) => !ids.has(item.id)));
    if (saved.success) this.emitChange({ type: 'forget', removed: doomed.map((item) => item.text), source: 'chat' });
    return saved.success ? { success: true, removed: doomed.map((item) => item.text) } : saved;
  }

  /**
   * Context for the model: everything about the user (preferences, newest first) is ALWAYS included,
   * then the notes that match the question, then a few recent notes so memory is never silently empty.
   */
  buildContext(query = '', { matches = null } = {}) {
    const result = this.list('all');
    if (!result.success || !result.items.length) return '';
    const items = result.items;
    const newest = (a, b) => b.updatedAt - a.updatedAt;
    const picked = []; const seen = new Set();
    const take = (item) => { if (!seen.has(item.id)) { seen.add(item.id); picked.push(item); } };
    items.filter((item) => item.category === 'personal').sort(newest).slice(0, 20).forEach(take);
    items.filter((item) => item.category === 'preferences').sort(newest).slice(0, 12).forEach(take);
    items.filter((item) => item.category === 'projects').sort(newest).slice(0, 6).forEach(take);
    // `matches` lets the semantic layer hand in its own (meaning-based) order; otherwise keyword ranking.
    const found = Array.isArray(matches) ? matches : this.lexicalRank(query, items);
    found.slice(0, 8).forEach(take);
    items.slice().sort(newest).slice(0, 4).forEach(take);
    const lines = []; let used = 0;
    for (const item of picked) {
      const line = `- [${item.category}] ${item.text}`;
      if (used + line.length > CONTEXT_CHAR_BUDGET) break;
      lines.push(line); used += line.length + 1;
    }
    return lines.join('\n');
  }
}

module.exports = { MemoryStore, MEMORY_CATEGORIES, MAX_ITEMS, MAX_TEXT_LENGTH, tokenize };
