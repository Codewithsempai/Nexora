/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — language-independent memory / reminder understanding with Gemini.
 * The regex helpers in memory-learner.js catch the common English phrases instantly and offline.
 * Everything else (Tamil script, Tanglish, Hindi, "my college is…", family names, any wording) goes through this
 * small JSON-only Gemini call, the same idea as the `remember` tool in the Nexora_until_done reference.
 * No Electron dependency, so it is unit-testable with a fake fetch. Never throws. */
const { tamilToLatin } = require('./memory-learner');
const health = require('./model-health');
const EXTRACT_MODELS = ['gemini-2.5-flash'];   // v0.3.12: the chat model; no hard-coded flash-lite (404 on some keys)
const CATEGORIES = ['personal', 'preferences', 'knowledge', 'projects', 'conversations'];
const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const KEY_RE = /^(?:name|age|birthday|location|work|edu:[a-z ]{2,20}|rel:[a-z ]{2,20}|fav:[\p{L} ]{2,30})$/u;
const QUESTION_WORD = /^(?:\s*(?:என்ன\S*|என்னன்னு|யார\S*|எது\S*|enna\S*|ena|yaar\S*|yaaru|what|who|which|name|peru|peyar|unknown|none|null)\s*)+$/i;
const SENSITIVE = /\b(?:password|passcode|otp|pin|cvv|card number|aadhaar|aadhar|ssn|secret key|api key)\b/i;

const SYSTEM = `You extract things a user wants an assistant to remember, from ONE message (English, Tamil, Tanglish, Hindi or mixed).
Return ONLY JSON: {"facts":[{"category":"personal|preferences|knowledge|projects|conversations","key":"...or null","value":"...or null","text":"..."}],"forget":["..."],"reminder":null}
Rules:
- Only statements the user makes about THEMSELVES or asks you to remember/forget. Questions ("what is my name?"), commands and small talk give {"facts":[],"forget":[],"reminder":null}.
- category (choose the BEST one for each fact):
  "personal" = identity: name, age, birthday, city, job, college/school/company, family and friends' names.
  "preferences" = likes, dislikes, favourites, habits, how the user wants NEXORA to talk or behave (e.g. "The user likes filter coffee", "The user prefers short answers").
  "knowledge" = any other fact or note to keep (e.g. "The user's exam is on 5 December", "The wifi router is in the hall", anything after "remember that ...").
  "projects" = what the user is building, studying for, or working on: apps, code, assignments, goals (e.g. "The user is building a desktop AI assistant called NEXORA", "The user is preparing for the semester exam").
  "conversations" = only a notable decision or topic from this chat that will matter later (e.g. "The user decided to use Electron for NEXORA"). Use rarely.
- key for personal facts: name | age | birthday | location | work | edu:college | edu:school | edu:university | edu:company | rel:father | rel:mother | rel:brother | rel:sister | rel:wife | rel:husband | rel:friend. Use null otherwise. A favourite thing: "fav:<topic>".
- text: one short sentence in third person, ALWAYS IN ENGLISH, even when the user spoke Tamil, Tanglish or Hindi, e.g. \"The user's name is Daya\", \"The user's father is Ravi\", \"The user's college is SRM University\". Write every name in English (Latin) letters, transliterated from Tamil script if needed (தயா -> Daya, ரவி -> Ravi). Never use Tamil script in text or value.
- value: only the value itself, as the user said it (e.g. "டயா", "Ravi", "SRM University", "21"); null if there is no single value.
- "forget": short phrases of what to delete when the user says forget/delete/remove something.
- "reminder": only when the user asks to be reminded AND gives a clear time: {"text":"short task","due":"YYYY-MM-DDTHH:mm" (local time, computed from the current local time you are given),"repeat":"none|daily|weekdays|weekly|monthly"}. Otherwise null.
- Never store passwords, OTPs, PINs, card or ID numbers.`;

/** Cheap pre-filter so ordinary questions/commands do not cost an API call. */
function shouldExtract(text) {
  const t = String(text || '').trim();
  if (t.length < 3 || t.length > 600) return false;
  if (/[^\u0000-ɏ]/.test(t)) return true; // Tamil / Hindi / other scripts: let the model decide
  if (/\b(?:project|building|developing|working on|studying|learning|preparing|exam|assignment|homework|goal|plan|decided|deadline|startup|app|website)\b/i.test(t) && !/\?\s*$/.test(t)) return true;
  if (/\b(?:my|i|i'm|im|i am|me|mine|remember|forget|remind|en|enoda|ennoda|naan|nan)\b/i.test(t)) return !/^(?:what|who|when|where|how|why|which|is|are|do|does|did|can|could|will|would|tell me|show|open|play)\b[^.!]*\?$/i.test(t);
  return false;
}

function cleanFacts(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f.text !== 'string') continue;
    let text = f.text.replace(/\s+/g, ' ').trim();
    const rawKey = typeof f.key === 'string' ? f.key.toLowerCase().trim() : '';
    // safety net: memory is always English letters (a Tamil-script name becomes "The user's name is Daya")
    if (/[\u0B80-\u0BFF]/.test(text) && rawKey === 'name' && typeof f.value === 'string' && f.value.trim()) text = `The user's name is ${tamilToLatin(f.value.trim())}`;
    else text = tamilToLatin(text);
    if (text.length < 4 || text.length > 300 || SENSITIVE.test(text)) continue;
    // a QUESTION word is never a name ("என்னோட பேர் என்ன?" must not save "The user's name is Enna")
    if (rawKey === 'name' && QUESTION_WORD.test(String(f.value || '').trim() + ' ' + text.replace(/^The user's name is\s+/i, ''))) continue;
    const category = CATEGORIES.includes(f.category) ? f.category : 'knowledge';
    const key = typeof f.key === 'string' && KEY_RE.test(f.key.toLowerCase().trim()) ? f.key.toLowerCase().trim() : undefined;
    const value = typeof f.value === 'string' && f.value.trim() && f.value.length <= 120 && !SENSITIVE.test(f.value) ? tamilToLatin(f.value.trim()) : undefined;
    out.push({ category: key && !key.startsWith('fav:') ? 'personal' : category, key, value, text });
    if (out.length >= 6) break;
  }
  return out;
}

function parseReply(raw) {
  let data;
  try { data = JSON.parse(String(raw || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const forget = (Array.isArray(data.forget) ? data.forget : []).filter((x) => typeof x === 'string' && x.trim().length >= 2).map((x) => x.trim().slice(0, 120)).slice(0, 3);
  let reminder = null;
  const r = data.reminder;
  if (r && typeof r.text === 'string' && typeof r.due === 'string') {
    const dueAt = new Date(r.due).getTime();
    if (Number.isFinite(dueAt) && r.text.trim()) reminder = { text: r.text.trim().slice(0, 300), dueAt, repeat: REPEATS.includes(r.repeat) ? r.repeat : 'none' };
  }
  return { facts: cleanFacts(data.facts), forget, reminder };
}

async function extractWithGemini({ apiKey, text, now = Date.now(), fetchImpl = globalThis.fetch, timeoutMs = 10000, models = EXTRACT_MODELS } = {}) {
  if (!models || !models.length) models = EXTRACT_MODELS;
  if (!apiKey || !shouldExtract(text) || typeof fetchImpl !== 'function') return null;
  const local = new Date(now); const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())} (${local.toLocaleDateString('en', { weekday: 'long' })})`;
  const body = {
    systemInstruction: { parts: [{ text: `${SYSTEM}\nCurrent local time: ${stamp}` }] },
    contents: [{ role: 'user', parts: [{ text: String(text).slice(0, 600) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 500, responseMimeType: 'application/json' },
  };
  const deadline = Date.now() + timeoutMs;
  for (const model of health.usable(models)) {
    const left = deadline - Date.now(); if (left < 400) break;
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(left, 5500)),
      });
      if (!response.ok) { console.warn(`[NEXORA Memory] ${model} -> HTTP ${response.status}, trying next model`); health.report(model, response.status); continue; }
      const payload = await response.json();
      const parsed = parseReply(payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join(''));
      if (parsed) return parsed;
    } catch (error) { console.warn(`[NEXORA Memory] ${model} failed: ${error.message}`); health.report(model, error); }
  }
  return null;
}

/** Models for memory understanding: the same ladder the chat uses (so it never depends on a hard-coded name Google retired), fast "lite" models first. */
async function pickExtractModels(modelDirectory, apiKey, selected) {
  try {
    // v0.3.12: the user's chat model first (it is known to work), then the rest of the ladder. Never re-sorted to "lite first".
    const ladder = await modelDirectory.textOrder(apiKey, selected);
    return ladder.slice(0, 2);
  } catch { return EXTRACT_MODELS; }
}

module.exports = { cleanFacts, pickExtractModels, extractWithGemini, shouldExtract, parseReply, EXTRACT_MODELS };
