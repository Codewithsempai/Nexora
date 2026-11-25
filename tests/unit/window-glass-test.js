const assert = require('assert');
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(base, file), 'utf8');

for (const file of [
  'src/main/application/window.js',
  'src/main/autonomy/card-center.js',
  'src/main/application/reminder-alert.js',
  'src/main/application/popup-window.js',
]) {
  const source = read(file);
  assert(source.includes("backgroundMaterial: 'none'"), `${file} must disable the rectangular system backdrop`);
  assert(source.includes('roundedCorners: true'), `${file} must request native rounded corners`);
  assert(!source.includes("setBackgroundMaterial('acrylic')"), `${file} must not restore Acrylic backplates`);
}

const glass = read('src/renderer/styles/glass-redesign.css');
assert(glass.includes('clip-path: inset(0 round 30px)'), 'main shell must clip content to rounded corners');
assert(glass.includes('background-color: rgba(0,0,0,0) !important'), 'main document canvas must remain transparent');
assert(glass.includes('backdrop-filter: blur(14px) saturate(1.05)'), 'main glass shell must use a moderate backdrop blur');
assert(glass.includes('rgba(42,42,45,.92)'), 'main glass shell must have an opaque readability base');
assert(glass.includes('.nexora-app-shell *'), 'nested backdrop filters must be disabled to avoid stacked GPU blur passes');
assert(!glass.slice(glass.indexOf('/* v0.3.22')).includes('feTurbulence'), 'v0.3.22 glass overlay must not use expensive SVG turbulence noise');

const orbEngine = read('src/renderer/orb/orb-engine.js');
assert(orbEngine.includes('fps: 30'), 'OrbEngine must provide a 30fps balanced profile');
assert(/low:[^\n]*aa: false/.test(orbEngine) && /'very-high':[^\n]*aa: true/.test(orbEngine), 'Low tier skips MSAA, Very High uses it');
assert(/'very-high':[^\n]*ssaa: 2/.test(orbEngine), 'Very High supersamples');
assert(orbEngine.includes('this.onFrame?.()'), 'OrbEngine must report real rendered frames to telemetry');
const robot = read('src/renderer/orb/robot-orb.js');
assert(robot.includes('antialias: !!q.aa'), 'robot WebGL multisampling must follow the selected quality tier');
assert(robot.includes("q.id === 'low' ? 'low-power'"), 'only the Low tier requests the low-power GPU');
assert(robot.includes('applyQuality') && robot.includes('setQuality'), 'robot must apply quality changes live');
assert(robot.includes('Math.min(maxRenderPixels'), 'robot offscreen framebuffer must use the selected quality cap');
const app = read('src/renderer/app/app.js');
assert(!app.includes('startTelemetryLoop();'), 'separate permanent telemetry RAF loop must be removed');
assert(app.includes('this.orbEngine?.stop();'), 'OrbEngine must stop when its canvas is not visible');

const cards = read('src/renderer/styles/card.css');
assert(cards.includes('border-radius:24px'), 'notification cards must use rounded glass corners');
assert(cards.includes('clip-path:inset(0 round 24px)'), 'notification card contents must clip to the rounded surface');
assert(cards.includes('background-color:transparent!important'), 'notification overlay must remain transparent outside the card');

const reminder = read('src/renderer/styles/reminder-alert.css');
assert(reminder.includes('border-radius:24px'), 'reminder card must use the shared rounded radius');
assert(reminder.includes('clip-path:inset(0 round 24px)'), 'reminder card contents must clip to rounded surface');
assert(!cards.includes('feTurbulence'), 'notification card must not run SVG turbulence noise');
assert(!cards.includes('backdrop-filter'), 'notification card must avoid stacked backdrop blur passes');
assert(!reminder.includes('feTurbulence'), 'reminder card must not run SVG turbulence noise');
assert(!reminder.includes('backdrop-filter'), 'reminder card must avoid stacked backdrop blur passes');
const popup = read('src/renderer/styles/popup.css');
assert(!popup.includes('backdrop-filter'), 'wake caption must avoid another backdrop blur pass');


const settings = read('src/renderer/settings/settings-panel.js');
assert(settings.includes('Performance optimization'), 'Settings must expose a performance optimization panel');
for (const mode of ['low', 'medium', 'high', 'very-high']) {
  assert(settings.includes(`data-performance-mode="${mode}"`), `Settings must expose ${mode} performance mode`);
}
assert(settings.includes("this.saveSetting('performance.mode', mode)"), 'Performance mode must persist to config');
assert(settings.includes('onPerformanceChange?.(mode)'), 'Performance mode changes must be applied immediately');
assert(settings.includes('group.hidden = !visible'), 'Settings must show one section at a time, not one long scroll sheet');
const orbEngineSource = read('src/renderer/orb/orb-engine.js');
for (const mode of ['low', 'medium', 'high', "'very-high'"]) assert(orbEngineSource.includes(`${mode}:`), `OrbEngine must implement ${mode} quality profile`);
assert(orbEngineSource.includes("setPerformanceMode(mode = 'medium')"), 'OrbEngine must expose runtime quality switching');
const composerCss = glass.slice(glass.lastIndexOf('/* v0.3.23'));
assert(composerCss.includes('.core-bottom-composer textarea:focus'), 'Quick composer textarea needs focused styling');
assert(composerCss.includes('border:0 !important'), 'Quick composer textarea must not have an inner rectangle border');
assert(composerCss.includes('.settings-page-panels > .settings-group[hidden]'), 'Settings sections must switch independently');
const titlebar = read('src/renderer/components/titlebar.js');
assert(titlebar.includes('await api.minimize()'), 'Titlebar minimize must await native IPC action');
assert(read('src/main/ipc/ipc-handlers.js').includes('win.isMinimizable()'), 'Minimize IPC must verify the native window can minimize');
assert(read('src/main/application/popup-window.js').includes('performanceMode: this.getPerformanceMode?.()'), 'Wake popup must receive the selected performance profile');
assert(read('src/renderer/popup.js').includes('engine.setPerformanceMode(payload?.performanceMode'), 'Wake popup must apply the selected performance profile');

console.log('Rounded transparent glass window regression tests passed.');

// Alignment pass + app icon regression checks
const alignCss = glass.slice(glass.indexOf('Alignment pass'));
assert(alignCss.includes('padding: 14px 18px !important'), 'Setting rows must keep horizontal padding so text never touches the row edge');
assert(alignCss.includes('.settings-page-panels > .settings-group {\n  display: flex !important; flex-direction: column; gap: 10px;'), 'Setting rows must be separated by a flex gap');
assert(alignCss.includes('.chat-input-wrapper .chat-input-textarea:focus'), 'Chat textarea must not draw a focus box inside the pill');
for (const file of ['nexora-app-icon.ico', 'nexora-app-icon.png', 'nexora-app-icon.svg']) {
  assert(fs.existsSync(path.join(base, 'assets/icons', file)), `${file} icon asset must exist`);
}
assert(fs.existsSync(path.join(base, 'src/renderer/assets/nexora-icon.png')), 'Titlebar icon must ship inside the renderer tree (CSP-safe)');
assert(read('src/main/application/window.js').includes('icon: getAppIcon()'), 'Main window must use the NEXORA icon');
assert(read('src/main/tray/tray.js').includes('getTrayIcon()'), 'Tray must use the NEXORA icon');
assert(titlebar.includes('brand-logo'), 'Titlebar must show the NEXORA robot icon');
console.log('Alignment and icon regression tests passed.');

// v0.3.24: Orb Studio panels + live quality + composer polish
const html = read('src/renderer/index.html');
for (const tab of ['orb', 'quality', 'robot', 'popup']) assert(html.includes(`data-pane="${tab}"`), `Orb Studio needs a ${tab} panel`);
for (const mode of ['low', 'medium', 'high', 'very-high']) assert(html.includes(`data-quality="${mode}"`), `Orb Studio needs a ${mode} quality button`);
const panels = read('src/renderer/orb/studio-panels.js');
assert(panels.includes('onQuality'), 'Quality buttons must call back into the app');
assert(app.includes('setRenderQuality') && app.includes('performance.mode'), 'Orb Studio quality must persist to config');
assert(app.includes('updatePerformanceSelection'), 'Orb Studio quality must mirror into Settings');
assert(app.includes('onPerformanceChange'), 'Settings quality must mirror into Orb Studio');
assert(glass.includes('@keyframes nxSendFly') && glass.includes('.composer-send-btn:hover'), 'send button needs a hover animation');
assert(glass.includes('prefers-reduced-motion'), 'hover animation must respect reduced motion');
console.log('v0.3.24 Orb Studio panel checks passed.');

// v0.3.25 regressions
assert(/data-active-panel="orb"\] \.orb-canvas-container \{\s*width: min\(var\(--orb-preview-size/.test(glass), 'orb size variable must win over the stage layout rules');
assert(glass.includes('select option') && glass.includes('color-scheme: dark'), 'drop-down options must be readable (dark list, light text)');
assert(/\.composer-send-btn svg[^{]*\{[^}]*left: -1px/.test(glass), 'paper plane is optically centred');
assert(app.includes('dataset.userSize'), 'chosen size is remembered for the Core orb');
console.log('v0.3.25 size/readability checks passed.');
