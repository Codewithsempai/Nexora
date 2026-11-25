/*!
 * Nexora Face Screen + VFX (v4)  -  the robot's display: face, expressions pack and face visual effects.
 *
 *   const screen = new NexoraFaceScreen(768, 384);      // owns an off-screen <canvas> (screen.canvas) -> use as a texture
 *   screen.express('love');                             // any id from NexoraFaceScreen.EXPRESSIONS
 *   screen.setAuto('joy');                              // animator face preset -> emotion + eye style + emote FX
 *   screen.trigger('glitch');                           // boot | glitch | screenOff | screenOn
 *   screen.setStatus('listening');                      // status overlays (mic bars / thinking dots / voice wave / error)
 *   // every frame
 *   screen.update(dt, t, voice);                        // voice = NexoraVoiceSync (lip sync)
 *   screen.render(t, dt, voice, { gaze:[x,y] });
 *
 * EXPRESSIONS : 8 base emotions + 14 extra characters (love, dizzy, starstruck, cool, dead, sleepy, confused ...)
 *               every one is a combination of emotion + facial action + special eye style + emote FX.
 * EMOTE FX    : hearts sparkles zzz question exclaim sweat rain music anger stars   (particles drawn on the face)
 * SCREEN VFX  : scanlines  scan beam  LED dot matrix  flicker  vignette  chroma split  static noise  glitch  boot  power-off
 * STATUS FX   : listening mic bars, thinking dots, speaking voice wave, error glitch bursts
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./nexora-face.js'));
  else root.NexoraFaceScreen = factory(root.NexoraFace);
})(typeof self !== 'undefined' ? self : this, function (NexoraFace) {
  'use strict';
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const PI = Math.PI, sin = Math.sin, cos = Math.cos;

  /* ---------------- expressions pack ---------------- */
  // emotion: Ekman emotion | pose: facial action held | eye: special eye style | fx: emote FX | body: matching body animation
  const E = (label, emotion, pose, eye, fx, body, amt) => ({ label, emotion, pose, eye, fx: fx || [], body: body || null, amt: amt == null ? 1 : amt });
  const EXPRESSIONS = {
    neutral:    E('Neutral', 'neutral'),
    happiness:  E('Happy', 'happiness', null, null, ['sparkles'], 'happy'),
    sadness:    E('Sad', 'sadness', null, null, ['rain'], 'sad'),
    anger:      E('Angry', 'anger', null, null, ['anger'], 'error'),
    fear:       E('Fear', 'fear', null, null, ['sweat']),
    surprise:   E('Surprise', 'surprise', null, null, ['exclaim'], 'surprised'),
    disgust:    E('Disgust', 'disgust'),
    contempt:   E('Contempt', 'contempt'),
    love:       E('Love', 'happiness', 'blush', 'heart', ['hearts']),
    dizzy:      E('Dizzy', 'neutral', 'wince', 'spiral', ['stars']),
    starstruck: E('Starstruck', 'surprise', 'beam', 'star', ['sparkles']),
    cool:       E('Cool', 'neutral', 'smirk', 'shades', ['music']),
    dead:       E('Knocked out', 'neutral', 'deadpan', 'x', []),
    sleepy:     E('Sleepy', 'neutral', 'yawn', 'sleep', ['zzz'], 'sleep'),
    confused:   E('Confused', 'neutral', 'raisebrow', null, ['question'], 'confused'),
    crying:     E('Crying', 'sadness', 'teary', null, ['rain']),
    shy:        E('Shy', 'neutral', 'bitelip', null, ['sparkles'], null, .8),
    mischief:   E('Mischief', 'contempt', 'smirk', null, []),
    joy:        E('Joy', 'happiness', 'beam', null, ['sparkles', 'music'], 'happy'),
    rage:       E('Rage', 'anger', 'clench', null, ['anger'], 'error', 1.4),
    shock:      E('Shock', 'fear', 'gasp', null, ['exclaim', 'sweat']),
    smug:       E('Smug', 'contempt', 'smirk', null, [], null, .9)
  };
  const EXPRESSION_GROUPS = {
    'Emotions': ['neutral', 'happiness', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'contempt'],
    'Characters': ['love', 'dizzy', 'starstruck', 'cool', 'dead', 'sleepy', 'confused', 'crying', 'shy', 'mischief', 'joy', 'rage', 'shock', 'smug']
  };
  /* animator face presets (body states) -> expression pieces */
  const AUTO = {
    idle: E('', 'neutral'), listening: E('', 'neutral', 'raisebrow'), thinking: E('', 'neutral', 'squint'), speaking: E('', 'neutral'),
    joy: E('', 'happiness', null, null, ['sparkles']), confused: E('', 'neutral', 'raisebrow', null, ['question']), sad: E('', 'sadness', null, null, ['rain']),
    surprised: E('', 'surprise', null, null, ['exclaim']), sleepy: E('', 'neutral', null, 'sleep', ['zzz']), waking: E('', 'surprise'),
    error: E('', 'anger', null, null, ['anger']), off: E('', 'neutral', null, 'sleep')
  };
  const FX_LIST = ['hearts', 'sparkles', 'zzz', 'question', 'exclaim', 'sweat', 'rain', 'music', 'anger', 'stars'];
  const FX_RATE = { hearts: 2.2, sparkles: 6, zzz: .7, question: .5, exclaim: .55, sweat: .35, rain: 15, music: 1.5 };

  /* ---------------- screen VFX options (id, label, default) ---------------- */
  const VFX = [
    ['scan', 'Scanlines', true], ['beam', 'Scan beam', true], ['dots', 'LED dot matrix', false], ['flicker', 'Flicker', true],
    ['vignette', 'Vignette', true], ['chroma', 'Chroma split', false], ['noise', 'Static noise', false], ['bloom', 'Bloom pulse', true],
    ['emote', 'Emote FX (hearts, sparkles…)', true], ['status', 'Status FX (mic bars, dots, wave)', true], ['blink', 'Blink', true], ['look', 'Eyes follow head', true]
  ];

  /* ---------------- little glyph painters ---------------- */
  function heart(c, x, y, s) {
    c.beginPath(); c.moveTo(x, y + s * .95);
    c.bezierCurveTo(x - s * 1.45, y - s * .1, x - s * .85, y - s * 1.15, x, y - s * .42);
    c.bezierCurveTo(x + s * .85, y - s * 1.15, x + s * 1.45, y - s * .1, x, y + s * .95); c.fill();
  }
  function sparkle(c, x, y, s) {
    c.beginPath(); c.moveTo(x, y - s);
    c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s); c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s); c.fill();
  }
  function drop(c, x, y, s) {
    c.beginPath(); c.moveTo(x, y - s * 1.3); c.bezierCurveTo(x + s * .9, y - s * .1, x + s * .8, y + s * .9, x, y + s * .9); c.bezierCurveTo(x - s * .8, y + s * .9, x - s * .9, y - s * .1, x, y - s * 1.3); c.fill();
  }
  function glyph(c, ch, x, y, s, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0); c.font = '800 ' + s + 'px "Segoe UI", system-ui, -apple-system, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 0, 0); c.restore();
  }
  function star5(c, x, y, s) {
    c.beginPath(); for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, r = i % 2 ? s * .45 : s; i ? c.lineTo(x + cos(a) * r, y + sin(a) * r) : c.moveTo(x + cos(a) * r, y + sin(a) * r); } c.closePath(); c.fill();
  }

  class NexoraFaceScreen {
    constructor(w, h) {
      this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d');
      this.face = new NexoraFace();
      this.opt = {}; VFX.forEach(v => { this.opt[v[0]] = v[2]; });
      this.opt.glow = 1; this.opt.intensity = 1; this.opt.color = null;          // color null = follow the state colour
      this.color = '#ffffff'; this.stateColor = '#ffffff';
      this.expr = null; this.fx = new Set(); this.particles = []; this.acc = {};
      this.status = 'idle'; this.bootT = -9; this.glT = -9; this.screenOn = true; this.scrA = 1; this._errT = 0;
      this.level = 0; this.glowLevel = 1; this._flick = 1; this._t = 0;
      this.setSize(w || 768, h || 384);
    }
    setSize(w, h) {
      w = Math.round(w); h = Math.round(h); this.W = this.canvas.width = w; this.H = this.canvas.height = h;
      const mk = (fn) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; fn(cv.getContext('2d')); return cv; };
      this.scanCv = mk(c => { c.fillStyle = 'rgba(0,0,0,.30)'; for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1); });
      this.dotCv = mk(c => { const st = Math.max(5, Math.round(h / 60)); c.fillStyle = 'rgba(0,0,0,.62)'; for (let y = 0; y < h; y += st) c.fillRect(0, y, w, Math.max(1, st * .28)); for (let x = 0; x < w; x += st) c.fillRect(x, 0, Math.max(1, st * .28), h); });
      this.tmp = this.tmp || document.createElement('canvas'); this.tmp.width = w; this.tmp.height = h;
      return this;
    }
    /** set options, e.g. screen.set({ scan:false, glow:1.4, color:'#ff66aa' }) ; color:null -> state colour */
    set(o) { Object.assign(this.opt, o || {}); this.face.o.blink = !!this.opt.blink; this.face.o.intensity = this.opt.intensity; return this; }
    get(k) { return this.opt[k]; }
    setStateColor(c) { this.stateColor = c || '#ffffff'; return this; }

    /* ---- expressions ---- */
    _apply(e, hold) {
      const f = this.face; f.clear();
      if (e.emotion) f.setEmotion(e.emotion, e.amt);
      if (e.pose) f.setPose(e.pose, .9);
      f.setEyeStyle(e.eye || null);
      this.fx = new Set(e.fx || []);
    }
    /** hold a named expression (see EXPRESSIONS). Returns the entry (so callers can start its body animation). */
    express(id) { const e = EXPRESSIONS[id]; if (!e) throw new Error('Unknown expression: ' + id); this.expr = id; this._apply(e); return e; }
    /** follow an animator face preset (idle, listening, joy, sad, error ...) */
    setAuto(name) { const e = AUTO[name] || AUTO.idle; this.expr = null; this._apply(e); return this; }
    /** play a timed facial action (wink, blink, gasp, sigh, yawn, eyeroll, raisebrow, bitelip, stare) or hold a pose for a moment */
    action(name, hold) { this.face.doAction(name, hold); return this; }
    /** hold a facial action pose (smile, smirk, sneer ...) on top of the current expression */
    pose(name, amt) { this.face.setPose(name, amt); return this; }
    eyeStyle(name) { this.face.setEyeStyle(name); return this; }
    toggleFx(name, on) { if (on == null) on = !this.fx.has(name); on ? this.fx.add(name) : this.fx.delete(name); return on; }
    clearFx() { this.fx.clear(); this.particles.length = 0; }
    /** screen events */
    trigger(name, t) {
      const now = t == null ? performance.now() / 1000 : t;
      if (name === 'boot') { this.bootT = now; this.screenOn = true; } else if (name === 'glitch') this.glT = now + .45;
      else if (name === 'screenOff') this.screenOn = false; else if (name === 'screenOn') { this.screenOn = true; this.bootT = now; }
    }
    setStatus(s) { this.status = s || 'idle'; }

    update(dt, t, voice) {
      this._t = t; dt = clamp(dt, 0, .1);
      this.face.o.blink = !!this.opt.blink; this.face.o.intensity = this.opt.intensity;
      this.face.update(dt, t, voice);
      this.color = this.opt.color || this.stateColor;
      this.level = voice ? voice.level : 0;
      this.scrA += ((this.screenOn ? 1 : 0) - this.scrA) * Math.min(1, dt * 3);
      // emote particles
      if (this.opt.emote && this.screenOn) for (const k of this.fx) {
        const r = FX_RATE[k]; if (!r) continue;
        this.acc[k] = (this.acc[k] || 0) + dt * r;
        while (this.acc[k] >= 1) { this.acc[k] -= 1; this._spawn(k); }
      }
      const W = this.W, H = this.H;
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]; p.life += dt;
        if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
        p.x += (p.vx + (p.sway ? cos(p.life * 3 + p.ph) * W * .02 : 0)) * dt; p.y += p.vy * dt; if (p.g) p.vy += p.g * dt;
      }
      if (this.particles.length > 140) this.particles.splice(0, this.particles.length - 140);
      if (this.status === 'error' && this.screenOn && t > this._errT) { this._errT = t + 1.4 + Math.random() * 1.6; this.glT = t + .3; }
    }
    _spawn(k) {
      const W = this.W, H = this.H, r = Math.random, P = (o) => { o.k = k; o.life = 0; o.ph = r() * 6.28; this.particles.push(o); };
      switch (k) {
        case 'hearts': P({ x: W * (.18 + .64 * r()), y: H * 1.02, vx: (r() - .5) * W * .02, vy: -H * (.25 + .22 * r()), max: 2.7, s: H * (.045 + .04 * r()), sway: true }); break;
        case 'sparkles': P({ x: W * (.08 + .84 * r()), y: H * (.08 + .84 * r()), vx: 0, vy: -H * .02, max: .8 + r() * .5, s: H * (.03 + .05 * r()) }); break;
        case 'zzz': P({ x: W * .8, y: H * .32, vx: W * .035, vy: -H * .12, max: 3, s: H * (.1 + .05 * r()), ch: 'Z' }); break;
        case 'question': P({ x: W * (.78 + .08 * r()), y: H * .22, vx: 0, vy: -H * .03, max: 2.4, s: H * .22, ch: '?' }); break;
        case 'exclaim': for (let i = 0; i < 2; i++) P({ x: W * (.12 + .76 * r()), y: H * (.1 + .12 * r()), vx: 0, vy: -H * .03, max: 1.3, s: H * (.2 + .06 * r()), ch: '!', rot: (r() - .5) * .5 }); break;
        case 'sweat': P({ x: W * (.8 + .06 * r()), y: H * .3, vx: 0, vy: H * .08, g: H * .35, max: 1.7, s: H * .045 }); break;
        case 'rain': P({ x: W * r(), y: -H * .05, vx: 0, vy: H * (.9 + .5 * r()), max: 1.1, s: H * .012 }); break;
        case 'music': P({ x: W * (r() < .5 ? .1 + .12 * r() : .78 + .12 * r()), y: H * .85, vx: (r() - .5) * W * .03, vy: -H * (.25 + .15 * r()), max: 2.3, s: H * (.1 + .05 * r()), ch: r() < .5 ? '♪' : '♫', sway: true }); break;
      }
    }

    /** draw the face into this.canvas. opts: { gaze:[x,y] } */
    render(t, dt, voice, opts) {
      opts = opts || {};
      const c = this.ctx, W = this.W, H = this.H, o = this.opt, col = this.color, vl = voice ? voice.level : 0;
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      const bt = clamp((t - this.bootT) / 1.2), be = bt * bt * (3 - 2 * bt);
      const status = this.status;
      // face
      c.fillStyle = c.strokeStyle = '#fff';
      this.face.draw(c, W, H, { color: col, glow: o.glow * (o.bloom ? 1 : .55), voiceLevel: o.bloom ? vl : 0, peak: voice ? voice.peak : 0, gaze: o.look ? (opts.gaze || [0, 0]) : [0, 0], alpha: be });
      // emote FX + persistent FX
      c.save(); c.shadowColor = col; c.shadowBlur = H * .03 * o.glow;
      if (o.emote) this._drawFx(c, t, W, H, col);
      c.restore();
      // status FX
      if (o.status) this._drawStatus(c, t, W, H, col, voice, status);
      c.shadowBlur = 0; c.globalAlpha = 1;
      // ---- post: chroma split / glitch / noise ----
      const glitch = t < this.glT;
      if (o.chroma || glitch) {
        const tc = this.tmp.getContext('2d'); tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, W, H); tc.drawImage(this.canvas, 0, 0);
        const d = (glitch ? 7 : 2.2) * (W / 768); c.globalCompositeOperation = 'lighter';
        c.globalAlpha = glitch ? .5 : .28; c.drawImage(this.tmp, -d, 0); c.drawImage(this.tmp, d, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      }
      if (glitch) {
        for (let i = 0; i < 6; i++) { const y = Math.random() * H, h = H * (.02 + Math.random() * .08), dx = (Math.random() - .5) * W * .22; c.drawImage(this.canvas, 0, y, W, h, dx, y, W, h); }
        c.fillStyle = 'rgba(255,60,60,.08)'; c.fillRect(0, 0, W, H);
      }
      if (o.noise || glitch) { c.fillStyle = '#fff'; const n = glitch ? 220 : 90; for (let i = 0; i < n; i++) { c.globalAlpha = Math.random() * (glitch ? .3 : .12); c.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 1 + Math.random() * 2); } c.globalAlpha = 1; }
      // ---- overlays ----
      if (o.dots) c.drawImage(this.dotCv, 0, 0);
      if (o.scan) {
        c.drawImage(this.scanCv, 0, 0);
        if (o.beam) { const y = ((t * .3) % 1.4 - .2) * H, gr = c.createLinearGradient(0, y - H * .08, 0, y + H * .08); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.09)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, y - H * .08, W, H * .16); }
      }
      if (o.vignette) { const vg = c.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); c.fillStyle = vg; c.fillRect(0, 0, W, H); }
      let fl = 1; if (o.flicker) { fl = .93 + Math.random() * .07; c.fillStyle = 'rgba(0,0,0,' + ((1 - fl) * 1.5) + ')'; c.fillRect(0, 0, W, H); }
      if (bt < 1) { c.fillStyle = 'rgba(255,255,255,' + ((1 - bt) * .5) + ')'; c.fillRect(0, H / 2 - 2, W * be, 4); }
      if (this.scrA < .995) { c.globalAlpha = 1 - this.scrA; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
      // brightness the room should receive from the screen (point-light spill)
      this.glowLevel = o.glow * fl * (.4 + .6 * Math.min(1, be)) * (1 + (o.bloom ? vl * .8 : 0)) * this.scrA;
      return this.canvas;
    }

    _drawFx(c, t, W, H, col) {
      const fx = this.fx;
      for (const p of this.particles) {
        const a = clamp(Math.min(p.life / .18, (p.max - p.life) / (p.max * .35)));
        c.globalAlpha = a * (p.k === 'rain' ? .55 : 1);
        switch (p.k) {
          case 'hearts': c.fillStyle = '#ff6f9c'; c.shadowColor = '#ff6f9c'; heart(c, p.x, p.y, p.s); break;
          case 'sparkles': c.fillStyle = '#fff'; c.shadowColor = col; sparkle(c, p.x, p.y, p.s * (.5 + .5 * sin(p.life * 9 + p.ph))); break;
          case 'sweat': c.fillStyle = '#8fd8ff'; c.shadowColor = '#8fd8ff'; drop(c, p.x, p.y, p.s); break;
          case 'rain': c.fillStyle = '#7fb8ff'; c.shadowColor = '#7fb8ff'; c.fillRect(p.x, p.y, Math.max(1.5, p.s * .25), p.s * 3.2); break;
          default: c.fillStyle = (p.k === 'exclaim') ? '#ffe36b' : (p.k === 'question' ? '#c9a8ff' : col); c.shadowColor = c.fillStyle;
            glyph(c, p.ch, p.x, p.y + (p.k === 'question' ? sin(t * 5) * H * .012 : 0), p.s * (p.k === 'zzz' ? .6 + p.life * .25 : 1), p.rot || 0);
        }
      }
      c.globalAlpha = 1;
      if (fx.has('anger')) {             // pulsing red anger mark + red edge pulse
        const pu = .6 + .4 * sin(t * 9), x = W * .86, y = H * .17, s = H * .085 * (.85 + .25 * pu);
        c.strokeStyle = '#ff4d4d'; c.shadowColor = '#ff4d4d'; c.lineWidth = H * .022; c.lineCap = 'round';
        for (const q of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) { c.beginPath(); c.arc(x + q[0] * s * .62, y + q[1] * s * .62, s * .5, q[0] * q[1] > 0 ? PI * .5 : PI * 1.5, q[0] * q[1] > 0 ? PI * 1.5 : PI * 2.5, false); c.stroke(); }
        c.globalAlpha = .12 + .1 * pu; c.fillStyle = '#ff2d2d'; c.fillRect(0, 0, W, H * .05); c.fillRect(0, H * .95, W, H * .05); c.globalAlpha = 1;
      }
      if (fx.has('stars')) {             // dizzy stars orbiting above the eyes
        c.fillStyle = '#ffe36b'; c.shadowColor = '#ffd23f';
        for (let i = 0; i < 4; i++) { const a = t * 3 + i * PI / 2; star5(c, W * .5 + cos(a) * W * .26, H * .12 + sin(a) * H * .06, H * (.045 + .01 * sin(a))); }
      }
    }

    _drawStatus(c, t, W, H, col, voice, st) {
      c.save(); c.shadowColor = col; c.shadowBlur = H * .03 * this.opt.glow; c.fillStyle = col; c.strokeStyle = col;
      const lv = voice ? voice.level : 0;
      if (st === 'listening') {                    // mic bars across the bottom, driven by the input level
        const n = 11, bw = W * .018, gap = W * .014, x0 = W / 2 - (n * (bw + gap)) / 2 + gap / 2;
        for (let i = 0; i < n; i++) { const e = .25 + .75 * Math.abs(sin(t * 4.2 + i * .7) * sin(t * 1.7 + i)); const h = H * (.012 + .05 * e * (.35 + lv * 3)); c.globalAlpha = .55; c.fillRect(x0 + i * (bw + gap), H * .93 - h / 2, bw, h); }
        const r = (t * .9) % 1; c.globalAlpha = (1 - r) * .35; c.lineWidth = H * .01; c.beginPath(); c.arc(W * .5, H * .5, H * (.35 + r * .5), 0, PI * 2); c.stroke();
      } else if (st === 'thinking') {               // typing dots + orbiting scan dots
        for (let i = 0; i < 3; i++) { const b = (sin(t * 5 - i * .9) + 1) / 2; c.globalAlpha = .35 + .5 * b; c.beginPath(); c.arc(W * (.5 + (i - 1) * .06), H * .93 - b * H * .025, H * .016, 0, PI * 2); c.fill(); }
        for (let i = 0; i < 5; i++) { const a = t * 2.4 - i * .35; c.globalAlpha = .55 - i * .1; c.beginPath(); c.arc(W * .5 + cos(a) * W * .42, H * .5 + sin(a) * H * .42, H * (.014 - i * .002), 0, PI * 2); c.fill(); }
      } else if (st === 'speaking' && voice) {      // voice waveform under the mouth line
        c.globalAlpha = .5; c.lineWidth = H * .012; c.lineCap = 'round'; c.beginPath(); const n = voice.wave.length, y0 = H * .94;
        for (let i = 0; i < n; i += 2) { const x = W * (.2 + .6 * i / n), y = y0 + voice.wave[i] * H * .09 * (.3 + lv * 2); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      } else if (st === 'error') {                  // warning triangle in the corner
        const p = .55 + .45 * sin(t * 10), x = W * .09, y = H * .13, s = H * .07; c.globalAlpha = p; c.strokeStyle = c.fillStyle = '#ff4d4d'; c.shadowColor = '#ff4d4d'; c.lineWidth = H * .016; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 1.1, y + s * .8); c.lineTo(x - s * 1.1, y + s * .8); c.closePath(); c.stroke(); glyph(c, '!', x, y + s * .22, s * 1.2);
      }
      c.restore();
    }
  }
  NexoraFaceScreen.EXPRESSIONS = EXPRESSIONS; NexoraFaceScreen.EXPRESSION_GROUPS = EXPRESSION_GROUPS; NexoraFaceScreen.AUTO = AUTO;
  NexoraFaceScreen.FX_LIST = FX_LIST; NexoraFaceScreen.VFX = VFX; NexoraFaceScreen.default = NexoraFaceScreen;
  return NexoraFaceScreen;
});
