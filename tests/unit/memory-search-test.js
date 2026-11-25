const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { MemoryStore } = require('../../src/main/services/memory-store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-mem-'));
const store = new MemoryStore({ filePath: path.join(dir, 'vault.bin'), safeStorage: null });
const add = (c, t) => assert.ok(store.add(c, t, { source: 'manual' }).success);
add('personal', 'I study computer science at Anna University');
add('personal', 'My father works as a bank manager in Madurai');
add('preferences', 'I like filter coffee in the morning');
add('projects', 'Building a desktop voice assistant called NEXORA');
add('knowledge', 'Rust sidecar handles system diagnostics');

const top = (q) => store.search(q).items[0]?.text || '';
assert.ok(/Anna University/.test(top('where do I go to college')), 'synonym: college -> university');
assert.ok(/coffee/.test(top('what drink do I like')), 'synonym: drink -> coffee');
assert.ok(/father/.test(top('what does my dad do for work')), 'synonym: dad -> father');
assert.ok(/coffee/.test(top('filtr cofee')), 'typo tolerance');
assert.deepStrictEqual(store.search('zzzz qqqq').items, [], 'no match -> nothing');
assert.ok(store.buildContext('college').includes('Anna University'));

// export / import round trip, duplicates skipped, junk rejected
const exp = store.exportData();
assert.ok(exp.success && exp.data.format === 'nexora-memory' && exp.data.items.length === 5);
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-mem2-'));
const other = new MemoryStore({ filePath: path.join(dir2, 'vault.bin'), safeStorage: null });
let r = other.importItems(exp.data);
assert.deepStrictEqual([r.success, r.added, r.skipped, r.invalid], [true, 5, 0, 0]);
r = other.importItems(exp.data);
assert.deepStrictEqual([r.added, r.skipped], [0, 5], 'second import adds nothing');
r = other.importItems({ items: [{ category: 'bogus', text: 'x' }, { category: 'personal', text: '' }, null] });
assert.strictEqual(r.invalid, 3);
assert.strictEqual(other.importItems({ nope: 1 }).success, false);
assert.strictEqual(other.list().items.length, 5);
console.log('  memory search + import/export ok');
