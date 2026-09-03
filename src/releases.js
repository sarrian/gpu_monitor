// GitHub release listing + asset download for the in-app version picker.
// Pure Node (no Electron imports) so it stays require-able without circular deps.
const https = require('https');
const fs    = require('fs');

const REPO_RELEASES_URL = 'https://api.github.com/repos/sarrian/gpu_monitor/releases';
const USER_AGENT = 'GPU-Monitor-Update/1.1';
const MAX_HOPS = 5; // asset URLs 302 to objects.githubusercontent.com

// First build whose in-app updater actually works. Installing anything older than
// this strands the user: that older build's updater can't pull them back up to
// 1.2.2+, so a downgrade is a trap. Newer versions (1.3.0, …) remain installable.
const MIN_INSTALLABLE = '1.2.2';

/**
 * True if version `a` is >= version `b`, comparing dotted numeric parts.
 * Tolerates a leading "v" and non-numeric trailing segments (e.g. "1.2.2-beta").
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function verAtLeast(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true; // equal
}

/**
 * GET a URL over https, following redirects manually (≤5 hops).
 * @param {string} url
 * @param {number} [hops]
 * @returns {Promise<Buffer>}
 */
function apiGet(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > MAX_HOPS) { reject(new Error('Too many redirects')); return; }
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        apiGet(new URL(res.headers.location, url).toString(), hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout after 30s')));
  });
}

/**
 * List published GitHub releases, newest first, each with its .exe installer asset.
 * @returns {Promise<{tag: string, name: string, publishedAt: string, exeAsset: {name: string, size: number, url: string}|null}[]>}
 */
async function listReleases() {
  const body = await apiGet(REPO_RELEASES_URL + '?per_page=30');
  const releases = JSON.parse(body.toString('utf8'));
  if (!Array.isArray(releases)) return [];
  return releases
    .filter((r) => !r.draft && Array.isArray(r.assets) && r.assets.length)
    // Never offer builds older than the first one with a working updater.
    .filter((r) => verAtLeast(r.tag_name, MIN_INSTALLABLE))
    .map((r) => {
      const exe = r.assets.find((a) => /\.exe$/i.test(a.name));
      return {
        tag: r.tag_name,
        name: r.name,
        publishedAt: r.published_at,
        exeAsset: exe ? { name: exe.name, size: exe.size, url: exe.browser_download_url } : null,
      };
    });
}

/**
 * Download a file to `dest`, following redirects, streaming (no full in-memory buffer).
 * @param {string} url
 * @param {string} dest
 * @param {(pct: number) => void} [onProgress]
 * @param {number} [hops]
 * @returns {Promise<void>}
 */
function downloadAsset(url, dest, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > MAX_HOPS) { reject(new Error('Too many redirects')); return; }
    const file = fs.createWriteStream(dest);
    const fail = (err) => {
      file.close(() => {});
      fs.unlink(dest, () => {}); // don't leave a partial installer behind
      reject(err);
    };
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        file.close(() => {});
        fs.unlink(dest, () => {});
        downloadAsset(new URL(res.headers.location, url).toString(), dest, onProgress, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let received = 0;
      res.on('data', (c) => {
        received += c.length;
        if (onProgress && total) onProgress(Math.min(100, Math.round((received / total) * 100)));
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', fail);
      res.on('error', fail);
    });
    req.on('error', (e) => fail(e));
    req.setTimeout(60000, () => req.destroy(new Error('timeout after 60s')));
  });
}

module.exports = { listReleases, downloadAsset, MIN_INSTALLABLE, verAtLeast };
