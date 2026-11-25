/* ==========================================================================
   NEXORA — Primary Renderer Application Coordinator & Centralized Panel Manager
   Single source of truth for Panel state (CORE, CHAT, TELEMETRY, SETTINGS),
   Orb State coordination, procedural acoustic feedback, and responsive layout.
   ========================================================================== */

import { OrbStateManager, ORB_STATES } from '../orb/orb-state.js';
import { OrbEngine } from '../orb/orb-engine.js';
import { RobotStudio } from '../orb/robot-studio.js';
import { StudioPanels } from '../orb/studio-panels.js';
import { SoundSystem } from '../audio/sound-system.js';
import { VoiceAudio } from '../audio/voice-audio.js';
import { Titlebar } from '../components/titlebar.js';
import { Navigation, NAV_ITEMS } from '../components/navigation.js';
import { ChatPanel } from '../chat/chat-panel.js';
import { StatusPanel } from '../status/status-panel.js';
import { SettingsPanel } from '../settings/settings-panel.js';
import { MemoryPanel } from '../memory/memory-panel.js';
import { ReminderPanel } from '../reminders/reminder-panel.js';
import { ToastCenter } from '../components/toast.js';
import { AutonomyPanel } from '../autonomy/autonomy-panel.js';
import { SetupWizard } from '../setup/setup-wizard.js';

export const PANELS = {
  CORE: 'core',
  MEMORY: 'memory',
  REMINDER: 'reminder',
  AUTONOMY: 'autonomy',
  CHAT: 'chat',
  TELEMETRY: 'telemetry',
  SETTINGS: 'settings',
  ORB: 'orb',
};

class NexoraApp {
  constructor() {
    this.orbStateManager = new OrbStateManager(ORB_STATES.IDLE);
    this.soundSystem = new SoundSystem();
    this.voiceAudio = new VoiceAudio();
    this.lastVoiceMode = null;
    this.orbEngine = null;
    this.titlebar = null;
    this.navigation = null;
    this.chatPanel = null;
    this.statusPanel = null;
    this.settingsPanel = null;
    this.memoryPanel = null;
    this.reminderPanel = null;
    this.toasts = null;
    this.shownReminderAlerts = new Set();

    // Single source of truth for panel state
    this.activePanel = PANELS.CORE;
  }

  async init() {
    console.log('[NEXORA App] Booting Phase 1 Assistant...');

    // 1. Initialize Audio System & VoiceAudio from saved config (decoupled capture/playback)
    if (window.nexoraAPI?.config) {
      try {
        const audioCfg = await window.nexoraAPI.config.get('audio');
        if (audioCfg) {
          this.soundSystem.applyConfig?.(audioCfg);
          this.voiceAudio.applyConfig?.(audioCfg);
        }
      } catch (e) {}
    }

    // 2. Unlock Web Audio on first user interaction
    const unlockAudio = () => {
      this.soundSystem.ensureContext();
      this.soundSystem.resumeIfReady?.();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    // 3. Initialize Titlebar
    const titlebarContainer = document.getElementById('titlebarContainer');
    this.titlebar = new Titlebar(titlebarContainer, {
      onSound: (name) => this.playSound(name),
    });

    // 4. Initialize Navigation
    const navContainer = document.getElementById('navContainer');
    this.navigation = new Navigation(navContainer, {
      onSound: (name) => this.playSound(name),
      onNavigate: (target) => this.handleNavigation(target),
    });

    // 5. Initialize Golden Holographic Orb Engine
    const orbCanvas = document.getElementById('orbCanvas');
    this.orbEngine = new OrbEngine(orbCanvas, this.orbStateManager);
    try {
      const savedPerformanceMode = await window.nexoraAPI?.config?.get('performance.mode');
      this.orbEngine.setPerformanceMode(savedPerformanceMode || 'medium');
      const savedProfile = await window.nexoraAPI?.config?.get('appearance.orbProfile');
      // The Frosted Chrome Glass home design is robot-first. Migrate only the old
      // default particle profile; other saved profile choices remain untouched.
      const initialProfile = (!savedProfile || savedProfile === 'nexora') ? 'robot' : savedProfile;
      this.orbEngine.setProfile(initialProfile);
      if (initialProfile !== savedProfile) {
        await window.nexoraAPI?.config?.set?.('appearance.orbProfile', initialProfile);
        await window.nexoraAPI?.voice?.setOrbProfile?.(initialProfile);
      }
    } catch (error) { console.warn('[NEXORA UI] Could not apply the default robot profile:', error?.message || error); }
    // Count actual robot render frames for the Telemetry page. No separate permanent RAF loop.
    this.orbEngine.onFrame = () => this.statusPanel?.recordFrame();
    this.orbEngine.start();
    this._orbVisibilityHandler = () => {
      if (document.hidden) this.orbEngine?.stop();
      else if (this.activePanel === PANELS.CORE || this.activePanel === PANELS.ORB) this.orbEngine?.start();
    };
    document.addEventListener('visibilitychange', this._orbVisibilityHandler);

    // 6. Hook Quick State Controls
    this.initQuickStateButtons();
    this.initOrbStudioControls();
    this.initPopupOrbStudio();

    // 7. Initialize Panels
    this.initPanels();
    this.initCoreComposer();
    this.initLiveMemoryAndReminders();

    // 8. Subscribe Orb State Changes to UI
    this.orbStateManager.subscribe(({ currentState, config }) => {
      this.titlebar.setStatus(config.label.toUpperCase(), currentState === ORB_STATES.OFFLINE ? 'offline' : 'active');
      this.updateQuickStateButtons(currentState);
    });

    // 9. Global IPC Event Listeners
    if (window.nexoraAPI?.hotkeys) {
      window.nexoraAPI.hotkeys.onActivated(() => {
        this.playSound('wake');
        this.orbStateManager.setState(ORB_STATES.WAKE);
      });
    }

    if (window.nexoraAPI?.assistant) {
      window.nexoraAPI.assistant.onToggleListen(() => {
        const cur = this.orbStateManager.getState();
        if (cur === ORB_STATES.LISTEN) {
          this.orbStateManager.setState(ORB_STATES.IDLE);
          this.playSound('modeSwitch');
        } else {
          this.orbStateManager.setState(ORB_STATES.LISTEN);
          this.playSound('listening');
        }
      });
    }

    // 9b. Real Gemini Live voice session and wake-word bridge.
    const voiceApi = window.nexoraAPI?.voice;
    // Real mic / voice-output loudness drives the Orb while listening / speaking.
    this.voiceAudio.onLevel = (kind, rms) => {
      const mode = this.lastVoiceMode;
      if ((kind === 'mic' && mode === 'listening') || (kind === 'out' && mode === 'speaking')) {
        this.orbStateManager.setAudioLevel(Math.min(1, rms * (kind === 'mic' ? 6 : 4)));
      }
    };
    setInterval(() => this.orbStateManager.setAudioLevel(this.orbStateManager.getAudioLevel() * 0.78), 100);
    // v0.3.11: the mic watchdog reports when it had to restart a dead / suspended microphone.
    this.voiceAudio.onHealth = (message, ok) => { this.settingsPanel?.setVoiceStatus({ mode: ok ? (this.lastVoiceMode || 'standby') : 'error', wakeEnabled: true, message }); };
    voiceApi?.onStatus?.((payload) => this.handleVoiceStatus(payload));
    voiceApi?.onAudioOutput?.((payload) => { void this.voiceAudio.playPcm(payload); });
    voiceApi?.onAudioStop?.(() => this.voiceAudio.stopPlayback());
    voiceApi?.onCaption?.((payload) => this.handleVoiceCaption(payload));
    voiceApi?.onModelSwitch?.((payload) => {
      const type = payload?.type === 'live' ? 'LIVE' : 'WAKE';
      this.settingsPanel?.setVoiceStatus({ mode: this.lastVoiceMode || 'connecting', message: `${type} model ladder: ${payload.from} failed (${payload.reason}); trying ${payload.to}.` });
    });

    try { this.captionsInChat = (await window.nexoraAPI?.config?.get('voice.captionsInChat')) === true; } catch { this.captionsInChat = false; }
    // Show first-run guided setup wizard until initial setup has completed; otherwise restore wake listening if enabled.
    let setupCompleted = true;
    try {
      setupCompleted = (await window.nexoraAPI?.config?.get?.('setup.completed')) === true;
    } catch {
      setupCompleted = true;
    }
    if (!setupCompleted) {
      setTimeout(() => { void this.openSetupWizard(); }, 180);
    } else {
      try {
        const wakeEnabled = await window.nexoraAPI?.config?.get('voice.wakeWordEnabled');
        if (wakeEnabled === true) {
          setTimeout(() => { void this.startWakeListening({ restore: true }); }, 900);
        }
      } catch {}
    }

    // 10. Startup Welcome Flourish
    setTimeout(() => {
      this.playSound('startup');
      this.orbStateManager.setState(ORB_STATES.WAKE);
    }, 450);

    // Render-frame telemetry is sampled by OrbEngine only while its canvas is visible.

    console.log('[NEXORA App] Phase 1 Application Initialized.');
  }


  initCoreComposer() {
    const input = document.getElementById('coreQuickPrompt');
    const send = document.getElementById('coreQuickSend');
    const submit = () => {
      const text = input?.value.trim();
      if (!text || !this.chatPanel) return;
      input.value = ''; input.style.height = 'auto';
      this.setPanel(PANELS.CHAT);
      const chatInput = document.getElementById('chatInput');
      if (chatInput) { chatInput.value = text; this.chatPanel.submitMessage(); }
    };
    input?.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; });
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    send?.addEventListener('click', submit);
    document.querySelector('.composer-add-btn')?.addEventListener('click', () => input?.focus());
  }

  /** One entry point for the render quality: applies live, saves it, and mirrors it into Settings. */
  async setRenderQuality(mode) {
    if (!this.orbEngine?.setPerformanceMode(mode)) return;
    this.settingsPanel?.updatePerformanceSelection?.(mode, true);
    this.playSound?.('modeSwitch');
    try { await window.nexoraAPI?.config?.set('performance.mode', mode); } catch (e) { console.warn('[NEXORA] could not save render quality', e); }
  }

  initOrbStudioControls() {
    const select = document.getElementById('orbPresetSelect'); const sfxButton = document.getElementById('orbSfxToggle');
    if (select && this.orbEngine) {
      select.value = this.orbEngine.getProfile();
      this.robotStudio = new RobotStudio(this.orbEngine, document.getElementById('robotStudio')); this.robotStudio.refresh();
      // Individual Orb Studio panels (Orb / Quality / Robot / Popup) + live render-quality control
      const studioRoot = document.querySelector('.orb-studio-panel-content');
      if (studioRoot) {
        this.studioPanels = new StudioPanels({ engine: this.orbEngine, root: studioRoot, onQuality: (mode) => this.setRenderQuality(mode) });
        this.orbEngine.onPerformanceChange = (mode) => this.studioPanels?.syncQuality(mode);   // any source (Settings, saved config) keeps the panel in sync
      }
      select.addEventListener('change', async () => { if (this.orbEngine.setProfile(select.value)) { this.robotStudio?.refresh(); this.studioPanels?.syncRobotTab(); if (select.value === 'robot' && (Number(localStorage.getItem('nexora-orb-preview-size')) || 132) < 200) document.querySelector('#orbSizeControls [data-size="220"]')?.click(); this.soundSystem.playOrbIdentity?.(select.value); await window.nexoraAPI?.config?.set('appearance.orbProfile', select.value); await window.nexoraAPI?.voice?.setOrbProfile?.(select.value); } });
    }
    if (sfxButton) sfxButton.addEventListener('click', () => {
      const enabled = sfxButton.getAttribute('aria-pressed') !== 'true';
      sfxButton.setAttribute('aria-pressed', String(enabled)); this.soundSystem.setEnabled(enabled);
      sfxButton.textContent = enabled ? 'SFX ON' : 'SFX OFF'; if (enabled) this.playSound('modeSwitch');
    });
    const sizeWrap = document.getElementById('orbSizeControls');
    const orbWrap = document.querySelector('.orb-canvas-container');
    if (sizeWrap && orbWrap) {
      const applySize = (value, byUser = false) => {
        orbWrap.style.setProperty('--orb-preview-size', `${value}px`);
        if (byUser) orbWrap.dataset.userSize = '1';          // once the user picks a size it also applies on the Core screen
        sizeWrap.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === value)));
        sizeWrap.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('active', Number(b.dataset.size) === value));
        try { localStorage.setItem('nexora-orb-preview-size', String(value)); } catch {}
        this.orbEngine?.notifyResize();
      };
      sizeWrap.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => applySize(Number(b.dataset.size), true)));
      let savedSize = 0; try { savedSize = Number(localStorage.getItem('nexora-orb-preview-size')) || 0; } catch { /* storage unavailable */ }
      applySize(savedSize || 220, !!savedSize);
    }
  }


  /** Popup Orb Studio: size / position / preset / state preview of the floating wake Orb. */
  initPopupOrbStudio() {
    const api = window.nexoraAPI; const root = document.getElementById('popupStudio');
    if (!api || !root) return;
    const sizeBtns = root.querySelectorAll('[data-popup-size]'); const range = root.querySelector('#popupSizeRange'); const out = root.querySelector('#popupSizeValue');
    const preset = root.querySelector('#popupPresetSelect'); const position = root.querySelector('#popupPositionSelect');
    const chips = root.querySelectorAll('[data-popup-state]'); let lastState = 'wake'; let timer = null;
    const preview = (state = lastState) => { lastState = state; chips.forEach((c) => c.classList.toggle('active', c.dataset.popupState === state)); api.popup?.preview?.(state); };
    const setSizeUi = (v) => { if (range) range.value = String(v); if (out) out.textContent = `${v}px`; sizeBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.popupSize) === v)); };
    const saveSize = (v) => { v = Math.max(40, Math.min(500, Math.round(Number(v) || 200))); setSizeUi(v); clearTimeout(timer); timer = setTimeout(async () => { await api.config?.set('appearance.popupOrbSize', v); preview(); }, 120); };
    sizeBtns.forEach((b) => b.addEventListener('click', () => saveSize(Number(b.dataset.popupSize))));
    range?.addEventListener('input', () => saveSize(Number(range.value)));
    preset?.addEventListener('change', async () => { await api.config?.set('appearance.popupOrbProfile', preset.value); preview(); });
    position?.addEventListener('change', async () => { await api.config?.set('appearance.popupOrbPosition', position.value); preview(); });
    chips.forEach((c) => c.addEventListener('click', () => preview(c.dataset.popupState)));
    root.querySelector('#popupPreviewBtn')?.addEventListener('click', () => preview());
    root.querySelector('#popupHideBtn')?.addEventListener('click', () => api.popup?.stopPreview?.());
    root.querySelector('#popupResetBtn')?.addEventListener('click', async () => { await api.config?.set('appearance.popupOrbPosition', 'bottom-center'); await api.config?.set('appearance.popupOrbProfile', 'same'); if (position) position.value = 'bottom-center'; if (preset) preset.value = 'same'; saveSize(200); });
    (async () => {
      try {
        setSizeUi(Number(await api.config?.get('appearance.popupOrbSize')) || 200);
        const pos = await api.config?.get('appearance.popupOrbPosition'); if (position && pos) position.value = pos;
        const prof = await api.config?.get('appearance.popupOrbProfile'); if (preset && prof) preset.value = prof;
      } catch { setSizeUi(280); }
    })();
    // Closing the Orb Studio panel / leaving the page never leaves a stuck preview.
    window.addEventListener('beforeunload', () => api.popup?.stopPreview?.());
  }

  initQuickStateButtons() {
    const container = document.getElementById('orbQuickControls');
    container?.querySelectorAll('.orb-mode-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetMode = btn.dataset.mode;
        this.orbStateManager.setState(targetMode);

        if (targetMode === ORB_STATES.LISTEN) this.playSound('listening');
        else if (targetMode === ORB_STATES.THINK) this.playSound('thinking');
        else if (targetMode === ORB_STATES.SPEAK) this.playSound('speaking');
        else if (targetMode === ORB_STATES.IDLE) this.playSound('idle');
        else if (targetMode === ORB_STATES.WAKE) this.playSound('wake');
        else if (targetMode === ORB_STATES.ERROR) this.playSound('error');
        else if (targetMode === ORB_STATES.OFFLINE) this.playSound('offline');
        else this.playSound('modeSwitch');
      });
    });
  }

  updateQuickStateButtons(currentState) {
    document.querySelectorAll('.orb-mode-chip').forEach((btn) => {
      const mode = btn.dataset.mode;
      const isMatch = (mode === currentState) ||
                      (mode === 'listening' && currentState === ORB_STATES.LISTEN) ||
                      (mode === 'thinking' && currentState === ORB_STATES.THINK) ||
                      (mode === 'speaking' && currentState === ORB_STATES.SPEAK);
      btn.classList.toggle('active', isMatch);
    });
  }

  initPanels() {
    // Memory + Reminder panels
    this.memoryPanel = new MemoryPanel(document.getElementById('memoryPanelContainer'), { onClose: () => this.setPanel(PANELS.CORE) });
    this.reminderPanel = new ReminderPanel(document.getElementById('reminderPanelContainer'), {
      onClose: () => this.setPanel(PANELS.CORE),
      onCount: (count) => this.navigation?.setBadge(NAV_ITEMS.REMINDER, count),
    });

    this.autonomyPanel = new AutonomyPanel(document.getElementById('autonomyPanelContainer'), { onClose: () => this.setPanel(PANELS.CORE) });
    // v0.3.8: autonomy cards can ask the app to open a tab ("Open reminders", "Change it")
    window.nexoraAPI?.autonomy?.onOpenPanel?.((name) => {
      const target = { reminder: PANELS.REMINDER, memory: PANELS.MEMORY, autonomy: PANELS.AUTONOMY }[name];
      if (target && this.activePanel !== target) this.setPanel(target);
    });

    // Chat Panel
    const chatContainer = document.getElementById('chatPanelContainer');
    this.chatPanel = new ChatPanel(chatContainer, {
      onSound: (name) => this.playSound(name),
      onOrbStateChange: (state) => this.orbStateManager.setState(state),
      onClose: () => this.setPanel(PANELS.CORE),
    });

    // Status Panel
    const statusContainer = document.getElementById('statusPanelContainer');
    this.statusPanel = new StatusPanel(statusContainer, {
      orbStateManager: this.orbStateManager,
      soundSystem: this.soundSystem,
      onSound: (name) => this.playSound(name),
      onClose: () => this.setPanel(PANELS.CORE),
    });

    // Settings Panel
    const settingsContainer = document.getElementById('settingsPanelContainer');
    this.settingsPanel = new SettingsPanel(settingsContainer, {
      soundSystem: this.soundSystem,
      voiceAudio: this.voiceAudio,
      onSound: (name) => this.playSound(name),
      onClose: () => this.setPanel(PANELS.CORE),
      onStartWake: () => this.startWakeListening(),
      onStopWake: () => this.stopWakeListening(),
      onStartLive: () => this.startLiveTalk(),
      onStopLive: () => this.stopLiveTalk(),
      onPerformanceChange: (mode) => this.orbEngine?.setPerformanceMode(mode),
      onOpenSetupWizard: () => { void this.openSetupWizard(); },
    });
  }


  /** Live memory toasts + reminder alerts (typed, spoken or from the panels). */
  initLiveMemoryAndReminders() {
    this.toasts = new ToastCenter(document.getElementById('toastStack'));
    const api = window.nexoraAPI;

    // Updates: GitHub Releases auto-updater notifications & one-click Update Now toast.
    api?.updates?.onAvailable?.((info = {}) => {
      if (!info.version) return;
      api.updates.state?.().then((st) => {
        if (st?.autoDownload && st?.packaged) {
          this.updateToast?.dismiss?.();
          this.updateToast = this.toasts.show({
            kind: 'update', title: `NEXORA v${info.version} found`, timeout: 5500,
            text: 'Downloading update in the background. Progress is shown in Settings → Support & Updates.',
          });
          return;
        }
        this.updateToast?.dismiss?.();
        const actions = st?.packaged
          ? [
              { label: 'Download', primary: true, onClick: () => api.updates.download?.() },
              { label: 'View release', onClick: () => api.updates.open(info.url) },
              { label: 'Skip', onClick: () => api.updates.skip(info.version) },
            ]
          : [
              { label: 'View release', primary: true, onClick: () => api.updates.open(info.url) },
              { label: 'Later' },
              { label: 'Skip', onClick: () => api.updates.skip(info.version) },
            ];
        this.updateToast = this.toasts.show({
          kind: 'update', title: 'New NEXORA update', timeout: 0,
          text: st?.packaged
            ? `Version ${info.version} is available (you have v${this.currentVersion || 'older'}).`
            : `Version ${info.version} is available (running dev build; you have v${this.currentVersion || 'older'}).`,
          actions,
        });
      }).catch(() => {});
    });
    api?.updates?.onDownloaded?.((st = {}) => {
      const ver = st?.downloadedVersion || st?.availableVersion || 'latest';
      this.updateToast?.dismiss?.();
      this.updateToast = this.toasts.show({
        kind: 'update', title: `Update v${ver} ready`, timeout: 0,
        text: 'Update downloaded and verified. Restart now to install while keeping all settings & memory.',
        actions: [
          { label: 'Update Now', primary: true, onClick: () => api.updates.install?.() },
          { label: 'Later' },
        ],
      });
    });
    api?.updates?.state?.().then((st) => { if (st?.currentVersion || st?.current) this.currentVersion = st.currentVersion || st.current; }).catch(() => {});

    // Memory: tell the user the moment something is saved, unless the Memory panel is already open showing it live.
    api?.memory?.onChanged?.((event = {}) => {
      if (this.activePanel === PANELS.MEMORY) return;
      if (event.type === 'add' && event.item?.text) {
        const from = { chat: 'from chat', voice: 'from voice', manual: '' }[event.source] || '';
        this.toasts.show({ kind: 'memory', title: `Memory saved${from ? ' ' + from : ''}`, text: event.item.text, timeout: 4800, onClick: () => this.setPanel(PANELS.MEMORY) });
        this.playSound('response');
      } else if (event.type === 'forget' && event.removed?.length) {
        this.toasts.show({ kind: 'memory', title: 'Memory removed', text: event.removed.join(' · '), timeout: 4200, onClick: () => this.setPanel(PANELS.MEMORY) });
      }
    });

    // Spoken reminders (v0.3.6d): NEXORA SAYS the reminder out loud ("Daya, reminder: study. Seekiram pannunga."),
    // and repeats up to 2 more times, one minute apart, until you press Done / Snooze.
    // Local Windows voice: ONLY a last resort when the Gemini voice is unavailable (no key / offline / quota).
    const speakLocal = (text) => {
      try {
        const synth = window.speechSynthesis; if (!synth) return;
        const utter = new SpeechSynthesisUtterance(text);
        const voices = synth.getVoices();
        const voice = voices.find((v) => /en-IN/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
        if (voice) utter.voice = voice;
        utter.lang = voice?.lang || 'en-IN'; utter.rate = 0.95;
        synth.speak(utter);
      } catch { /* speech is best-effort */ }
    };
    // v0.3.6f: reminders are spoken with the GEMINI voice (same voice as Live, config ai.voiceName).
    const speakText = async (text) => {
      try {
        const result = await api?.reminders?.speak?.(text);
        if (result?.success && result.data) { await this.voiceAudio.playPcm({ data: result.data, sampleRate: result.sampleRate }); return; }
        console.warn('[NEXORA Voice] Gemini reminder voice unavailable, using local voice:', result?.error);
      } catch (error) { console.warn('[NEXORA Voice] Gemini reminder voice failed:', error?.message || error); }
      speakLocal(text);
    };
    // v0.3.9: "I opened Calculator." — tasks started from chat / the Auto tab / watchers are confirmed out loud too.
    api?.autonomy?.onSpeak?.((payload) => { if (payload?.text) void speakText(String(payload.text)); });
    const speakReminder = async (item, late) => {
      let name = '';
      try {
        const r = await api?.memory?.list?.('personal');
        const hit = r?.success ? r.items.find((i) => i.key === 'name' && i.value) : null;
        name = hit?.value || '';
      } catch { /* no name known */ }
      const say = (round) => {
        const lead = round === 0 ? (late ? 'Missed reminder' : 'Reminder') : 'Reminder again';
        speakText(`${name ? name + ', ' : ''}${lead}! ${item.text}. ${round === 0 ? 'Seekiram pannunga.' : 'Please do it now.'}`);
      };
      say(0);
      for (let round = 1; round <= 2; round++) {
        await new Promise((resolve) => setTimeout(resolve, 60000));
        try {
          const list = await api?.reminders?.list?.();
          const still = list?.success && list.items.find((i) => i.id === item.id && i.status === 'fired' && (i.lastFiredAt || 0) === (item.lastFiredAt || 0));
          if (!still) return;
        } catch { return; }
        say(round);
      }
    };
    // Reminders: a sticky alert with Done / Snooze, a sound, spoken aloud, and an Orb wake.
    const showReminder = (item, late) => {
      if (!item || this.shownReminderAlerts.has(item.id + ':' + (item.lastFiredAt || 0))) return;
      this.shownReminderAlerts.add(item.id + ':' + (item.lastFiredAt || 0));
      this.reminderToasts = this.reminderToasts || new Map();
      this.reminderToasts.get(item.id)?.dismiss?.(); // never two cards for one reminder
      const card = this.toasts.show({
        kind: 'reminder', title: late ? '⏰ Missed reminder' : '⏰ Reminder', text: item.text, timeout: 0,
        actions: [
          { label: 'Done', primary: true, onClick: () => api.reminders.done(item.id) },
          { label: 'Snooze 10 min', onClick: () => api.reminders.snooze(item.id, 10) },
        ],
      });
      this.reminderToasts.set(item.id, card);
      this.playSound('wake');
      this.orbStateManager.setState(ORB_STATES.WAKE);
      void speakReminder(item, late);
    };
    api?.reminders?.onFired?.((payload) => { if (payload?.item) showReminder(payload.item, payload.late); void this.reminderPanel?.refresh(); });
    // v0.3.7: Done / Snooze / delete pressed ANYWHERE (desktop card, Reminder tab, voice, tray) closes this card too.
    api?.reminders?.onChanged?.((event = {}) => {
      const id = event?.item?.id;
      if (id && ['done', 'snooze', 'remove', 'update'].includes(event.type)) { this.reminderToasts?.get(id)?.dismiss?.(); this.reminderToasts?.delete(id); }
      if (event?.type === 'clear') { this.reminderToasts?.forEach((card) => card.dismiss?.()); this.reminderToasts?.clear(); }
      void this.refreshReminderBadge();
    });
    // Reminders that came due while NEXORA was closed are still waiting for an answer.
    void (async () => {
      const result = await api?.reminders?.list?.();
      if (!result?.success) return;
      result.items.filter((i) => i.status === 'fired').forEach((i) => showReminder(i, true));
      this.navigation?.setBadge(NAV_ITEMS.REMINDER, result.items.filter((i) => i.status === 'fired').length);
    })();
  }

  async refreshReminderBadge() {
    const result = await window.nexoraAPI?.reminders?.list?.();
    if (result?.success) this.navigation?.setBadge(NAV_ITEMS.REMINDER, result.items.filter((i) => i.status === 'fired').length);
  }

  mapVoiceOrbState(mode) {
    const map = {
      standby: ORB_STATES.IDLE, wake: ORB_STATES.WAKE, connecting: ORB_STATES.THINK,
      listening: ORB_STATES.LISTEN, thinking: ORB_STATES.THINK, speaking: ORB_STATES.SPEAK,
      error: ORB_STATES.ERROR, offline: ORB_STATES.OFFLINE,
    };
    return map[mode] || ORB_STATES.IDLE;
  }

  handleVoiceStatus(payload = {}) {
    const mode = payload.mode || 'offline';
    const orbState = this.mapVoiceOrbState(mode);
    this.orbStateManager.setState(orbState, false);
    const labels = {
      standby: 'WAKE STANDBY', wake: 'NEXORA ACTIVATED', connecting: 'GEMINI CONNECTING',
      listening: 'LIVE LISTENING', thinking: 'LIVE THINKING', speaking: 'LIVE SPEAKING',
      error: 'VOICE ERROR', offline: 'VOICE OFFLINE',
    };
    this.titlebar?.setStatus(labels[mode] || 'VOICE READY', mode === 'error' || mode === 'offline' ? 'offline' : 'active');
    this.settingsPanel?.setVoiceStatus(payload);
    // If a manual Live session fails or goes offline, release the microphone unless
    // the user explicitly enabled wake standby. Never leave an unrequested mic open.
    if ((mode === 'error' || mode === 'offline') && payload.wakeEnabled !== true) {
      this.voiceAudio.stopCapture();
      this.voiceAudio.stopPlayback();
    }
    if (mode === 'wake' && this.lastVoiceMode !== 'wake') this.playSound('wake');
    if (mode === 'listening' && this.lastVoiceMode !== 'listening') this.playSound('listening');
    if (mode === 'thinking' && this.lastVoiceMode !== 'thinking') this.playSound('thinking');
    if (mode === 'speaking' && this.lastVoiceMode !== 'speaking') this.playSound('speaking');
    if (mode === 'error' && this.lastVoiceMode !== 'error') this.playSound('error');
    if (mode === 'standby' && this.lastVoiceMode && this.lastVoiceMode !== 'standby') this.playSound('idle');
    if (mode === 'offline' && this.lastVoiceMode && this.lastVoiceMode !== 'offline') this.playSound('offline');
    this.lastVoiceMode = mode;
  }

  /** v0.3.12: Live voice and typed chat are SEPARATE. Spoken words are shown as floating captions over the Orb and are not
   *  added to the chat history (set config voice.captionsInChat = true to get the old behaviour back). */
  handleVoiceCaption(payload = {}) {
    const text = String(payload.text || '').trim();
    if (!text) return;
    const box = document.getElementById('liveCaptions');
    const el = document.getElementById(payload.role === 'user' ? 'liveCapUser' : 'liveCapAi');
    if (box && el) {
      const span = document.createElement('span'); span.className = 'cap-text'; span.textContent = text.slice(-260); el.replaceChildren(span);
      const sc = document.getElementById('capScroll'); if (sc) requestAnimationFrame(() => { try { sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); } catch { sc.scrollTop = sc.scrollHeight; } });
      box.hidden = false; box.style.opacity = '1';
      clearTimeout(this.captionTimer);
      this.captionTimer = setTimeout(() => { box.style.opacity = '0'; setTimeout(() => { if (box.style.opacity === '0') { box.hidden = true; document.getElementById('liveCapUser').textContent = ''; document.getElementById('liveCapAi').textContent = ''; } }, 450); }, payload.finished ? 7000 : 12000);
    }
    if (this.captionsInChat && payload.finished && this.chatPanel) {
      this.chatPanel.addMessage({ sender: payload.role === 'user' ? 'user' : 'assistant', text, timestamp: Date.now(), voice: true });
    }
  }

  async startWakeListening({ restore = false } = {}) {
    const api = window.nexoraAPI?.voice;
    if (!api) return { success: false, error: 'Voice bridge is unavailable. Restart NEXORA after updating.' };
    const capture = await this.voiceAudio.startCapture();
    if (!capture.success) { this.settingsPanel?.setVoiceStatus({ mode: 'error', message: capture.error }); return capture; }
    const result = await api.enableWake();
    if (!result?.success) {
      this.voiceAudio.stopCapture();
      this.settingsPanel?.setVoiceStatus({ mode: 'error', message: result?.error || 'Unable to enable wake word.' });
      return result;
    }
    this.settingsPanel?.setVoiceStatus({ mode: 'standby', wakeEnabled: true, message: restore ? 'Wake-word standby restored.' : 'Wake-word standby enabled.' });
    return result;
  }

  async stopWakeListening() {
    const result = await window.nexoraAPI?.voice?.disableWake?.();
    this.voiceAudio.stopCapture();
    this.voiceAudio.stopPlayback();
    this.settingsPanel?.setVoiceStatus({ mode: 'offline', wakeEnabled: false, message: 'Microphone and wake-word standby are off.' });
    return result || { success: false, error: 'Voice bridge unavailable.' };
  }

  async startLiveTalk() {
    const api = window.nexoraAPI?.voice;
    if (!api) return { success: false, error: 'Voice bridge is unavailable. Restart NEXORA after updating.' };
    const capture = await this.voiceAudio.startCapture();
    if (!capture.success) { this.settingsPanel?.setVoiceStatus({ mode: 'error', message: capture.error }); return capture; }
    const result = await api.startLive();
    if (!result?.success) {
      const wakeEnabled = await window.nexoraAPI?.config?.get('voice.wakeWordEnabled');
      if (!wakeEnabled) this.voiceAudio.stopCapture();
      this.settingsPanel?.setVoiceStatus({ mode: 'error', message: result?.error || 'Gemini Live could not start.' });
    }
    return result;
  }

  async stopLiveTalk() {
    const result = await window.nexoraAPI?.voice?.stopLive?.();
    const wakeEnabled = await window.nexoraAPI?.config?.get('voice.wakeWordEnabled');
    if (!wakeEnabled) this.voiceAudio.stopCapture();
    this.voiceAudio.stopPlayback();
    return result || { success: false, error: 'Voice bridge unavailable.' };
  }

  handleNavigation(targetNav) {
    let targetPanel = PANELS.CORE;
    if (targetNav === NAV_ITEMS.ORB) {
      targetPanel = PANELS.ORB;
    } else if (targetNav === NAV_ITEMS.MEMORY) {
      targetPanel = PANELS.MEMORY;
    } else if (targetNav === NAV_ITEMS.REMINDER || targetNav === 'reminders') {
      targetPanel = PANELS.REMINDER;
    } else if (targetNav === NAV_ITEMS.AUTONOMY) {
      targetPanel = PANELS.AUTONOMY;
    } else if (targetNav === NAV_ITEMS.CHAT || targetNav === 'conversation') {
      targetPanel = PANELS.CHAT;
    } else if (targetNav === NAV_ITEMS.TELEMETRY || targetNav === 'status') {
      targetPanel = PANELS.TELEMETRY;
    } else if (targetNav === NAV_ITEMS.SETTINGS) {
      targetPanel = PANELS.SETTINGS;
    }

    this.setPanel(targetPanel);
  }

  // --- Centralized Panel Manager (Single Source of Truth) ---
  setPanel(targetPanel) {
    const stage = document.querySelector('.nexora-stage-container');

    // Panel icons toggle back to CORE when clicked twice, but Orb Studio is a
    // dedicated workspace: clicking Orb always opens/stays on the Orb view.
    if (targetPanel === this.activePanel && targetPanel !== PANELS.CORE && targetPanel !== PANELS.ORB) {
      targetPanel = PANELS.CORE;
    }

    this.activePanel = targetPanel;

    const panelMap = {
      [PANELS.MEMORY]: document.getElementById('memoryPanelContainer'),
      [PANELS.REMINDER]: document.getElementById('reminderPanelContainer'),
      [PANELS.AUTONOMY]: document.getElementById('autonomyPanelContainer'),
      [PANELS.CHAT]: document.getElementById('chatPanelContainer'),
      [PANELS.TELEMETRY]: document.getElementById('statusPanelContainer'),
      [PANELS.SETTINGS]: document.getElementById('settingsPanelContainer'),
      [PANELS.ORB]: document.getElementById('orbPanelContainer'),
    };
    // Orb Studio is a full-stage view, not a side panel. Clicking Orb closes
    // any side panel while keeping the orb and studio controls centered.
    if (targetPanel === PANELS.ORB) {
      targetPanel = PANELS.ORB;
    }

    // Update DOM visibility on all panels
    Object.entries(panelMap).forEach(([key, el]) => {
      if (!el) return;
      const shouldOpen = (key === this.activePanel);
      el.classList.toggle('open', shouldOpen);
      el.classList.toggle('active', shouldOpen);
    });

    // Update Stage Container class for responsive split view
    if (stage) {
      const isPanelOpen = [PANELS.MEMORY, PANELS.REMINDER, PANELS.AUTONOMY, PANELS.CHAT, PANELS.TELEMETRY, PANELS.SETTINGS, PANELS.ORB].includes(this.activePanel);
      stage.classList.toggle('panel-open', isPanelOpen);
      stage.dataset.activePanel = this.activePanel;
    }

    // Update Navigation dock highlight
    this.navigation.setActive(this.activePanel, false);

    const closeOrbBtn = document.getElementById('btnCloseOrb');
    if (closeOrbBtn && !closeOrbBtn.dataset.bound) { closeOrbBtn.dataset.bound = 'true'; closeOrbBtn.addEventListener('click', () => this.setPanel(PANELS.CORE)); }

    // Audio & side effects per panel
    if (this.activePanel === PANELS.CORE || this.activePanel === PANELS.ORB) {
      this.playSound('panelClose');
      this.statusPanel?.stopPolling();
    } else {
      this.playSound('panelOpen');
      if (this.activePanel === PANELS.CHAT) {
        this.statusPanel?.stopPolling();
        this.chatPanel?.focusInput();
      } else if (this.activePanel === PANELS.MEMORY) {
        this.statusPanel?.stopPolling();
        this.memoryPanel?.onShow();
      } else if (this.activePanel === PANELS.REMINDER) {
        this.statusPanel?.stopPolling();
        this.reminderPanel?.onShow();
      } else if (this.activePanel === PANELS.AUTONOMY) {
        this.statusPanel?.stopPolling();
        this.autonomyPanel?.onShow();
      } else if (this.activePanel === PANELS.TELEMETRY) {
        this.statusPanel?.startPolling();
      } else if (this.activePanel === PANELS.SETTINGS) {
        this.statusPanel?.stopPolling();
        this.settingsPanel?.activateSettingsSection?.(8); // Settings always opens on ABOUT
      }
    }

    // Render the live robot only on Core and Orb Studio; other pages do not display the canvas.
    if (this.activePanel === PANELS.CORE || this.activePanel === PANELS.ORB) {
      if (!document.hidden) this.orbEngine?.start();
    } else {
      this.orbEngine?.stop();
    }

    // Notify Orb Engine of layout change so it re-centers immediately when visible.
    this.orbEngine?.notifyResize();
  }

  getPanel() {
    return this.activePanel;
  }

  playSound(name) {
    if (name === 'startup') this.soundSystem.playStartup();
    else if (name === 'wake') this.soundSystem.playWake();
    else if (name === 'listening') this.soundSystem.playListening();
    else if (name === 'thinking') this.soundSystem.playThinking();
    else if (name === 'response') this.soundSystem.playResponse();
    else if (name === 'speaking') this.soundSystem.playSpeaking();
    else if (name === 'idle') this.soundSystem.playIdle();
    else if (name === 'panelOpen') this.soundSystem.playPanelOpen();
    else if (name === 'panelClose') this.soundSystem.playPanelClose();
    else if (name === 'modeSwitch') this.soundSystem.playModeSwitch();
    else if (name === 'error') this.soundSystem.playError();
    else if (name === 'offline') this.soundSystem.playOffline();
  }

  async openSetupWizard({ startStep = 0 } = {}) {
    if (this.setupWizard?.isOpen) return;
    const container = document.getElementById('setupWizardContainer');
    if (!container) return;
    // Pause active wake/live temporarily so Step 3/4 mic & wake tests run cleanly without stream contention
    try { await this.stopLiveTalk?.(); } catch {}
    try { await this.stopWakeListening?.(); } catch {}

    this.setupWizard = new SetupWizard({
      container,
      app: this,
      onComplete: () => {
        void this.settingsPanel?.loadConfig?.();
        this.settingsPanel?.container?.querySelector?.('#btnGeminiKeyStatus')?.click?.();
      },
      onDismiss: async () => {
        void this.settingsPanel?.loadConfig?.();
        try {
          if ((await window.nexoraAPI?.config?.get?.('voice.wakeWordEnabled')) === true) {
            void this.startWakeListening?.({ restore: true });
          }
        } catch {}
      },
    });
    await this.setupWizard.open({ startStep });
  }

}

// Instantiate on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.nexoraApp = new NexoraApp();
  window.nexoraApp.init();
  window.addEventListener('beforeunload', () => {
    document.removeEventListener('visibilitychange', window.nexoraApp?._orbVisibilityHandler);
    window.nexoraApp?.orbEngine?.destroy();
    window.nexoraApp?.voiceAudio?.destroy();
  });
});
