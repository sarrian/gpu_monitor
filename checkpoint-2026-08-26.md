---
created: 2026-08-26
updated: 2026-08-26
status: active
tags: [checkpoint, restore-point, gpu-monitor, v1.1.0]
category: checkpoint
---

# GPU Monitor — Checkpoint (compact v1.0.1-style layout)

**Created**: 2026-08-26
**State**: v1.0.1-era compact spacing restored on top of the 08-24 functional fixes — content fits the starting 480×360 window exactly (`verify-app.js` fit line: `315px vs 315px (fits)`) — `verify-app.js` ends in **RESULT: PASS**
Supersedes [[checkpoint-2026-08-24]] (its functional fixes remain valid; its layout values were compacted)

## How to Resume (Next Session)

Copy this block exactly:

```
Continue the GPU Monitor work from [[checkpoint-2026-08-26]]. State is good: compact v1.0.1-style layout
(18px borderless icons, 2px row padding, 52px label column, process list inside the GPU card),
content fits the 480×360 window (harness fit line says "(fits)"), verify-app.js reports RESULT: PASS.
Next, apply these additional fixes: <describe fixes here>.
Verify with `npx electron verify-app.js` in the project dir before declaring anything done.
```

## What Changed This Session

| # | Change | Where | Detail |
|---|--------|-------|--------|
| 1 | Grid padding + bleed trick removed | `style.css` `.metrics-grid`, `.stat-row` | `.metrics-grid` padding `0 10px` → none; `.stat-row` `margin: 1px -10px` + `width: calc(100% + 20px)` → plain. Row still spans the full card width (grid has no padding), so the full-width hover background is preserved **without** the bleed coupling |
| 2 | Row padding | `style.css` `.stat-row` | vertical 4px → 2px (row height 30px → 22px) |
| 3 | Icon button | `style.css` `.stat-icon-btn` | 22px box + 1.5px border + 2px padding → 18px borderless (v1.0.1 geometry); hover/active keep background + glow |
| 4 | Label column | `style.css` `.stat-label` | 58px → 52px — still fits longest label ink (45–48px) with ≥3px bar gap (harness enforces) |
| 5 | Value column | `style.css` `.stat-value`, `.metric-value` | min-width 62px → 46px (v1.0.1); font stays 11px (08-24 uniform right column preserved) |
| 6 | Header + accent | `style.css` `.gpu-header`, `.gpu-accent` | padding 10/14/6 → 7/12/4; accent bar 28px → 22px |
| 7 | Sparkline shorter | `renderer.js` sparkline call, `style.css` `.sparkline-canvas` | SVG height 60 → 50 (viewBox 460×52); min-height 62px → 52px; 3 scale labels + 3 gridlines unchanged |
| 8 | Process list inside card | `renderer.js` first-render | was a separate `.gpu-card` (extra border + gap + padding); now a `.process-list` section appended inside the **last** GPU card — the v1.0.1 structure (its `border-top` divider style was always built for this) |
| 9 | Micro-spacing | `style.css` `.gpu-container`, `.sparkline-pill-row`, `.process-list`, `.process-item` | container 8px/12px padding + 6px gap; tightened item paddings |
| 10 | Harness hardening | `verify-app.js` | left audit now prints a **fit line** (content vs window, informational); axis audit classifies time-vs-scale labels by unit presence instead of a bottom-15% band (the band silently dropped all time labels when the SVG height changed) |

## Verified Numbers (final harness run, 2026-08-26)

```
fit: content 315px vs window 315px (fits)
icon gap (all 8 rows): 11px        value gap (all 8 rows): 11px
label ink:  Mem Load 48px / GPU Load 45px  (both inside 52px column)
min bar-gap: 7px                   NaN values: none
fills:  Temp 46°C→38%  Power 40.3W→13%  VRAM 31.8/32GB→99%  Fan -- (no track fill)
sparkline: PASS  (0 area paths, 3 °C scale labels, 3 gridlines, time labels unique + single baseline)
RESULT: PASS
```

## Key Code Layout (current)

```
style.css
  .gpu-container       padding 8px 12px, gap 6px
  .gpu-header          padding 7px 12px 4px; .gpu-accent height 22px
  .metrics-grid        NO horizontal padding
  .stat-row            padding 2px 10px — no bleed margin, width auto (spans full card)
  .stat-icon-btn       18×18px, borderless
  .stat-label          width 52px (fixed column — must fit longest label ink)
  .stat-value / .metric-value   11px font, min-width 46px (uniform right column)
  .sparkline-canvas    min-height 52px
renderer.js
  sparkline call:      renderSparklineSVG(data, 420, 50, ...) — height param drives viewBox
  process list:        appended to the LAST .gpu-card (single border-top section), not a separate card
verify-app.js
  fit line:            left audit prints scrollHeight vs clientHeight (informational, not gated)
  axis audit:          time vs scale labels classified by unit presence (geometry-independent)
```

## Gotchas (read before touching layout again)

1. **Bleed trick is gone** — the 08-24 gotcha about `margin: -10px` + `width: calc(100% + 20px)` coupling no longer applies. Full-width hover works because the grid has no padding. If you re-add grid padding, full-width hover needs the bleed trick (or a wrapper) back.
2. **`.stat-label` 52px is still a fixed column** — a longer label silently overlaps the bar again; the harness ink-vs-column check (≥3px) will catch it.
3. **Process list lives inside the last GPU card** — the patch phase finds it via `[data-proc-list]` under `.gpu-container`, so structure moves are safe as long as that attribute survives.
4. **Axis audit is geometry-independent now** (unit presence, not a pixel band) — SVG height changes no longer break it.
5. **`patchFillCtx` skips width updates when `max` is null** — GCLK/MCLK intentionally pass null (empty track by design).
6. **NaN ≠ null in JS** — `n()` parse helper (renderer.js line 100) normalizes at the source; any value bypassing it must be guarded.

## Candidate Follow-Ups (carried over from 08-24, untouched)

- Cosmetic: VRAM value `"26.9 GB/32.0 GB"` has no spaces around the slash (renderer.js, `fmtMiB(u)+'/'+fmtMiB(t)`)
- Dead CSS: `.metric-pill*` (style.css) never constructed in HTML — removal candidate (defensive refs in renderer.js handlers)
- FAN row on fanless SXM: bar track renders at 0% (nearly invisible) — candidate: hide track when value is null
- With 5+ processes visible the list can run past the fold — container scrolls; acceptable for now (window stays 480×360 per user request)

## Restore Checklist

- [ ] Run `npx electron verify-app.js` from the project dir (boots real app ~15s) — expect `RESULT: PASS` + fit line `(fits)`
- [ ] `npm start` — check process list renders inside the card, hover backgrounds full-width, sparkline metric switching, settings persistence
- [ ] Re-run harness after each change; layout regressions fail fast via the left/right audits
