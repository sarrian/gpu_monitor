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
