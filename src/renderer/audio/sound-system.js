/* ==========================================================================
   NEXORA — Procedural Sound Effect System
   Synthesizes custom acoustic soundscapes via Web Audio API.
   Subtle, futuristic, crystalline, and non-intrusive.
   ========================================================================== */

export class SoundSystem {
  constructor(config = {}) {
    this.audioCtx = null;
    this.enabled = config.enabled ?? true;
    this.masterVolume = config.masterVolume ?? 0.75;
    this.perEffect = config.perEffect || {
      startup: true,
      wake: true,
      listening: true,
      thinking: true,
      response: true,
      panel: true,
      mode: true,
      error: true,
    };

    this.masterGainNode = null;
    this.lastPlayTimes = new Map();
    this.minIntervalMs = 60; // Debounce overlapping effects
  }

  ensureContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('[NEXORA Audio] Web Audio API unavailable');
        return false;
      }
      this.audioCtx = new AudioContextClass();
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.audioCtx.currentTime);
      this.masterGainNode.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return true;
  }

  setMasterVolume(val) {
    this.masterVolume = Math.max(0, Math.min(1, val));
    if (this.masterGainNode && this.audioCtx) {
      this.masterGainNode.gain.setTargetAtTime(this.masterVolume, this.audioCtx.currentTime, 0.05);
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  setEffectEnabled(effectName, val) {
    this.perEffect[effectName] = !!val;
  }

  canPlay(effectName, flag = effectName) {
    if (!this.enabled) return false;
    if (this.perEffect[flag] === false) return false;

    const now = performance.now();
    const last = this.lastPlayTimes.get(effectName) || 0;
    if (now - last < this.minIntervalMs) return false;

    this.lastPlayTimes.set(effectName, now);
    return this.ensureContext();
  }

  // --- 1. Application Startup (Crystalline Major 7th harmonic flourish) ---
  playStartup() {
    if (!this.canPlay('startup')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime + 0.02;

    const freqs = [440, 554.37, 659.25, 830.61]; // A4, C#5, E5, G#5
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + idx * 0.05);

      gain.gain.setValueAtTime(0, t + idx * 0.05);
      gain.gain.linearRampToValueAtTime(0.18, t + idx * 0.05 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.65);

      osc.connect(gain);
      gain.connect(this.masterGainNode);

      osc.start(t + idx * 0.05);
      osc.stop(t + idx * 0.05 + 0.7);
    });
  }

  // --- 2. Wake Activation (Ascending harmonic energy elevation) ---
  playWake() {
    if (!this.canPlay('wake')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.24);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  // --- 3. Listening Chime (Discrete double acoustic tick) ---
  playListening() {
    if (!this.canPlay('listening')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    [784, 1046.5].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.07);

      gain.gain.setValueAtTime(0, t + i * 0.07);
      gain.gain.linearRampToValueAtTime(0.15, t + i * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.18);

      osc.connect(gain);
      gain.connect(this.masterGainNode);

      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.2);
    });
  }

  // --- 4. Thinking (three quick soft staccato ticks) ---
  playThinking() {
    if (!this.canPlay('thinking')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    [0, 0.09, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(330 + i * 55, t + offset);
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.12, t + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGainNode);
      osc.start(t + offset);
      osc.stop(t + offset + 0.08);
    });
  }

  // --- Speaking (bright rising three-note shimmer) ---
  playSpeaking() {
    if (!this.canPlay('speaking', 'response')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    [523.25, 659.25, 987.77].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.055);
      gain.gain.setValueAtTime(0, t + i * 0.055);
      gain.gain.linearRampToValueAtTime(0.13, t + i * 0.055 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.055 + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGainNode);
      osc.start(t + i * 0.055);
      osc.stop(t + i * 0.055 + 0.24);
    });
  }

  // --- Idle / standby (soft low two-note settle) ---
  playIdle() {
    if (!this.canPlay('idle', 'mode')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    [392, 293.66].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.12);
      gain.gain.setValueAtTime(0, t + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.1, t + i * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(this.masterGainNode);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.32);
    });
  }

  // --- 5. Assistant Response (Crisp futuristic glass pop) ---
  playResponse() {
    if (!this.canPlay('response')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1174.66, t); // D6
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.16);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    osc.start(t);
    osc.stop(t + 0.26);
  }

  // --- 6. Panel Open (Smooth filtered air slide) ---
  playPanelOpen() {
    if (!this.canPlay('panel')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.14);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    osc.start(t);
    osc.stop(t + 0.18);
  }

  // --- 7. Panel Close (Gentle downward descent) ---
  playPanelClose() {
    if (!this.canPlay('panel')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.12);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    osc.start(t);
    osc.stop(t + 0.16);
  }

  // --- 8. Mode Switch (Subtle tactile pitch click) ---
  playModeSwitch() {
    if (!this.canPlay('mode')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.linearRampToValueAtTime(740, t + 0.06);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    osc.start(t);
    osc.stop(t + 0.09);
  }

  // --- 9. Error (two low buzzy descending beeps) ---
  playError() {
    if (!this.canPlay('error')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;
    [0, 0.16].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(i ? 190 : 260, t + offset);
      osc.frequency.linearRampToValueAtTime(i ? 140 : 200, t + offset + 0.12);
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.13, t + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.14);
      osc.connect(gain);
      gain.connect(this.masterGainNode);
      osc.start(t + offset);
      osc.stop(t + offset + 0.15);
    });
  }

  // --- 10. Offline (Slow graceful frequency descent) ---
  playOffline() {
    if (!this.canPlay('mode')) return;
    const ctx = this.audioCtx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.35);

    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    osc.start(t);
    osc.stop(t + 0.42);
  }
  playOrbIdentity(identity) {
    if (!this.enabled || !this.ensureContext()) return;
    const ctx = this.audioCtx, t = ctx.currentTime;
    const sequences = {
      nexora: [660, 990, 1320],
      nexo: [440, 880, 1175, 1760],
      nexie: [523, 784, 1046, 1568],
      robot: [392, 784, 1175, 1568, 2093]
    };
    const notes = sequences[identity] || sequences.nexora;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = identity === 'nexo' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t + i * 0.055);
      gain.gain.setValueAtTime(0.0001, t + i * 0.055);
      gain.gain.linearRampToValueAtTime(0.09, t + i * 0.055 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.055 + 0.13);
      osc.connect(gain); gain.connect(this.masterGainNode);
      osc.start(t + i * 0.055); osc.stop(t + i * 0.055 + 0.14);
    });
  }

}
