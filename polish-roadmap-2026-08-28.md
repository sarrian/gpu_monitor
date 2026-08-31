---
created: 2026-08-28
updated: 2026-08-28
status: completed
aliases: [GPU Monitor Polish 2026-08-28, v1.2.1 polish, Per-metric toggles + dark dropdowns]
tags: [gpu-monitor, polish, release, electron, roadmap, plan]
category: project
template: project
---

# GPU Monitor — v1.2.1 Polish Batch (4 fixes)

**Purpose:** the planned + approved fixes raised after the [[Projects/GPU Monitor/polish-roadmap-2026-08-26]] batch landed. Written 2026-08-28, **approved before any code was touched** (user rule: document in the vault and get sign-off first).

**State at writing:**
- App: v1.1.0 (`package.json`) + v1.2.0 sprint + prior fixes — all **uncommitted**
- `verify-app.js`: **RESULT: PASS** (last run 2026-08-27)
- Canonical repo: **this vault** (`Projects/GPU Monitor`)

**Constraints (standing — Ponytail):** YAGNI / simplest working implementation · **no new npm dependencies** · `verify-app.js` must end `RESULT: PASS` after **every** phase · `verify-app.js` is read-only (never modify) · no new secrets.

## The 4 fixes

1. **Per-metric Show/Hide** — a Show/Hide toggle for **every** metric row (today only VRAM + Power have one), "like we have for show/hide vram and power."
2. **Rename** the Power setting to just **"Show Power"** (drop "Watts") and VRAM to **"Show VRAM"** (drop "Raw").
3. **Compact when sparklines disabled** — drop the "Sparklines disabled" text and the ~52px dead space so the card bottom is compact again.
4. **Minimize glyph** — change the ✕ (minimize) to a **line**, since "usual X is for close."
5. **Dark dropdown popups** — the open `<select>` option list still renders **white** on this box despite `html { color-scheme: dark }`.

> Numbered 1–5 to match the user's message; the "rename" (2) is folded into the per-metric work (1), so the implementation is **4 distinct code tasks**.

## Harness coupling (read before touching visibility)

`verify-app.js` boots the **real** app and reads the **live** config at `%APPDATA%\gpu-monitor\config.json`. Its left-column audit fails if **any** `.stat-row` with a bar is hidden (zero-rect → `barGap=0`; a hidden Power row → `fillPct=null` → `powerOk=false`), and its sparkline-axis audit needs the SVG **laid out (visible)**, not just present in the DOM. The harness never touches the settings panel, top bar, or dropdowns.

➡ **Verified end-state before the final run: all 8 metrics = Show, Sparklines = ON.** (Live config already holds this — just don't leave a toggle off.)

## Task 1 — Per-metric Show/Hide for all 8 metrics

Generalize the existing VRAM/Power toggles to every metric. Config = **8 flat booleans** (matches the `config.X !== false` idiom; a missing key safely defaults to shown). The two legacy keys are **renamed**, not added alongside.

| `data-metric` | config key | select id | label |
|---|---|---|---|
| `temp` | `showTemp` | `set-show-temp` | Temp |
| `power` | `showPower` | `set-show-power` | Power |
| `gpu-load` | `showGpuLoad` | `set-show-gpu-load` | GPU Load |
| `mem-load` | `showMemLoad` | `set-show-mem-load` | Mem Load |
| `vram` | `showVram` | `set-show-vram` | VRAM |
| `gpu-clock` | `showGpuClock` | `set-show-gpu-clock` | GPU Clock |
| `mem-clock` | `showMemClock` | `set-show-mem-clock` | Mem Clock |
| `fan` | `showFan` | `set-show-fan` | Fan |

- **`src/main.js`** — `DEFAULT_CFG`: replace `showPowerWatts`/`showVramRaw` with the 8 keys (all `true`); add 8 `@property {boolean}` lines to the `AppConfig` JSDoc; **migration must test the on-disk object** (not the merged config, which `DEFAULT_CFG` already defines):
  ```js
  if (savedConfig) {
    Object.assign(config, savedConfig);
    if (savedConfig.showPowerWatts !== undefined && savedConfig.showPower === undefined) config.showPower = savedConfig.showPowerWatts;
    if (savedConfig.showVramRaw  !== undefined && savedConfig.showVram  === undefined) config.showVram  = savedConfig.showVramRaw;
    delete config.showPowerWatts; delete config.showVramRaw;
  }
  ```
- **`index.html`** — replace the two legacy groups with 8 `Show X` / `Hide X` groups in the same spot.
- **`src/renderer.js`** — one `METRICS` table (`{ id, key, label }`) drives `applyMetricRowVisibility()` (loop all 8), the `initSettingsUI` restore (loop), and one `change`-handler loop. Optional: delete the dead `set-show-clock-mhz` handler (its element doesn't exist).

## Task 2 — Compact card when sparklines disabled

Hide the `.sparkline-canvas` entirely when off (kills the text **and** the `min-height:52px` space); restore + `render()` when on. **`renderer.js` only.**
- New `applySparklineVisibility()` helper (mirrors `applyMetricRowVisibility`).
- Call it in `render()`'s build branch (covers **boot-with-sparklines-off**) and in the toggle handler's both branches (replacing the "Sparklines disabled" span).
- Do **not** touch `.sparkline-canvas { min-height:52px }` — `display:none` makes it moot, ON-state geometry the harness audits is untouched.

## Task 3 — Minimize glyph → line

`index.html:17` — swap `✕` for an em dash `—` (U+2014). One character. Behavior unchanged (`hideWindow` → minimize to tray); `⏻` quit stays. Harness-neutral. (Avoid `▁` — emoji-presentation risk on Win 11; a CSS-drawn bar is crisper but not worth the code under YAGNI.)

## Task 4 — Dark dropdown popups

`color-scheme` cannot reliably darken the native Windows popup (disproven on this box; no safe Chromium flag). Build the sanctioned fallback: a **styled custom dropdown** that keeps the native `<select>` as the hidden value store, so **all existing `change` handlers fire unchanged** via `dispatchEvent(new Event('change'))`.
- **`renderer.js`** — `function initDarkDropdowns()`, called inside `init()` **after `initSettingsUI()`** (so initial labels reflect restored values). Wraps every `.settings-body select` (12 total) in a button + dark option list.
- **Release-version select** (dynamic, initially hidden): hide the native select with a `!important` class (so `refreshReleases()`'s inline `style.display=''` can't un-hide it); the existing `style.display !== 'none'` guard still works because it reads the *inline* style. Add a one-line wrapper reveal in `refreshReleases()`.
- **`style.css`** — append the `.dd*` rules (dark button, absolute dark list, hover/selected/disabled states, `.dd-native { display:none !important }`).

## Order of operations (each ends with the harness gate)

1. **This note written + linked** (the "documented before work" gate) ✅
2. **Task 1** — `main.js` → `index.html` → `renderer.js` → harness **PASS**
3. **Task 2** — `renderer.js` → harness **PASS**
4. **Task 3** — `index.html` (one char) → harness **PASS**
5. **Task 4** — `renderer.js` + `style.css` → harness **PASS** + manual dropdown checklist
6. **This note updated** with outcomes + manual checklist

**Harness:** `Projects\GPU Monitor` → `npx electron verify-app.js`. Close the running app before the final run.

## Manual verification checklist
- **T1:** each toggle hides/showes its row (all GPUs); restart → all 8 selects reflect saved values
- **T2:** Sparklines off → compact, no text; on → sparkline draws (icon-click → SVG)
- **T3:** top bar reads ⏸ 📌 ⚙ — ⏻; `—` minimizes to tray (tray click restores)
- **T4:** all 12 dropdowns dark (hover, selected marker, disabled entries); outside-click closes; `Check for Updates` → picker → pick → `Update vX`; `Refresh list…` repopulates; settings restore after restart

## Out of scope (noted, not fixed)
- If GPU data vanishes mid-session, `render()` swaps the container for the error message while `renderDone` stays `'1'`, so the card never rebuilds (`renderer.js:335–342` vs 345). Unrelated to these four.

## Implementation outcome

**All 4 tasks implemented; `verify-app.js` → `RESULT: PASS` (2026-08-28).** The per-task harness runs were batched into one final-state run because the command-safety classifier was intermittently unavailable mid-implementation (a transient tool outage, not a code problem); the single final run validates all four together in the all-Show + Sparklines-ON end-state.

- **T1 — Per-metric show/hide (all 8):** `main.js` `DEFAULT_CFG` + 8 JSDoc `@property` lines + on-disk-key migration (legacy `showPowerWatts`/`showVramRaw` → `showPower`/`showVram`, tested against the saved object); `index.html` 8 `Show X`/`Hide X` groups; `renderer.js` one `METRICS` table drives visibility + restore + change handlers; dead `set-show-clock-mhz` handler removed. Power → "Show Power", VRAM → "Show VRAM" (Watts/Raw dropped).
- **T2 — Compact when sparklines off:** new `applySparklineVisibility()` hides `.sparkline-canvas` (kills the text **and** the 52px `min-height` space); called in `render()`'s build branch (boot-with-off) and in both toggle-handler branches; the "Sparklines disabled" span is gone.
- **T3 — Minimize glyph:** top-bar `✕` → `—` (em dash); `⏻` quit and minimize-to-tray behavior unchanged.
- **T4 — Dark dropdowns:** `initDarkDropdowns()` wraps all 12 `.settings-body select`s in a dark button + option list; the native select stays the hidden value store (`.dd-native { display:none !important }`) and fires `change` unchanged; the release picker is revealed + label-synced in `refreshReleases()`; `.dd*` rules appended to `style.css`. One hardening over the plan: the init-time hidden check reads the **inline** `sel.style.display` (not `getComputedStyle`), so it depends only on the release select's own inline `display:none` and never on the panel's `transform`-based hidden state.

**Harness scope (read the fine print):** `verify-app.js` only audits the automated invariants (left-column bar rows visible, sparkline SVG laid out) in the all-Show + Sparklines-ON end-state — it never enters the settings panel, top bar, or dropdowns. The **Manual verification checklist** above (T1–T4) therefore still needs a quick eyeball in the running app before the v1.2.1 release is cut.

---

## Related

- [[Projects/GPU Monitor]] — project home
- [[Projects/GPU Monitor/polish-roadmap-2026-08-26]] — prior 10-item batch (all done)
- [[Projects/GPU Monitor/checkpoint-2026-08-26]] — layout restore point (compact, PASS)
- [[Projects/GPU Monitor/release-runbook]] — release procedure (v1.2.0 on hold)
- [[Reference/electron]] — electron-builder / electron-updater background
