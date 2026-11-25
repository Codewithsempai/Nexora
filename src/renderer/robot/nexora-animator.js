/*!
 * Nexora Robot Animator  -  made by codewithsempai
 * 12 procedural animation states for the Nexora robot rig
 * (Pelvis, Torso, Head, L_/R_ Shoulder-Bicep-Forearm-Hand-Fingers, Ears, Bag).
 *
 * States: idle, listening, thinking, speaking, greeting, happy, confused,
 *         sad, surprised, sleep, wakeup, goodbye, error, offline
 *
 * Works with three.js (any recent version). UMD: window.NexoraAnimator,
 * CommonJS, or ES-import through a bundler.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoraAnimator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D = Math.PI / 180, sin = Math.sin, exp = Math.exp, abs = Math.abs, max = Math.max, pow = Math.pow;
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const ramp = (t, a, b) => sm((t - a) / (b - a));
  // keyframes: [[time, value], ...] with smooth interpolation
  function kf(t, k) {
    if (t <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i][0]) { const a = k[i - 1], b = k[i]; return a[1] + (b[1] - a[1]) * sm((t - a[0]) / (b[0] - a[0])); }
    }
    return k[k.length - 1][1];
  }

  /* ---------------- pose container ----------------
   * d[bone] = [pitch(R), yaw(U), roll(F)] in degrees, in ROBOT axes.
   * Arm/ear/shoulder values are MIRRORED: the same number on L_ and R_ gives a
   * symmetric motion (positive roll = arm lifts outward; raising an arm
   * forward is NEGATIVE pitch).
   * py = vertical body offset in world units (hop / sink).
   */
  class Pose {
    constructor() { this.d = {}; this.py = 0; }
    add(n, r, u, f, k) {
      if (k === undefined) k = 1;
      const a = this.d[n] || (this.d[n] = [0, 0, 0]);
      a[0] += (r || 0) * k; a[1] += (u || 0) * k; a[2] += (f || 0) * k; return this;
    }
    both(n, r, u, f, k) { this.add('L_' + n, r, u, f, k); this.add('R_' + n, r, u, f, k); return this; }
    clone() { const p = new Pose(); for (const n in this.d) p.d[n] = this.d[n].slice(); p.py = this.py; return p; }
  }
  const FN = ['Thumb', 'Index', 'Middle', 'Pinky'];
  function fingers(P, pref, fn, k) {
    let i = 0;
    for (const f of FN) for (const j of [1, 2]) P.add(pref + f + '_' + j, fn(i++), 0, 0, k);
  }
  function fingersBoth(P, fn, k) { fingers(P, 'L_', fn, k); fingers(P, 'R_', fn, k); }

  /* ---------------- base idle (breathing, shifts, relaxed arms) ---------------- */
  const pulse = (t, period, off, w) => { const p = ((t + off) % period + period) % period; return p < w ? pow(sin(Math.PI * p / w), 2) : 0; };
  function idlePose(t, P, k) {
    const br = sin(1.4 * t), PI = Math.PI;
    P.add('L_Ear', 0, 0, 13 * pulse(t, 6.3, 0, .5), k); P.add('R_Ear', 0, 0, 13 * pulse(t, 8.1, 2, .5), k);   // ear twitches
    P.add('Torso', -0.7 * br, 2 * sin(.45 * t + 1), 1.4 * sin(.9 * t), k);
    P.add('Pelvis', 0, -1.2 * sin(.45 * t + 1), 1.6 * sin(.45 * t), k);
    P.py += 0.004 * br * k;
    P.add('Head', 1.5 * sin(.5 * t), 9 * sin(.35 * t) + 4 * sin(.9 * t + 2), 3 * sin(.6 * t + 1) - 1.5 * sin(.9 * t), k);
    P.add('L_Ear', 0, 0, 7 * sin(1.7 * t), k); P.add('R_Ear', 0, 0, 7 * sin(1.7 * t + PI), k);
    P.both('Shoulder', 0, 0, 1 + sin(.9 * t), k);
    P.add('L_Bicep', 4 * sin(.9 * t), 0, -3 + 2 * sin(.9 * t + 1), k);
    P.add('R_Bicep', 4 * sin(.9 * t + PI), 0, -3 + 2 * sin(.9 * t + 1), k);
    P.both('Forearm', -(6 + 4 * sin(.9 * t + .8)), 0, 0, k);
    P.add('L_Hand', 4 * sin(1.2 * t), 0, 0, k); P.add('R_Hand', 4 * sin(1.2 * t + PI), 0, 0, k);
    fingersBoth(P, i => -(8 + 6 * sin(1.1 * t + i)), k);
    P.both('Thigh', 0, 0, .8 * sin(.45 * t), k);
    P.add('Bag', 4 * sin(.9 * t + 1.5), 0, 3 * sin(.6 * t), k);
  }

  /* ---------------- face presets (keys used by the Nexora face display) ---------------- */
  const FACE = {
    idle:      { h: 1,    sl: 0,  arc: 0, heart: 0, s: .55, o: 0,   mw: .10 },
    listening: { h: 1.2,  sl: 0,  arc: 0, heart: 0, s: .15, o: .05, mw: .07 },
    thinking:  { h: .7,   sl: 0,  arc: 0, heart: 0, s: 0,   o: 0,   mw: .05 },
    speaking:  { h: 1,    sl: 0,  arc: 0, heart: 0, s: .4,  o: 0,   mw: .10 },
    joy:       { h: 1,    sl: 0,  arc: 1, heart: 0, s: .9,  o: .3,  mw: .12 },
    confused:  { h: .9,   sl: 0,  arc: 0, heart: 0, s: -.25, o: .12, mw: .06 },
    sad:       { h: .85,  sl: -1, arc: 0, heart: 0, s: -.55, o: 0,  mw: .08 },
    surprised: { h: 1.4,  sl: 0,  arc: 0, heart: 0, s: 0,   o: .55, mw: .05 },
    sleepy:    { h: .1,   sl: 0,  arc: 0, heart: 0, s: .1,  o: 0,   mw: .06 },
    waking:    { h: 1.25, sl: 0,  arc: 0, heart: 0, s: .3,  o: .3,  mw: .06 },
    error:     { h: .8,   sl: 1,  arc: 0, heart: 0, s: -.5, o: .05, mw: .09 },
    off:       { h: .02,  sl: 0,  arc: 0, heart: 0, s: 0,   o: 0,   mw: .02 }
  };
  const GLOW = {
    idle: '#ffffff', listening: '#4fd1ff', thinking: '#ffd24a', speaking: '#ffffff',
    joy: '#ffe2b8', confused: '#c9a8ff', sad: '#7fa8ff', surprised: '#ffffff',
    sleepy: '#8a94a6', waking: '#ffffff', error: '#ff4d4d', off: '#8a94a6'
  };

  /* ---------------- the 12 states ----------------
   * fn(t, tl, P, c): t = global time, tl = time since state start,
   * c = {speech, userYaw, W (wave arm prefix), O (other arm prefix)}
   */
  const STATES = {
    /* 1 - Idle: breathing, small body shifts, arms relaxed */
    idle: { loop: true, idle: 1, blend: .6, face: () => 'idle',
      fn(t, tl, P, c) { c.out.gaze = [.7 * sin(.31 * t) * sin(.17 * t + 1), .35 * sin(.23 * t + 2)]; } },

    /* 2 - Listening: head turns to user, slight forward lean, mic active */
    listening: {
      loop: true, idle: .45, blend: .5, face: () => 'listening',
      fn(t, tl, P, c) {
        const e = ramp(tl, 0, .6), turn = kf(tl, [[0, 0], [.25, -10], [.9, 2]]), L = c.speech;
        P.add('Head', 6 * e + 2.5 * L, turn + c.userYaw * e, 3 * sin(1.3 * tl) * e);
        P.add('Torso', 5 * e, 0, 0); P.add('Pelvis', 2 * e, 0, 0);
        P.both('Ear', 0, 0, (10 + 10 * L) * e + 3 * sin(6 * tl) * e);
        P.both('Bicep', -10 * e, 0, -10 * e); P.both('Forearm', -25 * e, 0, -15 * e);
        fingersBoth(P, () => 4 * e);
        c.out.gaze = [(c.userYaw / 30) * e, 0];
      }
    },

    /* 3 - Thinking: head tilt, subtle hand movement (hand in front of chest, fingers tap) */
    thinking: {
      loop: true, idle: .35, blend: .55, face: () => 'thinking',
      fn(t, tl, P, c) {
        const e = ramp(tl, 0, .7), W = c.W, O = c.O;
        P.add('Head', -4 * e, -8 * e + 3 * sin(.8 * tl) * e, 10 * e + 2 * sin(1.1 * tl) * e);
        P.add('Torso', 0, -3 * e, -2 * e);
        P.add(W + 'Bicep', -60 * e, 0, -10 * e);
        P.add(W + 'Forearm', -30 * e, 0, -80 * e);
        P.add(W + 'Hand', -8 * e + 6 * sin(2.2 * tl) * e, 0, 0);
        fingers(P, W, i => (-10 + 10 * sin(7 * tl + i)) * e);   // soft finger tapping
        P.add(O + 'Bicep', -8 * e, 0, -8 * e); P.add(O + 'Forearm', -12 * e, 0, -8 * e);
        P.add(O + 'Ear', 0, 0, -10 * e);
        c.out.gaze = [(-.6 + .3 * sin(.6 * tl)) * e, .55 * e];   // eyes drift up and away
      }
    },

    /* 4 - Speaking: head motion, hand gestures, slight body movement (scales with voice level) */
    speaking: {
      loop: true, idle: .5, blend: .4, face: () => 'speaking',
      fn(t, tl, P, c) {
        const L = c.speech, m = .6 + .9 * L, e = ramp(tl, 0, .4);
        P.add('Head', (3 * sin(2.6 * tl) * m + 2 + 4 * L * sin(5.3 * tl)) * e, (6 * sin(1.7 * tl) * m + 3 * sin(3.3 * tl)) * e, 3 * sin(1.3 * tl + 1) * m * e);
        P.add('Torso', (1.5 * sin(2 * tl) + 1.5) * e, 2.5 * sin(1.1 * tl + .5) * e, 0);
        const g = (.4 + 1.0 * L) * e, ga = pow(max(0, sin(1.6 * tl)), 2) * g, gb = pow(max(0, sin(1.6 * tl + 2.4)), 2) * g;
        P.add('L_Bicep', -24 * ga, 0, 14 * ga); P.add('R_Bicep', -24 * gb, 0, 14 * gb);
        P.add('L_Forearm', -32 * ga, 0, -6 * ga); P.add('R_Forearm', -32 * gb, 0, -6 * gb);
        P.add('L_Hand', 12 * sin(5 * tl) * ga, 0, 0); P.add('R_Hand', 12 * sin(5 * tl) * gb, 0, 0);
        fingers(P, 'L_', () => 10 * ga); fingers(P, 'R_', () => 10 * gb);
        P.both('Ear', 0, 0, (4 + 8 * L) * sin(3 * tl) * e);
        P.py += .012 * L * abs(sin(4 * tl)) * e;
        c.out.gaze = [.15 * sin(.7 * tl), .1];
      }
    },

    /* 5 - Greeting: raises hand and waves (hand stays beside the big head, clear of it) */
    greeting: {
      dur: 3.0, next: 'idle', idle: .5, blend: .35, face: () => 'joy',
      fn(t, tl, P, c) {
        const ub = kf(tl, [[0, 0], [.35, 1.12], [.6, 1], [2.3, 1], [2.9, 0]]),
              uf = kf(tl, [[0, 0], [.15, 0], [.55, 1.1], [.8, 1], [2.2, 1], [2.7, 0]]),
              wv = ramp(tl, .6, .85) * (1 - ramp(tl, 2.1, 2.4)), W = c.W;
        P.add(W + 'Shoulder', 0, 0, 6 * ub);
        P.add(W + 'Bicep', 0, 0, 36 * ub);
        P.add(W + 'Forearm', 0, 0, 62 * uf + 14 * sin(tl * 11) * wv);
        P.add(W + 'Hand', 0, 0, 8 * sin(tl * 11 + .8) * wv);
        fingers(P, W, () => 14 * uf);
        P.add('Head', -2 * ub, 0, 6 * ub); P.add('Torso', 0, 0, 0);
        P.both('Ear', 0, 0, 12 * ub);
        c.out.gaze = [0, .1];
      }
    },

    /* 6 - Happy: bouncy motion, open arms */
    happy: {
      dur: 3.6, next: 'idle', idle: .4, blend: .35, face: () => 'joy',
      fn(t, tl, P, c) {
        const e = ramp(tl, 0, .3) * (1 - ramp(tl, 3.1, 3.6)), b = abs(sin(tl * 6.5)), sw = sin(tl * 3.25);
        P.py += .07 * b * e;
        P.add('Pelvis', 0, 0, 3 * sw, e);
        P.add('Torso', -3, 0, 4 * sin(tl * 3.25 + .5), e);
        P.add('Head', -5 + 3 * sin(tl * 6.5), 0, 7 * sw, e);
        P.both('Shoulder', 0, 0, 6, e);
        P.both('Bicep', -8, 0, 46 + 8 * sin(tl * 6.5), e);
        P.both('Forearm', -10, 0, 20, e);
        fingersBoth(P, () => 14, e);
        P.both('Ear', 0, 0, 14 * sin(tl * 13), e);
        c.out.gaze = [0, .25 * e];
      }
    },

    /* 7 - Confused: head tilts sideways, shoulders shift, palm-up shrug */
    confused: {
      dur: 3.2, next: 'idle', idle: .4, blend: .35, face: () => 'confused',
      fn(t, tl, P, c) {
        const e = ramp(tl, 0, .4) * (1 - ramp(tl, 2.7, 3.2)), W = c.W;
        P.add('Head', -3, 8 * sin(tl * 2.2), 15 + 3 * sin(tl * 3), e);
        P.add('Torso', 0, 3 * sin(tl * 2.2), -4, e);
        P.add('L_Shoulder', 0, 0, 10, e); P.add('R_Shoulder', 0, 0, 3, e);   // uneven shrug
        P.add(W + 'Bicep', -30, 0, -10, e); P.add(W + 'Forearm', -70, 0, -30, e);
        P.add(W + 'Hand', -12 + 8 * sin(tl * 4), 0, 0, e);
        fingers(P, W, () => 10, e);
        P.add('L_Ear', 0, 0, 14, e); P.add('R_Ear', 0, 0, -8, e);
        c.out.gaze = [.5 * sin(tl * 2.2) * e, .15 * e];
      }
    },

    /* 8 - Sad: head lowers, body relaxes */
    sad: {
      dur: 4.2, next: 'idle', idle: .25, blend: .6, face: () => 'sad',
      fn(t, tl, P, c) {
        const e = ramp(tl, 0, .9) * (1 - ramp(tl, 3.4, 4.2));
        P.add('Head', 22, 3 * sin(.7 * tl), 3, e);
        P.add('Torso', 8 + 2.5 * sin(tl * .9), 0, 0, e);
        P.add('Pelvis', 3, 0, 0, e); P.py += -.018 * e;
        P.both('Shoulder', 0, 0, -7, e); P.both('Bicep', 5, 0, -6, e);
        P.both('Forearm', 6, 0, 0, e); P.both('Hand', 6, 0, 0, e);
        P.both('Ear', 0, 0, -22, e);
        c.out.gaze = [0, -.6 * e];
      }
    },

    /* 9 - Surprised: head snaps upward, arms react */
    surprised: {
      dur: 2.6, next: 'idle', idle: .3, blend: .12, face: () => 'surprised',
      fn(t, tl, P, c) {
        const fade = 1 - ramp(tl, 2.1, 2.6);
        const e = (tl < .1 ? tl / .1 : .4 + .6 * exp(-(tl - .1) * 4.5)) * fade;
        const hop = (tl < .1 ? tl / .1 : exp(-(tl - .1) * 7)) * fade;
        P.py += .08 * hop;
        P.add('Head', -14, 3 * sin(40 * tl) * exp(-tl * 5), 0, e);
        P.add('Torso', -9, 0, 0, e); P.add('Pelvis', -3, 0, 0, e);
        P.both('Shoulder', 0, 0, 8, e);
        P.both('Bicep', -10, 0, 30, e); P.both('Forearm', -18, 0, 10, e); P.both('Hand', -8, 0, 0, e);
        fingersBoth(P, () => 16, e);
        P.both('Ear', 0, 0, 26 + 6 * sin(30 * tl) * exp(-tl * 3), e);
        c.out.gaze = [0, .3 * e];
      }
    },

    /* 10 - Sleep: head drops, movement slows */
    sleep: {
      loop: true, idle: .12, idleSpeed: .35, blend: 1.2, face: () => 'sleepy',
      fn(t, tl, P) {
        const e = ramp(tl, 0, 1.6);
        P.add('Head', 26 + 1.5 * sin(.45 * t), 0, 6, e);
        P.add('Torso', 10 + 1.2 * sin(.6 * t), 0, 0, e);
        P.add('Pelvis', 3, 0, 0, e); P.py += -.012 * e;
        P.both('Shoulder', 0, 0, -6, e); P.both('Bicep', 0, 0, -6, e); P.both('Forearm', 7, 0, 0, e);
        P.both('Ear', 0, 0, -18, e);
      }
    },

    /* 11 - Wake-up ("Hey NEXORA"): body activates, head lifts, arms return */
    wakeup: {
      dur: 2.4, next: 'idle', idle: 0, blend: .25,
      events: [[0, 'screenOn'], [.5, 'boot']],
      face: tl => (tl < .6 ? 'sleepy' : tl < 1.2 ? 'waking' : 'idle'),
      fn(t, tl, P, c) {
        P.add('Head', kf(tl, [[0, 26], [.45, 26], [.7, 24], [1.15, -9], [1.6, 3], [2.4, 0]]), 0,
          kf(tl, [[0, 6], [.6, 6], [1.2, -3], [1.8, 0]]));
        P.add('Torso', kf(tl, [[0, 10], [.4, 12], [.9, -6], [1.5, 1], [2.4, 0]]), 0, 0);
        P.py += kf(tl, [[0, -.012], [.8, -.012], [1.1, .05], [1.6, 0]]);
        P.both('Shoulder', 0, 0, kf(tl, [[0, -6], [.7, -6], [1.1, 10], [1.8, 2], [2.4, 0]]));
        P.both('Bicep', kf(tl, [[0, 0], [.7, 0], [1.15, -8], [2.4, 0]]), 0, kf(tl, [[0, -6], [.7, -6], [1.15, 34], [1.8, 4], [2.4, 0]]));
        P.both('Forearm', kf(tl, [[0, 7], [.7, 7], [1.1, -14], [2, 0]]), 0, 0);
        P.both('Ear', 0, 0, kf(tl, [[0, -18], [.6, -18], [.95, 28], [1.3, 6], [2.4, 0]]));
        fingersBoth(P, () => kf(tl, [[0, 0], [1, 0], [1.2, 14], [2, 0]]));
        idlePose(t, P, ramp(tl, 1.0, 2.2));       // normal idle fades back in
        c.out.gaze = [0, kf(tl, [[0, -.6], [1, -.6], [1.3, .3], [2, 0]])];
      }
    },

    /* 12 - Goodbye: waves, small bow, returns to idle (shutdown) */
    goodbye: {
      dur: 3.9, next: 'idle', idle: .5, blend: .35,
      face: tl => (tl < 2.8 ? 'joy' : 'idle'),
      fn(t, tl, P, c) {
        const ub = kf(tl, [[0, 0], [.35, 1.12], [.6, 1], [2.7, 1], [3.4, 0]]),
              uf = kf(tl, [[0, 0], [.15, 0], [.55, 1.1], [.8, 1], [2.6, 1], [3.2, 0]]),
              wv = ramp(tl, .6, .85) * (1 - ramp(tl, 2.5, 2.9)), W = c.W;
        P.add(W + 'Shoulder', 0, 0, 6 * ub);
        P.add(W + 'Bicep', 0, 0, 36 * ub);
        P.add(W + 'Forearm', 0, 0, 62 * uf + 14 * sin(tl * 9.5) * wv);
        P.add(W + 'Hand', 0, 0, 8 * sin(tl * 9.5 + .8) * wv);
        fingers(P, W, () => 14 * uf);
        P.add('Head', kf(tl, [[0, 0], [2.9, 0], [3.2, 10], [3.7, 0]]), 0, 6 * ub);
        P.add('Torso', kf(tl, [[0, 0], [2.9, 0], [3.2, 4], [3.7, 0]]), 0, 0);
        P.both('Ear', 0, 0, 12 * ub);
        c.out.gaze = [0, kf(tl, [[0, .1], [2.9, .1], [3.2, -.4], [3.7, 0]])];
      }
    },

    /* 13 - Error: head shakes "no", jolt, ears flick, red glitch */
    error: {
      dur: 3.4, next: 'idle', idle: .25, blend: .1,
      events: [[0, 'glitch'], [.45, 'glitch'], [1.3, 'glitch']],
      face: tl => (tl < 2.6 ? 'error' : 'idle'),
      fn(t, tl, P, c) {
        const e = ramp(tl, 0, .15) * (1 - ramp(tl, 2.7, 3.4)), d = exp(-tl * 1.1);
        P.add('Head', 6 * e, 16 * sin(tl * 14) * d, 3 * sin(tl * 7) * d);
        P.add('Torso', -7 * exp(-tl * 5) + 2 * e, 3 * sin(tl * 14 + .6) * d, 0);
        P.py += .03 * exp(-tl * 6);
        P.both('Shoulder', 0, 0, 6 * e);
        P.both('Bicep', -6 * e, 0, 16 * e); P.both('Forearm', -28 * e, 0, 10 * e);   // "ugh" hands
        P.both('Hand', -8 * e + 8 * sin(tl * 16) * d, 0, 0);
        P.both('Ear', 0, 0, 20 * sin(tl * 20) * exp(-tl * 2.5) + 10 * e);
        c.out.gaze = [sin(tl * 14) * d * .5, -.1];
      }
    },

    /* 14 - Offline: powers down - head and arms drop, screen fades to black */
    offline: {
      loop: true, idle: 0, blend: 1.4,
      events: [[1.4, 'screenOff']],
      face: tl => (tl < 1.4 ? 'sleepy' : 'off'),
      fn(t, tl, P) {
        const e = ramp(tl, 0, 1.4);
        P.add('Head', 30, 0, 4, e); P.add('Torso', 12, 0, 0, e); P.add('Pelvis', 4, 0, 0, e); P.py += -.02 * e;
        P.both('Shoulder', 0, 0, -8, e); P.both('Bicep', 4, 0, -10, e); P.both('Forearm', 8, 0, 0, e); P.both('Hand', 8, 0, 0, e);
        P.both('Ear', 0, 0, -24, e);
      }
    }
  };
  const LIST = ['idle', 'listening', 'thinking', 'speaking', 'greeting', 'happy', 'confused', 'sad', 'surprised', 'sleep', 'wakeup', 'goodbye', 'error', 'offline'];
  /* names used by the Nexora UI state bar */
  const UI_STATES = { Idle: 'idle', Listen: 'listening', Think: 'thinking', Speak: 'speaking', Wake: 'wakeup', Error: 'error', Offline: 'offline' };

  const ctxDefaults = (c, wave) => {
    const w = (c && c.W) || wave || 'R_';
    return Object.assign({ speech: 0, userYaw: 0, amp: 1, out: {} }, c || {}, { W: w, O: w === 'R_' ? 'L_' : 'R_' });
  };

  /* pure function: pose for a state at a time (no three.js needed - handy for tests / export) */
  function samplePose(state, tl, t, ctx) {
    const st = STATES[state], c = ctxDefaults(ctx), P = new Pose();
    const w = typeof st.idle === 'function' ? st.idle(tl) : st.idle;
    if (w) idlePose(t * (st.idleSpeed || 1), P, w);
    st.fn(t, tl, P, c);
    return P;
  }

  /* ---------------- the animator ---------------- */
  class NexoraAnimator {
    /**
     * @param THREE  the three.js namespace
     * @param bones  { boneName: THREE.Bone }  (from fbx.traverse)
     * @param AX     { F, U, R } robot forward / up / right unit vectors in WORLD space (R = U x F)
     * @param opts   { amp, wave:'R_'|'L_', goodbyeNext, armSideSign, armPitchSign, tiltSign, onFace, onState }
     */
    constructor(THREE, bones, AX, opts) {
      this.T = THREE; this.AX = AX; this.bones = bones;
      this.o = Object.assign({ amp: 1, wave: 'R_', goodbyeNext: 'idle', armSideSign: 1, armPitchSign: 1, tiltSign: 1, onFace: null, onState: null, onEvent: null }, opts || {});
      this._Q = new THREE.Quaternion(); this._qd = new THREE.Quaternion();
      const V3 = () => new THREE.Vector3();
      const pel = bones.Pelvis.getWorldPosition(V3());
      this.rig = [];
      for (const nm in bones) {
        if (/_end$/.test(nm) || nm === 'Armature' || nm === 'Controller') continue;
        const b = bones[nm]; if (!b.parent) continue;
        const pq = b.parent.getWorldQuaternion(new THREE.Quaternion());
        const side = /^[LR]_/.test(nm) ? (Math.sign(b.getWorldPosition(V3()).sub(pel).dot(AX.R)) || 1) : 0;
        this.rig.push({ b, name: nm, side, arm: /(Shoulder|Bicep|Forearm|Hand)$/.test(nm), pq, pi: pq.clone().invert(), rq: b.quaternion.clone() });
      }
      this.pelRestW = pel.clone(); this.pelRestL = bones.Pelvis.position.clone();
      this.state = 'idle'; this.tl = 0; this.bt = 99; this.blend = STATES.idle.blend;
      this.last = new Pose(); this.snap = new Pose(); this.faceName = null; this.out = { mic: 0, gaze: [0, 0] }; this._ev = 0;
    }
    get states() { return LIST.slice(); }
    /** switch by the Nexora UI label: 'Idle' | 'Listen' | 'Think' | 'Speak' | 'Wake' | 'Error' | 'Offline' */
    setUIState(label) { const n = UI_STATES[label] || label; this.setState(n, true); }
    setState(name, force) {
      if (!STATES[name]) throw new Error('Unknown state: ' + name);
      if (name === this.state && STATES[name].loop && !force) return;
      this.snap = this.last.clone(); this.bt = 0; this.tl = 0;
      this.state = name; this.blend = STATES[name].blend || .4; this.faceName = null; this._ev = 0;
      if (this.o.onState) this.o.onState(name);
    }
    /** call every frame. ctx: { speech 0..1 (voice level), userYaw (deg), amp } */
    update(dt, t, ctx) {
      const c = ctxDefaults(ctx, this.o.wave);
      this.tl += dt; this.bt += dt;
      let st = STATES[this.state];
      if (st.dur && this.tl >= st.dur) this.setState(this.state === 'goodbye' ? this.o.goodbyeNext : (st.next || 'idle'));
      st = STATES[this.state];
      this.out.gaze = [0, 0]; c.out = this.out;
      const P = samplePose(this.state, this.tl, t, c);
      this.out.mic = this.state === 'listening' ? .5 + .5 * sin(this.tl * 5) : 0;   // pulse for a mic indicator
      const evs = st.events;
      while (evs && this._ev < evs.length && this.tl >= evs[this._ev][0]) { const n = evs[this._ev++][1]; if (this.o.onEvent) this.o.onEvent(n); }
      const w = ramp(this.bt, 0, this.blend), out = new Pose(), Z = [0, 0, 0];
      const names = Object.keys(P.d).concat(Object.keys(this.snap.d));
      for (const n of names) {
        if (out.d[n]) continue;
        const a = this.snap.d[n] || Z, b = P.d[n] || Z;
        out.d[n] = [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
      }
      out.py = this.snap.py + (P.py - this.snap.py) * w;
      this.last = out;
      this._apply(out, c.amp * this.o.amp);
      const fn = st.face ? st.face(this.tl) : null;
      if (fn && fn !== this.faceName) { this.faceName = fn; if (this.o.onFace) this.o.onFace(fn, FACE[fn], GLOW[fn]); }
    }
    _apply(p, amp) {
      const { R, U, F } = this.AX, Q = this._Q, qd = this._qd, o = this.o;
      for (const e of this.rig) {
        const a = p.d[e.name]; let r = a ? a[0] : 0, u = a ? a[1] : 0, f = a ? a[2] : 0;
        if (e.arm) { r *= o.armPitchSign; u *= o.armSideSign; f *= o.armSideSign; }
        if (e.side) { u *= e.side; f *= e.side; }
        if (e.name === 'Head') f *= o.tiltSign;
        qd.identity();
        if (r) { Q.setFromAxisAngle(R, r * amp * D); qd.multiply(Q); }
        if (u) { Q.setFromAxisAngle(U, u * amp * D); qd.multiply(Q); }
        if (f) { Q.setFromAxisAngle(F, f * amp * D); qd.multiply(Q); }
        e.b.quaternion.copy(e.pi).multiply(qd).multiply(e.pq).multiply(e.rq);
      }
      const pb = this.bones.Pelvis;
      if (abs(p.py) > 1e-6) {
        const wp = this.pelRestW.clone().addScaledVector(U, p.py * amp);
        pb.position.copy(pb.parent.worldToLocal(wp));
      } else pb.position.copy(this.pelRestL);
    }
    /** helper: build the {F,U,R} axes from the robot's world forward direction */
    static axesFromForward(THREE, forward) {
      const F = new THREE.Vector3(forward.x, 0, forward.z).normalize(), U = new THREE.Vector3(0, 1, 0);
      return { F, U, R: U.clone().cross(F) };
    }
  }
  NexoraAnimator.UI_STATES = UI_STATES; NexoraAnimator.STATES = STATES; NexoraAnimator.STATE_LIST = LIST; NexoraAnimator.FACE = FACE; NexoraAnimator.GLOW = GLOW;
  NexoraAnimator.samplePose = samplePose; NexoraAnimator.Pose = Pose;
  NexoraAnimator.default = NexoraAnimator;
  return NexoraAnimator;
});
