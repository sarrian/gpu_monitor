/**
 * daily-log — PostToolUse hook companion
 * Reads accumulated file changes, writes a formatted entry to Daily/YYYY-MM-DD.md.
 * Called after every tool use; idempotent thanks to per-session dedup file.
 */
const fs = require('fs');
const path = require('path');

const CWD = process.cwd();
const DAILY_DIR = path.resolve(CWD, '..', 'Daily');
const SESSION_KEY = '_dl_' + (process.env.npm_config_user_agent || '').replace(/[^a-z0-9]/gi, '_').substring(0, 24);
const TRACKER = path.join(DAILY_DIR, '.daily-log-tracking.json');

function loadTracker() {
  try { return JSON.parse(fs.readFileSync(TRACKER, 'utf8')) || {}; } catch { return {}; }
}

function saveTracker(data) { fs.writeFileSync(TRACKER, JSON.stringify(data), 'utf8'); }

function getTodayStr() { return new Date().toISOString().slice(0, 10); }

function main() {
  const today = getTodayStr();
  const dailyPath = path.join(DAILY_DIR, today + '.md');
  const tracker = loadTracker();
  let prevSession = tracker[today] || {};
  let prevFiles = new Set(prevSession.files || []);

  // Capture current git status (untracked + modified). Only process new files.
  try {
    const { execSync } = require('child_process');
    const raw = execSync('git status --porcelain', { cwd: CWD }).toString();
    const entries = raw.trim().split('\n').filter(Boolean).map(line => line.slice(3));
    // Track all files that appear now to prevent re-reporting them
    let newlyAdded = false;

    entries.forEach(f => {
      if (prevFiles.has(f)) return;
      if (!newlyAdded) {
        // Start a new section for this batch of changes
        fs.appendFileSync(dailyPath, `\n### ${new Date().toLocaleTimeString('en-US', { hour12: false })} — Tool Activity\n`);
        newlyAdded = true;
      }
      fs.appendFileSync(dailyPath, `- **${f.includes('\\') ? f.split('\\').pop() : f}**\n`);
      prevFiles.add(f);
    });

    if (!entries.length && !newlyAdded) {
      // Nothing changed — nothing to log. Write session marker anyway so we know we ran.
      tracker[today] = { files: Array.from(prevFiles), lastRun: Date.now() };
      saveTracker(tracker);
      process.exit(0);
    }
  } catch {
    // Not a git repo or git error — fall through to marker-only tracking
    prevFiles.add('_nofile');
  }

  // Always update tracker (write at end so re-runs don't duplicate)
  tracker[today] = { files: Array.from(prevFiles), lastRun: Date.now() };
  saveTracker(tracker);
}

main();
