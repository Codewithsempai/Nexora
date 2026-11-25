/* NEXORA horizontal workspace navigation. Keep NAV_ITEMS stable for app routing. */
export const NAV_ITEMS = {
  CORE: 'core', MEMORY: 'memory', REMINDER: 'reminder', AUTONOMY: 'autonomy',
  CHAT: 'chat', ORB: 'orb', TELEMETRY: 'telemetry', SETTINGS: 'settings',
};

export const NAV_ALIASES = {
  home: NAV_ITEMS.CORE, conversation: NAV_ITEMS.CHAT, status: NAV_ITEMS.TELEMETRY,
  reminders: NAV_ITEMS.REMINDER, auto: NAV_ITEMS.AUTONOMY,
};

const NAV_LABELS = [
  [NAV_ITEMS.CORE, 'CORE', 'Core workspace'],
  [NAV_ITEMS.MEMORY, 'MEMORY', 'Memory vault'],
  [NAV_ITEMS.REMINDER, 'REMINDER', 'Reminders'],
  [NAV_ITEMS.AUTONOMY, 'AUTO', 'Autonomous actions'],
  [NAV_ITEMS.CHAT, 'CHAT', 'Conversation'],
  [NAV_ITEMS.ORB, 'ORB & ROBOT', 'Orb & Robot Studio'],
  [NAV_ITEMS.TELEMETRY, 'TELEMETRY', 'System telemetry'],
  [NAV_ITEMS.SETTINGS, 'SETTINGS', 'Settings'],
];

export class Navigation {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.activeItem = NAV_ITEMS.CORE;
    this.render();
    this.initEvents();
  }

  render() {
    this.container.innerHTML = `
      <nav class="nexora-nav-dock" aria-label="Main Navigation">
        ${NAV_LABELS.map(([key, label, title]) => `
          <button class="nav-item${key === NAV_ITEMS.CORE ? ' active' : ''}" data-nav="${key}" title="${title}" type="button">
            <span class="nav-label">${label}</span>
            ${key === NAV_ITEMS.REMINDER || key === NAV_ITEMS.AUTONOMY ? `<span class="nav-badge" data-badge="${key}" hidden>0</span>` : ''}
          </button>`).join('')}
        <button class="nav-item nav-exit" id="navExitBtn" data-nav-exit="true" title="Exit NEXORA" type="button"><span class="nav-label">EXIT</span></button>
      </nav>`;
  }

  initEvents() {
    this.container.querySelectorAll('.nav-item:not(.nav-exit)').forEach((btn) => {
      btn.addEventListener('click', () => this.options.onNavigate?.(btn.dataset.nav));
    });
    this.container.querySelector('#navExitBtn')?.addEventListener('click', () => this.confirmExit());
  }

  /** Red glass confirmation; only the Exit button actually quits the program. */
  confirmExit() {
    if (document.getElementById('exitConfirmOverlay')) return;
    this.options.onSound?.('modeSwitch');
    const overlay = document.createElement('div');
    overlay.id = 'exitConfirmOverlay'; overlay.className = 'exit-confirm-overlay';
    overlay.setAttribute('role', 'alertdialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'exitConfirmTitle');
    overlay.innerHTML = `
      <div class="exit-confirm-card">
        <div class="exit-confirm-icon" aria-hidden="true">!</div>
        <h3 id="exitConfirmTitle">Exit NEXORA?</h3>
        <p>This closes NEXORA completely, including wake word, reminders and background tasks.</p>
        <div class="exit-confirm-actions">
          <button type="button" class="exit-btn-cancel">Cancel</button>
          <button type="button" class="exit-btn-confirm">Exit</button>
        </div>
      </div>`;
    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.exit-btn-cancel').addEventListener('click', close);
    overlay.querySelector('.exit-btn-confirm').addEventListener('click', async () => {
      close();
      try { await window.nexoraAPI?.window?.exitApp?.(); } catch { window.close(); }
    });
    document.body.append(overlay);
    overlay.querySelector('.exit-btn-cancel').focus();
  }

  setActive(targetNav, triggerCallback = false) {
    const normalized = NAV_ALIASES[targetNav] || targetNav || NAV_ITEMS.CORE;
    this.activeItem = normalized;
    this.container.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === normalized);
      btn.setAttribute('aria-current', btn.dataset.nav === normalized ? 'page' : 'false');
    });
    if (triggerCallback) {
      this.options.onSound?.('modeSwitch');
      this.options.onNavigate?.(normalized);
    }
  }

  setBadge(nav, count) {
    const badge = this.container.querySelector(`[data-badge="${nav}"]`);
    if (!badge) return;
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden = !(count > 0);
  }

  getActive() { return this.activeItem; }
}
