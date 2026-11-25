/* ========================================================================
 * NEXORA — emotion inference for the Face orb (pure, no Electron).
 * Turns what NEXORA says (or what the user said) into a facial expression:
 *   { emotion, intensity, action?, hold }   emotion = neutral|happy|sad|angry|fear|surprise|disgust|contempt
 * Used by voice-service on captions and by the Live `set_expression` tool.
 * ======================================================================== */

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'fear', 'surprise', 'disgust', 'contempt'];
const ACTIONS = ['smile', 'grin', 'beam', 'smirk', 'sneer', 'frown', 'pout', 'grimace', 'wince', 'gasp', 'sigh', 'yawn', 'purse', 'bitelip', 'clench',
  'wink', 'blink', 'squint', 'stare', 'glare', 'glower', 'rolleyes', 'eyebrow', 'furrow', 'teary', 'deadpan', 'wrinkle', 'flare', 'blush', 'flush', 'pale', 'laugh', 'nod', 'shake'];

// word / phrase -> [emotion, weight]. English + Tanglish + a little Tamil script.
const RULES = [
  ['happy', 3, /\b(haha+|hehe+|lol|great|awesome|wonderful|amazing|love it|glad|happy|congrat\w*|nice|perfect|thank(s| you)|welcome|superb|super|semma|mass|vera level|sema|santhosham|magizhchi|romba nalla|nalla irukku|yay|woohoo|good job|well done|excellent|fantastic|brilliant|enjoy|celebrat\w*|party|fun)\b|சந்தோஷம்|மகிழ்ச்சி|சூப்பர்/i],
  ['sad', 3, /\b(sorry|sad|unfortunately|miss (you|it)|lonely|cry\w*|hurt|depress\w*|tough|hard time|bad news|lost|failed|failure|can'?t help|couldn'?t|unable to|apologi[sz]e|regret|pavam|kashtam|varutham|feel bad|disappoint\w*|pain)\b|வருத்தம்|கஷ்டம்|பாவம்/i],
  ['angry', 3, /\b(angry|furious|annoy\w*|hate|stupid|idiot|damn|shut up|stop it|unacceptable|rude|kovam|kobam|pissed|irritat\w*|how dare|enough!)\b|கோபம்/i],
  ['fear', 3, /\b(scared|afraid|danger\w*|warning|careful|risk\w*|threat|virus|malware|emergency|panic|worr(y|ied)|nervous|bayam|bhayam|payam|oh no|critical|crash\w*|urgent)\b|பயம்/i],
  ['surprise', 3, /\b(wow|whoa|really\?|seriously\?|no way|oh my|oh!|unexpected|suddenly|surpris\w*|shock\w*|incredible|unbelievable|aiyo|enna\?|appadiya|what\?!|omg)\b|அடடா|ஆச்சரியம்/i],
  ['disgust', 3, /\b(eww+|gross|disgust\w*|yuck|nasty|smell\w*|rotten|filthy|ugh|chee|sheh|vomit|revolting)\b|அருவருப்பு/i],
  ['contempt', 2, /\b(whatever|as if|obviously|pathetic|sure,? sure|yeah right|boring|meh|lame|overrated|poda|podaa|waste of)\b/i],
];
const EMOJI = [
  ['happy', /[😀😃😄😁😆😊🙂😍🥰😘🤗🎉👍❤💖✨😎]/u], ['sad', /[😢😭😞😔☹🙁💔🥺]/u], ['angry', /[😠😡🤬👿]/u],
  ['fear', /[😨😰😱😧]/u], ['surprise', /[😮😲🤯😯]/u], ['disgust', /[🤢🤮😖]/u], ['contempt', /[😒🙄😏]/u],
];
const ACTION_RULES = [
  ['laugh', /\b(haha+|hehe+|lol|lmao)\b/i], ['wink', /😉|\bwink\b/i], ['rolleyes', /🙄|\bwhatever\b|\bas if\b/i], ['smirk', /😏|\bsmirk\b|\bobviously\b/i],
  ['gasp', /\b(gasp|omg|oh no|whoa)\b/i], ['sigh', /\b(sigh|oh well|unfortunately)\b|😮‍💨/i], ['yawn', /\b(yawn|sleepy|tired|thookam)\b|🥱/i],
  ['eyebrow', /\b(hmm+|interesting|really\?|is it\?)\b/i], ['wrinkle', /\b(eww+|gross|yuck|smell\w*)\b/i], ['blush', /\b(shy|blush|thanks for the compliment|aww+)\b|😊|🥰/i],
  ['teary', /\b(cry\w*|tears|miss you)\b|😭|🥺/i], ['nod', /\b(yes|sure|okay|ok|seri|aama|correct|right)\b/i], ['shake', /\b(no|nope|never|illa|vendam)\b/i],
  ['pale', /\b(virus|malware|emergency|panic|critical)\b/i], ['deadpan', /\b(deadpan|no comment)\b/i],
];

/** Score a piece of text. Returns { emotion, intensity (0.3..1), action|null } — neutral when nothing stands out. */
function inferFace(text, { role = 'assistant' } = {}) {
  const raw = String(text || '').slice(-220);
  if (!raw.trim()) return { emotion: 'neutral', intensity: 0, action: null, hold: 0 };
  const score = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
  for (const [emotion, weight, re] of RULES) { const m = raw.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')); if (m) score[emotion] += weight * Math.min(3, m.length); }
  for (const [emotion, re] of EMOJI) if (re.test(raw)) score[emotion] += 4;
  const bangs = (raw.match(/!/g) || []).length;
  const caps = (raw.match(/\b[A-Z]{3,}\b/g) || []).length;
  if (bangs && !score.angry && !score.fear && !score.sad) score.happy += Math.min(2, bangs) * 0.8;
  if (/\?\!|\!\?/.test(raw)) score.surprise += 2;
  if (caps >= 2) { score.angry += 1; score.surprise += 1; }
  if (/\.\.\.|…/.test(raw) && !score.happy) score.sad += 0.6;
  if (role === 'user') { score.angry *= 0.5; score.happy *= 1.2; }   // the user cursing is "hurt/concern", not NEXORA being angry
  let best = 'neutral', top = 0;
  for (const e of EMOTIONS) if (score[e] > top) { top = score[e]; best = e; }
  let action = null;
  for (const [a, re] of ACTION_RULES) if (re.test(raw)) { action = a; break; }
  if (top < 1.5) {
    // a calm sentence: just a soft friendly face (small smile) when a speaking turn has no signal at all
    return { emotion: role === 'assistant' ? 'happy' : 'neutral', intensity: role === 'assistant' ? 0.22 : 0, action: action && ['nod', 'shake', 'eyebrow', 'wink', 'yawn'].includes(action) ? action : null, hold: 4000 };
  }
  if (role === 'user' && best === 'angry') { best = 'sad'; }   // reacts with empathy
  return { emotion: best, intensity: Math.max(0.35, Math.min(1, top / 7 + 0.3)), action, hold: 6500 };
}

/** Clean arguments from the Live `set_expression` tool. */
function cleanExpression(args = {}) {
  const emotion = EMOTIONS.includes(String(args.emotion || '').toLowerCase()) ? String(args.emotion).toLowerCase() : null;
  const action = ACTIONS.includes(String(args.action || '').toLowerCase()) ? String(args.action).toLowerCase() : null;
  if (!emotion && !action) return null;
  const n = Number(args.intensity);
  return { emotion: emotion || 'neutral', intensity: Number.isFinite(n) ? Math.max(0.2, Math.min(1, n)) : 0.7, action, hold: 6500 };
}

module.exports = { EMOTIONS, ACTIONS, inferFace, cleanExpression };
