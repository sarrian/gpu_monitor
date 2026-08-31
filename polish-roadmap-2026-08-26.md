---
created: 2026-08-26
updated: 2026-08-27
status: completed
aliases: [GPU Monitor Polish, GPU Monitor Fixes Plan, v1.2.0 polish]
tags: [gpu-monitor, polish, release, electron, roadmap, plan]
category: project
template: project
---

# GPU Monitor — Polish & Fixes Roadmap (v1.2.0)

**Purpose**: the full, phased plan for the pre-release polish batch — 10 UI/behavior fixes + 1 new feature (in-app version picker). Written 2026-08-26 after the [[Projects/GPU Monitor/checkpoint-2026-08-26]] restore point and the "hold release for polish" decision in [[Projects/GPU Monitor/release-runbook]].

**State at writing**:
- App: v1.1.0 (package.json) + v1.2.0 sprint + 08-19/08-20/08-24 fixes — all **uncommitted**
- `verify-app.js`: **RESULT: PASS** in this vault (2026-08-26); compact layout fits the 480×360 window
- Canonical repo: **this vault** (`Projects/GPU Monitor`)

**Constraints (user rules — Ponytail)**: YAGNI / simplest-working-implementation; **no new npm dependencies** (Node built-ins only); `verify-app.js` must end `RESULT: PASS` after **every** phase.

**Two scope decisions locked with the user (2026-08-26):**
- **Update picker = full in-app install** — list all published versions → pick one → button becomes `Update <ver>` → download that version's installer + apply, restarting into the chosen version (downgrade *and* upgrade).
- **✕ button = minimize to tray** (always); the ⏻ quit button = full quit; **drop the dead "Close to tray" setting** entirely (it does nothing today).

---

## The 10 items

1. Remove the metric-selection **highlight** (useless — the sparkline trigger *is* the icon selection).
2. Make the **selected icon stand out** with a **brighter border** when selected.
3. Fix **Quit GPU Monitor** (⏻) — it does nothing today; must close the app **and** its service.
4. Remove the **DevTools** button (🔍) — but keep the code, disabled, in case it's needed.
5. Remove the **alerts** system from Settings (dead + not useful).
6. Make **Show VRAM / Show Power Watts** actually work (currently dead — never wired).
7. Fix **dropdown** option lists rendering **white** (don't match the dark theme).
8. Make **Hide Sparklines** actually disable icon-click sparklines in the main window.
9. Turn **Check for Updates** into a **version picker** — list all published versions, pick one, button becomes `Update`, click fetches + applies the chosen version.
10. Remove the **minimize** icon (🔽, 3rd from left) — a no-op.

> Note: items 10 & the ✕/⏻/alerts/closure wiring are grouped by *phase* below, not by list order — each phase is independently verifiable.

---

## IPC contract delta

All existing channels stay unchanged (incl. `quit-app`, `hide-window`, `open-devtools`, `check-for-updates`, `updater-event`). **New channels:**

| Channel | Kind | Purpose |
|---|---|---|
| `force-quit` | renderer→main `send` | Phase C — always quit, bypasses the close-to-tray interceptor |
| `list-releases` | renderer→main `invoke` → `{ current, releases[] }` | Phase E |
| `install-release` | renderer→main `invoke(tag, asset)` | Phase E — download + launch installer + quit |

`preload/index.js`: add 3 bridge methods (lines ~39–53) + typedef (~23–38).
Progress/install/error for Phase E reuse the **existing** `updater-event` channel (namespaced `release-*`) — no new event plumbing.

---

## Phase A — UI removals + selection restyle (items 5, 1, 2, 10)

**A1. Remove dead header buttons** — `index.html`
- [x] Delete line 16 (`#btn-tray` 🔽) and line 18 (`#btn-devtools` 🔍).
- [x] **Keep** `hideWindow` (preload:50, main:261) and `openDevTools` (preload:51, main:245–247) — code stays, only the buttons go.
- [x] Update `#btn-close` title (line 19) → `"Minimize to tray"`.

**A2. Remove alerts system**
- [x] `index.html:77–90` — delete the whole "Alert Thresholds" group (5 dead number inputs).
- [x] `src/main.js:22–26` — delete the 5 JSDoc `@property` lines; `src/main.js:62` — delete the 5 alert keys from `DEFAULT_CFG` (leave line 63's `showSparklines/showPowerWatts/showVramRaw` intact).
- [x] `src/style.css:192–202` — delete `.gpu-alert-badge`, `.alert-dot`, `@keyframes alertPulse`.
- [x] Nothing else reads these (only `tmp_*.js` scratch files, already slated for deletion in the runbook). Stale keys in on-disk `config.json` are harmless — do **not** add stripping.

**A3. Selection highlight → bright border** — `src/style.css`
- [x] Remove: `257–262` (icon active bg+glow), `263–266` (row active — dead, class only toggled on the button), `267–272` (duplicate icon rule). Optionally also the dead `.sparkline-pill-active` at `492–496`.
- [x] In `.stat-icon-btn` (`235–250`): change `border: none` → `border: 1px solid transparent` (global `box-sizing:border-box` keeps 18×18 — no layout shift, harness icon-gap unaffected).
- [x] Add (positioned after the hover rule):
  ```css
  .stat-icon-btn.sparkline-pill-active { color: var(--accent); border-color: var(--accent); }
  ```
- [x] **Keep** the selection mechanism (`$selectedMetrics`, `card.dataset.sparkActive`, the class toggle at renderer.js:648) — the harness clicks this.

**Verify A:** harness `RESULT: PASS` (CSS-only, click path intact). Manual: click a stat icon → accent text + 1px accent border only, no row bg/glow; header = 5 buttons (⏸ 📌 ⚙ ✕ ⏻); no Alert group.

---

## Phase B — Wire the dead settings (items 6, 8) — all in `src/renderer.js`

Mirror the working `#set-show-processes` pattern (593–596): set `config.X`, call `window.electron.updateConfig({X})`, and add a restore line in `initSettingsUI` (23–49).

**B1. Shared helper for row visibility** (item 6). The metric-row DOM is built **once** (`renderDone`, 319/356), so toggling must show/hide the built rows, not rebuild:
```js
function applyMetricRowVisibility() {
  const set = (id, show) => document.querySelectorAll('.gpu-card [data-metric="' + id + '"]')
    .forEach(r => { r.style.display = show ? '' : 'none'; });
  set('vram',  config.showVramRaw    !== false);
  set('power', config.showPowerWatts !== false);
}
```
- [x] Call it in `render()`'s build branch (after the process-list append, ~line 374) and in each change handler.
- [x] Hidden rows stay in the DOM so the per-tick patch still works.

**B2. VRAM / Power handlers + restore** — `#set-show-vram-raw` (index.html:102), `#set-show-power-watts` (index.html:94): set+persist the flag, call the helper; restore both in `initSettingsUI`.
- [x] Both selects wired.

**B3. Sparklines handler + guard** (item 8) — `#set-show-sparklines` (index.html:110) and `#set-sparkline-history` (index.html:117):
- [x] Set+persist `config.showSparklines` / `config.sparklineHistorySeconds`; restore both in `initSettingsUI`.
- [x] On switching **OFF**: clear `$selectedMetrics`, each card's `dataset.sparkActive`, remove `.sparkline-pill-active` classes, and set the `.sparkline-canvas` to a "Sparklines disabled" note.
- [x] **Guard the icon-click handler** (insert near renderer.js:623): `if (!config.showSparklines) return;`.
- [x] History slider: rebuild all sparkline buffers on change (ephemeral data loss OK): `size = Math.round(val * (1000 / (config.updateInterval || 1000)))` → `createSparklineBuffer(...)` per metric.

**Verify B:** harness `RESULT: PASS` with both rows **Show** + sparklines **on** (see harness coupling below). Manual: toggle each select → rows hide/show on all cards; hide sparklines → clicks inert + canvas note; history slider → axis compresses; **restart** → all controls reflect saved values. Then reset to Show/on and re-run harness.

> **Harness coupling (biggest trap):** `verify-app.js` reads the *live* config and audits every visible row + the sparkline SVG. A hidden row (power `fillPct` null / `barGap` 0) or a disabled sparkline makes it **fail**. **End state before the final run: VRAM Show, Power Show, Sparklines Show.**

---

## Phase C — Quit / re-wire close (items 3, 10)

**C1. Force-quit path** — `src/main.js`
- [x] Add module-level (near `let tray`, ~line 74):
  ```js
  let forceQuitting = false;
  function forceQuit() { forceQuitting = true; app.quit(); }
  ```
- [x] New handler next to `quit-app` (241–242): `ipcMain.on('force-quit', forceQuit);`
- [x] **Interceptor fix** (302–307) — with the setting dropped, the escape condition becomes:
  ```js
  mainWindow.on('close', (e) => { if (!firstShown || forceQuitting) return; e.preventDefault(); mainWindow.hide(); });
  ```
- [x] **Tray-menu Quit** (main.js:94) currently calls bare `app.quit()` → swallowed by the interceptor. Change to `click: forceQuit`. (Latent bug this fix surfaces.)
- [x] `#btn-quit` (renderer.js, after the close-btn handler 573–576):
  `document.getElementById('btn-quit').addEventListener('click', () => window.electron.forceQuit());`
- [x] nvidia-smi children are non-detached/short-lived with kill timers (main.js:203/206, 270) — none outlive the app.
- [x] Preload: add `forceQuit: () => ipcRenderer.send('force-quit')`.

**C2. ✕ = minimize to tray** — replace the `#btn-close` handler body (renderer.js:573–576) with `window.electron.hideWindow()` (→ `hide-window` → `mainWindow.hide()`; does not fire `close`).
- [x] Handler swapped.

**C3. Drop the "Close to tray" setting** — delete the group at `index.html:70–76`; remove `minimizeToTray` from `DEFAULT_CFG` (main.js:61) and its JSDoc line (main.js:21).
- [x] Setting removed.

**Verify C:** harness `RESULT: PASS`. Manual: ✕ → window hides, tray click restores; ⏻ → app fully exits (no `electron`/`nvidia-smi` processes remain); tray-menu Quit also exits.

---

## Phase D — Dark dropdowns (item 7)

- [x] `src/style.css`: add `html { color-scheme: dark; }` (near the reset, ~line 60, or in `:root`). Chromium then renders native `<select>` popups + number-input spinners in the dark palette. No JS, no custom dropdown, no dependency.
- **Fallback only if it's still white on this box:** a styled custom dropdown for the 5 settings selects — significantly more code; do not build unless the color-scheme check fails.

**Verify D:** harness unaffected. Manual: open every `<select>` → dark list + dark options.

---

## Phase E — Version picker, full in-app install (item 9)

**New `src/releases.js`** (pure Node, no Electron imports — no circular deps):
- [x] `apiGet(url)` — `https.get` with a `User-Agent` header + manual redirect-follow (≤5 hops; asset URLs 302 to `objects.githubusercontent.com`).
- [x] `listReleases()` → `GET https://api.github.com/repos/sarrian/gpu_monitor/releases?per_page=30`; filter `!draft && assets`; map to `{ tag, name, publishedAt, exeAsset:{name,size,url}|null }` where `exeAsset` = first asset matching `/\.exe$/i` (suffix match, not exact filename).
- [x] `downloadAsset(url, dest, onProgress)` — follow redirects, stream to a file, emit percent.
- [x] Exports `{ listReleases, downloadAsset }`.

**`src/main.js`** (near the updater block, 293–297):
```js
ipcMain.handle('list-releases', async () => ({ current: app.getVersion(), releases: await releases.listReleases() }));
ipcMain.handle('install-release', async (_, tag, asset) => {
  if (!asset || !/^(https:\/\/([a-z0-9.-]*github\.com|objects\.githubusercontent\.com)\/)/.test(asset.url)) throw new Error('Invalid asset URL');
  const send = (n,d) => mainWindow && mainWindow.webContents.send('updater-event', n, d);
  const dir = path.join(os.tmpdir(), 'gpu-monitor-updates'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, asset.name);
  await releases.downloadAsset(asset.url, dest, pct => send('release-progress', pct));
  send('release-installing', '');
  const child = spawn(dest, ['/S'], { detached: true, stdio: 'ignore' }); // NSIS silent
  child.unref();
  forceQuit(); // Phase C path
});
```
- [x] **Ordering:** spawn detached+unref (survives app exit) → `forceQuit()`. Per-machine NSIS triggers UAC, which serializes the replace. Fallback if "file in use" appears: ~500 ms delay between spawn and quit. Wrap in try/catch → `send('release-error', msg)` + `throw`.

**`preload/index.js`:** `listReleases: () => ipcRenderer.invoke('list-releases')`, `installRelease: (tag, asset) => ipcRenderer.invoke('install-release', tag, asset)`.

**`index.html`** Updates group (121–125): keep button + status span; insert a `<select id="set-release-version">` (with a "Refresh list…" option) between them. Leave the `#update-overlay` + its handlers untouched (kept auto-update path).

**`src/renderer.js`** update section (656–704):
- [x] `refreshReleases()`: populate the select (mark current = `app.getVersion()` as disabled; disable options with no `exeAsset`; auto-select newest installable); show the select; catch → status error (offline/API).
- [x] `#btn-check-updates` click: no list → `refreshReleases()`; else if a version is selected → status `"Downloading <tag>…"` + `installRelease(...)`; else `"No installable release"`.
- [x] `#set-release-version` change: `__refresh__` → re-fetch; else set `selectedTag` + button text → `"Update " + tag`.
- [x] `onUpdaterEvent` switch: add `release-progress` (→ `%`), `release-installing` (→ "approve UAC"), `release-error` (→ "Error: …").
- [x] Edge cases: no `.exe` (disabled option + main-side guard), offline (status error, app usable), current version (disabled), re-fetch (Refresh option).

**Verify E:** harness `RESULT: PASS`. Manual (needs network + a published release with a `.exe`): open Settings → Updates → "Check for Updates" → list populates, latest selected, current marked; pick a version → button reads "Update v…"; click → percent ticks in `#update-status` → UAC/installer → app quits → installed version launches.

---

## Verification cadence & ordering

**Order:** A → B → C → D → E (E depends on C's `forceQuit`).

**After every phase:** run `npx electron verify-app.js` in the project dir and require `RESULT: PASS`. Leave all settings in **Show/enabled** state before the final run (harness coupling, Phase B).

**Suggested commit grouping (if committing per phase):**
- A — `refactor: remove dead controls + alerts; restyle icon selection to border`
- B — `feat: wire VRAM/Power visibility + sparkline toggle/history`
- C — `fix: force-quit + re-wire close to minimize-to-tray`
- D — `style: dark native dropdowns via color-scheme`
- E — `feat: release version picker + in-app install`

---

## Critical files

- `src/main.js`, `src/renderer.js`, `src/style.css`, `index.html`, `preload/index.js`
- new `src/releases.js` (Phase E)
- `verify-app.js` (read-only gate after every phase)

---

## Implementation outcome (2026-08-27)

**All five phases implemented in order; `npx electron verify-app.js` → `RESULT: PASS` after each.** No deviations from the plan except:

- Phase E: the planned ~500 ms pre-quit delay was included from the start (`setTimeout(() => forceQuit(), 500)`) — belt-and-braces against NSIS "file in use."
- `src/main.js` gained `require('os')` for the installer temp dir.
- Phase B first harness run failed on the **live config** still carrying stale `showPowerWatts:false` / `showVramRaw:false` (exactly the coupling trap the B-note predicted). Flipped both to `true` in `%APPDATA%/gpu-monitor/config.json` → PASS. User can hide either row again from Settings.

**Open — needs user decision (blocks Phase E manual verification + git push + auto-update):**
repo `sarrian/gpu_monitor` is **private** (unauthenticated releases API → 404) and the PAT embedded in the git remote URL is **dead** (→ 401; `git ls-remote` also fails). Options: (a) make the repo public — zero code change; (b) supply a valid token — small auth-header addition, never hardcoded.

**Per-phase manual checklist (for the user):**
- A: header = ⏸ 📌 ⚙ ✕ ⏻ only; no Alert group; icon selection = accent text + 1px accent border, no row highlight
- B: toggle each select → rows show/hide; Hide Sparklines → clicks inert + "disabled" note; history slider works; restart → all restored
- C: ✕ → tray (click restores); ⏻ → app gone (check process list); tray Quit → app gone
- D: every `<select>` popup renders dark
- E: Settings → Updates → list populates, pick a version → download % → UAC → restart into that version (⚠️ blocked by credentials above)

---

## Related

- [[Projects/GPU Monitor]] — project home
- [[Projects/GPU Monitor/checkpoint-2026-08-26]] — current restore point (compact layout, verified PASS, fits 480×360)
- [[Projects/GPU Monitor/release-runbook]] — post-polish release procedure (v1.2.0 on hold)
- [[Projects/GPU Monitor/checkpoint-2026-08-24]] — functional-fix context (power bar, fan NaN, sparkline scale)
- [[Reference/electron]] — electron-builder / electron-updater background
