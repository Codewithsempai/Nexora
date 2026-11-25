/* =======================================================================
   NEXORA — Secure IPC handlers
   Gemini requests run only in Electron main; the renderer receives text chunks.
   ======================================================================= */
const { ipcMain, app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_GEMINI_MODEL, buildContents, extractText, consumeSseResponse,
} = require('../services/gemini-client');
const { ModelDirectory, classifyFailure } = require('../services/model-ladder');
const { MemoryStore } = require('../services/memory-store');
const { MEMORY_RULES } = require('../services/memory-learner');
const { applyAssistantCommands, applyAssistantCommandsSmart, commandNotice, REMINDER_RULES } = require('../services/assistant-commands');
const { parseReminder, formatDue } = require('../services/reminder-parser');
const { pickExtractModels } = require('../services/memory-extractor');
const { TtsService } = require('../services/tts-service');
const electronApi = require('electron');
const { AutonomyService, registerAutonomyIpc } = require('../autonomy');
const { isReleaseUrl } = require('../services/update-checker');
const { UpdaterService } = require('../services/updater');
const { getWindowsAudioDiagnostics, openWindowsCommunicationsSettings } = require('../services/audio-diagnostics');
const { ACTIONS } = require('../autonomy/actions');

function registerIpcHandlers(windowManager, configService, sidecarManager, hotkeyService, popupManager, voiceService, suppliedModelDirectory, extras = {}) {
  const reminderService = extras.reminderService || null;
  let autonomy = null; // v0.3.8 autonomy hub (created at the end of this function)
  const keyFile = path.join(app.getPath('userData'), 'gemini-key.enc');
  const activeRequests = new Map();
  const modelDirectory = suppliedModelDirectory || new ModelDirectory();
  const memoryStore = new MemoryStore({ filePath: path.join(app.getPath('userData'), 'memory-vault.enc'), safeStorage });
  if (voiceService) { voiceService.memoryStore = memoryStore; voiceService.reminderService = reminderService; } // Live voice shares the same vault + reminders
  // Live memory: every save / edit / delete (chat, voice or the panel) is pushed to the window the moment it happens.
  const pushToMain = (channel, payload) => { const win = windowManager.getMainWindow(); if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload); };
  memoryStore.onChange = (event) => { pushToMain('memory:changed', event); if (['clear', 'forget', 'remove'].includes(event?.type)) { try { voiceService?.onMemoryRemoved?.(); } catch { /* ignore */ } } try { voiceService?.onMemoryChanged?.(); } catch { /* ignore */ } };
  if (reminderService) { const previous = reminderService.onChange; reminderService.onChange = (event) => { try { previous?.(event); } catch { /* ignore */ } pushToMain('reminder:changed', event); }; }
  // Set reminders / save / forget anything the user just asked for, then build the prompt for this message.
  // Save / forget / set reminders BEFORE any network call, so they work even with no API key, offline or when Gemini fails.
  const runCommands = async (prompt, apiKey) => applyAssistantCommandsSmart({ memoryStore, reminderService, text: prompt, source: 'chat', apiKey, models: apiKey ? await pickExtractModels(modelDirectory, apiKey, configService.get('ai.chatModel')) : null });
  const hasActions = (o) => !!(o && (o.saved.length || o.forgotten.length || o.reminders.length || o.reminderNeedsTime !== null || o.reminderPast !== null));
  const localConfirm = (o) => {
    const lines = [];
    for (const t of o.saved) lines.push(`Saved to memory: ${t}.`);
    for (const t of o.forgotten) lines.push(`Removed from memory: ${t}.`);
    for (const r of o.reminders) lines.push(`Reminder set: “${r.text}” ${r.when}${r.repeat && r.repeat !== 'none' ? ` (repeats ${r.repeat})` : ''}.`);
    if (o.reminderNeedsTime !== null) lines.push(`What time should I remind you about “${o.reminderNeedsTime}”?`);
    if (o.reminderPast !== null) lines.push(`That time for “${o.reminderPast}” has already passed. Give me a later time.`);
    return lines.join('\n');
  };
  // If Gemini cannot answer, the user still gets a confirmation of what NEXORA already did locally.
  const failWith = (o, error, extra = {}) => (hasActions(o) ? { success: true, text: localConfirm(o), model: 'local', local: true, timestamp: Date.now() } : { success: false, error, ...extra });
  const buildMemoryInstruction = (prompt, outcome) => {
    const context = memoryStore.buildContext(prompt);
    const notice = commandNotice(outcome);
    if (!context && !notice && !reminderService) return null;
    return { parts: [{ text: `${MEMORY_RULES}${reminderService ? `\n\n${REMINDER_RULES}` : ''}\n\nUser memory:\n${context || '(nothing saved yet)'}${notice ? `\n\n${notice}` : ''}` }] };
  };
  const requestKey = (webContentsId, requestId) => `${webContentsId}:${requestId}`;
  const isTrustedRenderer = (event) => {
    const win = windowManager.getMainWindow();
    return !!win && !win.isDestroyed() && event.sender === win.webContents;
  };
  const readGeminiKey = () => {
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(keyFile)) return null;
      return safeStorage.decryptString(fs.readFileSync(keyFile));
    } catch { return null; }
  };
  const saveGeminiKey = (key) => {
    if (typeof key !== 'string' || key.trim().length < 10 || key.length > 500) return { success: false, error: 'Invalid API key format.' };
    if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'Secure credential encryption is unavailable on this system.' };
    try {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      const encrypted = safeStorage.encryptString(key.trim());
      fs.writeFileSync(keyFile, encrypted, { mode: 0o600 });
      return { success: true };
    } catch (error) { return { success: false, error: error.message || 'Unable to save API key.' }; }
  };
  const clearGeminiKey = () => {
    try { if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile); return true; }
    catch { return false; }
  };

  // Window controls. The renderer also receives maximize/unmaximize events.
  ipcMain.handle('window:minimize', (event) => { if (!isTrustedRenderer(event)) return false; const win = windowManager.getMainWindow(); if (!win || win.isDestroyed() || !win.isMinimizable()) return false; win.minimize(); return win.isMinimized(); });
  ipcMain.handle('window:maximize', (event) => {
    if (!isTrustedRenderer(event)) return false;
    return windowManager.toggleMaximize();
  });
  ipcMain.handle('window:close', (event) => {
    if (!isTrustedRenderer(event)) return false;
    const win = windowManager.getMainWindow();
    if (win) {
      if (configService.get('application.closeToTray')) win.hide();
      else win.close();
    }
    return true;
  });
  // Exit button (after the confirm dialog): really quit, not close-to-tray.
  ipcMain.handle('app:exit', (event) => {
    if (!isTrustedRenderer(event)) return false;
    setImmediate(() => windowManager.forceQuit());
    return true;
  });
  ipcMain.handle('window:is-maximized', (event) => {
    if (!isTrustedRenderer(event)) return false;
    return windowManager.isWindowMaximized();
  });

  // Configuration store with guarded key paths.
  ipcMain.handle('config:get', (event, keyPath) => {
    if (!isTrustedRenderer(event) || (keyPath != null && typeof keyPath !== 'string')) return null;
    return configService.get(keyPath);
  });
  ipcMain.handle('config:set', (event, keyPath, value) => {
    if (!isTrustedRenderer(event) || typeof keyPath !== 'string' || !keyPath) return false;
    if (/(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(keyPath)) return false;
    if (keyPath === 'appearance.popupOrbSize') value = Math.max(40, Math.min(500, Math.round(Number(value) || 200)));
    const ok = configService.set(keyPath, value);
    if (ok && /^autonomy\./.test(keyPath)) { try { autonomy?.onConfig(keyPath); } catch { /* ignore */ } }
    if (ok && /^appearance\.popupOrb(Size|Position|Profile)$/.test(keyPath)) popupManager?.applyLayout?.();
    if (ok && keyPath === 'performance.mode') popupManager?.applyLayout?.();
    if (ok && keyPath === 'voice.wakeThreshold') { const v = Number(value); if (Number.isFinite(v)) voiceService?.wakeWord?.setThreshold(Math.min(0.99, Math.max(0.05, v))); }
    return ok;
  });

  // System & native diagnostics.
  ipcMain.handle('system:get-status', async (event) => {
    if (!isTrustedRenderer(event)) return { error: 'Untrusted renderer.' };
    return {
      appName: 'NEXORA', version: app.getVersion?.() || '0.1.0', phase: 'Phase 3 — Gemini Live voice and wake word',
      platform: process.platform, arch: process.arch, nodeVersion: process.versions.node,
      electronVersion: process.versions.electron, chromeVersion: process.versions.chrome,
      sidecar: sidecarManager.getStatus(), uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage(),
      // v0.3.19 live telemetry: whole-app CPU % (all Electron processes, normalised to 0-100) and working-set memory in MB.
      metrics: (() => {
        try {
          const list = app.getAppMetrics();
          const cores = Math.max(1, require('os').cpus().length);
          const cpu = Math.min(100, list.reduce((sum, p) => sum + (p.cpu?.percentCPUUsage || 0), 0) / cores);
          const memoryMB = list.reduce((sum, p) => sum + (p.memory?.workingSetSize || 0), 0) / 1024;
          return { cpuPercent: Math.round(cpu * 10) / 10, memoryMB: Math.round(memoryMB), processes: list.length };
        } catch { return { cpuPercent: 0, memoryMB: Math.round(process.memoryUsage().rss / 1048576), processes: 1 }; }
      })(),
      services: {
        geminiKey: !!readGeminiKey(),
        voice: voiceService ? { mode: voiceService.mode, wakeEnabled: !!voiceService.wakeEnabled, liveActive: !!voiceService.isLiveActive?.(), liveModel: voiceService.liveModel || null } : null,
      },
    };
  });
  ipcMain.handle('system:ping-sidecar', async (event) => {
    if (!isTrustedRenderer(event)) return { success: false, error: 'Untrusted renderer.' };
    try { return { success: true, result: await sidecarManager.sendRequest('ping') }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('hotkey:update', (event, shortcut) => isTrustedRenderer(event) && typeof shortcut === 'string' ? hotkeyService.updateShortcut(shortcut) : false);

  async function validateGeminiApiKey(rawKey) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key || key.length < 16 || /[^\x21-\x7E]/.test(key)) {
      return { valid: false, error: 'Please paste a valid Gemini API key.' };
    }
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        method: 'GET',
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        return { valid: true, modelCount: Array.isArray(data?.models) ? data.models.length : 1 };
      }
      if (res.status === 429) {
        return { valid: true, rateLimited: true, warning: 'API key recognized (Gemini quota/rate limit active right now).' };
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { valid: false, error: 'API key was rejected by Google Gemini (invalid or lacks permissions).' };
      }
      return { valid: false, error: `Gemini returned HTTP ${res.status}. Please retry.` };
    } catch (error) {
      return { valid: false, networkError: true, error: 'Could not reach Gemini API (check your internet connection and retry).' };
    }
  }

  // Gemini credential bridge. Only encrypted bytes are written to disk.
  ipcMain.handle('ai:key:save', (event, key) => isTrustedRenderer(event) ? saveGeminiKey(key) : { success: false, error: 'Untrusted renderer.' });
  ipcMain.handle('ai:key:clear', (event) => isTrustedRenderer(event) ? clearGeminiKey() : false);
  ipcMain.handle('ai:key:status', (event) => isTrustedRenderer(event) ? ({ configured: !!readGeminiKey(), secureStorage: safeStorage.isEncryptionAvailable() }) : ({ configured: false, secureStorage: false }));
  ipcMain.handle('ai:key:validate', async (event, key) => isTrustedRenderer(event) ? validateGeminiApiKey(key) : { valid: false, error: 'Untrusted renderer.' });
  ipcMain.handle('ai:key:validate-stored', async (event) => {
    if (!isTrustedRenderer(event)) return { valid: false, error: 'Untrusted renderer.' };
    const stored = readGeminiKey();
    if (!stored) return { valid: false, error: 'No Gemini API key is saved yet.' };
    return validateGeminiApiKey(stored);
  });
  ipcMain.handle('audio:diagnostics', async (event) => isTrustedRenderer(event) ? getWindowsAudioDiagnostics() : { error: 'Untrusted renderer.' });
  ipcMain.handle('audio:open-communications', async (event) => isTrustedRenderer(event) ? openWindowsCommunicationsSettings() : { success: false, error: 'Untrusted renderer.' });
  ipcMain.handle('ai:models:list', async (event, force = false) => {
    if (!isTrustedRenderer(event)) return { success: false, error: 'Untrusted renderer.' };
    const key = readGeminiKey();
    if (!key) return modelDirectory.list(null);
    return modelDirectory.list(key, { force: force === true });
  });

  // Live voice and wake-word controls. Only the primary renderer may stream microphone PCM.
  ipcMain.handle('voice:wake:enable', (event) => isTrustedRenderer(event) && voiceService ? voiceService.enableWake() : ({ success: false, error: 'Untrusted renderer or voice service unavailable.' }));
  ipcMain.handle('voice:wake:disable', (event) => isTrustedRenderer(event) && voiceService ? voiceService.disableWake() : ({ success: false, error: 'Untrusted renderer or voice service unavailable.' }));
  ipcMain.handle('voice:wake:test-start', async (event) => {
    if (!isTrustedRenderer(event) || !voiceService) return { success: false, error: 'Untrusted renderer or voice service unavailable.' };
    voiceService.setWakeTestMode?.(true);
    return voiceService.enableWake();
  });
  ipcMain.handle('voice:wake:test-stop', async (event, keepEnabled = null) => {
    if (!isTrustedRenderer(event) || !voiceService) return { success: false };
    voiceService.setWakeTestMode?.(false);
    const shouldKeep = keepEnabled === true || (keepEnabled === null && configService.get('voice.wakeWordEnabled') === true);
    if (!shouldKeep) await voiceService.disableWake();
    return { success: true };
  });
  voiceService?.on?.('wake-test-hit', (hit) => pushToMain('voice:wake-test-hit', hit));
  ipcMain.handle('voice:live:start', (event) => isTrustedRenderer(event) && voiceService ? voiceService.startLive() : ({ success: false, error: 'Untrusted renderer or voice service unavailable.' }));
  ipcMain.handle('voice:live:stop', (event) => isTrustedRenderer(event) && voiceService ? voiceService.stopLive({ returnToStandby: voiceService.wakeEnabled, hidePopup: true }) : ({ success: false, error: 'Untrusted renderer or voice service unavailable.' }));
  ipcMain.handle('voice:orb-profile', (event, profile) => isTrustedRenderer(event) && voiceService ? voiceService.setOrbProfile(profile) : ({ success: false, error: 'Untrusted renderer or voice service unavailable.' }));
  ipcMain.on('voice:pcm', (event, base64) => { if (isTrustedRenderer(event) && voiceService) voiceService.pushAudio(base64); });
  const POPUP_PREVIEW_STATES = ['idle', 'listen', 'think', 'speak', 'wake', 'error', 'offline'];
  ipcMain.on('popup:preview', (event, state) => { if (isTrustedRenderer(event) && POPUP_PREVIEW_STATES.includes(state)) popupManager?.preview?.(state); });
  ipcMain.on('popup:preview-stop', (event) => { if (isTrustedRenderer(event)) popupManager?.stopPreview?.(); });
  ipcMain.on('popup:open-main', (event) => { if (popupManager?.isSender(event.sender)) windowManager.show(); });

  // User-managed persistent memory. The complete vault is encrypted at rest.
  ipcMain.handle('memory:list', (event, category = 'all') => isTrustedRenderer(event) ? memoryStore.list(category) : ({ success: false, error: 'Untrusted renderer.' }));
  ipcMain.handle('memory:add', (event, category, text) => isTrustedRenderer(event) ? memoryStore.add(category, text, { source: 'manual' }) : ({ success: false, error: 'Untrusted renderer.' }));
  ipcMain.handle('memory:update', (event, id, patch) => isTrustedRenderer(event) && patch && typeof patch === 'object' ? memoryStore.update(id, { text: patch.text, category: patch.category }) : ({ success: false, error: 'Untrusted renderer.' }));
  ipcMain.handle('memory:stats', (event) => isTrustedRenderer(event) ? memoryStore.stats() : ({ success: false, error: 'Untrusted renderer.' }));

  // Reminders (scheduler lives in main; the panel only displays and edits).
  const noReminders = { success: false, error: 'Reminders are unavailable.' };
  const guardR = (event, fn) => (!isTrustedRenderer(event) ? ({ success: false, error: 'Untrusted renderer.' }) : !reminderService ? noReminders : fn());
  ipcMain.handle('reminder:list', (event) => guardR(event, () => ({ success: true, items: reminderService.list(), summary: reminderService.summary(), now: Date.now() })));
  ipcMain.handle('reminder:add', (event, r) => guardR(event, () => (r && typeof r === 'object' ? reminderService.add({ text: r.text, dueAt: Number(r.dueAt), repeat: r.repeat || 'none', source: 'manual' }) : { success: false, error: 'Invalid reminder.' })));
  ipcMain.handle('reminder:quick', (event, text) => guardR(event, () => {
    if (typeof text !== 'string' || !text.trim()) return { success: false, error: 'Type what to remind you about and when, e.g. “call mom in 10 minutes”.' };
    const input = /\bremind|reminder|alarm\b/i.test(text) ? text : `remind me to ${text}`;
    const parsed = parseReminder(input);
    if (!parsed) return { success: false, error: 'I could not understand that. Try “call mom in 10 minutes” or “submit report tomorrow at 9am”.' };
    if (!parsed.ok) return { success: false, error: parsed.reason === 'past' ? 'That time has already passed. Pick a later time.' : 'Add a time, e.g. “in 10 minutes”, “at 5pm” or “tomorrow at 9am”.' };
    const result = reminderService.add({ text: parsed.text, dueAt: parsed.dueAt, repeat: parsed.repeat, source: 'manual' });
    return result.success ? { ...result, when: formatDue(parsed.dueAt) } : result;
  }));
  ipcMain.handle('reminder:update', (event, id, patch) => guardR(event, () => (patch && typeof patch === 'object' ? reminderService.update(id, { text: patch.text, dueAt: patch.dueAt, repeat: patch.repeat }) : { success: false, error: 'Invalid reminder.' })));
  ipcMain.handle('reminder:delete', (event, id) => guardR(event, () => reminderService.remove(id)));
  ipcMain.handle('reminder:done', (event, id) => guardR(event, () => reminderService.done(id)));
  // Spoken reminders use the Gemini voice (same voice as Live). The renderer plays the returned PCM.
  const tts = new TtsService();
  ipcMain.handle('reminder:speak', async (event, text) => {
    if (!isTrustedRenderer(event)) return { success: false, error: 'Untrusted renderer.' };
    if (typeof text !== 'string') return { success: false, error: 'Invalid text.' };
    return tts.synthesize({ apiKey: readGeminiKey(), text, voiceName: configService.get('ai.voiceName') || 'Charon' });
  });
  ipcMain.handle('reminder:snooze', (event, id, minutes) => guardR(event, () => reminderService.snooze(id, minutes)));
  ipcMain.handle('reminder:clear-done', (event) => guardR(event, () => reminderService.clearDone()));
  ipcMain.handle('memory:delete', (event, id) => isTrustedRenderer(event) ? memoryStore.remove(id) : ({ success: false, error: 'Untrusted renderer.' }));
  ipcMain.handle('memory:clear', (event, category = 'all') => isTrustedRenderer(event) ? memoryStore.clear(category) : ({ success: false, error: 'Untrusted renderer.' }));
  ipcMain.handle('memory:search', (event, query, category = 'all') => isTrustedRenderer(event) ? memoryStore.search(query, category) : ({ success: false, error: 'Untrusted renderer.', items: [] }));

  // Non-streaming compatibility method uses the same per-key model fallback ladder.
  ipcMain.handle('chat:generate', async (event, prompt, history = []) => {
    if (!isTrustedRenderer(event)) return { success: false, error: 'Untrusted renderer.' };
    const auto = typeof prompt === 'string' ? autonomy?.handleText(prompt, { source: 'chat' }) : null;
    if (auto?.handled) return { success: true, text: auto.text, model: 'local', local: true, timestamp: Date.now() };
    const key = readGeminiKey();
    const outcome = await runCommands(prompt, key);
    if (!key) return failWith(outcome, 'Gemini API key is not configured. Add it in Settings.');
    let contents;
    try { contents = buildContents(prompt, history); } catch (error) { return failWith(outcome, error.message); }
    const selected = configService.get('ai.chatModel') || DEFAULT_GEMINI_MODEL;
    const candidates = await modelDirectory.textOrder(key, selected);
    const memoryInstruction = buildMemoryInstruction(prompt, outcome);
    const body = { contents, generationConfig: { temperature: 0.7 } };
    if (memoryInstruction) body.systemInstruction = memoryInstruction;
    let lastError = null;
    for (let index = 0; index < candidates.length; index++) {
      const model = candidates[index];
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.error) {
          const error = new Error(payload?.error?.message || `Gemini request failed (${response.status}).`);
          error.status = payload?.error?.code || response.status;
          const kind = classifyFailure(error);
          modelDirectory.markBad(model, kind, error.message);
          lastError = error;
          if (index + 1 < candidates.length && ['model', 'quota', 'server', 'timeout'].includes(kind)) {
            if (!event.sender.isDestroyed()) event.sender.send('chat:model-switch', { from: model, to: candidates[index + 1], reason: kind, attempt: index + 2, total: candidates.length });
            continue;
          }
          break;
        }
        const text = extractText(payload);
        if (!text) return failWith(outcome, 'Gemini returned no text.');
        modelDirectory.markGood(model);
        return { success: true, text, model, timestamp: Date.now() };
      } catch (error) {
        const kind = classifyFailure(error);
        modelDirectory.markBad(model, kind, error.message);
        lastError = error;
        if (index + 1 < candidates.length && ['model', 'quota', 'server', 'timeout'].includes(kind)) {
          if (!event.sender.isDestroyed()) event.sender.send('chat:model-switch', { from: model, to: candidates[index + 1], reason: kind, attempt: index + 2, total: candidates.length });
          continue;
        }
        break;
      }
    }
    return failWith(outcome, lastError?.message || 'All available Gemini models failed.');
  });

  // Stream Gemini SSE chunks. The ladder may switch before the first chunk; after output
  // starts it never restarts another model, avoiding duplicated assistant text.
  ipcMain.handle('chat:stream', async (event, requestId, prompt, history = []) => {
    if (!isTrustedRenderer(event)) return { success: false, error: 'Untrusted renderer.' };
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return { success: false, error: 'Invalid request id.' };
    const auto = typeof prompt === 'string' ? autonomy?.handleText(prompt, { source: 'chat' }) : null;
    if (auto?.handled) return { success: true, text: auto.text, model: 'local', local: true, timestamp: Date.now() };
    const key = readGeminiKey();
    const outcome = await runCommands(prompt, key);
    if (!key) return failWith(outcome, 'Gemini API key is not configured. Add it in Settings.');
    let contents;
    try { contents = buildContents(prompt, history); } catch (error) { return failWith(outcome, error.message); }
    const id = requestKey(event.sender.id, requestId);
    if (activeRequests.has(id)) return { success: false, error: 'A request with this id is already active.' };
    const controller = new AbortController();
    activeRequests.set(id, controller);
    const timeout = setTimeout(() => controller.abort(new Error('Gemini request timed out after 90 seconds.')), 90000);
    const selected = configService.get('ai.chatModel') || DEFAULT_GEMINI_MODEL;
    const candidates = await modelDirectory.textOrder(key, selected);
    const memoryInstruction = buildMemoryInstruction(prompt, outcome);
    const body = { contents, generationConfig: { temperature: 0.7 } };
    if (memoryInstruction) body.systemInstruction = memoryInstruction;
    let lastError = null;
    let outputStarted = false;
    try {
      for (let index = 0; index < candidates.length; index++) {
        if (controller.signal.aborted) return { success: false, cancelled: true, error: controller.signal.reason?.message || 'Request cancelled.' };
        const model = candidates[index];
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'x-goog-api-key': key },
            body: JSON.stringify(body), signal: controller.signal,
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            const error = new Error(payload?.error?.message || `Gemini request failed (${response.status}).`);
            error.status = payload?.error?.code || response.status;
            throw error;
          }
          const text = await consumeSseResponse(response, (chunk) => {
            outputStarted = true;
            if (!event.sender.isDestroyed()) event.sender.send('chat:stream:chunk', { requestId, text: chunk, model });
          }, controller.signal);
          if (!text) return failWith(outcome, 'Gemini returned no text.');
          modelDirectory.markGood(model);
          return { success: true, text, model, timestamp: Date.now() };
        } catch (error) {
          if (controller.signal.aborted) return { success: false, cancelled: true, error: controller.signal.reason?.message || 'Request cancelled.' };
          lastError = error;
          const kind = classifyFailure(error);
          modelDirectory.markBad(model, kind, error.message);
          if (!outputStarted && index + 1 < candidates.length && ['model', 'quota', 'server', 'timeout'].includes(kind)) {
            if (!event.sender.isDestroyed()) event.sender.send('chat:model-switch', { requestId, from: model, to: candidates[index + 1], reason: kind, attempt: index + 2, total: candidates.length });
            continue;
          }
          return outputStarted ? { success: false, error: error.message || 'Network error while contacting Gemini.', partial: true } : failWith(outcome, error.message || 'Network error while contacting Gemini.');
        }
      }
      return failWith(outcome, lastError?.message || 'All available Gemini models failed.');
    } finally {
      clearTimeout(timeout);
      activeRequests.delete(id);
    }
  });
  ipcMain.on('chat:cancel', (event, requestId) => {
    if (!isTrustedRenderer(event) || typeof requestId !== 'string') return;
    activeRequests.get(requestKey(event.sender.id, requestId))?.abort(new Error('Request cancelled by user.'));
  });

  // Auto-updater (electron-updater + GitHub Releases for codewithsempai-daya/nexora).
  const updater = new UpdaterService({
    app,
    currentVersion: app?.getVersion?.() || configService.get('version') || '0.3.25',
    configService,
    isPackaged: !!app?.isPackaged,
    onEvent: (channel, payload) => pushToMain(channel, payload),
    onBeforeInstall: async () => {
      try { global.__nexoraUpdating = true; } catch { /* ignore */ }
      try { windowManager.isQuitting = true; } catch { /* ignore */ }
      try { voiceService?.dispose?.(); } catch { /* ignore */ }
      try { sidecarManager?.stop?.(); } catch { /* ignore */ }
      try { popupManager?.destroy?.(); } catch { /* ignore */ }
    },
  });
  ipcMain.handle('update:check', async (event) => isTrustedRenderer(event) ? updater.check({ manual: true }) : { status: 'error', error: 'Untrusted renderer.' });
  ipcMain.handle('update:download', async (event) => isTrustedRenderer(event) ? updater.downloadUpdate() : { success: false, error: 'Untrusted renderer.' });
  ipcMain.handle('update:install', async (event) => isTrustedRenderer(event) ? updater.installAndRestart() : { success: false, error: 'Untrusted renderer.' });
  ipcMain.handle('update:state', (event) => isTrustedRenderer(event) ? updater.getState() : null);
  ipcMain.handle('update:setAuto', (event, enabled) => isTrustedRenderer(event) ? updater.setAutoUpdate(enabled) : null);
  ipcMain.handle('update:open', (event, url) => {
    const target = url || updater.getState().releaseUrl;
    if (!isTrustedRenderer(event) || !isReleaseUrl(target)) return false;
    require('electron').shell.openExternal(target);
    return true;
  });
  ipcMain.handle('update:skip', (event, version) => isTrustedRenderer(event) ? updater.skipVersion(version) : false);
  const baseConfigSet = configService.set.bind(configService);
  configService.set = (keyPath, value) => {
    const ok = baseConfigSet(keyPath, value);
    if (ok && (keyPath === 'updates.checkOnStart' || keyPath === 'updates.check' || keyPath === 'updates.autoDownload')) {
      if (updater.isAutoCheckEnabled()) updater.scheduleTimers();
      else updater.clearTimers();
      updater.emitState('update:state');
    }
    return ok;
  };
  updater.start();

  ipcMain.handle('autonomy:apply-preset', (event, preset) => {
    if (!isTrustedRenderer(event)) return { success: false, error: 'Untrusted renderer.' };
    const clean = typeof preset === 'string' ? preset.replace(/-/g, '_') : '';
    const normalized = ['ask_every_time', 'trusted_actions', 'advanced_autonomy'].includes(clean)
      ? clean
      : 'ask_every_time';
    configService.set('setup.permissionPreset', normalized);
    for (const [action, meta] of Object.entries(ACTIONS)) {
      let level = 'ask';
      if (normalized === 'trusted_actions') {
        level = meta.risk === 'low' ? 'once' : 'ask';
      } else if (normalized === 'advanced_autonomy') {
        level = meta.risk === 'low' ? 'always' : 'once';
      }
      if (autonomy) autonomy.setPermission(action, level);
      else configService.set(`autonomy.permissions.${action}`, level);
    }
    return { success: true, preset: normalized };
  });

  // v0.3.8 — autonomy: proactive cards, memory upkeep, approved computer actions, agent tasks, screen help, watchers.
  try {
    autonomy = new AutonomyService({
      electron: electronApi, windowManager, configService, memoryStore, reminderService, readApiKey: readGeminiKey, pushToMain,
      speak: (text) => { if (voiceService?.isLiveActive?.()) voiceService.announce(text); else pushToMain('autonomy:speak', { text }); },
      textModels: (apiKey) => modelDirectory.textOrder(apiKey, configService.get('ai.chatModel') || DEFAULT_GEMINI_MODEL),
      userDataDir: app.getPath('userData'),
    });
    registerAutonomyIpc(ipcMain, autonomy, isTrustedRenderer);
    if (voiceService) voiceService.autonomy = autonomy;
  } catch (error) { console.warn('[NEXORA Autonomy] could not start:', error.message); autonomy = null; }
  return { autonomy };
}

module.exports = { registerIpcHandlers };
