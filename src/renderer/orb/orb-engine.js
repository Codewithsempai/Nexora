/* ==========================================================================
   NEXORA — Quantum Orb Rendering Engine
   Procedural 3D dimensional spherical canvas engine with internal radiance,
   harmonic surface waves, dynamic particle embers, mouse gaze parallax,
   and 7 visually distinct states (IDLE, LISTEN, THINK, SPEAK, WAKE, ERROR, OFFLINE).
   ========================================================================== */

import { ORB_STATES } from './orb-state.js';
import { drawHtmlOrb, HTML_ORB_PROFILES } from './html-orb-renderers.js';
import { RobotOrb } from './robot-orb.js';

// Pre-computed Golden Spiral Sphere distribution (620 points for smooth density)
const POINT_COUNT = 360;
const GOLDEN_SPIRAL_RATIO = 2.3999632;
const SPHERE_POINTS = Array.from({ length: POINT_COUNT }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / POINT_COUNT;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN_SPIRAL_RATIO;
  return {
    x: Math.cos(a) * r,
    y: y,
    z: Math.sin(a) * r,
    seed: i * 0.1618,
  };
});

// Ambient particle embers count
const PARTICLE_COUNT = 52;

/* Render-quality tiers. They change how the 3D robot is actually drawn, live, without a restart:
     fps            frame cap of the Orb loop
     dprCap         device-pixel-ratio cap for the Orb canvas (below 1 = deliberately soft)
     robotMaxPixels hard cap (px) of the off-screen WebGL buffer the robot is rendered into
     ssaa           supersampling factor: render this many times larger, then filter down (smooth edges)
     aa             hardware multisampling on the WebGL canvas (rebuilds the renderer when toggled)
     env            strength of the studio reflection environment on the body (0 = off)
     aniso          anisotropic filtering of the face screen
     precision      shader float precision */
export const PERFORMANCE_PROFILES = Object.freeze({
  low: { id: 'low', label: 'Low', fps: 24, dprCap: 0.75, robotMaxPixels: 300, ssaa: 1, aa: false, env: 0, aniso: 1, precision: 'mediump', note: 'Lightest load, soft edges' },
  medium: { id: 'medium', label: 'Medium', fps: 30, dprCap: 1, robotMaxPixels: 640, ssaa: 1, aa: true, env: 0.35, aniso: 2, precision: 'mediump', note: 'Balanced, smooth edges' },
  high: { id: 'high', label: 'High', fps: 45, dprCap: 1.5, robotMaxPixels: 960, ssaa: 1.4, aa: true, env: 0.6, aniso: 4, precision: 'highp', note: 'Sharp, supersampled, glossy' },
  'very-high': { id: 'very-high', label: 'Very High', fps: 60, dprCap: 2, robotMaxPixels: 1500, ssaa: 2, aa: true, env: 0.9, aniso: 8, precision: 'highp', note: 'Maximum detail, uses most GPU' },
});
const ORB_PROFILES = {
  nexora: { rgb:[120,220,255], core:[225,250,255] },
  nexo: { rgb:[70,190,255], core:[225,250,255] },
  nexie: { rgb:[150,100,255], core:[255,240,255] },
  robot: { rgb:[127,227,255], core:[225,250,255] },   // v0.3.14: the Nexora robot
};


const ROBOT_FALLBACK_ICON = new URL('../assets/nexora-icon.png', import.meta.url).href;

export class OrbEngine {
  constructor(canvas, stateManager, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stateManager = stateManager;
    this.persistProfile = options.persistProfile !== false;
    this.ownsRobot = options.ownsRobot !== false;
    this.previewMode = !!options.previewMode;
    this._robotFallbackImg = null;
    this._robotFailureLogged = false;

    const requestedProfile = options.profileId && ORB_PROFILES[options.profileId] ? options.profileId : null;
    this.profileId = requestedProfile || localStorage.getItem("nexora-orb-profile") || "nexora";
    this.profile = ORB_PROFILES[this.profileId] || ORB_PROFILES.nexora;

    this.width = 400;
    this.height = 360;
    const modeId = options.performanceMode && PERFORMANCE_PROFILES[options.performanceMode] ? options.performanceMode : 'medium';
    this.performanceMode = modeId;
    this.performanceProfile = PERFORMANCE_PROFILES[modeId];
    this.dpr = Math.min(window.devicePixelRatio || 1, this.performanceProfile.dprCap);

    if (this.profileId === 'robot') this.ensureRobot();

    // Simulation variables
    this.time = 0;
    this.lastFrameTime = performance.now();
    this.isRunning = false;
    this.animationFrameId = null;
    this.frameIntervalMs = 1000 / this.performanceProfile.fps;
    this.lastRenderedAt = 0;

    // Smooth state interpolation values
    this.currentSpin = 0;
    this.interpolatedWaveAmp = 0.10;
    this.interpolatedWaveSpeed = 1.2;
    this.interpolatedGlow = 28;
    this.interpolatedCoreScale = 1.0;
    this.interpolatedBrightness = 1.0;
    this.interpolatedInstability = 0.0;
    this.interpolatedAssembly = 1.0;

    // Mouse tracking & gaze parallax
    this.targetLook = { x: 0, y: 0 };
    this.currentLook = { x: 0, y: 0 };

    // Floating particles pool
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      x: (Math.random() - 0.5) * 80,
      y: (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.3 - Math.random() * 0.6,
      life: Math.random(),
      maxLife: 2.0 + Math.random() * 2.5,
      size: 1.0 + Math.random() * 2.2,
      seed: i * 1.618,
    }));

    // Setup observers and listeners
    this.resizeObserver = null;
    this.initResizeObserver();
    this.bindEvents();
    this.resize();
  }

  initResizeObserver() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect) {
            this.handleResize(entry.contentRect.width, entry.contentRect.height);
          }
        }
      });
      this.resizeObserver.observe(parent);
    }
  }

  bindEvents() {
    this.windowResizeHandler = () => this.resize();
    window.addEventListener('resize', this.windowResizeHandler);

    this.mouseMoveHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Normalized gaze vector [-1..1]
      const maxDistance = Math.min(rect.width, rect.height) * 0.8;
      this.targetLook.x = Math.max(-1, Math.min(1, (e.clientX - centerX) / maxDistance));
      this.targetLook.y = Math.max(-1, Math.min(1, (e.clientY - centerY) / maxDistance));
    };
    window.addEventListener('mousemove', this.mouseMoveHandler);

    this.mouseLeaveHandler = () => {
      this.targetLook.x = 0;
      this.targetLook.y = 0;
    };
    window.addEventListener('mouseleave', this.mouseLeaveHandler);
  }

  handleResize(w, h) {
    if (w <= 0 || h <= 0) return;
    this.width = Math.max(24, Math.floor(w));
    this.height = Math.max(24, Math.floor(h));
    this.dpr = Math.min(window.devicePixelRatio || 1, this.performanceProfile.dprCap);

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Ensure transform is set once and does not accumulate
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      this.handleResize(rect.width, rect.height);
    }
  }

  notifyResize() {
    // Force immediate size measurement when layout changes
    requestAnimationFrame(() => this.resize());
  }

  /** Create the robot and start loading it right away (also in the hidden popup window, where requestAnimationFrame is paused). */
  ensureRobot() { if (!this.robot) { this.robot = new RobotOrb(); this.robot.setQuality(this.performanceProfile || PERFORMANCE_PROFILES.medium); this.robot.onChange = () => this.onRobotChange?.(); this.robot.onReady = () => this.onRobotChange?.(); } return this.robot; }
  setProfile(profileId, { persist = this.persistProfile } = {}) {
    if (!ORB_PROFILES[profileId]) return false;
    this.profileId = profileId;
    this.profile = ORB_PROFILES[profileId];
    if (profileId === 'robot') this.ensureRobot();
    if (persist) { try { localStorage.setItem('nexora-orb-profile', profileId); } catch {} }
    return true;
  }
  getProfile() { return this.profileId; }
  setPerformanceMode(mode = 'medium') {
    const profile = PERFORMANCE_PROFILES[mode];
    if (!profile) return false;
    this.performanceMode = mode;
    this.performanceProfile = profile;
    this.frameIntervalMs = 1000 / profile.fps;
    this.fpsMeasured = 0; this.fpsFrames = 0; this.fpsSince = performance.now();
    this.robot?.setQuality(profile);       // applies on the very next frame: no restart needed
    this.resize();
    this.onPerformanceChange?.(mode, profile);
    return true;
  }
  getPerformanceMode() { return this.performanceMode; }
  /** live numbers for the Orb Studio quality panel */
  getStats() {
    const rb = this.robot;
    return { mode: this.performanceMode, profile: this.performanceProfile, fps: Math.round(this.fpsMeasured || 0), renderPx: rb?.lastRenderPx || 0, robotReady: !!rb?.ready, robotActive: this.profileId === 'robot' };
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.lastRenderedAt = this.lastFrameTime;
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  destroy() {
    this.stop();
    if (this.robot && this.ownsRobot) {
      this.robot.dispose?.();
      this.robot = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.windowResizeHandler);
    window.removeEventListener('mousemove', this.mouseMoveHandler);
    window.removeEventListener('mouseleave', this.mouseLeaveHandler);
  }

  loop() {
    if (!this.isRunning) return;

    const now = performance.now();
    const elapsed = now - this.lastRenderedAt;
    if (elapsed >= this.frameIntervalMs) {
      const dt = Math.min(elapsed / 1000, 0.1);
      this.lastRenderedAt = now - (elapsed % this.frameIntervalMs);
      this.lastFrameTime = now;
      this.time += dt;
      this.update(dt);
      this.render();
      this.onFrame?.();
      this.fpsFrames = (this.fpsFrames || 0) + 1;
      if (now - (this.fpsSince || now) >= 500) { this.fpsMeasured = this.fpsFrames * 1000 / (now - this.fpsSince); this.fpsFrames = 0; this.fpsSince = now; }
    }

    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }

  update(dt) {
    const cfg = this.stateManager.getConfig();
    const audioLevel = this.stateManager.getAudioLevel();
    const currentState = this.stateManager.getState();

    // Smoothly ease mouse gaze
    this.currentLook.x += (this.targetLook.x - this.currentLook.x) * (dt * 5.0);
    this.currentLook.y += (this.targetLook.y - this.currentLook.y) * (dt * 5.0);

    // Audio reactivity modulating parameters
    const targetAmp = cfg.waveAmplitude + audioLevel * 0.35;
    const targetSpeed = cfg.waveSpeed + audioLevel * 3.0;
    const targetGlow = cfg.glowRadius + audioLevel * 25.0;
    const targetScale = cfg.coreScale + audioLevel * 0.22;
    const targetBright = cfg.coreBrightness + audioLevel * 0.45;
    const targetInstability = cfg.instability;

    // Wake state assembly progression
    let targetAssembly = cfg.assembly;
    if (currentState === ORB_STATES.WAKE) {
      const elapsed = (performance.now() - this.stateManager.stateStartTime) / 1000;
      targetAssembly = Math.min(1.0, 0.3 + elapsed * 0.7);
    }

    // Smooth lerping across all visual dimensions
    const lerpSpeed = dt * 5.5;
    this.interpolatedWaveAmp += (targetAmp - this.interpolatedWaveAmp) * lerpSpeed;
    this.interpolatedWaveSpeed += (targetSpeed - this.interpolatedWaveSpeed) * lerpSpeed;
    this.interpolatedGlow += (targetGlow - this.interpolatedGlow) * lerpSpeed;
    this.interpolatedCoreScale += (targetScale - this.interpolatedCoreScale) * (dt * 6.5);
    this.interpolatedBrightness += (targetBright - this.interpolatedBrightness) * lerpSpeed;
    this.interpolatedInstability += (targetInstability - this.interpolatedInstability) * (dt * 4.0);
    this.interpolatedAssembly += (targetAssembly - this.interpolatedAssembly) * (dt * 3.5);

    // Dynamic spin accumulation based on state
    this.currentSpin += (cfg.spinRate + audioLevel * 1.2) * dt;

    // Particle updates
    const spawnRate = cfg.particleRate;
    const particleSpeedMul = cfg.particleSpeed;
    const baseRadius = Math.min(this.width, this.height) * 0.32;

    for (const p of this.particles) {
      p.life += dt * spawnRate;
      p.x += p.vx * 60 * dt * particleSpeedMul;
      p.y += p.vy * 60 * dt * particleSpeedMul;

      if (p.life >= p.maxLife) {
        p.life = 0;
        const angle = Math.random() * Math.PI * 2;
        const dist = baseRadius * (0.3 + Math.random() * 0.85);
        p.x = Math.cos(angle) * dist;
        p.y = Math.sin(angle) * dist;
        p.vx = (Math.cos(angle) * 0.28 + (Math.random() - 0.5) * 0.35);
        p.vy = -0.35 - Math.random() * 0.75;
      }
    }
  }

  render() {
    const ctx=this.ctx, w=this.width, h=this.height;
    ctx.clearRect(0,0,w,h);
    const stateRaw=this.stateManager.getState();
    const audioLevel=Math.max(0,Math.min(1,this.stateManager.getAudioLevel?.()||0));
    const stateMap={idle:'idle',listen:'listening',listening:'listening',think:'thinking',thinking:'thinking',speak:'speaking',speaking:'speaking',wake:'wake',error:'error',offline:'offline'};
    let state=stateMap[stateRaw]||stateRaw;
    const cfg=this.stateManager.getConfig?.()||{};
    const reduce=!!(cfg.reduceMotion||cfg.reducedMotion);
    const px=Math.min(w,h);
    const now=performance.now();
    const wake=this.interpolatedAssembly ?? (state==='wake'?Math.min(1,(now-this.lastFrameTime)/800):1);
    const mic=state==='listening'?audioLevel:0;
    const out=state==='speaking'?audioLevel:0;
    // Same drive as nexora-orb-test.html: profile colour, old orb recolours per state, wake = 750 ms assembly, small mic/out levels.
    if (this.lastRenderState !== state) {
      if (!this.lastRenderState || this.lastRenderState === 'idle' || this.lastRenderState === 'offline') this.wakeAt = now;
      this.lastRenderState = state;
    }
    if (this.wakeAt === undefined) this.wakeAt = now - 1000;
    const wakeP = (now - this.wakeAt) / 750;
    const STATE_RGB = { listening: [110,255,180], thinking: [180,150,255] };
    let rgb = this.profile.rgb.slice();
    if ((this.profileId === 'nexora' || this.profileId === 'robot') && STATE_RGB[state]) rgb = STATE_RGB[state];
    if (state === 'error') rgb = [239,100,65];
    if (state === 'offline') rgb = [148,163,184];
    // Real loudness when present, otherwise the same gentle fake level the test page uses.
    const fake = 0.5 + 0.5 * Math.sin(now * 0.009) * Math.sin(now * 0.0023 + 1);
    const micT = state === 'listening' ? (audioLevel > 0.03 ? audioLevel * 0.25 : 0.1 * fake) : 0;
    const outT = state === 'speaking' ? (audioLevel > 0.03 ? audioLevel * 0.2 : 0.08 * fake) : 0;
    this.micLvl = (this.micLvl || 0) + (micT - (this.micLvl || 0)) * (micT > (this.micLvl || 0) ? 0.6 : 0.2);
    this.outLvl = (this.outLvl || 0) + (outT - (this.outLvl || 0)) * (outT > (this.outLvl || 0) ? 0.6 : 0.2);
    if (state === 'speaking' && Math.random() < 0.1) this.energyLvl = 1;
    this.energyLvl = (this.energyLvl || 0) * 0.93;
    ctx.save();
    if (state === 'offline') ctx.globalAlpha = 0.45;
    const frame = { px, w, h, t: reduce ? 0 : now, state, rgb, level: audioLevel, energy: this.energyLvl, mic: this.micLvl, out: this.outLvl, wake: this.fullSize ? 1 : Math.min(1, Math.max(0, wakeP)), reduce };
    if (this.profileId === 'robot') {
      const rb = this.ensureRobot();
      if (rb.failed) {
        if (!this._robotFailureLogged) {
          this._robotFailureLogged = true;
          console.error('[NEXORA robot] 3D robot preview failed to load; showing icon fallback:', rb.error);
        }
        this.drawRobotFallbackIcon(ctx, frame);
      } else {
        try {
          const drawRgb = this.previewMode ? [220, 226, 236] : rgb;
          rb.draw(ctx, { ...frame, rgb: drawRgb, fit: 1, popup: !!(this.fullSize || this.previewMode), quality: this.performanceProfile });
        } catch (e) {
          console.error('[NEXORA robot]', e);
          rb.failed = true;
          rb.error = e;
        }
      }
    } else drawHtmlOrb(ctx, this.profileId, frame);
    ctx.restore();
  }

  drawRobotFallbackIcon(ctx, frame) {
    if (!this._robotFallbackImg) {
      const img = new Image();
      img.src = ROBOT_FALLBACK_ICON;
      this._robotFallbackImg = img;
    }
    const img = this._robotFallbackImg;
    const size = Math.min(frame.w, frame.h) * 0.62;
    const x = (frame.w - size) / 2;
    const y = (frame.h - size) / 2;
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x, y, size, size);
    }
  }

  /** Replay the 750 ms assembly (used when the popup is shown). */
  triggerWake() { this.wakeAt = performance.now(); this.robot?.replay?.(); }

  /** Popup Orb: always draw at full size (skip the 50% -> 100% assembly scale-up). */
  setFullSize(on = true) { this.fullSize = !!on; }

}
