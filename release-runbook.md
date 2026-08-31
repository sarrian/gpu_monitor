---
created: 2026-08-26
updated: 2026-08-27
status: active
aliases: [GPU Monitor Release, Release v1.2.0]
tags: [gpu-monitor, release, runbook, electron, electron-updater]
category: project
template: project
---

# GPU Monitor — Release Runbook

**Purpose**: the exact, tested sequence for shipping a release. Written 2026-08-26 when the v1.2.0 work is complete and verified but the user decided to **hold release for polish**. Re-run this top-to-bottom when the polish gate below is green.

**Current state at writing**:
- Code: v1.1.0 (package.json) + v1.2.0 sprint + 08-19/08-20/08-24 fixes — all uncommitted
- Last commit: `96d3858` (v1.0.1), branch `main` tracking `origin/main`
- Last GitHub release: **v1.0.1** — https://github.com/sarrian/gpu_monitor/releases
- `verify-app.js`: **PASS** in this vault (2026-08-26; re-run 2026-08-27 after polish batch: PASS)
- Canonical repo: **this vault** (`Projects/GPU Monitor`); DevTeamAlpha copy still exists and can drift
- **2026-08-27 update:** the 10-item polish batch is implemented ([[Projects/GPU Monitor/polish-roadmap-2026-08-26]]); release still on hold — blocked on GitHub credentials (repo private + PAT dead) and 3 legacy cosmetic items in §1

---

## 0. Pre-release gate (MUST be green)

- [ ] All polish items in §1 done and re-verified (10-item batch **done 2026-08-27** — 3 legacy cosmetic items remain)
- [ ] **GitHub credentials working** (2026-08-27 finding: repo is private + PAT in remote URL is dead → push, `gh release create`, auto-update, and the in-app version picker all fail until resolved — make repo public or supply a valid token)
- [ ] `npx electron verify-app.js` → `RESULT: PASS` (run in this folder; last run 2026-08-27: PASS)
- [ ] Manual pass: `npm start` — check tray/quit behavior (✕→tray, ⏻→exit), settings persistence, dark dropdown popups, multi-metric sparklines (°C / MHz / W / % scales), version-picker flow
- [ ] Working tree contains only intended changes: `git status` reviewed

## 1. Polish backlog (fill in as items are scoped)

> Seed from [[Projects/GPU Monitor/checkpoint-2026-08-24]] "Candidate Follow-Ups":

- [ ] Cosmetic: VRAM value `"26.9 GB/32.0 GB"` has no spaces around the slash (renderer.js, `fmtMiB(u)+'/'+fmtMiB(t)`)
- [ ] Dead CSS: `.metric-pill*` (style.css:317-380) never constructed in HTML — removal candidate (defensive references at renderer.js:618, 641)
- [ ] FAN row on fanless SXM: bar track renders at 0% (nearly invisible) — candidate: hide track when value is null
- [x] Compact layout — **done 2026-08-26** (user request: "more compact like v1.0.1, fits the starting window"): 18px borderless icons, 2px row padding, no grid padding/bleed trick, 52px label column, 46px value column, 50px sparkline, process list as in-card section — content now fits the 480×360 window exactly ([[Projects/GPU Monitor/checkpoint-2026-08-26]])
- [x] **(user additions — the 10-item batch)** — **done 2026-08-27**: all implemented + verified in [[Projects/GPU Monitor/polish-roadmap-2026-08-26]] (dead buttons, alerts removal, icon-selection border, VRAM/Power toggles wired, sparkline toggle wired, dark dropdowns, quit/tray rewiring, in-app version picker)

**After any polish edit**: re-run `npx electron verify-app.js` before touching anything else — the left/right audits fail fast on layout regressions.

## 2. Release-prep cleanup (right before building)

- [ ] Delete ~12 `tmp_*.js` scratch scripts at project root (08-11/08-12 era): `tmp_add_alerts.js`, `tmp_add_badge.js`, `tmp_add_badge_fn.js`, `tmp_fix_badge_fn.js`, `tmp_fix_badge_fn2.js`, `tmp_add_threshold_inputs.js`, `tmp_add_threshold_js.js`, `tmp_add_threshold_handlers.js`, `tmp_fix_badge_bg.js`, `tmp_replace_color.js`, `tmp_update_color.js`
- [ ] Decide on `release-notes.md` — currently staged (index) but deleted from worktree (`AD` in `git status`). Either `git rm --cached release-notes.md` to drop it, or restore + keep as per-release notes
- [ ] Optional hygiene: move PAT out of remote URL (`git remote set-url origin https://github.com/sarrian/gpu_monitor.git` + credential helper) — PAT is currently embedded in the URL
- [ ] Optional: retire the DevTeamAlpha copy (`C:\Users\Andi\Documents\DevTeamAlpha\projects\GPU Monitor`) as a working tree to stop drift — **ask user first**, never delete another vault's content unilaterally

## 3. Release steps (in exact order)

> Rules learned the hard way ([[Projects/GPU Monitor/checkpoint-2026-08-24]], v1.0.1 history):
> 1. **electron-builder reads the version from `package.json`, NOT the git tag** — bump package.json first
> 2. A **GitHub Release with a `.exe` asset** is required for electron-updater to detect updates
> 3. Auto-update checks `https://api.github.com/repos/sarrian/gpu_monitor/releases/latest` — production builds only, 10s after startup

```bash
cd "C:\Users\Andi\Documents\Obsidian Vault\Projects\GPU Monitor"

# 1 — bump version in package.json (e.g. 1.1.0 → 1.2.0)  [edit file, do not sed]

# 2 — build the installer (unsigned for now)
npm run build:exe -- --win
# → dist/GPU-Monitor-Setup-<version>-win.exe  (+ latest.yml, .blockmap)

# 3 — sanity-check the artifact exists and the version is right
ls -lh dist/GPU-Monitor-Setup-*-win.exe

# 4 — commit the source (including package.json bump + polish changes)
git add -A
git commit -m "release: GPU Monitor v<version> — <one-line summary>"

# 5 — push, then tag
git push origin main
git tag v<version>
git push origin v<version>

# 6 — publish the GitHub Release with the .exe (required for auto-update)
gh release create v<version> \
  dist/GPU-Monitor-Setup-<version>-win.exe \
  --title "GPU Monitor v<version>" \
  --notes "<release notes>"

# 7 — verify auto-update path end-to-end
#    a) run the INSTALLED v1.0.1 app (if present) → it should offer the update overlay
#    b) or: curl -s https://api.github.com/repos/sarrian/gpu_monitor/releases/latest | grep -E '"tag_name"|browser_download_url'
```

## 4. Post-release

- [ ] Update [[Projects/GPU Monitor]]: milestones table, `status`/tags, frontmatter `updated`, move "release pending" items out of Remaining work
- [ ] Update [[Projects]] MOC entry
- [ ] Log to the day's `Daily/` note
- [ ] If code signing cert arrives later: add `scripts/sign.js` + `build.win.sign` config (see [[Reference/code-signing]]), rebuild, and re-publish — SmartScreen reputation also accrues per-publisher over time, so the unsigned release is still fine to ship

## 5. Known constraints / gotchas

| Constraint | Impact |
|---|---|
| No code signing yet (EVCA cert blocked on purchase) | SmartScreen warning on first install; acceptable for personal use |
| Auto-update silently shows "Up to date." when no GitHub Release exists | §3 step 6 is not optional |
| Custom `files` globs strip production deps | Do NOT re-add a custom `files` array to package.json (v1.0.1 crash regression) |
| `npm install` must have run for every production dep | package.json entry alone doesn't bundle anything (v1.0.1 crash regression) |
| Branch is `main`; repo has no CI | Everything in §3 is manual — no safety net between steps |
| `patch-devtools.ps1` hardcodes the vault path | Fine for now; would break if the folder moves again |

---

## Related

- [[Projects/GPU Monitor]] — project home
- [[Projects/GPU Monitor/checkpoint-2026-08-24]] — current code state + candidate follow-ups
- [[Projects/GPU Monitor/sprint-2026-08-12]] — v1.2.0 scope (resolved)
- [[Reference/code-signing]] — EVCA cert options
- [[Reference/electron]] — electron-builder / electron-updater background
