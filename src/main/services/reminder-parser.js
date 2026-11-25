/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA — natural-language reminder parser (English, Tamil and Tanglish).
 * Pure helpers (no Electron) so typed chat and spoken Live transcripts share one parser and it can be unit tested.
 * parseReminder(text, now) -> null (not a reminder request)
 *                          | { ok:true, text, dueAt, repeat }
 *                          | { ok:false, reason:'no-time'|'past', text } */

const DAY_MS = 86400000;
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60 };
const NUM = String.raw`(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|sixty)`;
const UNIT = String.raw`(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|hr|days?|weeks?|nimidam|nimidangal|nimisham|nimishangal|nimida|mani\s*neram|maninneram)`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const STRONG_TRIGGER = /\b(?:remind\s+me|set\s+(?:a\s+|an\s+|the\s+)?(?:reminder|alarm)|create\s+(?:a\s+)?reminder|add\s+(?:a\s+)?reminder|make\s+(?:a\s+)?reminder|reminder\s+(?:for|to)|ninaivu\s*paduthu|ninaivootu|ninaivoottu|nyabagam\s*paduthu|gnabagam\s*paduthu|remind\s+pannu|reminder\s+(?:vei|vai|podu|pannu))\b/i;
const WEAK_TRIGGER = /\b(?:don['’]?t\s+forget\s+to|remember\s+to|wake\s+me(?:\s+up)?|alarm\s+for)\b/i;

function msFor(amount, unit) {
  const u = unit.toLowerCase().replace(/\s+/g, '');
  if (/^(?:s|sec)/.test(u)) return amount * 1000;
  if (/^(?:m(?:in|inute)|nimi)/.test(u)) return amount * 60000;
  if (/^(?:h|mani)/.test(u)) return amount * 3600000;
  if (/^d/.test(u)) return amount * DAY_MS;
  if (/^w/.test(u)) return amount * 7 * DAY_MS;
  return 0;
}
const toNumber = (token) => { const t = String(token).toLowerCase(); return /^\d/.test(t) ? parseFloat(t) : (NUM_WORDS[t] || 0); };

function startOfDay(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function atTime(day, hours, minutes) { const d = new Date(day); d.setHours(hours, minutes, 0, 0); return d; }

/** Find a repeat rule and return [repeat, stringWithRuleRemoved]. */
function takeRepeat(s) {
  const rules = [
    ['weekdays', /\b(?:every\s+weekday|on\s+weekdays|weekdays)\b/i],
    ['daily', /\b(?:every\s*day|everyday|daily|each\s+day|every\s+(?:morning|evening|night|afternoon)|dhinamum|dhinam|thinamum|daily\s+oru)\b/i],
    ['weekly', /\b(?:every\s+week|weekly|each\s+week|every\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i],
    ['monthly', /\b(?:every\s+month|monthly|each\s+month)\b/i],
  ];
  for (const [name, re] of rules) { const m = s.match(re); if (m) return [name, s.replace(re, ' '), m[0]]; }
  return ['none', s, ''];
}

/** Returns { dueAt, rest, explicitDay, whenText } or null. `rest` is the input with the time words removed. */
function extractWhen(input, now, repeatHint) {
  let s = ` ${input} `;
  const base = new Date(now);

  // 1) relative: "in 10 minutes", "after 2 hours", "in an hour and a half", "10 nimidam kalichi"
  let m = s.match(/\b(?:in|after|within)\s+(?:an?|one|1)\s+hour\s+and\s+a\s+half\b/i) || s.match(/\b(?:in|after)\s+half\s+(?:an?\s+)?hour\b/i);
  if (m) {
    const ms = /half\s+(?:an?\s+)?hour/i.test(m[0]) && !/and\s+a\s+half/i.test(m[0]) ? 1800000 : 5400000;
    return { dueAt: now + ms, rest: s.replace(m[0], ' '), explicitDay: true, relative: true };
  }
  m = s.match(new RegExp(String.raw`\b(?:in|after|within)\s+((?:${NUM}\s*${UNIT}(?:\s*(?:and|,)?\s*)?)+)`, 'i'));
  if (!m) m = s.match(new RegExp(String.raw`\b((?:${NUM}\s*${UNIT}\s*(?:and\s*)?)+)\s*(?:kalichi|kazhichi|kalithu|kazhithu|piragu|pin|la|ila)\b`, 'i'));
  if (m) {
    let ms = 0; const re = new RegExp(`(${NUM})\\s*(${UNIT})`, 'ig'); let part;
    while ((part = re.exec(m[1]))) ms += msFor(toNumber(part[1]), part[2]);
    if (ms > 0) return { dueAt: now + Math.round(ms), rest: s.replace(m[0], ' '), explicitDay: true, relative: true };
  }

  // 2) day words
  let dayOffset = null; let dayDate = null; let dayWord = '';
  const dayRules = [
    [/\bday\s+after\s+tomorrow\b/i, () => 2],
    [/\b(?:tomorrow|tmrw|tmr|naalaikku|nalaikku|naalai|nalai)\b/i, () => 1],
    [/\b(?:today|inniku|innaiku|indru|indriku)\b/i, () => 0],
  ];
  for (const [re, fn] of dayRules) { const dm = s.match(re); if (dm) { dayOffset = fn(); dayWord = dm[0]; s = s.replace(re, ' '); break; } }
  if (dayOffset === null) {
    const wm = s.match(new RegExp(String.raw`\b(?:on\s+|next\s+|this\s+)?(${WEEKDAYS.join('|')})\b`, 'i'));
    if (wm) {
      const target = WEEKDAYS.indexOf(wm[1].toLowerCase());
      let diff = (target - base.getDay() + 7) % 7;
      if (/next\s+/i.test(wm[0]) && diff === 0) diff = 7;
      dayOffset = diff; dayWord = wm[0]; s = s.replace(wm[0], ' ');
    }
  }
  if (dayOffset === null) {
    const dm = s.match(new RegExp(String.raw`\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS.join('|')})[a-z]*\b`, 'i'))
      || s.match(new RegExp(String.raw`\b(?:on\s+)?(${MONTHS.join('|')})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i'));
    if (dm) {
      const monthTok = isNaN(Number(dm[1])) ? dm[1] : dm[2]; const dayTok = isNaN(Number(dm[1])) ? dm[2] : dm[1];
      const month = MONTHS.indexOf(monthTok.slice(0, 3).toLowerCase()); const dd = Number(dayTok);
      if (month >= 0 && dd >= 1 && dd <= 31) {
        let year = base.getFullYear(); let candidate = new Date(year, month, dd);
        if (candidate < startOfDay(base)) candidate = new Date(year + 1, month, dd);
        dayDate = candidate; dayWord = dm[0]; s = s.replace(dm[0], ' ');
      }
    }
  }

  // 3) time of day
  let hh = null; let mm = 0; let ampmKnown = false; let timeText = '';
  const partOfDay = (s.match(/\b(?:in\s+the\s+|this\s+)?(morning|afternoon|evening|tonight|night|kaalai|kalai|maalai|malai|raathiri|rathiri|iravu)\b/i) || [])[1];
  const pod = partOfDay ? partOfDay.toLowerCase() : '';
  const isPm = /^(?:afternoon|evening|tonight|night|maalai|malai|raathiri|rathiri|iravu)$/.test(pod);
  const isAm = /^(?:morning|kaalai|kalai)$/.test(pod);
  let tm = s.match(/\b(?:at|@|by|around)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (tm) { hh = Number(tm[1]); mm = Number(tm[2] || 0); const pm = tm[3].toLowerCase() === 'pm'; if (hh === 12) hh = pm ? 12 : 0; else if (pm) hh += 12; ampmKnown = true; timeText = tm[0]; }
  if (!tm) { tm = s.match(/\b(?:at|@|by)?\s*(\d{1,2}):(\d{2})\b/i); if (tm && Number(tm[1]) <= 23 && Number(tm[2]) <= 59) { hh = Number(tm[1]); mm = Number(tm[2]); ampmKnown = hh >= 13 || hh === 0 || /^0\d/.test(tm[1]); timeText = tm[0]; } else tm = null; }
  if (!tm) { tm = s.match(/\b(?:at|@|by)\s+(\d{1,2})\b(?!\s*(?:minutes?|mins?|hours?|hrs?|days?|%|\.\d))/i); if (tm && Number(tm[1]) >= 1 && Number(tm[1]) <= 12) { hh = Number(tm[1]); timeText = tm[0]; } else tm = null; }
  if (!tm) { tm = s.match(/\b(\d{1,2})\s*(?:manikkum|manikku|mani\s*ku|mani)\b/i); if (tm && Number(tm[1]) >= 1 && Number(tm[1]) <= 12) { hh = Number(tm[1]); timeText = tm[0]; } else tm = null; }
  if (!tm) { const nm = s.match(/\b(?:at\s+)?(noon|midday|midnight)\b/i); if (nm) { hh = /midnight/i.test(nm[1]) ? 0 : 12; ampmKnown = true; timeText = nm[0]; tm = nm; } }
  if (timeText) s = s.replace(timeText, ' ');
  if (partOfDay) s = s.replace(new RegExp(String.raw`\b(?:in\s+the\s+|this\s+)?${partOfDay}\b`, 'i'), ' ');

  if (hh === null && dayOffset === null && !dayDate && !pod) return null;
  if (hh !== null && !ampmKnown) {
    if (isPm && hh < 12) hh += 12; else if (isAm && hh === 12) hh = 0; else if (isAm) { /* keep */ }
    else if (!isPm && !isAm) hh = -hh; // ambiguous: resolved below by picking the next occurrence
  }
  if (hh === null) { const defaults = { morning: 9, kaalai: 9, kalai: 9, afternoon: 14, evening: 18, maalai: 18, malai: 18, tonight: 21, night: 21, raathiri: 21, rathiri: 21, iravu: 21 }; hh = defaults[pod] ?? 9; mm = 0; }

  const explicitDay = dayOffset !== null || !!dayDate;
  const dayStart = dayDate || startOfDay(new Date(base.getTime() + (dayOffset || 0) * DAY_MS));
  // keep local wall-clock correct across daylight-saving changes
  if (!dayDate && dayOffset) { dayStart.setTime(startOfDay(base).getTime()); dayStart.setDate(dayStart.getDate() + dayOffset); }
  let candidates;
  if (hh < 0) { const h = -hh; candidates = h === 12 ? [atTime(dayStart, 0, mm), atTime(dayStart, 12, mm)] : [atTime(dayStart, h, mm), atTime(dayStart, h + 12, mm)]; }
  else candidates = [atTime(dayStart, hh, mm)];
  let due = candidates.find((c) => c.getTime() > now);
  if (!due) {
    if (explicitDay && (dayOffset || dayDate || dayOffset === 0) && (dayOffset !== 0 || dayDate)) due = null;
    else if (!explicitDay) { const next = new Date(candidates[0]); next.setDate(next.getDate() + 1); due = next; }
    if (!due && explicitDay && dayOffset === 0 && repeatHint !== 'none') { const next = new Date(candidates[0]); next.setDate(next.getDate() + 1); due = next; }
  }
  if (!due) return { past: true, rest: s };
  return { dueAt: due.getTime(), rest: s, explicitDay, whenText: `${dayWord} ${timeText}`.trim() };
}

function cleanTask(raw) {
  let t = String(raw || '')
    .replace(STRONG_TRIGGER, ' ').replace(WEAK_TRIGGER, ' ')
    .replace(/\b(?:hey|hi|ok|okay)\s+nexora\b/ig, ' ').replace(/\bnexora\b/ig, ' ')
    .replace(/\b(?:can|could|will|would)\s+you\b/ig, ' ').replace(/\b(?:please|pls|plz|kindly)\b/ig, ' ')
    .replace(/\b(?:me|my)\s+(?=to\b)/ig, ' ')
    .replace(/\b(?:nu|nnu|endru|kalichi)\b/ig, ' ')
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:me\s+)?(?:to|that|about|for)\s+/i, '').replace(/^(?:and|then|,|:|-)+\s*/i, '').replace(/[\s,.:;!-]+$/g, '').replace(/^[\s,.:;!-]+/g, '').trim();
  t = t.replace(/\b(?:at|by|on|in|for|around)$/i, '').replace(/[\s,.:;!-]+$/g, '').trim();
  return t.length > 300 ? t.slice(0, 300).trim() : t;
}

function parseReminder(input, now = Date.now()) {
  let text = String(input || '').replace(/\b([ap])\.m\.?/gi, '$1m').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 600) return null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.replace(/^(?:hey|hi|ok|okay)?\s*nexora[\s,:-]+/i, '');
    const isQuestion = /\?\s*$/.test(sentence) && !/^(?:can|could|will|would)\s+you\b/i.test(sentence);
    if (isQuestion) continue;
    if (/^(?:what|which|show|list|do i have|how many|when)\b.*\breminders?\b/i.test(sentence)) continue;
    const strong = STRONG_TRIGGER.test(sentence); const weak = !strong && WEAK_TRIGGER.test(sentence);
    if (!strong && !weak) continue;
    const [repeat, withoutRepeat] = takeRepeat(sentence);
    let when = extractWhen(withoutRepeat, now, repeat);
    const wakeMatch = /\bwake\s+me(?:\s+up)?\b/i.test(sentence);
    const taskSource = when?.rest ?? withoutRepeat;
    let task = cleanTask(wakeMatch && !/\bto\b/i.test(taskSource.replace(/wake\s+me\s+up/i, '')) ? 'Wake up' : wakeMatch ? taskSource.replace(/wake\s+me(?:\s+up)?/ig, ' ') : taskSource);
    if (wakeMatch && !task) task = 'Wake up';
    if (!when) {
      if (repeat !== 'none') { // "remind me to take vitamins every day" -> default 9:00
        const base = new Date(now); let due = atTime(startOfDay(base), 9, 0); if (due.getTime() <= now) due = atTime(new Date(startOfDay(base).getTime() + DAY_MS), 9, 0);
        return { ok: true, text: task || 'Reminder', dueAt: due.getTime(), repeat };
      }
      if (weak) continue; // "remember to call mom" without a time is a memory, not a reminder
      return { ok: false, reason: 'no-time', text: task || '' };
    }
    if (when.past) return { ok: false, reason: 'past', text: task || '' };
    return { ok: true, text: task || 'Reminder', dueAt: when.dueAt, repeat };
  }
  return null;
}

/** Human readable due time: "in 10 minutes", "today at 5:00 PM", "tomorrow at 9:00 AM", "Mon 12 Jan, 6:30 PM". */
function formatDue(dueAt, now = Date.now()) {
  const diff = dueAt - now;
  if (diff < 0) return 'overdue';
  if (diff < 90 * 1000) return 'in under a minute';
  if (diff < 3600000) { const m = Math.round(diff / 60000); return `in ${m} minute${m === 1 ? '' : 's'}`; }
  const d = new Date(dueAt); const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = startOfDay(new Date(now)); const that = startOfDay(d);
  const days = Math.round((that.getTime() - today.getTime()) / DAY_MS);
  if (days === 0) return `today at ${t}`; if (days === 1) return `tomorrow at ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${t}`;
}

module.exports = { parseReminder, formatDue, cleanTask };
