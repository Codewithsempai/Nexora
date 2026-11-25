const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Logger, redact } = require('../../src/main/services/logger');
const { buildReport, redactConfig } = require('../../src/main/services/diagnostics');

const fakeKey = 'AIza' + 'A'.repeat(35);
assert.ok(!redact(`wss://x/ws?key=${fakeKey}&alt=1`).includes(fakeKey));
assert.ok(!redact(`x-goog-api-key: ${fakeKey}`).includes(fakeKey));
assert.ok(!redact('Authorization: Bearer abcdef123456789').includes('abcdef123456789'));
assert.ok(!redact(`apiKey="${fakeKey}"`).includes(fakeKey));
assert.ok(redact('plain message stays').includes('plain message stays'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-log-'));
const log = new Logger({ dir, maxBytes: 600, maxFiles: 3 });
for (let i = 0; i < 40; i++) log.write('info', `line ${i} ${fakeKey}`);
const files = fs.readdirSync(dir).sort();
assert.deepStrictEqual(files, ['nexora.log', 'nexora.log.1', 'nexora.log.2'], 'rotates and keeps maxFiles');
assert.ok(files.every((f) => fs.statSync(path.join(dir, f)).size <= 700));
const recent = log.readRecent();
assert.ok(recent.includes('line 39') && !recent.includes(fakeKey));

const target = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
log.installConsole(target); target.warn('hello', { a: 1 });
assert.ok(log.readRecent().includes('hello { a: 1 }'));
const blocker = path.join(dir, 'a-file'); fs.writeFileSync(blocker, 'x');
assert.doesNotThrow(() => assert.strictEqual(new Logger({ dir: path.join(blocker, 'sub') }).write('info', 'x'), false), 'unwritable log folder never throws');

const cfg = redactConfig({ ai: { apiKey: fakeKey, chatModel: 'm' }, nested: { token: 'abc' }, keep: 1 });
assert.strictEqual(cfg.ai.apiKey, '***REDACTED***'); assert.strictEqual(cfg.nested.token, '***REDACTED***'); assert.strictEqual(cfg.ai.chatModel, 'm');
const report = buildReport({ appInfo: { version: '9.9.9' }, config: { secretKey: fakeKey }, logs: `boom ${fakeKey} in ${os.homedir()}/x`, homeDir: os.homedir() });
assert.ok(report.includes('9.9.9') && !report.includes(fakeKey));
console.log('  logger + diagnostics ok');
