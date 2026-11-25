/* Stand-in for the Electron preload bridge (window.nexoraAPI) so the REAL NEXORA renderer UI can run in a plain browser
   for recording. It has no logic of its own: every call resolves with a harmless default, and the recorder can emit the
   same events the main process normally sends (voice status, captions...) through window.__emit(). */
(() => {
  const listeners = {};
  const ORB = window.__ORB || 'robot';   // robot | nexora | nexo | nexie (set by the recorder before this script runs)
  const CONFIG = { 'performance.mode': 'medium', 'appearance.orbProfile': ORB, 'voice.captionsInChat': false, 'voice.wakeWordEnabled': false };
  const reply = (ns, name, args) => {
    if (ns === 'config' && name === 'get') return CONFIG[args[0]];
    if (/^(list|search)$/.test(name)) return [];
    if (/^(get|state|stats|status|keyStatus|getStatus|getStatus)$/.test(name)) return ns === 'config' ? undefined : {};
    if (name === 'isMaximized') return false;
    return { success: true };
  };
  const ns = (space) => new Proxy({}, { get: (_, name) => {
    if (typeof name !== 'string') return undefined;
    if (/^on[A-Z]/.test(name)) return (cb) => { (listeners[space + '.' + name] ||= []).push(cb); return () => {}; };
    return (...args) => Promise.resolve(reply(space, name, args));
  } });
  const spaces = {};
  window.nexoraAPI = new Proxy({}, { get: (_, space) => (typeof space === 'string' ? (spaces[space] ||= ns(space)) : undefined) });
  window.__emit = (space, name, payload) => (listeners[space + '.' + name] || []).forEach((cb) => cb(payload));
  try { localStorage.setItem('nexora-orb-profile', ORB); localStorage.setItem('nexora-orb-preview-size', '240'); } catch {}
})();
