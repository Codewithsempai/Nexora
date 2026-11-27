/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — one place that turns what the user typed or said into actions:
 * reminders ("remind me to … at …") first, then memory ("remember that …", "my name is …", "forget …").
 * Used by typed chat and by spoken Live transcripts. Never throws. */
const { parseReminder, formatDue } = require('./reminder-parser');
const { applyMemoryCommands, memoryNotice } = require('./memory-learner');
const { extractWithGemini } = require('./memory-extractor');

/** "check for updates", "any updates?", "is there a new version", "am I up to date", "update yourself". Short phrases only,
 *  so "remember that I check for updates on Fridays" is still a memory and a reminder is still a reminder. */
const UPDATE_CHECK_RE = /\b(?:(?:check|look|search|scan)(?:\s+\w+){0,3}?\s+(?:for\s+)?(?:an?\s+|any\s+|new\s+|the\s+)*(?:updates?|upgrades?|new\s+version)|(?:any|are\s+there(?:\s+any)?|is\s+there(?:\s+an?)?)\s+(?:new\s+|newer\s+)?(?:updates?|versions?)|(?:am\s+i|are\s+you|is\s+nexora)\s+(?:up\s*to\s*date|on\s+the\s+latest)|update\s+(?:nexora|yourself)|(?:nexora(?:'s)?|your)\s+latest\s+version)\b/i;
function isUpdateCheckCommand(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 70) return false;
  if (/^(?:remember|remind|forget|note)\b/i.test(t)) return false;
  return UPDATE_CHECK_RE.test(t);
}
const emptyOutcome = () => ({ saved: [], forgotten: [], reminders: [], reminderNeedsTime: null, reminderPast: null, updateCheck: null });

/** Ask the updater and boil the answer down to { status, version, current, error }. Never throws. */
async function runUpdateCheck(updater) {
  try {
    const st = await updater.check({ manual: true });
    const state = updater.getState?.() || st || {};
    const version = state.downloadedVersion || state.availableVersion || null;
    let status = state.status;
    if (state.updateDownloaded) status = 'downloaded';
    else if (state.updateAvailable && version) status = 'available';
    const result = { status: status || 'error', version, current: state.currentVersion || null, packaged: state.packaged !== false, error: state.error || null };
    try { updater.announce?.(result); } catch { /* the on-screen toast is a bonus */ }
    return result;
  } catch (error) { return { status: 'error', version: null, current: null, packaged: true, error: error?.message || 'Update check failed.' }; }
}

function applyAssistantCommands({ memoryStore, reminderService, text, source = 'chat', now = Date.now() } = {}) {
  const outcome = emptyOutcome();
  try {
    if (typeof text !== 'string' || !text.trim()) return outcome;
    if (reminderService) {
      const parsed = parseReminder(text, now);
      if (parsed?.ok) {
        const result = reminderService.add({ text: parsed.text, dueAt: parsed.dueAt, repeat: parsed.repeat, source });
        if (result?.success) outcome.reminders.push({ ...result.item, when: formatDue(result.item.dueAt, now) });
        return outcome;
      }
      if (parsed && parsed.reason === 'no-time') { outcome.reminderNeedsTime = parsed.text || 'that'; return outcome; }
      if (parsed && parsed.reason === 'past') { outcome.reminderPast = parsed.text || 'that'; return outcome; }
    }
    if (memoryStore) {
      const memory = applyMemoryCommands(memoryStore, text, { source });
      outcome.saved = memory.saved; outcome.forgotten = memory.forgotten;
    }
  } catch { /* commands must never break chat or voice */ }
  return outcome;
}


const hasOutcome = (o) => !!(o.updateCheck || o.saved.length || o.forgotten.length || o.reminders.length || o.reminderNeedsTime !== null || o.reminderPast !== null);

/** Instant regex commands first; if they found nothing, ask Gemini to understand any language/wording. Never throws. */
async function applyAssistantCommandsSmart({ memoryStore, reminderService, updater = null, text, source = 'chat', now = Date.now(), apiKey = null, models = null, extractor = extractWithGemini } = {}) {
  // "Nexora, check for updates": handled before memory/Gemini so it costs no API call. A reminder with a time still wins.
  if (updater && isUpdateCheckCommand(text) && !(reminderService && parseReminder(String(text), now)?.ok)) {
    const o = emptyOutcome(); o.updateCheck = await runUpdateCheck(updater); return o;
  }
  const viaGemini = async () => {
    const outcome = emptyOutcome();
    try {
      const found = await extractor({ apiKey, text, now, ...(models ? { models } : {}) });
      if (!found) return outcome;
      if (memoryStore) {
        for (const phrase of found.forget) { const r = memoryStore.forget(phrase); if (r?.success) outcome.forgotten.push(...(r.removed || [])); }
        for (const fact of found.facts) {
          const r = memoryStore.add(fact.category, fact.text, { key: fact.key, value: fact.value, source });
          if (r?.success && !r.duplicate) outcome.saved.push(fact.text);
        }
      }
      if (reminderService && found.reminder) {
        if (found.reminder.dueAt <= now && found.reminder.repeat === 'none') outcome.reminderPast = found.reminder.text;
        else {
          const r = reminderService.add({ text: found.reminder.text, dueAt: found.reminder.dueAt, repeat: found.reminder.repeat, source });
          if (r?.success) outcome.reminders.push({ ...r.item, when: formatDue(r.item.dueAt, now) });
        }
      }
    } catch { /* understanding is best-effort */ }
    return outcome;
  };
  const canAsk = !!apiKey && (memoryStore || reminderService);
  // Tamil script: Gemini first, so the fact is saved in ENGLISH with the name in English letters.
  // (If Gemini is offline, the local rules below still save it, transliterated to English.)
  if (canAsk && /[\u0B80-\u0BFF]/.test(String(text || ''))) { const o = await viaGemini(); if (hasOutcome(o)) return o; }
  const outcome = applyAssistantCommands({ memoryStore, reminderService, text, source, now });
  if (!canAsk) return outcome;
  if (!hasOutcome(outcome)) return viaGemini();
  // The quick rules caught something. If the message holds more (several clauses / a project / a long sentence),
  // let Gemini sort the rest into the right folders (preferences, knowledge, projects…). Duplicates are merged by the store.
  const rich = String(text || '').length > 55 || /(?:\band\b|,|;|\.\s)/i.test(String(text || ''));
  if (!rich || outcome.reminders.length || outcome.forgotten.length || outcome.reminderNeedsTime !== null || outcome.reminderPast !== null) return outcome;
  const more = await viaGemini();
  for (const t of more.saved) if (!outcome.saved.includes(t)) outcome.saved.push(t);
  return outcome;
}

/** One-line note appended to the system prompt so the assistant naturally confirms what NEXORA just did. */
function updateNotice(u) {
  if (!u) return '';
  if (u.status === 'downloaded') return `The user asked NEXORA to check for updates. Version ${u.version} is downloaded and ready. Say so in one short sentence and tell them to press Update Now (title bar badge or Settings -> Support & Updates).`;
  if (u.status === 'available') return `The user asked NEXORA to check for updates. Version ${u.version} is available${u.packaged ? ' and downloading' : ' (this is a development build, so they install it from the GitHub release)'}. Say so in one short sentence.`;
  if (u.status === 'up-to-date') return `The user asked NEXORA to check for updates. They are already on the latest version${u.current ? ` (${u.current})` : ''}. Say so in one short sentence.`;
  if (u.status === 'disabled') return 'The user asked NEXORA to check for updates, but update checks are switched off in Settings -> Support & Updates. Tell them in one short sentence.';
  return `The user asked NEXORA to check for updates but it failed${u.error ? ` (${u.error})` : ''}. Say so in one short sentence and suggest trying again later.`;
}

/** Plain sentence for the on-screen toast / local fallback (no model involved). */
function updateSummary(u) {
  if (!u) return '';
  if (u.status === 'downloaded') return `NEXORA v${u.version} is downloaded. Press Update Now to restart into it.`;
  if (u.status === 'available') return `NEXORA v${u.version} is available${u.packaged ? ' and downloading.' : ' on GitHub.'}`;
  if (u.status === 'up-to-date') return `You are up to date${u.current ? ` (v${u.current})` : ''}.`;
  if (u.status === 'disabled') return 'Update checks are switched off in Settings → Support & Updates.';
  return u.error || 'Could not check for updates.';
}

function commandNotice(outcome) {
  const parts = [];
  const upd = updateNotice(outcome?.updateCheck); if (upd) parts.push(upd);
  const mem = memoryNotice(outcome); if (mem) parts.push(mem);
  for (const r of outcome?.reminders || []) parts.push(`You just set a reminder for the user: "${r.text}" ${r.when}${r.repeat && r.repeat !== 'none' ? ` (repeats ${r.repeat})` : ''}. Confirm in one short natural sentence.`);
  if (outcome?.reminderNeedsTime !== null && outcome?.reminderNeedsTime !== undefined) parts.push(`The user asked for a reminder about "${outcome.reminderNeedsTime}" but gave no time, so NO reminder was saved. Ask what time they want it.`);
  if (outcome?.reminderPast !== null && outcome?.reminderPast !== undefined) parts.push(`The user asked for a reminder about "${outcome.reminderPast}" but the time they gave has already passed, so NO reminder was saved. Ask for a later time.`);
  return parts.join(' ');
}

const REMINDER_RULES = 'NEXORA has a reminder system. When the user states a task and a clear time (for example "remind me to call mom in 10 minutes"), NEXORA saves the reminder automatically and tells you in a note; only confirm a reminder when such a note says it was saved. Never claim a reminder was saved without that note.';

// Live voice cannot receive a "saved" note mid-turn, so its rule tells the model what NEXORA does automatically.
const UPDATE_RULES_LIVE = 'NEXORA can check for updates by itself: when the user says something like "check for updates", NEXORA runs the check automatically and shows the result on screen. Reply in one short sentence that you are checking; never invent a version number.';

const REMINDER_RULES_LIVE = 'NEXORA has a reminder system that saves a reminder automatically when the user says a task together with a clear time (for example "remind me to call mom in 10 minutes" or "remind me at 5pm to send the report"). When the user asks for a reminder with a time, confirm in one short sentence including the time you heard. If they gave no time, ask what time they want. You cannot set reminders any other way.';

module.exports = { applyAssistantCommandsSmart, applyAssistantCommands, commandNotice, isUpdateCheckCommand, updateSummary, REMINDER_RULES, REMINDER_RULES_LIVE, UPDATE_RULES_LIVE };
