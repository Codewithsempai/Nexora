/* ========================================================================
 * NEXORA — Gemini Live voice, automatic Live model ladder and wake standby.
 * Live WebSocket and credentials stay in Electron main. The renderer supplies
 * microphone PCM and plays returned PCM audio only.
 * ======================================================================== */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { DEFAULT_GEMINI_MODEL } = require('./gemini-client');
const { ModelDirectory, DEFAULT_LIVE_MODEL, classifyFailure, SWITCHABLE_FAILURES } = require('./model-ladder');
const { MEMORY_RULES } = require('./memory-learner');
const { cleanFacts, pickExtractModels } = require('./memory-extractor');
const { applyAssistantCommandsSmart, REMINDER_RULES_LIVE } = require('./assistant-commands');
const { isMuteCommand, mergeTranscriptFragments, pcmRms } = require('./voice-utils');
const { WakeWordService } = require('./wakeword-service');

function getWebSocket() {
  try { return require('ws'); }
  catch { throw new Error('Live voice requires the ws package. Run npm install in the NEXORA folder.'); }
}

const LIVE_MODEL_DEFAULT = DEFAULT_LIVE_MODEL;
const MIC_RATE = 16000;
const VOICE_NAME_DEFAULT = 'Charon';
// v0.3.25: the wake phrase is detected OFFLINE by the ONNX models in assets/wakeword/ (see wakeword-onnx.js). Nothing is sent to Gemini while waiting.

// Gemini Live decides what to remember (like the reference `remember` tool) and calls these; NEXORA saves them.
const LIVE_MEMORY_TOOLS = [{ functionDeclarations: [
  { name: 'save_memory', description: 'Save something the user told you about themselves or asked you to remember (name, age, college, family, city, job, likes, any fact). Call it immediately whenever the user states such a fact, in ANY language. ALWAYS write text and value in English using English letters (தயா -> Daya).',
    parameters: { type: 'OBJECT', properties: {
      category: { type: 'STRING', description: 'Pick the best folder. personal = identity (name, age, college, family, city, job). preferences = likes, dislikes, favourites, habits, how the user wants you to behave. knowledge = any other fact or note to remember. projects = what the user is building, studying for or working on (apps, code, assignments, exams, goals). conversations = a notable decision or topic from this talk that will matter later (use rarely).' },
      text: { type: 'STRING', description: 'One short English sentence about the user, for example: The user is 20 years old / The user name is Daya / The user likes filter coffee' },
      key: { type: 'STRING', description: 'For personal facts only: name | age | birthday | location | work | edu:college | edu:school | edu:university | edu:company | rel:father | rel:mother | rel:brother | rel:sister | rel:wife | rel:husband | rel:friend. For a favourite: fav:<topic>. Omit otherwise.' },
      value: { type: 'STRING', description: 'Just the value in English letters, e.g. Daya, 20, Chennai' } }, required: ['category', 'text'] } },
  { name: 'forget_memory', description: 'Delete a saved memory when the user asks you to forget something.',
    parameters: { type: 'OBJECT', properties: { phrase: { type: 'STRING', description: 'Short English phrase describing what to forget, for example: favourite coffee' } }, required: ['phrase'] } },
  { name: 'set_reminder', description: 'Set a reminder when the user asks to be reminded and gives a clear time.',
    parameters: { type: 'OBJECT', properties: {
      text: { type: 'STRING', description: 'Short task in English' },
      due: { type: 'STRING', description: 'Local date-time YYYY-MM-DDTHH:mm computed from the current time given in the system instruction' },
      repeat: { type: 'STRING', description: 'none | daily | weekdays | weekly | monthly' } }, required: ['text', 'due'] } },
  { name: 'run_task', description: 'Do computer steps for the user: open ANY installed app by name (Discord, WhatsApp, Chrome, VS Code, Spotify, Word…), open folders (downloads, documents, desktop, or a named folder on a drive such as the anime folder in the D drive) or web links, play/search YouTube, search files by name, create a folder, extract a downloaded zip, copy text to the clipboard. NEXORA shows the plan and asks the user to approve each step (the user can just say OK), so call it immediately.',
    parameters: { type: 'OBJECT', properties: { goal: { type: 'STRING', description: 'The goal in short plain English, for example: open VS Code and Chrome / create a folder named nexora-test on the desktop and open it in VS Code' } }, required: ['goal'] } },
  { name: 'explain_screen', description: 'Look at the user screen once and explain it or help with an error shown on it. Call it when the user says explain / check / look at / see my screen. The user may have several monitors: pass target = the app whose screen they mean (for example chrome, brave, vs code, discord), or all for "my screen" / the entire screen / every monitor, or this for the monitor they are on right now.',
    parameters: { type: 'OBJECT', properties: { target: { type: 'STRING', description: 'chrome | brave | edge | vs code | discord | any app name | all | this. Default all.' } } } },
] }];

const { spokenLine } = require('../autonomy/speech');
const TASK_WAIT_MS = 7000;

class VoiceService {
  constructor({ windowManager, popupManager, configService, modelDirectory }) {
    this.windowManager = windowManager;
    this.popupManager = popupManager;
    this.configService = configService;
    this.modelDirectory = modelDirectory || new ModelDirectory();
    this.wakeEnabled = false;
    this.mode = 'offline';
    this.liveSocket = null;
    this.liveReady = false;
    this.liveConnecting = false;
    this.manualStop = false;
    this.liveFailureInProgress = false;
    this.pendingAudio = [];
    this.inputTranscript = '';
    this.outputTranscript = '';
    this.transcriptFlushTimer = null;
    this.sessionTriedModels = new Set();
    this.wakeWord = null;     // WakeWordService (offline ONNX), created by enableWake()
    this.initialText = '';
    this.liveModel = LIVE_MODEL_DEFAULT;
    this.voiceName = VOICE_NAME_DEFAULT;
    this.resumeHandle = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.liveReadyAt = 0;
    this.popupHideTimer = null;
    this.autonomy = null; // set by registerIpcHandlers (v0.3.8)
    this.memoryStore = null; // set by registerIpcHandlers
    this.reminderService = null; // set by registerIpcHandlers
    this.lastActivityAt = Date.now();
    this.idleTimer = null;
    // v0.3.31: graceful standby ("mute" and the one-time wake call finish the spoken answer first)
    this.playbackEndAt = 0; this.toolBusy = 0; this.sessionUserTurns = 0; this.wakeSession = false;
    this.pendingStandbyReason = ''; this.standbyPoll = null; this.standbyStartedAt = 0; this.standbyGraceFrom = 0;
  }

  cancelPendingStandby() {
    if (this.standbyPoll) clearInterval(this.standbyPoll);
    this.standbyPoll = null; this.pendingStandbyReason = '';
  }

  /** Return to wake standby only AFTER NEXORA has finished talking (audio drained, no tool running). reason: 'mute' | 'oneshot'. */
  beginGracefulStandby(reason) {
    this.cancelPendingStandby();
    this.pendingStandbyReason = reason;
    this.standbyStartedAt = Date.now(); this.standbyGraceFrom = this.standbyStartedAt;
    const message = reason === 'oneshot'
      ? 'One-time call finished. Wake standby is active. Say “Hey Nexora” to talk again.' : '';
    this.standbyPoll = setInterval(() => {
      try {
        if (!this.pendingStandbyReason || !this.isLiveActive()) { this.cancelPendingStandby(); return; }
        const now = Date.now();
        if (this.toolBusy > 0) { this.standbyGraceFrom = now; if (now - this.standbyStartedAt < 60000) return; }
        const drained = now >= this.playbackEndAt + 350;
        const graceOver = now - this.standbyGraceFrom >= (reason === 'mute' ? 1600 : 1300);
        const finished = !this.audioInTurn && drained && graceOver;
        const hardLimit = now - this.standbyStartedAt > 20000 && drained;
        if (finished || hardLimit) { const r = this.pendingStandbyReason; this.cancelPendingStandby(); void this.stopLive({ returnToStandby: this.wakeEnabled, hidePopup: true, message: r === 'oneshot' ? message : '' }); }
      } catch { /* never throw from a timer */ }
    }, 200);
    this.standbyPoll.unref?.();
  }

  /** v0.3.11 (JARVIS WAKE_SLEEP_TIMEOUT): a Live session left open streams the microphone forever. After `voice.autoSleepSeconds`
   *  (default 120, 0 = never) with no speech either way, Live closes and NEXORA goes back to wake standby. */
  touchActivity() { this.lastActivityAt = Date.now(); }
  startIdleWatch() {
    this.stopIdleWatch(); this.touchActivity();
    this.idleTimer = setInterval(() => {
      try {
        const seconds = Number(this.configService.get('voice.autoSleepSeconds'));
        const limit = (Number.isFinite(seconds) ? seconds : 120) * 1000;
        if (!limit || !this.wakeEnabled || !this.isLiveActive() || this.mode !== 'listening') return;
        if (this.autonomy?.hasPendingApproval?.()) { this.touchActivity(); return; }
        if (Date.now() - this.lastActivityAt > limit) void this.stopLive({ returnToStandby: true, hidePopup: true, message: `NEXORA went back to sleep after ${Math.round(limit / 1000)} s of silence. Say “Hey Nexora” to wake me.` });
      } catch { /* never throw from a timer */ }
    }, 5000);
    this.idleTimer.unref?.();
  }
  stopIdleWatch() { if (this.idleTimer) clearInterval(this.idleTimer); this.idleTimer = null; }

  memoryPrompt() {
    try {
      const context = this.memoryStore?.buildContext('') || '';
      const rules = this.reminderService ? `\n\n${REMINDER_RULES_LIVE}` : '';
      return context ? `\n\n${MEMORY_RULES}${rules}\n\nUser memory:\n${context}` : rules;
    } catch { return ''; }
  }

  keyFile() { return path.join(app.getPath('userData'), 'gemini-key.enc'); }
  getApiKey() {
    try {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.keyFile())) return null;
      return safeStorage.decryptString(fs.readFileSync(this.keyFile()));
    } catch { return null; }
  }

  getModelConfig() {
    const cfg = this.configService.get('ai') || {};
    const live = typeof cfg.liveModel === 'string' && /^[A-Za-z0-9._-]{3,120}$/.test(cfg.liveModel) ? cfg.liveModel : LIVE_MODEL_DEFAULT;
    const voice = typeof cfg.voiceName === 'string' && /^[A-Za-z]{2,32}$/.test(cfg.voiceName) ? cfg.voiceName : VOICE_NAME_DEFAULT;
    this.liveModel = live;
    this.voiceName = voice;
    return { chat: cfg.chatModel || DEFAULT_GEMINI_MODEL, live, voice };
  }

  setOrbProfile(profile) {
    if (!['nexora', 'nexo', 'nexie', 'robot'].includes(profile)) return { success: false, error: 'Unknown Orb profile.' };
    const saved = this.configService.set('appearance.orbProfile', profile);
    if (!saved) return { success: false, error: 'Could not save Orb profile.' };
    this.popupManager?.setProfile(profile);
    return { success: true, profile };
  }

  getMainContents() {
    const win = this.windowManager.getMainWindow();
    return win && !win.isDestroyed() ? win.webContents : null;
  }

  emit(channel, payload) {
    const contents = this.getMainContents();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  setMode(mode, detail = {}) {
    this.mode = mode;
    const payload = { mode, wakeEnabled: this.wakeEnabled, liveModel: this.liveModel, ...detail };
    this.emit('voice:status', payload);
    const orbMap = { standby: 'idle', wake: 'wake', connecting: 'think', listening: 'listen', thinking: 'think', speaking: 'speak', error: 'error', offline: 'offline' };
    if (this.popupManager && mode !== 'offline' && mode !== 'standby') { this.popupState = orbMap[mode] || 'idle'; this.popupManager.setState(this.popupState); }
    return payload;
  }

  async enableWake() {
    if (this.wakeEnabled) return { success: true, mode: this.mode };
    if (!this.wakeWord) {
      this.wakeWord = new WakeWordService({
        threshold: Number(this.configService.get('voice.wakeThreshold')) || 0.6,
        onWake: (hit) => { void this.onWakeWord(hit); },
        onError: (message) => { console.warn('[NEXORA Wake]', message); if (this.wakeEnabled) this.setMode('error', { message: `Wake word problem: ${message}` }); },
      });
    }
    let words;
    try { words = await this.wakeWord.start(); }
    catch (error) { const message = `Offline wake word could not start: ${this.safeError(error)}`; this.setMode('error', { message }); return { success: false, error: message }; }
    this.wakeEnabled = true;
    this.configService.set('voice.wakeWordEnabled', true);
    this.wakeWord.reset();
    this.popupManager?.create?.();
    if (this.getApiKey()) void this.modelDirectory.discover(this.getApiKey()).catch(() => {});
    const keyNote = this.getApiKey() ? '' : ' Add a Gemini API key in Settings so NEXORA can talk once awake.';
    this.setMode('standby', { message: `Wake standby is on (offline). Say ${words.map((w) => `“${w}”`).join(', ')}.${keyNote}`, wakeWords: words });
    return { success: true, mode: 'standby' };
  }

  async disableWake() {
    this.wakeEnabled = false;
    this.configService.set('voice.wakeWordEnabled', false);
    await this.stopLive({ returnToStandby: false, hidePopup: true });
    this.wakeWord?.stop(); this.wakeWord = null;
    this.popupManager?.hide();
    this.setMode('offline', { message: 'Microphone and wake-word standby are off.' });
    return { success: true };
  }

  /** The ONNX detector heard a wake phrase. */
  setWakeTestMode(active) {
    this.wakeTestMode = !!active;
    try { this.wakeWord?.reset?.(); } catch {}
    return this.wakeTestMode;
  }

  async onWakeWord(hit) {
    if (!this.wakeEnabled) return;
    if (this.wakeTestMode) {
      console.log(`[NEXORA Wake Test] Offline ONNX "${hit.word}" score ${Number(hit.score).toFixed(2)}`);
      this.wakeWord?.reset();
      this.emit('wake-test-hit', { word: hit.word, score: hit.score, at: Date.now() });
      return;
    }
    if (this.liveSocket || this.liveConnecting) return;
    console.log(`[NEXORA Wake] ONNX "${hit.word}" score ${Number(hit.score).toFixed(2)} -> WAKE`);
    this.wakeWord?.reset();
    this.popupManager?.show('wake', this.configService.get('appearance.orbProfile') || 'nexora');
    this.setMode('wake', { message: `NEXORA wake phrase detected (“${hit.word}”).`, wakeWord: hit.word, wakeScore: hit.score });
    // Whatever the user says next is buffered in pendingAudio while Live connects (see pushAudio), so nothing after the wake word is lost.
    this.wakeSession = true; this.sessionUserTurns = 0;
    await this.startLive({ initialAudio: [], initialText: '' });
  }

  emitModelSwitch(type, from, to, reason, attempt, total) {
    const payload = { type, from, to, reason, attempt, total };
    this.emit('voice:model-switch', payload);
    return payload;
  }

  async startLive({ preserveAttempts = false, retryModel = '', initialAudio = null, initialText = '' } = {}) {
    if (this.liveReady) return { success: true, mode: 'listening', model: this.liveModel };
    if (this.liveConnecting) return { success: true, mode: 'connecting', model: this.liveModel };
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const error = 'Gemini API key is not configured. Add it in Settings.';
      this.setMode(this.wakeEnabled ? 'standby' : 'error', { message: error });
      return { success: false, error };
    }
    let WebSocket;
    try { WebSocket = getWebSocket(); }
    catch (error) { const message = this.safeError(error); this.setMode(this.wakeEnabled ? 'standby' : 'error', { message }); return { success: false, error: message }; }

    const { live: selectedModel, voice } = this.getModelConfig();
    if (!preserveAttempts) { this.sessionTriedModels = new Set(); this.resumeHandle = null; this.reconnectAttempts = 0; }
    if (retryModel) this.sessionTriedModels.delete(retryModel);
    this.clearReconnectTimer();
    this.manualStop = false;
    this.liveConnecting = true;
    this.pendingAudio = Array.isArray(initialAudio) ? initialAudio.slice(-240) : [];
    if (initialText) this.initialText = String(initialText).slice(0, 300);
    this.inputTranscript = '';
    this.outputTranscript = '';
    this.clearTranscriptFlush();

    let candidates;
    const first = retryModel || selectedModel;
    try { candidates = await this.modelDirectory.liveOrder(apiKey, first, { exclude: [...this.sessionTriedModels] }); }
    catch { candidates = this.sessionTriedModels.has(first) ? [] : [first]; }
    if (retryModel && !candidates.includes(retryModel) && !this.modelDirectory.isCooling(retryModel)) candidates.unshift(retryModel);
    candidates = candidates.filter((model) => !this.sessionTriedModels.has(model));

    if (!candidates.length) {
      this.liveConnecting = false;
      const message = 'No untried Gemini Live model is currently available. Models may be cooling down after a quota or service error.';
      this.finishLiveFailure(message);
      return { success: false, error: message };
    }

    let lastError = null;
    for (let index = 0; index < candidates.length; index++) {
      if (this.manualStop) break;
      const model = candidates[index];
      this.liveModel = model;
      this.sessionTriedModels.add(model);
      this.setMode('connecting', { message: `Connecting to Gemini Live model ${model} (${index + 1}/${candidates.length})…` });
      console.log(`[NEXORA Live] connecting to ${model} (${index + 1}/${candidates.length}) voice=${voice}`);
      try {
        const socket = await this.connectLiveModel(WebSocket, apiKey, model, voice);
        if (this.manualStop || this.liveSocket !== socket) return { success: false, error: 'Live session was stopped while connecting.' };
        this.modelDirectory.markGood(model);
        this.liveReady = true;
        this.liveReadyAt = Date.now();
        this.liveConnecting = false;
        this.liveFailureInProgress = false;
        this.cancelPopupHide();
        this.setMode('listening', { message: `Live connected · ${model}` });
        console.log(`[NEXORA Live] connected: ${model} — queued mic chunks ${this.pendingAudio.length}, command text ${this.initialText ? 'yes' : 'no'}. If you hear nothing, say something now: Live only speaks after you talk.`);
        this.startIdleWatch();
        this.popupManager?.show('listen', this.configService.get('appearance.orbProfile') || 'nexora');
        const queued = this.pendingAudio.splice(0);
        for (const audio of queued) this.sendLiveAudio(audio);
        if (this.initialText) {
          const said = this.initialText; this.initialText = '';
          try { socket.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: said }] }], turnComplete: true } })); } catch { /* the user can simply repeat it */ }
          this.emit('voice:caption', { role: 'user', text: said, finished: true });
        }
        return { success: true, mode: 'listening', model };
      } catch (error) {
        lastError = error;
        console.warn(`[NEXORA Live] ${model} FAILED: ${String(error?.message || error).slice(0, 200)} (status ${error?.status || 'n/a'})`);
        if (this.liveSocket) {
          const failedSocket = this.liveSocket;
          this.liveSocket = null;
          try { failedSocket.close(); } catch { try { failedSocket.terminate(); } catch {} }
        }
        const kind = classifyFailure(error);
        this.modelDirectory.markBad(model, kind, error.message);
        this.liveReady = false;
        if (index + 1 < candidates.length && SWITCHABLE_FAILURES.has(kind)) {
          const next = candidates[index + 1];
          this.emitModelSwitch('live', model, next, kind, index + 2, candidates.length);
          continue;
        }
        break;
      }
    }

    this.liveConnecting = false;
    const message = this.safeError(lastError || new Error('Gemini Live could not connect.'));
    if (!this.manualStop) this.finishLiveFailure(message);
    return { success: false, error: message };
  }

  connectLiveModel(WebSocket, apiKey, model, voice) {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { handshakeTimeout: 15000, perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
      this.liveSocket = socket;
      let settled = false;
      let setupFailed = false;
      const timer = setTimeout(() => {
        const error = new Error(`Gemini Live setup timed out for ${model}.`);
        error.status = 504;
        finishReject(error);
        try { socket.terminate(); } catch {}
      }, 18000);
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      };
      const finishReject = (error) => {
        if (settled) return;
        setupFailed = true;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      socket.once('open', () => {
        const setup = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
            systemInstruction: { parts: [{ text: 'You are NEXORA, a real-time desktop AI assistant created for and owned by codewithsempai_daya. Respond naturally and concisely. ALWAYS speak and reply in Tanglish (Tamil mixed with simple English, like a friendly Chennai friend: \"Sure Daya, naan paathukaren\"). The user speaks ONLY English, Tamil or Tanglish (an Indian accent) - never Hindi or any other language, so never reply in or assume another language. Listen carefully and answer exactly what was asked. Only reply to clear speech directed at you: if it is just noise, an echo of your own voice, background talk or too unclear to understand, stay silent or say only \"Sorry, marupadi sollunga?\" - never guess or invent a question and answer it. Memory is saved in English. Let the user interrupt you. If the user says only \"mute\", reply with one very short phrase like \"Seri, mute panren.\" and nothing else (the app mutes you after you finish speaking); never say you cannot mute. Do not claim to have performed desktop actions unless an authorized tool actually did them. When the user tells you ANY fact about themselves (name, age, college, family, city, job, likes) or says remember / forget something, FIRST call the save_memory / forget_memory tool (text in English letters), THEN confirm in one short Tanglish sentence. When the user asks for a reminder with a time, call set_reminder. When the user asks you to open apps / folders / links, search files, create a folder, extract a zip or do several computer steps: FIRST say one very short phrase like "Seri, panren.", THEN call run_task (any installed app can be opened, for example Discord, and folders on other drives too). If the result says waiting, tell the user in one short sentence to say "OK" or tap Allow on the card. The tool result comes back within seconds: say its summary in ONE short Tanglish sentence right away (for example "Calculator open pannitten"); never stay silent after a task and never claim it is done before the result says done. When they ask you to explain, check or see their screen, call explain_screen with target: the app they name (chrome, brave…), all for \"my screen\" / the entire screen, or this. If the user only says OK / allow / no while a permission card is open, do not answer it with a long reply: NEXORA presses the button itself, you say nothing or just \"Seri\". Choose the right category every time: preferences for likes/dislikes/habits, projects for what the user is building or working on, knowledge for other facts, personal for identity. Never say you saved something unless the tool returned saved. Current local time: ' + new Date().toString() + '.' + this.memoryPrompt() }] },
            tools: LIVE_MEMORY_TOOLS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', prefixPaddingMs: 300, silenceDurationMs: 800 } },
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
          },
        };
        try { socket.send(JSON.stringify(setup)); }
        catch (error) { finishReject(error); }
      });
      socket.on('message', (data) => {
        let message;
        try { message = JSON.parse(Buffer.from(data).toString('utf8')); } catch { return; }
        if (message.setupComplete) {
          finishResolve();
          return;
        }
        if (message.error) {
          const error = new Error(message.error.message || `Gemini Live rejected ${model}.`);
          error.status = message.error.code || message.error.status || 0;
          if (!settled) finishReject(error);
          else this.handleLiveFailure(error, socket);
          return;
        }
        if (settled && this.liveSocket === socket) this.handleLiveMessage(message);
      });
      socket.on('unexpected-response', (_request, response) => {
        const chunks = [];
        response.on('data', (chunk) => { if (Buffer.concat(chunks).length < 64_000) chunks.push(Buffer.from(chunk)); });
        response.on('end', () => {
          let detail = '';
          try { const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); detail = payload?.error?.message || ''; } catch {}
          const error = new Error(detail || `Gemini Live HTTP ${response.statusCode} for ${model}.`);
          error.status = response.statusCode;
          finishReject(error);
        });
      });
      socket.once('error', (error) => {
        if (!settled) finishReject(error);
        else if (!setupFailed) this.handleLiveFailure(error, socket);
      });
      socket.on('close', (code, reason) => {
        const detail = reason ? Buffer.from(reason).toString('utf8').slice(0, 180) : `WebSocket close code ${code}`;
        if (!settled) {
          const error = new Error(`Gemini Live closed during setup for ${model}: ${detail}`);
          error.status = code === 1013 ? 429 : code === 1011 ? 503 : code === 1008 ? 400 : 0;
          finishReject(error);
        } else if (!setupFailed) {
          this.handleLiveClose(code, reason, socket);
        }
      });
    });
  }

  /** Memory was cleared / something forgotten: drop the old session context so the old name is not repeated. */
  onMemoryRemoved() {
    this.resumeHandle = null;
    const socket = this.liveSocket;
    if (!socket || socket.readyState !== 1 || !this.liveReady) return;
    try { socket.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'SYSTEM NOTE: the user cleared or edited NEXORA memory. Forget every personal fact (name, college, family, likes) mentioned earlier in this conversation; it is no longer saved. If asked, say you do not know it.' }] }], turnComplete: false } })); } catch { /* best effort */ }
  }

  /** v0.3.7: ANY memory change (saved by voice, chat, the auto-extractor or the Memory tab) is pushed into the running Live
   *  session, so "என்னோட பேர் என்ன?" / "what is my name?" is answered from the CURRENT vault, not from the memory the
   *  session started with. Debounced; best effort; never triggers a spoken reply (turnComplete:false). */
  onMemoryChanged() {
    if (this.memorySyncTimer) clearTimeout(this.memorySyncTimer);
    this.memorySyncTimer = setTimeout(() => { this.memorySyncTimer = null; this.syncMemoryToLive(); }, 350);
  }

  syncMemoryToLive() {
    const socket = this.liveSocket;
    if (!socket || socket.readyState !== 1 || !this.liveReady) return;
    let context = '';
    try { context = this.memoryStore?.buildContext('') || ''; } catch { /* ignore */ }
    const note = 'SYSTEM NOTE: NEXORA memory was just updated. The list below is the complete CURRENT memory and the ONLY source of personal facts. '
      + 'If the user asks their name, age, college, family, city or project, answer from this list in Tanglish. If a fact is not in it, say you do not know it yet. '
      + 'Ignore anything you said earlier like "I do not know your name" when the list below now has it.\n\nUser memory:\n' + (context || '(nothing saved)');
    try { socket.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: false } })); } catch { /* best effort */ }
  }

  sendLiveAudio(base64) {
    const socket = this.liveSocket;
    if (!socket || socket.readyState !== 1 || !this.liveReady) return false;
    try {
      socket.send(JSON.stringify({ realtimeInput: { audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } } }));
      return true;
    } catch { return false; }
  }

  sendOrbLevel(pcm, gain) {
    const now = Date.now();
    if (now - (this.lastLevelAt || 0) < 50) return;
    this.lastLevelAt = now;
    this.popupManager?.setLevel?.(Math.min(1, pcmRms(pcm) * gain));
  }

  pushAudio(base64) {
    if (typeof base64 !== 'string' || base64.length > 30000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return;
    const pcm = Buffer.from(base64, 'base64');
    if (pcm.length < 2 || pcm.length > 16384) return;
    if (this.liveReady) { if (this.pendingStandbyReason === 'mute') return; if (this.mode === 'listening') this.sendOrbLevel(pcm, 6); this.sendLiveAudio(base64); return; }
    if (this.liveConnecting) {
      if (this.pendingAudio.length < 240) this.pendingAudio.push(base64);     // ~10 s: the user keeps talking while Live connects
      return;
    }
    if (this.wakeEnabled) this.wakeWord?.feed(pcm);
  }

  clearTranscriptFlush() {
    if (this.transcriptFlushTimer) clearTimeout(this.transcriptFlushTimer);
    this.transcriptFlushTimer = null;
  }

  scheduleTranscriptFlush(delay = 650) {
    this.clearTranscriptFlush();
    // A lone mute command is acted on quickly; if more words follow, the transcript is re-evaluated.
    const wait = isMuteCommand(this.inputTranscript) ? Math.min(delay, 250) : delay;
    this.transcriptFlushTimer = setTimeout(() => this.flushInputTranscript(), wait);
  }

  flushInputTranscript() {
    this.clearTranscriptFlush();
    const heard = this.inputTranscript.trim();
    this.inputTranscript = '';
    if (!heard) return false;
    this.turnEndAt = Date.now(); this.firstAudioLogged = false;   // v0.3.12: reply-latency measurement
    this.emit('voice:caption', { role: 'user', text: heard, finished: true });
    if (!isMuteCommand(heard)) { this.sessionUserTurns += 1; if (this.pendingStandbyReason === 'oneshot') this.cancelPendingStandby(); }
    // v0.3.10: "OK" / "allow" / "no" while a permission card is open presses the button (no mouse needed).
    try { if (this.autonomy?.hasPendingApproval?.() && this.autonomy.voiceApprove(heard).handled) { this.setMode('thinking', { message: 'Answered the card by voice.' }); return false; } } catch { /* ignore */ }
    // v0.3.8: "Nexora, stop" cancels a running task; "later" while a reminder is waiting offers a new time.
    try { if (this.autonomy?.isStopPhrase(heard)) this.autonomy.stopTask(); else this.autonomy?.proactive?.maybeLater?.(heard); } catch { /* ignore */ }
    if (!isMuteCommand(heard) && (this.memoryStore || this.reminderService)) {
      // Reminders first ("remind me to … at …"), then memory ("remember that …", "forget …"). Saves are pushed to the UI live.
      // Regex first (instant), then Gemini understanding for Tamil / Tanglish / any wording. Saves are pushed to the UI live.
      const apiKey = this.getApiKey();
      void (async () => applyAssistantCommandsSmart({ memoryStore: this.memoryStore, reminderService: this.reminderService, text: heard, source: 'voice', apiKey, models: apiKey ? await pickExtractModels(this.modelDirectory, apiKey, this.configService.get('ai.chatModel')) : null }))()
        .then((outcome) => { if (outcome.saved.length || outcome.forgotten.length || outcome.reminders.length) this.emit('voice:memory', outcome); })
        .catch(() => {});
    }
    if (isMuteCommand(heard)) {
      // “mute” ends the current Live session but intentionally keeps the microphone
      // capture alive in wake standby. The transparent Orb popup returns to idle.
      // v0.3.31: do NOT cut NEXORA off mid-sentence — finish speaking, then go back to wake standby.
      this.beginGracefulStandby('mute');
      return true;
    }
    this.setMode('thinking', { message: 'Processing your spoken request.' });
    return false;
  }

  /** Gemini Live asked us to run a memory / reminder tool. Always answers, so the model never hangs. */
  /** v0.3.9: run_task / explain_screen now WAIT for the result (max ~7 s / 15 s) and hand it to Gemini, so it says
   *  "I opened Calculator" right away instead of a late, vague "started". Slower tasks are announced when they finish. */
  async handleLiveToolCall(toolCall) {
    this.toolBusy += 1;
    try { return await this.runLiveToolCall(toolCall); } finally { this.toolBusy = Math.max(0, this.toolBusy - 1); this.standbyGraceFrom = Date.now(); }
  }

  async runLiveToolCall(toolCall) {
    const socket = this.liveSocket;
    const responses = [];
    for (const call of toolCall?.functionCalls || []) {
      let result = { result: 'error' };
      try {
        const args = call.args || {};
        if (call.name === 'save_memory' && this.memoryStore) {
          const fact = cleanFacts([{ category: args.category, key: args.key, value: args.value, text: args.text }])[0];
          if (!fact) result = { result: 'rejected', reason: 'empty or sensitive (passwords / OTP / card numbers are never saved)' };
          else {
            const r = this.memoryStore.add(fact.category, fact.text, { key: fact.key, value: fact.value, source: 'voice' });
            result = r?.success ? { result: 'saved', saved: fact.text } : { result: 'error', reason: r?.error || 'save failed' };
            if (r?.success) this.emit('voice:memory', { saved: [fact.text], forgotten: [], reminders: [] });
          }
        } else if (call.name === 'forget_memory' && this.memoryStore) {
          const r = this.memoryStore.forget(String(args.phrase || ''));
          result = r?.success ? { result: r.removed?.length ? 'forgotten' : 'nothing matched', removed: r.removed || [] } : { result: 'error' };
          if (r?.removed?.length) this.emit('voice:memory', { saved: [], forgotten: r.removed, reminders: [] });
        } else if (call.name === 'run_task' && this.autonomy) {
          const goal = String(args.goal || '').slice(0, 600);
          if (!goal.trim()) result = { result: 'error', reason: 'empty goal' };
          else {
            const task = this.autonomy.runTask(goal, { source: 'voice', speak: false });
            const settled = await Promise.race([task, new Promise((r) => setTimeout(() => r(null), this.taskWaitMs || TASK_WAIT_MS))]);
            if (settled) result = { result: settled.success ? 'done' : (settled.cancelled ? 'cancelled' : 'failed'), summary: spokenLine(settled), instruction: 'Tell the user this now in ONE short friendly Tanglish sentence, for example: Calculator open pannitten.' };
            else {
              result = { result: 'waiting', summary: 'NEXORA is waiting for the user to press Allow on the card at the top-right of the screen.', instruction: 'Tell the user in ONE short Tanglish sentence to approve on the card. Do not say it is done.' };
              task.then((res) => this.announceTask(res)).catch(() => {});
            }
          }
        } else if (call.name === 'explain_screen' && this.autonomy) {
          const shot = this.autonomy.explainScreen({ source: 'voice', target: String(args.target || 'all').slice(0, 40) });
          const settled = await Promise.race([shot, new Promise((r) => setTimeout(() => r(null), 15000))]);
          if (settled?.success) result = { result: 'ok', screen: String(settled.text || '').slice(0, 900), instruction: 'Explain this to the user in at most 3 short Tanglish sentences. The full answer is also on a card.' };
          else if (settled) result = { result: 'failed', summary: String(settled.error || 'could not read the screen').slice(0, 140), instruction: 'Tell the user briefly in Tanglish.' };
          else { result = { result: 'waiting', summary: 'Still looking at the screen; the answer will appear on a card.' }; shot.then((r) => { if (r?.success) this.announce(`Screen answer: ${String(r.text).slice(0, 700)}`); }).catch(() => {}); }
        } else if (call.name === 'set_reminder' && this.reminderService) {
          const dueAt = new Date(String(args.due || '')).getTime();
          if (!Number.isFinite(dueAt)) result = { result: 'error', reason: 'invalid time, ask the user for the time again' };
          else if (dueAt <= Date.now() + 1000) result = { result: 'error', reason: 'that time has already passed, ask for a later time' };
          else {
            const repeat = ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(args.repeat) ? args.repeat : 'none';
            const r = this.reminderService.add({ text: String(args.text || '').slice(0, 300), dueAt, repeat, source: 'voice' });
            result = r?.success ? { result: 'reminder set' } : { result: 'error' };
          }
        }
      } catch (error) { result = { result: 'error', reason: String(error.message || error).slice(0, 120) }; }
      responses.push({ id: call.id, name: call.name, response: result });
    }
    try { if (socket && socket.readyState === 1) socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } })); } catch { /* best effort */ }
  }

  isLiveActive() { return !!this.liveSocket && this.liveSocket.readyState === 1 && this.liveReady; }

  /** Make the Live model SAY something now (turnComplete:true makes it answer). */
  announce(text) {
    const socket = this.liveSocket; if (!this.isLiveActive()) return false;
    try { socket.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: `SYSTEM EVENT (not spoken by the user): ${String(text).slice(0, 800)}\nSay this to the user now in ONE or TWO short friendly Tanglish sentences. Do not ask a question.` }] }], turnComplete: true } })); return true; } catch { return false; }
  }
  announceTask(res) { const line = spokenLine(res); if (!line) return; if (!this.announce(`Task finished: ${line}`)) this.autonomy?.speak?.(line); }

  handleLiveMessage(message) {
    if (message.toolCall) { this.touchActivity(); void this.handleLiveToolCall(message.toolCall); return; }
    if (message.error) { this.handleLiveFailure(new Error(message.error.message || 'Gemini Live error.'), this.liveSocket); return; }
    const update = message.sessionResumptionUpdate;
    if (update && update.resumable !== false && typeof update.newHandle === 'string' && update.newHandle) this.resumeHandle = update.newHandle;
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      this.emit('voice:audio-stop', {});
      this.setMode('listening', { message: 'Response interrupted. Listening.' });
    }
    const input = content.inputTranscription;
    if (input?.text) {
      this.touchActivity();
      this.inputTranscript = mergeTranscriptFragments(this.inputTranscript, input.text);
      this.emit('voice:caption', { role: 'user', text: this.inputTranscript, finished: false });
      if (input.finished === true) { if (this.flushInputTranscript()) return; }
      else if (content.speechState === 'NON_SPEECH') this.scheduleTranscriptFlush(220);
      else this.scheduleTranscriptFlush(650);
    }
    if (content.turnComplete || content.generationComplete) {
      if (this.inputTranscript.trim()) {
        if (this.flushInputTranscript()) return;
      }
    }
    if (content.outputTranscription?.text) {
      this.outputTranscript = mergeTranscriptFragments(this.outputTranscript, content.outputTranscription.text);
      this.emit('voice:caption', { role: 'assistant', text: this.outputTranscript, finished: false });
      if (content.outputTranscription.finished === true) {
        this.emit('voice:caption', { role: 'assistant', text: this.outputTranscript, finished: true });
        this.outputTranscript = '';
      }
    }
    const parts = content.modelTurn?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        this.touchActivity();
        if (this.turnEndAt && !this.firstAudioLogged) { this.firstAudioLogged = true; const ms = Date.now() - this.turnEndAt; console.log(`[NEXORA Live] reply latency: ${ms} ms after you finished speaking (${this.liveModel})`); this.emit('voice:latency', { ms, model: this.liveModel }); }
        const mime = part.inlineData.mimeType || 'audio/pcm;rate=24000';
        const match = /rate=(\d+)/i.exec(mime);
        if (!this.audioInTurn) { this.audioInTurn = true; console.log(`[NEXORA Live] audio from ${this.liveModel} is arriving (${part.inlineData.mimeType || 'pcm'})`); }
        const outRate = match ? Number(match[1]) : 24000;
        try { const ms = (part.inlineData.data.length * 0.75 / 2) / (outRate || 24000) * 1000; this.playbackEndAt = Math.max(Date.now(), this.playbackEndAt) + ms; } catch { /* estimate only */ }
        if (this.pendingStandbyReason) this.standbyGraceFrom = Date.now();
        this.emit('voice:audio-output', { data: part.inlineData.data, sampleRate: outRate });
        try { this.sendOrbLevel(Buffer.from(part.inlineData.data, 'base64'), 4); } catch {}
        if (this.mode !== 'speaking') this.setMode('speaking', { message: 'NEXORA is speaking.' });
      }
      if (typeof part.text === 'string' && part.text) this.emit('voice:caption', { role: 'assistant', text: part.text, finished: false });
    }
    if (content.turnComplete || content.generationComplete) {
      if (content.turnComplete && !this.audioInTurn && this.turnEndAt) console.warn(`[NEXORA Live] turn finished but ${this.liveModel} sent NO audio. Check the Live model name and voice (${this.voiceName}) in Settings.`);
      if (content.turnComplete) this.audioInTurn = false;
      if (content.turnComplete && this.wakeSession && this.wakeEnabled && this.sessionUserTurns > 0 && !this.pendingStandbyReason && this.configService.get('voice.wakeOneShot') === true) this.beginGracefulStandby('oneshot');
      if (this.mode === 'speaking' || this.mode === 'thinking') this.setMode('listening', { message: `Live connected · ${this.liveModel}` });
      this.outputTranscript = '';
    }
  }

  handleLiveFailure(error, socket = this.liveSocket) {
    if (this.manualStop || this.liveFailureInProgress) return;
    if (socket && this.liveSocket !== socket) return;
    this.liveFailureInProgress = true;
    const model = this.liveModel;
    const message = this.safeError(error);
    const kind = classifyFailure(error);
    // Gemini periodically recycles Live sockets (close 1000/1011/1006). That is not a bad model:
    // reconnect to the same model (with the resumption handle) instead of cooling it down.
    const transient = this.liveReady && ['server', 'offline', 'other'].includes(kind);
    if (!transient) this.modelDirectory.markBad(model, kind, message);
    this.liveReady = false;
    this.liveConnecting = false;
    this.liveSocket = null;
    this.pendingAudio = [];
    this.clearTranscriptFlush();
    this.inputTranscript = '';
    try { socket?.close(1011, 'Live session error'); } catch {}
    this.emit('voice:audio-stop', {});

    if (transient && this.reconnectSameModel(model, message)) return;

    if (SWITCHABLE_FAILURES.has(kind)) {
      const nextCandidatesPromise = this.modelDirectory.liveOrder(this.getApiKey(), this.getModelConfig().live, { exclude: [...this.sessionTriedModels] });
      void nextCandidatesPromise.then((models) => {
        const next = models.find((candidate) => candidate !== model && !this.sessionTriedModels.has(candidate));
        if (next && !this.manualStop && !this.liveSocket) {
          this.liveFailureInProgress = false;
          this.emitModelSwitch('live', model, next, kind, this.sessionTriedModels.size + 1, models.length);
          return this.startLive({ preserveAttempts: true });
        }
        this.liveFailureInProgress = false;
        this.finishLiveFailure(message);
      }).catch(() => {
        this.liveFailureInProgress = false;
        this.finishLiveFailure(message);
      });
    } else {
      this.liveFailureInProgress = false;
      this.finishLiveFailure(message);
    }
  }

  clearReconnectTimer() { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

  reconnectSameModel(model, message) {
    // A session that lived a while earns a fresh retry budget.
    if (this.liveReadyAt && Date.now() - this.liveReadyAt > 30000) this.reconnectAttempts = 0;
    if (this.reconnectAttempts >= 5) return false;
    this.reconnectAttempts++;
    const delay = Math.min(700 * 2 ** (this.reconnectAttempts - 1), 8000);
    this.setMode('connecting', { message: `Live connection dropped. Reconnecting (${this.reconnectAttempts}/5)…` });
    this.clearReconnectTimer();
    this.liveFailureInProgress = false;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualStop || this.liveSocket || this.liveReady || this.liveConnecting) return;
      void this.startLive({ preserveAttempts: true, retryModel: model }).then((result) => {
        if (result && !result.success && !this.liveReady && !this.liveConnecting && !this.reconnectTimer && !this.manualStop && this.mode === 'connecting') this.finishLiveFailure(result.error || message);
      });
    }, delay);
    return true;
  }

  handleLiveClose(code, reason, socket) {
    try { console.warn(`[NEXORA Live] connection closed: code ${code} ${reason ? Buffer.from(reason).toString('utf8').slice(0, 160) : ''}`); } catch { /* logging only */ }
    if (!socket || this.liveSocket !== socket || this.manualStop) return;
    const detail = reason ? Buffer.from(reason).toString('utf8').slice(0, 180) : `WebSocket close code ${code}`;
    const error = new Error(`Gemini Live disconnected: ${detail}`);
    if (code === 1013) error.status = 429;
    else if (code === 1011) error.status = 503;
    else if (code === 1008) error.status = 400;
    else if (code === 1000) error.status = 503;
    else if (code === 1006) error.code = 'ECONNRESET';
    this.handleLiveFailure(error, socket);
  }

  finishLiveFailure(message) {
    this.stopIdleWatch();
    this.liveConnecting = false;
    this.liveReady = false;
    this.emit('voice:audio-stop', {});
    if (this.wakeEnabled) {
      this.popupManager?.show('error', this.configService.get('appearance.orbProfile') || 'nexora');
      this.schedulePopupHide(2500);
      this.setMode('standby', { message: `Live is unavailable. Wake standby remains active. ${message}` });
    } else {
      this.setMode('error', { message });
      this.popupManager?.show('error', this.configService.get('appearance.orbProfile') || 'nexora');
      this.schedulePopupHide(4000);
    }
  }

  schedulePopupHide(delay) {
    this.cancelPopupHide();
    this.popupHideTimer = setTimeout(() => { this.popupHideTimer = null; if (!this.liveReady && !this.liveConnecting && !this.liveSocket) this.popupManager?.hide(); }, delay);
  }

  cancelPopupHide() { if (this.popupHideTimer) clearTimeout(this.popupHideTimer); this.popupHideTimer = null; }

  async stopLive({ returnToStandby = this.wakeEnabled, hidePopup = true, message = '' } = {}) {
    this.manualStop = true;
    this.cancelPendingStandby(); this.wakeSession = false; this.sessionUserTurns = 0; this.playbackEndAt = 0; this.audioInTurn = false;
    this.stopIdleWatch();
    this.sessionTriedModels = new Set();
    this.resumeHandle = null;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.cancelPopupHide();
    this.wakeWord?.reset();
    this.clearTranscriptFlush();
    this.inputTranscript = '';
    const socket = this.liveSocket;
    this.liveSocket = null;
    this.liveReady = false;
    this.liveConnecting = false;
    this.pendingAudio = [];
    this.liveFailureInProgress = false;
    this.emit('voice:audio-stop', {});
    if (socket) { try { socket.close(1000, 'User stopped Live'); } catch {} }
    if (returnToStandby && this.wakeEnabled) {
      // Mute: the Orb hides; the microphone stays in wake standby until a wake phrase shows it again.
      if (hidePopup) this.popupManager?.hide();
      else this.popupManager?.show('idle', this.configService.get('appearance.orbProfile') || 'nexora');
      this.setMode('standby', { message: message || 'Live muted. Orb hidden. Wake standby is active. Say “Hey Nexora”, “Nexora”, “Hey Nexo” or “Nexo” to talk again.', hidden: true });
    } else {
      if (hidePopup) this.popupManager?.hide();
      this.setMode('offline', { message: 'Live voice is off.' });
    }
    this.manualStop = false;
    return { success: true, mode: this.mode };
  }

  async shutdown() {
    this.wakeEnabled = false;
    this.stopIdleWatch();
    this.clearReconnectTimer();
    this.cancelPopupHide();
    await this.stopLive({ returnToStandby: false, hidePopup: true });
    // v0.3.33: the ONNX wake worker thread must be terminated or the process never exits ("Another instance is already running")
    try { this.wakeWord?.stop(); } catch { /* ignore */ }
    this.wakeWord = null;
  }

  safeError(error) {
    const value = String(error?.message || error || 'Unknown Gemini error.');
    return value.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').slice(0, 500);
  }
}

module.exports = { VoiceService, LIVE_MODEL_DEFAULT };
