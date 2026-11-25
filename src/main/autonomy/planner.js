/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — turns a goal ("set up my project folder and open VS Code and Chrome") into a short list of
 * catalogue steps. Simple goals are planned offline with plain rules; anything else goes to Gemini as a JSON-only
 * call. Whatever comes back is VALIDATED against the action catalogue: unknown actions / bad arguments are dropped. */
const { ACTIONS, APPS, resolveApp, FOLDER_ALIASES } = require('./actions');
const health = require('../services/model-health');
const PLAN_MODELS = ['gemini-2.5-flash'];   // v0.3.12: the chat model; flash-lite is only used when the key's model list offers it
const DEFAULT_MAX_STEPS = 8;
// Well-known sites: "open YouTube" needs no Gemini call. (An installed app of the same name wins first.)
const SITES = { youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com', github: 'https://github.com', 'google maps': 'https://maps.google.com', maps: 'https://maps.google.com', instagram: 'https://www.instagram.com', facebook: 'https://www.facebook.com', twitter: 'https://x.com', x: 'https://x.com', linkedin: 'https://www.linkedin.com', netflix: 'https://www.netflix.com', 'chat gpt': 'https://chatgpt.com', chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', gemini: 'https://gemini.google.com', 'google drive': 'https://drive.google.com', drive: 'https://drive.google.com' };

function validatePlan(raw, executor, maxSteps = DEFAULT_MAX_STEPS) {
  const steps = []; const dropped = [];
  for (const s of Array.isArray(raw?.steps) ? raw.steps : []) {
    if (steps.length >= maxSteps) { dropped.push('too many steps'); break; }
    if (!s || typeof s.action !== 'string' || !ACTIONS[s.action]) { dropped.push(String(s?.action || 'unknown')); continue; }
    const checked = executor.validate(s.action, s.args);
    if (!checked.ok) { dropped.push(`${s.action}: ${checked.error}`); continue; }
    steps.push({ action: s.action, args: checked.args, why: typeof s.why === 'string' ? s.why.slice(0, 160) : '' });
  }
  return { steps, dropped, say: typeof raw?.say === 'string' ? raw.say.slice(0, 200) : '' };
}

/** Plain-rules plan for easy goals. Returns { steps, say } or null. */
function localPlan(goal, executor, maxSteps = DEFAULT_MAX_STEPS) {
  const text = String(goal || '').trim().replace(/[.!?]+$/g, '').replace(/^(?:please|pls|hey nexora|nexora)[\s,]+/i, '');
  if (!text) return null;
  let m;
  if ((m = text.match(/^(?:search|find|look for)\s+(?:for\s+)?(?:my\s+)?(?:files?\s+)?(?:named\s+|called\s+)?(.{2,80})$/i))) {
    return validatePlan({ steps: [{ action: 'search_files', args: { query: m[1] }, why: 'You asked me to find it.' }] }, executor, maxSteps);
  }
  // "open the anime folder in the D drive" / "open anime folder on D:" / "open D drive"
  if ((m = text.match(/^(?:open|show|go to|launch)\s+(?:the\s+)?(.+?)\s+folder\s+(?:in|on|from|inside)\s+(?:the\s+)?([a-z])\s*(?::|\s*drive)\s*$/i))) {
    return validatePlan({ steps: [{ action: 'open_folder', args: { name: m[1], drive: m[2] }, why: 'You asked for that folder.' }] }, executor, maxSteps);
  }
  if ((m = text.match(/^(?:open|show|go to|launch)\s+(?:the\s+)?([a-z])\s*(?::\\?|\s*drive)\s*$/i))) {
    return validatePlan({ steps: [{ action: 'open_folder', args: { path: `${m[1].toUpperCase()}:\\` }, why: 'You asked for that drive.' }] }, executor, maxSteps);
  }
  // "play Kalyani song on youtube" / "open youtube and play Kalyani song" / "google search for X"
  if ((m = text.match(/^(?:open\s+youtube\s+(?:and|then)\s+)?(?:play|search(?:\s+for)?)\s+(.{2,100}?)(?:\s+(?:on|in)\s+youtube)?$/i)) && (/youtube/i.test(text))) {
    return validatePlan({ steps: [{ action: 'open_url', args: { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(m[1].replace(/\s+/g, ' ').trim())}` }, why: 'Search YouTube for it.' }] }, executor, maxSteps);
  }
  if ((m = text.match(/^(?:google|search google for|search the web for|search for)\s+(.{2,120})$/i)) && /^(?:google|search google|search the web)/i.test(text)) {
    return validatePlan({ steps: [{ action: 'open_url', args: { url: `https://www.google.com/search?q=${encodeURIComponent(m[1].trim())}` }, why: 'Search Google for it.' }] }, executor, maxSteps);
  }
  if ((m = text.match(/^(?:open|launch|start|run)\s+(.+)$/i))) {
    const parts = m[1].split(/\s*(?:,|\band\b|\bthen\b|&)\s*/i).map((p) => p.trim()).filter(Boolean);
    const steps = [];
    for (const part of parts) {
      const clean = part.replace(/^the\s+/i, '');
      if (/^https?:\/\//i.test(clean)) steps.push({ action: 'open_url', args: { url: clean } });
      else if (/^(?:[\w-]+\.)+(?:com|org|net|in|io|dev|ai|app|edu)(?:\/\S*)?$/i.test(clean)) steps.push({ action: 'open_url', args: { url: `https://${clean}` } });
      else if (FOLDER_ALIASES.includes(clean.toLowerCase().replace(/\s*folder$/, ''))) steps.push({ action: 'open_folder', args: { path: clean.replace(/\s*folder$/i, '') } });
      else if (executor.findApp?.(clean)) steps.push({ action: 'open_app', args: { name: clean } });         // built-in OR installed (Discord, WhatsApp…)
      else if (SITES[clean.toLowerCase().replace(/\s+(?:website|site|web)$/, '')]) steps.push({ action: 'open_url', args: { url: SITES[clean.toLowerCase().replace(/\s+(?:website|site|web)$/, '')] } });
      else if (/\s+folder$/i.test(clean) && clean.length > 8) steps.push({ action: 'open_folder', args: { name: clean.replace(/\s+folder$/i, '') } });
      else return null; // something unknown: let Gemini plan it
    }
    return steps.length ? validatePlan({ steps }, executor, maxSteps) : null;
  }
  return null;
}

function catalogueText() { return Object.entries(ACTIONS).map(([, meta]) => `- ${meta.help}`).join('\n'); }
const PLAN_SYSTEM = (maxSteps) => `You plan computer actions for NEXORA, a Windows desktop assistant. Return ONLY JSON: {"steps":[{"action":"...","args":{...},"why":"short reason"}],"say":"one short friendly sentence in Tanglish"}.
Use ONLY these actions (nothing else exists):
${catalogueText()}
Rules: at most ${maxSteps} steps, in the order they must run. To open any app the user names (Discord, WhatsApp, Steam, Word…) use open_app with that name. To open a folder by name on a drive use open_folder {name, drive}. If a step needs a folder you create, use create_folder first, then open_in_vscode / open_folder with its absolute path only if you know it; otherwise use the folder alias. Never invent file paths. To write / type / note text into Notepad use write_note with the complete text in content (you write the text yourself, in the language the user asked). If the request needs anything outside this list (delete or move files, install software, send messages, run commands, passwords, payments), return {"steps":[],"say":"<polite one-sentence reason in Tanglish>"}.`;

async function planWithGemini({ apiKey, goal, executor, models = PLAN_MODELS, fetchImpl = globalThis.fetch, maxSteps = DEFAULT_MAX_STEPS, timeoutMs = 28000, homeHint = '' } = {}) {
  if (!apiKey || typeof fetchImpl !== 'function') return { error: 'no-key' };
  const body = {
    systemInstruction: { parts: [{ text: `${PLAN_SYSTEM(maxSteps)}${homeHint ? `\nKnown folders: ${homeHint}` : ''}` }] },
    contents: [{ role: 'user', parts: [{ text: String(goal).slice(0, 600) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1800, responseMimeType: 'application/json' },
  };
  const deadline = Date.now() + timeoutMs; let last = 'failed';
  // v0.3.13: up to 3 models, and a model that merely timed out gets ONE more try (Gemini is often just slow, not down).
  const ladder = health.usable(models && models.length ? models : PLAN_MODELS).slice(0, 3);
  const attempts = []; for (const m of ladder) attempts.push({ model: m, retry: false });
  if (ladder[0]) attempts.push({ model: ladder[0], retry: true });
  const timedOut = new Set();
  for (const { model, retry } of attempts) {
    if (retry && !timedOut.has(model)) continue;
    const left = deadline - Date.now(); if (left < 500) break;
    const requestBody = /^gemini-2\.5-flash/i.test(model) ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingBudget: 0 } } } : body;
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(Math.min(left, 12000)) });
      if (!response.ok) { last = `HTTP ${response.status}`; health.report(model, response.status); continue; }
      const payload = await response.json();
      const rawText = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      let data; try { data = JSON.parse(rawText.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { last = 'bad-json'; continue; }
      return validatePlan(data, executor, maxSteps);
    } catch (error) { last = error.message; if (/abort|timeout|timed out/i.test(String(error?.name) + String(error?.message))) timedOut.add(model); health.report(model, error); }
  }
  return { error: last };
}
module.exports = { validatePlan, localPlan, planWithGemini, PLAN_MODELS, DEFAULT_MAX_STEPS, APPS };
