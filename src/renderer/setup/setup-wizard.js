/* ==========================================================================
   NEXORA — First-Run Setup Wizard (7-step guided onboarding)
   Preserves NEXORA frosted glassmorphism UI & reuses existing VoiceAudio,
   offline WakeWord ONNX engine, OrbEngine / RobotOrb, and Autonomy Policy.
   ========================================================================== */

import { OrbEngine } from '../orb/orb-engine.js';
import { OrbStateManager } from '../orb/orb-state.js';

const NEXORA_LOGO_URL = new URL('../../../assets/icons/nexora-app-icon.png', import.meta.url).href;
const NEXORA_MARKER_URL = new URL('../assets/nexora-icon.png', import.meta.url).href;

const STEP_META = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'api-key', title: 'Gemini API Key' },
  { id: 'mic-test', title: 'Microphone Test' },
  { id: 'wake-word', title: 'Wake Word Setup' },
  { id: 'appearance', title: 'Assistant Appearance' },
  { id: 'permissions', title: 'Computer Permissions' },
  { id: 'complete', title: 'Complete Setup' },
];

const APPEARANCE_OPTIONS = [
  { id: 'nexora', title: 'NEXORA Orb', desc: 'Classic particle sphere with a reactive voice aura.', canvas: 'wizardPreviewOrb' },
  { id: 'nexo', title: 'Neural Orb', desc: 'Connected neural-network sphere that lights up as it thinks.', canvas: 'wizardPreviewNexo' },
  { id: 'nexie', title: 'Flow Orb', desc: 'Flowing particle stream that moves with your voice.', canvas: 'wizardPreviewNexie' },
  { id: 'robot', title: 'NEXORA Robot', desc: 'Interactive 3D assistant companion with expressive animation.', canvas: 'wizardPreviewRobot' },
];
const APPEARANCE_IDS = APPEARANCE_OPTIONS.map((o) => o.id);

const PERMISSION_PRESETS = [
  {
    id: 'ask_every_time',
    title: 'Level 1 — Ask Every Time',
    badge: 'Recommended Default',
    desc: 'Preview every computer action and ask for your confirmation before NEXORA executes it.',
  },
  {
    id: 'trusted_actions',
    title: 'Level 2 — Trusted Actions',
    badge: 'Balanced',
    desc: 'Allow explicitly approved low-risk actions (opening apps, folders, URLs, search) per session while asking before modifying or clipboard actions.',
  },
  {
    id: 'advanced_autonomy',
    title: 'Level 3 — Advanced Autonomy',
    badge: 'Power User',
    desc: 'Allow broader low-risk automation within NEXORA’s safe catalogue while keeping confirmations and hard policy blocks for sensitive or irreversible actions.',
  },
];

function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class SetupWizard {
  constructor({ container, app, onComplete, onDismiss } = {}) {
    this.container = container || document.getElementById('setupWizardContainer');
    this.app = app || null;
    this.onComplete = onComplete || (() => {});
    this.onDismiss = onDismiss || (() => {});

    this.step = 0;
    this.isOpen = false;
    this.saving = false;

    this.micTesting = false;
    this.wakeTesting = false;
    this.unsubWakeHit = null;
    this.prevOnLevel = null;
    this.previewEngines = [];

    this.state = {
      keyConfigured: false,
      keyValidated: false,
      keyStatusMessage: 'Paste your Google Gemini API key to connect NEXORA.',
      keyStatusTone: 'neutral',
      keyInputVisible: false,
      keyBusy: false,

      micDeviceId: 'default',
      micDevices: [],
      micTested: false,
      micStatusMessage: 'Click Test Microphone to check permissions and live audio input.',
      micStatusTone: 'neutral',
      micLevel: 0,
      windowsDuckingPref: null,

      wakeWordEnabled: true,
      wakeTested: false,
      wakeLastHit: null,
      wakeStatusMessage: 'Test the offline ONNX wake word locally — nothing is sent to Google.',
      wakeStatusTone: 'neutral',

      orbProfile: 'nexora',
      permissionLevel: 'ask_every_time',
    };
  }

  async open({ startStep = 0 } = {}) {
    if (!this.container) return;
    await this.loadInitialState();
    this.step = Math.max(0, Math.min(STEP_META.length - 1, startStep));
    this.isOpen = true;
    this.container.hidden = false;
    await this.renderStep();
  }

  async close({ completed = false } = {}) {
    await this.cleanupStepResources();
    this.isOpen = false;
    if (this.container) {
      this.container.hidden = true;
      this.container.innerHTML = '';
    }
    if (!completed) this.onDismiss();
  }

  async loadInitialState() {
    const api = window.nexoraAPI;
    try {
      const cfg = await api?.config?.getAll?.();
      if (cfg) {
        this.state.micDeviceId = cfg.audio?.micDeviceId || 'default';
        this.state.wakeWordEnabled = cfg.voice?.wakeWordEnabled !== false;
        this.state.orbProfile = APPEARANCE_IDS.includes(cfg.appearance?.orbProfile) ? cfg.appearance.orbProfile : 'nexora';
        const presetRaw = cfg.setup?.permissionPreset || cfg.setup?.permissionLevel;
        this.state.permissionLevel = PERMISSION_PRESETS.some((p) => p.id === presetRaw)
          ? presetRaw
          : 'ask_every_time';
      }
    } catch { /* defaults remain */ }

    try {
      const ks = await api?.ai?.keyStatus?.();
      this.state.keyConfigured = !!ks?.configured;
      this.state.keyValidated = false;
      if (ks?.configured) {
        this.state.keyStatusMessage = 'An encrypted Gemini API key is saved on this PC. Click Verify Saved Key or enter a new key.';
        this.state.keyStatusTone = 'warn';
      }
    } catch { /* ignore */ }

    try {
      const diag = await api?.audio?.diagnostics?.();
      if (diag && typeof diag.duckingValue === 'number') {
        this.state.windowsDuckingPref = diag.duckingValue;
      }
    } catch { /* ignore */ }
  }

  async cleanupStepResources() {
    await this.stopMicTest();
    await this.stopWakeTest();
    this.destroyPreviews();
  }

  destroyPreviews() {
    for (const engine of this.previewEngines) {
      try { engine.destroy(); } catch { /* ignore */ }
    }
    this.previewEngines = [];
  }

  async goToStep(nextStep) {
    const target = Math.max(0, Math.min(STEP_META.length - 1, nextStep));
    if (target === 2 && this.step === 1 && !this.canAdvanceFromKeyStep()) {
      this.state.keyStatusTone = 'err';
      this.state.keyStatusMessage = 'Validate a Gemini API key first, or click Configure Later to exit setup.';
      this.updateKeyStatusDom();
      return;
    }
    await this.cleanupStepResources();
    this.step = target;
    await this.renderStep();
  }

  canAdvanceFromKeyStep() {
    return this.state.keyConfigured && this.state.keyValidated;
  }

  renderBrandEmblemHtml() {
    return `
      <div class="setup-brand-emblem" aria-hidden="true">
        <img class="setup-brand-img" src="${escapeHtml(NEXORA_LOGO_URL)}" alt="NEXORA" width="76" height="76" draggable="false" onerror="this.onerror=null;this.src='${escapeHtml(NEXORA_MARKER_URL)}'" />
      </div>`;
  }

  renderHeaderHtml() {
    const dots = STEP_META.map((m, i) => {
      const isDone = i < this.step;
      const isActive = i === this.step;
      const cls = isDone ? 'done' : (isActive ? 'active' : '');
      const marker = isActive
        ? `<img class="setup-step-marker" src="${escapeHtml(NEXORA_MARKER_URL)}" alt="" width="14" height="14" draggable="false" />`
        : '';
      return `<span class="setup-step-dot ${cls}" title="Step ${i + 1}: ${escapeHtml(m.title)}">${marker}</span>`;
    }).join('');
    return `
      <div class="setup-wizard-header">
        <div class="setup-step-meta">
          <span class="setup-step-kicker">Step ${this.step + 1} of ${STEP_META.length}</span>
          <h2 class="setup-step-heading" id="setupWizardTitle">${escapeHtml(STEP_META[this.step].title)}</h2>
        </div>
        <div class="setup-step-dots" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${STEP_META.length}" aria-valuenow="${this.step + 1}">${dots}</div>
      </div>`;
  }

  renderFooterHtml() {
    const isFirst = this.step === 0;
    const isLast = this.step === STEP_META.length - 1;
    const isKeyStep = this.step === 1;
    const nextDisabled = isKeyStep && !this.canAdvanceFromKeyStep() ? 'disabled' : '';

    return `
      <div class="setup-wizard-footer">
        <button type="button" class="btn-secondary" id="wizardExitLater">Configure Later</button>
        <div class="setup-footer-right">
          ${!isFirst ? '<button type="button" class="btn-secondary" id="wizardBackBtn">Back</button>' : ''}
          ${isFirst ? '<button type="button" class="btn-primary" id="wizardStartBtn">Start Setup</button>' : ''}
          ${!isFirst && !isLast ? `<button type="button" class="btn-primary" id="wizardNextBtn" ${nextDisabled}>Next</button>` : ''}
          ${isLast ? '<button type="button" class="btn-primary" id="wizardFinishBtn">Finish Setup</button>' : ''}
        </div>
      </div>`;
  }

  async renderStep() {
    if (!this.container) return;
    let body = '';

    if (this.step === 0) {
      body = `
        <div class="setup-welcome-hero">
          ${this.renderBrandEmblemHtml()}
          <h1 class="setup-welcome-title">NEXORA</h1>
          <p class="setup-welcome-subtitle">Your Personal AI Desktop Assistant</p>
          <p class="setup-welcome-copy">
            This quick guided setup connects your encrypted Gemini API key, tests your microphone without altering Windows volumes,
            calibrates the offline wake word, and lets you choose your assistant appearance and safety permissions.
          </p>
        </div>`;
    } else if (this.step === 1) {
      const toneClass = this.state.keyStatusTone === 'ok' ? 'ok' : (this.state.keyStatusTone === 'err' ? 'err' : (this.state.keyStatusTone === 'warn' ? 'warn' : ''));
      const showRetry = this.state.keyStatusTone === 'err';
      body = `
        <div class="setup-panel-box">
          <label for="wizardApiKeyInput">Gemini API Key (stored encrypted via Electron safeStorage in the main process)</label>
          <div class="setup-input-row">
            <input id="wizardApiKeyInput" type="${this.state.keyInputVisible ? 'text' : 'password'}" placeholder="Paste AIza... key here" autocomplete="off" spellcheck="false" />
            <button type="button" class="btn-secondary" id="wizardToggleKeyBtn">${this.state.keyInputVisible ? 'Hide' : 'Show'}</button>
          </div>
          <div class="setup-inline-actions">
            <button type="button" class="btn-primary" id="wizardValidateKeyBtn" ${this.state.keyBusy ? 'disabled aria-busy="true"' : ''}>${this.state.keyBusy ? 'Validating...' : 'Validate & Save Key'}</button>
            ${showRetry ? `<button type="button" class="btn-secondary" id="wizardRetryKeyBtn" ${this.state.keyBusy ? 'disabled' : ''}>Retry</button>` : ''}
            ${this.state.keyConfigured ? `<button type="button" class="btn-secondary" id="wizardVerifySavedKeyBtn" ${this.state.keyBusy ? 'disabled' : ''}>Verify Saved Key</button>` : ''}
          </div>
          <div class="setup-status-banner ${toneClass}" id="wizardKeyStatus">${escapeHtml(this.state.keyStatusMessage)}</div>
        </div>
        <p class="setting-hint">Your key is never written to logs and never exposed to renderer state after saving.</p>`;
    } else if (this.step === 2) {
      const devices = await this.refreshMicDevices();
      const optionsHtml = [
        `<option value="default" ${this.state.micDeviceId === 'default' ? 'selected' : ''}>System Default Microphone</option>`,
        ...devices
          .filter((d) => d.deviceId && d.deviceId !== 'default')
          .map((d) => `<option value="${escapeHtml(d.deviceId)}" ${this.state.micDeviceId === d.deviceId ? 'selected' : ''}>${escapeHtml(d.label)}${d.isBluetoothHeadset ? ' (Bluetooth Headset)' : ''}</option>`),
      ].join('');
      const toneClass = this.state.micStatusTone === 'ok' ? 'ok' : (this.state.micStatusTone === 'err' ? 'err' : '');
      const duckNote = this.state.windowsDuckingPref != null && this.state.windowsDuckingPref !== 3
        ? '<p class="setting-hint">Tip: Windows Sound Communications ducking is currently active at OS level. If apps lower or change volume during calls/mic use, open Settings → Audio to review it safely.</p>'
        : '';
      body = `
        <div class="setup-panel-box">
          <label for="wizardMicSelect">Microphone Device</label>
          <select id="wizardMicSelect">${optionsHtml}</select>
          <div class="setup-inline-actions">
            <button type="button" class="btn-primary" id="wizardMicTestBtn">${this.micTesting ? 'Stop Test' : 'Test Microphone'}</button>
            <button type="button" class="btn-secondary" id="wizardMicRefreshBtn">Refresh Devices</button>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
              <span>Live Microphone Level</span>
              <span id="wizardMicLevelText">${Math.round(this.state.micLevel * 100)}%</span>
            </div>
            <div class="setup-meter-track"><div class="setup-meter-fill" id="wizardMicLevelBar" style="width:${Math.round(this.state.micLevel * 100)}%"></div></div>
          </div>
          <div class="setup-status-banner ${toneClass}" id="wizardMicStatus">${escapeHtml(this.state.micStatusMessage)}</div>
          ${duckNote}
        </div>`;
    } else if (this.step === 3) {
      const toneClass = this.state.wakeStatusTone === 'ok' ? 'ok' : (this.state.wakeStatusTone === 'err' ? 'err' : '');
      body = `
        <div class="setup-panel-box">
          <div class="setting-row">
            <div>
              <span style="display:block;font-weight:600;">Enable Offline Wake Word</span>
              <small style="color:rgba(255,255,255,0.68);">Say “Hey NEXORA” or “NEXORA” locally via ONNX before connecting to Gemini.</small>
            </div>
            <label class="setting-toggle">
              <input type="checkbox" id="wizardWakeToggle" ${this.state.wakeWordEnabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setup-inline-actions">
            <button type="button" class="btn-primary" id="wizardWakeTestBtn">${this.wakeTesting ? 'Stop Wake Test' : 'Test Wake Word'}</button>
          </div>
          <div class="setup-status-banner ${toneClass}" id="wizardWakeStatus">${escapeHtml(this.state.wakeStatusMessage)}</div>
        </div>
        <p class="setting-hint">Wake word detection runs offline in the local NEXORA engine and never streams microphone audio to Google until wake triggers.</p>`;
    } else if (this.step === 4) {
      const cards = APPEARANCE_OPTIONS.map((o) => `
          <button type="button" class="setup-choice-card ${this.state.orbProfile === o.id ? 'selected' : ''}" data-appearance="${o.id}" role="radio" aria-checked="${this.state.orbProfile === o.id}">
            <div class="setup-preview-wrap"><canvas class="setup-preview-canvas" id="${o.canvas}" width="340" height="300"></canvas></div>
            <strong>${escapeHtml(o.title)}</strong>
            <small>${escapeHtml(o.desc)}</small>
          </button>`).join('');
      body = `
        <div class="setup-choice-grid" role="radiogroup" aria-label="Choose Assistant Appearance">${cards}
        </div>`;
    } else if (this.step === 5) {
      const cards = PERMISSION_PRESETS.map((preset) => `
        <button type="button" class="setup-perm-option ${this.state.permissionLevel === preset.id ? 'selected' : ''}" data-perm-level="${preset.id}" role="radio" aria-checked="${this.state.permissionLevel === preset.id}">
          <span class="setup-perm-title-row">
            <strong>${escapeHtml(preset.title)}</strong>
            <span class="setup-perm-badge">${escapeHtml(preset.badge)}</span>
          </span>
          <span class="setup-perm-desc">${escapeHtml(preset.desc)}</span>
        </button>`).join('');
      body = `
        <div class="setup-perm-list" role="radiogroup" aria-label="Computer Action Permissions">${cards}</div>
        <p class="setting-hint">Enforced by NEXORA’s action policy catalogue and confirmation gate. Individual actions remain configurable in Autonomy.</p>`;
    } else if (this.step === 6) {
      const preset = PERMISSION_PRESETS.find((p) => p.id === this.state.permissionLevel) || PERMISSION_PRESETS[0];
      const micObj = this.state.micDevices.find((d) => d.deviceId === this.state.micDeviceId);
      const micLabel = micObj?.label || 'System Default Microphone';
      body = `
        <div class="setup-welcome-hero setup-complete-hero">
          ${this.renderBrandEmblemHtml()}
          <h1 class="setup-welcome-title setup-complete-title">NEXORA IS READY</h1>
          <p class="setup-welcome-copy">Your preferences are ready to save. Updates never reset your settings or memory.</p>
        </div>
        <div class="setup-summary-grid">
          <div class="setup-summary-item"><span>Gemini API Key</span><strong>${this.state.keyConfigured ? 'Encrypted & Connected' : 'Not Set'}</strong></div>
          <div class="setup-summary-item"><span>Microphone</span><strong>${escapeHtml(micLabel)}${this.state.micTested ? ' (Tested)' : ''}</strong></div>
          <div class="setup-summary-item"><span>Wake Word</span><strong>${this.state.wakeWordEnabled ? 'Enabled (Offline ONNX)' : 'Disabled'}</strong></div>
          <div class="setup-summary-item"><span>Appearance</span><strong>${escapeHtml((APPEARANCE_OPTIONS.find((o) => o.id === this.state.orbProfile) || APPEARANCE_OPTIONS[0]).title)}</strong></div>
          <div class="setup-summary-item setup-summary-item-wide"><span>Action Safety Level</span><strong>${escapeHtml(preset.title)}</strong></div>
        </div>`;
    }

    this.container.innerHTML = `
      <div class="setup-wizard-card">
        ${this.renderHeaderHtml()}
        <div class="setup-wizard-body">${body}</div>
        ${this.renderFooterHtml()}
      </div>`;

    this.bindStepEvents();
  }

  bindStepEvents() {
    this.container.querySelector('#wizardExitLater')?.addEventListener('click', () => { void this.close({ completed: false }); });
    this.container.querySelector('#wizardBackBtn')?.addEventListener('click', () => { void this.goToStep(this.step - 1); });
    this.container.querySelector('#wizardStartBtn')?.addEventListener('click', () => { void this.goToStep(1); });
    this.container.querySelector('#wizardNextBtn')?.addEventListener('click', () => { void this.goToStep(this.step + 1); });
    this.container.querySelector('#wizardFinishBtn')?.addEventListener('click', () => { void this.finishSetup(); });

    if (this.step === 1) this.bindApiKeyEvents();
    else if (this.step === 2) this.bindMicEvents();
    else if (this.step === 3) this.bindWakeEvents();
    else if (this.step === 4) this.initAppearancePreviews();
    else if (this.step === 5) this.bindPermissionEvents();
  }

  bindApiKeyEvents() {
    const input = this.container.querySelector('#wizardApiKeyInput');
    const toggleBtn = this.container.querySelector('#wizardToggleKeyBtn');
    const validateBtn = this.container.querySelector('#wizardValidateKeyBtn');
    const verifySavedBtn = this.container.querySelector('#wizardVerifySavedKeyBtn');

    toggleBtn?.addEventListener('click', () => {
      this.state.keyInputVisible = !this.state.keyInputVisible;
      if (input) input.type = this.state.keyInputVisible ? 'text' : 'password';
      toggleBtn.textContent = this.state.keyInputVisible ? 'Hide' : 'Show';
    });

    const runValidate = async () => {
      const candidate = input?.value?.trim() || '';
      if (!candidate) {
        this.state.keyStatusTone = 'err';
        this.state.keyStatusMessage = 'Paste a Gemini API key first (or click Verify Saved Key if already configured).';
        this.updateKeyStatusDom();
        return;
      }
      this.state.keyBusy = true;
      this.state.keyStatusTone = 'neutral';
      this.state.keyStatusMessage = 'Checking connection with Google Gemini...';
      this.updateKeyStatusDom();

      try {
        const res = await window.nexoraAPI?.ai?.validateKey?.(candidate);
        if (res?.valid) {
          const saved = await window.nexoraAPI?.ai?.saveKey?.(candidate);
          if (saved?.success !== false) {
            if (input) input.value = '';
            this.state.keyConfigured = true;
            this.state.keyValidated = true;
            this.state.keyStatusTone = 'ok';
            this.state.keyStatusMessage = res.warning || 'Connected! Key encrypted with Windows safeStorage.';
          } else {
            this.state.keyValidated = false;
            this.state.keyStatusTone = 'err';
            this.state.keyStatusMessage = saved?.error || 'Validated, but failed to save encrypted key.';
          }
        } else {
          this.state.keyValidated = false;
          this.state.keyStatusTone = 'err';
          this.state.keyStatusMessage = res?.error || 'API key validation failed. Please check and retry.';
        }
      } catch {
        this.state.keyValidated = false;
        this.state.keyStatusTone = 'err';
        this.state.keyStatusMessage = 'Network or validation error. Please retry.';
      } finally {
        this.state.keyBusy = false;
        this.updateKeyStatusDom();
      }
    };

    validateBtn?.addEventListener('click', () => { void runValidate(); });
    this.container.querySelector('#wizardRetryKeyBtn')?.addEventListener('click', () => { void runValidate(); });

    verifySavedBtn?.addEventListener('click', async () => {
      this.state.keyBusy = true;
      this.state.keyStatusTone = 'neutral';
      this.state.keyStatusMessage = 'Verifying encrypted saved key...';
      this.updateKeyStatusDom();
      verifySavedBtn.disabled = true;
      try {
        const res = await window.nexoraAPI?.ai?.validateStoredKey?.();
        if (res?.valid) {
          this.state.keyConfigured = true;
          this.state.keyValidated = true;
          this.state.keyStatusTone = 'ok';
          this.state.keyStatusMessage = res.warning || 'Saved Gemini API key verified successfully.';
        } else {
          this.state.keyValidated = false;
          this.state.keyStatusTone = 'err';
          this.state.keyStatusMessage = res?.error || 'Saved key could not be verified. Paste a new key and retry.';
        }
      } finally {
        this.state.keyBusy = false;
        verifySavedBtn.disabled = false;
        this.updateKeyStatusDom();
      }
    });
  }

  updateKeyStatusDom() {
    const el = this.container?.querySelector('#wizardKeyStatus');
    const nextBtn = this.container?.querySelector('#wizardNextBtn');
    const validateBtn = this.container?.querySelector('#wizardValidateKeyBtn');
    const actionsRow = this.container?.querySelector('.setup-inline-actions');
    if (el) {
      el.textContent = this.state.keyStatusMessage;
      el.className = `setup-status-banner ${this.state.keyStatusTone === 'ok' ? 'ok' : (this.state.keyStatusTone === 'err' ? 'err' : (this.state.keyStatusTone === 'warn' ? 'warn' : ''))}`;
    }
    if (validateBtn) {
      validateBtn.disabled = this.state.keyBusy;
      validateBtn.setAttribute('aria-busy', this.state.keyBusy ? 'true' : 'false');
      validateBtn.textContent = this.state.keyBusy ? 'Validating...' : 'Validate & Save Key';
    }
    if (actionsRow) {
      let retryBtn = this.container.querySelector('#wizardRetryKeyBtn');
      if (this.state.keyStatusTone === 'err' && !retryBtn) {
        retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'btn-secondary';
        retryBtn.id = 'wizardRetryKeyBtn';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', () => { validateBtn?.click(); });
        validateBtn?.insertAdjacentElement('afterend', retryBtn);
      } else if (retryBtn) {
        retryBtn.hidden = this.state.keyStatusTone !== 'err';
        retryBtn.disabled = this.state.keyBusy;
      }
    }
    if (nextBtn) nextBtn.disabled = !this.canAdvanceFromKeyStep();
  }

  async refreshMicDevices() {
    try {
      const devices = await this.app?.voiceAudio?.listInputDevices?.();
      this.state.micDevices = Array.isArray(devices) ? devices : [];
    } catch {
      this.state.micDevices = [];
    }
    return this.state.micDevices;
  }

  bindMicEvents() {
    const select = this.container.querySelector('#wizardMicSelect');
    const testBtn = this.container.querySelector('#wizardMicTestBtn');
    const refreshBtn = this.container.querySelector('#wizardMicRefreshBtn');

    select?.addEventListener('change', async () => {
      this.state.micDeviceId = select.value || 'default';
      this.app?.voiceAudio?.setCaptureOptions?.({ deviceId: this.state.micDeviceId });
      await window.nexoraAPI?.config?.set?.('audio.micDeviceId', this.state.micDeviceId);
      if (this.micTesting) {
        await this.stopMicTest();
        await this.startMicTest();
      }
    });

    refreshBtn?.addEventListener('click', async () => {
      await this.refreshMicDevices();
      await this.renderStep();
    });

    testBtn?.addEventListener('click', async () => {
      if (this.micTesting) await this.stopMicTest();
      else await this.startMicTest();
    });
  }

  async startMicTest() {
    const va = this.app?.voiceAudio;
    if (!va) {
      this.state.micStatusTone = 'err';
      this.state.micStatusMessage = 'VoiceAudio capture module is not initialized.';
      this.updateMicDom();
      return;
    }
    this.prevOnLevel = va.onLevel;
    va.setCaptureOptions({ deviceId: this.state.micDeviceId });
    va.onLevel = (kind, level) => {
      if (kind === 'mic') {
        const clamped = Math.max(0, Math.min(1, Number(level) * 3.2));
        this.state.micLevel = clamped;
        const bar = this.container?.querySelector('#wizardMicLevelBar');
        const txt = this.container?.querySelector('#wizardMicLevelText');
        if (bar) bar.style.width = `${Math.round(clamped * 100)}%`;
        if (txt) txt.textContent = `${Math.round(clamped * 100)}%`;
      }
    };

    this.state.micStatusTone = 'neutral';
    this.state.micStatusMessage = 'Requesting microphone access...';
    this.updateMicDom();

    const res = await va.startCapture({ forwardToMain: false });
    if (res?.success) {
      this.micTesting = true;
      this.state.micTested = true;
      this.state.micStatusTone = 'ok';
      this.state.micStatusMessage = `Listening on ${res.deviceLabel || 'Default Microphone'} — speak to test your level.`;
      // Re-enumerate after permission grant so real device names populate cleanly
      await this.refreshMicDevices();
    } else {
      this.micTesting = false;
      this.state.micStatusTone = 'err';
      this.state.micStatusMessage = res?.error || 'Could not start microphone capture.';
      va.onLevel = this.prevOnLevel;
      this.prevOnLevel = null;
    }
    this.updateMicDom();
  }

  async stopMicTest() {
    if (!this.micTesting && !this.prevOnLevel) return;
    const va = this.app?.voiceAudio;
    if (va) {
      va.stopCapture({ keepWanted: false });
      if (this.prevOnLevel) {
        va.onLevel = this.prevOnLevel;
        this.prevOnLevel = null;
      }
    }
    this.micTesting = false;
    this.state.micLevel = 0;
    if (this.step === 2) {
      if (this.state.micStatusTone === 'ok') {
        this.state.micStatusMessage = 'Microphone test stopped cleanly.';
      }
      this.updateMicDom();
    }
  }

  updateMicDom() {
    const btn = this.container?.querySelector('#wizardMicTestBtn');
    const st = this.container?.querySelector('#wizardMicStatus');
    const bar = this.container?.querySelector('#wizardMicLevelBar');
    const txt = this.container?.querySelector('#wizardMicLevelText');
    if (btn) btn.textContent = this.micTesting ? 'Stop Test' : 'Test Microphone';
    if (st) {
      st.textContent = this.state.micStatusMessage;
      st.className = `setup-status-banner ${this.state.micStatusTone === 'ok' ? 'ok' : (this.state.micStatusTone === 'err' ? 'err' : '')}`;
    }
    if (bar) bar.style.width = `${Math.round(this.state.micLevel * 100)}%`;
    if (txt) txt.textContent = `${Math.round(this.state.micLevel * 100)}%`;
  }

  bindWakeEvents() {
    const toggle = this.container.querySelector('#wizardWakeToggle');
    const testBtn = this.container.querySelector('#wizardWakeTestBtn');

    toggle?.addEventListener('change', async () => {
      this.state.wakeWordEnabled = !!toggle.checked;
      await window.nexoraAPI?.config?.set?.('voice.wakeWordEnabled', this.state.wakeWordEnabled);
      if (!this.state.wakeWordEnabled && this.wakeTesting) {
        await this.stopWakeTest();
      }
    });

    testBtn?.addEventListener('click', async () => {
      if (this.wakeTesting) await this.stopWakeTest();
      else await this.startWakeTest();
    });
  }

  async startWakeTest() {
    const api = window.nexoraAPI;
    const va = this.app?.voiceAudio;
    if (!va || !api?.voice?.startWakeTest) return;

    this.state.wakeStatusTone = 'neutral';
    this.state.wakeStatusMessage = 'Starting offline ONNX wake word detector...';
    this.updateWakeDom();

    const started = await api.voice.startWakeTest();
    if (!started?.success) {
      this.state.wakeStatusTone = 'err';
      this.state.wakeStatusMessage = started?.error || 'Could not start offline wake word engine.';
      this.updateWakeDom();
      return;
    }

    va.setCaptureOptions({ deviceId: this.state.micDeviceId });
    const cap = await va.startCapture({ forwardToMain: true });
    if (!cap?.success) {
      await api.voice.stopWakeTest(false);
      this.state.wakeStatusTone = 'err';
      this.state.wakeStatusMessage = cap?.error || 'Microphone failed during wake word test.';
      this.updateWakeDom();
      return;
    }

    this.wakeTesting = true;
    this.unsubWakeHit = api.voice.onWakeTestHit?.((hit) => {
      this.state.wakeTested = true;
      this.state.wakeLastHit = hit;
      this.state.wakeStatusTone = 'ok';
      this.state.wakeStatusMessage = `Wake word detected locally: “${hit?.word || 'NEXORA'}” (${Math.round((hit?.score || 0.9) * 100)}% confidence).`;
      this.app?.soundSystem?.playWake?.();
      this.updateWakeDom();
    }) || null;

    this.state.wakeStatusTone = 'ok';
    this.state.wakeStatusMessage = 'Listening locally offline — say “Hey NEXORA” or “NEXORA”.';
    this.updateWakeDom();
  }

  async stopWakeTest() {
    const wasTesting = this.wakeTesting;
    this.wakeTesting = false;
    try { this.unsubWakeHit?.(); } catch { /* ignore */ }
    this.unsubWakeHit = null;
    this.app?.voiceAudio?.stopCapture({ keepWanted: false });
    if (wasTesting) {
      try { await window.nexoraAPI?.voice?.stopWakeTest?.(false); } catch { /* ignore */ }
    }
    if (this.step === 3 && wasTesting && !this.state.wakeLastHit) {
      this.state.wakeStatusTone = 'neutral';
      this.state.wakeStatusMessage = 'Wake word test stopped.';
    }
    if (this.step === 3) this.updateWakeDom();
  }

  updateWakeDom() {
    const btn = this.container?.querySelector('#wizardWakeTestBtn');
    const st = this.container?.querySelector('#wizardWakeStatus');
    if (btn) btn.textContent = this.wakeTesting ? 'Stop Wake Test' : 'Test Wake Word';
    if (st) {
      st.textContent = this.state.wakeStatusMessage;
      st.className = `setup-status-banner ${this.state.wakeStatusTone === 'ok' ? 'ok' : (this.state.wakeStatusTone === 'err' ? 'err' : '')}`;
    }
  }

  initAppearancePreviews() {
    this.destroyPreviews();
    const cards = [...this.container.querySelectorAll('[data-appearance]')];
    const selectCard = (btn) => {
      const chosen = APPEARANCE_IDS.includes(btn.dataset.appearance) ? btn.dataset.appearance : 'nexora';
      this.state.orbProfile = chosen;
      cards.forEach((c) => {
        const on = c.dataset.appearance === chosen;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-checked', String(on));
      });
      this.app?.soundSystem?.playPanel?.();
    };
    cards.forEach((btn, idx) => {
      btn.addEventListener('click', () => selectCard(btn));
      btn.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const delta = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        const nextBtn = cards[(idx + delta + cards.length) % cards.length];
        if (nextBtn) { nextBtn.focus(); selectCard(nextBtn); }
      });
    });

    for (const opt of APPEARANCE_OPTIONS) {
      const canvas = this.container.querySelector(`#${opt.canvas}`);
      if (!canvas) continue;
      const engine = new OrbEngine(canvas, new OrbStateManager('idle'), {
        profileId: opt.id,
        persistProfile: false,
        performanceMode: opt.id === 'robot' ? 'medium' : 'low',
        previewMode: true,
      });
      engine.start();
      this.previewEngines.push(engine);
    }
  }

  bindPermissionEvents() {
    const opts = [...this.container.querySelectorAll('[data-perm-level]')];
    const selectPerm = (btn) => {
      const chosen = btn.dataset.permLevel;
      this.state.permissionLevel = chosen;
      opts.forEach((o) => {
        const on = o.dataset.permLevel === chosen;
        o.classList.toggle('selected', on);
        o.setAttribute('aria-checked', String(on));
      });
      this.app?.soundSystem?.playPanel?.();
    };
    opts.forEach((btn, idx) => {
      btn.addEventListener('click', () => selectPerm(btn));
      btn.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
        e.preventDefault();
        const delta = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
        const nextBtn = opts[(idx + delta + opts.length) % opts.length];
        if (nextBtn) { nextBtn.focus(); selectPerm(nextBtn); }
      });
    });
  }

  async finishSetup() {
    if (this.saving) return;
    this.saving = true;
    const btn = this.container?.querySelector('#wizardFinishBtn');
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving...'; }

    try {
      const api = window.nexoraAPI;
      await this.cleanupStepResources();
      await api?.config?.set?.('audio.micDeviceId', this.state.micDeviceId);
      await api?.config?.set?.('voice.wakeWordEnabled', this.state.wakeWordEnabled);
      await api?.config?.set?.('appearance.orbProfile', this.state.orbProfile);
      await api?.voice?.setOrbProfile?.(this.state.orbProfile);
      await api?.autonomy?.applyPreset?.(this.state.permissionLevel);
      await api?.config?.set?.('setup.completed', true);
      await api?.config?.set?.('setup.version', this.app?.currentVersion || '0.3.25');
      await api?.config?.set?.('setup.completedAt', new Date().toISOString());

      this.app?.orbEngine?.setProfile?.(this.state.orbProfile);
      this.app?.voiceAudio?.setCaptureOptions?.({ deviceId: this.state.micDeviceId });

      if (this.state.wakeWordEnabled) {
        void this.app?.startWakeListening?.({ restore: true });
      } else {
        await this.app?.stopWakeListening?.();
      }

      this.app?.soundSystem?.playResponse?.();
      await this.close({ completed: true });
      this.onComplete({ ...this.state });
    } finally {
      this.saving = false;
    }
  }
}
