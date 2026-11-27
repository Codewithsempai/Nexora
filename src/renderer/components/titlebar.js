/* ==========================================================================
   NEXORA — Custom Frameless Titlebar
   Windows 11 optimized draggable header with custom window controls.
   ========================================================================== */

export class Titlebar {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.isMaximized = false;
    this.render();
    this.initEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="nexora-titlebar">
        <div class="titlebar-drag-region">
          <div class="brand-cluster">
            <img class="brand-logo" src="assets/nexora-icon.png" alt="" width="24" height="24" draggable="false" aria-hidden="true">
            <span class="brand-title">NEXORA</span>
          </div>
          <div class="titlebar-status-badge">
            <span class="status-pulse-dot active" id="titlebarStatusDot"></span>
            <span class="status-text" id="titlebarStatusText">NEXORA — Wake standby</span>
          </div>
        </div>
        <div class="titlebar-controls">
          <button class="titlebar-update-badge" id="titlebarUpdateBadge" type="button" hidden aria-live="polite"><span class="update-badge-dot" aria-hidden="true"></span><span id="titlebarUpdateText">Update available</span></button>
          <button class="titlebar-btn btn-minimize" id="btnMinimize" title="Minimize" aria-label="Minimize"><svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg></button>
          <button class="titlebar-btn btn-maximize" id="btnMaximize" title="Maximize / Restore" aria-label="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" id="maximizeIcon"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg></button>
          <button class="titlebar-btn btn-close" id="btnClose" title="Close" aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg></button>
        </div>
      </div>`;
  }

  /** Small "Update available" pill. mode: 'available' | 'downloading' | 'ready' | null (hides it). */
  setUpdateBadge({ mode = null, version = '', percent = 0 } = {}) {
    const badge = this.container.querySelector('#titlebarUpdateBadge');
    const text = this.container.querySelector('#titlebarUpdateText');
    if (!badge || !text) return;
    if (!mode) { badge.hidden = true; delete badge.dataset.mode; return; }
    const v = version ? ` v${version}` : '';
    text.textContent = mode === 'ready' ? 'Restart to update' : (mode === 'downloading' ? `Updating ${Math.round(percent || 0)}%` : 'Update available');
    badge.title = mode === 'ready' ? `NEXORA${v} is ready. Open Support & Updates to install.` : (mode === 'downloading' ? `Downloading NEXORA${v}...` : `NEXORA${v} is available. Click for details.`);
    badge.dataset.mode = mode;
    badge.hidden = false;
  }

  async initEvents() {
    const badgeBtn = this.container.querySelector('#titlebarUpdateBadge');
    badgeBtn?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); this.options.onUpdateBadgeClick?.(); });
    const api = window.nexoraAPI?.window;
    if (!api) return;

    const btnMin = this.container.querySelector('#btnMinimize');
    const btnMax = this.container.querySelector('#btnMaximize');
    const btnClose = this.container.querySelector('#btnClose');

    btnMin?.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopPropagation();
      this.options.onSound?.('panelClose');
      try {
        await api.minimize();
      } catch (error) {
        console.error('[NEXORA Window] Minimize failed:', error?.message || error);
      }
    });

    btnMax?.addEventListener('click', async (event) => {
      event.preventDefault(); event.stopPropagation();
      this.options.onSound?.('modeSwitch');
      await api.maximize();
      // Native maximize/unmaximize events are authoritative; query as a fallback.
      try { this.updateMaximizeIcon(await api.isMaximized()); } catch {}
      btnMax.blur();
    });

    btnClose?.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      this.options.onSound?.('panelClose');
      api.close();
    });

    // Frameless Windows titlebars should also toggle on double-click.
    const dragRegion = this.container.querySelector('.titlebar-drag-region');
    dragRegion?.addEventListener('dblclick', async (event) => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      await api.maximize();
    });

    this.unsubscribeMaximized = api.onMaximizedChanged?.((maximized) => this.updateMaximizeIcon(maximized));

    // Check initial state
    try {
      this.isMaximized = await api.isMaximized();
      this.updateMaximizeIcon(this.isMaximized);
    } catch (e) {}
  }

  /** Square edges + no outer margin whenever the window fills the screen (maximized or full screen). */
  applyWindowFrame() {
    const fills = this.isMaximized || !!document.fullscreenElement
      || (window.outerWidth >= screen.availWidth - 2 && window.outerHeight >= screen.availHeight - 2);
    document.documentElement.classList.toggle('is-maximized', !!fills);
    if (!this.frameListener) { this.frameListener = () => this.applyWindowFrame(); window.addEventListener('resize', this.frameListener); }
  }

  updateMaximizeIcon(isMax) {
    this.isMaximized = isMax;
    this.applyWindowFrame();
    const icon = this.container.querySelector('#maximizeIcon');
    if (!icon) return;

    if (isMax) {
      icon.innerHTML = `
        <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor"/>
        <polyline points="0.5,2.5 0.5,9.5 7.5,9.5" fill="none" stroke="currentColor"/>
      `;
    } else {
      icon.innerHTML = `<rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/>`;
    }
  }

  setStatus(text, stateClass = 'active') {
    const textEl = this.container.querySelector('#titlebarStatusText');
    const dotEl = this.container.querySelector('#titlebarStatusDot');
    if (textEl) textEl.textContent = /^NEXORA\s*[—-]/i.test(text) ? text : `NEXORA — ${String(text || 'Wake standby').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`;
    if (dotEl) {
      dotEl.className = 'status-pulse-dot ' + stateClass;
    }
  }
}
