// Global error capture — silent crashes land in the DevTools console instead of vanishing
(function _globalErrorMonitor() {
  window.onerror = function(msg, _url, lineNo, colNo, err) {
    console.error('[GPU-Monitor] FATAL:', (err && err.stack) || (msg + ' @ ' + lineNo + ':' + colNo));
    return false;
  };
  window.addEventListener('unhandledrejection', function(e) {
    console.error('[GPU-Monitor] UNHANDLED PROMISE:', (e.reason && e.reason.stack) || String(e.reason));
  });
})();

// State
let paused = false;
let gpus = [];
let errorState = null;
let updateTimer = null;
let config = {};

// DOM refs
const $container = document.getElementById('gpu-container');
console.log('[GPU Monitor] renderer.js loaded — Electron:', typeof window.electron, 'gpu-container:', !!$container);

// Per-metric show/hide — single source of truth. `id` matches the data-metric
// rows built in render(); `key` is the config boolean; `label` is the UI name.
const METRICS = [
  { id: 'temp', key: 'showTemp', label: 'Temp' },
  { id: 'power', key: 'showPower', label: 'Power' },
  { id: 'gpu-load', key: 'showGpuLoad', label: 'GPU Load' },
  { id: 'mem-load', key: 'showMemLoad', label: 'Mem Load' },
  { id: 'vram', key: 'showVram', label: 'VRAM' },
  { id: 'gpu-clock', key: 'showGpuClock', label: 'GPU Clock' },
  { id: 'mem-clock', key: 'showMemClock', label: 'Mem Clock' },
  { id: 'fan', key: 'showFan', label: 'Fan' },
];

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

  METRICS.forEach(({ id, key }) => {
    const sel = document.getElementById('set-show-' + id);
    if (sel) sel.value = config[key] !== false ? 'true' : 'false';
  });

  const sparkSel = document.getElementById('set-show-sparklines');
  if (sparkSel) sparkSel.value = config.showSparklines !== false ? 'true' : 'false';

  const hist = document.getElementById('set-sparkline-history');
  if (hist) {
    hist.value = config.sparklineHistorySeconds || 60;
    const histDisp = document.getElementById('val-sparkline-history');
    if (histDisp) histDisp.textContent = hist.value + 's';
  }
}

// Dark dropdowns — replace the native <select> popup (which stays white on
// Windows despite `color-scheme: dark`) with a styled button + option list.
// The native select stays the hidden value store, so every existing `change`
// handler fires unchanged via dispatchEvent(new Event('change')).
function initDarkDropdowns() {
  try {
    const lists = [];
    const closeAll = (except) => lists.forEach(l => { if (l !== except) l.style.display = 'none'; });
    document.querySelectorAll('.settings-body select').forEach(sel => {
      const wrap = document.createElement('div');
      wrap.className = 'dd'; wrap.id = 'dd-' + sel.id;
      const btn  = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn';
      const list = document.createElement('div');   list.className = 'dd-list'; list.style.display = 'none';
      wrap.appendChild(btn); wrap.appendChild(list);
      sel.insertAdjacentElement('beforebegin', wrap);
      sel.classList.add('dd-native'); // display:none !important — hides the real control only
      // The release picker starts inline-hidden; keep its wrapper hidden until first refresh.
      if (sel.style.display === 'none') wrap.style.display = 'none';
      const sync = () => {
        btn.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
        list.innerHTML = '';
        Array.from(sel.options).forEach(opt => {
          const b = document.createElement('button'); b.type = 'button';
          b.textContent = opt.textContent; b.disabled = !!opt.disabled;
          b.className = 'dd-opt' + (opt.value === sel.value ? ' dd-opt-sel' : '');
          b.addEventListener('click', () => {
            sel.value = opt.value; sync(); closeAll(list);
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          });
          list.appendChild(b);
        });
      };
      sync();
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = list.style.display === 'none'; closeAll(list);
        if (opening) { sync(); list.style.display = 'block'; } // re-read options each open → dynamic release list
      });
      lists.push(list);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.dd')) closeAll(); });
  } catch (e) { console.error('[GPU Monitor] dark dropdowns init failed:', e); }
}

// Init
async function init() {
  try {
    const remoteCfg = await window.electron.getConfig();
    if (remoteCfg) Object.assign(config, remoteCfg);
  } catch (e) { /* ignore config load failure — defaults used */ }

  document.documentElement.setAttribute('data-theme', config.theme || 'nvidia');

  // Always hide loading state immediately so user sees output (or error)
  var $loader = document.getElementById('loading-state');
  if ($loader) { $loader.style.setProperty('display', 'none', 'important'); }

  // If gpu-container is missing from the DOM, we can't render anything — show inline error.
  if (!$container) {
    console.error('[GPU Monitor] #gpu-container not found in DOM — check index.html');
    document.body.innerHTML += '<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#f85149;font-size:16px;z-index:9999;">FATAL: gpu-container missing</div>';
    return;
  }

  errorState = null;       // clear any stale error state before first render
  gpus = [];               // ensure empty array so render shows status message

  initSettingsUI();
  initDarkDropdowns();

  render();
  updateLoop();
}

// Data Fetching
async function fetchGPUs() {
  try {
    console.log('[GPU Monitor] fetching nvidia-smi...');
    const lines = await window.electron.querySmi();
    console.log('[GPU Monitor] nvidia-smi returned:', Array.isArray(lines) ? lines.length + ' rows' : typeof lines, lines);

    if (!Array.isArray(lines) || !lines.length) {
      errorState = lines?.length === 0 ? 'No GPU detected by nvidia-smi' : 'nvidia-smi returned unexpected format';
      gpus = [];
      console.warn('[GPU Monitor] no GPU data');
      return;
    }

    // Fetch processes in parallel (no-op if unavailable) — must be awaited BEFORE map completes
    const procsPromise = window.electron.queryProcesses().catch(() => []);
    gpus = lines.map((line, i) => {
      const c = line.split(',').map(s => s.trim());
      // nvidia-smi reports "[Not Supported]"/"[N/A]" for some fields (e.g. fan on fanless SXM) —
      // parseFloat gives NaN, which slips past `!= null` checks downstream and renders as "NaN%". Normalize to null.
      const n = (idx) => { if (idx >= c.length) return null; const v = parseFloat(c[idx]); return isNaN(v) ? null : v; };
      return {
        index: n(2) ?? i, name: c[0] || 'Unknown', uuid: c[1] || '',
        temperature: n(3), powerDraw: n(4), powerLimit: n(5),
        gpuUtil: n(6), memUtil: n(7), memoryUsed: n(8), memoryTotal: n(9),
        gpuClock: n(10), memClock: n(11), fanSpeed: n(12),
      };
    });

    // Now await processes and attach — must happen after GPU objects are built
    gpus._procs = await procsPromise;
    console.log('[GPU Monitor] parsed', gpus.length, 'GPU(s):', gpus.map(g => g.name));
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
    console.error('[GPU Monitor] fetchGPUs error:', err);
  }
}

// Rendering helpers — stat row with clickable icon button for sparkline selection
function mItemIdStatRow(id, icon, label, value, max, suffix, color) {
  if (value != null && isNaN(value)) value = null; // nvidia-smi reports "[Not Supported]" as NaN (e.g. fanless SXM GPUs)
  var barHtml = '';
  if (max != null || value != null) {
    var pct = (value != null && max) ? Math.min(100, (value / max) * 100) : 0;
    barHtml = '<div class="stat-bar"><div class="stat-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
  }
  return '<div class="stat-row" data-metric="' + id + '">' +
    '<button class="stat-icon-btn" data-spark-metric="' + id + '" title="Select for sparkline">' + icon + '</button>' +
    '<span class="stat-label">' + label + '</span>' +
    barHtml +
    '<span class="stat-value">' + (value != null ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--') + (suffix ? ' ' + suffix : '') + '</span></div>';
}

function getSlot(id) { return $container.querySelector('[data-metric="' + id + '"]'); }

function patchFill(id, value, max, color) {
  const row = getSlot(id);
  if (!row) return;
  var fill = row.querySelector('.stat-fill') || row.querySelector('.metric-fill');
  if (fill && max != null) {
    fill.style.width = (value != null ? Math.min(100, (value / max) * 100) : 0) + '%';
    if (color != null) fill.style.background = color;
  }
}

function patchValue(id, text) {
  var row = getSlot(id);
  if (!row) return;
  // Stat rows use .stat-value; legacy items use .metric-value
  var valEl = row.querySelector('.stat-value') || row.querySelector('.metric-value');
  if (valEl) valEl.textContent = text;
}

function patchFillCtx(id, value, max, color, $card) {
  if (!$card) return;
  var row = $card.querySelector('[data-metric="' + id + '"]');
  if (!row) return;
  var fill = row.querySelector('.stat-fill') || row.querySelector('.metric-fill');
  if (fill && max != null) {
    fill.style.width = (value != null ? Math.min(100, (value / max) * 100) : 0) + '%';
    if (color != null) fill.style.background = color;
  }
}

function patchValueCtx(id, text, $card) {
  var row = getSlot(id);
  if (!row) return;
  var valEl = row.querySelector('.stat-value') || row.querySelector('.metric-value');
  if (valEl) valEl.textContent = text;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtMiB(m) { if (m == null) return '?'; if (m >= 1024) return (m / 1024).toFixed(1) + ' GB'; return m + ' MB'; }

// Per-metric visibility — the rows are built ONCE (renderDone), so toggling
// hides/shows the existing rows instead of rebuilding them. Hidden rows stay in
// the DOM so per-tick patching keeps working.
function applyMetricRowVisibility() {
  METRICS.forEach(({ id, key }) => {
    document.querySelectorAll('.gpu-card [data-metric="' + id + '"]')
      .forEach(r => { r.style.display = config[key] !== false ? '' : 'none'; });
  });
}

// Sparkline panel visibility — hides the whole canvas (including its
// min-height dead space) when sparklines are off, so the card stays compact.
function applySparklineVisibility() {
  document.querySelectorAll('.sparkline-canvas')
    .forEach(c => { c.style.display = config.showSparklines !== false ? '' : 'none'; });
}

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

// Global: currently active metric per GPU (set by user clicking stat icons)
let $selectedMetrics = {};

// Sparkline buffer state lives in sparklines.js (loaded first) — gpuBuffers is its global.

/** Create a new sparkline buffer with the correct size based on history and interval. */
function createSparklineBuffer(gpuIdx, metricId, bufferSize) {
  if (!gpuBuffers[gpuIdx]) gpuBuffers[gpuIdx] = {};
  gpuBuffers[gpuIdx][metricId] = new SparklineBuffer(bufferSize);
}

/** Push current GPU values into sparkline buffers. */
function pushToSparklines(gpuIdx, gpu) {
  var target = gpuBuffers[gpuIdx];
  if (!target) return;

  var mappings = [
    ['temp',     gpu.temperature,       120],
    ['power',    null,                  100],
    ['gpu-load', gpu.gpuUtil,           100],
    ['mem-load', gpu.memUtil,           100],
    ['vram',     null,                  100],
    ['fan',      gpu.fanSpeed,          100],
  ];

  mappings.forEach(function(pair) {
    var key = pair[0], rawVal = pair[1], maxVal = pair[2];
    if (key === 'power') {
      rawVal = gpu.powerDraw != null && gpu.powerLimit != null && gpu.powerLimit > 0
        ? (gpu.powerDraw / gpu.powerLimit) * 100 : null;
    } else if (key === 'vram') {
      rawVal = gpu.memoryUsed != null && gpu.memoryTotal != null && gpu.memoryTotal > 0
        ? Math.min(100, (gpu.memoryUsed / gpu.memoryTotal) * 100) : null;
    }
    if (rawVal == null || rawVal !== rawVal) return;
    var percentage = Math.max(0, Math.min(100, (rawVal / maxVal) * 100));
    var buf = target[key];
    if (buf) buf.push(percentage, Date.now());
  });

  // Clocks: raw MHz values from nvidia-smi, normalize to % of max clock
  ['gpu-clock', 'mem-clock'].forEach(function(key) {
    var rawVal = key === 'gpu-clock' ? gpu.gpuClock : gpu.memClock;
    var maxClock = key === 'gpu-clock' ? 3500 : 2500;
    if (rawVal == null || rawVal !== rawVal) return;
    var buf = target[key];
    if (buf) buf.push(Math.max(0, Math.min(100, (rawVal / maxClock) * 100)), Date.now());
  });
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
  // Safety: if container is somehow missing, create a fallback error message in body
  if (!$container) { return; }

  // If gpus has entries but no valid data (all null fields from bad nvidia-smi output),
  // treat it as no GPU detected to avoid blank/zero-width bars.
  var _hasValidGpuData = gpus.length > 0 && gpus.some(function(g) { return g && g.name; });

  if (!_hasValidGpuData) {
    // Force visible output — nothing should be hidden by CSS
    $container.innerHTML =
      '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fb923c;font-size:16px;z-index:500;text-align:center;width:100%;">' +
      '&#x26A1; No NVIDIA GPU detected.' + (errorState ? '<br><span style="font-size:12px;color:#7d94b3;">' + errorState + '</span>' : '') +
      '<br><span style="font-size:11px;color:#7d94b3;margin-top:8px;display:block;">Ensure nvidia-smi is in your PATH and the NVIDIA driver is installed.</span></div>';
    return;
  }

  // Build structure once, patch values after.
  if ($container.dataset.renderDone !== '1') {
    // First render: build DOM structure with stats container and sparkline canvas
    $container.innerHTML = gpus.map((gpu, i) =>
      '<div class="gpu-card">' +
        '<div class="gpu-header">' +
          '<div class="gpu-accent"></div>' +
          '<div class="gpu-name" title="' + esc(gpu.name) + '">' + esc(gpu.name) + '</div>' +
          '<span class="gpu-index">GPU ' + gpu.index + '</span>' +
        '</div>' +
        '<div data-stat-card="' + i + '" class="metrics-grid">' +
          mItemIdStatRow('temp', '🌡️', 'Temp', gpu.temperature, 120, '°C', tempColor(gpu.temperature)) +
          mItemIdStatRow('power', '⚡️', 'Power', gpu.powerDraw, gpu.powerLimit, 'W', powerColor(gpu.powerDraw, gpu.powerLimit)) +
          mItemIdStatRow('gpu-load', '📊', 'GPU Load', gpu.gpuUtil, 100, '%', loadColor(gpu.gpuUtil)) +
          mItemIdStatRow('mem-load', '🧠', 'Mem Load', gpu.memUtil, 100, '%', loadColor(gpu.memUtil)) +
          '<div class="stat-row" data-metric="vram">' +
            '<button class="stat-icon-btn" data-spark-metric="vram" title="Select for sparkline">💾</button>' +
            '<span class="stat-label">VRAM</span>' +
            (gpu.memoryUsed != null && gpu.memoryTotal != null ? '<div class="stat-bar"><div class="stat-fill" style="width:' + Math.min(100, (gpu.memoryUsed / gpu.memoryTotal) * 100) + '%;background:' + vramColor(gpu.memoryUsed, gpu.memoryTotal) + '"></div></div>' : '') +
            '<span class="metric-value">' + fmtMiB(gpu.memoryUsed) + '/' + fmtMiB(gpu.memoryTotal) + '</span></div>' +
          mItemIdStatRow('gpu-clock', '🔁', 'GCLK', gpu.gpuClock, null, 'MHz', null) +
          mItemIdStatRow('mem-clock', '🔧', 'MCLK', gpu.memClock, null, 'MHz', null) +
          mItemIdStatRow('fan', '🟩', 'Fan', gpu.fanSpeed, 100, '%', null) +
        '</div>' +
        '<div class="sparkline-canvas" data-sparkline-for="' + i + '"></div>' +
      '</div>'
    ).join('');

    // Initialize sparkline buffers for each GPU
    if (config.showSparklines) {
      var historySec = config.sparklineHistorySeconds || 60;
      gpus.forEach(function(gpu, i) {
        SPARKLINE_METRICS.forEach(function(m) {
          createSparklineBuffer(i, m.id, Math.round(historySec * (1000 / (config.updateInterval || 1000))));
        });
      });
    }

    $container.dataset.renderDone = '1';

    // Process list (also built once) — a section INSIDE the last GPU card (v1.0.1
    // single-card layout), not a separate card: saves the extra border + gap overhead.
    const procs = gpus._procs || [];
    if (config.showProcesses && config.processLimit > 0 && procs.length) {
      const lastCard = $container.querySelectorAll('.gpu-card')[gpus.length - 1];
      const list = document.createElement('div');
      list.className = 'process-list';
      list.setAttribute('data-proc-list', '');
      list.innerHTML = procs.map(p =>
        '<div class="process-item" data-proc-pid="' + esc(p.pid) + '">' +
          '<span class="process-pid">' + esc(p.pid) + '</span>' +
          '<span class="process-name">' + esc(p.name) + '</span>' +
          '<span class="process-mem">' + fmtMiB(p.memMiB) + '</span>' +
        '</div>'
      ).join('');
      lastCard.appendChild(list);
    }

    // Apply per-metric + sparkline visibility to the freshly built rows
    applyMetricRowVisibility();
    applySparklineVisibility();
  } else {
    // Subsequent renders: patch values in-place (no DOM reconstruction).
    // Iterate over ALL GPUs so each card gets its own data.
    gpus.forEach(function(gpu, gpuIdx) {
      var $gpuCard = $container.querySelectorAll('.gpu-card')[gpuIdx];
      if (!$gpuCard) return;
      var $card = $gpuCard.querySelector('[data-stat-card]');

      // Temp gauge + value
      patchFillCtx('temp', gpu.temperature, 120, tempColor(gpu.temperature), $card);
      patchValueCtx('temp', gpu.temperature != null ? (Number.isInteger(gpu.temperature) ? gpu.temperature : gpu.temperature.toFixed(1)) + '°C' : '--', $card);

      // Power gauge + value
      patchFillCtx('power', gpu.powerDraw, gpu.powerLimit, powerColor(gpu.powerDraw, gpu.powerLimit), $card);
      patchValueCtx('power', gpu.powerDraw != null ? (Number.isInteger(gpu.powerDraw) ? gpu.powerDraw : gpu.powerDraw.toFixed(1)) + ' W' : '--', $card);

      // GPU Load gauge + value
      patchFillCtx('gpu-load', gpu.gpuUtil, 100, loadColor(gpu.gpuUtil), $card);
      patchValueCtx('gpu-load', gpu.gpuUtil != null ? gpu.gpuUtil + '%' : '--', $card);

      // Mem Load gauge + value
      patchFillCtx('mem-load', gpu.memUtil, 100, loadColor(gpu.memUtil), $card);
      patchValueCtx('mem-load', gpu.memUtil != null ? gpu.memUtil + '%' : '--', $card);

      // VRAM gauge + value (dual display: used/total)
      patchFillCtx('vram', gpu.memoryUsed, gpu.memoryTotal, vramColor(gpu.memoryUsed, gpu.memoryTotal), $card);
      patchValueCtx('vram', (gpu.memoryUsed != null && gpu.memoryTotal != null) ? fmtMiB(gpu.memoryUsed) + '/' + fmtMiB(gpu.memoryTotal) : '--', $card);

      // GPU Clock gauge + value
      patchFillCtx('gpu-clock', gpu.gpuClock, null, null, $card);
      patchValueCtx('gpu-clock', gpu.gpuClock != null ? (Number.isInteger(gpu.gpuClock) ? gpu.gpuClock : gpu.gpuClock.toFixed(1)) + ' MHz' : '--', $card);

      // Mem Clock gauge + value
      patchFillCtx('mem-clock', gpu.memClock, null, null, $card);
      patchValueCtx('mem-clock', gpu.memClock != null ? (Number.isInteger(gpu.memClock) ? gpu.memClock : gpu.memClock.toFixed(1)) + ' MHz' : '--', $card);

      // Fan gauge + value
      patchFillCtx('fan', gpu.fanSpeed, 100, null, $card);
      patchValueCtx('fan', gpu.fanSpeed != null ? gpu.fanSpeed + '%' : '--', $card);
    });

    // Patch process list in-place
    const procContainer = $container.querySelector('[data-proc-list]');
    if (procContainer && config.showProcesses && config.processLimit > 0) {
      patchProcessList(procContainer, gpus._procs || [], config.processLimit);
    }

    // ── Sparkline SVG rendering during patch phase ──
    // CRITICAL: Query stats container first, then go UP to parent .gpu-card
    // because sparkline-canvas is a SIBLING of metrics-grid, not a child.
    if (config.showSparklines && gpus.length > 0) {
      // Use the first GPU with an active metric selection for sparkline display
      var sparkGpu = null;
      var sparkIdx = null;
      for (var si = 0; si < gpus.length; si++) {
        var $c = $container.querySelectorAll('.gpu-card')[si];
        if ($c && $c.dataset.sparkActive) { sparkGpu = gpus[si]; sparkIdx = parseInt(gpus[si].index); break; }
      }

      if (!sparkIdx && gpus.length > 0) {
        // No active selection on any card — check all for prompt rendering
        sparkIdx = parseInt(gpus[0].index);
        sparkGpu = gpus[0];
      }

      if (sparkGpu && sparkIdx != null) {
        var gpuCardArr = $container.querySelectorAll('.gpu-card');
        var $gpuCard = null;
        for (var ci = 0; ci < gpuCardArr.length; ci++) {
          var statInCard = gpuCardArr[ci].querySelector('[data-stat-card]');
          if (statInCard && parseInt(statInCard.dataset.statCard) === sparkIdx) { $gpuCard = gpuCardArr[ci]; break; }
        }

        // Also try direct query as fallback
        if (!$gpuCard) {
          var $statsContainer = $container.querySelector('[data-stat-card="' + sparkIdx + '"]');
          if ($statsContainer) $gpuCard = $statsContainer.closest('.gpu-card');
        }

        if ($gpuCard) {
          var metricName = $gpuCard.dataset.sparkActive || null;

          if (metricName) {
            // Ensure the sparkline pill row is visible
            var $pillRow = $gpuCard.querySelector('.sparkline-pill-row');
            if ($pillRow) $pillRow.classList.remove('sparkline-hidden');

            // Read from gpuBuffers (owned by sparklines.js) as source of truth
            var srcBuf = gpuBuffers[sparkIdx]?.[metricName];

            // Initialize buffer if it doesn't exist yet (early render or fresh start)
            if (!srcBuf) {
              if (!gpuBuffers[sparkIdx]) gpuBuffers[sparkIdx] = {};
              var initSize = Math.round((config.sparklineHistorySeconds || 60) * (1000 / (config.updateInterval || 1000)));
              createSparklineBuffer(sparkIdx, metricName, initSize);
              srcBuf = gpuBuffers[sparkIdx][metricName];
            }

            var data = srcBuf.getValues(); // { values, timestamps }

            var $canvas = $gpuCard.querySelector('.sparkline-canvas');
            if ($canvas) {
              if (data.values.length >= 2) {
                try {
                  var unitScale = METRIC_UNIT_SCALES[metricName] || { factor: 100, unit: '%' };
                  if (metricName === 'power' && sparkGpu.powerLimit != null && sparkGpu.powerLimit > 0) {
                    unitScale = { factor: sparkGpu.powerLimit, unit: 'W' };
                  }
                  var svgStr = renderSparklineSVG(data, 420, 50, sparkIdx, metricName, unitScale);
                  $canvas.innerHTML = svgStr;
                } catch (e) {
                  console.error('Sparkline render error:', e.message);
                  $canvas.innerHTML = '<span style="color:#fb923c;font-size:10px;padding:8px;">Render error</span>';
                }
              } else if (srcBuf.count > 0) {
                // Buffer has data but values were filtered out (likely all NaN/null). GPU metrics unavailable.
                $canvas.innerHTML = '<span style="color:#7dd3fc;font-size:10px;padding:8px;">Metrics not available</span>';
              } else {
                $canvas.innerHTML = '<span style="color:#7dd3fc;font-size:10px;padding:8px;font-weight:600;">Waiting for data...</span>';
              }
            }
          } else {
            // No selection yet — show prompt instead of graph data.
            var $promptCanvas = $gpuCard.querySelector('.sparkline-canvas');
            if ($promptCanvas) {
              $promptCanvas.innerHTML = '<span style="color:#7dd3fc;font-size:10px;padding:8px;font-weight:600;">Click a stat icon above to view graph</span>';
            }
          }

          // Push current GPU data into buffers for next render
          pushToSparklines(sparkIdx != null ? sparkIdx : 0, sparkGpu);
        }
      }
    }
  }
}

// Update Loop
async function updateLoop() {
  if (paused) { updateTimer = setTimeout(updateLoop, 1000); return; }

  console.log('[GPU Monitor] updateLoop tick: gpus=', gpus.length, 'errorState=', errorState);

  // Fetch GPU data with a hard timeout so we never hang indefinitely.
  const gpuDataPromise = fetchGPUs();
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));

  await Promise.race([gpuDataPromise, timeoutPromise]).catch(() => { /* ignore timeout */ });

  // Always render — even if nvidia-smi timed out, show "No GPU detected" so user knows what's happening.
  render();
  console.log('[GPU Monitor] rendered:', $container ? 'ok' : 'null', 'gpuCards:', $container ? $container.querySelectorAll('.gpu-card').length : '?');

  // Push data to sparkline buffers before next render cycle
  if (config.showSparklines && gpus.length > 0) {
    pushToSparklines(parseInt(gpus[0].index), gpus[0]);
  }

  updateTimer = setTimeout(updateLoop, config.updateInterval || 1000);
}

// Pin button emoji sync
function syncPinState() {
  const $pin = document.getElementById('btn-pin');
  if (!$pin) return;
  $pin.textContent = config.alwaysOnTop ? '📌' : '📌';
  $pin.style.opacity = config.alwaysOnTop ? '1' : '0.4';
}

// Controls — all guarded against missing DOM elements
var $pauseBtn = document.getElementById('btn-pause');
if ($pauseBtn) {
  $pauseBtn.addEventListener('click', () => {
    paused = !paused;
    var p = document.getElementById('btn-pause');
    if (p) p.textContent = paused ? '▶' : '⏸';
  });
}

var $pinBtn = document.getElementById('btn-pin');
if ($pinBtn) {
  $pinBtn.addEventListener('click', async () => {
    config.alwaysOnTop = !config.alwaysOnTop;
    syncPinState();
    try { await window.electron.updateConfig({ alwaysOnTop: config.alwaysOnTop }); } catch {}
  });
  // Pin button hover — restore full brightness when hovering faded pin
  $pinBtn.addEventListener('mouseenter', () => { $pinBtn.style.opacity = '1'; });
  $pinBtn.addEventListener('mouseleave', () => syncPinState());
}

var $settings = document.getElementById('settings-panel');
var $settingsBtn = document.getElementById('btn-settings');
if ($settingsBtn && $settings) $settingsBtn.addEventListener('click', () => $settings.classList.toggle('hidden'));

var $settingsClose = document.getElementById('btn-settings-close');
if ($settingsClose && $settings) $settingsClose.addEventListener('click', () => $settings.classList.add('hidden'));

// ✕ = minimize to tray (window hide — never fires the 'close' interceptor)
var $closeBtn = document.getElementById('btn-close');
if ($closeBtn) {
  $closeBtn.addEventListener('click', () => { try { window.electron.hideWindow(); } catch {} });
}

// ⏻ = full quit — forceQuit bypasses the minimize-to-tray close interceptor
var $quitBtn = document.getElementById('btn-quit');
if ($quitBtn) {
  $quitBtn.addEventListener('click', () => { try { window.electron.forceQuit(); } catch {} });
}

// Settings sliders
['set-interval', 'set-opacity'].forEach(id => {
  var el = document.getElementById(id); if (!el) return;
  el.addEventListener('input', (e) => {
    // Normalize key names back to what the main process expects
    var nameMap = { interval: 'updateInterval' };
    var saveKey = nameMap[id.replace('set-', '')] ?? id.replace('set-', '');
    var val = +e.target.value;
    var display = document.getElementById('val-' + id.split('-')[1]);
    if (display) display.textContent = id.includes('interval') ? val + 'ms' : id.includes('opacity') ? val + '%' : val + 'px';
    config[saveKey] = saveKey === 'opacity' ? val / 100 : val;
    try { window.electron.updateConfig({ [saveKey]: saveKey === 'opacity' ? val / 100 : val }); } catch {}
  });
});

var $showProcs = document.getElementById('set-show-processes');
if ($showProcs) {
  $showProcs.addEventListener('change', (e) => { config.showProcesses = e.target.value === 'true'; try { window.electron.updateConfig({ showProcesses: config.showProcesses }); } catch {} });
}

var $procLimit = document.getElementById('set-process-limit');
if ($procLimit) {
  $procLimit.addEventListener('change', (e) => { config.processLimit = +e.target.value; try { window.electron.updateConfig({ processLimit: config.processLimit }); } catch {} });
}

var $themeSel = document.getElementById('set-theme');
if ($themeSel) {
  $themeSel.addEventListener('change', (e) => {
    config.theme = e.target.value;
    document.documentElement.setAttribute('data-theme', e.target.value);
    resetAccentColor();
    try { window.electron.updateConfig({ theme: config.theme }); } catch {}
  });
}

// One change handler per metric (METRICS table) — hide/show the row + persist.
METRICS.forEach(({ id, key }) => {
  const el = document.getElementById('set-show-' + id);
  if (!el) return;
  el.addEventListener('change', (e) => {
    config[key] = e.target.value === 'true';
    applyMetricRowVisibility();
    try { window.electron.updateConfig({ [key]: config[key] }); } catch {}
  });
});

var $showSpark = document.getElementById('set-show-sparklines');
if ($showSpark) {
  $showSpark.addEventListener('change', (e) => {
    config.showSparklines = e.target.value === 'true';
    if (!config.showSparklines) {
      // Clear any active selection so the cards are compact and inert
      $selectedMetrics = {};
      document.querySelectorAll('.gpu-card').forEach(function(c) {
        c.dataset.sparkActive = '';
        c.querySelectorAll('.stat-icon-btn').forEach(function(b) { b.classList.remove('sparkline-pill-active'); });
      });
      applySparklineVisibility();
    } else {
      applySparklineVisibility();
      render(); // redraws the canvas (prompt or data) now that sparklines are back
    }
    try { window.electron.updateConfig({ showSparklines: config.showSparklines }); } catch {}
  });
}

var $hist = document.getElementById('set-sparkline-history');
if ($hist) {
  $hist.addEventListener('input', (e) => {
    config.sparklineHistorySeconds = +e.target.value;
    const histDisp = document.getElementById('val-sparkline-history');
    if (histDisp) histDisp.textContent = e.target.value + 's';
    // Rebuild every buffer at the new size (losing the brief transient history is fine)
    if (config.showSparklines && gpus.length) {
      const size = Math.round(config.sparklineHistorySeconds * (1000 / (config.updateInterval || 1000)));
      gpus.forEach(function(gpu, i) {
        SPARKLINE_METRICS.forEach(function(m) { createSparklineBuffer(i, m.id, size); });
      });
    }
    try { window.electron.updateConfig({ sparklineHistorySeconds: config.sparklineHistorySeconds }); } catch {}
  });
}

// Click handler for stat icons — selects metrics to show sparklines
if ($container) {
  $container.addEventListener('click', function(e) {
    // Sparklines disabled — icon clicks must be inert
    if (!config.showSparklines) return;
    var btn = e.target.closest('.stat-icon-btn, .metric-pill, .sparkline-pill');
    if (!btn) return;
    var metricId = btn.dataset.sparkMetric || btn.dataset.metric;
    if (!metricId) return;
    var card = btn.closest('.gpu-card');
    if (!card) return;

    // Determine GPU index from data-stat-card on the stats container
    var statContainer = card.querySelector('[data-stat-card]');
    var gpuIdx = statContainer ? parseInt(statContainer.dataset.statCard) : (card === $container.lastElementChild ? gpus.length - 1 : 0);
    if (isNaN(gpuIdx)) gpuIdx = 0;

    // If clicking the same metric, deselect it
    if ($selectedMetrics[gpuIdx] === metricId) {
      delete $selectedMetrics[gpuIdx];
      card.dataset.sparkActive = '';
    } else {
      $selectedMetrics[gpuIdx] = metricId;
      card.dataset.sparkActive = metricId;
    }

    // Visual feedback on all GPU cards
    document.querySelectorAll('.gpu-card').forEach(function(c) {
      c.querySelectorAll('.stat-icon-btn, .metric-pill').forEach(function(b) {
        b.classList.toggle('sparkline-pill-active', $selectedMetrics[parseInt(c.querySelector('[data-stat-card]')?.dataset?.statCard)] === b.dataset.sparkMetric || $selectedMetrics[parseInt(c.querySelector('[data-stat-card]')?.dataset?.statCard)] === b.dataset.metric);
      });
    });

    render();
  });
}

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

// ── Version picker: list published releases, pick one, download + install ──
let releaseList = null; // last fetched release list (null until first fetch)

async function refreshReleases() {
  const $sel    = document.getElementById('set-release-version');
  const $status = document.getElementById('update-status');
  const $btn    = document.getElementById('btn-check-updates');
  if ($status) $status.textContent = 'Fetching version list…';
  try {
    const res = await window.electron.listReleases();
    releaseList = res.releases || [];
    const options = ['<option value="__refresh__">Refresh list…</option>'];
    let autoTag = null;
    releaseList.forEach((r) => {
      const isCurrent = r.tag.replace(/^v/, '') === res.current;
      const disabled  = isCurrent || !r.exeAsset;
      if (!disabled && !autoTag) autoTag = r.tag; // API returns newest first
      options.push(
        '<option value="' + r.tag + '"' + (disabled ? ' disabled' : '') + '>' +
        r.tag + (isCurrent ? ' (current)' : '') + (r.exeAsset ? '' : ' (no installer)') +
        '</option>'
      );
    });
    $sel.innerHTML = options.join('');
    $sel.style.display = '';
    // Reveal the dark-dropdown wrapper (the native select stays class-hidden).
    const $dd = document.getElementById('dd-set-release-version'); if ($dd) $dd.style.display = '';
    if (autoTag) {
      $sel.value = autoTag;
      if ($btn) $btn.textContent = 'Update ' + autoTag;
      // Keep the wrapper button label in sync with the auto-selected version.
      const $ddBtn = document.querySelector('#dd-set-release-version .dd-btn');
      if ($ddBtn && $sel.options[$sel.selectedIndex]) $ddBtn.textContent = $sel.options[$sel.selectedIndex].text;
    }
    if ($status) $status.textContent = releaseList.length ? releaseList.length + ' version(s) found.' : 'No published releases found.';
  } catch (e) {
    if ($status) $status.textContent = 'Error: ' + (e && e.message ? e.message : e);
  }
}

document.getElementById('btn-check-updates').addEventListener('click', async () => {
  const $status = document.getElementById('update-status');
  const $sel    = document.getElementById('set-release-version');
  const tag = $sel && $sel.style.display !== 'none' ? $sel.value : null;
  if (!tag || tag === '__refresh__') { await refreshReleases(); return; }
  const rel = (releaseList || []).find((r) => r.tag === tag);
  if (!rel || !rel.exeAsset) { if ($status) $status.textContent = 'No installable release selected.'; return; }
  if ($status) $status.textContent = 'Downloading ' + tag + '… (progress updates below)';
  try {
    await window.electron.installRelease(tag, rel.exeAsset);
    // app quits itself after the installer starts — no return path
  } catch (e) {
    if ($status) $status.textContent = 'Error: ' + (e && e.message ? e.message : e);
  }
});

const $relSel = document.getElementById('set-release-version');
if ($relSel) {
  $relSel.addEventListener('change', (e) => {
    if (e.target.value === '__refresh__') { refreshReleases(); return; }
    const $btn = document.getElementById('btn-check-updates');
    if ($btn) $btn.textContent = 'Update ' + e.target.value;
  });
}

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
      break;
    case 'release-progress':
      document.getElementById('update-status').textContent = `Downloading… ${data}%`;
      break;
    case 'release-installing':
      document.getElementById('update-status').textContent = 'Installer starting — approve UAC if prompted. The app will quit.';
      break;
    case 'release-error':
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

try { init(); } catch (e) { console.error('[GPU Monitor] init() threw:', e && e.message ? e.message : String(e)); }
try { syncPinState(); } catch {}

// Safety: if no content rendered after 2s, show a diagnostic message inside the container.
// This catches cases where renderDone stays unset or all GPU fields parse to null.
(function _showEmptyMessageIfStuck() {
  setTimeout(function check() {
    var html = $container && $container.innerHTML;
    if (!html || !html.trim()) {
      $container.innerHTML = '<div style="text-align:center;padding:60px 24px;color:#7d94b3;font-size:13px;width:100%;">&#x26A1; No NVIDIA GPU detected. Check DevTools console [F12] for diagnostics.</div>';
    }
  }, 2500);
})();
