// TEMPORARY verification harness — boots the REAL app (main.js + preload + renderer)
// in-process, waits for the first GPU poll cycle, and dumps what rendered.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const root = __dirname;

// Boot the real app main process (registers IPC handlers, creates the window)
require(path.join(root, 'src', 'main.js'));

setTimeout(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log('FAIL: no window created'); app.exit(1); return; }

  try {
    const report = await win.webContents.executeJavaScript(`({
      bridge: typeof window.electron,
      loadingHidden: getComputedStyle(document.getElementById('loading-state')).display,
      containerText: document.getElementById('gpu-container').innerText.slice(0, 800),
      hasSparklineSvg: !!document.querySelector('.sparkline-canvas svg'),
      statRows: document.querySelectorAll('.stat-row').length,
    })`);
    console.log('=== VERIFY REPORT (real app) ===');
    console.log('bridge:', report.bridge);
    console.log('loading-state display:', report.loadingHidden);
    console.log('stat rows rendered:', report.statRows);
    console.log('sparkline SVG present:', report.hasSparklineSvg);
    console.log('--- container text ---');
    console.log(report.containerText);
    const hasGpu = /°C|GHz|MHz|W/.test(report.containerText) && !/No NVIDIA GPU detected/.test(report.containerText);

    // ── Sparkline phase: select Temp, let the buffer prime, inspect the SVG ──
    await win.webContents.executeJavaScript(`
      (function(){ var b = document.querySelector('[data-spark-metric="temp"]'); if (b) b.click(); })();
    `);
    // updateInterval is 1s — 4.5s guarantees ≥2 buffer samples for a real line
    await new Promise(r => setTimeout(r, 4500));

    const spark = await win.webContents.executeJavaScript(`({
      svg: !!document.querySelector('.sparkline-canvas svg'),
      areaPaths: document.querySelectorAll('.sparkline-canvas svg path').length,
      unitLabels: Array.prototype.filter.call(
        document.querySelectorAll('.sparkline-canvas svg text'),
        t => /°C$/.test(t.textContent)
      ).length,
      gridlines: Array.prototype.filter.call(
        document.querySelectorAll('.sparkline-canvas svg line'),
        l => /stroke-opacity/.test(l.getAttribute('style') || '')
      ).length,
      head: (document.querySelector('.sparkline-canvas svg') || { outerHTML: '' }).outerHTML.slice(0, 500),
    })`);
    // Right-column layout audit: uniform font sizes + adequate distance from the card edge
    const layout = await win.webContents.executeJavaScript(`(function(){
      var card = document.querySelector('.gpu-card');
      if (!card) return null;
      var cardRight = card.getBoundingClientRect().right;
      var values = Array.prototype.map.call(
        document.querySelectorAll('.gpu-card .stat-value, .gpu-card .metric-value'),
        function(el){ return { text: el.textContent.trim(), fs: getComputedStyle(el).fontSize, gap: Math.round(cardRight - el.getBoundingClientRect().right) }; }
      );
      var svg = document.querySelector('.sparkline-canvas svg');
      // Measure the rightmost actual ink in the SVG (scale labels), not the empty viewBox edge
      var svgInkRight = null;
      if (svg) {
        var rights = Array.prototype.map.call(svg.querySelectorAll('text'), function(t){ return t.getBoundingClientRect().right; });
        if (rights.length) svgInkRight = Math.max.apply(null, rights);
      }
      return { values: values, svgInkGapPx: svgInkRight != null ? Math.round(cardRight - svgInkRight) : null };
    })()`);
    let layoutOk = false;
    console.log('=== RIGHT-COLUMN LAYOUT ===');
    if (!layout || !layout.values) {
      console.log('  no .gpu-card found — skipping layout audit');
    } else {
      layout.values.forEach(v => console.log(' ', v.text, '@', v.fs, 'gap=' + v.gap + 'px'));
      console.log('  svg rightmost-label gap:', layout.svgInkGapPx + 'px');

      const MIN_EDGE_GAP = 10; // px of breathing room between right-column text and the card border
      const fontSizes = Array.from(new Set(layout.values.map(v => v.fs)));
      const minGap = Math.min.apply(null, layout.values.map(v => v.gap));
      layoutOk = fontSizes.length === 1 && minGap >= MIN_EDGE_GAP && layout.svgInkGapPx >= MIN_EDGE_GAP;
      console.log('uniform font sizes:', fontSizes.join('/'), '| min value gap:', minGap + 'px');
      console.log(layoutOk ? 'LAYOUT: PASS' : 'LAYOUT: FAIL');
    }

    // Left-column layout audit: icon breathing room from the card edge +
    // label text must never spill onto the bar track that follows it
    const left = await win.webContents.executeJavaScript(`(function(){
      var card = document.querySelector('.gpu-card');
      if (!card) return null;
      var cardLeft = card.getBoundingClientRect().left;
      var icons = Array.prototype.map.call(
        document.querySelectorAll('.gpu-card .stat-icon-btn'),
        function(el){ return { gap: Math.round(el.getBoundingClientRect().left - cardLeft) }; }
      );
      var rows = Array.prototype.map.call(
        document.querySelectorAll('.gpu-card .stat-row'),
        function(row){
          var l = row.querySelector('.stat-label');
          var b = row.querySelector('.stat-bar');
          if (!l) return null;
          var box = l.getBoundingClientRect();
          // span is fixed-width and overflow is visible — measure the text ink, not the box
          var ink = 0;
          try { var r = document.createRange(); r.selectNodeContents(l); ink = r.getBoundingClientRect().width; } catch (e) {}
          // fill % of the bar track — 0 means the metric has no usable max (or a data bug)
          var fillPct = null;
          var fill = row.querySelector('.stat-fill');
          if (b && fill) { var tw = b.getBoundingClientRect().width; if (tw) fillPct = Math.round(fill.getBoundingClientRect().width / tw * 100); }
          var valEl = row.querySelector('.stat-value') || row.querySelector('.metric-value');
          return { metric: row.getAttribute('data-metric'), text: l.textContent.trim(), valText: valEl ? valEl.textContent.trim() : '', fs: getComputedStyle(l).fontSize, ink: Math.round(ink), col: Math.round(box.width), barGap: b ? Math.round(b.getBoundingClientRect().left - box.left - ink) : null, fillPct: fillPct };
        }
      ).filter(Boolean);
      var container = document.querySelector('.gpu-container');
      return { icons: icons, rows: rows, fitScroll: container ? container.scrollHeight : null, fitClient: container ? container.clientHeight : null };
    })()`);
    let leftOk = false;
    console.log('=== LEFT-COLUMN LAYOUT ===');
    if (!left || !left.icons) {
      console.log('  no .gpu-card found — skipping left audit');
    } else {
      left.icons.forEach((ic, i) => console.log('  icon[' + i + '] gap=' + ic.gap + 'px'));
      if (left.fitScroll != null) console.log('  fit: content ' + left.fitScroll + 'px vs window ' + left.fitClient + 'px ' + (left.fitScroll <= left.fitClient + 1 ? '(fits)' : '(overflow +' + (left.fitScroll - left.fitClient) + 'px)'));
      left.rows.forEach(r => console.log('  ', r.text, '=', r.valText, '@', r.fs, 'ink=' + r.ink + 'px col=' + r.col + 'px' + (r.barGap != null ? ' bar-gap=' + r.barGap + 'px' : '') + (r.fillPct != null ? ' fill=' + r.fillPct + '%' : ' (no bar)')));

      const MIN_EDGE_GAP = 10; // px of breathing room between icon column and the card border
      const labelFonts = Array.from(new Set(left.rows.map(r => r.fs)));
      const minIconGap = Math.min.apply(null, left.icons.map(ic => ic.gap));
      const barRows = left.rows.filter(r => r.barGap != null);
      const minBarGap = barRows.length ? Math.min.apply(null, barRows.map(r => r.barGap)) : null;
      // No rendered value may contain "NaN" (unsupported fields must show "--")
      const nanRows = left.rows.filter(r => /NaN/.test(r.valText)).map(r => r.text);
      // Power bar must reflect actual consumption: non-'--' wattage with a 0% fill is the exact bug we fixed
      const powerRow = left.rows.find(r => r.metric === 'power');
      const powerOk = !powerRow || /NaN/.test(powerRow.valText) || powerRow.valText === '--' || (powerRow.fillPct != null && powerRow.fillPct > 0);
      leftOk = minIconGap >= MIN_EDGE_GAP && labelFonts.length === 1 && minBarGap >= 3 && nanRows.length === 0 && powerOk;
      console.log('uniform label fonts:', labelFonts.join('/'), '| min icon gap:', minIconGap + 'px', '| min bar gap:', minBarGap + 'px'
        + ' | NaN values: ' + (nanRows.length ? nanRows.join(', ') + ' (FAIL)' : 'none')
        + ' | power fill: ' + (powerRow && powerRow.fillPct != null ? powerRow.fillPct + '%' : 'n/a'));
      console.log(leftOk ? 'LAYOUT: PASS' : 'LAYOUT: FAIL');
    }

    // Sparkline axis audit: time labels must be unique (no "2m … 2m" duplicates),
    // share one baseline (incl. "now"), and "now" must not overlap the value-scale
    // labels in the right gutter
    const axis = await win.webContents.executeJavaScript(`(function(){
      var svg = document.querySelector('.sparkline-canvas svg');
      if (!svg) return null;
      var sr = svg.getBoundingClientRect();
      if (!sr.height) return null;
      var texts = Array.prototype.map.call(svg.querySelectorAll('text'), function(t){
        var r = t.getBoundingClientRect();
        return { text: t.textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
      // Scale labels always carry a unit (% / °C / MHz / W); time labels never do —
      // that's the exact discriminator (vertical position can't separate them: the
      // bottom scale label shares the time axis's row, and the band shifts with SVG height).
      var hasUnit = function(txt){ return /[%°]|MHz$|W$/.test(txt); };
      var timeLabels = texts.filter(function(l){ return !hasUnit(l.text); });
      var scaleLabels = texts.filter(function(l){ return hasUnit(l.text); });
      var now = timeLabels.filter(function(l){ return l.text === 'now'; })[0];
      var overlapsScale = !!(now && scaleLabels.some(function(s){
        return !(now.right < s.left || s.right < now.left || now.bottom < s.top || s.bottom < now.top);
      }));
      var uniq = [];
      timeLabels.forEach(function(l){ if (uniq.indexOf(l.text) === -1) uniq.push(l.text); });
      var tops = timeLabels.map(function(l){ return Math.round(l.top); });
      return {
        labels: timeLabels.map(function(l){ return l.text; }),
        uniqueCount: uniq.length,
        uniformTop: tops.length > 0 && tops.every(function(t){ return t === tops[0]; }),
        nowOverlapsScale: overlapsScale,
      };
    })()`);
    let axisOk = false;
    if (!axis) {
      console.log('=== SPARKLINE AXIS ===');
      console.log('  no svg found — skipping axis audit');
    } else {
      console.log('=== SPARKLINE AXIS ===');
      console.log('  time labels:', axis.labels.join('   '), '| all unique:', axis.uniqueCount === axis.labels.length,
        '| single baseline:', axis.uniformTop, '| now/scale overlap:', axis.nowOverlapsScale);
      axisOk = axis.labels.length >= 2 && axis.uniqueCount === axis.labels.length && axis.uniformTop && !axis.nowOverlapsScale;
    }

    console.log('=== SPARKLINE REPORT ===');
    console.log('svg rendered after temp click:', spark.svg);
    console.log('area-fill paths (must be 0):', spark.areaPaths);
    console.log('unit scale labels °C (expect 3):', spark.unitLabels);
    console.log('gridlines (expect 3):', spark.gridlines);
    console.log('--- svg head ---');
    console.log(spark.head);

    const sparkOk = spark.svg && spark.areaPaths === 0 && spark.unitLabels === 3 && spark.gridlines === 3 && axisOk;
    console.log(sparkOk ? 'SPARKLINE: PASS' : 'SPARKLINE: FAIL');
    const allOk = hasGpu && sparkOk && layoutOk && leftOk;
    console.log(allOk ? 'RESULT: PASS' : 'RESULT: FAIL');
    app.exit(allOk ? 0 : 2);
  } catch (e) {
    console.log('FAIL: could not inspect window:', e.message);
    app.exit(1);
  }
}, 8000);
