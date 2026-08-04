// Debug mode - uncomment to diagnose silent failures
// console.log('[GPU Monitor] renderer loaded');

// State
let paused = false;
let gpus = [];
let errorState = null;
let updateTimer = null;
let config = {};

// DOM refs
const $container = document.getElementById('gpu-container');
const $settings = document.getElementById('settings-panel');

// Settings UI
function initSettingsUI() {
  // Build a display-friendly view of config (normalize key names & ranges)
  const cfg = { ...config };
  cfg.interval      = cfg.updateInterval ?? 1000;
  cfg.opacity       = Math.round((cfg.opacity || 1) * 100);   // store as 0-1 → UI expects 30-100

  const sliders = [
    { input: 'set-interval', display: 'val-interval', suffix: 'ms' },
    { input: 'set-opacity',  display: 'val-opacity',  suffix: '%' },
  ];
  sliders.forEach(({ input, display, suffix }) => {
    const key = input.replace('set-', '');
    const el  = document.getElementById(input);
    const disp = document.getElementById(display);
    if (el) el.value = cfg[key] ?? parseInt(el.min);
    if (disp && el) disp.textContent = el.value + suffix;
  });

  const showProcs = document.getElementById('set-show-processes');
  if (showProcs) showProcs.value = config.showProcesses ? 'true' : 'false';

  const procLimit = document.getElementById('set-process-limit');
  if (procLimit) procLimit.value = config.processLimit || 5;

  const themeSel = document.getElementById('set-theme');
  if (themeSel) themeSel.value = config.theme || 'nvidia';
}

// Init
async function init() {
  try {
    const remoteCfg = await window.electron.getConfig();
    if (remoteCfg) Object.assign(config, remoteCfg);
  } catch (e) { /* ignore */ }

  document.documentElement.setAttribute('data-theme', config.theme || 'nvidia');

  const $status = document.getElementById('page-status');
  if ($status) { $status.style.display = 'none'; }

  if ($container) { $container.style.display = ''; }

  initSettingsUI();
  render();
  updateLoop();
}

// Data Fetching
async function fetchGPUs() {
  try {
    const lines = await window.electron.querySmi();
    const procs = await window.electron.queryProcesses();

    if (!Array.isArray(lines) || !lines.length) {
      errorState = lines?.length === 0 ? 'No GPU detected by nvidia-smi' : 'nvidia-smi returned unexpected format';
      gpus = [];
      return;
    }

    gpus = lines.map((line, i) => {
      const c = line.split(',').map(s => s.trim());
      const n = (idx) => idx < c.length ? parseFloat(c[idx]) : null;
      return {
        index: n(2) ?? i, name: c[0], uuid: c[1] || '',
        temperature: n(3), powerDraw: n(4),
        gpuUtil: n(5), memUtil: n(6), memoryUsed: n(7), memoryTotal: n(8),
        gpuClock: n(9), memClock: n(10), fanSpeed: n(11),
      };
    });

    errorState = gpus.length ? null : 'nvidia-smi returned data but no valid GPU entries found';
    gpus._procs = procs || [];
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('not found') || msg.includes('ENOENT')) {
      errorState = 'nvidia-smi not found - ensure NVIDIA driver is installed and nvidia-smi is in your PATH';
    } else if (msg.includes('Field')) {
      errorState = 'nvidia-smi field error: ' + msg + '. Try updating your NVIDIA driver.';
    } else {
      errorState = 'nvidia-smi failed (' + (err?.code || 'unknown') + '): ' + msg;
    }
    gpus = [];
  }
}

// Rendering helpers
function mItemId(id, icon, label, value, max, suffix, color) {
  return '<div class="metric-item" data-metric="' + id + '">' +
    '<span class="metric-icon">' + icon + '</span>' +
    '<span class="metric-label">' + label + '</span>' +
    (max != null || value != null ? '<div class="metric-gauge"><div class="metric-fill" style="width:' + ((value != null && max) ? Math.min(100, (value / max) * 100) : 0) + '%;background:' + color + '"></div></div>' : '') +
    '<span class="metric-value">' + (value != null ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--') + (suffix ? ' ' + suffix : '') + '</span></div>';
}

function getSlot(id) { return $container.querySelector('[data-metric="' + id + '"]'); }

function patchFill(id, value, max, color) {
  const fill = getSlot(id)?.querySelector('.metric-fill');
  if (fill && max != null) {
    fill.style.width = (value != null ? Math.min(100, (value / max) * 100) : 0) + '%';
    if (color != null) fill.style.background = color;
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtMiB(m) { if (m == null) return '?'; if (m >= 1024) return (m / 1024).toFixed(1) + ' GB'; return m + ' MB'; }

// Color helpers
function tempColor(t) {
  if (t == null) return 'transparent';
  if (t < 50) return 'var(--temp-good)';
  if (t < 65) return 'var(--temp-warn)';
  if (t < 78) return 'var(--temp-hot)';
  return 'var(--temp-crit)';
}
function powerColor(d, l) {
  if (d == null || l == null) return 'transparent';
  const p = d / l;
  if (p < 0.4) return 'var(--temp-good)';
  if (p < 0.7) return 'var(--temp-warn)';
  return 'var(--temp-hot)';
}
function loadColor(u) {
  if (u == null) return 'transparent';
  if (u < 40) return 'var(--temp-good)';
  if (u < 70) return 'var(--temp-warn)';
  if (u < 90) return 'var(--temp-hot)';
  return 'var(--temp-crit)';
}
function vramColor(used, tot) {
  if (used == null || tot == null) return 'transparent';
  const p = used / tot;
  if (p < 0.6) return 'var(--temp-good)';
  return 'var(--temp-crit)';
}

// Patch process list in-place
function patchProcessList(container, procs, limit) {
  const existing = container.querySelectorAll('[data-proc-pid]');
  const pidSet = new Set();

  for (let i = 0; i < Math.min(procs.length, limit); i++) {
    const p = procs[i];
    pidSet.add(p.pid);
    let row = container.querySelector('[data-proc-pid="' + esc(p.pid) + '"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'process-item';
      row.dataset.procPid = p.pid;
      row.innerHTML = '<span class="process-pid"></span><span class="process-name"></span><span class="process-mem"></span>';
      container.appendChild(row);
    }
    row.querySelector('.process-pid').textContent = esc(p.pid);
    row.querySelector('.process-name').textContent = esc(p.name);
    row.querySelector('.process-mem').textContent = fmtMiB(p.memMiB);
  }

  existing.forEach(row => {
    if (!pidSet.has(row.dataset.procPid)) row.remove();
  });

  const nothing = container.querySelector('.proc-empty');
  if (procs.length === 0) {
    if (!nothing) {
      const div = document.createElement('div');
      div.className = 'proc-empty';
      div.style.cssText = 'text-align:center;color:#7d94b3;font-size:12px;padding:8px;';
      div.textContent = 'No processes';
      container.appendChild(div);
    }
  } else if (nothing) {
    nothing.remove();
  }
}

// Render
function render() {
  if (!gpus.length) {
    const errMsg = errorState ? '<br><span style="color:#fb923c;font-size:12px;margin-top:8px;display:block;">' + esc(errorState) + '</span>' : '';
    $container.innerHTML =
      '<div style="text-align:center;padding:60px 24px;color:#7d94b3;font-size:13px;">' +
      '&#x26A1; No NVIDIA GPU detected.' + errMsg +
      '<br><span style="font-size:11px;margin-top:12px;display:block;opacity:.7;">Ensure nvidia-smi is in your PATH and the NVIDIA driver is installed.</span></div>';
    return;
  }

  // Build structure once, patch values after.
  if ($container.dataset.renderDone !== '1') {
    // First render: build DOM structure
    $container.innerHTML = gpus.map((gpu, i) =>
      '<div class="gpu-card">' +
        '<div class="gpu-header">' +
          '<div class="gpu-accent"></div>' +
          '<div class="gpu-name" title="' + esc(gpu.name) + '">' + esc(gpu.name) + '</div>' +
          '<span class="gpu-index">GPU ' + gpu.index + '</span>' +
        '</div>' +
        '<div class="metrics-row">' +
          mItemId('temp', '🌡️', 'Temp', gpu.temperature, 120, '°C', tempColor(gpu.temperature)) +
          mItemId('power', '⚡️', 'Power', gpu.powerDraw, 300, 'W', powerColor(gpu.powerDraw, 300)) +
          mItemId('gpu-load', '📈', 'GPU Load', gpu.gpuUtil, 100, '%', loadColor(gpu.gpuUtil)) +
          mItemId('mem-load', '🧠', 'Mem Load', gpu.memUtil, 100, '%', loadColor(gpu.memUtil)) +
          '<div class="metric-item" data-metric="vram">' +
            '<span class="metric-icon">💾</span>' +
            '<span class="metric-label">VRAM</span>' +
            '<div class="metric-gauge"><div class="metric-fill" style="width:' + (gpu.memoryUsed != null && gpu.memoryTotal != null ? Math.min(100, (gpu.memoryUsed / gpu.memoryTotal) * 100) : 0) + '%;background:' + vramColor(gpu.memoryUsed, gpu.memoryTotal) + '"></div></div>' +
            '<span class="metric-value">' + fmtMiB(gpu.memoryUsed) + '/' + fmtMiB(gpu.memoryTotal) + '</span></div>' +
          mItemId('gpu-clock', '🔁', 'GPU Clock', gpu.gpuClock, null, 'MHz', null) +
          mItemId('mem-clock', '🔧', 'Mem Clock', gpu.memClock, null, 'MHz', null) +
          mItemId('fan', '🟨', 'Fan', gpu.fanSpeed, 100, '%', null) +
        '</div>' +
      '</div>'
    ).join('');

    $container.dataset.renderDone = '1';

    // Process list (also built once)
    const procs = gpus._procs || [];
    if (config.showProcesses && config.processLimit > 0 && procs.length) {
      $container.innerHTML += '<div class="gpu-card">' +
        '<div class="process-list" data-proc-list>' + procs.map(p =>
          '<div class="process-item" data-proc-pid="' + esc(p.pid) + '">' +
            '<span class="process-pid">' + esc(p.pid) + '</span>' +
            '<span class="process-name">' + esc(p.name) + '</span>' +
            '<span class="process-mem">' + fmtMiB(p.memMiB) + '</span>' +
          '</div>'
        ).join('') + '</div></div>';
    }
  } else {
    // Subsequent renders: patch values in-place (no DOM reconstruction).
    const gpu = gpus[0];

    // Temp gauge + value
    patchFill('temp', gpu.temperature, 120, tempColor(gpu.temperature));
    getSlot('temp').querySelector('.metric-value').textContent = gpu.temperature != null ? (Number.isInteger(gpu.temperature) ? gpu.temperature : gpu.temperature.toFixed(1)) + '°C' : '--';

    // Power gauge + value
    patchFill('power', gpu.powerDraw, 300, powerColor(gpu.powerDraw, 300));
    getSlot('power').querySelector('.metric-value').textContent = gpu.powerDraw != null ? (Number.isInteger(gpu.powerDraw) ? gpu.powerDraw : gpu.powerDraw.toFixed(1)) + ' W' : '--';

    // GPU Load gauge + value
    patchFill('gpu-load', gpu.gpuUtil, 100, loadColor(gpu.gpuUtil));
    getSlot('gpu-load').querySelector('.metric-value').textContent = gpu.gpuUtil != null ? gpu.gpuUtil + '%' : '--';

    // Mem Load gauge + value
    patchFill('mem-load', gpu.memUtil, 100, loadColor(gpu.memUtil));
    getSlot('mem-load').querySelector('.metric-value').textContent = gpu.memUtil != null ? gpu.memUtil + '%' : '--';

    // VRAM gauge + value
    patchFill('vram', gpu.memoryUsed, gpu.memoryTotal, vramColor(gpu.memoryUsed, gpu.memoryTotal));
    getSlot('vram').querySelector('.metric-value').textContent = (gpu.memoryUsed != null && gpu.memoryTotal != null) ? fmtMiB(gpu.memoryUsed) + '/' + fmtMiB(gpu.memoryTotal) : '--';

    // GPU Clock gauge + value
    patchFill('gpu-clock', gpu.gpuClock, null, null);
    getSlot('gpu-clock').querySelector('.metric-value').textContent = gpu.gpuClock != null ? (Number.isInteger(gpu.gpuClock) ? gpu.gpuClock : gpu.gpuClock.toFixed(1)) + ' MHz' : '--';

    // Mem Clock gauge + value
    patchFill('mem-clock', gpu.memClock, null, null);
    getSlot('mem-clock').querySelector('.metric-value').textContent = gpu.memClock != null ? (Number.isInteger(gpu.memClock) ? gpu.memClock : gpu.memClock.toFixed(1)) + ' MHz' : '--';

    // Fan gauge + value
    patchFill('fan', gpu.fanSpeed, 100, null);
    getSlot('fan').querySelector('.metric-value').textContent = gpu.fanSpeed != null ? gpu.fanSpeed + '%' : '--';

    // Patch process list in-place
    const procContainer = $container.querySelector('[data-proc-list]');
    if (procContainer && config.showProcesses && config.processLimit > 0) {
      patchProcessList(procContainer, gpus._procs || [], config.processLimit);
    }
  }
}

// Update Loop
async function updateLoop() {
  if (paused) { updateTimer = setTimeout(updateLoop, 1000); return; }
  await fetchGPUs();
  render();
  updateTimer = setTimeout(updateLoop, config.updateInterval || 1000);
}

// Pin button emoji sync
function syncPinState() {
  const $pin = document.getElementById('btn-pin');
  if (!$pin) return;
  $pin.textContent = config.alwaysOnTop ? '📌' : '📌';
  $pin.style.opacity = config.alwaysOnTop ? '1' : '0.4';
}

// Controls
document.getElementById('btn-pause').addEventListener('click', () => {
  paused = !paused;
  document.getElementById('btn-pause').textContent = paused ? '▶' : '⏸';
});

document.getElementById('btn-pin').addEventListener('click', async () => {
  config.alwaysOnTop = !config.alwaysOnTop;
  syncPinState();
  try { await window.electron.updateConfig({ alwaysOnTop: config.alwaysOnTop }); } catch {}
});

// Pin button hover — restore full brightness when hovering faded pin
const $pinBtn = document.getElementById('btn-pin');
if ($pinBtn) {
  $pinBtn.addEventListener('mouseenter', () => { $pinBtn.style.opacity = '1'; });
  $pinBtn.addEventListener('mouseleave', () => syncPinState());
}

document.getElementById('btn-settings').addEventListener('click', () => $settings.classList.toggle('hidden'));
document.getElementById('btn-settings-close').addEventListener('click', () => $settings.classList.add('hidden'));
document.getElementById('btn-close').addEventListener('click', async () => { try { await window.electron.quit(); } catch {} });

// Settings sliders
['set-interval', 'set-opacity'].forEach(id => {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('input', (e) => {
    // Normalize key names back to what the main process expects
    const nameMap = { interval: 'updateInterval' };
    const saveKey = nameMap[id.replace('set-', '')] ?? id.replace('set-', '');
    const val = +e.target.value;
    const display = document.getElementById('val-' + id.split('-')[1]);
    if (display) display.textContent = id.includes('interval') ? val + 'ms' : id.includes('opacity') ? val + '%' : val + 'px';
    config[saveKey] = saveKey === 'opacity' ? val / 100 : val;
    try { window.electron.updateConfig({ [saveKey]: saveKey === 'opacity' ? val / 100 : val }); } catch {}
  });
});

document.getElementById('set-show-processes').addEventListener('change', (e) => { config.showProcesses = e.target.value === 'true'; try { window.electron.updateConfig({ showProcesses: config.showProcesses }); } catch {} });
document.getElementById('set-process-limit').addEventListener('change', (e) => { config.processLimit = +e.target.value; try { window.electron.updateConfig({ processLimit: config.processLimit }); } catch {} });

document.getElementById('set-theme').addEventListener('change', (e) => {
  config.theme = e.target.value;
  document.documentElement.setAttribute('data-theme', e.target.value);
  try { window.electron.updateConfig({ theme: config.theme }); } catch {}
});

// ── Update management ──
let updateInfo = null; // cached info for restart dialog

function showUpdateOverlay(info) {
  const $overlay = document.getElementById('update-overlay');
  const $info = document.getElementById('update-info');
  if (!$overlay || !$info) return;
  updateInfo = info;
  $info.textContent = info?.version ? `v${info.version}` : '';
  $overlay.classList.remove('hidden');
}

function hideUpdateOverlay() {
  const $overlay = document.getElementById('update-overlay');
  if ($overlay) $overlay.classList.add('hidden');
}

document.getElementById('btn-check-updates').addEventListener('click', () => {
  const $status = document.getElementById('update-status');
  if ($status) $status.textContent = 'Checking...';
  try { window.electron.checkForUpdates(); } catch {}
});

document.getElementById('btn-restart-update').addEventListener('click', () => {
  hideUpdateOverlay();
  try { window.electron.restartAndInstall(); } catch {}
});

document.getElementById('btn-later-update').addEventListener('click', () => {
  hideUpdateOverlay();
  updateInfo = null;
});

// Listen for update events from main process via IPC bridge
window.electron.onUpdaterEvent(({ event, data }) => {
  switch (event) {
    case 'update-downloaded':
      try { showUpdateOverlay(JSON.parse(data)); } catch { showUpdateOverlay({}); }
      break;
    case 'checking-for-update':
      document.getElementById('update-status').textContent = 'Checking...';
      break;
    case 'update-not-available':
      document.getElementById('update-status').textContent = 'Up to date.';
      break;
    case 'error':
      document.getElementById('update-status').textContent = `Error: ${data}`;
  }
});

// Drag
(function initDrag() {
  const bar = document.querySelector('.topbar'); if (!bar) return;
  let dragging = false, sx, sy, origX, origY;
  bar.addEventListener('mousedown', async (e) => {
    if (e.target.closest('.controls button')) return;
    const bounds = await window.electron.getWindowBounds();
    dragging = true; sx = e.screenX; sy = e.screenY; origX = bounds.x || 0; origY = bounds.y || 0;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.screenX - sx, dy = e.screenY - sy;
    window.electron.moveWindow(origX + dx, origY + dy);
  });
  window.addEventListener('mouseup', () => { dragging = false; });
})();

init();
syncPinState();
