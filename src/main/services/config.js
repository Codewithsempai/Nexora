/* ==========================================================================
   NEXORA — Configuration Service
   Provides safe local storage of user settings with schema validation and defaults.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { AUTONOMY_DEFAULTS } = require('../autonomy/defaults');

const DEFAULT_CONFIG = {
  version: '0.3.25',
  performance: { mode: 'medium' },
  appearance: {
    theme: 'dark-amber',
    popupOrbSize: 200, // visible diameter (px) of the floating wake popup Orb (v0.3.4 default; 380 was too big)
    popupOrbSizeMigratedV5: false, // one-time (v0.3.5): 200 px, bottom centre
    popupOrbPosition: 'bottom-center', // top-left|top-center|top-right|center|bottom-left|bottom-center|bottom-right
    popupOrbProfile: 'same', // 'same' = follow the main Orb, or nexora|nexo|nexie|robot
    orbProfile: 'nexora', // 'dark-amber' | 'solar-gold' | 'cyber-steel'
    accentIntensity: 1.0,
    orbIntensity: 1.0,
    reducedMotion: false,
    particlesEnabled: true,
  },
  ai: {
    chatModel: 'gemini-2.5-flash',
    liveModel: 'gemini-3.8-live',
    voiceName: 'Charon',
  },
  voice: {
    wakeWordEnabled: false,
    wakeThreshold: 0.6, // v0.3.25: offline ONNX wake word sensitivity (0.05-0.99). Lower = triggers easier, higher = fewer false wakes
    wakeOneShot: false, // v0.3.31: ON = a wake phrase handles ONE request, then back to standby. OFF = Live stays on until you say "mute"
    captionsInChat: false, // v0.3.12: spoken words are NOT added to the typed chat history
    autoSleepSeconds: 120, // v0.3.11: Live session returns to wake standby after this much silence (0 = never)
  },
  reminders: {
    nativeNotifications: true, // Windows / macOS toast when a reminder is due
    popupOrb: true, // show the floating Orb when a reminder is due while the main window is hidden
  },
  autonomy: JSON.parse(JSON.stringify(AUTONOMY_DEFAULTS)),
  updates: {
    checkOnStart: true, // v0.3.36: ask GitHub Releases for a newer version (notify only, never installs)
    skippedVersion: '', // a version the user chose "Skip" for
  },
  audio: {
    enabled: true,
    masterVolume: 0.75,
    soundEffects: {
      startup: true,
      wake: true,
      listening: true,
      thinking: true,
      response: true,
      panel: true,
      mode: true,
      error: true,
    },
  },
  application: {
    startMinimized: false,
    closeToTray: true,
    globalHotkey: 'CommandOrControl+Shift+Space',
    hardwareAcceleration: true,
  },
  windowBounds: {
    width: 1060,
    height: 740,
    x: undefined,
    y: undefined,
    isMaximized: false,
  },
};

class ConfigService {
  constructor(options = {}) {
    let userDataPath = options.userDataPath;
    if (!userDataPath) {
      try { userDataPath = require('electron').app.getPath('userData'); }
      catch { userDataPath = path.join(require('os').tmpdir(), 'nexora-test-user-data'); }
    }
    this.configPath = options.configPath || path.join(userDataPath, 'nexora-config.json');
    this.config = this.load();
    if (this.didMigrate) this.save();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        const merged = this.mergeDefaults(DEFAULT_CONFIG, parsed);
        // Migrate only models that are fully retired.
        if (['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'].includes(merged.ai?.chatModel)) { merged.ai.chatModel = DEFAULT_CONFIG.ai.chatModel; this.didMigrate = true; }
        if (typeof merged.ai?.liveModel !== 'string' || !/^gemini-[A-Za-z0-9._-]*(live|native-audio)[A-Za-z0-9._-]*$/i.test(merged.ai.liveModel)) { merged.ai.liveModel = DEFAULT_CONFIG.ai.liveModel; this.didMigrate = true; }
        // One-time upgrade: the old 132px default was too small, so any saved size below the new default is raised.
        if (!merged.appearance.popupOrbSizeMigratedV5) {
          merged.appearance.popupOrbSize = DEFAULT_CONFIG.appearance.popupOrbSize;
          merged.appearance.popupOrbPosition = DEFAULT_CONFIG.appearance.popupOrbPosition;
          merged.appearance.popupOrbSizeMigratedV5 = true; this.didMigrate = true;
        }
        if (!['nexora', 'nexo', 'nexie', 'robot'].includes(merged.appearance?.orbProfile)) { merged.appearance.orbProfile = DEFAULT_CONFIG.appearance.orbProfile; this.didMigrate = true; }
        return merged;
      }
    } catch (err) {
      console.error('[NEXORA Config] Error loading config, restoring defaults:', err.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[NEXORA Config] Error saving config:', err.message);
      return false;
    }
  }

  get(keyPath) {
    if (!keyPath) return JSON.parse(JSON.stringify(this.config));
    const keys = keyPath.split('.');
    let cur = this.config;
    for (const key of keys) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[key];
    }
    return cur != null ? JSON.parse(JSON.stringify(cur)) : undefined;
  }

  set(keyPath, value) {
    if (!keyPath) return false;
    const keys = keyPath.split('.');
    let cur = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (cur[key] == null || typeof cur[key] !== 'object') {
        cur[key] = {};
      }
      cur = cur[key];
    }
    cur[keys[keys.length - 1]] = value;
    return this.save();
  }

  mergeDefaults(defaults, custom) {
    const result = { ...defaults };
    for (const key of Object.keys(custom)) {
      if (custom[key] && typeof custom[key] === 'object' && !Array.isArray(custom[key])) {
        result[key] = this.mergeDefaults(defaults[key] || {}, custom[key]);
      } else {
        result[key] = custom[key];
      }
    }
    return result;
  }
}

let instance = null;
function getConfigService() {
  if (!instance) {
    instance = new ConfigService();
  }
  return instance;
}

module.exports = {
  getConfigService,
  DEFAULT_CONFIG,
};
