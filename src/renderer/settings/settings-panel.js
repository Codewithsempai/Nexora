/* ==========================================================================
   NEXORA — Settings & Configuration Panel
   Appearance, audio parameters, application behavior, and system settings.
   ========================================================================== */

export class SettingsPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.config = {};
    this.render();
    this.loadConfig();
    this.initEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="nexora-panel nexora-settings-panel">
        <div class="panel-header">
          <div class="panel-title-cluster">
            <h2 class="panel-title">Settings</h2><span class="panel-subtitle">Customize how NEXORA works</span>
            <span class="settings-saved-badge" id="settingsSavedBadge">SAVED</span>
          </div>
          <button class="panel-btn-close" id="btnCloseSettings" title="Close panel — Return to Core" aria-label="Close Settings"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <div class="panel-scroll-content">
          <!-- Category 1: Appearance -->
          <div class="settings-group">
            <h3 class="settings-group-title">Appearance & Spatial UI</h3>
            
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Accent Palette</span>
                <span class="setting-desc">Primary holographic illumination wavelength</span>
              </div>
              <select class="setting-select" id="settingTheme">
                <option value="dark-amber">Dark Amber (Default)</option>
                <option value="solar-gold">Solar Gold</option>
                <option value="cyber-steel">Cyber Steel</option>
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Orb Bloom Intensity</span>
                <span class="setting-desc">Atmospheric radiance around the core</span>
              </div>
              <input type="range" class="setting-range" id="settingOrbIntensity" min="0.5" max="1.5" step="0.1" value="1.0" />
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Reduced Motion</span>
                <span class="setting-desc">Dampens camera parallax and orbital spins</span>
              </div>
              <label class="setting-toggle">
                <input type="checkbox" id="settingReducedMotion" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- Category 2: Audio Synthesizer -->
          <div class="settings-group">
            <h3 class="settings-group-title">Acoustic Synthesizer</h3>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Enable Sound Effects</span>
                <span class="setting-desc">Procedural Web Audio acoustic feedback</span>
              </div>
              <label class="setting-toggle">
                <input type="checkbox" id="settingAudioEnabled" checked />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Master Volume</span>
                <span class="setting-desc">Global acoustic gain</span>
              </div>
              <input type="range" class="setting-range" id="settingMasterVolume" min="0" max="1" step="0.05" value="0.75" />
            </div>

            <div class="setting-row sound-test-row">
              <div class="setting-info">
                <span class="setting-name">Auditory Triggers</span>
                <span class="setting-desc">Test custom synthesized wave profiles</span>
              </div>
              <div class="sound-test-buttons">
                <button class="sound-chip-btn" data-sound="startup">Startup</button>
                <button class="sound-chip-btn" data-sound="wake">Wake</button>
                <button class="sound-chip-btn" data-sound="listening">Listen</button>
                <button class="sound-chip-btn" data-sound="thinking">Think</button>
                <button class="sound-chip-btn" data-sound="response">Reply</button>
                <button class="sound-chip-btn" data-sound="error">Alert</button>
              </div>
            </div>
          </div>

          <!-- General application behavior -->
          <div class="settings-group">
            <h3 class="settings-group-title">General</h3>
            <div class="system-meta-box settings-general-owner">
              <div class="meta-line"><span>Nexora Owner</span><strong>Codewithsempai</strong></div>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Close to System Tray</span>
                <span class="setting-desc">Keep NEXORA active in the background when the window is closed.</span>
              </div>
              <label class="setting-toggle">
                <input type="checkbox" id="settingCloseToTray" checked />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <!-- Keyboard shortcuts -->
          <div class="settings-group">
            <h3 class="settings-group-title">Shortcuts</h3>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Global Hotkey</span>
                <span class="setting-desc">System-wide activation shortcut</span>
              </div>
              <div class="hotkey-display" id="settingHotkeyDisplay">Ctrl + Shift + Space</div>
            </div>
          </div>

          <!-- Phase 2: AI connection -->
          <div class="settings-group">
            <h3 class="settings-group-title">Gemini</h3>
            <h4 class="settings-subtitle">Connection</h4>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Gemini API Key</span><span class="setting-desc">Stored encrypted using Electron secure storage. Never saved in renderer config.</span></div>
              <div class="setting-controls setting-controls-key">
                <input id="settingGeminiKey" type="password" class="setting-select" placeholder="Paste Gemini API key" autocomplete="off"/>
                <button id="btnSaveGeminiKey" class="sound-chip-btn">Save Key</button><button id="btnClearGeminiKey" class="sound-chip-btn">Clear</button>
              </div>
            </div>
            <div class="setting-row"><div class="setting-info"><span class="setting-name">AI Connection</span><span class="setting-desc" id="geminiKeyStatus">Checking secure key storage…</span></div><button id="btnGeminiKeyStatus" class="sound-chip-btn">Refresh</button></div>
            <h4 class="settings-subtitle">Models</h4>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Normal AI model</span><span class="setting-desc">Selected model is attempted first, then the supported text-model ladder.</span></div>
              <select class="setting-select" id="settingChatModel" aria-label="Normal AI model"><option value="gemini-2.5-flash">gemini-2.5-flash (default)</option></select>
            </div>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Live voice model</span><span class="setting-desc">Selected Live model is attempted first, then available real-time audio models. Voice: Charon.</span></div>
              <select class="setting-select" id="settingLiveModel" aria-label="Live voice model"><option value="gemini-3.8-live">gemini-3.8-live (default)</option></select>
            </div>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Automatic model switch ladder</span><span class="setting-desc" id="modelLadderStatus">Will discover models enabled for this API key.</span></div>
              <button class="sound-chip-btn" id="btnRefreshModels" type="button">Refresh Models</button>
            </div>
            <div class="model-ladder-summary" id="modelLadderSummary" aria-live="polite">Model ladder has not been loaded yet.</div>
          </div>

          <!-- Phase 3: Gemini Live voice and wake-word standby -->
          <div class="settings-group">
            <h3 class="settings-group-title">Wake Word & Live Voice</h3>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Wake-word standby (offline)</span><span class="setting-desc">Opt-in microphone standby using the on-device ONNX wake models. Say “Hey Nexora”, “Nexora”, “Hey Nexo” or “Nexo” to open the floating Orb and start Live. Say “mute” during Live to return to standby.</span></div>
              <div class="sound-test-buttons"><button id="btnEnableWake" class="sound-chip-btn" type="button">Enable Wake</button><button id="btnDisableWake" class="sound-chip-btn danger" type="button">Turn Mic Off</button></div>
            </div>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Wake sensitivity <span id="wakeThresholdValue" class="setting-value">0.60</span></span><span class="setting-desc">Lower wakes more easily; higher avoids false wakes. Applies instantly, no restart.</span></div>
              <input type="range" class="setting-range" id="settingWakeThreshold" min="0.3" max="0.9" step="0.05" value="0.6" aria-label="Wake sensitivity threshold" />
            </div>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">One-time wake call</span><span class="setting-desc">On: each wake phrase handles ONE request — NEXORA finishes its answer, then returns to wake standby. Off: Live stays on after waking until you say “mute”.</span></div>
              <label class="setting-toggle"><input type="checkbox" id="settingWakeOneShot" /><span class="toggle-slider"></span></label>
            </div>
            <div class="setting-row">
              <div class="setting-info"><span class="setting-name">Live conversation</span><span class="setting-desc">Start a continuous Gemini Live voice session. You can interrupt the assistant by speaking.</span></div>
              <div class="sound-test-buttons"><button id="btnStartLive" class="sound-chip-btn" type="button">Start Live</button><button id="btnStopLive" class="sound-chip-btn danger" type="button">Stop Live</button></div>
            </div>
            <div class="voice-status-row" id="voiceStatus" role="status" aria-live="polite">Voice is off. Enable wake standby or start Live when ready.</div>
            <p class="setting-desc voice-privacy-note">Wake-word detection runs entirely on this PC with the ONNX models in assets/wakeword/, so no audio is sent anywhere while NEXORA waits for its name. Audio goes to Gemini only after the wake phrase, during a Live conversation. Turn Mic Off stops microphone capture and Live.</p>
          </div>

          <!-- Phase 2: Encrypted, user-managed persistent memory -->
          <div class="settings-group">
            <h3 class="settings-group-title">Persistent Memory Vault</h3>
            <div class="setting-row setting-row-stack memory-create-row">
              <div class="setting-info"><span class="setting-name">Save an approved memory</span><span class="setting-desc">Saved here, or automatically when you say “remember that…”, “my name is…”, “I like…” (chat or voice). Say “forget …” to remove one. Encrypted at rest.</span></div>
              <div class="memory-create-controls">
                <select id="memoryCategory" class="setting-select" aria-label="Memory category">
                  <option value="preferences">Preferences</option><option value="knowledge">Knowledge</option><option value="projects">Projects</option><option value="conversations">Conversations</option>
                </select>
                <input id="memoryEntry" class="setting-select" type="text" maxlength="4000" placeholder="Enter a memory to save" />
                <button id="btnAddMemory" class="sound-chip-btn" type="button">Save Memory</button>
              </div>
            </div>
            <div class="memory-toolbar">
              <select id="memoryFilter" class="setting-select" aria-label="Filter memories">
                <option value="all">All</option><option value="preferences">Preferences</option><option value="knowledge">Knowledge</option><option value="projects">Projects</option><option value="conversations">Conversations</option>
              </select>
              <input id="memorySearch" class="setting-select" type="search" placeholder="Search memories" />
              <button id="btnClearMemory" class="sound-chip-btn danger" type="button">Clear All</button>
            </div>
            <div id="memoryStatus" class="memory-status" role="status">Loading encrypted memory vault…</div>
            <div id="memoryList" class="memory-list" aria-live="polite"></div>
          </div>

          <!-- Performance presets use the existing robot render pipeline; no services are disabled. -->
          <div class="settings-group" id="performanceSettingsGroup">
            <h3 class="settings-group-title">Performance optimization</h3>
            <div class="performance-intro">
              <div class="setting-info">
                <span class="setting-name">Rendering quality</span>
                <span class="setting-desc">Choose how sharp and smooth NEXORA renders its live 3D robot. Changes apply immediately. The same switch lives in Orb Studio > Quality.</span>
              </div>
              <span class="performance-current" id="performanceCurrentLabel">MEDIUM</span>
            </div>
            <div class="performance-profile-grid" role="group" aria-label="Performance profile">
              <button class="performance-profile-btn" type="button" data-performance-mode="low" aria-pressed="false">
                <strong>LOW</strong><span>Lightest load</span>
              </button>
              <button class="performance-profile-btn active" type="button" data-performance-mode="medium" aria-pressed="true">
                <strong>MEDIUM</strong><span>Balanced</span>
              </button>
              <button class="performance-profile-btn" type="button" data-performance-mode="high" aria-pressed="false">
                <strong>HIGH</strong><span>Sharp + glossy</span>
              </button>
              <button class="performance-profile-btn" type="button" data-performance-mode="very-high" aria-pressed="false">
                <strong>VERY HIGH</strong><span>Maximum quality</span>
              </button>
            </div>
            <p class="performance-footnote" id="performanceProfileDescription">Medium: up to 30 FPS with smooth multisampled edges and light reflections.</p>
          </div>

          <!-- Category 4: System Information -->
          <div class="settings-group">
            <h3 class="settings-group-title">Product Information</h3>
            <div class="system-meta-box">
              <div class="meta-line"><span>Product</span><strong>NEXORA Desktop AI</strong></div>
              <div class="meta-line"><span>Owner_name</span><strong>Dayanithi</strong></div>
              <div class="meta-line"><span>Code_name</span><strong>Codewithsempai</strong></div>
              <div class="meta-line"><span>Release</span><strong>Phase 3: Live Voice & Wake Word</strong></div>
              <div class="meta-line"><span>Version</span><strong>v0.3.25 (Offline ONNX Wake Word + Orb Studio fixes)</strong></div>
              <div class="meta-line"><span>Target OS</span><strong>Windows 11 (win32-x64)</strong></div>
            </div>
          </div>

          <!-- Category 5: Support & Updates -->
          <div class="settings-group" id="updatesSettingsGroup">
            <h3 class="settings-group-title">Support & Updates</h3>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Check for updates</span>
                <span class="setting-desc">Installed builds check GitHub Releases for a newer version and show a notice. Nothing is downloaded or installed for you, and no personal data is sent. Details are in PRIVACY.md.</span>
              </div>
              <label class="setting-toggle">
                <input type="checkbox" id="settingCheckUpdates" checked />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">Version</span>
                <span class="setting-desc" id="updateStatus" role="status">Not checked yet.</span>
              </div>
              <div class="sound-test-buttons">
                <button class="sound-chip-btn" id="btnCheckUpdates" type="button">Check now</button>
                <button class="sound-chip-btn" id="btnOpenRelease" type="button" hidden>View release</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.buildSettingsNavigation();
  }

  buildSettingsNavigation() {
    const scroll = this.container.querySelector('.panel-scroll-content');
    if (!scroll) return;
    const groups = Array.from(scroll.querySelectorAll(':scope > .settings-group'));
    const layout = document.createElement('div');
    layout.className = 'settings-page-layout';
    const side = document.createElement('nav');
    side.className = 'settings-page-nav';
    side.setAttribute('aria-label', 'Settings sections');
    const content = document.createElement('div');
    content.className = 'settings-page-content';
    const panels = document.createElement('div');
    panels.className = 'settings-page-panels';
    const navItems = [
      ['GENERAL', 2], ['APPEARANCE', 0], ['AUDIO AND VOICE', 1], ['GEMINI', 4],
      ['WAKE WORD', 5], ['MEMORY VAULT', 6], ['SHORTCUTS', 3], ['PERFORMANCE', 7], ['ABOUT', 8], ['SUPPORT & UPDATES', 9],
    ];
    const activate = (index, button) => {
      side.querySelectorAll('button').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-current', active ? 'page' : 'false');
      });
      groups.forEach((group, groupIndex) => {
        const visible = groupIndex === index;
        group.hidden = !visible;
        group.dataset.active = visible ? 'true' : 'false';
      });
      this.activeSettingsSection = index;
    };
    navItems.forEach(([label, index], position) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `settings-page-nav-item${position === 8 ? ' active' : ''}`;
      button.textContent = label;
      button.dataset.settingsIndex = String(index);
      button.addEventListener('click', () => activate(index, button));
      side.append(button);
      if (position === 8) button.setAttribute('aria-current', 'page');
    });
    groups.forEach((group, index) => {
      group.dataset.settingsGroup = String(index);
      group.hidden = index !== 8;
      group.dataset.active = index === 8 ? 'true' : 'false';
      panels.append(group);
    });
    content.append(panels);
    layout.append(side, content);
    scroll.replaceChildren(layout);
    this.activeSettingsSection = 8;
    this.activateSettingsSection = (index) => {
      const button = side.querySelector(`[data-settings-index="${index}"]`);
      if (button) activate(index, button);
    };
  }

  async loadConfig() {
    if (!window.nexoraAPI?.config) return;
    try {
      this.config = await window.nexoraAPI.config.get();
      this.populateUI();
      await this.loadModelDirectory();
    } catch (err) {
      console.error('[NEXORA Settings] Error loading configuration:', err);
    }
  }

  populateUI() {
    const c = this.config;
    if (!c) return;
    this.updatePerformanceSelection(c.performance?.mode || 'medium', false);

    const themeSelect = this.container.querySelector('#settingTheme');
    if (themeSelect && c.appearance?.theme) themeSelect.value = c.appearance.theme;

    const orbRange = this.container.querySelector('#settingOrbIntensity');
    if (orbRange && c.appearance?.orbIntensity != null) orbRange.value = c.appearance.orbIntensity;

    const motionToggle = this.container.querySelector('#settingReducedMotion');
    if (motionToggle && c.appearance?.reducedMotion != null) motionToggle.checked = c.appearance.reducedMotion;

    const audioToggle = this.container.querySelector('#settingAudioEnabled');
    if (audioToggle && c.audio?.enabled != null) audioToggle.checked = c.audio.enabled;

    const oneShot = this.container.querySelector('#settingWakeOneShot'); if (oneShot) oneShot.checked = c.voice?.wakeOneShot === true;
    const wakeRange = this.container.querySelector('#settingWakeThreshold');
    if (wakeRange) { const v = Number(c.voice?.wakeThreshold); if (Number.isFinite(v) && v > 0) wakeRange.value = String(v); const out = this.container.querySelector('#wakeThresholdValue'); if (out) out.textContent = Number(wakeRange.value).toFixed(2); }

    const volumeRange = this.container.querySelector('#settingMasterVolume');
    if (volumeRange && c.audio?.masterVolume != null) volumeRange.value = c.audio.masterVolume;

    const trayToggle = this.container.querySelector('#settingCloseToTray');
    if (trayToggle && c.application?.closeToTray != null) trayToggle.checked = c.application.closeToTray;

    const chatModel = this.container.querySelector('#settingChatModel');
    if (chatModel && c.ai?.chatModel) chatModel.dataset.selected = c.ai.chatModel;
    const liveModel = this.container.querySelector('#settingLiveModel');
    if (liveModel && c.ai?.liveModel) liveModel.dataset.selected = c.ai.liveModel;

    const updToggle = this.container.querySelector('#settingCheckUpdates');
    if (updToggle) updToggle.checked = c.updates?.checkOnStart !== false;

    const hotkeyEl = this.container.querySelector('#settingHotkeyDisplay');
    if (hotkeyEl && c.application?.globalHotkey) {
      hotkeyEl.textContent = c.application.globalHotkey.replace(/CommandOrControl/g, 'Ctrl');
    }
  }

  initEvents() {
    const closeBtn = this.container.querySelector('#btnCloseSettings');
    closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.options.onSound?.('panelClose');
      this.options.onClose?.();
    });

    this.initUpdateEvents();

    const keyInput = this.container.querySelector('#settingGeminiKey');
    const statusText = this.container.querySelector('#geminiKeyStatus');
    const api = window.nexoraAPI || {};
    const saveKey = api.ai?.saveKey || api.credentials?.setKey || api.credentials?.saveKey;
    const clearKey = api.ai?.clearKey || api.credentials?.clearKey;
    const getKeyStatus = api.ai?.keyStatus || api.credentials?.status || api.credentials?.getStatus;
    const chatModelSelect = this.container.querySelector('#settingChatModel');
    const liveModelSelect = this.container.querySelector('#settingLiveModel');
    chatModelSelect?.addEventListener('change', () => { this.saveSetting('ai.chatModel', chatModelSelect.value); });
    liveModelSelect?.addEventListener('change', () => { this.saveSetting('ai.liveModel', liveModelSelect.value); });
    this.container.querySelector('#btnRefreshModels')?.addEventListener('click', () => this.loadModelDirectory(true));
    const refreshKeyStatus = async () => {
      if (!statusText) return;
      try {
        if (!getKeyStatus) throw new Error('Credential bridge is unavailable. Restart NEXORA to reload its preload bridge.');
        const status = await getKeyStatus();
        statusText.textContent = status.configured ? 'API key securely stored — ready for chat.' : (status.secureStorage ? 'No API key stored. Add one to enable real AI.' : 'Secure credential storage unavailable.');
      } catch (error) { statusText.textContent = error.message || 'Unable to read key status.'; }
    };
    refreshKeyStatus();
    this.container.querySelector('#btnGeminiKeyStatus')?.addEventListener('click', refreshKeyStatus);
    this.container.querySelector('#btnEnableWake')?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Enabling…';
      try { const result = await this.options.onStartWake?.(); this.setVoiceStatus(result?.success ? { mode: 'standby', wakeEnabled: true, message: 'Wake-word standby is enabled.' } : { mode: 'error', message: result?.error || 'Could not enable wake-word standby.' }); }
      catch (error) { this.setVoiceStatus({ mode: 'error', message: error?.message || 'Could not enable wake-word standby.' }); }
      finally { button.disabled = false; button.textContent = 'Enable Wake'; }
    });
    this.container.querySelector('#btnDisableWake')?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { await this.options.onStopWake?.(); this.setVoiceStatus({ mode: 'offline', wakeEnabled: false, message: 'Microphone and wake-word standby are off.' }); }
      catch (error) { this.setVoiceStatus({ mode: 'error', message: error?.message || 'Could not stop microphone.' }); }
      finally { button.disabled = false; }
    });
    this.container.querySelector('#btnStartLive')?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true; button.textContent = 'Connecting…';
      try { const result = await this.options.onStartLive?.(); if (!result?.success) this.setVoiceStatus({ mode: 'error', message: result?.error || 'Gemini Live could not connect.' }); }
      catch (error) { this.setVoiceStatus({ mode: 'error', message: error?.message || 'Gemini Live could not connect.' }); }
      finally { button.disabled = false; button.textContent = 'Start Live'; }
    });
    this.container.querySelector('#btnStopLive')?.addEventListener('click', async () => {
      try { await this.options.onStopLive?.(); } catch (error) { this.setVoiceStatus({ mode: 'error', message: error?.message || 'Unable to stop Live.' }); }
    });
    this.container.querySelector('#btnSaveGeminiKey')?.addEventListener('click', async () => {
      const key = keyInput?.value?.trim();
      if (!key) { statusText.textContent = 'Enter an API key first.'; return; }
      if (!saveKey) { statusText.textContent = 'Credential save bridge unavailable. Restart NEXORA after updating.'; return; }
      const button = this.container.querySelector('#btnSaveGeminiKey');
      if (button) { button.disabled = true; button.textContent = 'Saving…'; }
      try {
        const result = await saveKey(key);
        statusText.textContent = result?.success ? 'API key encrypted and saved.' : (result?.error || 'Save failed.');
        if (result?.success) { keyInput.value = ''; this.flashSavedBadge(); await this.loadModelDirectory(true); }
      } catch (error) { statusText.textContent = error.message || 'Failed to save API key.'; }
      finally { if (button) { button.disabled = false; button.textContent = 'Save Key'; } }
    });
    this.container.querySelector('#btnClearGeminiKey')?.addEventListener('click', async () => {
      if (!clearKey) { statusText.textContent = 'Credential clear bridge unavailable. Restart NEXORA after updating.'; return; }
      try {
        const result = await clearKey();
        const ok = typeof result === 'object' ? result.success === true : result === true;
        statusText.textContent = ok ? 'Saved API key cleared.' : 'Could not clear key.';
        await refreshKeyStatus();
      } catch (error) { statusText.textContent = error.message || 'Could not clear key.'; }
    });

    this.container.querySelectorAll('[data-performance-mode]').forEach((button) => {
      button.addEventListener('click', async () => {
        const mode = button.dataset.performanceMode;
        if (!['low', 'medium', 'high', 'very-high'].includes(mode)) return;
        this.updatePerformanceSelection(mode, true);
        await this.saveSetting('performance.mode', mode);
        this.options.onPerformanceChange?.(mode);
      });
    });

    this.initMemoryVault();

    // Theme select
    this.container.querySelector('#settingTheme')?.addEventListener('change', (e) => {
      const val = e.target.value;
      this.saveSetting('appearance.theme', val);
      document.body.dataset.theme = val;
    });

    // Orb intensity
    this.container.querySelector('#settingOrbIntensity')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.saveSetting('appearance.orbIntensity', val);
    });

    // Reduced motion
    this.container.querySelector('#settingReducedMotion')?.addEventListener('change', (e) => {
      const val = e.target.checked;
      this.saveSetting('appearance.reducedMotion', val);
    });

    // Audio enabled
    this.container.querySelector('#settingAudioEnabled')?.addEventListener('change', (e) => {
      const val = e.target.checked;
      this.saveSetting('audio.enabled', val);
      this.options.soundSystem?.setEnabled(val);
    });

    this.container.querySelector('#settingWakeOneShot')?.addEventListener('change', (e) => this.saveSetting('voice.wakeOneShot', !!e.target.checked));

    // Wake sensitivity (offline ONNX threshold)
    this.container.querySelector('#settingWakeThreshold')?.addEventListener('input', (e) => {
      const val = Math.round(parseFloat(e.target.value) * 100) / 100;
      const out = this.container.querySelector('#wakeThresholdValue'); if (out) out.textContent = val.toFixed(2);
      this.saveSetting('voice.wakeThreshold', val);
    });

    // Master volume
    this.container.querySelector('#settingMasterVolume')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.saveSetting('audio.masterVolume', val);
      this.options.soundSystem?.setMasterVolume(val);
    });

    // Close to tray
    this.container.querySelector('#settingCloseToTray')?.addEventListener('change', (e) => {
      const val = e.target.checked;
      this.saveSetting('application.closeToTray', val);
    });

    // Sound chips test buttons
    this.container.querySelectorAll('.sound-chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const soundType = btn.dataset.sound;
        if (soundType === 'startup') this.options.soundSystem?.playStartup();
        else if (soundType === 'wake') this.options.soundSystem?.playWake();
        else if (soundType === 'listening') this.options.soundSystem?.playListening();
        else if (soundType === 'thinking') this.options.soundSystem?.playThinking();
        else if (soundType === 'response') this.options.soundSystem?.playResponse();
        else if (soundType === 'error') this.options.soundSystem?.playError();
      });
    });
  }

  async loadModelDirectory(force = false) {
    const status = this.container.querySelector('#modelLadderStatus');
    const summary = this.container.querySelector('#modelLadderSummary');
    const chatSelect = this.container.querySelector('#settingChatModel');
    const liveSelect = this.container.querySelector('#settingLiveModel');
    const api = window.nexoraAPI?.ai;
    if (!api?.listModels) {
      if (status) status.textContent = 'Model discovery bridge unavailable. Built-in fallback models remain available.';
      return;
    }
    if (status) status.textContent = 'Discovering models enabled for this Gemini API key…';
    try {
      const result = await api.listModels(force);
      if (!result?.success) throw new Error(result?.error || 'Model discovery failed.');
      const fill = (select, entries, selected) => {
        if (!select) return;
        const previous = selected || select.dataset.selected || select.value;
        const models = Array.isArray(entries) ? entries : [];
        select.replaceChildren();
        const names = new Set();
        for (const entry of models) {
          const name = typeof entry === 'string' ? entry : entry.name;
          if (!name || names.has(name)) continue;
          names.add(name);
          const option = document.createElement('option');
          option.value = name;
          const state = typeof entry === 'object' && entry.state === 'cooling' ? ` · cooling ${entry.retryInSeconds}s` : '';
          option.textContent = `${name}${state}`;
          select.appendChild(option);
        }
        // Keep the user's selected model visible even when discovery says the
        // key cannot currently use it. The main-process ladder tries it first,
        // classifies the actual error, then falls back to discovered models.
        if (previous && !names.has(previous)) {
          const option = document.createElement('option');
          option.value = previous;
          option.textContent = `${previous} · not listed; automatic fallback enabled`;
          option.dataset.unavailable = 'true';
          select.insertBefore(option, select.firstChild);
        }
        if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
        else if (select.options.length) select.selectedIndex = 0;
      };
      const cfg = this.config || {};
      fill(chatSelect, result.textModels, cfg.ai?.chatModel);
      fill(liveSelect, result.liveModels, cfg.ai?.liveModel);
      const textNames = (result.textModels || []).map((item) => typeof item === 'string' ? item : item.name);
      const liveNames = (result.liveModels || []).map((item) => typeof item === 'string' ? item : item.name);
      if (status) status.textContent = result.discovered ? `Discovered ${textNames.length} text models and ${liveNames.length} Live models for this key.` : `Using built-in fallback ladder. ${result.warning || ''}`;
      if (summary) summary.textContent = `TEXT: ${textNames.join(' → ')}
LIVE: ${liveNames.join(' → ')}`;
    } catch (error) {
      if (status) status.textContent = error.message || 'Unable to discover Gemini models.';
      if (summary) summary.textContent = 'The built-in model fallback ladder will be used when requests are made.';
    }
  }

  setVoiceStatus(payload = {}) {
    const status = this.container.querySelector('#voiceStatus');
    if (!status) return;
    const labels = { standby: 'WAKE STANDBY', wake: 'WAKE DETECTED', connecting: 'CONNECTING', listening: 'LIVE LISTENING', thinking: 'THINKING', speaking: 'SPEAKING', error: 'ERROR', offline: 'OFFLINE' };
    const label = labels[payload.mode] || 'VOICE';
    status.dataset.state = payload.mode || 'offline';
    status.textContent = `${label} — ${payload.message || (payload.wakeEnabled ? 'Wake listening is enabled.' : 'Voice is ready.')}`;
  }

  initMemoryVault() {
    const api = window.nexoraAPI?.memory;
    const status = this.container.querySelector('#memoryStatus');
    const list = this.container.querySelector('#memoryList');
    const filter = this.container.querySelector('#memoryFilter');
    const search = this.container.querySelector('#memorySearch');
    const entry = this.container.querySelector('#memoryEntry');
    const category = this.container.querySelector('#memoryCategory');
    if (!api || !status || !list) { if (status) status.textContent = 'Memory API is unavailable. Restart NEXORA to load the updated preload.'; return; }

    const render = async () => {
      const query = search?.value?.trim() || '';
      const selected = filter?.value || 'all';
      const result = query ? await api.search(query, selected) : await api.list(selected);
      list.replaceChildren();
      if (!result?.success) { status.textContent = result?.error || 'Memory vault is unavailable.'; return; }
      status.textContent = `${result.items.length} saved ${result.items.length === 1 ? 'memory' : 'memories'} · encrypted local vault`;
      if (!result.items.length) { const empty = document.createElement('div'); empty.className = 'memory-empty'; empty.textContent = 'No memories stored in this category.'; list.appendChild(empty); return; }
      for (const item of result.items) {
        const row = document.createElement('div'); row.className = 'memory-item';
        const main = document.createElement('div'); main.className = 'memory-item-main';
        const tag = document.createElement('span'); tag.className = 'memory-category-tag'; tag.textContent = item.category;
        const text = document.createElement('span'); text.className = 'memory-item-text'; text.textContent = item.text;
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'memory-delete-btn'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete ${item.category} memory`);
        remove.addEventListener('click', async () => { const deleted = await api.remove(item.id); if (!deleted?.success) status.textContent = deleted?.error || 'Unable to delete memory.'; await render(); });
        main.append(tag, text); row.append(main, remove); list.appendChild(row);
      }
    };

    this.container.querySelector('#btnAddMemory')?.addEventListener('click', async () => {
      const value = entry?.value?.trim();
      if (!value) { status.textContent = 'Enter a memory before saving.'; return; }
      const result = await api.add(category?.value || 'knowledge', value);
      if (!result?.success) { status.textContent = result?.error || 'Unable to save memory.'; return; }
      entry.value = ''; status.textContent = 'Memory encrypted and saved.'; await render();
    });
    entry?.addEventListener('keydown', (event) => { if (event.key === 'Enter') this.container.querySelector('#btnAddMemory')?.click(); });
    filter?.addEventListener('change', render);
    search?.addEventListener('input', () => { clearTimeout(this.memorySearchTimer); this.memorySearchTimer = setTimeout(render, 180); });
    this.container.querySelector('#btnClearMemory')?.addEventListener('click', async () => {
      if (!confirm('Permanently delete all saved memories? This cannot be undone.')) return;
      const result = await api.clear('all');
      status.textContent = result?.success ? 'All saved memories deleted.' : (result?.error || 'Unable to clear memory vault.');
      await render();
    });
    render();
  }

  updatePerformanceSelection(mode, announce = false) {
    const descriptions = {
      low: 'Low: up to 24 FPS, soft edges, no reflections. Lightest on the GPU.',
      medium: 'Medium: up to 30 FPS with smooth multisampled edges and light reflections.',
      high: 'High: up to 45 FPS, supersampled edges, glossy reflections, sharper face.',
      'very-high': 'Very High: up to 60 FPS, 2x supersampling, full reflections. Uses the most GPU.',
    };
    this.performanceMode = mode;
    this.container.querySelectorAll('[data-performance-mode]').forEach((button) => {
      const active = button.dataset.performanceMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const label = this.container.querySelector('#performanceCurrentLabel');
    const description = this.container.querySelector('#performanceProfileDescription');
    if (label) label.textContent = mode.toUpperCase().replace('-', ' ');
    if (description) description.textContent = descriptions[mode] || descriptions.medium;
    if (announce) this.flashSavedBadge();
  }

  /** Support & Updates: on/off switch, manual "Check now", link to the release page. */
  initUpdateEvents() {
    const toggle = this.container.querySelector('#settingCheckUpdates');
    const status = this.container.querySelector('#updateStatus');
    const checkBtn = this.container.querySelector('#btnCheckUpdates');
    const openBtn = this.container.querySelector('#btnOpenRelease');
    const api = window.nexoraAPI?.updates;
    toggle?.addEventListener('change', () => this.saveSetting('updates.checkOnStart', toggle.checked));
    const show = (r = {}) => {
      if (!status) return;
      const cur = r.current ? `v${r.current}` : 'this version';
      const text = {
        available: `Version ${r.latest?.version} is available (you have ${cur}). Install it manually from the release page.`,
        current: `You are up to date (${cur}).`,
        none: `No releases published yet (${cur}).`,
        checking: 'Checking GitHub Releases…',
        error: `Could not check: ${r.error || 'unknown error'}`,
      }[r.status];
      if (text) status.textContent = text;
      this.releaseUrl = r.status === 'available' ? r.latest?.url : null;
      if (openBtn) openBtn.hidden = !this.releaseUrl;
    };
    checkBtn?.addEventListener('click', async () => {
      if (!api) { if (status) status.textContent = 'Update bridge unavailable. Restart NEXORA.'; return; }
      checkBtn.disabled = true; show({ status: 'checking' });
      try { show(await api.check()); } catch (e) { show({ status: 'error', error: e?.message }); } finally { checkBtn.disabled = false; }
    });
    openBtn?.addEventListener('click', () => { if (this.releaseUrl) api?.open(this.releaseUrl); });
    api?.state?.().then((st) => { if (st && status) { status.textContent = `Running v${st.current}.${st.packaged ? '' : ' (Development build: no automatic checks.)'}`; } }).catch(() => {});
  }

  async saveSetting(keyPath, val) {
    if (!window.nexoraAPI?.config) return;
    try {
      await window.nexoraAPI.config.set(keyPath, val);
      const parts = keyPath.split('.');
      let cursor = this.config;
      for (let i = 0; i < parts.length - 1; i++) { cursor[parts[i]] ||= {}; cursor = cursor[parts[i]]; }
      cursor[parts[parts.length - 1]] = val;
      this.flashSavedBadge();
    } catch (e) {
      console.error('[NEXORA Settings] Error saving setting:', e);
    }
  }

  flashSavedBadge() {
    const badge = this.container.querySelector('#settingsSavedBadge');
    if (!badge) return;
    badge.classList.add('visible');
    setTimeout(() => badge.classList.remove('visible'), 1200);
  }
}
