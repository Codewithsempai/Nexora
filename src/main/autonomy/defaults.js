/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — default settings (merged into the app config under `autonomy`) and small shared helpers. */
const AUTONOMY_DEFAULTS = {
  morningBrief: true,        // 1. one friendly briefing card per day
  nudges: true,              // 1. "you snoozed this twice — reschedule?"
  habits: { water: { enabled: false, everyMin: 60 }, stretch: { enabled: false, everyMin: 50 } }, // 1. opt-in check-ins
  quietHours: { start: 22, end: 7 }, // no proactive cards (except reminders, approvals, critical battery) in this window
  memoryUpkeep: true,        // 2. dedupe, drop stale chat notes, daily summary
  confirmStaleFacts: true,   // 2. "is Tiruchirappalli still your city?"
  voiceApproval: true,       // v0.3.10: say "OK" / "allow" / "no" to answer an approval card without the mouse
  agent: { enabled: true, maxSteps: 8, maxSeconds: 180 }, // 3 + 5. computer actions and multi-step tasks (always with approval rules)
  permissions: {},           // action -> 'ask' | 'once' | 'always' | 'deny'
  screenHelp: true,          // 4. hotkey / voice "explain my screen"
  screenHotkey: 'CommandOrControl+Shift+E',
  screenWatch: false,        // 4. opt-in: window-title based "error on screen" / "stuck" offers (no screenshots)
  watchers: { clipboardErrors: false, downloads: true, battery: true, disk: true }, // 6.
  state: {},                 // lastBrief, lastUpkeep, lastSummary, asked{}
};

/** True inside the user's quiet hours (wraps midnight, e.g. 22 -> 7). */
function isQuietHour(date, quiet = AUTONOMY_DEFAULTS.quietHours) {
  const h = new Date(date).getHours(); const s = Number(quiet?.start), e = Number(quiet?.end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s === e) return false;
  return s < e ? (h >= s && h < e) : (h >= s || h < e);
}
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
module.exports = { AUTONOMY_DEFAULTS, isQuietHour, dayKey, startOfDay };
