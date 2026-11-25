/* ==========================================================================
   NEXORA — Robot Orb (v0.3.14)
   The Nexora robot (3D, three.js) as a fourth Orb identity. It is rendered into an off-screen WebGL canvas and
   drawn into the Orb's 2D canvas, so it works in the main Orb and in the floating popup Orb unchanged.

   Orb state  ->  robot:  Idle/Listen/Think/Speak/Wake/Error/Offline play the matching body animation, face colour,
   status effects and lip sync (driven by the Orb's real voice level). Robot Studio can hold any expression
   (8 emotions + 14 characters), facial action, emote effect and screen VFX on top.
   ========================================================================== */

const ASSET = (p) => new URL('../' + p, import.meta.url).href;
const SCRIPTS = [
  'vendor/three/three.min.js', 'vendor/three/fflate.min.js', 'vendor/three/FBXLoader.js',
  'robot/nexora-face.js', 'robot/nexora-voice-sync.js', 'robot/nexora-animator.js', 'robot/nexora-face-vfx.js', 'robot/robot-fbx.js'
];
const UI = { idle: 'Idle', listening: 'Listen', thinking: 'Think', speaking: 'Speak', wake: 'Wake', error: 'Error', offline: 'Offline' };
const OPT_KEY = 'nexora-robot-opts-v2';
const DEFAULT_QUALITY = { id: 'medium', fps: 30, dprCap: 1, robotMaxPixels: 640, ssaa: 1, aa: true, env: 0.35, aniso: 2, precision: 'mediump' };
const BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/* The FBX references its textures by (Windows) path and does not embed them, so the robot is painted by material name. */
export const ROBOT_PAINTS = {
  noir: { label: 'Nexora Black', Orange: '#000000', Black: '#000000', White: '#000000' },
  orange: { label: 'Nexora Orange', Orange: '#ff7a1a', Black: '#1b2027', White: '#eef2f7' },
  stealth: { label: 'Stealth', Orange: '#39414d', Black: '#12161b', White: '#8b95a3' },
  arctic: { label: 'Arctic', Orange: '#42c8ff', Black: '#1b2430', White: '#f4f8fc' },
  violet: { label: 'Violet', Orange: '#a77bff', Black: '#1a1626', White: '#efe9ff' },
  gold: { label: 'Solar Gold', Orange: '#f5b414', Black: '#201a10', White: '#fff6dc' },
  mint: { label: 'Mint', Orange: '#2fe0a0', Black: '#14201d', White: '#eafff6' }
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
let loadPromise = null;
export function loadRobotRuntime() {
  if (!loadPromise) loadPromise = SCRIPTS.reduce((p, s) => p.then(() => loadScript(ASSET(s))), Promise.resolve());
  return loadPromise;
}

export class RobotOrb {
  constructor() {
    this.ready = false; this.failed = false; this.error = null;
    this.view = 'auto';            // auto | full | bust | face
    this.paintName = 'noir';     // body paint preset (ROBOT_PAINTS)
    this.bodyActs = true;          // an expression also plays the matching body animation
    this.lock = false;             // an expression chosen in Robot Studio is held until Auto
    this.expression = null;
    this.curUi = null; this.stateName = 'idle'; this.faceName = 'idle';
    this.lastReal = -9; this.last = performance.now() / 1000; this.camP = null; this.camT = null;
    this.restore();
    this.load();
  }

  /* ---------- persistence of Robot Studio options ---------- */
  restore() {
    this.saved = {};
    try { const j = JSON.parse(localStorage.getItem(OPT_KEY) || '{}'); if (j && typeof j === 'object') this.saved = j; } catch {}
    if (this.saved.view) this.view = this.saved.view;
    if (this.saved.bodyActs != null) this.bodyActs = !!this.saved.bodyActs;
    if (this.saved.paint && ROBOT_PAINTS[this.saved.paint]) this.paintName = this.saved.paint;
  }
  persist() {
    try {
      const screenOpts = this.screen ? { ...this.screen.opt } : (this.saved.screen || {});
      localStorage.setItem(OPT_KEY, JSON.stringify({ view: this.view, bodyActs: this.bodyActs, paint: this.paintName, screen: screenOpts }));
    } catch {}
  }

  load() {
    this.loading = loadRobotRuntime().then(() => this.build()).then(() => { this.ready = true; this.onReady?.(); }).catch((e) => { this.failed = true; this.error = e; console.error('[NEXORA robot]', e); });
    return this.loading;
  }

  /* ---------- scene (ported from the Animation Lab) ---------- */
  build() {
    const THREE = window.THREE; this.THREE = THREE;
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const q = this.quality || DEFAULT_QUALITY;
    const { renderer, gl } = this._makeRenderer(q);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, .05, 100);
    // v0.3.14c: low ambient so the body stays PURE BLACK; only soft specular sheen shows the shape (like the reference render).
    scene.add(new THREE.HemisphereLight(0xaab8cc, 0x000000, .22));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(2.5, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 1.4); rim.position.set(-4, 3, -4); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0xcfe4ff, .9); rim2.position.set(4, 2, -4); scene.add(rim2);
    const spill = new THREE.PointLight(0xffffff, .5, 2.5); scene.add(spill);
    Object.assign(this, { renderer, scene, cam, spill, gl, V3 });

    const b64 = window.NEXORA_ROBOT_FBX_B64; if (!b64) throw new Error('Robot model data missing');
    const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    window.NEXORA_ROBOT_FBX_B64 = null;     // free the 10 MB string
    const mgr = new THREE.LoadingManager(); mgr.setURLModifier((u) => (/^(blob|data):/.test(u) ? u : BLANK_PX));   // no external texture requests
    const fbx = new THREE.FBXLoader(mgr).parse(u8.buffer, '');
    const bones = {}; let mesh = null;
    fbx.traverse((o) => { if (o.isSkinnedMesh) mesh = o; if (o.isBone) bones[o.name] = o; });
    const old = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; let si = -1;
    const mats = old.map((m, i) => {
      if (m.name === 'FaceScreen') { si = i; return m; }
      return new THREE.MeshStandardMaterial({ name: m.name, color: 0x000000, roughness: .32, metalness: .15 });
    });
    this.bodyMats = mats.filter((m) => m.name !== 'FaceScreen');
    fbx.updateMatrixWorld(true); let bx = new THREE.Box3().setFromObject(mesh);
    fbx.scale.multiplyScalar(2.2 / (bx.max.y - bx.min.y)); fbx.updateMatrixWorld(true);
    bx = new THREE.Box3().setFromObject(mesh);
    fbx.position.set(-(bx.min.x + bx.max.x) / 2, -bx.min.y, -(bx.min.z + bx.max.z) / 2); fbx.updateMatrixWorld(true); scene.add(fbx);

    // planar UV for the face screen
    const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv; const idx = [];
    for (const gr of g.groups) if (gr.materialIndex === si) for (let k = gr.start; k < gr.start + gr.count; k++) idx.push(g.index ? g.index.getX(k) : k);
    const M = mesh.matrixWorld, NM = new THREE.Matrix3().getNormalMatrix(M), P = idx.map((i) => V3(0, 0, 0).fromBufferAttribute(pos, i).applyMatrix4(M));
    const c = V3(0, 0, 0), n = V3(0, 0, 0); P.forEach((p) => c.add(p)); c.divideScalar(P.length);
    idx.forEach((i) => n.add(V3(0, 0, 0).fromBufferAttribute(nor, i).applyMatrix3(NM).normalize())); n.normalize();
    const sb = new THREE.Box3().setFromPoints(P), sd = sb.getSize(V3(0, 0, 0)).length(), bc = V3(0, 0, 0); let bn = 0; const t = V3(0, 0, 0);
    for (let i = 0; i < pos.count; i += 3) { t.fromBufferAttribute(pos, i).applyMatrix4(M); if (t.distanceTo(c) < sd * 1.6) { bc.add(t); bn++; } }
    bc.divideScalar(bn); if (n.dot(c.clone().sub(bc)) < 0) n.negate();
    const up = V3(0, 1, 0).addScaledVector(n, -n.y).normalize(), right = up.clone().cross(n);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    const UV = P.map((p) => { const d = p.clone().sub(c), u = d.dot(right), v = d.dot(up); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); return [u, v]; });
    idx.forEach((vi, k) => uv.setXY(vi, (UV[k][0] - u0) / (u1 - u0), (UV[k][1] - v0) / (v1 - v0))); uv.needsUpdate = true;
    const asp = (u1 - u0) / (v1 - v0);

    const NexoraFaceScreen = window.NexoraFaceScreen;
    const screen = new NexoraFaceScreen(512, Math.round(512 / asp));
    screen.set(this.saved.screen || {});
    const tex = new THREE.CanvasTexture(screen.canvas); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 2;
    mats[si] = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, name: 'FaceScreen' }); mesh.material = mats;
    this.paint(this.paintName);
    this.screen = screen; this.tex = tex; this.mesh = mesh; this.fbx = fbx; this.bones = bones;
    this.scr = { c, n, sz: Math.max(u1 - u0, v1 - v0) };
    const F = V3(n.x, 0, n.z).normalize(), U = V3(0, 1, 0), R = U.clone().cross(F); const AX = { F, U, R };
    this.AX = AX;
    const full = new THREE.Box3().setFromObject(mesh); this.fullBox = full; this.fullC = full.getCenter(V3(0, 0, 0)); this.fullH = full.max.y - full.min.y;
    this.headRest = bones.Head ? bones.Head.getWorldPosition(V3(0, 0, 0)) : c.clone();

    this.voice = new window.NexoraVoiceSync();
    this.animator = new window.NexoraAnimator(THREE, bones, AX, {
      wave: 'R_', goodbyeNext: 'idle',
      onFace: (name, preset, glow) => { this.faceName = name; if (glow) screen.setStateColor(glow); if (!this.lock) screen.setAuto(name); },
      onEvent: (ev) => { if (ev === 'glitch') screen.trigger('glitch'); else if (ev === 'boot') screen.trigger('boot'); else if (ev === 'screenOn') screen.trigger('screenOn'); else if (ev === 'screenOff') screen.trigger('screenOff'); }
    });
    screen.trigger('boot');
    this.clock = performance.now() / 1000;
    this._qualityKey = null; this.applyQuality(q);
  }

  /* ---------- render quality (live) ---------- */
  /** Orb Studio / Settings call this through OrbEngine.setPerformanceMode(). Safe before the robot has loaded. */
  setQuality(q) { if (!q) return; this.quality = q; if (this.ready || this.renderer) this.applyQuality(q); }

  _makeRenderer(q) {
    const THREE = this.THREE || window.THREE;
    const gl = document.createElement('canvas');
    gl.addEventListener('webglcontextlost', (e) => e.preventDefault());   // lets three.js restore the context (hidden popup window)
    const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: !!q.aa, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: q.id === 'low' ? 'low-power' : 'high-performance', precision: q.precision || 'mediump' });
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.setClearColor(0x000000, 0);
    this._rendererKey = (q.aa ? 'aa' : 'noaa') + ':' + (q.precision || 'mediump');
    return { renderer, gl };
  }

  /** A tiny studio: dark room, one large soft-box overhead and two cool strip lights. Pre-filtered once per renderer. */
  _buildEnvironment() {
    const THREE = this.THREE, renderer = this.renderer;
    if (!THREE.PMREMGenerator) return null;
    const env = new THREE.Scene(); env.background = new THREE.Color(0x020306);
    const box = (w, h, x, y, z, c, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    box(7, 3, 0, 6, 1, 0xffffff, 5);          // top soft-box
    box(1.6, 7, -6, 1, 1, 0xcfe4ff, 6);       // left strip
    box(1.6, 7, 6, 1, -1, 0xcfe4ff, 4);       // right strip
    box(5, 1.6, 0, 1.5, -6, 0xaec8ff, 3);     // back rim
    box(6, 2, 0, -4, 3, 0x6f86a8, 1.2);       // faint floor bounce
    const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromScene(env, 0.035); pm.dispose();
    env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return rt;
  }

  /** Re-applies everything quality controls. Rebuilds the WebGL renderer only when multisampling / precision changed. */
  applyQuality(q) {
    if (!this.scene || !q) return; const THREE = this.THREE;
    this.quality = q;
    const key = (q.aa ? 'aa' : 'noaa') + ':' + (q.precision || 'mediump');
    if (key !== this._rendererKey) {
      const oldR = this.renderer, oldEnv = this.envRT;
      const { renderer, gl } = this._makeRenderer(q);
      this.renderer = renderer; this.gl = gl; this.envRT = null; this.scene.environment = null;
      try { oldEnv?.dispose(); oldR.dispose(); oldR.forceContextLoss?.(); } catch {}
      this.tex.needsUpdate = true;
      for (const m of this.mesh.material) { m.needsUpdate = true; }
    }
    // reflection environment
    const want = q.env > 0;
    if (want && !this.envRT) { try { this.envRT = this._buildEnvironment(); } catch (e) { console.warn('[NEXORA robot] env map unavailable', e); this.envRT = null; } }
    const useEnv = want && !!this.envRT;
    if ((!!this.scene.environment) !== useEnv) for (const m of this.bodyMats) m.needsUpdate = true;
    this.scene.environment = useEnv ? this.envRT.texture : null;
    for (const m of this.bodyMats) m.envMapIntensity = q.env;
    // face-screen filtering
    const maxA = this.renderer.capabilities?.getMaxAnisotropy?.() || 1; const a = Math.min(maxA, q.aniso || 1);
    if (this.tex.anisotropy !== a) { this.tex.anisotropy = a; this.tex.needsUpdate = true; }
    this._qualityKey = q.id; this._lastPx = 0;
  }

  /* ---------- Robot Studio API ---------- */
  get expressions() { return window.NexoraFaceScreen?.EXPRESSIONS || {}; }
  /** hold an expression (and, if enabled, play its body animation). id from NexoraFaceScreen.EXPRESSIONS */
  express(id) {
    if (!this.ready) return false; const e = this.screen.express(id); this.lock = true; this.expression = id;
    if (this.bodyActs && e.body && this.animator) this.animator.setState(e.body, true);
    this.onChange?.(); return true;
  }
  /** back to automatic: the face follows the Orb state again */
  auto() { this.lock = false; this.expression = null; if (this.ready) { this.screen.setAuto(this.faceName); } this.onChange?.(); }
  action(name) { if (this.ready) this.screen.action(name); }
  pose(name) { if (this.ready) { this.screen.pose(name, .9); this.lock = true; this.onChange?.(); } }
  eyes(name) { if (this.ready) { this.screen.eyeStyle(name); this.lock = true; this.onChange?.(); } }
  toggleFx(name) { if (this.ready) { this.lock = true; return this.screen.toggleFx(name); } return false; }
  vfx(name) { if (this.ready) this.screen.trigger(name); }
  setVfx(o) { if (this.ready) { this.screen.set(o); this.persist(); } }
  setView(v) { this.view = v; this.persist(); }
  setBodyActs(on) { this.bodyActs = !!on; this.persist(); }
  /** play any of the 14 body animations: idle listening thinking speaking greeting happy confused sad surprised sleep wakeup goodbye error offline */
  playBody(name) { if (this.ready) this.animator.setState(name, true); }
  /** repaint the robot with a preset from ROBOT_PAINTS */
  paint(name) {
    const P = ROBOT_PAINTS[name]; if (!P) return; this.paintName = name;
    for (const m of this.bodyMats || []) { const key = Object.keys(P).find((k) => k !== 'label' && m.name.startsWith(k)); if (key) { m.color.set(P[key]); m.roughness = name === 'noir' ? .3 : .5; m.needsUpdate = true; } }
    this.persist();
  }
  /** replay the state (e.g. when the popup is shown) */
  replay() { this.curUi = null; }

  /* ---------- camera framing ---------- */
  _frame(px, fit, popup) {
    const THREE = this.THREE, V3 = this.V3, AX = this.AX, fov = this.cam.fov * Math.PI / 180;
    let view = this.view; if (view === 'auto') view = popup ? 'full' : px < 110 ? 'face' : px < 170 ? 'bust' : 'full';
    const head = this.bones.Head ? this.bones.Head.getWorldPosition(V3(0, 0, 0)) : this.scr.c.clone(), dh = head.clone().sub(this.headRest);
    let tgt, vis;
    if (view === 'face') { tgt = this.scr.c.clone().add(dh); vis = this.scr.sz * 3.3; }
    else if (view === 'bust') { tgt = this.scr.c.clone().add(dh); tgt.y -= this.scr.sz * .9; vis = this.scr.sz * 5.8; }
    else { tgt = this.fullC.clone(); tgt.y += this.fullH * .012; vis = this.fullH / (popup ? .97 : .88); }
    vis /= (fit || 1);
    const dist = (vis / 2) / Math.tan(fov / 2);
    const pos = tgt.clone().addScaledVector(AX.F, dist); pos.y += vis * .035;
    return { pos, tgt };
  }

  /* ---------- per frame ---------- */
  /** s = { px, w, h, state, rgb, level, mic, out, t } */
  draw(ctx, s) {
    const w = s.w || s.px, h = s.h || s.px, px = s.px, ox = (w - px) / 2, oy = (h - px) / 2;
    const rgb = s.rgb || [127, 227, 255], css = (a) => 'rgba(' + rgb.map(Math.round).join(',') + ',' + a + ')';
    if (!this.ready) {                // loading ring
      const cx = ox + px / 2, cy = oy + px / 2, t = performance.now() / 1000;
      ctx.strokeStyle = css(.8); ctx.lineWidth = Math.max(2, px * .02); ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, px * .12, t * 4, t * 4 + 4.2); ctx.stroke();
      return;
    }
    const now = performance.now() / 1000, dt = Math.min(now - this.last, .1); this.last = now;
    const state = UI[s.state] ? s.state : 'idle', an = this.animator, voice = this.voice, screen = this.screen;
    // Orb state -> robot
    if (this.curUi !== state) {
      const prev = this.curUi; this.curUi = state; this.stateName = state; an.setUIState(UI[state]); screen.setStatus(state);
      if (prev === 'offline' && state !== 'offline') { screen.trigger('screenOn'); }
    }
    // voice: real output level when present, synthetic mouth otherwise
    const lvl = Math.max(0, Math.min(1, s.level || 0));
    if (lvl > .03) this.lastReal = now;
    if (state === 'speaking') { if (now - this.lastReal < 1.2) { voice.simulate(false); voice.feed(lvl); } else { voice.feed(null); voice.simulate(true); } }
    else { voice.feed(null); voice.simulate(false); }
    voice.update(dt, now);
    an.update(dt, now, { speech: voice.level, userYaw: 0 });
    if (s.popup) {      // popup robot: white glowing face (like the reference), state colours only for listen / think / error / offline
      if (!this._popupInit) { this._popupInit = true; screen.set({ glow: Math.max(screen.get('glow') || 1, 1.7) }); }
      if (!this.lock) screen.set({ color: (state === 'idle' || state === 'wake' || state === 'speaking') ? '#ffffff' : null });
    }
    screen.update(dt, now, voice);
    const lv = state === 'listening' ? { level: Math.min(1, (s.mic || 0) * 3 + .02), peak: 0, wave: voice.wave, speaking: false } : voice;
    screen.render(now, dt, lv, { gaze: an.out.gaze || [0, 0] });
    this.tex.needsUpdate = true;
    this.spill.color.set(screen.color); this.spill.intensity = .55 * screen.glowLevel;
    // camera
    const f = this._frame(px, s.fit, s.popup);
    if (!this.camP) { this.camP = f.pos.clone(); this.camT = f.tgt.clone(); } else { const k = Math.min(1, dt * 5); this.camP.lerp(f.pos, k); this.camT.lerp(f.tgt, k); }
    this.cam.position.copy(this.camP); this.cam.lookAt(this.camT);
    // render at the Orb's pixel size (capped) and blit
    const quality = s.quality || this.quality || DEFAULT_QUALITY;
    if (quality.id !== this._qualityKey) this.applyQuality(quality);       // belt and braces: a popup window or a missed call still converges
    const dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap || 1);
    const ss = quality.ssaa || 1;
    const maxRenderPixels = quality.robotMaxPixels || 640;
    const pxr = Math.max(32, Math.min(maxRenderPixels, Math.round(px * dpr * ss)));
    if (this.gl.width !== pxr || this._lastPx !== pxr) { this.renderer.setSize(pxr, pxr, false); this.cam.aspect = 1; this.cam.updateProjectionMatrix(); this._lastPx = pxr; }
    this.lastRenderPx = pxr;
    this.spill.position.copy(this.scr.c).addScaledVector(this.scr.n, .5);
    this.renderer.render(this.scene, this.cam);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = quality.id === 'low' ? 'low' : 'high';
    ctx.drawImage(this.gl, ox, oy, px, px);
  }
}
