// release-publish.js — create the GitHub release and attach its assets.
// No extra deps: Node's built-in fetch for the API + curl for uploads.
//
// Uploads use GitHub's RAW octet-stream method (--data-binary + Content-Type: application/octet-stream),
// which stores the exact file bytes. A multipart `-F name=@file` upload against the `?name=` URL instead
// stores the whole multipart envelope *inside* the asset (corrupting it) — so we do NOT use `-F` here.
//
// Full electron-updater asset set is uploaded:
//   • GPU-Monitor-Setup-<v>-win.exe          — the NSIS installer
//   • latest.yml                             — the update manifest electron-updater reads (must be valid YAML)
//   • GPU-Monitor-Setup-<v>-win.exe.blockmap — blockmap for differential downloads
// Existing assets are deleted first, so a re-run always replaces any corrupt/stale uploads.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'sarrian/gpu_monitor';
const DIR = __dirname;
const DIST = path.join(DIR, 'dist');
const VERSION = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8')).version;
const TAG = 'v' + VERSION;
const INSTALLER = `GPU-Monitor-Setup-${VERSION}-win.exe`;

const ASSETS = [
  { name: INSTALLER, file: path.join(DIST, INSTALLER) },
  { name: 'latest.yml', file: path.join(DIST, 'latest.yml') },
  { name: INSTALLER + '.blockmap', file: path.join(DIST, INSTALLER + '.blockmap') },
].filter((a) => fs.existsSync(a.file));

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
  `- Windows 10/11 x64, NVIDIA GPU. Run \`${INSTALLER}\` (per-machine install, desktop + start-menu shortcuts).`,
].join('\n');

const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' };

/** Delete all existing assets on the release (clean slate so re-runs fully replace any corrupt uploads). */
async function clearAssets(rel) {
  for (const a of (rel.assets || [])) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: H });
    console.log(`  deleted ${a.name} → ${res.status}`);
  }
}

/** Upload one asset with the RAW octet-stream method so GitHub stores the exact file bytes. */
function curlUpload(rel, asset) {
  const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(asset.name)}`;
  const args = [
    '-sS', '-X', 'POST', uploadUrl,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', '@' + asset.file,
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
  if (status < 200 || status >= 300) throw new Error(`Upload ${asset.name} → HTTP ${status}: ${jsonPart.slice(0, 300)}`);
}

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

  // 2) Clear any existing (possibly corrupt) assets, then upload the full set fresh.
  await clearAssets(rel);
  for (const asset of ASSETS) {
    const mb = (fs.statSync(asset.file).size / 1048576).toFixed(1);
    console.log(`↑ uploading ${asset.name} (${mb} MB) …`);
    curlUpload(rel, asset);
    console.log('✓ attached:', asset.name, `(${fs.statSync(asset.file).size} bytes)`);
  }
  console.log('\nRelease page:', rel.html_url);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
