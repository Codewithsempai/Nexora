/* ==========================================================================
   NEXORA — Procedural Sound Effect System
   Synthesizes custom acoustic soundscapes via an isolated Web Audio playback bus.
   Provides per-effect volume, conservative defaults, gain smoothing, overlap
   prevention, and peak limiting so SFX never clip or affect other apps.
   ========================================================================== */

import { getSharedPlaybackBus, clamp01 } from './playback-bus.js';

export const SFX_CATEGORIES = ['startup', 'wake', 'listening', 'thinking', 'response', 'panel', 'mode', 'error'];

const DEFAULT_SFX_VOLUMES = {
  startup: 0.65,
  wake: 0.75,
  listening: 0.70,
  thinking: 0.55,
  response: 0.70,
  panel: 0.55,
  mode: 0.60,
  error: 0.70,
};

export class SoundSystem {
  constructor(config = {}) {
    this.playbackBus = config.playbackBus || getSharedPlaybackBus();
    this.audioCtx = null;
    this.enabled = config.enabled ?? true;
    this.masterVolume = clamp01(config.masterVolume ?? 0.55, 0.55);
    if (config.outputProfile) this.playbackBus.setOutputProfile(config.outputProfile);
    this.perEffect = {
      startup: true,
      wake: true,
      listening: true,
      thinking: true,
      response: true,
      panel: true,
      mode: true,
      error: true,
      ...(config.perEffect || {}),
    };
    this.sfxVolumes = { ...DEFAULT_SFX_VOLUMES, ...(config.sfxVolumes || {}) };

    this.masterGainNode = null;
    this.lastPlayTimes = new Map();
    this.activeVoices = new Set();
    this.maxConcurrentEffects = 3;
    this.minIntervalMs = 140;
  }

  ensureContext() {
    const ctx = this.playbackBus.ensureContext();
    if (!ctx) return false;
    if (this.audioCtx !== ctx || !this.masterGainNode) {
      this.audioCtx = ctx;
      this.masterGainNode = ctx.createGain();
      const now = ctx.currentTime || 0;
      if (typeof this.masterGainNode.gain.setValueAtTime === 'function') {
        this.masterGainNode.gain.setValueAtTime(this.masterVolume, now);
      } else {
        this.masterGainNode.gain.value = this.masterVolume;
      }
      const dest = this.playbackBus.getDestinationNode() || ctx.destination;
      this.masterGainNode.connect(dest);
    }
    return true;
  }

  resumeIfReady() {
    this.playbackBus.resumeIfInitialized();
  }

  setOutputProfile(profile) {
    return this.playbackBus.setOutputProfile(profile);
  }

  setMasterVolume(val) {
    this.masterVolume = clamp01(val, this.masterVolume);
    if (this.masterGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime || 0;
      if (typeof this.masterGainNode.gain.setTargetAtTime === 'function') {
        this.masterGainNode.gain.setTargetAtTime(this.masterVolume, now, 0.03);
      } else {
        this.masterGainNode.gain.value = this.masterVolume;
      }
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  setEffectEnabled(effectName, val) {
    this.perEffect[effectName] = !!val;
  }

  setEffectVolume(category, val) {
    if (!SFX_CATEGORIES.includes(category)) return false;
    this.sfxVolumes[category] = clamp01(val, DEFAULT_SFX_VOLUMES[category] ?? 0.65);
    return true;
  }

  getEffectVolume(category) {
    return clamp01(this.sfxVolumes[category], DEFAULT_SFX_VOLUMES[category] ?? 0.65);
  }

  applyConfig(audioCfg = {}) {
    if (!audioCfg || typeof audioCfg !== 'object') return;
    if (typeof audioCfg.enabled === 'boolean') this.setEnabled(audioCfg.enabled);
    if (audioCfg.masterVolume != null) this.setMasterVolume(audioCfg.masterVolume);
    if (audioCfg.outputProfile) this.setOutputProfile(audioCfg.outputProfile);
    if (audioCfg.soundEffects && typeof audioCfg.soundEffects === 'object') {
      for (const [key, val] of Object.entries(audioCfg.soundEffects)) {
        this.setEffectEnabled(key, val);
      }
    }
    if (audioCfg.sfxVolumes && typeof audioCfg.sfxVolumes === 'object') {
      for (const [key, val] of Object.entries(audioCfg.sfxVolumes)) {
        this.setEffectVolume(key, val);
      }
    }
  }

  canPlay(effectName, flag = effectName) {
    if (!this.enabled) return false;
    if (this.perEffect[flag] === false) return false;
    if (this.getEffectVolume(flag) <= 0.001 || this.masterVolume <= 0.001) return false;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = this.lastPlayTimes.get(effectName) || 0;
    const minWait = ['listening', 'thinking', 'speaking', 'idle', 'panelOpen', 'panelClose'].includes(effectName)
      ? 200
      : this.minIntervalMs;
    if (now - last < minWait) return false;

    this.lastPlayTimes.set(effectName, now);
    return this.ensureContext();
  }

  /** Tracks active synth voices and smoothly trims excess concurrent tones to prevent clipping/overlap spikes. */
  scheduleTone({ type = 'sine', category = 'mode', freqStart, freqEnd = null, startAt, duration, peakGain = 0.14, attack = 0.02, linearFreq = false }) {
    const ctx = this.audioCtx;
    if (!ctx || !this.masterGainNode) return;
    while (this.activeVoices.size >= this.maxConcurrentEffects * 3) {
      const oldest = this.activeVoices.values().next().value;
      if (!oldest) break;
      this.activeVoices.delete(oldest);
      try { oldest.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01); } catch {}
      try { oldest.osc.stop(ctx.currentTime + 0.025); } catch {}
    }

    const scale = this.getEffectVolume(category);
    const safePeak = Math.max(0.0002, Math.min(0.24, peakGain * scale));
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startAt);
    if (freqEnd && freqEnd !== freqStart) {
      if (linearFreq) osc.frequency.linearRampToValueAtTime(freqEnd, startAt + Math.max(0.02, duration * 0.85));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startAt + Math.max(0.02, duration * 0.85));
    }

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(safePeak, startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(gain);
    gain.connect(this.masterGainNode);

    const entry = { osc, gain };
    this.activeVoices.add(entry);
    osc.onended = () => {
      this.activeVoices.delete(entry);
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  // --- 1. Application Startup (Crystalline Major 7th harmonic flourish) ---
  playStartup() {
    if (!this.canPlay('startup')) return;
    const t = this.audioCtx.currentTime + 0.02;
    [440, 554.37, 659.25, 830.61].forEach((f, idx) => {
      this.scheduleTone({
        type: 'sine',
        category: 'startup',
        freqStart: f,
        startAt: t + idx * 0.05,
        duration: 0.65,
        attack: 0.04,
        peakGain: 0.14,
      });
    });
  }

  // --- 2. Wake Activation (Ascending harmonic energy elevation) ---
  playWake() {
    if (!this.canPlay('wake')) return;
    const t = this.audioCtx.currentTime;
    this.scheduleTone({
      type: 'triangle',
      category: 'wake',
      freqStart: 320,
      freqEnd: 880,
      startAt: t,
      duration: 0.32,
      attack: 0.05,
      peakGain: 0.18,
    });
  }

  // --- 3. Listening Chime (Discrete double acoustic tick) ---
  playListening() {
    if (!this.canPlay('listening')) return;
    const t = this.audioCtx.currentTime;
    [784, 1046.5].forEach((f, i) => {
      this.scheduleTone({
        type: 'sine',
        category: 'listening',
        freqStart: f,
        startAt: t + i * 0.07,
        duration: 0.18,
        attack: 0.02,
        peakGain: 0.13,
      });
    });
  }

  // --- 4. Thinking (three quick soft staccato ticks) ---
  playThinking() {
    if (!this.canPlay('thinking')) return;
    const t = this.audioCtx.currentTime;
    [0, 0.09, 0.18].forEach((offset, i) => {
      this.scheduleTone({
        type: 'triangle',
        category: 'thinking',
        freqStart: 330 + i * 55,
        startAt: t + offset,
        duration: 0.07,
        attack: 0.008,
        peakGain: 0.10,
      });
    });
  }

  // --- Speaking (bright rising three-note shimmer) ---
  playSpeaking() {
    if (!this.canPlay('speaking', 'response')) return;
    const t = this.audioCtx.currentTime;
    [523.25, 659.25, 987.77].forEach((f, i) => {
      this.scheduleTone({
        type: 'triangle',
        category: 'response',
        freqStart: f,
        startAt: t + i * 0.055,
        duration: 0.22,
        attack: 0.012,
        peakGain: 0.11,
      });
    });
  }

  // --- Idle / standby (soft low two-note settle) ---
  playIdle() {
    if (!this.canPlay('idle', 'mode')) return;
    const t = this.audioCtx.currentTime;
    [392, 293.66].forEach((f, i) => {
      this.scheduleTone({
        type: 'sine',
        category: 'mode',
        freqStart: f,
        startAt: t + i * 0.12,
        duration: 0.30,
        attack: 0.03,
        peakGain: 0.09,
      });
    });
  }

  // --- 5. Assistant Response (Crisp futuristic glass pop) ---
  playResponse() {
    if (!this.canPlay('response')) return;
    this.scheduleTone({
      type: 'sine',
      category: 'response',
      freqStart: 1174.66,
      freqEnd: 880,
      startAt: this.audioCtx.currentTime,
      duration: 0.24,
      attack: 0.02,
      peakGain: 0.13,
    });
  }

  // --- 6. Panel Open (Smooth filtered air slide) ---
  playPanelOpen() {
    if (!this.canPlay('panelOpen', 'panel')) return;
    this.scheduleTone({
      type: 'sine',
      category: 'panel',
      freqStart: 260,
      freqEnd: 520,
      startAt: this.audioCtx.currentTime,
      duration: 0.16,
      attack: 0.03,
      peakGain: 0.09,
    });
  }

  // --- 7. Panel Close (Gentle downward descent) ---
  playPanelClose() {
    if (!this.canPlay('panelClose', 'panel')) return;
    this.scheduleTone({
      type: 'sine',
      category: 'panel',
      freqStart: 480,
      freqEnd: 240,
      startAt: this.audioCtx.currentTime,
      duration: 0.14,
      attack: 0.02,
      peakGain: 0.075,
    });
  }

  // --- 8. Mode Switch (Subtle tactile pitch click) ---
  playPanel() {
    return this.playPanelOpen();
  }

  playMode() {
    return this.playModeSwitch();
  }

  playModeSwitch() {
    if (!this.canPlay('modeSwitch', 'mode')) return;
    this.scheduleTone({
      type: 'triangle',
      category: 'mode',
      freqStart: 620,
      freqEnd: 740,
      linearFreq: true,
      startAt: this.audioCtx.currentTime,
      duration: 0.08,
      attack: 0.015,
      peakGain: 0.10,
    });
  }

  // --- 9. Error (two low buzzy descending beeps) ---
  playError() {
    if (!this.canPlay('error')) return;
    const t = this.audioCtx.currentTime;
    [0, 0.16].forEach((offset, i) => {
      this.scheduleTone({
        type: 'sawtooth',
        category: 'error',
        freqStart: i ? 190 : 260,
        freqEnd: i ? 140 : 200,
        linearFreq: true,
        startAt: t + offset,
        duration: 0.14,
        attack: 0.015,
        peakGain: 0.11,
      });
    });
  }

  // --- 10. Offline (Slow graceful frequency descent) ---
  playOffline() {
    if (!this.canPlay('offline', 'mode')) return;
    this.scheduleTone({
      type: 'sine',
      category: 'mode',
      freqStart: 520,
      freqEnd: 160,
      startAt: this.audioCtx.currentTime,
      duration: 0.38,
      attack: 0.02,
      peakGain: 0.11,
    });
  }

  playOrbIdentity(identity) {
    if (!this.canPlay(`orb:${identity}`, 'mode')) return;
    const t = this.audioCtx.currentTime;
    const sequences = {
      nexora: [660, 990, 1320],
      nexo: [440, 880, 1175, 1760],
      nexie: [523, 784, 1046, 1568],
      robot: [392, 784, 1175, 1568, 2093],
    };
    const notes = sequences[identity] || sequences.nexora;
    notes.forEach((freq, i) => {
      this.scheduleTone({
        type: identity === 'nexo' ? 'triangle' : 'sine',
        category: 'mode',
        freqStart: freq,
        startAt: t + i * 0.055,
        duration: 0.13,
        attack: 0.012,
        peakGain: 0.08,
      });
    });
  }
}
