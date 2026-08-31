const { contextBridge, ipcRenderer } = require('electron');

/**
 * Simple event emitter for renderer-side IPC events.
 * @template T
 */
class Emitter {
  /** @type {Record<string, Function[]>} */
  constructor() { this._listeners = {}; }
  /** @param {string} event */
  on(event, fn)  { (this._listeners[event] ||= []).push(fn); }
  /** @param {string} event */
  emit(event, ...args) { (this._listeners[event] || []).forEach(fn => fn(...args)); }
}

/** @typedef {{ event: string, data: any }} UpdaterEventPayload */

// IPC event channel for updater notifications
const emitter = new Emitter();

/**
 * Bridge main-process IPC to a safe renderer-side API.
 * @type {{
 *   querySmi: () => Promise<string[][]>,
 *   queryProcesses: () => Promise<{pid: string|number, name: string, memMiB: number}[]>,
 *   updateConfig: (cfg: Record<string, any>) => void,
 *   getConfig: () => Promise<Record<string, any>>,
 *   quit: () => void,
 *   getWindowBounds: () => Promise<Record<string, any>>,
 *   moveWindow: (x: number, y: number) => void,
 *   checkForUpdates: () => void,
 *   restartAndInstall: () => void,
 *   setTaskbarTitle: (title: string) => void,
 *   hideWindow: () => void,
 *   openDevTools: () => void,
 *   forceQuit: () => void,
 *   listReleases: () => Promise<{current: string, releases: any[]}>,
 *   installRelease: (tag: string, asset: any) => Promise<void>,
 *   onUpdaterEvent: (cb: (payload: UpdaterEventPayload) => void) => void
 * }}
 */
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
  setTaskbarTitle: (title) => ipcRenderer.send('set-taskbar-title', title),
  hideWindow: () => ipcRenderer.send('hide-window'),
  openDevTools: () => ipcRenderer.send('open-devtools'),
  forceQuit: () => ipcRenderer.send('force-quit'),
  listReleases: () => ipcRenderer.invoke('list-releases'),
  installRelease: (tag, asset) => ipcRenderer.invoke('install-release', tag, asset),
  onUpdaterEvent: (cb) => emitter.on('updater-event', cb),
});

// Forward all updater events from main process to renderer listeners
ipcRenderer.on('updater-event', (_, eventName, data) => {
  emitter.emit('updater-event', { event: eventName, data });
});
