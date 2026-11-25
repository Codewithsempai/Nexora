const assert = require('assert');
const { sync } = require('../../tools/sync-version');
const { drift, version } = sync({ check: true });
assert.deepStrictEqual(drift, [], `Version drift (package.json ${version}). Run: npm run version:sync`);
const pkg = require('../../package.json');
assert.strictEqual(require('../../src/main/services/config').DEFAULT_CONFIG?.version ?? pkg.version, pkg.version);
console.log(`  versions in sync (${version})`);
