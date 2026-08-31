/** Periodically update the debug overlay with diagnostic state. */
function updateDebugOverlay() {
  var $dbg = document.getElementById('debug-overlay');
  if (!$dbg) return;
  if ($dbg.style.display !== 'block') return;

  var lines = [];
  lines.push('=== GPU Monitor Diagnostics ===');
  lines.push('config.showSparklines: ' + !!config.showSparklines);
  lines.push('gpus.length: ' + (gpus ? gpus.length : 'null'));
  if (gpus && gpus.length > 0) {
    var g = gpus[0];
    lines.push('GPU[0] name: ' + (g.name || 'null'));
    lines.push('GPU[0].temperature: ' + g.temperature);
    lines.push('GPU[0].powerDraw: ' + g.powerDraw);
    lines.push('GPU[0].gpuUtil: ' + g.gpuUtil);
  }

  var $card = document.querySelector('[data-stat-card="0"]');
  var sparkActive = $card ? $card.dataset.sparkActive : 'no-card';
  lines.push('card[0] sparkActive: ' + sparkActive);

  lines.push('--- gpuBuffers ---');
  if (gpuBuffers && Object.keys(gpuBuffers).length > 0) {
    var bufKeys = Object.keys(gpuBuffers);
    for (var bi = 0; bi < Math.min(bufKeys.length, 3); bi++) {
      var bKey = bufKeys[bi];
      var metrics = gpuBuffers[bKey] || {};
      var mKeys = Object.keys(metrics);
      for (var mi = 0; mi < Math.min(mKeys.length, 2); mi++) {
        var mName = mKeys[mi];
        var buf = metrics[mName];
        lines.push('  [' + bKey + '][' + mName + '] cnt=' + (buf ? buf.count : 'null') + ' vals=' + (buf && buf.getValues ? buf.getValues().values.length : 'null'));
      }
    }
  } else {
    lines.push('gpuBuffers: EMPTY');
  }

  lines.push('--- gpuSparklines ---');
  if (gpuSparklines && Object.keys(gpuSparklines).length > 0) {
    var slKeys = Object.keys(gpuSparklines);
    for (var si = 0; si < Math.min(slKeys.length, 3); si++) {
      var sKey = slKeys[si];
      if (sKey === '__base__') continue;
      var slMetrics = gpuSparklines[sKey] || {};
      var smKeys = Object.keys(slMetrics);
      for (var smi = 0; smi < Math.min(smKeys.length, 2); smi++) {
        var sMName = smKeys[smi];
        var sBuf = slMetrics[sMName];
        lines.push('  [' + sKey + '][' + sMName + '] cnt=' + (sBuf ? sBuf.count : 'null'));
      }
    }
  } else {
    lines.push('gpuSparklines: EMPTY');
  }

  var $canvas = document.querySelector('.sparkline-canvas');
  lines.push('canvas innerHTML len: ' + ($canvas && $canvas.innerHTML ? $canvas.innerHTML.length : 'null'));
  lines.push('paused: ' + (typeof paused !== 'undefined' ? paused : '?'));

  $dbg.textContent = lines.join('\n');
}
