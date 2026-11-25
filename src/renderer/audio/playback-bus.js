/* ==========================================================================
   NEXORA — Isolated Assistant Playback Bus
   Maintains a single lazy playback AudioContext with safe output scaling,
   smoothed gain transitions, and a DynamicsCompressor peak limiter.
   Never used for microphone capture.
   ========================================================================== */

export const OUTPUT_PROFILE_GAINS = Object.freeze({
  low: 0.42,
  medium: 0.70,
  high: 0.94,
});

export function clamp01(value, fallback = 0.55) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

export class PlaybackBus {
  constructor(options = {}) {
    this.context = null;
    this.outputProfile = OUTPUT_PROFILE_GAINS[options.outputProfile] ? options.outputProfile : 'medium';
    this.outputGainNode = null;
    this.limiterNode = null;
    this.createAudioContext = options.createAudioContext || null;
  }

  getProfileGain() {
    return OUTPUT_PROFILE_GAINS[this.outputProfile] || OUTPUT_PROFILE_GAINS.medium;
  }

  setOutputProfile(profile) {
    if (!OUTPUT_PROFILE_GAINS[profile]) return false;
    this.outputProfile = profile;
    if (this.outputGainNode && this.context) {
      const target = this.getProfileGain();
      const now = this.context.currentTime || 0;
      if (typeof this.outputGainNode.gain.setTargetAtTime === 'function') {
        this.outputGainNode.gain.setTargetAtTime(target, now, 0.03);
      } else {
        this.outputGainNode.gain.value = target;
      }
    }
    return true;
  }

  ensureContext() {
    if (!this.context || this.context.state === 'closed') {
      let ctx = null;
      if (typeof this.createAudioContext === 'function') {
        ctx = this.createAudioContext();
      } else {
        const AudioContextClass = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext || globalThis.AudioContext;
        if (!AudioContextClass) return null;
        try {
          ctx = new AudioContextClass({ latencyHint: 'playback' });
        } catch {
          ctx = new AudioContextClass();
        }
      }
      if (!ctx) return null;
      this.context = ctx;
      this.outputGainNode = ctx.createGain();
      const now = ctx.currentTime || 0;
      if (typeof this.outputGainNode.gain.setValueAtTime === 'function') {
        this.outputGainNode.gain.setValueAtTime(this.getProfileGain(), now);
      } else {
        this.outputGainNode.gain.value = this.getProfileGain();
      }

      if (typeof ctx.createDynamicsCompressor === 'function') {
        const comp = ctx.createDynamicsCompressor();
        if (comp.threshold) comp.threshold.value = -8;
        if (comp.knee) comp.knee.value = 6;
        if (comp.ratio) comp.ratio.value = 12;
        if (comp.attack) comp.attack.value = 0.003;
        if (comp.release) comp.release.value = 0.14;
        this.limiterNode = comp;
        this.outputGainNode.connect(comp);
        comp.connect(ctx.destination);
      } else {
        this.limiterNode = null;
        this.outputGainNode.connect(ctx.destination);
      }
    }
    if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
      Promise.resolve(this.context.resume()).catch(() => {});
    }
    return this.context;
  }

  getDestinationNode() {
    if (!this.ensureContext()) return null;
    return this.outputGainNode || this.context.destination;
  }

  resumeIfInitialized() {
    if (this.context && this.context.state === 'suspended' && typeof this.context.resume === 'function') {
      Promise.resolve(this.context.resume()).catch(() => {});
    }
  }

  destroy() {
    try { this.outputGainNode?.disconnect?.(); } catch {}
    try { this.limiterNode?.disconnect?.(); } catch {}
    if (this.context && this.context.state !== 'closed' && typeof this.context.close === 'function') {
      Promise.resolve(this.context.close()).catch(() => {});
    }
    this.context = null;
    this.outputGainNode = null;
    this.limiterNode = null;
  }
}

let sharedBus = null;
export function getSharedPlaybackBus() {
  if (!sharedBus) sharedBus = new PlaybackBus();
  return sharedBus;
}
