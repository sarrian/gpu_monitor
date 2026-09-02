const { app, BrowserWindow, screen, ipcMain, Tray, nativeImage, Menu } = require('electron');
const path = require('path');
const os   = require('os');
const updater = require('./updater');
const releases = require('./releases');
const fs   = require('fs');
const { spawn } = require('child_process');

// ── Config types ──

/**
 * Default application configuration interface.
 * @typedef {object} AppConfig
 * @property {number} windowWidth
 * @property {number} windowHeight
 * @property {number} opacity          - 0.0–1.0, window opacity
 * @property {number} updateInterval   - ms between GPU data polls
 * @property {boolean} pinTopLeft      - anchor window to screen top-left
 * @property {boolean} alwaysOnTop     - keep window above all others
 * @property {boolean} showProcesses   - display compute processes list
 * @property {number} processLimit     - max processes to show (1–20)
 * @property {'nvidia'|'blue'|'purple'|'amber'} theme  - color theme key
 * @property {boolean} showSparklines   - show per-GPU sparkline panels
 * @property {number}  sparklineHistorySeconds - seconds of history (15-300)
 * @property {boolean} showTemp      - show/hide the Temp row
 * @property {boolean} showPower     - show/hide the Power row
 * @property {boolean} showGpuLoad   - show/hide the GPU Load row
 * @property {boolean} showMemLoad   - show/hide the Mem Load row
 * @property {boolean} showVram      - show/hide the VRAM row
 * @property {boolean} showGpuClock  - show/hide the GCLK row
 * @property {boolean} showMemClock  - show/hide the MCLK row
 * @property {boolean} showFan       - show/hide the Fan row
 */

/**
 * Config file path location.
 * @type {string}
 */
const CONFIG_DIR = path.join(app.getPath('appData'), 'gpu-monitor');
/** @type {string} */
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/**
 * Load configuration from disk; returns null on any error.
 * @returns {AppConfig|null}
 */
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return null; }
}

/**
 * Save application config to disk.
 * @param {AppConfig} cfg
 */
function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** Default configuration values — frozen for safety. */
const DEFAULT_CFG = Object.freeze({
  windowWidth: 480, windowHeight: 360, opacity: 1.0,
  updateInterval: 1000, pinTopLeft: true, alwaysOnTop: true,
  showProcesses: true, processLimit: 5, theme: 'nvidia',
  showSparklines: true, sparklineHistorySeconds: 60,
  showTemp: true, showPower: true, showGpuLoad: true, showMemLoad: true,
  showVram: true, showGpuClock: true, showMemClock: true, showFan: true,
});

/** Application config object — merged from defaults + saved state. */
let config = { ...DEFAULT_CFG };
const savedConfig = loadConfig();
if (savedConfig) {
  Object.assign(config, savedConfig);
  // One-time migration: legacy qualified keys -> flat keys. Test savedConfig
  // (the on-disk object), because {...DEFAULT_CFG} already defines the new keys.
  if (savedConfig.showPowerWatts !== undefined && savedConfig.showPower === undefined) config.showPower = savedConfig.showPowerWatts;
  if (savedConfig.showVramRaw  !== undefined && savedConfig.showVram  === undefined) config.showVram  = savedConfig.showVramRaw;
  delete config.showPowerWatts;
  delete config.showVramRaw;
}

// ── System Tray ──

/** @type {Tray|null} */
let tray = null;

// Set to true right before a real quit so the window 'close' interceptor
// (minimize-to-tray) lets the app exit instead of hiding it.
let forceQuitting = false;
function forceQuit() {
  forceQuitting = true;
  app.quit();
}

/**
 * Create the system tray icon and context menu.
 * Silent fail — if the icon is missing or unavailable the app still works.
 * @param {BrowserWindow} win
 */
function createTray(win) {
  try {
    const iconPath = path.join(__dirname, '..', 'GPU Monitor.png');
    let img = nativeImage.createEmpty();
    if (fs.existsSync(iconPath)) {
      img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    }
    // Only create tray icon if we have a visible image; blank icon does nothing useful on Windows
    if (img.isEmpty()) return;
    tray = new Tray(img);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show', click: () => win.show() },
      { type: 'separator' },
      // forceQuit, not app.quit() — a bare quit is swallowed by the
      // minimize-to-tray close interceptor and the app would just hide
      { label: 'Quit', click: () => forceQuit() },
    ]);
    tray.setToolTip('GPU Monitor');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => win.isVisible() ? win.hide() : win.show());
  } catch (e) {
    // Tray not available — silent fail, app still works
  }
}

// ── Window ──

/** @type {BrowserWindow|null} */
let mainWindow;

function createWindow() {
  const { windowWidth, windowHeight } = config;

  // Get primary display — safe fallback for all Electron versions
  const displays = screen.getAllDisplays();
  const firstDisplay = Array.isArray(displays) && displays.length ? displays[0] : null;

  const wAB = firstDisplay?.workAreaBounds;
  const bds = firstDisplay?.bounds;
  let baseX = 0, baseY = 0, baseW = windowWidth, baseH = windowHeight;

  if (wAB && typeof wAB.x === 'number') {
    baseX = wAB.x; baseY = wAB.y; baseW = wAB.width; baseH = wAB.height;
  } else if (bds && typeof bds.x === 'number') {
    baseX = bds.x; baseY = bds.y; baseW = bds.width; baseH = bds.height;
  }

  let x, y;
  if (config.pinTopLeft) {
    x = baseX + 20;
    y = baseY + 60;
  } else {
    x = baseX + (baseW - windowWidth) / 2;
    y = baseY + (baseH - windowHeight) / 4;
  }

  // Clamp to visible area
  x = Math.max(baseX, Math.min(x, baseX + baseW - windowWidth));
  y = Math.max(baseY, Math.min(y, baseY + baseH - windowHeight));

  mainWindow = new BrowserWindow({
    x, y, width: windowWidth, height: windowHeight,
    minWidth: 300, minHeight: 250,
    transparent: false,
    frame: false, // no OS title bar — custom topbar handles this
    alwaysOnTop: config.alwaysOnTop,
    opacity: config.opacity || 1.0,
    resizable: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  mainWindow.webContents.on('did-fail-load', (event, code, desc) => {
    console.error('[GPU Monitor] did-fail-load:', code, desc);
  });

  let gpuNameSet = false;
  let firstShown = false; // prevent close-to-tray on initial launch

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    firstShown = true;
  });

  // ── IPC handlers ──

  // nvidia-smi detection — synchronous. Try full paths first (reliable in Electron sandbox).
  const NVSMI_BIN = (() => {
    const candidates = [
      'C:\\Windows\\System32\\nvidia-smi.exe',
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
      process.env.NVSMI_PATH,
      'nvidia-smi',
      'nvidia-smi.exe',
    ].filter(Boolean);

    for (const p of candidates) {
      try {
        require('child_process').execSync(`"${p}" --version`, { timeout: 5000, stdio: 'ignore', shell: true });
        return p; // found and works
      } catch {}
    }
    return null; // nothing found — IPC handler will gracefully return []
  })();

  /** Handle GPU metrics query from renderer. Returns CSV rows or empty array on failure. */
  ipcMain.handle('query-smi', () => new Promise((resolve) => {
    if (!NVSMI_BIN) { return resolve([]); }

    const args = [
      '--query-gpu=name,uuid,index,temperature.gpu,power.draw,power.limit,' +
      'utilization.gpu,utilization.memory,' +
      'memory.used,memory.total,clocks.current.graphics,' +
      'clocks.current.memory,fan.speed',
      '--format=csv,noheader,nounits',
    ];

    let killed = false;
    const proc = spawn(NVSMI_BIN, args, { shell: true, timeout: 8000 });

    // Kill if nvidia-smi hangs — Electron sandbox can cause orphan processes
    setTimeout(() => {
      if (!killed) { killed = true; try { proc.kill(); } catch {} }
    }, 9000);

    let stdout = '', stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    const cleanup = () => {
      try { proc.kill(); } catch {}
    };

    proc.on('close', (code) => {
      killed = true;
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim().split('\n').filter(Boolean));
      } else {
        resolve([]);
      }
    });
    proc.on('error', () => { killed = true; resolve([]); });
  }));

  /** Return current config to renderer. */
  ipcMain.handle('get-config', () => ({ ...config }));

  /** Apply config change from renderer — persists to disk and updates window properties. */
  ipcMain.on('config-change', (_, newCfg) => {
    Object.assign(config, newCfg);
    saveConfig(config);
    if (newCfg.opacity != null && mainWindow) mainWindow.setOpacity(newCfg.opacity);
    if (newCfg.alwaysOnTop != null && mainWindow) mainWindow.setAlwaysOnTop(newCfg.alwaysOnTop);
  });

  /** Quit the application. */
  ipcMain.on('quit-app', () => app.quit());

  /** Force quit — bypasses the minimize-to-tray close interceptor. */
  ipcMain.on('force-quit', () => forceQuit());

  /** Open DevTools window for debugging. */
  ipcMain.on('open-devtools', () => {
    if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Window position control
  ipcMain.handle('get-window-bounds', () => mainWindow?.getBounds() || {});

  /** Set Windows taskbar title to GPU model name (called once on first render). */
  ipcMain.on('set-taskbar-title', (_, title) => {
    if (!gpuNameSet && mainWindow && title && title !== 'GPU Monitor') {
      gpuNameSet = true;
      mainWindow.setTitle(title);
    }
  });

  /** Hide the application window (for minimize-to-tray). */
  ipcMain.on('hide-window', () => { if (mainWindow) mainWindow.hide(); });
  ipcMain.on('move-window', (_, x, y) => {
    if (mainWindow) mainWindow.setPosition(Math.max(0, x), Math.max(0, y));
  });

  /** Handle compute process list query from renderer. */
  ipcMain.handle('query-processes', () => new Promise((resolve) => {
    if (!NVSMI_BIN) { return resolve([]); }

    const proc = spawn(NVSMI_BIN, [
      '--query-compute-apps=pid,process_name,used_memory',
      '--format=csv,noheader,nounits',
    ], { shell: true });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim().split('\n').filter(Boolean).map(line => {
          const c = line.split(',').map(s => s.trim());
          return { pid: c[0] || '?', name: c[1] || 'unknown', memMiB: parseInt(c[2]) || 0 };
        }));
      } else {
        resolve([]);
      }
    });
    proc.on('error', () => resolve([]));
  }));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  // ── Auto-update (production only) ──
  updater.init(mainWindow);

  ipcMain.on('check-for-updates', () => updater.manualCheck());
  ipcMain.on('quit-and-install', () => updater.quitAndInstall());

  // ── Version picker (in-app install of any published release) ──

  /** List published GitHub releases for the version picker. */
  ipcMain.handle('list-releases', async () => ({
    current: app.getVersion(),
    releases: await releases.listReleases(),
  }));

  /**
   * Download the chosen release's .exe installer and run it (NSIS silent),
   * then quit so the installer can replace the running files.
   * Ordering matters: spawn detached BEFORE quit — the installer must survive app exit.
   */
  ipcMain.handle('install-release', async (_e, _tag, asset) => {
    if (!asset || typeof asset.url !== 'string'
        || !/^(https:\/\/([a-z0-9.-]*github\.com|objects\.githubusercontent\.com)\/)/.test(asset.url)) {
      throw new Error('Invalid asset URL');
    }
    const send = (n, d) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater-event', n, d);
    };
    try {
      const dir = path.join(os.tmpdir(), 'gpu-monitor-updates');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, asset.name);
      await releases.downloadAsset(asset.url, dest, (pct) => send('release-progress', pct));
      send('release-installing', '');
      // Launch the installer. A raw CreateProcess of a just-downloaded exe in %TEMP%
      // is frequently denied on Windows (EACCES) — Defender's real-time scan still
      // holds the file, or it's marked "from the internet". The shell path a
      // double-click uses works, so wait for AV to release, then `start` it (retrying).
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const launch = () => process.platform === 'win32'
        ? spawn(`start "" "${dest}" /S`, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(dest, ['/S'], { detached: true, stdio: 'ignore' });
      let child = null, lastErr = null;
      for (let i = 0; i < 6; i++) {
        await sleep(1500); // give Defender time to finish scanning / release the file
        try { child = launch(); break; } catch (e) { lastErr = e; }
      }
      if (!child) {
        const msg = (lastErr && lastErr.message) || 'Failed to launch installer';
        send('release-error', msg);
        throw lastErr || new Error(msg);
      }
      child.unref();
      // Brief pause so the installer grabs its file handles (and UAC) before we exit
      setTimeout(() => forceQuit(), 800);
    } catch (err) {
      send('release-error', err.message || String(err));
      throw err;
    }
  });

  // ── System tray ──
  createTray(mainWindow);

  // On close: always hide to tray (the "Close to tray" setting is gone —
  // real quit is the ⏻ button / tray-menu Quit, which go through forceQuit)
  mainWindow.on('close', (e) => {
    if (!firstShown || forceQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
