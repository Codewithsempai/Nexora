/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — automatic memory from what the user says ("remember that…", "my name is…", "forget…").
 * Pure helpers (no Electron) so they work for typed chat AND spoken Live transcripts and can be unit tested. */
const END = String.raw`(?=$|[,.!;?]|\s+(?:and|but|so|because|please|ok|okay)\b)`;
const MAX_PER_MESSAGE = 3;

function thirdPerson(text) {
  let out = String(text || '').trim()
    .replace(/\bI['’]m\b/gi, 'the user is').replace(/\bI am\b/gi, 'the user is')
    .replace(/\bI['’]ve\b/gi, 'the user has').replace(/\bI have\b/gi, 'the user has')
    .replace(/\bI['’]ll\b/gi, 'the user will').replace(/\bI['’]d\b/gi, 'the user would')
    .replace(/\bmy\b/gi, "the user's").replace(/\bmine\b/gi, "the user's")
    .replace(/\bme\b/gi, 'the user').replace(/\bI\b/g, 'the user');
  out = out.replace(/\s+/g, ' ').replace(/[.!\s]+$/g, '');
  return out ? out[0].toUpperCase() + out.slice(1) : out;
}
/** Tamil script -> English letters (rough, for names). Used so memory is always saved in English. */
const TA_V = { 'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ee', 'உ': 'u', 'ஊ': 'oo', 'எ': 'e', 'ஏ': 'ae', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'o', 'ஔ': 'au' };
const TA_S = { 'ா': 'aa', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo', 'ெ': 'e', 'ே': 'ae', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au' };
const TA_C = { 'க': 'k', 'ங': 'ng', 'ச': 's', 'ஞ': 'nj', 'ட': 't', 'ண': 'n', 'த': 'th', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r', 'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l', 'ற': 'r', 'ன': 'n', 'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h' };
function tamilToLatin(input) {
  const str = String(input || ''); if (!/[\u0B80-\u0BFF]/.test(str)) return str;
  let out = '';
  const chars = [...str];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]; const next = chars[i + 1];
    if (TA_C[ch] !== undefined) {
      out += TA_C[ch];
      if (next === '்') i += 1; else if (TA_S[next]) { out += TA_S[next]; i += 1; } else out += 'a';
    } else if (TA_V[ch]) out += TA_V[ch]; else if (ch === 'ஃ') out += 'h'; else out += ch;
  }
  out = out.replace(/^th(?=[aeiou])/i, 'D').replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/aa$/, 'a');
  return out.replace(/\s+/g, ' ');
}
const decap = (t) => String(t).replace(/^([A-Z])(?![A-Z])/, (c) => c.toLowerCase());
const clean = (value) => String(value || '').replace(/\s+/g, ' ').replace(/^[\s,:-]+|[\s,.!:;-]+$/g, '').trim();
const TAMIL_QUESTION = /(?:என்ன(?!\p{M})|என்னன்னு|தெரியுமா|இருக்கா|இருக்கிறதா|சொல்லு|சொல்லுங்க|யார்)/u;
const NOT_A_NAME = /^(?:tired|fine|good|great|well|okay|ok|sure|sorry|happy|sad|busy|ready|here|back|hungry|late|free|new|not|so|very|going|trying|just|also|still|angry|bored|sick|done|alone|online|offline|home|nexora|nexo|ai|a|an|the|enna|ena|yaar|yaaru|what|who)$/i;
const BAD_OBJECT = /^(?:it|that|this|you|them|him|her|one|so|when|how|what)\b/i;

function splitSentences(text) {
  return String(text || '').replace(/^(?:hey|hi|ok|okay)?\s*nexora[\s,:-]+/i, '').split(/(?<=[.!?\n])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

/** Facts found in one message: [{ category, text, key? }] */
function extractMemories(input) {
  const found = [];
  const push = (entry) => { if (entry.text && entry.text.length >= 4 && entry.text.length <= 400 && !found.some((f) => f.text.toLowerCase() === entry.text.toLowerCase())) found.push(entry); };
  for (const sentence of splitSentences(input)) {
    if (sentence.length > 320 || /\?\s*$/.test(sentence)) continue;
    let m;
    if ((m = sentence.match(/(?:\bmy name is|\bmy name['’]s|\bcall me|\byou can call me)\s+(\p{L}[\p{L}\p{M}'’. -]{0,40}?)(?=$|[,.!;?]|\s+(?:and|but|i|so|please)\b)/iu))) {
      push({ category: 'personal', key: 'name', value: clean(m[1]), text: `The user's name is ${clean(m[1])}` }); continue;
    }
    // Tamil script: "என்னோட பெயர் டயா" / "என் பேரு டயா" (statements only; "…என்னன்னு தெரியுமா?" is a question)
    if (!TAMIL_QUESTION.test(sentence) && (m = sentence.match(/(?:என்னோட|என்|எனது)\s*(?:பெயர்|பேர்|பேரு|பெயரு)\s+([\p{L}\p{M}]{2,24}?)(?:ன்னு|னு|ஆகும்|ஆகும்)?(?=$|[\s,.!;])/u))) {
      push({ category: 'personal', key: 'name', value: tamilToLatin(clean(m[1])), text: `The user's name is ${tamilToLatin(clean(m[1]))}` }); continue;
    }
    // Family: "my father's name is Ravi", "my dad is Ravi", "my mother name is Lakshmi"
    if ((m = sentence.match(/\bmy\s+(father|dad|mother|mom|mum|brother|sister|wife|husband|son|daughter|best friend|friend)(?:['’]s)?(?:\s+name)?\s+(?:is|was|called|named)\s+(\p{L}[\p{L}\p{M}'’. -]{1,40}?)(?=$|[,.!;?]|\s+(?:and|but|so|he|she|who|works?)\b)/iu))) {
      const rel = { dad: 'father', mom: 'mother', mum: 'mother' }[m[1].toLowerCase()] || m[1].toLowerCase();
      push({ category: 'personal', key: `rel:${rel}`, value: clean(m[2]), text: `The user's ${rel} is ${clean(m[2])}` }); continue;
    }
    // College / school / university / company
    if ((m = sentence.match(new RegExp(String.raw`\bmy\s+(college|school|university|company|office)(?:\s+name)?\s+(?:is|was|called)\s+(.{2,80}?)` + END, 'i')))) {
      push({ category: 'personal', key: `edu:${m[1].toLowerCase()}`, value: clean(m[2]), text: `The user's ${m[1].toLowerCase()} is ${clean(m[2])}` }); continue;
    }
    if ((m = sentence.match(new RegExp(String.raw`\bi\s+(?:study|studied|am studying|['’]m studying|go|went)\s+(?:to|at|in)\s+(?!school\b|college\b)(.{2,80}?)` + END, 'i')))) {
      push({ category: 'personal', key: 'edu:college', value: clean(m[1]), text: `The user studies at ${clean(m[1])}` }); continue;
    }
    // Age in Tanglish / Tamil: "ennoda age 20", "en vayasu 20", "என்னோட ஏஜ் 20", "என் வயசு 20", "naan 20 vayasu"
    if ((m = sentence.match(/(?:\b(?:my age|en age|ennoda age|en vayasu|ennoda vayasu|en vayathu)|என்னோட\s*(?:ஏஜ்|வயசு|வயது)|என்\s*(?:ஏஜ்|வயசு|வயது)|எனக்கு\s*வயசு)\s*(?:is|:|=|-)?\s*(\d{1,3})\b/iu)) || (m = sentence.match(/\b(?:naan|nan|enakku)\s+(\d{1,2})\s*(?:vayasu|vayathu|years?)\b/i))) {
      push({ category: 'personal', key: 'age', value: m[1], text: `The user is ${m[1]} years old` }); continue;
    }
    if ((m = sentence.match(/\bi(?:\s+am|['’]m)\s+(\d{1,2})\s*(?:years?|yrs?)\s*old\b/i)) || (m = sentence.match(/\bmy age is\s+(\d{1,2})\b/i))) {
      push({ category: 'personal', key: 'age', value: m[1], text: `The user is ${m[1]} years old` }); continue;
    }
    if ((m = sentence.match(new RegExp(String.raw`\bmy\s+(?:birthday|birth ?date|dob|date of birth)\s+(?:is|was|on)\s+(.{3,40}?)` + END, 'i')))) {
      push({ category: 'personal', key: 'birthday', value: clean(m[1]), text: `The user's birthday is ${clean(m[1])}` }); continue;
    }
    // "I am Daya" / "I'm Daya" / "this is Daya" / Tamil "en peru Daya" (capitalised single name, not a mood or state)
    if ((m = sentence.match(/(?:^|[,;]\s*|\b(?:[Hh]i|[Hh]ello|[Hh]ey|[Nn]exora)\b[\s,]*)(?:[Ii] am|[Ii]['’]m|[Tt]his is|[Ii]t['’]s me|[Nn]aan|[Nn]an)\s+(\p{Lu}[\p{L}\p{M}'’-]{1,24})(?=$|[,.!;?]|\s+(?:and|here|from|please)\b)/u)) && !NOT_A_NAME.test(m[1])) {
      push({ category: 'personal', key: 'name', value: clean(m[1]), text: `The user's name is ${clean(m[1])}` }); continue;
    }
    if ((m = sentence.match(/\b(?:en peru|en peyar|ennoda peru|ennoda peyar|என் பெயர்|என் பேரு|என்னோட பேரு)\s+(\p{L}[\p{L}\p{M}'’-]{1,24})/iu))) {
      push({ category: 'personal', key: 'name', value: clean(m[1]), text: `The user's name is ${clean(m[1])}` }); continue;
    }
    if ((m = sentence.match(new RegExp(String.raw`\bi (?:live|stay|am living|am staying|['’]m living|['’]m staying) in\s+(.{2,60}?)` + END, 'i'))) ||
        (m = sentence.match(new RegExp(String.raw`\bi(?:['’]m| am) from\s+(.{2,60}?)` + END, 'i')))) {
      push({ category: 'personal', key: 'location', value: clean(m[1]), text: `The user lives in / is from ${clean(m[1])}` }); continue;
    }
    // Projects: "my project is NEXORA", "I am building a weather app", "I'm working on my final year project"
    if ((m = sentence.match(new RegExp(String.raw`\bmy\s+(?:project|app|startup|product|website)(?:\s+name)?\s+(?:is|was|called|named)\s+(.{2,70}?)` + END, 'i')))) {
      push({ category: 'projects', text: `The user's project is ${clean(m[1])}` }); continue;
    }
    if ((m = sentence.match(new RegExp(String.raw`\bi(?:['’]m| am)\s+(?:currently\s+)?(building|making|developing|creating|working on|preparing for)\s+(.{3,80}?)` + END, 'i'))) && !BAD_OBJECT.test(clean(m[2]))) {
      push({ category: 'projects', text: `The user is ${m[1].toLowerCase()} ${decap(thirdPerson(clean(m[2]))).replace(/^The user('s)?/, (x) => x.toLowerCase())}`.replace(/\s+/g, ' ') }); continue;
    }
    if ((m = sentence.match(new RegExp(String.raw`\bi (?:work|am working|['’]m working) (?:as|at|in|for)\s+(.{2,70}?)` + END, 'i')))) {
      push({ category: 'personal', key: 'work', value: clean(m[1]), text: `The user works ${/\bas\b/i.test(m[0]) ? 'as' : /\bat\b/i.test(m[0]) ? 'at' : /\bfor\b/i.test(m[0]) ? 'for' : 'in'} ${clean(m[1])}` }); continue;
    }
    if ((m = sentence.match(new RegExp(String.raw`\bmy fav(?:ou?rite)?\s+([\p{L} ]{2,30}?)\s+(?:is|are)\s+(.{1,60}?)` + END, 'iu')))) {
      push({ category: 'preferences', key: `fav:${clean(m[1]).toLowerCase()}`, text: `The user's favourite ${clean(m[1])} is ${clean(m[2])}` }); continue;
    }
    // Explicit "remember …" (English)
    if ((m = sentence.match(/^(?:(?:please|hey)\s+)?(?:(?:can|could|will|would) you\s+(?:please\s+)?)?(?:remember|don['’]?t forget|note down|keep in mind|make a note)(?:\s+that)?[\s,:]+(.{3,300})$/i))) {
      const body = clean(m[1]);
      if (body && !/^(?:me|it|this|that)$/i.test(body)) { push({ category: 'knowledge', text: thirdPerson(body) }); continue; }
    }
    // Tamil / Tanglish: "… ninaivula vechuko"
    if (/\b(?:ninaivu?la|ninaivil|nyabagam|gnabagam)\s+(?:vachuko|vechuko|vechukko|vachukko|vai|vaichuko)\b/i.test(sentence)) {
      const body = clean(sentence.replace(/\b(?:ninaivu?la|ninaivil|nyabagam|gnabagam)\s+(?:vachuko|vechuko|vechukko|vachukko|vai|vaichuko)\b/i, ' ').replace(/\b(?:nu|nnu|endru)\b/gi, ' '));
      if (body.length >= 4) { push({ category: 'knowledge', text: thirdPerson(body) }); continue; }
    }
    if ((m = sentence.match(new RegExp(String.raw`\bi (?:really |absolutely |also )?(like|love|prefer|enjoy|hate|dislike|can['’]t stand)\s+(.{2,80}?)` + END, 'i')))) {
      const object = clean(m[2]);
      if (!BAD_OBJECT.test(object)) {
        const verb = m[1].toLowerCase().replace(/^can['’]t stand$/, 'cannot stand');
        const word = verb === 'like' ? 'likes' : verb === 'love' ? 'loves' : verb === 'prefer' ? 'prefers' : verb === 'enjoy' ? 'enjoys' : verb === 'hate' ? 'hates' : verb === 'dislike' ? 'dislikes' : 'cannot stand';
        push({ category: 'preferences', text: `The user ${word} ${decap(thirdPerson(object)).replace(/^The user('s)?/, (x) => x.toLowerCase())}`.replace(/\s+/g, ' ') });
      }
    }
    if (found.length >= MAX_PER_MESSAGE) break;
  }
  return found.slice(0, MAX_PER_MESSAGE);
}

/** "forget that …" → the phrase to forget, or null. */
function extractForget(input) {
  for (const sentence of splitSentences(input)) {
    if (/\?\s*$/.test(sentence)) continue;
    const m = sentence.match(/^(?:(?:please|hey)\s+)?(?:(?:can|could|will|would) you\s+(?:please\s+)?)?forget(?:\s+(?:about|that))?\s+(.{3,200})$/i);
    if (m) { const body = clean(m[1]); if (body && !/^(?:it|that|this|everything|all)$/i.test(body)) return body; }
  }
  return null;
}

/** Save/forget whatever the user just said. Never throws. */
function applyMemoryCommands(store, text, options = {}) {
  const outcome = { saved: [], forgotten: [] };
  try {
    if (!store || typeof text !== 'string' || !text.trim()) return outcome;
    const forget = extractForget(text);
    if (forget) { const result = store.forget(forget); if (result?.success) outcome.forgotten = result.removed || []; return outcome; }
    for (const fact of extractMemories(text)) {
      const result = store.add(fact.category, fact.text, { key: fact.key, value: fact.value, source: options.source });
      if (result?.success && !result.duplicate) outcome.saved.push(fact.text);
    }
  } catch { /* memory must never break chat */ }
  return outcome;
}

/** One-line note appended to the system prompt so the assistant naturally confirms what it just did. */
function memoryNotice(outcome) {
  const parts = [];
  if (outcome?.saved?.length) parts.push(`You just saved to the user's memory: ${outcome.saved.join('; ')}. Confirm in one short natural sentence.`);
  if (outcome?.forgotten?.length) parts.push(`You just removed from the user's memory: ${outcome.forgotten.join('; ')}. Confirm in one short natural sentence.`);
  return parts.join(' ');
}

const MEMORY_RULES = 'NEXORA\'s owner and creator is codewithsempai_daya. You have a persistent memory of the user. The "User memory" list below is the ONLY source of personal facts (name, college, family, likes): if a fact is not in that list, say you do not know it, even if an earlier chat message mentioned it (the user may have cleared their memory). ALWAYS reply in Tanglish: Tamil words written in English letters mixed naturally with simple English (example: \"Sure Daya, naan unga name-ah save pannitten\"). Never use Tamil script unless the user asks for it. Memory itself is stored in English. When the user asks "what is my name" / "en peru enna" / "என்னோட பேர் என்ன" and a Name line exists below, answer with that name right away (never say you do not know it). If the chat history shows you earlier said you did not know something, check the list again: it may have been saved since. Use the facts below naturally (their name, preferences, projects) without announcing that you are reading memory. Never invent memories; if asked about something that is not in memory, say you do not know it yet. The user can say "remember that …" to save something and "forget …" to remove it.';

const PERSONAL_LABELS = { name: 'Name', location: 'City / from', work: 'Work', age: 'Age', birthday: 'Birthday', 'edu:college': 'College', 'edu:school': 'School', 'edu:university': 'University', 'edu:company': 'Company', 'edu:office': 'Office', 'rel:father': 'Father', 'rel:mother': 'Mother', 'rel:brother': 'Brother', 'rel:sister': 'Sister', 'rel:wife': 'Wife', 'rel:husband': 'Husband', 'rel:son': 'Son', 'rel:daughter': 'Daughter', 'rel:friend': 'Friend', 'rel:best friend': 'Best friend' };

module.exports = { tamilToLatin, PERSONAL_LABELS, extractMemories, extractForget, applyMemoryCommands, memoryNotice, thirdPerson, MEMORY_RULES };
