/**
 * SparklineBuffer — circular buffer for time-series metric values.
 * @constructor
 * @param {number} maxSize - maximum number of samples to retain
 */
function SparklineBuffer(maxSize) {
  this.maxSize = Math.max(1, maxSize | 0);
  this.values = new Array(this.maxSize).fill(null);
  this.timestamps = new Array(this.maxSize).fill(null);
  this.count = 0;
  this.offset = 0;
}

/** Push a value with optional timestamp (defaults to Date.now()). */
SparklineBuffer.prototype.push = function(value, timestamp) {
  this.values[this.offset] = value;
  this.timestamps[this.offset] = timestamp || Date.now();
  this.offset = (this.offset + 1) % this.maxSize;
  if (this.count < this.maxSize) this.count++;
};

/** Time-ordered values, nulls excluded. Returns {values: [...], timestamps: [...]}. */
SparklineBuffer.prototype.getValues = function() {
  var vals = [], ts = [];
  var start = this.count < this.maxSize ? 0 : this.offset;
  var len = Math.min(this.count, this.maxSize);
  for (var i = 0; i < len; i++) {
    var vi = (start + i) % this.maxSize;
    var v = this.values[vi];
    if (v != null && !isNaN(v)) vals.push(v);
    ts.push(this.timestamps[vi]);
  }
  return { values: vals, timestamps: ts };
};

/** Clear all buffered values and timestamps. */
SparklineBuffer.prototype.clear = function() {
  this.values.fill(null);
  this.timestamps.fill(null);
  this.offset = 0;
  this.count = 0;
};

// ── Metric definitions ──

/** Available metrics for sparkline display. */
var SPARKLINE_METRICS = [
  { id: 'temp',      icon: '🌡️', label: 'Temp' },
  { id: 'power',     icon: '⚡️',       label: 'Pwr' },
  { id: 'gpu-load',  icon: '📊',       label: 'GPU' },
  { id: 'mem-load',  icon: '🧠',       label: 'Mem' },
  { id: 'vram',      icon: '💾',       label: 'VRAM' },
  { id: 'gpu-clock', icon: '🔁',       label: 'GCLK' },
  { id: 'mem-clock', icon: '🔧',       label: 'MCLK' },
  { id: 'fan',       icon: '🟩',       label: 'Fan' },
];

/** Buffer names mapped to metric IDs. */
var BUFFER_NAMES = SPARKLINE_METRICS.map(function(m) { return m.id; });

/**
 * Reverse mapping for right-hand scale labels: buffer values are normalized 0-100,
 * factor is the natural value that 100% represents (null → value is already in unit;
 * caller overrides for power, whose max is the dynamic powerLimit).
 */
var METRIC_UNIT_SCALES = {
  'temp':      { factor: 120,  unit: '°C' },
  'power':     { factor: null, unit: 'W' },
  'gpu-load':  { factor: 100,  unit: '%' },
  'mem-load':  { factor: 100,  unit: '%' },
  'vram':      { factor: 100,  unit: '%' },
  'fan':       { factor: 100,  unit: '%' },
  'gpu-clock': { factor: 3500, unit: 'MHz' },
  'mem-clock': { factor: 2500, unit: 'MHz' },
};

// ── Data collection state ──

/** Per-GPU buffers indexed by gpuIndex -> { metricId: SparklineBuffer }. */
var gpuBuffers = {};

/** Currently active metric for each GPU index. */
var activeMetric = {};

/**
 * Get or create a sparkline buffer for a given GPU and metric.
 * @param {number} gpuIdx
 * @param {string} metricId
 * @returns {SparklineBuffer}
 */
function getBuffer(gpuIdx, metricId) {
  if (!gpuBuffers[gpuIdx]) gpuBuffers[gpuIdx] = {};
  if (!gpuBuffers[gpuIdx][metricId]) {
    gpuBuffers[gpuIdx][metricId] = new SparklineBuffer(60); // default, overridden on first real use
  }
  return gpuBuffers[gpuIdx][metricId];
}

/**
 * Create a new buffer with the correct size based on history length and poll interval.
 * @param {number} gpuIdx
 * @param {string} metricId
 * @param {number} bufferSize
 */
function createBuffer(gpuIdx, metricId, bufferSize) {
  if (!gpuBuffers[gpuIdx]) gpuBuffers[gpuIdx] = {};
  gpuBuffers[gpuIdx][metricId] = new SparklineBuffer(bufferSize);
}

/**
 * Push current GPU values into sparkline buffers.
 * @param {number} gpuIdx
 * @param {Object} gpu - GPU metric object (matches GpuMetric typedef shape)
 */
function pushData(gpuIdx, gpu) {
  var target = gpuBuffers[gpuIdx];

  if (!target) return;

  var mappings = [
    ['temp',     gpu.temperature,       120],    // max temp ~120°C
    ['power',    null,                  100],    // calculated from powerDraw/powerLimit
    ['gpu-load', gpu.gpuUtil,           100],
    ['mem-load', gpu.memUtil,           100],
    ['vram',     null,                  100],     // calculated from memoryUsed/memoryTotal
    ['fan',      gpu.fanSpeed,          100],
  ];

  mappings.forEach(function(pair) {
    var key = pair[0];
    var rawVal = pair[1];
    var maxVal = pair[2];

    // Calculate derived percentages for power and VRAM
    if (key === 'power') {
      rawVal = gpu.powerDraw != null && gpu.powerLimit != null && gpu.powerLimit > 0
        ? (gpu.powerDraw / gpu.powerLimit) * 100 : null;
    } else if (key === 'vram') {
      rawVal = gpu.memoryUsed != null && gpu.memoryTotal != null && gpu.memoryTotal > 0
        ? Math.min(100, (gpu.memoryUsed / gpu.memoryTotal) * 100) : null;
    }

    if (rawVal == null || rawVal !== rawVal) return; // skip null/undefined and NaN
    var percentage = Math.max(0, Math.min(100, (rawVal / maxVal) * 100));

    var buffer = target[key];
    if (buffer) {
      buffer.push(percentage, Date.now());
    }
  });

  // Handle clocks separately: they're raw MHz values from nvidia-smi, not percentages
  ['gpu-clock', 'mem-clock'].forEach(function(key) {
    var rawVal = key === 'gpu-clock' ? gpu.gpuClock : gpu.memClock;
    var maxClock = key === 'gpu-clock' ? 3500 : 2500; // max clock speeds in MHz
    if (rawVal == null || rawVal !== rawVal) return;

    var buffer = target[key];
    if (buffer) {
      // Show as percentage of max clock speed for the sparkline
      buffer.push(Math.max(0, Math.min(100, (rawVal / maxClock) * 100)), Date.now());
    }
  });
}

// ── SVG rendering ──

/** Compute adaptive tick interval based on time span in seconds. */
function computeTimeTickInterval(spanSecs) {
  if (spanSecs <= 60) return 10;       // every 10s
  if (spanSecs <= 180) return 15;      // every 15s
  if (spanSecs <= 300) return 20;      // every 20s
  if (spanSecs <= 600) return 30;      // every 30s
  if (spanSecs <= 900) return 60;      // every 1m
  if (spanSecs <= 1800) return 120;    // every 2m
  if (spanSecs <= 3600) return 300;    // every 5m
  return Math.max(300, Math.round(spanSecs / 6));
}

/** Format a tick's seconds (elapsed from window start) as a compact label.
 * M:SS format is injective, so adjacent ticks can never round to the same string
 * (the old "round to whole minutes" produced duplicate labels like "2m … 2m"). */
function formatTimeLabel(agoSecs) {
  if (agoSecs <= 1) return 'now';
  var m = Math.floor(agoSecs / 60);
  var s = agoSecs % 60;
  return m + ':' + (s < 10 ? '0' + s : s);
}

/** Color a single data point's intensity relative to the metric range [0..1]. */
function intensityColor(ratio, metricId) {
  // ratio is already normalized to 0-1 within the data's own min/max range
  var r = Math.max(0, Math.min(1, ratio));

  if (metricId === 'temp' || metricId === 'power') {
    // Thermometric: green -> yellow -> red
    var g = Math.round((1 - r) * 255);
    var cr = Math.round(r * 248);
    var cb = Math.round(5 + (1 - Math.abs(r - 0.5) * 4) * 20);
    return 'rgb(' + cr + ',' + g + ',' + cb + ')';
  }

  if (metricId === 'gpu-load' || metricId === 'mem-load') {
    // Green -> amber -> red with accent hue influence
    var accentColor = getAccentRGB();
    var baseR = accentColor.r, baseG = accentColor.g, baseB = accentColor.b;
    if (r < 0.5) {
      return 'rgb(' + Math.round(baseR + (248 - baseR) * r) + ',' + Math.round(baseG * (1 - r * 0.7)) + ',' + Math.round(baseB * (1 - r * 0.8)) + ')';
    }
    var t = (r - 0.5) * 2; // 0-1 in second half
    return 'rgb(' + Math.round(248 * t + baseR * (1 - t)) + ',' + Math.round((baseG * (1 - r * 0.7)) * (1 - t) + 40 * t) + ',' + Math.round(baseB * (1 - r * 0.8) * (1 - t * 0.5));
  }

  // vram, clocks, fan: accent brightness fade from dim -> full -> hot
  var accentColor = getAccentRGB();
  return 'rgb(' + Math.round(accentColor.r * (0.4 + r * 0.6)) + ',' + Math.round(accentColor.g * (0.3 + r * 0.7)) + ',' + Math.round(accentColor.b * (0.5 + r * 0.5)) + ')';
}

/** Cache the resolved accent color to avoid DOM thrashing on every call. */
var _accentCache = null;

/** Extract the RGB value of the current CSS accent variable for use in intensityColor. */
function getAccentRGB() {
  if (_accentCache) return _accentCache;

  var probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-9999px';
  probe.style.top = '-9999px';
  probe.style.color = 'var(--accent, rgb(118, 185, 3))';
  document.body.appendChild(probe);

  var resolved = window.getComputedStyle(probe).color;
  document.body.removeChild(probe);

  var m = resolved.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) _accentCache = { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
  else _accentCache = { r: 118, g: 185, b: 3 };

  return _accentCache;
}

/** Invalidate the cached accent color so it gets re-resolved on theme change. */
function resetAccentColor() { _accentCache = null; }

/**
 * Render an inline sparkline SVG with guaranteed visibility using ONLY solid colors.
 * All styling uses inline style="" attributes — CSS variables don't work in SVG
 * presentation attribute values (Chrome silently drops them).
 * @param {{ values: number[], timestamps: number[] }} data - values and associated timestamps
 * @param {number} width - drawing width in px
 * @param {number} height - drawing height in px
 * @param {string|number} gpuIdx - GPU index for unique IDs
 * @param {string} metricId - current metric ID for intensity coloring scheme
 * @param {{factor: number|null, unit: string}} [unitScale] - natural-unit scale for the right-hand axis
 * @returns {string} SVG markup
 */
// Right gutter reserved for value scale labels (e.g. "1250MHz")
var SCALE_GUTTER = 40;

function renderSparklineSVG(data, width, height, gpuIdx, metricId, unitScale) {
  unitScale = unitScale || METRIC_UNIT_SCALES[metricId] || { factor: 100, unit: '%' };

  if (!data || !data.values || data.values.length === 0) {
    return '<svg viewBox="0 0 ' + (width + SCALE_GUTTER) + ' ' + (height + 2) + '" class="sparkline-svg">' +
      '<text x="' + (width / 2 + 4) + '" y="' + (height / 2 + 1) + '" text-anchor="middle" fill="#5a6f80" font-size="9">Waiting</text>' +
    '</svg>';
  }

  if (data.values.length < 2) {
    // Not enough points for a sparkline — show waiting message.
    return null;
  }

  var values = data.values;
  var timestamps = data.timestamps;

  var minVal = Math.min.apply(null, values);
  var maxVal = Math.max.apply(null, values);
  var range = maxVal - minVal;
  var yMin, yMax;
  if (range < 1) {
    // Flat data (e.g. load pinned at one value): auto-fit would collapse to a hairline
    // range — line floating mid-chart and three identical scale labels. Use the full
    // natural scale (buffer values are always normalized 0-100).
    yMin = 0;
    yMax = 100;
  } else {
    var headroom = range * 0.12;
    yMin = minVal - headroom;
    yMax = maxVal + headroom;
  }
  var plotH = height - 6; // leave room for time axis

  function yPos(v) { return 2 + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

  var stepX = values.length > 1 ? (width - 10) / (values.length - 1) : width / 2;
  var startX = 5;
  var plotRight = width - 5; // x of the last data point

  // Build per-segment colored lines
  var lineSegments = '';
  for (var i = 0; i < values.length - 1; i++) {
    var x1 = startX + i * stepX;
    var y1 = yPos(values[i]);
    var x2 = startX + (i + 1) * stepX;
    var y2 = yPos(values[i + 1]);

    // Color for this segment based on average intensity
    var avgVal = (values[i] + values[i + 1]) / 2;
    var ratio = range > 0 ? (avgVal - minVal) / range : 0.5;
    var color = intensityColor(ratio, metricId);

    lineSegments += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
      '" style="stroke:' + color + ';stroke-width:2;stroke-linecap:round;stroke-linejoin:round;" />' +
      '<!-- -->'; // SVG whitespace comment to separate elements
  }

  var rightX = (startX + (values.length - 1) * stepX).toFixed(1);

  // Build time axis labels from timestamps
  var lastTs = timestamps[timestamps.length - 1];
  var firstTs = timestamps[0];
  var spanSecs = Math.round((lastTs - firstTs) / 1000);
  if (spanSecs <= 0) spanSecs = 15;
  var tickInterval = computeTimeTickInterval(spanSecs);
  var numTicks = Math.min(6, Math.max(2, Math.round(spanSecs / tickInterval)));

  var timeLabels = '';
  var prevTickSecs = -1;
  for (var t = 0; t < numTicks; t++) {
    var tickSecs = Math.round(spanSecs * t / numTicks);
    if (tickSecs === 0 || tickSecs === prevTickSecs) continue; // rounding can produce duplicate positions on short spans
    prevTickSecs = tickSecs;

    var xPos = startX + (tickSecs / spanSecs) * ((startX + (values.length - 1) * stepX - startX));
    if (xPos < startX || xPos > rightX) continue;

    timeLabels += '<text x="' + xPos.toFixed(1) + '" y="' + (height - 1) + '" text-anchor="middle" fill="#5a6f80" font-size="7" style="font-family:sans-serif;">' + formatTimeLabel(tickSecs) + '</text>';
  }

  // "now" at the right edge, anchored inward (text-anchor:end) so it stays on the
  // plot area and never collides with the value-scale labels in the right gutter
  timeLabels += '<text x="' + rightX + '" y="' + (height - 1) + '" text-anchor="end" fill="#7dd3fc" font-size="7" style="font-family:sans-serif;font-weight:600;">now</text>';

  // Right-hand value scale: max / mid / min of the visible range converted to the
  // metric's natural unit, so peaks can be tracked against real values.
  function formatScale(v) {
    var n = unitScale.factor != null ? (v / 100) * unitScale.factor : v;
    return (n >= 10 ? Math.round(n) : n.toFixed(1)) + unitScale.unit;
  }
  var scaleMarkup = '';
  [maxVal, (minVal + maxVal) / 2, minVal].forEach(function(v) {
    var ty = yPos(v);
    scaleMarkup += '<line x1="' + startX + '" y1="' + ty.toFixed(1) + '" x2="' + plotRight + '" y2="' + ty.toFixed(1) + '" style="stroke:#ffffff;stroke-opacity:0.07;stroke-width:1;" />';
    scaleMarkup += '<text x="' + (width + 6) + '" y="' + (ty + 2.5).toFixed(1) + '" text-anchor="start" fill="#5a6f80" font-size="7" style="font-family:sans-serif;">' + formatScale(v) + '</text>';
  });

  // All styling uses inline style="" — no CSS variables in SVG attributes
  return '<svg viewBox="0 0 ' + (width + SCALE_GUTTER) + ' ' + (height + 2) + '" class="sparkline-svg">' +
    // Subtle track: very dim solid background for the plot area so the line has context
    '<rect x="' + startX + '" y="2" width="' + (width - 10) + '" height="' + plotH + '" style="fill:#ffffff;fill-opacity:0.03;" />' +
    // Faint gridlines + natural-unit labels in the right gutter
    scaleMarkup +
    // Brighter stroke for high contrast against any background
    lineSegments + timeLabels +
  '</svg>';
}
