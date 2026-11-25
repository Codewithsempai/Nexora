import { OrbStateManager, ORB_STATES } from './orb/orb-state.js';
import { OrbEngine } from './orb/orb-engine.js';
const manager = new OrbStateManager(ORB_STATES.WAKE);
const engine = new OrbEngine(document.getElementById('popupOrbCanvas'), manager);
engine.setFullSize(true); // the popup Orb is always drawn at its full chosen size (no small-to-big assembly)
engine.start();
const states = new Set(Object.values(ORB_STATES));
function applyState(state) { if (states.has(state)) manager.setState(state); }
function applyProfile(profile) { engine.setProfile(profile); engine.notifyResize(); }
function wakeUp() { engine.triggerWake?.(); const el = document.querySelector('.popup-orb-canvas'); if (el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; } }
function applyCanvas(px) { const box = document.querySelector('.popup-orb-canvas'); if (box && px) { box.style.width = px + 'px'; box.style.height = px + 'px'; engine.notifyResize(); } }
window.nexoraAPI?.popup?.onInit?.((payload) => { engine.setPerformanceMode(payload?.performanceMode || 'medium'); applyCanvas(payload?.canvas); applyProfile(payload?.profile || 'nexora'); applyState(payload?.state || 'wake'); wakeUp(); });
window.nexoraAPI?.popup?.onState?.(applyState);
window.nexoraAPI?.popup?.onProfile?.(applyProfile);
window.nexoraAPI?.popup?.onLevel?.((level) => manager.setAudioLevel(Number(level) || 0));
let levelDecayTimer = null;
const syncDecayTimer = () => {
  if (document.hidden) { clearInterval(levelDecayTimer); levelDecayTimer = null; return; }
  if (!levelDecayTimer) levelDecayTimer = setInterval(() => manager.setAudioLevel(manager.getAudioLevel() * 0.78), 100);
};
syncDecayTimer();
document.addEventListener('visibilitychange', syncDecayTimer);
window.addEventListener('beforeunload', () => { clearInterval(levelDecayTimer); document.removeEventListener('visibilitychange', syncDecayTimer); engine.destroy(); });
