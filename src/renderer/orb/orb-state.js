/* ==========================================================================
   NEXORA — Orb State Engine & Centralized State Manager
   Orchestrates visual parameters, harmonic frequencies, and transitions
   across all 7 distinct states: IDLE, LISTEN, THINK, SPEAK, WAKE, ERROR, OFFLINE.
   ========================================================================== */

export const ORB_STATES = {
  IDLE: 'idle',
  LISTEN: 'listen',
  THINK: 'think',
  SPEAK: 'speak',
  WAKE: 'wake',
  ERROR: 'error',
  OFFLINE: 'offline',
  // Aliases for compatibility
  LISTENING: 'listen',
  THINKING: 'think',
  SPEAKING: 'speak',
};

// Aliases for compatibility with legacy names
export const STATE_ALIASES = {
  listening: ORB_STATES.LISTEN,
  thinking: ORB_STATES.THINK,
  speaking: ORB_STATES.SPEAK,
};

// Comprehensive visual parameter profiles per state
export const STATE_CONFIGS = {
  [ORB_STATES.IDLE]: {
    id: ORB_STATES.IDLE,
    label: 'Orb Resting',
    description: 'Slow ambient breathing, low-energy golden pulse, stable particle sphere',
    spinRate: 0.28,
    orbitSpeed: 0.35,
    waveSpeed: 1.2,
    waveAmplitude: 0.10,
    corePulseSpeed: 1.6,
    coreScale: 1.0,
    coreBrightness: 1.0,
    coreIntensity: 1.0,
    particleRate: 0.3,
    particleSpeed: 0.5,
    particleScale: 1.0,
    particleOpacity: 0.75,
    glowRadius: 28,
    glowColor: 'rgba(245, 158, 11, 0.25)',
    coreColor: '#F59E0B',
    pointColorType: 'amber',
    fluxRings: 1,
    instability: 0.0,
    assembly: 1.0,
  },
  [ORB_STATES.LISTEN]: {
    id: ORB_STATES.LISTEN,
    label: 'Listening for Input',
    description: 'Responsive surface ripples, active harmonic wave rings, heightened alertness',
    spinRate: 0.85,
    orbitSpeed: 0.9,
    waveSpeed: 4.4,
    waveAmplitude: 0.28,
    corePulseSpeed: 4.5,
    coreScale: 1.18,
    coreBrightness: 1.35,
    coreIntensity: 1.4,
    particleRate: 0.75,
    particleSpeed: 0.95,
    particleScale: 1.2,
    particleOpacity: 0.9,
    glowRadius: 46,
    glowColor: 'rgba(251, 191, 36, 0.5)',
    coreColor: '#FBBF24',
    pointColorType: 'solar-gold',
    fluxRings: 2,
    instability: 0.0,
    assembly: 1.0,
  },
  [ORB_STATES.THINK]: {
    id: ORB_STATES.THINK,
    label: 'Processing & Reasoning',
    description: 'Rapid orbital rotation, counter-swirling flux bands, radiant processing energy',
    spinRate: 2.2,
    orbitSpeed: 2.0,
    waveSpeed: 6.8,
    waveAmplitude: 0.38,
    corePulseSpeed: 7.5,
    coreScale: 1.08,
    coreBrightness: 1.65,
    coreIntensity: 1.6,
    particleRate: 1.1,
    particleSpeed: 1.8,
    particleScale: 1.25,
    particleOpacity: 0.95,
    glowRadius: 58,
    glowColor: 'rgba(245, 158, 11, 0.65)',
    coreColor: '#FFFBEB',
    pointColorType: 'intense-flux',
    fluxRings: 3,
    instability: 0.0,
    assembly: 1.0,
  },
  [ORB_STATES.SPEAK]: {
    id: ORB_STATES.SPEAK,
    label: 'Transmitting Acoustic Response',
    description: 'Dynamic organic expansion, rhythmic acoustic envelope pulses, communicative energy',
    spinRate: 1.15,
    orbitSpeed: 1.2,
    waveSpeed: 5.2,
    waveAmplitude: 0.44,
    corePulseSpeed: 5.8,
    coreScale: 1.35,
    coreBrightness: 1.45,
    coreIntensity: 1.5,
    particleRate: 0.9,
    particleSpeed: 1.2,
    particleScale: 1.3,
    particleOpacity: 0.88,
    glowRadius: 52,
    glowColor: 'rgba(253, 230, 138, 0.48)',
    coreColor: '#FDE68A',
    pointColorType: 'warm-cream',
    fluxRings: 2,
    instability: 0.0,
    assembly: 1.0,
  },
  [ORB_STATES.WAKE]: {
    id: ORB_STATES.WAKE,
    label: 'Initiating Quantum Core',
    description: 'Power-up activation sequence, rapid particle assembly, luminous core bloom',
    spinRate: 2.8,
    orbitSpeed: 2.5,
    waveSpeed: 8.5,
    waveAmplitude: 0.48,
    corePulseSpeed: 9.5,
    coreScale: 1.45,
    coreBrightness: 2.0,
    coreIntensity: 2.0,
    particleRate: 1.3,
    particleSpeed: 2.2,
    particleScale: 1.4,
    particleOpacity: 1.0,
    glowRadius: 72,
    glowColor: 'rgba(255, 251, 235, 0.8)',
    coreColor: '#FFFFFF',
    pointColorType: 'blinding-white',
    fluxRings: 3,
    instability: 0.0,
    assembly: 0.35, // Expands to 1.0 over time
  },
  [ORB_STATES.ERROR]: {
    id: ORB_STATES.ERROR,
    label: 'System Alert Stabilization',
    description: 'Controlled warning amber-red flare, irregular surface harmonics, slow warning pulse',
    spinRate: 0.95,
    orbitSpeed: 0.8,
    waveSpeed: 2.6,
    waveAmplitude: 0.34,
    corePulseSpeed: 2.4,
    coreScale: 1.1,
    coreBrightness: 1.2,
    coreIntensity: 1.3,
    particleRate: 0.45,
    particleSpeed: 0.7,
    particleScale: 1.15,
    particleOpacity: 0.85,
    glowRadius: 42,
    glowColor: 'rgba(239, 68, 68, 0.45)',
    coreColor: '#EF4444',
    pointColorType: 'alert-crimson',
    fluxRings: 1,
    instability: 0.45, // Chaotic displacement
    assembly: 1.0,
  },
  [ORB_STATES.OFFLINE]: {
    id: ORB_STATES.OFFLINE,
    label: 'Core Standby',
    description: 'Muted steel-gray standby embers, minimal sluggish motion, reduced luminescence',
    spinRate: 0.06,
    orbitSpeed: 0.08,
    waveSpeed: 0.4,
    waveAmplitude: 0.03,
    corePulseSpeed: 0.7,
    coreScale: 0.82,
    coreBrightness: 0.25,
    coreIntensity: 0.3,
    particleRate: 0.05,
    particleSpeed: 0.1,
    particleScale: 0.8,
    particleOpacity: 0.35,
    glowRadius: 10,
    glowColor: 'rgba(71, 85, 105, 0.2)',
    coreColor: '#64748B',
    pointColorType: 'dormant-steel',
    fluxRings: 0,
    instability: 0.0,
    assembly: 1.0,
  },
};

export class OrbStateManager {
  constructor(initialState = ORB_STATES.IDLE) {
    this.currentState = this.normalizeState(initialState);
    this.previousState = this.currentState;
    this.stateStartTime = performance.now();
    this.listeners = new Set();
    this.audioLevel = 0;
    this.transientTimer = null;
  }

  normalizeState(state) {
    const s = String(state || '').toLowerCase();
    if (Object.values(ORB_STATES).includes(s)) return s;
    if (STATE_ALIASES[s]) return STATE_ALIASES[s];
    return null;
  }

  getState() {
    return this.currentState;
  }

  getConfig() {
    return STATE_CONFIGS[this.currentState] || STATE_CONFIGS[ORB_STATES.IDLE];
  }

  setState(newState, autoReturn = true) {
    const normalized = this.normalizeState(newState);
    if (!normalized) return false;

    if (this.currentState === normalized) return true;

    // Clear any previous transient state timers
    if (this.transientTimer) {
      clearTimeout(this.transientTimer);
      this.transientTimer = null;
    }

    this.previousState = this.currentState;
    this.currentState = normalized;
    this.stateStartTime = performance.now();

    const config = this.getConfig();

    this.notifyListeners({
      currentState: this.currentState,
      previousState: this.previousState,
      config: config,
      timestamp: this.stateStartTime,
    });

    // Auto-transition WAKE back to IDLE smoothly after duration if autoReturn is true
    if (normalized === ORB_STATES.WAKE && autoReturn) {
      this.transientTimer = setTimeout(() => {
        if (this.currentState === ORB_STATES.WAKE) {
          this.setState(ORB_STATES.IDLE);
        }
      }, 2200);
    }

    return true;
  }

  transitionTo(newState) {
    return this.setState(newState);
  }

  reset() {
    return this.setState(ORB_STATES.IDLE);
  }

  setAudioLevel(level) {
    this.audioLevel = Math.max(0, Math.min(1, level));
  }

  getAudioLevel() {
    return this.audioLevel;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    // Immediate notification of initial state
    try {
      listener({
        currentState: this.currentState,
        previousState: this.previousState,
        config: this.getConfig(),
        timestamp: this.stateStartTime,
      });
    } catch (e) {
      console.error('[NEXORA OrbState] Initial listener error:', e);
    }

    return () => this.listeners.delete(listener);
  }

  notifyListeners(data) {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.error('[NEXORA OrbState] Listener error:', err);
      }
    }
  }
}
