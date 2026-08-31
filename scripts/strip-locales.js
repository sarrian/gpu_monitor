/**
 * Strip non-English locale packs from the unpacked Electron app.
 * Reduces the installer by ~35 MB for English-only deployments.
 * Run after `npm run build:exe`: node scripts/strip-locales.js
 */
const fs = require('fs');
const path = require('path');

const unpackedDir = path.join(__dirname, '..', 'dist', 'win-unpacked');
const localesDir = path.join(unpackedDir, 'locales');

if (!fs.existsSync(localesDir)) {
  console.log('[strip-locales] locales/ not found — nothing to do.');
  process.exit(0);
}

const files = fs.readdirSync(localesDir);
let kept = 0, removed = 0;

for (const file of files) {
  if (file === 'en-US.pak') {
    kept++;
  } else {
    const fullPath = path.join(localesDir, file);
    fs.unlinkSync(fullPath);
    removed++;
    console.log(`[strip-locales] Removed: ${file}`);
  }
}

console.log(`[strip-locales] Kept ${kept}, removed ${removed} locale packs.`);
