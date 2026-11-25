/* NEXORA — memory recall ranking (v0.4.0). Offline, no model calls.
 * BM25 over words + fuzzy character-trigram matching (typos, Tanglish spellings) + a small English/Tanglish synonym map.
 * This is lexical-plus-fuzzy recall, NOT neural embeddings: it will not match concepts that share no words or synonyms. */

const SYNONYM_GROUPS = [
  ['study', 'studies', 'studied', 'college', 'university', 'school', 'education', 'degree', 'course', 'class', 'student', 'padi', 'padikkira', 'padippu', 'kalloori'],
  ['work', 'job', 'company', 'office', 'employer', 'career', 'profession', 'role', 'velai'],
  ['live', 'lives', 'home', 'city', 'town', 'address', 'location', 'place', 'village', 'native', 'ooru', 'veedu'],
  ['name', 'called', 'peyar', 'peru'],
  ['age', 'old', 'born', 'birthday', 'dob', 'vayasu', 'vayathu'],
  ['food', 'eat', 'dish', 'meal', 'breakfast', 'lunch', 'dinner', 'snack', 'saapadu', 'biryani'],
  ['drink', 'coffee', 'tea', 'juice', 'beverage'],
  ['family', 'father', 'mother', 'dad', 'mom', 'parent', 'brother', 'sister', 'wife', 'husband', 'appa', 'amma', 'anna', 'thambi', 'akka', 'thangai'],
  ['hobby', 'hobbies', 'interest', 'enjoy', 'love', 'like', 'favourite', 'favorite', 'pastime'],
  ['project', 'build', 'building', 'app', 'software', 'code', 'coding', 'program'],
  ['music', 'song', 'singer', 'band', 'playlist', 'listen'],
  ['movie', 'film', 'cinema', 'show', 'series', 'anime', 'watch'],
  ['phone', 'mobile', 'laptop', 'computer', 'device', 'pc'],
];

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) for (const word of group) SYNONYMS.set(word, group);

function trigrams(word) {
  const padded = `^${word}$`; const set = new Set();
  for (let i = 0; i <= padded.length - 3; i++) set.add(padded.slice(i, i + 3));
  return set;
}
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0; for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * @param {string} query
 * @param {Array<{id:string,text:string,updatedAt?:number}>} items
 * @param {{tokenize:(s:string)=>string[], toLatin?:(s:string)=>string, now?:number}} opts
 * @returns {Array<{item:object, score:number}>} best first, only items with a real match
 */
function rank(query, items, { tokenize, toLatin = (s) => s, now = Date.now() } = {}) {
  if (!Array.isArray(items) || !items.length || typeof tokenize !== 'function') return [];
  const expand = (text) => { const base = tokenize(text); const latin = toLatin(text); return latin && latin !== text ? [...new Set([...base, ...tokenize(latin)])] : base; };
  const qTerms = expand(query);
  if (!qTerms.length) return [];

  const docs = items.map((item) => ({ item, tokens: expand(item.text) }));
  const N = docs.length;
  const avg = docs.reduce((n, d) => n + d.tokens.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));

  // query term -> weight (synonyms count less than what the user actually said)
  const weights = new Map(qTerms.map((t) => [t, 1]));
  for (const t of qTerms) for (const s of SYNONYMS.get(t) || []) if (!weights.has(s)) weights.set(s, 0.6);

  const grams = new Map();
  const gramsOf = (w) => { if (!grams.has(w)) grams.set(w, trigrams(w)); return grams.get(w); };
  const k1 = 1.2, b = 0.75;
  const out = [];
  for (const d of docs) {
    const tf = new Map(); for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const len = d.tokens.length || 1;
    let score = 0;
    for (const [term, weight] of weights) {
      let f = tf.get(term) || 0;
      let fuzz = 1;
      if (!f && term.length >= 4) {
        // typo / spelling variant: best trigram overlap with any word in the note
        let best = 0; const g = gramsOf(term);
        for (const token of tf.keys()) { if (token.length < 3) continue; const s = dice(g, gramsOf(token)); if (s > best) best = s; }
        if (best >= 0.6) { f = 1; fuzz = best * 0.8; }
      }
      if (!f) continue;
      score += weight * fuzz * idf(term) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avg)));
    }
    if (score <= 0) continue;
    const ageDays = Math.max(0, (now - (d.item.updatedAt || now)) / 86400000);
    score += 0.05 / (1 + ageDays / 30); // gentle tie-breaker toward fresher notes
    out.push({ item: d.item, score });
  }
  return out.sort((x, y) => y.score - x.score || (y.item.updatedAt || 0) - (x.item.updatedAt || 0));
}

module.exports = { rank, SYNONYM_GROUPS };
