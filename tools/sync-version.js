#!/usr/bin/env node
/* One version number for the whole repo: package.json is the source of truth.
 *   node tools/sync-version.js          -> rewrite README badge, Cargo.toml files and Cargo.lock entries
 *   node tools/sync-version.js --check  -> exit 1 if anything is out of step (used by npm test and CI) */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const TARGETS = [
  { file: 'README.md', pattern: /(Version-)[0-9][0-9A-Za-z.\-]*(-78ffe2)/, replace: (v) => `$1${v}$2` },
  { file: 'Cargo.toml', pattern: /(\[package\][^\[]*?\nversion\s*=\s*")[^"]+(")/, replace: (v) => `$1${v}$2` },
  { file: 'native/rust/Cargo.toml', pattern: /(\[package\][^\[]*?\nversion\s*=\s*")[^"]+(")/, replace: (v) => `$1${v}$2` },
  { file: 'Cargo.lock', pattern: /(\[\[package\]\]\nname = "nexora"\nversion = ")[^"]+(")/, replace: (v) => `$1${v}$2` },
  { file: 'native/rust/Cargo.lock', pattern: /(\[\[package\]\]\nname = "nexora-core"\nversion = ")[^"]+(")/, replace: (v) => `$1${v}$2` },
];

function sync({ check = false, base = root } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).version;
  const drift = [];
  for (const t of TARGETS) {
    const file = path.join(base, t.file);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!t.pattern.test(text)) { drift.push(`${t.file}: version line not found`); continue; }
    const next = text.replace(t.pattern, t.replace(version));
    if (next !== text) { drift.push(`${t.file}: out of step with package.json ${version}`); if (!check) fs.writeFileSync(file, next); }
  }
  return { version, drift };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { version, drift } = sync({ check });
  if (check && drift.length) { console.error(`Version drift (package.json is ${version}):\n  ${drift.join('\n  ')}\nRun: npm run version:sync`); process.exit(1); }
  console.log(check ? `Versions OK (${version})` : `Synced to ${version}${drift.length ? `: ${drift.join('; ')}` : ' (nothing to change)'}`);
}
module.exports = { sync, TARGETS };
