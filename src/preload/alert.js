/* NEXORA — minimal preload for the desktop reminder card (no access to memory, chat or settings). */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nexoraAlert', {
  onItems: (callback) => { ipcRenderer.on('alert:items', (_event, items) => callback(Array.isArray(items) ? items : [])); },
  done: (id) => ipcRenderer.send('alert:done', id),
  snooze: (id, minutes) => ipcRenderer.send('alert:snooze', id, minutes),
  close: (id) => ipcRenderer.send('alert:close', id),
  open: () => ipcRenderer.send('alert:open'),
});
