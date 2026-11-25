/* Owner: codewithsempai_daya — NEXORA */
/* ==========================================================================
   NEXORA — Memory panel (live)
   Shows everything NEXORA remembers, and updates the instant something is saved
   from typed chat, spoken Live conversation, or this panel. Backed by the encrypted vault.
   ========================================================================== */

const CATEGORIES = [
  { id: 'personal', label: 'Personal', hint: 'name, college, family' },
  { id: 'preferences', label: 'Preferences', hint: 'name, likes, where you live' },
  { id: 'knowledge', label: 'Knowledge', hint: '"remember that…" facts' },
  { id: 'projects', label: 'Projects', hint: 'what you are building' },
  { id: 'conversations', label: 'Conversations', hint: 'things said in chats' },
];
const PROFILE_SLOTS = [['name', 'Name'], ['age', 'Age'], ['birthday', 'Birthday'], ['location', 'City / from'], ['edu:college', 'College'], ['edu:school', 'School'], ['rel:father', 'Father'], ['rel:mother', 'Mother'], ['rel:brother', 'Brother'], ['rel:sister', 'Sister'], ['work', 'Work']];
const KEY_LABEL = { 'edu:university': 'University', 'edu:company': 'Company', 'edu:office': 'Office', 'rel:wife': 'Wife', 'rel:husband': 'Husband', 'rel:son': 'Son', 'rel:daughter': 'Daughter', 'rel:friend': 'Friend', 'rel:best friend': 'Best friend' };
const profileValue = (text) => String(text).replace(/^The user(?:['’]s [a-z ]+?)? (?:is from|is|are|studies at|lives in \/ is from|works as|works at|works for|works in|has)\s+/i, '').trim() || text;
const SOURCE_LABEL = { chat: 'Chat', voice: 'Voice', manual: 'You', tool: 'NEXORA' };
const FEED_LIMIT = 8;

function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now'; if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

export class MemoryPanel {
  constructor(container, options = {}) {
    this.container = container; this.options = options;
    this.api = window.nexoraAPI?.memory;
    this.filter = 'all'; this.query = ''; this.error = ''; this.items = []; this.feed = []; this.freshIds = new Map();
    this.render(); this.bind();
    this.unsubscribe = this.api?.onChanged?.((event) => this.handleChange(event));
    this.clock = setInterval(() => this.tickClock(), 15000);
    void this.refresh();
  }

  render() {
    this.container.innerHTML = `
      <div class="nexora-panel nexora-memory-panel">
        <div class="panel-header">
          <div class="panel-title-cluster">
            <h2 class="panel-title">Memory</h2><span class="panel-subtitle">Everything NEXORA remembers</span>
            <span class="mem-live-badge" title="Updates the moment NEXORA saves something"><i></i>LIVE</span>
          </div>
          <div class="panel-actions">
            <button class="panel-btn-icon" id="memExport" title="Export memory as JSON" aria-label="Export memory"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
            <button class="panel-btn-close" id="memClose" title="Close panel — Return to Core" aria-label="Close Memory"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
        </div>
        <div class="mem-scroll">
          <div class="mem-stats" id="memStats" role="tablist" aria-label="Memory categories"></div>
          <section class="mem-profile-wrap" aria-label="Personal information">
            <div class="mem-section-title"><span>PERSONAL INFO</span><small>name, college, family… saved as you talk</small></div>
            <div class="mem-profile" id="memProfile"></div>
          </section>
          <section class="mem-feed-wrap" aria-label="Live memory activity">
            <div class="mem-section-title"><span>LIVE ACTIVITY</span><small id="memFeedHint">waiting for new memories…</small></div>
            <div class="mem-feed" id="memFeed"></div>
          </section>
          <section class="mem-add" aria-label="Add a memory">
            <select id="memCategory" aria-label="Memory category">${CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}</select>
            <input id="memEntry" type="text" maxlength="4000" placeholder="Save a memory…" />
            <button id="memAdd" type="button" class="mem-btn primary">Save</button>
          </section>
          <div class="mem-search-row"><input id="memSearch" type="search" placeholder="Search memories" aria-label="Search memories" /></div>
          <div class="mem-status" id="memStatus" role="status">Loading encrypted memory vault…</div>
          <div class="mem-list" id="memList" aria-live="polite"></div>
          <div class="mem-footer"><button id="memClear" type="button" class="mem-btn danger">Clear all memory</button><span class="mem-note">Encrypted on this PC. Say “forget …” to remove one by voice.</span></div>
        </div>
      </div>`;
    this.$ = (sel) => this.container.querySelector(sel);
  }

  bind() {
    this.$('#memClose').addEventListener('click', () => this.options.onClose?.());
    this.$('#memAdd').addEventListener('click', () => this.addManual());
    this.$('#memEntry').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.addManual(); });
    this.$('#memSearch').addEventListener('input', (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderList(); });
    this.$('#memExport').addEventListener('click', () => this.exportJson());
    const clearBtn = this.$('#memClear'); let armed = null;
    clearBtn.addEventListener('click', async () => {
      if (!armed) { clearBtn.textContent = 'Click again to confirm'; armed = setTimeout(() => { armed = null; clearBtn.textContent = 'Clear all memory'; }, 3500); return; }
      clearTimeout(armed); armed = null; clearBtn.textContent = 'Clear all memory';
      const result = await this.api?.clear('all'); if (!result?.success) this.setStatus(result?.error || 'Could not clear memory.');
    });
  }

  setStorageNote(text, title) { const n = this.$('.mem-note'); if (n) { n.textContent = text; if (title) n.title = title; } }

  setStatus(text) { const s = this.$('#memStatus'); if (s) s.textContent = text; }

  async refresh() {
    if (!this.api) { this.setStatus('Memory API unavailable. Restart NEXORA to load the updated preload.'); return; }
    const result = await this.api.list('all');
    if (!result?.success) { this.items = []; this.error = result?.error || 'Memory vault is unavailable.'; this.renderStats(); this.renderList(); this.renderProfile(); return; }
    this.error = '';
    try { const st = await this.api.stats?.(); if (st?.storage) { const n = result.items.length; this.setStorageNote(`${n} saved · stored on this PC (${st.storage.mode === 'os-secure' ? 'OS-encrypted' : 'app-encrypted'}) · kept after you close and reopen NEXORA`, st.storage.filePath); } } catch { /* optional */ }
    this.items = result.items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    this.renderStats(); this.renderList(); this.renderProfile();
  }

  /** Called by the app when this panel opens, so it is never stale. */
  onShow() { void this.refresh(); }

  handleChange(event = {}) {
    const item = event.item;
    if (item?.id && (event.type === 'add' || event.type === 'update' || event.type === 'touch')) this.freshIds.set(item.id, Date.now());
    const labelBy = { add: 'Saved', touch: 'Refreshed', update: 'Edited', remove: 'Deleted', clear: 'Cleared', forget: 'Forgot' };
    const text = event.type === 'clear' ? `${event.count ?? 'all'} ${event.category && event.category !== 'all' ? event.category : ''} memories`.replace(/\s+/g, ' ').trim()
      : event.type === 'forget' ? (event.removed || []).join(' · ') : item?.text || '';
    if (text) {
      this.feed.unshift({ type: event.type, label: labelBy[event.type] || 'Updated', text, source: event.source || item?.source || 'manual', category: item?.category, at: Date.now(), id: item?.id });
      this.feed = this.feed.slice(0, FEED_LIMIT); this.renderFeed();
    }
    void this.refresh();
    setTimeout(() => { this.renderList(); this.renderProfile(); }, 4200);
  }

  renderProfile() {
    const box = this.$('#memProfile'); if (!box) return; box.replaceChildren();
    const keyed = new Map(); const extra = [];
    for (const i of this.items) { if (i.category !== 'personal') continue; if (i.key) keyed.set(i.key, i); else extra.push(i); }
    const now = Date.now();
    const cell = (label, item) => {
      const fresh = item && this.freshIds.has(item.id) && now - this.freshIds.get(item.id) < 4000;
      const c = el('div', `mem-prof-cell${item ? '' : ' empty'}${fresh ? ' fresh' : ''}`);
      c.append(el('span', 'mem-prof-label', label), el('strong', 'mem-prof-value', item ? (item.value || profileValue(item.text)) : '—'));
      if (item) c.title = item.text;
      box.appendChild(c);
    };
    for (const [key, label] of PROFILE_SLOTS) { cell(label, keyed.get(key)); keyed.delete(key); }
    for (const [key, item] of keyed) cell(KEY_LABEL[key] || key.replace(/^(?:rel|edu|fav):/, '').replace(/^./, (x) => x.toUpperCase()), item);
    for (const item of extra) cell('Note', item);
  }

  renderStats() {
    const wrap = this.$('#memStats'); if (!wrap) return;
    wrap.replaceChildren();
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])); for (const i of this.items) counts[i.category] = (counts[i.category] || 0) + 1;
    const make = (id, label, count) => {
      const b = el('button', `mem-stat${this.filter === id ? ' active' : ''}`); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(this.filter === id));
      b.append(el('strong', '', String(count)), el('span', '', label));
      b.addEventListener('click', () => { this.filter = id; this.renderStats(); this.renderList(); });
      wrap.appendChild(b);
    };
    make('all', 'All', this.items.length);
    for (const c of CATEGORIES) make(c.id, c.label, counts[c.id] || 0);
  }

  renderFeed() {
    const box = this.$('#memFeed'); if (!box) return; box.replaceChildren();
    const hint = this.$('#memFeedHint');
    if (!this.feed.length) { box.appendChild(el('div', 'mem-feed-empty', 'Say “remember that I love filter coffee” or “my name is …” — it appears here instantly.')); if (hint) hint.textContent = 'waiting for new memories…'; return; }
    if (hint) hint.textContent = `${this.feed.length} recent`;
    for (const entry of this.feed) {
      const row = el('div', `mem-feed-row feed-${entry.type}`);
      const tag = el('span', 'mem-feed-tag', entry.label);
      const text = el('span', 'mem-feed-text', entry.text);
      const meta = el('span', 'mem-feed-meta', `${SOURCE_LABEL[entry.source] || entry.source} · ${timeAgo(entry.at)}`); meta.dataset.at = String(entry.at);
      row.append(tag, text, meta); box.appendChild(row);
    }
  }

  renderList() {
    const list = this.$('#memList'); if (!list) return; list.replaceChildren();
    const rows = this.items.filter((i) => (this.filter === 'all' || i.category === this.filter) && (!this.query || i.text.toLowerCase().includes(this.query)));
    if (this.error) this.setStatus(this.error);
    else if (this.items.length) this.setStatus(`${this.items.length} saved ${this.items.length === 1 ? 'memory' : 'memories'} · encrypted local vault${rows.length !== this.items.length ? ` · showing ${rows.length}` : ''}`);
    else this.setStatus('Nothing remembered yet — tell NEXORA something about you.');
    if (!rows.length) { list.appendChild(el('div', 'mem-empty', this.items.length ? 'No memories match.' : 'No memories yet.')); return; }
    const now = Date.now();
    for (const item of rows) {
      const fresh = this.freshIds.has(item.id) && now - this.freshIds.get(item.id) < 4000;
      const row = el('div', `mem-item${fresh ? ' fresh' : ''}`);
      const main = el('div', 'mem-item-main');
      const meta = el('div', 'mem-item-meta');
      meta.append(el('span', 'mem-cat-tag', item.category), el('span', 'mem-item-src', `${SOURCE_LABEL[item.source] || 'Saved'} · ${timeAgo(item.updatedAt || item.createdAt || now)}`));
      const text = el('div', 'mem-item-text', item.text);
      main.append(meta, text);
      const actions = el('div', 'mem-item-actions');
      const edit = el('button', 'mem-icon-btn', 'Edit'); edit.type = 'button';
      const del = el('button', 'mem-icon-btn danger', 'Delete'); del.type = 'button';
      edit.addEventListener('click', () => this.beginEdit(item, row, text));
      del.addEventListener('click', async () => { const r = await this.api.remove(item.id); if (!r?.success) this.setStatus(r?.error || 'Could not delete memory.'); });
      actions.append(edit, del); row.append(main, actions); list.appendChild(row);
    }
  }

  beginEdit(item, row, textEl) {
    const input = el('textarea', 'mem-edit'); input.value = item.text; input.rows = Math.min(5, Math.max(2, Math.ceil(item.text.length / 38)));
    const save = el('button', 'mem-icon-btn primary', 'Save'); save.type = 'button';
    const cancel = el('button', 'mem-icon-btn', 'Cancel'); cancel.type = 'button';
    textEl.replaceWith(input); const actions = row.querySelector('.mem-item-actions'); actions.replaceChildren(save, cancel); input.focus();
    const done = async () => { const value = input.value.trim(); if (!value) return; const r = await this.api.update(item.id, { text: value }); if (!r?.success) this.setStatus(r?.error || 'Could not save the edit.'); };
    save.addEventListener('click', done); cancel.addEventListener('click', () => this.renderList());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void done(); } if (e.key === 'Escape') this.renderList(); });
  }

  async addManual() {
    const entry = this.$('#memEntry'); const value = entry.value.trim();
    if (!value) { this.setStatus('Type something to remember first.'); return; }
    const result = await this.api?.add(this.$('#memCategory').value, value);
    if (!result?.success) { this.setStatus(result?.error || 'Unable to save memory.'); return; }
    entry.value = '';
  }

  exportJson() {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), items: this.items }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `nexora-memory-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  tickClock() {
    this.container.querySelectorAll('.mem-feed-meta[data-at]').forEach((node) => {
      const at = Number(node.dataset.at); const src = node.textContent.split(' · ')[0]; node.textContent = `${src} · ${timeAgo(at)}`;
    });
  }

  destroy() { clearInterval(this.clock); this.unsubscribe?.(); }
}
