/* NEXORA — "What's new" dialog shown once after an update. Text comes from CHANGELOG.md (read in the main process).
 * Built with DOM nodes and textContent only, so release notes can never inject markup. */

function appendInline(parent, text) {
  // **bold** and `code` only
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const tok = m[0];
    const el = document.createElement(tok.startsWith('**') ? 'strong' : 'code');
    el.textContent = tok.replace(/^\*\*|\*\*$|^`|`$/g, '');
    parent.append(el);
    last = m.index + tok.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

export function renderChangelogText(container, text) {
  container.replaceChildren();
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { list = null; continue; }
    if (line.startsWith('## ')) {
      list = null;
      const h = document.createElement('h3'); h.className = 'whats-new-version'; h.textContent = line.slice(3); container.append(h);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!list) { list = document.createElement('ul'); container.append(list); }
      const li = document.createElement('li'); appendInline(li, line.replace(/^\s*[-*]\s+/, '')); list.append(li);
    } else {
      list = null;
      const p = document.createElement('p'); appendInline(p, line); p.className = /^\*\*.+\*\*$/.test(line.trim()) ? 'whats-new-heading' : ''; container.append(p);
    }
  }
}

export class WhatsNewDialog {
  /** @param {{ version:string, text:string, onClose?:()=>void, onFullNotes?:()=>void }} o */
  constructor({ version, text, onClose = () => {}, onFullNotes = null } = {}) {
    this.onClose = onClose;
    this.overlay = document.createElement('div');
    this.overlay.className = 'whats-new-overlay';
    this.overlay.setAttribute('role', 'dialog'); this.overlay.setAttribute('aria-modal', 'true'); this.overlay.setAttribute('aria-label', "What's new in NEXORA");
    const card = document.createElement('div'); card.className = 'whats-new-card';
    const title = document.createElement('h2'); title.className = 'whats-new-title'; title.textContent = `What\u2019s new in NEXORA v${version}`;
    const body = document.createElement('div'); body.className = 'whats-new-body'; renderChangelogText(body, text);
    const actions = document.createElement('div'); actions.className = 'whats-new-actions';
    if (onFullNotes) { const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Release page'; more.addEventListener('click', () => onFullNotes()); actions.append(more); }
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'primary'; ok.textContent = 'Got it'; ok.addEventListener('click', () => this.close());
    actions.append(ok);
    card.append(title, body, actions); this.overlay.append(card);
    this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
    document.addEventListener('keydown', this.onKey);
    document.body.append(this.overlay);
    ok.focus();
  }
  close() {
    if (!this.overlay) return;
    document.removeEventListener('keydown', this.onKey);
    this.overlay.remove(); this.overlay = null;
    try { this.onClose(); } catch { /* ignore */ }
  }
}
