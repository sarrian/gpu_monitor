---
created: 2026-08-12
updated: 2026-08-12
status: archived
tags: [checkpoint, restore-point, gpu-monitor, v1.2.0]
category: checkpoint
---

# GPU Monitor v1.2.0 — Restore Point / Checkpoint

**Created**: 2026-08-12  
**State**: App functional with 5 blocking issues documented  
**Resume instructions below**

## How to Resume (Next Session)

Copy this block exactly:

```
Continue the GPU Monitor v1.2.0 work. The app is running but has 5 known issues from [[Projects/GPU Monitor/sprint-2026-08-12]]. 
Fix them in priority order (see [[Daily/2026-08-12]] next session actions list).
Do NOT start any new features — focus only on the 5 documented issues.
```

## Current Code State Summary

### What's Working
- Compact stat rows (tight stacking, flat appearance)
- Icon-only clickable pills (18x18px, no border by default)
- VRAM shows gauge + raw MB when data available
- Settings: "Show VRAM Raw" toggle wired to settings panel + config persistence
- All percentage-based metrics (Temp, Power, GPU Load, Mem Load, Fan) get gauge bars
- GCLK/MCLK display raw MHz values

### Known Code Layout (renderer.js key lines)
```
line 93-102:    allMetrics array — GCLK/MCLK have max: undefined
line 104-106:   defaultIdx calculation for active pill
line 108-179:   forEach loop building stat row HTML per metric
line 153:       hasPercentageMetric check (blocks GCLK/MCLK bars when max=undefined)
line 419-436:   click handler for stat-icon-btn + sparkline-pill
line 730-738:   first-render: builds HTML, init gpuSparklines buffers
line 757-824:   patch-phase: updates values/gauges in-place (VRAM unconditionally overwrites)
```

### CSS State (style.css key rules)
```
.stat-row {        gap:3px, padding:3px 10px, no bg/border }
.stat-icon-btn {    width:18px, height:18px, no border, cursor:pointer }
.stat-label {       width:32px, font-size:9px }
.stat-bar {         height:3px, min-width:30px }
.stat-fill {        transition: width 0.5s ease }
.stat-value {       min-width:46px, font-size:9px }
```

### Config State (main.js DEFAULT_CFG)
```javascript
showPowerWatts: true,   // existed from previous session
showVramRaw: true,      // ADDED this session — must persist to config.json
```

### Settings UI State (index.html)
- "Show Power Watts" toggle ✅ (existing)
- "Show VRAM Raw" toggle ✅ (new)
- "Show Clock MHz" toggle ✅ (new but may be removed — clocks rolled back to original behavior)
- Sparklines toggle + History Length slider ✅

## Issue Priority Matrix

| Priority | Issue | Complexity | Impact |
|----------|-------|-----------|--------|
| P0        | #5: VRAM flashes then goes raw | 2 min | User sees wrong format |
| P0        | #1: GCLK/MCLK no gauges | 1 min | Missing visual indicator |
| P1        | #4: Pill highlight vanishes | 3-5 min | Feature regression |
| P1        | #2: Icon pills unresponsive | 5-10 min | Core interaction broken |
| P2        | #3: Sparklines never render | 15-30 min | Full feature audit needed |

## Restore Checklist

- [ ] Read [[Projects/GPU Monitor/sprint-2026-08-12]] for full issue details
- [ ] Verify app state with `npm start`
- [ ] Fix #5: DEFAULT_CFG + render patch → confirm VRAM shows "85% 27.8 / 32.0 GB"
- [ ] Fix #1: Set GCLK max=3500, MCLK max=2500 in allMetrics
- [ ] Fix #4: Sync active pill class after re-render
- [ ] Fix #2: Test icon pills, add pointer-events if needed
- [ ] Fix #3: Full sparkline data path audit (push → buffer → render)
- [ ] Confirm all gauges render consistently
