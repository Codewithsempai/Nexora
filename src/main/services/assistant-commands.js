/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — one place that turns what the user typed or said into actions:
 * reminders ("remind me to … at …") first, then memory ("remember that …", "my name is …", "forget …").
 * Used by typed chat and by spoken Live transcripts. Never throws. */
const { parseReminder, formatDue } = require('./reminder-parser');
const { applyMemoryCommands, memoryNotice } = require('./memory-learner');
const { extractWithGemini } = require('./memory-extractor');

function applyAssistantCommands({ memoryStore, reminderService, text, source = 'chat', now = Date.now() } = {}) {
  const outcome = { saved: [], forgotten: [], reminders: [], reminderNeedsTime: null, reminderPast: null };
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


const hasOutcome = (o) => !!(o.saved.length || o.forgotten.length || o.reminders.length || o.reminderNeedsTime !== null || o.reminderPast !== null);

/** Instant regex commands first; if they found nothing, ask Gemini to understand any language/wording. Never throws. */
async function applyAssistantCommandsSmart({ memoryStore, reminderService, text, source = 'chat', now = Date.now(), apiKey = null, models = null, extractor = extractWithGemini } = {}) {
  const viaGemini = async () => {
    const outcome = { saved: [], forgotten: [], reminders: [], reminderNeedsTime: null, reminderPast: null };
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
function commandNotice(outcome) {
  const parts = [];
  const mem = memoryNotice(outcome); if (mem) parts.push(mem);
  for (const r of outcome?.reminders || []) parts.push(`You just set a reminder for the user: "${r.text}" ${r.when}${r.repeat && r.repeat !== 'none' ? ` (repeats ${r.repeat})` : ''}. Confirm in one short natural sentence.`);
  if (outcome?.reminderNeedsTime !== null && outcome?.reminderNeedsTime !== undefined) parts.push(`The user asked for a reminder about "${outcome.reminderNeedsTime}" but gave no time, so NO reminder was saved. Ask what time they want it.`);
  if (outcome?.reminderPast !== null && outcome?.reminderPast !== undefined) parts.push(`The user asked for a reminder about "${outcome.reminderPast}" but the time they gave has already passed, so NO reminder was saved. Ask for a later time.`);
  return parts.join(' ');
}

const REMINDER_RULES = 'NEXORA has a reminder system. When the user states a task and a clear time (for example "remind me to call mom in 10 minutes"), NEXORA saves the reminder automatically and tells you in a note; only confirm a reminder when such a note says it was saved. Never claim a reminder was saved without that note.';

// Live voice cannot receive a "saved" note mid-turn, so its rule tells the model what NEXORA does automatically.
const REMINDER_RULES_LIVE = 'NEXORA has a reminder system that saves a reminder automatically when the user says a task together with a clear time (for example "remind me to call mom in 10 minutes" or "remind me at 5pm to send the report"). When the user asks for a reminder with a time, confirm in one short sentence including the time you heard. If they gave no time, ask what time they want. You cannot set reminders any other way.';

module.exports = { applyAssistantCommandsSmart, applyAssistantCommands, commandNotice, REMINDER_RULES, REMINDER_RULES_LIVE };
