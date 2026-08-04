const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const updater = require('./updater');
const fs   = require('fs');
const { spawn } = require('child_process');

// ── Config ──
const CONFIG_DIR = path.join(app.getPath('appData'), 'gpu-monitor');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return null; }
}

function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

const DEFAULT_CFG = Object.freeze({
  windowWidth: 480, windowHeight: 360, opacity: 1.0,
  updateInterval: 1000, pinTopLeft: true, alwaysOnTop: true,
  showProcesses: true, processLimit: 5, theme: 'nvidia',
});

let config = { ...DEFAULT_CFG };
const savedConfig = loadConfig();
if (savedConfig) Object.assign(config, savedConfig);

// ── Window ──
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
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // ── IPC handlers ──

  // nvidia-smi possible locations (fallback if not in PATH)
  const NVIDIA_PATHS = [
    'nvidia-smi',
    'C:\\Windows\\System32\\nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    process.env.NVSMI_PATH,
  ].filter(Boolean);

  function findNvidiaSmi() {
    for (const p of NVIDIA_PATHS) {
      if (p === 'nvidia-smi') return p; // let the OS find it in PATH
      try { require('child_process').execSync(`"${p}" --version`, { stdio: 'ignore' }); return p; } catch {}
    }
    return null;
  }

  const NVSMI_BIN = findNvidiaSmi() || 'nvidia-smi'; // last resort — will fail if not found

  ipcMain.handle('query-smi', () => new Promise((resolve) => {
    const args = [
      '--query-gpu=name,uuid,index,temperature.gpu,power.draw,' +
      'utilization.gpu,utilization.memory,' +
      'memory.used,memory.total,clocks.current.graphics,' +
      'clocks.current.memory,fan.speed',
      '--format=csv,noheader,nounits',
    ];

    const proc = spawn(NVSMI_BIN, args);
    let stdout = '', stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim().split('\n').filter(Boolean));
      } else {
        resolve([]);
      }
    });
    proc.on('error', () => resolve([]));
  }));

  ipcMain.handle('get-config', () => ({ ...config }));

  ipcMain.on('config-change', (_, newCfg) => {
    Object.assign(config, newCfg);
    saveConfig(config);
    if (newCfg.opacity != null && mainWindow) mainWindow.setOpacity(newCfg.opacity);
    if (newCfg.alwaysOnTop != null && mainWindow) mainWindow.setAlwaysOnTop(newCfg.alwaysOnTop);
  });

  ipcMain.on('quit-app', () => app.quit());

  // Window position control
  ipcMain.handle('get-window-bounds', () => mainWindow?.getBounds() || {});
  ipcMain.on('move-window', (_, x, y) => {
    if (mainWindow) mainWindow.setPosition(Math.max(0, x), Math.max(0, y));
  });

  // Compute process list query
  ipcMain.handle('query-processes', () => new Promise((resolve) => {
    const proc = spawn(NVSMI_BIN, [
      '--query-compute-apps=pid,process_name,used_memory',
      '--format=csv,noheader,nounits',
    ]);
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
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
