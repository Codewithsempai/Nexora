/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy (2) — memory upkeep. Merges duplicates, retires stale chat notes, writes a short daily summary of
 * what happened yesterday (from the action log, reminders and memory — never from raw chat text) and asks before
 * keeping or removing a fact that may be out of date. Removing a fact only ever happens after a button press. */
const { dayKey, startOfDay } = require('./defaults');
const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const STALE_CONVERSATION_DAYS = 45; const KEEP_SUMMARIES = 14; const FACT_AGE_DAYS = 90; const ASK_AGAIN_DAYS = 30;
const CHECK_KEYS = ['location', 'work', 'edu:college', 'edu:company', 'edu:school', 'edu:university'];
const DAY = 86400000;

function dedupe(memoryStore) {
  const all = memoryStore.list('all'); if (!all.success) return 0;
  const groups = new Map();
  for (const item of all.items) { const k = `${item.category}|${norm(item.text)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(item); }
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const extra of list.slice(1)) if (memoryStore.remove(extra.id)?.success) removed++;
  }
  return removed;
}
function retireStale(memoryStore, at) {
  const all = memoryStore.list('conversations'); if (!all.success) return 0;
  let removed = 0;
  const summaries = all.items.filter((i) => /^Daily summary/i.test(i.text)).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const old of summaries.slice(KEEP_SUMMARIES)) if (memoryStore.remove(old.id)?.success) removed++;
  for (const item of all.items) if (!/^Daily summary/i.test(item.text) && at - (item.updatedAt || 0) > STALE_CONVERSATION_DAYS * DAY && memoryStore.remove(item.id)?.success) removed++;
  return removed;
}
function summarizeYesterday({ memoryStore, reminderService, log, config, at }) {
  const yesterday = startOfDay(at) - DAY; const key = dayKey(yesterday);
  if (config.get('autonomy.state.lastSummary') === key) return null;
  const from = yesterday, to = yesterday + DAY; const parts = [];
  const actions = (log?.between(from, to) || []).filter((e) => e.kind === 'action' && e.ok);
  if (actions.length) { const names = [...new Set(actions.map((a) => (a.summary || a.action || '').replace(/^(?:Opened|Created|Copied|Extracted|Found|Read)\s+/i, '').slice(0, 40)))].slice(0, 3); parts.push(`ran ${actions.length} action${actions.length > 1 ? 's' : ''} (${names.join(', ')})`); }
  const doneReminders = (reminderService?.list?.() || []).filter((r) => r.status === 'done' && r.doneAt >= from && r.doneAt < to);
  if (doneReminders.length) parts.push(`completed ${doneReminders.length} reminder${doneReminders.length > 1 ? 's' : ''}${doneReminders.length <= 2 ? ` (${doneReminders.map((r) => r.text.slice(0, 30)).join(', ')})` : ''}`);
  const created = (memoryStore.list('all').items || []).filter((m) => m.createdAt >= from && m.createdAt < to && !/^Daily summary/i.test(m.text));
  if (created.length) parts.push(`saved ${created.length} new memor${created.length > 1 ? 'ies' : 'y'}`);
  config.set('autonomy.state.lastSummary', key);
  if (!parts.length) return null;
  const text = `Daily summary ${key}: ${parts.join('; ')}.`;
  const saved = memoryStore.add('conversations', text, { source: 'tool' });
  return saved?.success ? text : null;
}
async function confirmOneStaleFact({ memoryStore, cards, config, log, at, openPanel }) {
  if (!cards || config.get('autonomy.state.lastAskDay') === dayKey(at)) return null;
  const asked = config.get('autonomy.state.asked') || {};
  const candidate = (memoryStore.list('personal').items || []).filter((i) => CHECK_KEYS.includes(i.key) && at - (i.updatedAt || at) > FACT_AGE_DAYS * DAY && at - (asked[i.id] || 0) > ASK_AGAIN_DAYS * DAY).sort((a, b) => a.updatedAt - b.updatedAt)[0];
  if (!candidate) return null;
  config.set('autonomy.state.lastAskDay', dayKey(at)); config.set('autonomy.state.asked', { ...asked, [candidate.id]: at });
  const answer = await cards.ask({ kind: 'proactive', label: 'MEMORY CHECK', title: 'Is this still true?', text: candidate.text, buttons: [{ id: 'yes', label: 'Yes, still true', primary: true }, { id: 'change', label: 'Change it' }, { id: 'no', label: 'No, remove', danger: true }], timeoutMs: 120000 });
  if (answer === 'yes') memoryStore.update(candidate.id, { text: candidate.text });
  else if (answer === 'no') memoryStore.remove(candidate.id);
  else if (answer === 'change') openPanel?.('memory');
  log?.add({ kind: 'memory', summary: `Memory check “${candidate.text.slice(0, 70)}”: ${answer}`, source: 'auto', decision: answer });
  return { id: candidate.id, answer };
}

/** Runs everything; each part is isolated so one failure never blocks the others. */
async function runUpkeep({ memoryStore, reminderService, log, cards, config, openPanel, now = () => Date.now(), force = false } = {}) {
  const at = now(); const out = { deduped: 0, retired: 0, summary: null, asked: null };
  if (!memoryStore || !config) return out;
  if (!force && config.get('autonomy.memoryUpkeep') === false) return out;
  try { out.deduped = dedupe(memoryStore); } catch { /* ignore */ }
  try { out.retired = retireStale(memoryStore, at); } catch { /* ignore */ }
  try { out.summary = summarizeYesterday({ memoryStore, reminderService, log, config, at }); } catch { /* ignore */ }
  if (out.deduped || out.retired || out.summary) log?.add({ kind: 'memory', summary: `Memory upkeep: ${out.deduped} duplicate(s) merged, ${out.retired} old note(s) retired${out.summary ? ', daily summary saved' : ''}`, source: 'auto' });
  try { if (force || config.get('autonomy.confirmStaleFacts') !== false) out.asked = await confirmOneStaleFact({ memoryStore, cards, config, log, at, openPanel }); } catch { /* ignore */ }
  return out;
}
module.exports = { runUpkeep, dedupe, retireStale, summarizeYesterday, confirmOneStaleFact };
