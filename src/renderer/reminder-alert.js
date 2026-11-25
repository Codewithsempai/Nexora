(() => {
  const $ = (id) => document.getElementById(id);
  let items = [];
  const render = () => {
    if (!items.length) return;
    $('text').textContent = items[0].text;
    $('more').textContent = items.length > 1 ? '+' + (items.length - 1) + ' more' : '';
  };
  // pointerup + click: the button works on the first press even when another app has the focus
  const press = (id, action) => {
    const el = $(id); let busy = false;
    const run = (e) => { e.preventDefault(); e.stopPropagation(); if (busy || !items[0]) return; busy = true; setTimeout(() => { busy = false; }, 400); action(items[0]); };
    el.addEventListener('click', run);
    el.addEventListener('pointerup', (e) => { if (e.button === 0) run(e); });
  };
  window.nexoraAlert.onItems((list) => { items = list; render(); });
  press('done', (item) => window.nexoraAlert.done(item.id));
  press('snooze', (item) => window.nexoraAlert.snooze(item.id, 10));
  press('close', (item) => window.nexoraAlert.close(item.id));
})();
