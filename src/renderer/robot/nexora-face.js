/*!
 * Nexora Face  -  human-like face engine for the Nexora robot screen
 * Stylised ROBOT screen face (LED eyes, bar brows, glowing mouth) - no nose, no skin detail.
 * Human expressions come from eye shape, brow angle and mouth shape only.
 * on a 2D canvas, driven by FACS-style parameters.
 *
 *   const face = new NexoraFace();
 *   face.setEmotion('happiness');          // 7 universal emotions (+ neutral)
 *   face.doAction('wink');                 // timed facial actions
 *   face.update(dt, t, voice);             // voice = NexoraVoiceSync (lip sync)
 *   face.draw(ctx, W, H, { glow, color, gaze:[x,y], bootAlpha });
 *
 * EMOTIONS : neutral happiness sadness anger fear surprise disgust contempt
 * ACTIONS  : smile grin beam smirk sneer frown pout grimace wince gasp sigh yawn
 *            purse bitelip clench wink blink squint stare glare glower eyeroll
 *            raisebrow furrow teary deadpan blush flush pale (screen tint)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoraFace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const sin = Math.sin, PI = Math.PI;
  const EYE_STYLES = ['heart', 'x', 'spiral', 'star', 'sleep', 'shades'];

  /* ---- parameter set (all ~ -1..1 unless noted) ----
   * browIn/browOut/browTilt : L and R brows (+ = raised / inner-down-angry is browTilt<0)
   * lid      : upper lid openness 0 closed .. 1 normal .. 1.5 wide
   * lower    : lower-lid push up (cheek raise / squint) 0..1
   * crinkle  : crow's-feet lines 0..1
   * cL cR    : mouth corner  +1 raised (smile) .. -1 down (frown)
   * open     : jaw / mouth opening 0..1       wid : mouth width .5..1.5
   * press    : lips pressed tight 0..1        pucker : lips pursed/round 0..1
   * upLip    : upper lip raised (snarl) 0..1  teeth : show teeth 0..1
   * nose     : nose wrinkle 0..1              nostril : flare 0..1
   * blush     : 0..1   pale : 0..1   tear : 0..1   puff : cheek puff 0..1
   * cheek    : cheek lift (smile bulge) 0..1  jawShift : -1..1 sideways
   */
  const NEUTRAL = {
    bLi: 0, bLo: 0, bLt: 0, bRi: 0, bRo: 0, bRt: 0,
    lidL: 1, lidR: 1, lower: 0, crinkle: 0, wide: 0,
    cL: .12, cR: .12, open: 0, wid: 1, press: 0, pucker: 0, upLip: 0, teeth: 0,
    nose: 0, nostril: 0, blush: 0, pale: 0, tear: 0, puff: 0, cheek: 0, jawShift: 0, tongue: 0
  };
  const P = (o) => Object.assign({}, NEUTRAL, o);

  /* ---------------- 7 universal emotions (Ekman) ---------------- */
  const EMOTIONS = {
    neutral: P({}),
    // raised lip corners, lifted cheeks, crinkles around the eyes
    happiness: P({ cL: 1, cR: 1, cheek: 1, lower: .55, crinkle: 1, lidL: .8, lidR: .8, bLo: .15, bRo: .15, open: .12, wid: 1.2, teeth: .5, blush: .2 }),
    // drooped eyelids, raised inner brows, downturned corners
    sadness: P({ bLi: .9, bRi: .9, bLt: .6, bRt: .6, lidL: .62, lidR: .62, cL: -.85, cR: -.85, wid: .9, tear: .35, pale: .1, jawShift: 0 }),
    // lowered/furrowed brows, narrowed glaring eyes, pressed lips
    anger: P({ bLi: -.95, bRi: -.95, bLo: -.4, bRo: -.4, bLt: -1, bRt: -1, lidL: .62, lidR: .62, lower: .35, cL: -.35, cR: -.35, press: 1, wid: .95, nostril: .5, nose: .2, blush: .25 }),
    // raised brows, widened eyes, tense slightly open mouth
    fear: P({ bLi: .9, bRi: .9, bLo: .55, bRo: .55, bLt: .5, bRt: .5, lidL: 1.35, lidR: 1.35, wide: 1, cL: -.2, cR: -.2, open: .22, wid: 1.15, teeth: .3, pale: .55, nostril: .3 }),
    // raised brows, wide eyes, dropped jaw
    surprise: P({ bLi: 1, bRi: 1, bLo: 1, bRo: 1, lidL: 1.45, lidR: 1.45, wide: 1, cL: 0, cR: 0, open: 1, wid: .8, pucker: .1 }),
    // wrinkled nose, raised upper lip, lowered brows
    disgust: P({ bLi: -.6, bRi: -.6, bLo: -.2, bRo: -.2, bLt: -.5, bRt: -.5, lidL: .65, lidR: .65, lower: .5, nose: 1, upLip: 1, cL: -.45, cR: -.45, open: .14, wid: 1.05, teeth: .45, nostril: .6, tongue: .15 }),
    // one corner pulled back / raised, rest neutral
    contempt: P({ cL: 0, cR: .95, cheek: .15, lidL: .9, lidR: .85, bLo: .05, bRt: -.15, bRi: -.1, jawShift: .2, wid: .95 })
  };

  /* ---------------- facial actions (sustained poses) ---------------- */
  const POSES = {
    smile: P({ cL: .75, cR: .75, cheek: .5, lower: .2, wid: 1.1 }),
    grin: P({ cL: 1, cR: 1, cheek: .9, lower: .4, crinkle: .6, open: .2, wid: 1.4, teeth: 1 }),
    beam: P({ cL: 1, cR: 1, cheek: 1, lower: .7, crinkle: 1, lidL: .7, lidR: .7, open: .3, wid: 1.45, teeth: 1, blush: .45, bLo: .25, bRo: .25 }),
    smirk: P({ cL: -.05, cR: 1, cheek: .25, lidL: .9, lidR: .8, bRo: .3, jawShift: .25 }),
    sneer: P({ upLip: 1, nose: .8, cL: -.2, cR: .1, lidL: .75, lidR: .75, bLi: -.4, bRi: -.4, bLt: -.4, bRt: -.4, open: .1, teeth: .6, nostril: .5, jawShift: -.2 }),
    frown: P({ cL: -1, cR: -1, bLi: .3, bRi: .3, bLt: -.3, bRt: -.3, lidL: .8, lidR: .8, wid: .9 }),
    pout: P({ pucker: .75, cL: -.5, cR: -.5, bLi: .5, bRi: .5, bLt: .3, bRt: .3, lidL: .85, lidR: .85, wid: .7, blush: .15 }),
    grimace: P({ cL: -.25, cR: -.25, open: .25, wid: 1.5, teeth: 1, lidL: .55, lidR: .55, lower: .6, crinkle: .5, bLi: .4, bRi: .4, bLt: -.3, bRt: -.3, nostril: .3 }),
    wince: P({ lidL: .2, lidR: .2, lower: 1, crinkle: 1, cL: -.5, cR: -.5, open: .1, wid: 1.25, teeth: .8, nose: .6, bLi: .1, bRi: .1, bLt: -.5, bRt: -.5 }),
    gasp: P({ bLi: .9, bRi: .9, bLo: .8, bRo: .8, lidL: 1.45, lidR: 1.45, wide: 1, open: .75, wid: .7, pale: .3, nostril: .8, cL: 0, cR: 0 }),
    sigh: P({ lidL: .55, lidR: .55, bLi: .35, bRi: .35, bLt: .2, bRt: .2, cL: -.3, cR: -.3, open: .28, pucker: .55, wid: .8, puff: .5 }),
    yawn: P({ lidL: .12, lidR: .12, lower: .8, crinkle: .8, open: 1, wid: .95, bLo: .5, bRo: .5, bLi: .3, bRi: .3, cL: -.1, cR: -.1, tongue: .5, tear: .35, nostril: .4 }),
    purse: P({ pucker: 1, wid: .55, cL: -.1, cR: -.1, lidL: .9, lidR: .9, bLi: .15, bRi: .15 }),
    bitelip: P({ open: .1, teeth: .9, cL: -.1, cR: -.1, lidL: .85, lidR: .85, bLi: .5, bRi: .5, bLt: .4, bRt: .4, blush: .35, press: .5, jawShift: .1 }),
    clench: P({ press: 1, teeth: 1, open: .06, cL: -.2, cR: -.2, wid: 1.35, bLi: -.7, bRi: -.7, bLt: -.8, bRt: -.8, lidL: .7, lidR: .7, nostril: .5, blush: .3 }),
    squint: P({ lidL: .35, lidR: .35, lower: .9, crinkle: .4, bLi: -.2, bRi: -.2 }),
    stare: P({ lidL: 1.2, lidR: 1.2, wide: .7, cL: .02, cR: .02 }),
    glare: P({ bLi: -1, bRi: -1, bLo: -.5, bRo: -.5, bLt: -1, bRt: -1, lidL: .55, lidR: .55, lower: .4, press: .6, cL: -.3, cR: -.3, nostril: .4, blush: .15 }),
    glower: P({ bLi: -1, bRi: -1, bLo: -.7, bRo: -.7, bLt: -1, bRt: -1, lidL: .45, lidR: .45, lower: .5, press: .8, cL: -.5, cR: -.5, nose: .3, nostril: .6, blush: .4, wid: .95 }),
    raisebrow: P({ bRi: .8, bRo: .95, bRt: .5, lidR: 1.15, lidL: .95, cR: .3, cL: .1, jawShift: .1 }),
    furrow: P({ bLi: -.9, bRi: -.9, bLt: -.9, bRt: -.9, lidL: .85, lidR: .85, cL: -.15, cR: -.15 }),
    teary: P({ bLi: .85, bRi: .85, bLt: .5, bRt: .5, lidL: .7, lidR: .7, lower: .3, cL: -.6, cR: -.6, tear: 1, blush: .3, pucker: .2, wid: .9 }),
    deadpan: P({ lidL: .72, lidR: .72, cL: 0, cR: 0, bLo: -.05, bRo: -.05 }),
    blush: P({ blush: 1, cL: .45, cR: .45, cheek: .3, lidL: .85, lidR: .85, bLi: .3, bRi: .3, bLt: .3, bRt: .3 }),
    flush: P({ blush: 1, cL: -.1, cR: -.1, bLi: -.2, bRi: -.2, lidL: .9, lidR: .9, nostril: .3 }),
    pale: P({ pale: 1, lidL: 1.1, lidR: 1.1, cL: -.3, cR: -.3, bLi: .5, bRi: .5, bLt: .3, bRt: .3 })
  };

  /* actions that play a timed animation on top of a pose (name -> {dur, pose, fn}) */
  const ACTIONS = {
    wink:    { dur: 1.1, pose: 'smile',  fn: (k, o) => { o.lidR = Math.min(o.lidR, 1 - 1.0 * bump(k, .1, .35, .65, .9)); o.lower = Math.max(o.lower, .8 * bump(k, .1, .35, .65, .9)); o.crinkle = Math.max(o.crinkle, bump(k, .1, .35, .65, .9)); o.cR += .2 * bump(k, .1, .35, .65, .9); } },
    blink:   { dur: .35, pose: null,     fn: (k, o) => { const v = 1 - bump(k, 0, .35, .5, 1); o.lidL *= v; o.lidR *= v; } },
    gasp:    { dur: 1.6, pose: 'gasp',   fn: (k, o) => { o.open *= .5 + .5 * sm(k * 8); o.jawShift = 0; } },
    sigh:    { dur: 2.6, pose: 'sigh',   fn: (k, o) => { o.open *= bump(k, 0, .3, .6, 1) + .2; o.puff = .6 * bump(k, 0, .25, .5, .8); o.lidL *= 1 - .35 * bump(k, .3, .55, .75, 1); o.lidR = o.lidL; } },
    yawn:    { dur: 3.2, pose: 'yawn',   fn: (k, o) => { const a = bump(k, 0, .3, .7, 1); for (const n of ['open', 'lower', 'crinkle', 'tongue', 'tear', 'bLo', 'bRo']) o[n] *= a; o.lidL = 1 - (1 - o.lidL) * a; o.lidR = o.lidL; } },
    eyeroll: { dur: 1.8, pose: 'deadpan', fn: (k, o, e) => { const a = bump(k, .05, .25, .8, .98); e.gx = Math.sin(k * 2 * PI + PI * .5) * -.0 + Math.cos(k * 2 * PI - PI / 2 + 0) * .9 * a; e.gy = -Math.sin(k * 2 * PI) * 0 + Math.sin(k * 2 * PI * .5 + 0) * 0; const ang = -PI / 2 + k * 2 * PI * .9; e.gx = Math.cos(ang) * .9 * a; e.gy = -Math.sin(ang) * .9 * a; o.lidL = o.lidR = .78; o.bLo = .15 * a; o.bRo = .15 * a; } },
    raisebrow: { dur: 1.6, pose: 'raisebrow', fn: (k, o) => { const a = bump(k, 0, .2, .75, 1); o.bRi *= a; o.bRo *= a; o.bRt *= a; o.lidR = 1 + (o.lidR - 1) * a; o.cR *= a; } },
    bitelip: { dur: 2.2, pose: 'bitelip', fn: (k, o) => { const a = bump(k, 0, .2, .8, 1); o.teeth *= a; o.open *= a; o.blush *= a; } },
    stare:   { dur: 2.4, pose: 'stare', fn: (k, o, e) => { e.noBlink = true; } }
  };
  function bump(k, a, b, c, d) { return k < a ? 0 : k < b ? sm((k - a) / (b - a)) : k < c ? 1 : k < d ? 1 - sm((k - c) / (d - c)) : 0; }

  /* ---------------- viseme table (mouth shapes for speech) ---------------- */
  // [open, wid, pucker, press, teeth, tongue]
  const VIS = {
    rest: [0, 1, 0, 0, 0, 0],
    A: [.95, 1.0, 0, 0, .5, .3],  E: [.55, 1.35, 0, 0, .9, .1], I: [.35, 1.4, 0, 0, .9, .05],
    O: [.8, .72, .55, 0, 0, 0],   U: [.45, .6, 1, 0, 0, 0],
    MBP: [0, .95, 0, 1, 0, 0],    FV: [.18, 1.05, 0, 0, 1, 0],
    L: [.4, 1.1, 0, 0, .7, 1],    TH: [.25, 1.1, 0, 0, .9, .9], SH: [.3, .75, .7, 0, .5, 0],
    SZ: [.15, 1.3, 0, 0, 1, 0],   KG: [.45, 1.0, 0, 0, .3, .2]
  };
  const LETTER = { a: 'A', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I', m: 'MBP', b: 'MBP', p: 'MBP', f: 'FV', v: 'FV', l: 'L', t: 'L', d: 'L', n: 'L', r: 'U', w: 'U', q: 'U', s: 'SZ', z: 'SZ', c: 'KG', k: 'KG', g: 'KG', j: 'SH', x: 'SZ', h: 'A' };
  /** text -> viseme key list (digraphs handled) */
  function textToVisemes(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, ''), out = [];
    for (let i = 0; i < w.length; i++) {
      const d = w.slice(i, i + 2); let v;
      if (d === 'th') { v = 'TH'; i++; } else if (d === 'sh' || d === 'ch') { v = 'SH'; i++; }
      else if (d === 'oo') { v = 'U'; i++; } else if (d === 'ee') { v = 'I'; i++; }
      else if (d === 'ph') { v = 'FV'; i++; } else v = LETTER[w[i]];
      if (v && out[out.length - 1] !== v) out.push(v);
    }
    return out.length ? out : ['A'];
  }

  class NexoraFace {
    constructor(opts) {
      this.o = Object.assign({ blink: true, micro: true, lipSync: true, intensity: 1 }, opts || {});
      this.cur = Object.assign({}, NEUTRAL); this.tgt = Object.assign({}, NEUTRAL);
      this.emotion = 'neutral'; this.emotionAmt = 1; this.pose = null; this.poseAmt = 0;
      this.action = null; this.at = 0; this.eye = { gx: 0, gy: 0 };
      this.nextBlink = 2; this.blinkK = -1; this.mouth = { open: 0, wid: 1, pucker: 0, press: 0, teeth: 0, tongue: 0 };
      this._vseq = []; this._vt0 = 0; this._seed = Math.random() * 100; this._t = 0;
      this.mode = 'screen';   // 'screen' (neon robot display)
      this.eyeStyle = null; this._esName = null; this._esK = 0;   // v4: special eyes (heart / x / spiral / star / sleep / shades)
    }
    get emotions() { return Object.keys(EMOTIONS); }
    get actions() { return Object.keys(POSES); }
    /** hold an emotion (amount 0..1.5). Clears any held pose. */
    setEmotion(name, amt) { if (!EMOTIONS[name]) throw new Error('Unknown emotion: ' + name); this.emotion = name; this.emotionAmt = amt == null ? 1 : amt; this.pose = null; this.action = null; return this; }
    /** hold a facial action pose until clear() */
    setPose(name, amt) { if (!POSES[name]) throw new Error('Unknown pose: ' + name); this.pose = name; this.poseAmt = amt == null ? 1 : amt; this.action = null; return this; }
    /** play a facial action: timed one (wink, blink, yawn...) or a pose for `hold` seconds */
    doAction(name, hold) {
      if (ACTIONS[name]) { this.action = { name, t0: this._t, dur: ACTIONS[name].dur }; }
      else if (POSES[name]) { this.action = { name, t0: this._t, dur: hold || 2.2, plain: true }; }
      else throw new Error('Unknown action: ' + name);
      return this;
    }
    /** v4: replace the block eyes with a special eye style ('heart','x','spiral','star','sleep','shades') or null for normal eyes */
    setEyeStyle(name) { if (name && EYE_STYLES.indexOf(name) < 0) throw new Error('Unknown eye style: ' + name); this.eyeStyle = name || null; if (name) this._esName = name; return this; }
    clear() { this.eyeStyle = null; this.pose = null; this.action = null; this.emotion = 'neutral'; this.emotionAmt = 1; return this; }
    /** feed a word to drive a viseme sequence (optional; voice.open/width already move the jaw) */
    say(word, dur) { this._vseq = textToVisemes(word); this._vdur = dur || Math.max(.15, word.length * .07); this._vt0 = this._t; }

    _target() {
      const t = this.tgt, o = this.o, k = this.o.intensity * this.emotionAmt;
      const E = EMOTIONS[this.emotion];
      for (const n in NEUTRAL) t[n] = NEUTRAL[n] + (E[n] - NEUTRAL[n]) * k;
      this.eye.gx = 0; this.eye.gy = 0; this.eye.noBlink = false;
      if (this.pose) { const Pp = POSES[this.pose], a = this.poseAmt; for (const n in NEUTRAL) t[n] = t[n] + (Pp[n] - NEUTRAL[n]) * a; }
      if (this.action) {
        const a = this.action, kk = (this._t - a.t0) / a.dur;
        if (kk >= 1) this.action = null;
        else {
          const A = ACTIONS[a.name];
          const pn = A ? A.pose : a.name;
          if (pn) {
            const Pp = POSES[pn], env = A ? 1 : bump(kk, 0, .18, .8, 1);
            for (const n in NEUTRAL) t[n] = t[n] + (Pp[n] - NEUTRAL[n]) * env;
          }
          if (A) A.fn(kk, t, this.eye);
        }
      }
      return t;
    }

    /** call every frame. voice: NexoraVoiceSync (optional) */
    update(dt, t, voice) {
      this._t = t; dt = clamp(dt, 0, .1);
      const tg = this._target();
      // micro expressions: tiny asymmetric drifts so the face never looks frozen
      if (this.o.micro) {
        const s = this._seed;
        tg.bLo += .05 * sin(t * .7 + s); tg.bRo += .05 * sin(t * .63 + s * 2); tg.cL += .03 * sin(t * .4 + s * 3); tg.cR += .03 * sin(t * .45 + s * 4);
        tg.jawShift += .05 * sin(t * .3 + s);
      }
      // smooth toward target (different speeds: lids fast, brows medium, mouth quick)
      const k = (s) => 1 - Math.exp(-s * dt);
      for (const n in this.cur) {
        const sp = /lid/.test(n) ? 22 : /^b/.test(n) ? 13 : /tear|blush|pale/.test(n) ? 3 : 11;
        this.cur[n] += (tg[n] - this.cur[n]) * k(sp);
      }
      this._esK += ((this.eyeStyle ? 1 : 0) - this._esK) * k(14); if (this._esK < .004 && !this.eyeStyle) { this._esK = 0; }
      // blinking (humans blink ~every 3-5 s; more when speaking/nervous)
      if (this.o.blink && !this.eye.noBlink && this.blinkK < 0 && t > this.nextBlink) {
        this.blinkK = 0; this.nextBlink = t + 2.4 + Math.random() * 3.2 - (voice && voice.speaking ? .6 : 0);
        if (Math.random() < .15) this.nextBlink = t + .28;    // double blink
      }
      if (this.blinkK >= 0) { this.blinkK += dt / .2; if (this.blinkK >= 1) this.blinkK = -1; }
      // lip sync: voice drives jaw/width, visemes layer rounding / teeth / tongue / closure
      const m = this.mouth, c = this.cur;
      let tOpen = 0, tWid = 1, tPu = 0, tPr = 0, tTe = 0, tTo = 0, speaking = false;
      if (this.o.lipSync && voice && voice.speaking) {
        speaking = true;
        const vs = voice.vis || null;
        tOpen = voice.open; tWid = voice.width;
        if (vs) { tPu = vs.pucker; tPr = vs.press; tTe = vs.teeth; tTo = vs.tongue; if (vs.open != null) tOpen = Math.max(tOpen * .6, vs.open * voice.level * 1.6 + voice.open * .4); }
        else { tPu = clamp((1 - voice.width) * 1.6); tTe = clamp((voice.width - 1) * 2); tTo = clamp(voice.high * .8); }
        if (this._vseq.length) {
          const idx = Math.min(this._vseq.length - 1, Math.floor((t - this._vt0) / this._vdur * this._vseq.length));
          if (t - this._vt0 < this._vdur) { const v = VIS[this._vseq[idx]]; tOpen = Math.max(tOpen * .5, v[0] * Math.max(.3, voice.level * 1.6)); tWid = v[1]; tPu = v[2]; tPr = v[3]; tTe = v[4]; tTo = v[5]; }
        }
      }
      const ks = k(speaking ? 26 : 12);
      m.open += (tOpen - m.open) * ks; m.wid += (tWid - m.wid) * ks; m.pucker += (tPu - m.pucker) * ks; m.press += (tPr - m.press) * ks; m.teeth += (tTe - m.teeth) * ks; m.tongue += (tTo - m.tongue) * ks;
      this.speaking = speaking;
      // human-like saccades: small quick gaze jumps every 1-3.5 s (off while staring)
      if (t > (this._nextSac || 0)) { this._sx = (Math.random() - .5) * .55; this._sy = (Math.random() - .5) * .3; this._nextSac = t + 1 + Math.random() * 2.5; }
      if (this.eye.noBlink) { this._sx = 0; this._sy = 0; }
      this._ssx = (this._ssx || 0) + ((this._sx || 0) - (this._ssx || 0)) * k(30); this._ssy = (this._ssy || 0) + ((this._sy || 0) - (this._ssy || 0)) * k(30);
      // eye (pupil) movement
      const g = this.eye; this._gx = (this._gx || 0) + ((g.gx) - (this._gx || 0)) * k(14); this._gy = (this._gy || 0) + ((g.gy) - (this._gy || 0)) * k(14);
      return this;
    }

    /**
     * draw the face. W,H = canvas size.
     * opts: { color, glow(0..), gaze:[x,y] (-1..1), voiceLevel, peak, alpha }
     */
    draw(c, W, H, opts) {
      opts = opts || {};
      const f = this.cur, m = this.mouth, col = opts.color || '#ffffff', G = opts.glow == null ? 1 : opts.glow, vl = opts.voiceLevel || 0, peak = opts.peak || 0;
      const gaze = opts.gaze || [0, 0], alpha = opts.alpha == null ? 1 : opts.alpha;
      const blinkV = this.blinkK >= 0 ? Math.max(.06, Math.abs(1 - 2 * this.blinkK)) : 1;
      const gx = ((gaze[0] || 0) + (this._ssx || 0) * .6) * W * .035 + this._gx * W * .03, gy = ((gaze[1] || 0) + (this._ssy || 0) * .6) * H * .06 - this._gy * H * .05;
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.globalAlpha = alpha;
      const glowPx = H * .05 * G * (1 + vl * 1.4);
      const cx = W * .5;
      const eyeY = H * .4, eyeDX = W * .2, ew = W * .062, eh0 = H * .13;
      const glow = (px) => { c.shadowColor = col; c.shadowBlur = px; };

      /* ---- cheeks: blush glows (pink), pale cool wash ---- */
      if (f.blush > .02 || f.pale > .02) {
        c.save(); c.shadowBlur = 0;
        for (const sd of [-1, 1]) {
          const bx = cx + sd * W * .27, by = H * (.58 - f.cheek * .02);
          if (f.blush > .02) { const gr = c.createRadialGradient(bx, by, 0, bx, by, W * .1); gr.addColorStop(0, `rgba(255,95,140,${.42 * f.blush})`); gr.addColorStop(1, 'rgba(255,95,140,0)'); c.fillStyle = gr; c.fillRect(bx - W * .12, by - W * .12, W * .24, W * .24); }
        }
        if (f.pale > .02) { c.fillStyle = `rgba(150,200,255,${.07 * f.pale})`; c.fillRect(0, 0, W, H); }
        c.restore();
      }

      /* ---- eyes ---- */
      for (const sd of [-1, 1]) {
        const left = sd < 0, lid = (left ? f.lidL : f.lidR) * blinkV, ex = cx + sd * eyeDX + gx, ey = eyeY + gy;
        const wide = clamp(lid, 0, 1.6);
        const eh = Math.max(H * .008, eh0 * wide * (1 - .1 * peak));
        // lower lid pushes up (cheek raise / squint)
        const lowerCut = eh * 1.55 * clamp(f.lower) * (1 - .0);
        const topY = ey - eh, botY = ey + eh - lowerCut;
        const bw = ew * (1 + .12 * f.wide);
        glow(glowPx); c.fillStyle = col; c.globalAlpha = alpha;
        // eye shape: rounded rect cut by upper lid angle (anger/sadness slant) + lower lid
        const arcK = wide < 1.05 ? clamp((f.cheek - .45) * 2.2) : 0;
        c.globalAlpha = alpha * (1 - arcK) * (1 - this._esK);
        const lt = left ? f.bLt : f.bRt;                  // brow tilt: <0 angry (inner lid drops), >0 sad (outer lid droops)
        c.beginPath();
        const xl = ex - bw, xr = ex + bw, innerX = left ? xr : xl, outerX = left ? xl : xr;
        const tIn = topY + Math.max(0, -lt) * eh * 1.0;
        const tOut = topY + Math.max(0, lt) * eh * .55;
        const bt = Math.max(botY, Math.min(tIn, tOut) + H * .012);
        const rr = Math.min(bw * .55, (bt - Math.min(tIn, tOut)) * .5);
        c.moveTo(innerX, (tIn + bt) / 2);
        c.arcTo(innerX, tIn, (innerX + outerX) / 2, (tIn + tOut) / 2, rr * (tIn <= tOut ? 1 : .6));
        c.arcTo(outerX, tOut, outerX, (tOut + bt) / 2, rr * (tOut <= tIn ? 1 : .6));
        c.arcTo(outerX, bt, (innerX + outerX) / 2, bt, rr);
        c.arcTo(innerX, bt, innerX, (tIn + bt) / 2, rr);
        c.closePath(); c.fill();
        // happy eyes: block eye morphs into a glowing "^" arc when the cheeks lift (robot-style smile eyes)
        if (arcK > .02) {
          c.save(); c.globalAlpha = alpha * arcK; c.strokeStyle = col; c.lineWidth = H * .038; glow(glowPx);
          c.beginPath(); c.arc(ex, ey + eh * .75, bw * .95, PI * 1.13, PI * 1.87); c.stroke(); c.restore();
        }
        c.globalAlpha = alpha;
        if (this._esK > .02 && this._esName) this._eyeStyle(c, this._esName, ex, ey, bw, eh0, this._esK * alpha, col, glowPx, sd, blinkV);
        // pupil / iris cut-out for wide-open eyes (fear, surprise, stare): dark pupil gives life
        if ((f.wide > .05 || wide > 1.1) && this._esK < .3) {
          c.save(); c.shadowBlur = 0; c.globalAlpha = clamp(f.wide + (wide - 1.1) * 2) * .9; c.fillStyle = '#000';
          c.beginPath(); c.arc(ex + this._gx * ew * .5, ey + gy * 0 - this._gy * eh * .4, Math.min(bw, eh) * .42, 0, PI * 2); c.fill(); c.restore();
        }
        // tears: glossy bead on the lower lid + falling drop
        if (f.tear > .05) {
          c.save(); c.shadowBlur = glowPx * .6; c.shadowColor = '#7fd0ff'; c.fillStyle = `rgba(150,215,255,${.85 * f.tear})`;
          const tyy = botY + H * .01 + ((this._t * .25 + (left ? 0 : .4)) % 1) * H * .1 * f.tear * (f.tear > .7 ? 1 : 0);
          c.beginPath(); c.ellipse(ex + sd * bw * .3, botY + H * .004, W * .011 * f.tear, H * .012 * f.tear, 0, 0, PI * 2); c.fill();
          if (f.tear > .7) { c.beginPath(); c.ellipse(ex + sd * bw * .45, tyy + H * .02, W * .007, H * .013, 0, 0, PI * 2); c.fill(); }
          c.restore();
        }
        c.globalAlpha = alpha;

        /* ---- brows ---- */
        const bi = left ? f.bLi : f.bRi, bo = left ? f.bLo : f.bRo, bt2 = left ? f.bLt : f.bRt;
        const byBase = ey - eh0 * 1.3 - H * .018;
        const innerPos = [ex + (left ? 1 : -1) * bw * .95, byBase - bi * H * .075 - (bt2 < 0 ? 0 : 0)];
        const outerPos = [ex - (left ? 1 : -1) * bw * 1.05, byBase - bo * H * .07 + bt2 * 0];
        // anger lowers the inner end (bt<0), sadness raises it (bi>0)
        innerPos[1] -= Math.min(0, bt2) * -H * .0 + bt2 * H * .02;
        outerPos[1] += -bt2 * H * .018 * (bt2 < 0 ? -1 : 1) * 0;
        const midY = (innerPos[1] + outerPos[1]) / 2 - (bo + bi) * H * .012 - H * .012 * clamp(bo - bi, 0, 1);
        glow(glowPx * .7); c.strokeStyle = col; c.lineWidth = H * .03; c.globalAlpha = alpha;
        c.beginPath(); c.moveTo(innerPos[0], innerPos[1]); c.quadraticCurveTo((innerPos[0] + outerPos[0]) / 2, midY, outerPos[0], outerPos[1]); c.stroke();
      }

      /* ---- mouth ---- */
      this._mouth(c, W, H, glowPx, col, alpha, vl);

      c.restore();
    }

    /** v4 special eyes. (ex,ey) eye centre, bw half width, eh0 half height of a normal eye, k 0..1 fade-in */
    _eyeStyle(c, style, ex, ey, bw, eh0, k, col, glowPx, sd, blink) {
      const t = this._t, r = Math.min(bw * 1.25, eh0 * 1.15);
      c.save(); c.globalAlpha = k; c.shadowColor = col; c.shadowBlur = glowPx; c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
      c.lineWidth = Math.max(2, eh0 * .32);
      if (style === 'heart') {
        const beat = 1 + .13 * Math.sin(t * 7) ** 2 * 2, s = r * 1.05 * beat * (.4 + .6 * blink);
        c.fillStyle = '#ff5f8f'; c.shadowColor = '#ff5f8f';
        c.beginPath(); c.moveTo(ex, ey + s * .95);
        c.bezierCurveTo(ex - s * 1.45, ey - s * .1, ex - s * .85, ey - s * 1.15, ex, ey - s * .42);
        c.bezierCurveTo(ex + s * .85, ey - s * 1.15, ex + s * 1.45, ey - s * .1, ex, ey + s * .95); c.fill();
        c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(ex - s * .45, ey - s * .38, s * .17, s * .1, -.6, 0, PI * 2); c.fill();
      } else if (style === 'x') {
        const s = r * .85; c.lineWidth = eh0 * .42; c.beginPath(); c.moveTo(ex - s, ey - s); c.lineTo(ex + s, ey + s); c.moveTo(ex + s, ey - s); c.lineTo(ex - s, ey + s); c.stroke();
      } else if (style === 'spiral') {
        c.lineWidth = Math.max(2, eh0 * .2); c.beginPath();
        const turns = 2.6, steps = 46, rot = t * 6 * (sd < 0 ? 1 : -1);
        for (let i = 0; i <= steps; i++) { const a = rot + (i / steps) * turns * PI * 2, rr = r * 1.05 * (i / steps); const x = ex + Math.cos(a) * rr, y = ey + Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      } else if (style === 'star') {
        const s = r * 1.3 * (1 + .1 * Math.sin(t * 9 + sd)), rot = Math.sin(t * 2.2) * .18;
        c.fillStyle = '#ffe36b'; c.shadowColor = '#ffd23f'; c.beginPath();
        for (let i = 0; i < 10; i++) { const a = -PI / 2 + rot + i * PI / 5, rr = i % 2 ? s * .46 : s; const x = ex + Math.cos(a) * rr, y = ey + Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.closePath(); c.fill();
      } else if (style === 'sleep') {
        c.lineWidth = eh0 * .3; c.beginPath(); c.arc(ex, ey - r * .55, bw * .95, PI * .12, PI * .88); c.stroke();
      } else if (style === 'shades') {
        const w = bw * 1.55, h = eh0 * 1.25;
        c.fillStyle = '#05070b'; c.lineWidth = eh0 * .16; c.beginPath();
        c.moveTo(ex - w, ey - h * .8); c.lineTo(ex + w, ey - h * .8); c.quadraticCurveTo(ex + w * 1.02, ey + h * 1.2, ex, ey + h * 1.1); c.quadraticCurveTo(ex - w * 1.02, ey + h * 1.2, ex - w, ey - h * .8); c.closePath(); c.fill(); c.stroke();
        c.shadowBlur = 0; c.globalAlpha = k * .55; c.strokeStyle = '#fff'; c.lineWidth = eh0 * .12;
        const g = ((t * .5 + (sd < 0 ? 0 : .3)) % 1.6) - .3; c.beginPath(); c.moveTo(ex - w * .6 + g * w, ey - h * .6); c.lineTo(ex - w * .25 + g * w, ey + h * .6); c.stroke();
      }
      c.restore();
    }

    _mouth(c, W, H, glowPx, col, alpha, vl) {
      const f = this.cur, m = this.mouth, cx = W * .5 + f.jawShift * W * .03;
      const press0 = clamp(Math.max(f.press, m.press)), open = clamp(Math.max(f.open, m.open) * (1 - .92 * (m.press > .5 ? m.press : 0))), wid = clamp(f.wid * (this.speaking ? m.wid : 1), .45, 1.6);
      const pucker = clamp(Math.max(f.pucker, m.pucker)), press = clamp(Math.max(f.press, m.press));
      const teeth = clamp(Math.max(f.teeth, m.teeth)), tongue = clamp(Math.max(f.tongue, m.tongue));
      const baseW = W * .105 * wid * (1 - .45 * pucker) * (1 - .1 * press), my = H * .715 + open * H * .02;
      const cLy = my - f.cL * H * .055 - f.cheek * H * .012, cRy = my - f.cR * H * .055 - f.cheek * H * .012;
      const xL = cx - baseW, xR = cx + baseW;
      c.save(); c.shadowColor = col; c.shadowBlur = glowPx; c.strokeStyle = col; c.fillStyle = col; c.lineWidth = H * .03 * (1 - .3 * press);
      c.globalAlpha = alpha; c.lineCap = 'round'; c.lineJoin = 'round';
      const up = f.upLip * H * .03;                       // snarl: upper lip lifts
      const lipTopL = my - open * H * .06 - up, lipBot = my + open * H * .13 * (1 - .25 * pucker);
      if (open > .06 || pucker > .3 && open > .02) {
        // open mouth: dark cavity with teeth + tongue, outlined by glowing lips
        const mw = baseW * (1 - .08 * open), cy = (lipTopL + lipBot) / 2, rh = Math.max(H * .008, (lipBot - lipTopL) / 2);
        const path = () => {
          const cyL = (cLy + my) / 2 - (open > .3 ? 0 : 0), kt = (cy - lipTopL) * 1.33, kb = (lipBot - cy) * 1.33;
          c.beginPath(); c.moveTo(cx - mw, cLy);
          c.bezierCurveTo(cx - mw * .65, cy - kt, cx + mw * .65, cy - kt, cx + mw, cRy);
          c.bezierCurveTo(cx + mw * .65, cy + kb, cx - mw * .65, cy + kb, cx - mw, cLy);
          c.closePath();
        };
        path(); c.save(); c.shadowBlur = 0; c.fillStyle = '#05070a'; c.fill(); c.clip();
        // tongue
        if (tongue > .05 || open > .5) { c.fillStyle = 'rgba(255,120,150,.85)'; c.beginPath(); c.ellipse(cx, lipBot - rh * .15, mw * .55, rh * (.35 + .35 * tongue), 0, 0, PI * 2); c.fill(); }
        // upper teeth
        if (teeth > .05) { c.fillStyle = `rgba(255,255,255,${.95 * teeth})`; const th = Math.min(rh * 1.0, H * .03) * (.5 + .5 * teeth); c.fillRect(cx - mw, lipTopL - rh, mw * 2, th + rh * .3); c.fillStyle = `rgba(0,0,0,${.35 * teeth})`; for (let i = -3; i <= 3; i++) c.fillRect(cx + i * mw * .27 - 1, lipTopL - rh, 2, th + rh * .3); if (open > .5) { c.fillStyle = `rgba(255,255,255,${.7 * teeth})`; c.fillRect(cx - mw * .75, lipBot - th * .9, mw * 1.5, th * .9); } }
        c.restore();
        path(); c.stroke();
      } else {
        // closed mouth: curve driven by corner heights (smile / frown / smirk), pressed = flat + thin
        const sag = f.pucker * 0;
        c.beginPath();
        c.moveTo(xL, cLy);
        const mid = my + (press > .5 ? 0 : (f.cL + f.cR) * .5 * H * .035) + (1 - Math.abs((f.cL + f.cR) / 2)) * H * .004 - pucker * 0;
        c.bezierCurveTo(cx - baseW * .5, mid + H * .004 - up, cx + baseW * .5, mid + H * .004 - up, xR, cRy);
        c.stroke();
        if (pucker > .3) { c.beginPath(); c.ellipse(cx, my, baseW * .55, H * (.012 + pucker * .02), 0, 0, PI * 2); c.stroke(); }
        // bitten lip: tooth over lower lip
        if (teeth > .3 && press < .8) { c.save(); c.shadowBlur = 0; c.fillStyle = `rgba(255,255,255,${.9 * teeth})`; c.fillRect(cx - baseW * .3, my - H * .004, baseW * .6, H * .022 * teeth); c.restore(); }
      }
      // contempt dimple: one cheek tick
      const asym = f.cR - f.cL; if (Math.abs(asym) > .5) { c.shadowBlur = 0; c.globalAlpha = alpha * (Math.abs(asym) - .5) * .8; c.lineWidth = H * .01; const sd = asym > 0 ? 1 : -1, y0 = asym > 0 ? cRy : cLy; c.beginPath(); c.moveTo(cx + sd * (baseW + W * .012), y0 - H * .016); c.lineTo(cx + sd * (baseW + W * .012), y0 + H * .016); c.stroke(); }
      c.restore();
    }
  }
  NexoraFace.EMOTIONS = EMOTIONS; NexoraFace.POSES = POSES; NexoraFace.ACTIONS = ACTIONS; NexoraFace.VISEMES = VIS;
  NexoraFace.textToVisemes = textToVisemes; NexoraFace.EYE_STYLES = EYE_STYLES;
  NexoraFace.EMOTION_LIST = ['happiness', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'contempt'];
  NexoraFace.ACTION_GROUPS = {
    'Mouth & Jaw': ['smile', 'grin', 'beam', 'smirk', 'sneer', 'frown', 'pout', 'grimace', 'wince', 'gasp', 'sigh', 'yawn', 'purse', 'bitelip', 'clench'],
    'Eyes & Brows': ['wink', 'blink', 'squint', 'stare', 'glare', 'glower', 'eyeroll', 'raisebrow', 'furrow', 'teary', 'deadpan'],
    'Screen tint': ['blush', 'flush', 'pale']
  };
  /* map the animator's old FACE presets (used by body states) onto the new emotions */
  NexoraFace.STATE_EMOTION = {
    idle: 'neutral', listening: 'neutral', thinking: 'neutral', speaking: 'neutral', joy: 'happiness', confused: 'neutral',
    sad: 'sadness', surprised: 'surprise', sleepy: 'neutral', waking: 'surprise', error: 'anger', off: 'neutral'
  };
  NexoraFace.STATE_POSE = { listening: 'raisebrow', thinking: 'squint', confused: 'raisebrow', sleepy: 'yawn' };
  NexoraFace.default = NexoraFace;
  return NexoraFace;
});
