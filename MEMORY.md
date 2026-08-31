# GPU Monitor — Session Notes (2026-08-04)

## Key Lessons Learned

### Electron on Windows gotchas
- `screen.getPrimaryDisplay()` deprecated in Electron 35+ → use `screen.getAllDisplays()[0]`
- Transparent windows ignore CSS `background: var(--bg-primary)` — use `transparent: false, frame: false` instead
- `__dirname` resolves to the JS file's directory (e.g. `src/`) — go up with `..` for root files (`index.html`, `preload/`)
- Electron package needs postinstall script approved (`npm install-scripts approve electron`) or binary won't download
- PATH inheritance from Electron may not match terminal PATH — always provide fallback paths for CLI tools

### nvidia-smi compatibility
- Different NVIDIA drivers support different query fields
- Tested working fields: `name,uuid,index,temperature.gpu,power.draw,utilization.gpu,utilization.memory,memory.used,memory.total,clocks.current.graphics,clocks.current.memory,fan.speed`
- Do NOT use `power.total_limit`, `performance_state`, `clocks.max.*`, `clocks.current.video` — not universally supported
- Exit code 2 = field error or driver issue; always check stderr on failure

### Architecture notes
- Renderer cannot access `mainWindow` directly (context isolation) — all window control via IPC
- For transparent/no-frame windows, dragging must use IPC (`get-window-bounds` + `move-window`) rather than `-webkit-app-region: drag`
- Initial render should show "No GPU" state before first data fetch to avoid blank screen

### Vault cleanup performed this session
- Deleted 10 unnecessary files (empty file, report templates, redundant README)
- Added missing references: electron.md, GPU.md, nvidia-smi.md, Reference.md MOC
- Fixed all broken wikilinks in GPU Monitor.md
- Hidden `node_modules` from Obsidian (add to Settings → Files & Links → Folders to ignore)

### Bug fixes applied (2026-08-04)
- **Pin button visual state** — Both toggle states showed identical `📌`; fixed by using full opacity when pinned and 0.4 opacity when unpinned, with hover restoring full brightness for clear interactive feedback
- **Settings slider defaults** — Interval/opacity sliders read from wrong config keys (`interval` vs `updateInterval`, `width` vs `windowWidth`) and opacity was stored as 0–1 but displayed as 30–100; fixed key normalization in both directions (load + save)
- **Window width removed** — The settings slider for window width was dead code: it only set the initial BrowserWindow size on creation but was never applied to a running window; the window is resizable by dragging edges. Removed from HTML, renderer.js, and main.js DEFAULT_CFG
- **Default alwaysOnTop** — Changed from `true` to `false`; fresh installs no longer force always-on-top (user chooses to pin)

### Phase 3 — Build Pipeline (2026-08-04)

#### New files created
- `src/updater.js` — Auto-update manager wrapping `electron-updater`'s `autoUpdater`. Checks on startup (10s delay, production only), forwards events via IPC to renderer. Exports `init(mainWindow)`, `manualCheck()`, `quitAndInstall()`.
- `.gitignore` — Excludes `node_modules/`, `dist/`, `.claude/`, `config.json`, `*.pfx`

#### Key files modified
- `package.json` — Added `electron-updater` dependency, electron-builder NSIS config (oneClick:false, perMachine:true, shortcuts), artifact naming (`GPU-Monitor-Setup-${version}-${os}.${ext}`)
- `src/main.js` — Imports updater module, calls `updater.init(mainWindow)` after window creation, adds IPC handlers for `check-for-updates`/`quit-and-install`
- `preload/index.js` — Added `checkForUpdates()`, `restartAndInstall()` IPC methods. Added event emitter class + `onUpdaterEvent(cb)` bridge for IPC events from main → renderer.
- `index.html` — Added update overlay dialog (hidden by default) + "Check for Updates" button in settings panel
- `src/renderer.js` — Overlay show/hide logic, event listener via `window.electron.onUpdaterEvent()`, button handlers for check/restart/later
- `src/style.css` — Update overlay animation (`fadeScaleIn`) and hidden state
- `GPU Monitor.md` — Updated Features table, file structure, milestone status, added Build Instructions section

#### Critical bug: electron-updater missing from installer (Issue #1)
**Symptom**: `"Cannot find module 'electron-updater'"` crash on launch after install.
**Root cause**: Custom `files` array in package.json replaced electron-builder's defaults entirely. The custom globs listed source dirs only, stripping all production dependencies (including electron-updater) from the .exe.
**Fix**: Removed the custom `files` glob. Electron-builder's default files include all production dependencies. Only `electron-updater` is in `dependencies` — it's now bundled automatically.

#### Critical bug: electron-updater missing from installer (Issue #2)
**Symptom**: Same `"Cannot find module 'electron-updater'"` crash after Issue #1 was fixed.
**Root cause**: `electron-updater` listed in package.json but **`npm install` was never run**, so it wasn't in node_modules at all. Electron-builder packaged what existed — nothing.
**Fix**: Ran `npm install` to install the missing dependency, then `npm run build:exe` to rebuild.
**Lesson**: For Electron + electron-builder, every production dependency must survive the chain: package.json → npm install → node_modules → dist/app.asar. Listing it in package.json alone is not enough.

#### GitHub repo setup
- Repo: https://github.com/sarrian/gpu_monitor
- Remote: `origin` pointing to the above URL with PAT embedded in URL
- Tagged: v1.0.0 (initial), v1.0.1 (fix)
- Release: v1.0.1 published to GitHub Releases with .exe asset

#### Electron-updater flow
1. On startup in production: `autoUpdater.checkForUpdates()` after 10s delay
2. If update available → `update-downloaded` event fires → renderer shows overlay dialog
3. User clicks "Restart Now" → `autoUpdater.quitAndInstall(true, true)` — app restarts with new version
4. electron-updater queries `https://api.github.com/repos/sarrian/gpu_monitor/releases/latest` for updates
5. Must have a GitHub Release published (with .exe asset) for updates to be detected

#### Build commands
```bash
npm install && npm run build:exe -- --win
# Output: dist/GPU-Monitor-Setup-{version}-win.exe
# Also produces: latest.yml, *.blockmap files in dist/
```

#### Version bump workflow
1. Edit `package.json` version field (NOT git tag — electron-builder reads package.json)
2. Commit → push to GitHub → push matching git tag
3. Run `npm run build:exe -- --win`
4. Create GitHub Release with the .exe from dist/
5. Users auto-update via built-in overlay dialog
