const { autoUpdater } = require('electron-updater');

/**
 * Auto-update manager for GPU Monitor.
 * Handles update checks, downloads, and user notifications.
 */
let mainWindow = null;

/**
 * Initialize the auto-update system.
 * Call this after mainWindow is created and only when packaged.
 */
function init(mainWin) {
  mainWindow = mainWin;

  // Only run in production builds (not during development)
  if (!autoUpdater.isPackaged) {
    console.log('[GPU Monitor] Auto-update disabled in development mode');
    return;
  }

  // Pre-release updates (beta builds)
  autoUpdater.allowPrerelease = false;

  /**
   * Forward event to renderer via IPC on a single dedicated channel.
   */
  function emit(eventName, data) {
    if (!mainWindow) return;
    mainWindow.webContents.send('updater-event', eventName, data || '');
  }

  // Lifecycle events
  autoUpdater.on('checking-for-update', () => emit('checking-for-update'));
  autoUpdater.on('update-available', (info) => {
    console.log(`[GPU Monitor] Update available: ${info.version}`);
    emit('update-available', JSON.stringify(info));
  });
  autoUpdater.on('update-not-available', (info) => {
    console.log('[GPU Monitor] No updates available.');
    emit('update-not-available', JSON.stringify(info));
  });
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[GPU Monitor] Download: ${progress.percent.toFixed(1)}%`);
    emit('download-progress', JSON.stringify(progress));
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[GPU Monitor] Update downloaded: v${info.version}`);
    emit('update-downloaded', JSON.stringify(info));
  });
  autoUpdater.on('error', (err) => {
    console.error('[GPU Monitor] Update error:', err.message);
    emit('error', err.message);
  });

  // Check for updates on startup (with 10s delay to let app settle)
  setTimeout(() => manualCheck(), 10000);
}

/**
 * Manually check for updates (triggered from renderer via IPC).
 */
function manualCheck() {
  if (!autoUpdater.isPackaged) return;
  autoUpdater.checkForUpdates();
}

/**
 * Quit and install the downloaded update.
 */
function quitAndInstall() {
  if (!autoUpdater.isPackaged) return;
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, manualCheck, quitAndInstall };
