(() => {
  const stack = document.getElementById('stack');
  const ICON = { approval: '🛡', brief: '☀', proactive: '💡', watcher: '👁', task: '⚙', screen: '🖥', info: '✦' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  let lastH = 0;
  const fit = () => {
    const h = Math.ceil(stack.getBoundingClientRect().height);
    if (h > 0 && Math.abs(h - lastH) > 1) { lastH = h; window.nexoraCard.size(h); }
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => requestAnimationFrame(fit)).observe(stack);
  window.addEventListener('resize', () => requestAnimationFrame(fit));
  let timers = [];
  const render = (items) => {
    timers.forEach(clearTimeout); timers = [];
    stack.replaceChildren();
    for (const c of items) {
      const card = el('section', `card k-${c.kind}`);
      const head = el('div', 'head'); head.append(el('span', 'ico', ICON[c.kind] || ICON.info), el('span', 'label', c.label));
      const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'Dismiss'; x.addEventListener('click', () => window.nexoraCard.close(c.id)); head.append(x);
      card.append(head);
      if (c.title) card.append(el('div', 'title', c.title));
      if (c.text) card.append(el('div', 'text', c.text));
      if (c.lines?.length) { const ul = el('ul', 'lines'); for (const l of c.lines) ul.append(el('li', '', l)); card.append(ul); }
      if (typeof c.progress === 'number') { const bar = el('div', 'bar'); const fill = el('i'); fill.style.width = Math.max(0, Math.min(100, c.progress)) + '%'; bar.append(fill); card.append(bar); }
      if (c.buttons?.length) {
        const row = el('div', 'actions');
        for (const b of c.buttons) {
          const btn = el('button', (b.primary ? 'primary ' : '') + (b.danger ? 'danger' : ''), b.label); btn.type = 'button';
          let busy = false; const run = (e) => { e.preventDefault(); e.stopPropagation(); if (busy) return; busy = true; setTimeout(() => { busy = false; }, 400); window.nexoraCard.click(c.id, b.id); };
          btn.addEventListener('click', run); btn.addEventListener('pointerup', (e) => { if (e.button === 0) run(e); });
          row.append(btn);
        }
        card.append(row);
      }
      // v0.3.34: visible auto-close countdown + a renderer-side fallback so a card can never linger past its time.
      const left = c.expiresAt ? c.expiresAt - Date.now() : 0;
      if (left > 0) {
        const ttl = el('div', 'ttl'); const fill = el('i'); fill.style.animationDuration = left + 'ms'; ttl.append(fill); card.append(ttl);
        timers.push(setTimeout(() => window.nexoraCard.close(c.id), left + 400));
      }
      stack.append(card);
    }
    requestAnimationFrame(fit);
  };
  window.nexoraCard.onItems(render);
})();
