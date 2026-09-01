// release-publish.js — create the GitHub release for the current version and attach the Windows installer.
// No extra dependencies: uses Node's built-in fetch + fs. Reads the PAT from the git remote (or $GH_TOKEN).
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const REPO = 'sarrian/gpu_monitor';
const DIR = __dirname;
const VERSION = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8')).version;
const TAG = 'v' + VERSION;
const ASSET_NAME = `GPU-Monitor-Setup-${VERSION}-win.exe`;
const ASSET_PATH = path.join(DIR, 'dist', ASSET_NAME);

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const url = execFileSync('git', ['-C', DIR, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/https:\/\/([^@]+)@/);
    if (m) return m[1];
  } catch (e) { /* fall through */ }
  throw new Error('No GitHub token found (set GH_TOKEN, or put a token in the git remote URL).');
}
const TOKEN = getToken();

const BODY = [
  `## GPU Monitor v${VERSION}`,
  '',
  'Lightweight, always-on-top NVIDIA GPU monitoring overlay for Windows.',
  '',
  "### What's new since v1.0.1",
  "- **Sparklines** — compact per-metric sparkline graphs; click a metric's icon to pick which one to graph on each GPU card.",
  '- **Per-metric Show / Hide** — show or hide any metric (Temp, Power, GPU Load, Mem Load, VRAM, GPU Clock, Mem Clock, Fan) from Settings.',
  '- **Dark dropdowns** — the Settings popups now render in the dark theme instead of white.',
  '- **Compact layout** — the card collapses cleanly when sparklines are off (no leftover empty space).',
  '- **Minimize glyph** — the top-bar close-style ✕ is now a minimize line (—); ⏻ still quits.',
  '',
  '### Install',
  `- Windows 10/11 x64, NVIDIA GPU. Run \`${ASSET_NAME}\` (per-machine install, desktop + start-menu shortcuts).`,
].join('\n');

const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' };

async function main() {
  // 1) Create the release (reuse an existing one for the same tag if it already exists).
  let rel;
  const create = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: TAG, name: TAG, body: BODY, draft: false, prerelease: false }),
  });
  if (create.ok) {
    rel = await create.json();
    console.log('✓ created release:', rel.html_url);
  } else {
    const err = (await create.text()).slice(0, 300);
    console.log(`create → ${create.status}: ${err}`);
    const get = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: H });
    if (!get.ok) throw new Error(`Cannot create or fetch release (create=${create.status}, get=${get.status}).`);
    rel = await get.json();
    console.log('✓ using existing release:', rel.html_url);
  }

  // 2) Upload the installer via curl (multipart, file under the required "name" field). curl frames it correctly.
  const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(ASSET_NAME)}`;
  console.log(`↑ uploading ${ASSET_NAME} (${(fs.statSync(ASSET_PATH).size / 1048576).toFixed(1)} MB) …`);
  const args = [
    '-sS', '-X', 'POST', uploadUrl,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Accept: application/vnd.github+json',
    '-F', `name=@${ASSET_PATH};type=application/octet-stream`,
    '-w', '\n__HTTP_STATUS__:%{http_code}',
  ];
  let out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8' });
  } catch (e) {
    out = ((e.stdout || '') + '\n' + (e.stderr || '')).toString();
  }
  const m = out.match(/__HTTP_STATUS__:(\d+)/);
  const status = m ? parseInt(m[1], 10) : 0;
  const jsonPart = (out.split('__HTTP_STATUS__:')[0] || '').trim();
  let uj = {};
  try { uj = JSON.parse(jsonPart); } catch { /* not json */ }
  if (status < 200 || status >= 300) throw new Error(`Upload ${status}: ${jsonPart.slice(0, 300)}`);
  console.log('✓ asset attached:', uj.browser_download_url);
  console.log('\nRelease page:', rel.html_url);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
