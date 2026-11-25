/* ==========================================================================
   NEXORA — Chat Conversation Panel
   Streaming Gemini conversation interface with persistence and cancellation.
   ========================================================================== */

import { ORB_STATES } from '../orb/orb-state.js';

export class ChatPanel {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.messages = this.loadHistory();
    // When memory is cleared / something is forgotten, older chat messages must not leak it back to the model.
    try { this.memoryCut = Number(localStorage.getItem('nexora.chat.memCut') || 0) || 0; } catch { this.memoryCut = 0; }
    this.unsubscribeMemory = window.nexoraAPI?.memory?.onChanged?.((event) => {
      if (event && ['clear', 'forget', 'remove'].includes(event.type)) { this.memoryCut = Date.now(); try { localStorage.setItem('nexora.chat.memCut', String(this.memoryCut)); } catch { /* ignore */ } }
    });
    this.isResponding = false;
    this.currentRequestId = null;
    this.pendingAssistantId = null;
    this.firstChunkReceived = false;
    this.render();
    this.initEvents();
    this.loadModelTag();
    if (!this.messages.length) this.loadDefaultWelcome(); else this.renderMessages();
  }

  render() {
    this.container.innerHTML = `
      <div class="nexora-panel nexora-chat-panel">
        <div class="panel-header">
          <div class="panel-title-cluster">
            <h2 class="panel-title">Chat</h2><span class="panel-subtitle">Talk, plan, build and get things done</span>
            <span class="simulation-tag" title="Configured Gemini chat model" id="chatModelTag">GEMINI</span>
          </div>
          <div class="panel-actions">
            <button class="panel-btn-icon" id="btnClearChat" title="Clear Conversation History" aria-label="Clear Chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button class="panel-btn-close" id="btnCloseChat" title="Close panel — Return to Core" aria-label="Close Chat"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        </div>

        <div class="chat-message-stream" id="chatMessageStream">
          <!-- Messages will render here -->
        </div>

        <div class="chat-input-wrapper">
          <textarea
            id="chatInput"
            class="chat-input-textarea"
            placeholder="Ask NEXORA... (Enter to send, Shift+Enter for newline)"
            rows="1"
          ></textarea>
          <button id="btnCancelResponse" class="chat-send-btn chat-cancel-btn" title="Stop response" aria-label="Stop response" hidden>Stop</button>
          <button id="btnSendMessage" class="chat-send-btn" title="Send message (Enter)" aria-label="Send Message">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  async loadModelTag() {
    const tag = this.container.querySelector('#chatModelTag');
    try {
      const model = await window.nexoraAPI?.config?.get('ai.chatModel');
      if (tag && typeof model === 'string' && model.trim()) tag.textContent = model.toUpperCase();
    } catch { /* Model tag is informational; chat remains available if config lookup fails. */ }
  }

  initEvents() {
    const input = this.container.querySelector('#chatInput');
    const sendBtn = this.container.querySelector('#btnSendMessage');
    const clearBtn = this.container.querySelector('#btnClearChat');
    const closeBtn = this.container.querySelector('#btnCloseChat');
    const cancelBtn = this.container.querySelector('#btnCancelResponse');

    this.unsubscribeStream = window.nexoraAPI?.chat?.onStreamChunk?.((payload) => this.handleStreamChunk(payload));
    this.unsubscribeModelSwitch = window.nexoraAPI?.chat?.onModelSwitch?.((payload) => {
      if (!payload?.requestId || payload.requestId !== this.currentRequestId) return;
      const tag = this.container.querySelector('.simulation-tag');
      if (!tag) return;
      tag.textContent = `SWITCHING → ${payload.to}`;
      tag.title = `Previous model ${payload.from} failed (${payload.reason}). Trying the next available model.`;
      clearTimeout(this.modelSwitchTagTimer);
      this.modelSwitchTagTimer = setTimeout(() => { if (tag.isConnected) { tag.textContent = 'LIVE AI'; tag.title = 'Gemini model ladder enabled'; } }, 7000);
    });
    cancelBtn?.addEventListener('click', () => this.cancelResponse());

    // Auto-grow textarea height
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Enter to send
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitMessage();
      }
    });

    sendBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      this.submitMessage();
    });

    clearBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Clear all conversation messages?')) {
        this.messages = [];
        this.saveHistory();
        this.options.onSound?.('panelClose');
        this.renderMessages();
      }
    });

    closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.options.onSound?.('panelClose');
      this.options.onClose?.();
    });
  }

  loadDefaultWelcome() {
    this.addMessage({
      sender: 'assistant',
      text: 'NEXORA is ready. Send a message to start a secure AI conversation.',
      timestamp: Date.now(),
    });
  }

  async submitMessage() {
    const input = this.container.querySelector('#chatInput');
    const text = input?.value.trim();
    if (!text || this.isResponding) return;
    input.value = '';
    input.style.height = 'auto';

    const history = this.messages
      .filter((message) => ['user', 'assistant'].includes(message.sender) && !message.pending && !message.isError && (Number(message.timestamp) || 0) > this.memoryCut)
      .map((message) => ({ role: message.sender, text: message.text }));
    this.addMessage({ sender: 'user', text, timestamp: Date.now() });

    this.isResponding = true;
    this.firstChunkReceived = false;
    this.currentRequestId = (globalThis.crypto?.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    this.pendingAssistantId = `assistant_${this.currentRequestId}`;
    this.addMessage({ id: this.pendingAssistantId, sender: 'assistant', text: '', pending: true, timestamp: Date.now() });
    this.setBusy(true);
    this.options.onOrbStateChange?.(ORB_STATES.THINK);
    this.options.onSound?.('thinking');

    try {
      const stream = window.nexoraAPI?.chat?.stream;
      if (typeof stream !== 'function') throw new Error('Streaming bridge is unavailable. Restart NEXORA to load the updated preload.');
      const result = await stream(this.currentRequestId, text, history);
      const pending = this.messages.find((message) => message.id === this.pendingAssistantId);
      if (!result?.success) {
        if (pending) {
          pending.pending = false;
          pending.isError = !result?.cancelled;
          pending.text = result?.cancelled
            ? `${pending.text ? `${pending.text}\n\n` : ''}Response cancelled.`
            : `Unable to contact Gemini: ${result?.error || 'Unknown error.'}`;
        }
        if (!result?.cancelled) {
          this.options.onOrbStateChange?.(ORB_STATES.ERROR);
          this.options.onSound?.('error');
        } else {
          this.options.onOrbStateChange?.(ORB_STATES.IDLE);
        }
      } else {
        if (pending) {
          // Fallback in case a provider returns a complete body without SSE events.
          if (!pending.text) {
            pending.text = result.text || '';
            if (pending.text) { this.options.onOrbStateChange?.(ORB_STATES.SPEAK); this.options.onSound?.('response'); }
          }
          pending.pending = false;
          pending.isError = false;
          pending.timestamp = result.timestamp || Date.now();
        }
        this.options.onOrbStateChange?.(ORB_STATES.IDLE);
      }
      this.saveHistory();
      this.renderMessages();
    } catch (error) {
      const pending = this.messages.find((message) => message.id === this.pendingAssistantId);
      if (pending) { pending.pending = false; pending.isError = true; pending.text = `Unable to contact Gemini: ${error.message}`; }
      this.saveHistory();
      this.renderMessages();
      this.options.onOrbStateChange?.(ORB_STATES.ERROR);
      this.options.onSound?.('error');
    } finally {
      this.isResponding = false;
      this.currentRequestId = null;
      this.pendingAssistantId = null;
      this.setBusy(false);
    }
  }

  handleStreamChunk(payload) {
    if (!payload || payload.requestId !== this.currentRequestId || typeof payload.text !== 'string') return;
    const pending = this.messages.find((message) => message.id === this.pendingAssistantId);
    if (!pending) return;
    if (!this.firstChunkReceived) {
      this.firstChunkReceived = true;
      this.options.onOrbStateChange?.(ORB_STATES.SPEAK);
      this.options.onSound?.('response');
    }
    pending.text += payload.text;
    pending.pending = true;
    this.saveHistory();
    this.renderMessages();
  }

  cancelResponse() {
    if (!this.isResponding || !this.currentRequestId) return;
    window.nexoraAPI?.chat?.cancel?.(this.currentRequestId);
    const cancel = this.container.querySelector('#btnCancelResponse');
    if (cancel) { cancel.disabled = true; cancel.textContent = 'Stopping…'; }
  }

  setBusy(busy) {
    const input = this.container.querySelector('#chatInput');
    const send = this.container.querySelector('#btnSendMessage');
    const cancel = this.container.querySelector('#btnCancelResponse');
    if (input) input.disabled = busy;
    if (send) send.disabled = busy;
    if (cancel) { cancel.hidden = !busy; cancel.disabled = false; cancel.textContent = 'Stop'; }
  }

  loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem('nexora.chat.history') || '[]');
      return Array.isArray(value) ? value.filter((message) => message && ['user', 'assistant'].includes(message.sender) && typeof message.text === 'string').slice(-100) : [];
    } catch { return []; }
  }

  saveHistory() {
    try { localStorage.setItem('nexora.chat.history', JSON.stringify(this.messages.slice(-100).map(({ id, sender, text, timestamp, isError }) => ({ id, sender, text, timestamp, isError })))); } catch {}
  }

  addMessage(msg) {
    this.messages.push(msg);
    this.saveHistory();
    this.renderMessages();
  }

  renderMessages() {
    const stream = this.container.querySelector('#chatMessageStream');
    if (!stream) return;

    stream.innerHTML = this.messages
      .map((m) => {
        const isUser = m.sender === 'user';
        const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
          <div class="chat-message-row ${isUser ? 'user-row' : 'assistant-row'}">
            <div class="chat-bubble ${isUser ? 'bubble-user' : 'bubble-assistant'} ${m.isError ? 'bubble-error' : ''} ${m.pending ? 'bubble-pending' : ''}">
              <div class="bubble-text">${this.escapeHtml(m.text || (m.pending ? 'NEXORA is responding…' : ''))}</div>
              <div class="bubble-meta">${timeStr}</div>
            </div>
          </div>
        `;
      })
      .join('');

    // Auto-scroll to bottom
    stream.scrollTop = stream.scrollHeight;
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br/>');
  }

  focusInput() {
    setTimeout(() => {
      this.container.querySelector('#chatInput')?.focus();
    }, 150);
  }
}
