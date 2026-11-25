/* NEXORA — small toast stack (top-right). Used for live memory saves and reminder alerts. */
export class ToastCenter {
  constructor(container) {
    this.container = container;
    this.container.classList.add('nexora-toast-stack');
    this.container.setAttribute('aria-live', 'polite');
  }

  /** show({ kind, title, text, actions:[{label, primary, onClick}], timeout, onClick }) -> { dismiss } */
  show({ kind = 'info', title = '', text = '', actions = [], timeout = 4500, onClick = null } = {}) {
    const el = document.createElement('div');
    el.className = `nexora-toast toast-${kind}`;
    el.setAttribute('role', kind === 'reminder' ? 'alertdialog' : 'status');
    const body = document.createElement('div'); body.className = 'toast-body';
    const head = document.createElement('div'); head.className = 'toast-title'; head.textContent = title;
    const msg = document.createElement('div'); msg.className = 'toast-text'; msg.textContent = text;
    body.append(head, msg); el.appendChild(body);
    const dismiss = () => { if (!el.isConnected) return; el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
    if (actions.length) {
      const row = document.createElement('div'); row.className = 'toast-actions';
      for (const action of actions) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = action.label;
        if (action.primary) btn.className = 'primary';
        btn.addEventListener('click', async (e) => { e.stopPropagation(); try { await action.onClick?.(); } finally { dismiss(); } });
        row.appendChild(btn);
      }
      el.appendChild(row);
    }
    if (onClick) { el.classList.add('clickable'); el.addEventListener('click', () => { onClick(); dismiss(); }); }
    const close = document.createElement('button'); close.type = 'button'; close.className = 'toast-close'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    el.appendChild(close);
    this.container.prepend(el);
    while (this.container.children.length > 5) this.container.lastElementChild?.remove();
    if (timeout > 0) setTimeout(dismiss, timeout);
    return { dismiss, element: el };
  }
}
