/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — spoken answers for watcher cards ("NEW DOWNLOAD": Extract / Show folder / Ignore, "Explain it" / Ignore…).
 * Only SHORT utterances count: filler words are stripped and what remains must be one of the known phrases, so a long
 * sentence that merely contains "extract" or "ok" never presses anything. Pure function (unit-tested). */
const FILLER = new Set(['please', 'pls', 'nexora', 'nexo', 'hey', 'it', 'the', 'this', 'that', 'file', 'zip', 'a', 'now', 'ah', 'um', 'uh', 'pannu', 'pannunga', 'pannidu', 'panni', 'pannungal', 'ippo', 'da', 'ya']);
const PHRASES = {
  extract: ['extract', 'unzip', 'extract here', 'extrac', 'extrect', 'extract pannu', 'எக்ஸ்ட்ராக்ட்'],
  yes: ['yes', 'ok', 'okay', 'okey', 'okk', 'seri', 'sari', 'sure', 'do', 'go', 'go ahead', 'yeah', 'yep', 'explain', 'allow', 'aam', 'ஆம்', 'சரி'],
  folder: ['show folder', 'open folder', 'folder', 'show in folder', 'show', 'show me', 'open', 'show the folder', 'open the folder', 'folder open', 'folder kaattu', 'kaattu'],
  no: ['ignore', 'no', 'nope', 'cancel', 'dismiss', 'skip', 'leave', 'leave it', 'later', 'not now', 'close', 'stop', 'venam', 'vendam', 'illa', 'ilai', 'வேண்டாம்', 'இல்லை'],
};
function clean(text) { return String(text || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean); }
/** text + the card's buttons [{id,label,primary}] -> button id to press, or null. */
function watcherChoice(text, buttons = []) {
  const words = clean(text); if (!words.length || words.length > 7) return null;
  const rest = words.filter((w) => !FILLER.has(w)); if (!rest.length) return null;
  const phrase = rest.join(' ');
  const ids = buttons.map((b) => b.id);
  const has = (id) => ids.includes(id);
  const kind = Object.keys(PHRASES).find((k) => PHRASES[k].includes(phrase));
  if (!kind) return null;
  if (kind === 'extract') return has('extract') ? 'extract' : null;
  if (kind === 'folder') return has('folder') ? 'folder' : null;
  if (kind === 'no') return has('no') ? 'no' : (has('deny') ? 'deny' : (has('cancel') ? 'cancel' : null));
  const primary = buttons.find((b) => b.primary); return primary ? primary.id : null;   // "yes / ok / seri" -> the main button
}
module.exports = { watcherChoice };
