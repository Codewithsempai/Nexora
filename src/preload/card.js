/* NEXORA — minimal preload for the autonomy card window (no access to memory, chat, settings or files). */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nexoraCard', {
  onItems: (callback) => { ipcRenderer.on('card:items', (_event, items) => callback(Array.isArray(items) ? items : [])); },
  click: (cardId, buttonId) => ipcRenderer.send('card:click', cardId, buttonId),
  close: (cardId) => ipcRenderer.send('card:close', cardId),
  size: (height) => ipcRenderer.send('card:size', height),
});
