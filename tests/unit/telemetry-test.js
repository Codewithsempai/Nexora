/* v0.3.35 — Telemetry panel must stay a smooth, canvas-driven, real-data renderer. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const panel = read('src/renderer/status/status-panel.js');
const css = read('src/renderer/styles/glass-redesign.css');

assert(panel.includes('requestAnimationFrame(this._frame)'), 'chart must animate from a single rAF loop');
assert(panel.includes('getContext(\'2d\')'), 'chart and sparklines must be canvas based');
assert(panel.includes('RENDER_DELAY') && panel.includes('headT'), 'line head must be interpolated between real samples');
assert(panel.includes('monotoneSlopes'), 'curves must use monotone interpolation (no fake overshoot)');
assert(!/setInterval\(/.test(panel), 'no overlapping setInterval pollers; sampling uses a chained timer');
assert(!panel.includes('setAttribute(\'d\''), 'no per-sample SVG path rebuilds');
assert(!/axisR\.innerHTML|xAxis\.innerHTML|services\.innerHTML\s*=/.test(panel), 'axes/services must not be rebuilt with innerHTML each sample');
assert(panel.includes('document.hidden') && panel.includes('IntersectionObserver'), 'loop must pause when hidden or off-screen');
assert(panel.includes('lowFps'), 'loop must adapt to slow machines');
assert(!/Math\.random\(/.test(panel), 'telemetry values must never be simulated');
assert(css.includes('.tele-canvas') && css.includes('.tele-spark { display:block'), 'canvas styles must exist');
console.log('telemetry-test: ok');
