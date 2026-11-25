/* v0.3.14 autonomy tests: retry/skip on failed steps, hourly caps, hostile app names, "screen text can never start a task". */
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { ActionLog } = require('../../src/main/autonomy/action-log');
const { ActionExecutor } = require('../../src/main/autonomy/actions');
const { Policy, ApprovalGate } = require('../../src/main/autonomy/policy');
const { Agent } = require('../../src/main/autonomy/agent');
const { AUTONOMY_DEFAULTS } = require('../../src/main/autonomy/defaults');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-v014-'));
const folders = { home, downloads: path.join(home, 'Downloads'), documents: path.join(home, 'Documents'), desktop: path.join(home, 'Desktop'), pictures: path.join(home, 'Pictures') };
for (const f of Object.values(folders)) fs.mkdirSync(f, { recursive: true });
class FakeConfig { constructor(over = {}) { this.data = { autonomy: JSON.parse(JSON.stringify(AUTONOMY_DEFAULTS)) }; for (const [k, v] of Object.entries(over)) this.set(k, v); }
  get(p) { const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  set(p, v) { const k = p.split('.'); let o = this.data; for (const x of k.slice(0, -1)) { if (typeof o[x] !== 'object' || o[x] === null) o[x] = {}; o = o[x]; } o[k.at(-1)] = v; return true; } }
class FakeCards { constructor(answer) { this.answer = answer; this.shown = []; this.seq = 0; }
  show(def) { const id = `f${++this.seq}`; this.shown.push({ id, ...def }); return { id, promise: Promise.resolve('x') }; }
  ask(def) { this.shown.push(def); return Promise.resolve(this.answer(def)); } notify(def) { this.shown.push({ ...def, notify: true }); return { id: 'n' }; }
  update() { return true; } close() {} closeKind() {} destroy() {} }
const log = new ActionLog({ filePath: path.join(home, 'log.json') });

(async () => {
  // ---- hostile app names never reach cmd.exe ----
  { const calls = []; const ex = new ActionExecutor({ shell: { openPath: async () => '', openExternal: async () => {} }, clipboard: { readText: () => '', writeText() {} }, execFile: (c, a, o, cb) => { calls.push([c, ...a]); cb(null); }, folders, platform: 'win32' });
    for (const bad of ['calc & del /q *', 'a|b', 'x > y', 'a^b', '%COMSPEC%', 'a"b', 'a`b', 'line\nbreak', 'C:\\Windows\\System32\\cmd.exe', 'a/b', 'a;b']) assert(!ex.validate('open_app', { name: bad }).ok, `open_app must reject ${JSON.stringify(bad)}`);
    assert(ex.validate('open_app', { name: 'Discord' }).ok); assert(ex.validate('open_app', { name: 'the WhatsApp app' }).args.name === 'WhatsApp');
    const r = await ex.cmd(['/c', 'start', '', 'calc & del x'], 'ok'); assert(!r.ok && /unsafe/i.test(r.summary)); assert.strictEqual(calls.length, 0, 'cmd.exe was never started for unsafe text');
    for (const bad of ['..', 'a:b', 'a*b', 'a?b', 'a<b', 'a|b', '.']) assert(!ex.validate('open_folder', { name: bad }).ok, `open_folder name ${bad}`); }

  // ---- hourly caps ----
  { let t = 1_000_000; const policy = new Policy(new FakeConfig({ 'autonomy.caps.clipboard_read': 2 }), { now: () => t });
    const cards = new FakeCards(() => 'allow'); const gate = new ApprovalGate({ policy, cards, log, describe: (a) => a });
    assert((await gate.request('clipboard_read', {})).allowed); assert((await gate.request('clipboard_read', {})).allowed);
    const third = await gate.request('clipboard_read', {}); assert(!third.allowed && third.via === 'capped', 'third use in an hour is capped');
    t += 3600 * 1000 + 1; assert((await gate.request('clipboard_read', {})).allowed, 'cap resets after an hour');
    const p0 = new Policy(new FakeConfig({ 'autonomy.caps.open_app': 0 })); for (let i = 0; i < 100; i++) assert(p0.consume('open_app').ok, '0 = no cap');
    const deny = new Policy(new FakeConfig({ 'autonomy.permissions.open_app': 'deny' })); const g2 = new ApprovalGate({ policy: deny, cards, log, describe: (a) => a });
    assert((await g2.request('open_app', { name: 'x' })).via === 'denied', 'deny still wins and does not use up the cap'); assert.strictEqual(deny.uses.get('open_app')?.length || 0, 0); }

  // ---- retry / skip on a failed step ----
  const mkAgent = (runs, choice, limits = {}) => {
    let n = 0; const executor = { warm: async () => {}, describe: (a) => `do ${a}`, run: async (a) => runs[Math.min(n++, runs.length - 1)] };
    const cards = new FakeCards((def) => (def.label === 'STEP FAILED' ? choice(def) : 'run'));
    const gate = { request: async () => ({ allowed: true, via: 'always' }) };
    const agent = new Agent({ executor, gate, cards, log, getApiKey: () => null, getLimits: () => limits });
    agent.makePlan = async () => ({ steps: [{ action: 'open_app', args: {} }, { action: 'open_url', args: {} }] });
    return { agent, cards, count: () => n }; };
  { const { agent, cards, count } = mkAgent([{ ok: false, summary: 'boom' }, { ok: true, summary: 'worked' }, { ok: true, summary: 'two' }], () => 'retry');
    const r = await agent.run('x'); assert(r.success, 'retry then success'); assert.strictEqual(count(), 3); assert(cards.shown.some((c) => c.label === 'STEP FAILED')); }
  { const { agent } = mkAgent([{ ok: false, summary: 'boom' }, { ok: true, summary: 'two' }], () => 'skip');
    const r = await agent.run('x'); assert(r.success && /1 skipped/.test(r.summary), r.summary); assert(r.steps[0].skipped); }
  { const { agent } = mkAgent([{ ok: false, summary: 'boom' }, { ok: true, summary: 'two' }], () => 'stop');
    const r = await agent.run('x'); assert(!r.success && /Step 1 failed/.test(r.summary)); }
  { const { agent } = mkAgent([{ ok: false, summary: 'boom' }], () => 'retry');
    const r = await agent.run('x'); assert(!r.success, 'gives up after the retry limit'); }
  { const { agent, cards } = mkAgent([{ ok: false, summary: 'boom' }], () => 'retry', { retryOnFail: false });
    const r = await agent.run('x'); assert(!r.success && !cards.shown.some((c) => c.label === 'STEP FAILED'), 'retryOnFail:false keeps the old behaviour'); }
  { const { agent } = mkAgent([{ ok: false, summary: 'boom' }], () => 'timeout');
    assert(!(await agent.run('x')).success, 'no answer = task ends, nothing retried silently'); }

  // ---- screen / clipboard / watcher text can never start a task ----
  for (const f of ['screen-help.js', 'watchers.js', 'proactive.js', 'memory-upkeep.js', 'screen-target.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/autonomy', f), 'utf8');
    assert(!/runTask|agent\.run|new Agent|planWithGemini|localPlan/.test(src), `${f} must not be able to start or plan tasks (prompt-injection guard)`); }
  console.log('  v0.3.14 retry/skip, hourly caps, hostile app names, injection guard ok');
})().catch((e) => { console.error(e); process.exit(1); });
