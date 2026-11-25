/* Pure microphone/wake-word helpers. Kept separate so they can be tested without Electron. */
const MIC_RATE = 16000;

function pcmRms(pcm) {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const value = pcm.readInt16LE(i * 2) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

function pcm16ToWav(pcm, sampleRate = MIC_RATE) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Auto-gain for quiet microphones (ported from the JARVIS reference `_boost`): peak between 50 and 12000 is lifted toward ~0.5 FS, max x12. */
function boostPcm(pcm) {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return pcm;
  let peak = 0;
  for (let i = 0; i < samples; i++) { const v = Math.abs(pcm.readInt16LE(i * 2)); if (v > peak) peak = v; }
  if (peak <= 50 || peak >= 12000) return pcm;
  const gain = Math.min(12, 16000 / peak);
  const out = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i * 2) * gain))), i * 2);
  return out;
}

function normalizeSpeech(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function isWakePhrase(text) {
  const words = normalizeSpeech(text).split(' ').filter(Boolean);
  if (words.length === 1) return words[0] === 'nexora' || words[0] === 'nexo';
  return words.length === 2 && ((words[0] === 'hey' && words[1] === 'nexora') || (words[0] === 'hey' && words[1] === 'nexo'));
}

function mergeTranscriptFragments(previous, incoming) {
  const clean = (value) => normalizeSpeech(value).split(' ').filter(Boolean);
  const a = clean(previous); const b = clean(incoming);
  if (!a.length) return b.join(' ');
  if (!b.length) return a.join(' ');
  if (b.length >= a.length && a.every((word, index) => b[index] === word)) return b.join(' ');
  let overlap = Math.min(a.length, b.length);
  while (overlap > 0 && !a.slice(-overlap).every((word, index) => word === b[index])) overlap--;
  return [...a, ...b.slice(overlap)].join(' ');
}

function isMuteCommand(text) {
  const words = normalizeSpeech(text).split(' ').filter(Boolean);
  if (!words.length || words.length > 8) return false;
  const muteWords = new Set(['mute', 'மியூட்டு', 'மியூட் பண்ணு', 'milte', 'miute', 'myute', 'miyute', 'miyut', 'mut', 'மியூட்', 'म्यूट']);
  const allowed = new Set([...muteWords, 'nexora', 'nexo', 'go', 'please', 'now', 'ok', 'okay', 'okey', 'okk', 'sari', 'sare', 'alright', 'paniten', 'pannunga', 'pannu', 'panu', 'panunga', 'pannungal', 'amaithi', 'amaidhi', 'seri', 'ippo']);
  const collapsed = words.filter((word, index) => word !== words[index - 1]);
  return collapsed.length <= 8 && collapsed.every((word) => allowed.has(word)) && collapsed.some((word) => muteWords.has(word));
}

/* ---- Wake phrase matching on a Gemini speech-to-text transcript (tolerant of accents / STT spelling) ---- */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const WAKE_LONG_ALIASES = new Set(['nexora', 'nexura', 'nexra', 'nexoura', 'nexore', 'nexorah', 'neksora', 'nexsora', 'nexcora', 'nexxora', 'nekzora', 'nexara', 'nexoora', 'nexorra', 'nextora', 'necksora', 'necksor', 'nexorr', 'nexoraa', 'nexeora',
  'நெக்சோரா', 'நெக்ஸோரா', 'நெக்சொரா', 'நெக்ஸொரா', 'நெக்சோரா', 'நெக்ஸோர', 'नेक्सोरा', 'नेक्सोर']);
const WAKE_SHORT_ALIASES = new Set(['nexo', 'nexho', 'nekso', 'neksho', 'nexoh', 'necso', 'neckso', 'நெக்சோ', 'நெக்ஸோ', 'नेक्सो']);
/** STRICT wake (v0.3.6): only "Hey Nexora", "Hey Nexo", "Nexora", "Nexo".
 *  - Just the name alone ("Nexora") wakes.
 *  - "Hey <name> ..." wakes even if a command follows in the same clip.
 *  - Anything else ("Hello Nexora", "Nextora, play the track", "next round") is ignored. */
const WAKE_HEY = new Set(['hey', 'hay', 'hei', 'hai', 'hi', 'he', 'ay', 'heyy', 'heyyy', 'ஹே', 'ஹேய்', 'ஹை', 'हे', 'हेय']);
/** v0.3.13: consonant skeleton ("nexora" / "neksora" / "nex ora" / "nexorah" -> "nxr"; "nexo" / "nekso" -> "nx") so any accent spelling of the
 *  name matches without a hand-written alias list. Real words ("next", "nexus", "necessary", "nectar") give a different skeleton. */
function wakeSkeleton(word) {
  return String(word || '').toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/cks|ks|cs|kz|ch|x/g, 'x')
    .replace(/[aeiouyhwv]/g, '')
    .replace(/(.)\1+/g, '$1');
}
function isLongWakeWord(c) {
  if (WAKE_LONG_ALIASES.has(c)) return true;
  if (!/^n[a-z]{4,9}$/.test(c)) return false;
  if (levenshtein(c, 'nexora') <= 2 && /(x|ks|cs|kz)/.test(c)) return true;
  return /^n[ei]/.test(c) && wakeSkeleton(c) === 'nxr' && /(x|ks|cs|kz|ch)/.test(c);
}
function isShortWakeWord(c) {
  if (WAKE_SHORT_ALIASES.has(c)) return true;
  return /^n[ei][a-z]{2,4}$/.test(c) && wakeSkeleton(c) === 'nx' && /(x|ks|cs|kz)/.test(c) && levenshtein(c, 'nexo') <= 2;
}
/** v0.3.13b: Gemini Live sometimes writes the name in Devanagari/Tamil ("हेनिक्सवर", "நெக்சோரா"): transliterate to Latin so the matcher can still hear it. */
const DEV = { 'अ':'a','आ':'a','इ':'i','ई':'i','उ':'u','ऊ':'u','ए':'e','ऐ':'e','ओ':'o','औ':'o','ा':'a','ि':'i','ी':'i','ु':'u','ू':'u','े':'e','ै':'e','ो':'o','ौ':'o','ं':'n','ँ':'n',
  'क':'k','ख':'k','ग':'g','घ':'g','च':'ch','छ':'ch','ज':'j','झ':'j','ट':'t','ठ':'t','ड':'d','ढ':'d','त':'t','थ':'t','द':'d','ध':'d','न':'n','ण':'n','प':'p','फ':'f','ब':'b','भ':'b','म':'m','य':'y','र':'r','ल':'l','व':'v','श':'s','ष':'s','स':'s','ह':'h','क्ष':'x','्':'' };
const TAM = { 'அ':'a','ஆ':'a','இ':'i','ஈ':'i','உ':'u','ஊ':'u','எ':'e','ஏ':'e','ஐ':'e','ஒ':'o','ஓ':'o','ஔ':'o','ா':'a','ி':'i','ீ':'i','ு':'u','ூ':'u','ெ':'e','ே':'e','ை':'e','ொ':'o','ோ':'o','ௌ':'o',
  'க':'k','ங':'n','ச':'s','ஜ':'j','ஞ':'n','ட':'t','ண':'n','த':'t','ந':'n','ன':'n','ப':'p','ம':'m','ய':'y','ர':'r','ற':'r','ல':'l','ள':'l','ழ':'l','வ':'v','ஷ':'s','ஸ':'s','ஹ':'h','்':'' };
function latinizeIndic(text) {
  const str = String(text || '').replace(/க்ஷ|क्ष/g, 'x');
  if (!/[\u0900-\u097F\u0B80-\u0BFF]/.test(str)) return str;
  let out = '';
  for (const ch of str) out += DEV[ch] !== undefined ? DEV[ch] : TAM[ch] !== undefined ? TAM[ch] : ch;
  return out;
}

function matchWakePhrase(text) {
  const words = normalizeSpeech(latinizeIndic(text)).split(' ').filter(Boolean);
  const result = { matched: false, word: null, index: -1, transcript: words.join(' ') };
  if (!words.length || words.length > 14) return result;
  // "hey" / "hi" / "ok" style openers are all fine: STT often writes "hay", "he", "a", "hey," for the first syllable.
  if (words.length && !WAKE_HEY.has(words[0])) {
    const m = /^(hey|hay|he|hai)(n[a-z]{3,9})$/.exec(words[0]);
    if (m && (isLongWakeWord(m[2]) || isShortWakeWord(m[2]))) words.splice(0, 1, 'hey', m[2]);
  }
  const hey = WAKE_HEY.has(words[0]);
  const starts = hey ? [1] : [0];
  for (const start of starts) {
    for (let span = 1; span <= 3 && start + span <= words.length; span++) {
      const c = words.slice(start, start + span).join('');
      const ok = isLongWakeWord(c) || isShortWakeWord(c);
      if (!ok) continue;
      const rest = words.length - (start + span);
      if (hey || rest === 0) return { matched: true, word: c, index: start, transcript: words.join(' '), command: words.slice(start + span).join(' ') };   // command = what was said after the wake word ("hey nexora open chrome" -> "open chrome")
    }
  }
  return result;
}

/**
 * Cuts the always-on microphone stream into short speech clips for Gemini speech-to-text.
 * - Adaptive noise floor (quiet microphones / noisy rooms both work).
 * - 450 ms hang-over so "Hey … Nexora" stays ONE clip instead of two fragments.
 * - If a clip is still being transcribed, the newest clip waits (it is no longer dropped).
 */
class WakeClipDetector {
  constructor(onClip) {
    this.onClip = onClip;
    this.noise = 0.006;
    this.sentAt = [];
    this.busy = false;
    this.pending = null;
    this.resetBuffer();
  }
  threshold() { return Math.max(0.010, Math.min(0.06, this.noise * 3)); }   // v0.3.11: floor 0.015 -> 0.010 so quiet microphones are heard
  resetBuffer() {
    this.preRoll = []; this.preRollMs = 0; this.buffer = [];
    this.speaking = false; this.totalMs = 0; this.loudMs = 0; this.silentMs = 0;
  }
  reset() { this.resetBuffer(); this.pending = null; }
  feed(pcm) {
    if (!Buffer.isBuffer(pcm) || pcm.length < 2) return;
    const duration = (pcm.length / 2 / MIC_RATE) * 1000;
    const rms = pcmRms(pcm);
    const threshold = this.threshold();
    const loud = rms >= threshold;
    if (!this.speaking) {
      if (!loud) {
        this.noise += (rms - this.noise) * 0.04; // learn the room's noise floor while nobody speaks
        this.preRoll.push({ pcm, ms: duration }); this.preRollMs += duration;
        while (this.preRollMs > 550 && this.preRoll.length > 1) this.preRollMs -= this.preRoll.shift().ms;
        return;
      }
      this.speaking = true;
      this.buffer = this.preRoll.map((entry) => entry.pcm);
      this.totalMs = this.preRollMs; this.loudMs = 0; this.silentMs = 0;
      this.preRoll = []; this.preRollMs = 0;
    }
    this.buffer.push(pcm); this.totalMs += duration;
    if (loud) { this.loudMs += duration; this.silentMs = 0; } else this.silentMs += duration;
    if (this.silentMs >= 450 || this.totalMs >= 4000) this.finish();
  }
  finish() {
    const clip = Buffer.concat(this.buffer);
    const enough = this.loudMs >= 120;
    const endedAt = Date.now();
    this.resetBuffer();
    if (!enough) return;
    if (this.busy) { this.pending = { clip, endedAt }; return; }
    this.dispatch(clip, endedAt);
  }
  dispatch(clip, endedAt = Date.now()) {
    const now = Date.now();
    this.sentAt = this.sentAt.filter((stamp) => now - stamp < 60000);
    if (this.sentAt.length >= 30) return;
    this.sentAt.push(now);
    this.busy = true;
    Promise.resolve(this.onClip(clip, { endedAt })).catch(() => {}).finally(() => {
      this.busy = false;
      const next = this.pending; this.pending = null;
      if (next) this.dispatch(next.clip, next.endedAt);
    });
  }
}


/** v0.3.15: pull the transcript out of Gemini's answer even when the JSON was cut off ("{\n  \"transcript\"" used to be treated as speech).
 *  -> { transcript, wake } ; a half-written JSON object with no text yet gives transcript ''. */
function extractTranscript(raw) {
  const text = String(raw || '').replace(/^```(?:json)?|```$/gim, '').trim();
  if (!text) return { transcript: '', wake: null };
  try { const j = JSON.parse(text); if (j && typeof j === 'object') return { transcript: typeof j.transcript === 'string' ? j.transcript : '', wake: typeof j.wake === 'boolean' ? j.wake : null }; } catch { /* maybe cut off */ }
  if (/^[\[{]/.test(text) || /"transcript"\s*:/.test(text)) {
    const m = /"transcript"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    let t = m ? m[1] : ''; try { t = JSON.parse(`"${t.replace(/\\$/, '')}"`); } catch { /* keep as is */ }
    const w = /"wake"\s*:\s*(true|false)/.exec(text);
    return { transcript: t.trim(), wake: w ? w[1] === 'true' : null };
  }
  return { transcript: text, wake: null };   // plain-text answer
}

/** v0.3.15: a clipped "Hey Nexo" often arrives as "enexo", "anexo", "plexo", "nexa". One of these alone is NOT enough to wake
 *  (too many false alarms), but the caller wakes on TWO within a few seconds. Real words like "next", "nexus", "alexa", "flex" are not near-misses. */
function isWakeNearMiss(text) {
  const words = normalizeSpeech(latinizeIndic(text)).split(' ').filter(Boolean);
  if (!words.length || words.length > 2) return false;
  if (matchWakePhrase(text).matched) return false;
  return words.some((w) => {
    if (!/^[a-z]{4,8}$/.test(w) || !/ex(?:o|ora)[hn]?$/.test(w)) return false;   // must END like "…exo" / "…exora" (so "extra", "alexa", "next" never count)
    if (/^(alexa|alexis|texas|flexor|annexe|sexta|vexa)$/.test(w)) return false;
    return levenshtein(w, 'nexo') <= 2 || levenshtein(w, 'nexora') <= 3;
  });
}

module.exports = { extractTranscript, isWakeNearMiss, latinizeIndic, wakeSkeleton, WakeClipDetector, boostPcm, pcmRms, pcm16ToWav, isMuteCommand, isWakePhrase, matchWakePhrase, levenshtein, mergeTranscriptFragments };
