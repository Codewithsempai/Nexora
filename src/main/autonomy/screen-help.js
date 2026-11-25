/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy (4) — screen awareness. Explains what is on the screen or an error you copied.
 *  · A screenshot is taken ONLY when you press the hotkey / ask by voice / press "Explain" on a card. It is sent to Gemini
 *    for that one answer and is never written to disk.
 *  · The optional watcher (default OFF) reads only the active WINDOW TITLE (no screenshots) to offer help when a title
 *    looks like an error or you stay on the same window for 20+ minutes. */
const SYSTEM = `You are NEXORA's screen helper for a Windows user. Reply in friendly Tanglish (Tamil words in English letters mixed with simple English), max 110 words.
If several monitors are attached, each image is labelled; cover every labelled monitor in one short line each. First say in one sentence what is on the screen. If there is an error, warning or problem, give the most likely cause and the exact fix in at most 3 short numbered steps. Never guess passwords or read out private details such as messages, emails or numbers.`;
const TEXT_SYSTEM = `You are NEXORA's error helper for a developer. Reply in friendly Tanglish (Tamil words in English letters mixed with simple English), max 110 words. Say what the error means, the most likely cause, and the fix in at most 3 short numbered steps. Show a command only if it is really needed.`;
const ERROR_TITLE = /\b(error|exception|traceback|failed|failure|fatal|not responding|crash(?:ed)?|unhandled|cannot|can't)\b/i;
const STUCK_MS = 20 * 60000; const ERROR_COOLDOWN = 10 * 60000; const STUCK_COOLDOWN = 60 * 60000;

class ScreenHelp {
  constructor({ cards, config, log, clipboard = null, getApiKey = () => null, getModels = async () => null, capture = null, getActiveTitle = async () => '', getIdleSeconds = () => 0, fetchImpl, now = () => Date.now() } = {}) {
    Object.assign(this, { cards, config, log, clipboard, getApiKey, getModels, capture, getActiveTitle, getIdleSeconds, fetchImpl, now });
    this.busy = false; this.timer = null; this.title = ''; this.sameSince = 0; this.lastErrorTitle = ''; this.lastErrorAt = 0; this.lastStuckAt = 0;
  }
  enabled() { return this.config?.get?.('autonomy.screenHelp') !== false; }

  async generate({ system, parts }) {
    const apiKey = this.getApiKey(); if (!apiKey) return { error: 'Gemini API key is not set. Add it in Settings.' };
    const models = (await Promise.resolve(this.getModels()).catch(() => null)) || ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    const fetchImpl = this.fetchImpl || globalThis.fetch; let last = 'Gemini did not answer.';
    for (const model of models.slice(0, 3)) {
      try {
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } } }), signal: AbortSignal.timeout(25000) });
        if (!response.ok) { last = `Gemini error ${response.status}`; require('../services/model-health').report(model, response.status); continue; }
        const payload = await response.json();
        const text = (payload?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        if (text) return { text, model };
      } catch (error) { last = String(error.message || error).slice(0, 120); require('../services/model-health').report(model, error); }
    }
    return { error: last };
  }

  showAnswer(label, title, text, copyText) {
    void this.cards.ask({ kind: 'screen', label, title, text, buttons: [{ id: 'copy', label: 'Copy answer', primary: true }, { id: 'close', label: 'Close' }], timeoutMs: 25000 })
      .then((a) => { if (a === 'copy') { try { this.clipboard?.writeText?.(copyText || text); } catch { /* ignore */ } } });
  }

  async explainScreen({ source = 'hotkey', target = { kind: 'all' } } = {}) {
    if (!this.enabled()) return { success: false, error: 'Screen help is turned off in the Autonomy tab.' };
    if (this.busy) return { success: false, error: 'Already looking at your screen.' };
    if (typeof this.capture !== 'function') return { success: false, error: 'Screen capture is not available.' };
    this.busy = true;
    const what = target?.kind === 'app' ? `your ${target.app} screen` : (target?.kind === 'cursor' ? 'this screen' : 'your whole screen');
    const waiting = this.cards.show({ kind: 'screen', label: 'SCREEN HELP', title: `Looking at ${what}…`, text: 'The screenshot is sent to Gemini for this answer only. It is not saved.', timeoutMs: 30000 });
    try {
      const shot = await this.capture(target);
      if (shot?.error) { this.cards.close(waiting.id); this.cards.notify({ kind: 'screen', label: 'SCREEN HELP', title: 'Could not find that screen', text: shot.error, timeoutMs: 8000 }); return { success: false, error: shot.error }; }
      const shots = Array.isArray(shot?.shots) ? shot.shots : (shot?.base64 ? [shot] : []);
      if (!shots.length) { this.cards.close(waiting.id); return { success: false, error: 'Could not capture the screen.' }; }
      const parts = [];
      shots.forEach((x) => { if (x.label && shots.length > 1 || x.label && target?.kind === 'app') parts.push({ text: `${x.label}:` }); parts.push({ inlineData: { mimeType: x.mime || 'image/jpeg', data: x.base64 } }); });
      parts.push({ text: shots.length > 1 ? 'Explain what is on each of my screens and help with any error.' : 'Explain what is on my screen and help with any error.' });
      const result = await this.generate({ system: SYSTEM, parts });
      this.cards.close(waiting.id);
      if (result.error) { this.cards.notify({ kind: 'screen', label: 'SCREEN HELP', title: 'Could not explain the screen', text: result.error, timeoutMs: 8000 }); return { success: false, error: result.error }; }
      this.log?.add({ kind: 'screen', summary: `Explained ${what}`, source });
      this.showAnswer('SCREEN HELP', 'What I see', result.text);
      return { success: true, text: result.text };
    } catch (error) { this.cards.close(waiting.id); return { success: false, error: String(error.message || error).slice(0, 120) }; }
    finally { this.busy = false; }
  }

  async explainText(text, { source = 'clipboard' } = {}) {
    const clean = String(text || '').trim().slice(0, 6000); if (clean.length < 10) return { success: false, error: 'Nothing to explain.' };
    const waiting = this.cards.show({ kind: 'screen', label: 'ERROR HELP', title: 'Reading the error…', timeoutMs: 30000 });
    const result = await this.generate({ system: TEXT_SYSTEM, parts: [{ text: clean }] });
    this.cards.close(waiting.id);
    if (result.error) { this.cards.notify({ kind: 'screen', label: 'ERROR HELP', title: 'Could not explain it', text: result.error, timeoutMs: 8000 }); return { success: false, error: result.error }; }
    this.log?.add({ kind: 'screen', summary: 'Explained a copied error', source });
    this.showAnswer('ERROR HELP', 'What this means', result.text);
    return { success: true, text: result.text };
  }

  /** One watcher step. Pure given its inputs, so it is unit-tested with a fake clock. */
  async watchStep(title = null) {
    if (!this.enabled() || this.config?.get?.('autonomy.screenWatch') !== true) return null;
    const at = this.now(); const t = String(title ?? await this.getActiveTitle()).trim().slice(0, 200);
    if (!t || /^NEXORA\b/i.test(t)) return null;
    if (t !== this.title) { this.title = t; this.sameSince = at; }
    if (ERROR_TITLE.test(t) && t !== this.lastErrorTitle && at - this.lastErrorAt > ERROR_COOLDOWN) {
      this.lastErrorTitle = t; this.lastErrorAt = at;
      void this.cards.ask({ kind: 'watcher', label: 'ON YOUR SCREEN', title: 'This window looks like an error', text: t, buttons: [{ id: 'explain', label: 'Explain it', primary: true }, { id: 'no', label: 'Not now' }], timeoutMs: 30000 }).then((a) => { if (a === 'explain') void this.explainScreen({ source: 'watch' }); });
      return 'error';
    }
    if (at - this.sameSince >= STUCK_MS && this.getIdleSeconds() < 90 && at - this.lastStuckAt > STUCK_COOLDOWN) {
      this.lastStuckAt = at;
      void this.cards.ask({ kind: 'watcher', label: 'STUCK?', title: 'Same window for 20+ minutes', text: `${t.slice(0, 90)} — want me to look at it with you?`, buttons: [{ id: 'explain', label: 'Explain my screen', primary: true }, { id: 'no', label: "I'm fine" }], timeoutMs: 30000 }).then((a) => { if (a === 'explain') void this.explainScreen({ source: 'watch' }); });
      return 'stuck';
    }
    return null;
  }
  start(intervalMs = 45000) { this.stop(); this.timer = setInterval(() => { void this.watchStep().catch(() => {}); }, intervalMs); if (typeof this.timer.unref === 'function') this.timer.unref(); }
  stop() { clearInterval(this.timer); this.timer = null; }
}
module.exports = { ScreenHelp, ERROR_TITLE, STUCK_MS };
