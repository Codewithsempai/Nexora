/* ==========================================================================
   NEXORA — Preload Script
   Safely exposes typed IPC methods through contextBridge into window.nexoraAPI
   ========================================================================== */

const { contextBridge, ipcRenderer } = require('electron');

const nexoraAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    exitApp: () => ipcRenderer.invoke('app:exit'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback) => {
      const listener = (_event, value) => callback(Boolean(value));
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  },

  config: {
    get: (keyPath) => ipcRenderer.invoke('config:get', keyPath),
    set: (keyPath, value) => ipcRenderer.invoke('config:set', keyPath, value),
  },

  system: {
    getStatus: () => ipcRenderer.invoke('system:get-status'),
    pingSidecar: () => ipcRenderer.invoke('system:ping-sidecar'),
  },

  hotkeys: {
    update: (newShortcut) => ipcRenderer.invoke('hotkey:update', newShortcut),
    onActivated: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('hotkey:activated', listener);
      return () => ipcRenderer.removeListener('hotkey:activated', listener);
    },
  },

  chat: {
    generate: (prompt, history) => ipcRenderer.invoke('chat:generate', prompt, history),
    stream: (requestId, prompt, history) => ipcRenderer.invoke('chat:stream', requestId, prompt, history),
    cancel: (requestId) => ipcRenderer.send('chat:cancel', requestId),
    onStreamChunk: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('chat:stream:chunk', listener);
      return () => ipcRenderer.removeListener('chat:stream:chunk', listener);
    },
    onModelSwitch: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('chat:model-switch', listener);
      return () => ipcRenderer.removeListener('chat:model-switch', listener);
    },
  },
  ai: {
    saveKey: (key) => ipcRenderer.invoke('ai:key:save', key),
    clearKey: () => ipcRenderer.invoke('ai:key:clear'),
    keyStatus: () => ipcRenderer.invoke('ai:key:status'),
    validateKey: (key) => ipcRenderer.invoke('ai:key:validate', key),
    validateStoredKey: () => ipcRenderer.invoke('ai:key:validate-stored'),
    listModels: (force = false) => ipcRenderer.invoke('ai:models:list', force),
  },
  audio: {
    diagnostics: () => ipcRenderer.invoke('audio:diagnostics'),
    openCommunicationsSettings: () => ipcRenderer.invoke('audio:open-communications'),
  },

  // Backward-compatible names used by older Settings panel builds.
  memory: {
    list: (category = 'all') => ipcRenderer.invoke('memory:list', category),
    add: (category, text) => ipcRenderer.invoke('memory:add', category, text),
    remove: (id) => ipcRenderer.invoke('memory:delete', id),
    clear: (category = 'all') => ipcRenderer.invoke('memory:clear', category),
    search: (query, category = 'all') => ipcRenderer.invoke('memory:search', query, category),
    update: (id, patch) => ipcRenderer.invoke('memory:update', id, patch),
    stats: () => ipcRenderer.invoke('memory:stats'),
    // Fires the moment anything is saved / edited / removed (typed chat, spoken Live, or the panel itself).
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('memory:changed', listener);
      return () => ipcRenderer.removeListener('memory:changed', listener);
    },
  },

  reminders: {
    list: () => ipcRenderer.invoke('reminder:list'),
    add: (reminder) => ipcRenderer.invoke('reminder:add', reminder),
    quick: (text) => ipcRenderer.invoke('reminder:quick', text),
    update: (id, patch) => ipcRenderer.invoke('reminder:update', id, patch),
    remove: (id) => ipcRenderer.invoke('reminder:delete', id),
    done: (id) => ipcRenderer.invoke('reminder:done', id),
    snooze: (id, minutes) => ipcRenderer.invoke('reminder:snooze', id, minutes),
    speak: (text) => ipcRenderer.invoke('reminder:speak', text),
    clearDone: () => ipcRenderer.invoke('reminder:clear-done'),
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('reminder:changed', listener);
      return () => ipcRenderer.removeListener('reminder:changed', listener);
    },
    onFired: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('reminder:fired', listener);
      return () => ipcRenderer.removeListener('reminder:fired', listener);
    },
  },

  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    state: () => ipcRenderer.invoke('update:state'),
    setAuto: (enabled) => ipcRenderer.invoke('update:setAuto', enabled),
    open: (url) => ipcRenderer.invoke('update:open', url),
    skip: (version) => ipcRenderer.invoke('update:skip', version),
    whatsNew: () => ipcRenderer.invoke('update:whats-new'),
    whatsNewSeen: () => ipcRenderer.invoke('update:whats-new-seen'),
    onCommandResult: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:command-result', listener); return () => ipcRenderer.removeListener('update:command-result', listener); },
    onState: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:state', listener); return () => ipcRenderer.removeListener('update:state', listener); },
    onAvailable: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:available', listener); return () => ipcRenderer.removeListener('update:available', listener); },
    onProgress: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:progress', listener); return () => ipcRenderer.removeListener('update:progress', listener); },
    onDownloaded: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:downloaded', listener); return () => ipcRenderer.removeListener('update:downloaded', listener); },
    onError: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('update:error', listener); return () => ipcRenderer.removeListener('update:error', listener); },
  },

  autonomy: {
    state: () => ipcRenderer.invoke('autonomy:state'),
    setPermission: (action, level) => ipcRenderer.invoke('autonomy:permission', action, level),
    applyPreset: (preset) => ipcRenderer.invoke('autonomy:apply-preset', preset),
    runTask: (goal) => ipcRenderer.invoke('autonomy:run-task', goal),
    stop: () => ipcRenderer.invoke('autonomy:stop'),
    clearLog: () => ipcRenderer.invoke('autonomy:log-clear'),
    explainScreen: () => ipcRenderer.invoke('autonomy:explain-screen'),
    briefNow: () => ipcRenderer.invoke('autonomy:brief-now'),
    upkeepNow: () => ipcRenderer.invoke('autonomy:upkeep-now'),
    onChanged: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('autonomy:changed', listener); return () => ipcRenderer.removeListener('autonomy:changed', listener); },
    onSpeak: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('autonomy:speak', listener); return () => ipcRenderer.removeListener('autonomy:speak', listener); },
    onOpenPanel: (callback) => { const listener = (_event, name) => callback(name); ipcRenderer.on('autonomy:open-panel', listener); return () => ipcRenderer.removeListener('autonomy:open-panel', listener); },
  },

  voice: {
    enableWake: () => ipcRenderer.invoke('voice:wake:enable'),
    disableWake: () => ipcRenderer.invoke('voice:wake:disable'),
    startWakeTest: () => ipcRenderer.invoke('voice:wake:test-start'),
    stopWakeTest: (keepEnabled = null) => ipcRenderer.invoke('voice:wake:test-stop', keepEnabled),
    onWakeTestHit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('voice:wake-test-hit', listener);
      return () => ipcRenderer.removeListener('voice:wake-test-hit', listener);
    },
    startLive: () => ipcRenderer.invoke('voice:live:start'),
    stopLive: () => ipcRenderer.invoke('voice:live:stop'),
    setOrbProfile: (profile) => ipcRenderer.invoke('voice:orb-profile', profile),
    pushPcm: (base64) => ipcRenderer.send('voice:pcm', base64),
    onModelSwitch: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('voice:model-switch', listener);
      return () => ipcRenderer.removeListener('voice:model-switch', listener);
    },
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('voice:status', listener);
      return () => ipcRenderer.removeListener('voice:status', listener);
    },
    onAudioOutput: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('voice:audio-output', listener);
      return () => ipcRenderer.removeListener('voice:audio-output', listener);
    },
    onAudioStop: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('voice:audio-stop', listener);
      return () => ipcRenderer.removeListener('voice:audio-stop', listener);
    },
    onCaption: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('voice:caption', listener);
      return () => ipcRenderer.removeListener('voice:caption', listener);
    },
  },

  popup: {
    onInit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('popup:init', listener);
      return () => ipcRenderer.removeListener('popup:init', listener);
    },
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('popup:state', listener);
      return () => ipcRenderer.removeListener('popup:state', listener);
    },
    onLevel: (callback) => {
      const listener = (_event, level) => callback(level);
      ipcRenderer.on('popup:level', listener);
      return () => ipcRenderer.removeListener('popup:level', listener);
    },
    onProfile: (callback) => {
      const listener = (_event, profile) => callback(profile);
      ipcRenderer.on('popup:profile', listener);
      return () => ipcRenderer.removeListener('popup:profile', listener);
    },
    openMain: () => ipcRenderer.send('popup:open-main'),
    preview: (state) => ipcRenderer.send('popup:preview', state),
    stopPreview: () => ipcRenderer.send('popup:preview-stop'),
  },

  credentials: {
    setKey: (key) => ipcRenderer.invoke('ai:key:save', key),
    saveKey: (key) => ipcRenderer.invoke('ai:key:save', key),
    clearKey: () => ipcRenderer.invoke('ai:key:clear'),
    status: () => ipcRenderer.invoke('ai:key:status'),
    getStatus: () => ipcRenderer.invoke('ai:key:status'),
  },

  assistant: {
    onToggleListen: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('assistant:toggle-listen', listener);
      return () => ipcRenderer.removeListener('assistant:toggle-listen', listener);
    },
  },
};

// Expose safe API
contextBridge.exposeInMainWorld('nexoraAPI', nexoraAPI);
