const { contextBridge, ipcRenderer } = require('electron');

// Simple event emitter for renderer-side IPC events
class Emitter {
  constructor() { this._listeners = {}; }
  on(event, fn)  { (this._listeners[event] ||= []).push(fn); }
  emit(event, ...args) { (this._listeners[event] || []).forEach(fn => fn(...args)); }
}

// IPC event channel for updater notifications
const emitter = new Emitter();

contextBridge.exposeInMainWorld('electron', {
  querySmi: () => ipcRenderer.invoke('query-smi'),
  queryProcesses: () => ipcRenderer.invoke('query-processes'),
  updateConfig: (cfg) => ipcRenderer.send('config-change', cfg),
  getConfig: () => ipcRenderer.invoke('get-config'),
  quit: () => ipcRenderer.send('quit-app'),
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  moveWindow: (x, y) => ipcRenderer.send('move-window', x, y),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  restartAndInstall: () => ipcRenderer.send('quit-and-install'),
  // IPC event listener bridge (renderer uses this to receive events from main)
  onUpdaterEvent: (cb) => emitter.on('updater-event', cb),
});

// Forward all updater events from main process to renderer listeners
ipcRenderer.on('updater-event', (_, eventName, data) => {
  emitter.emit('updater-event', { event: eventName, data });
});
