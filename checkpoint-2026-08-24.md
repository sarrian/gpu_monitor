---
created: 2026-08-24
updated: 2026-08-26
status: archived
tags: [checkpoint, restore-point, gpu-monitor, v1.1.0]
category: checkpoint
---

# GPU Monitor — Checkpoint (layout pass + power bar + fan NaN)

> **Superseded 2026-08-26 by [[checkpoint-2026-08-26]]** — the functional fixes (power bar, fan NaN, sparkline value scale, harness guards) remain valid; the layout values (10px grid padding, bleed trick, 22px icons, 58px label column) were compacted back toward v1.0.1.

**Created**: 2026-08-24
**State**: Layout symmetric both sides, all bars correctly scaled, no NaN values, sparkline working — `verify-app.js` ends in **RESULT: PASS**
Supersedes [[checkpoint-2026-08-12]] (that issue matrix is fully resolved)

## How to Resume (Next Session)

Copy this block exactly:

```
Continue the GPU Monitor work from [[checkpoint-2026-08-24]]. State is good: left/right layout symmetric,
power bar scaled by powerLimit, fan NaN% fixed, verify-app.js reports RESULT: PASS.
Next, apply these additional fixes: <describe fixes here>.
Verify with `npx electron verify-app.js` in the project dir before declaring anything done.
```

## What Changed This Session

| # | Fix | Where | Detail |
|---|-----|-------|--------|
| 1 | Left-side breathing room | `src/style.css:212` | `.metrics-grid` gained `padding-left: 10px` (mirrors right). Measured icon gap: 11px, symmetric with right-side value gap of 11px |
| 2 | Bars no longer overlap labels | `src/style.css:289` | `.stat-label` width 32px → 58px. Root cause: fixed-width span with visible overflow — "GPU LOAD"/"MEM LOAD" ink (45–48px) spilled rightward onto the `.stat-bar` that follows in flex order. 58px column fits all labels; min bar-gap now 13px |
| 3 | Power bar shows consumption | `src/renderer.js:330` (first render) + `:384` (patch) | Both passed `max: null` → fill always 0%. Now pass `gpu.powerLimit` (was already fetched and used by `powerColor` + sparkline scale). Verified: 42.2 W → fill 14% |
| 4 | FAN "NaN%" → "--" | `src/renderer.js:100` | nvidia-smi reports "[Not Supported]" for fan on fanless SXM → `parseFloat` = NaN, and `NaN != null` is true so patch phase rendered "NaN%". Fixed at parse source: `n()` normalizes NaN → null for ALL metrics |
| 5 | Harness: left audit + regression guards | `verify-app.js:88-151` | New LEFT-COLUMN LAYOUT audit: icon gap ≥10px, uniform label fonts, bar ≥3px from label *ink* (Range-measured), plus per-row fill % + value text. Pass criteria now also include: no rendered "NaN" values, power fill > 0 when wattage present. Wired into `allOk` (line 151) |

## Verified Numbers (last harness run, 2026-08-24)

```
icon gap (all 8 rows): 11px        value gap (all 8 rows): 11px
label ink:  Mem Load 48px / GPU Load 45px  (both inside 58px column)
min bar-gap: 13px                  NaN values: none
fills:  Temp 50°C→42%  Power 42.2W→14%  VRAM 26.9/32GB→84%  Fan -- (fill 0)
sparkline: PASS  (0 area paths, 3 unit labels, 3 gridlines)
RESULT: PASS
```

## Key Code Layout (current)

```
renderer.js
  line 100:      n() parse helper — NaN → null normalization (single point of truth)
  line 127-139:  mItemIdStatRow — builds stat-row HTML (fill pct = value/max*100, capped 100)
  line 161-168:  patchFillCtx — per-second width update; SKIPS width when max is null
  line 330:      power first-render (max = gpu.powerLimit)
  line 384:      power patch (max = gpu.powerLimit)
  line 409:      fan patch (safe: parse returns null for unsupported)

style.css
  line 208-215:  .metrics-grid — padding: 0 10px (both sides)
  line 218-233:  .stat-row — bleed trick: padding 4px 10px, margin 1px -10px, width calc(100%+20px)
  line 286-295:  .stat-label — width 58px (must fit longest label)
  line 299-303:  .stat-bar — flex:1 spacer+track, min-width 30px

verify-app.js
  line 88-151:   left audit + NaN/power guards; allOk at 151
```

## Gotchas (read before touching layout again)

1. **Bleed trick coupling**: `.stat-row`'s `margin: -10px` + `width: calc(100% + 20px)` intentionally eats exactly the 10px grid padding on each side, so the hover background spans the full card width while content stays 10px in. If you change `.metrics-grid` padding, the row's width/margin must change in lockstep or the hover background will clip the card edge or leave a gap.
2. **`.stat-label` width is a fixed column** (like `.stat-value`'s min-width on the right). If a new metric label is longer than 58px of 9px uppercase text, it will silently overlap the bar again — the harness's ink vs col check will catch it.
3. **`patchFillCtx` skips the width update entirely when `max` is null** — a first-render fill stays frozen. GCLK/MCLK intentionally pass null (no fixed scale, bar shows as empty track).
4. **NaN ≠ null in JS** — any new numeric field added to the nvidia-smi parse is already safe via `n()` at line 100, but any value that bypasses `n()` must be guarded.

## Candidate Follow-Ups (not started)

- Cosmetic: VRAM value "26.9 GB/32.0 GB" has no spaces around the slash (renderer.js:395, `fmtMiB(u)+'/'+fmtMiB(t)`)
- Dead CSS: `.metric-pill*` (style.css:317-380) is never constructed in HTML — only referenced defensively in event handlers (renderer.js:618, 641). Removal candidate
- Dead files: `tmp_*.js` scratch scripts (8 files, Aug 11) at project root
- Version hygiene: package.json is 1.1.0; bump before next `electron-builder` package run
- FAN row on fanless SXM: bar track renders at 0% (nearly invisible) — fine, but a candidate for hiding the track when value is null

## Restore Checklist

- [ ] Run `npx electron verify-app.js` from the project dir (boots real app ~15s) — expect `RESULT: PASS`
- [ ] Confirm power bar fill > 0 under load (GPU load it with a generation, watch the ⚡ row)
- [ ] Apply the additional fixes noted by the user next session
- [ ] Re-run harness after each change; layout regressions fail fast via the left/right audits
