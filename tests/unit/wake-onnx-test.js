'use strict';
// v0.3.25 offline ONNX wake word: engine, exact incremental embedding, detection logic and the worker service.
const assert = require('assert'); const path = require('path');
const { OnnxModel, tensor } = require('../../src/main/services/onnx-lite');
const { OnnxWakeEngine, IncrementalEmbedding, loadModelFiles, prettyName } = require('../../src/main/services/wakeword-onnx');
const { WakeWordService, DEFAULT_DIR } = require('../../src/main/services/wakeword-service');

(async () => {
  const models = loadModelFiles(DEFAULT_DIR);
  assert.deepStrictEqual(models.heads.map((h) => h.word).sort(), ['Hey Nexo', 'Hey Nexora', 'Nexo', 'Nexora'], 'all four wake phrases are loaded from assets/wakeword');
  assert.strictEqual(prettyName('hey_nexora.onnx'), 'Hey Nexora');

  // 1. streaming the embedding network gives the SAME numbers as running it on the whole 76-row window
  const full = new OnnxModel(models.embedding); const inc = new IncrementalEmbedding(full);
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rows = Array.from({ length: 68 + 8 * 6 }, () => Float64Array.from({ length: 32 }, () => rnd() * 4 - 1));
  const flat = (from, to) => { const o = new Float64Array((to - from) * 32); for (let r = from; r < to; r++) o.set(rows[r], (r - from) * 32); return o; };
  assert.strictEqual(inc.push(flat(0, 68), 68), null, 'window still filling');
  for (let k = 0; k < 6; k++) {
    const end = 68 + 8 * (k + 1); const e = inc.push(flat(end - 8, end), 8);
    const ref = full.run({ input_1: tensor([1, 76, 32, 1], Float32Array.from(flat(end - 76, end))) }).conv2d_19.data;
    let md = 0; for (let i = 0; i < 96; i++) md = Math.max(md, Math.abs(e[i] - ref[i]));
    assert(md < 1e-3, `incremental embedding differs from the full network (max diff ${md})`);
  }

  // 2. silence and noise never wake; scores stay within 0..1
  const engine = new OnnxWakeEngine(models, {});
  const sec = (n, f) => { const b = Buffer.alloc(32000 * n); for (let i = 0; i < 16000 * n; i++) b.writeInt16LE(f(i), i * 2); return b; };
  let hits = engine.feed(sec(3, () => 0)); hits = hits.concat(engine.feed(sec(4, () => Math.round((rnd() - 0.5) * 6000))));
  assert.strictEqual(hits.length, 0, 'silence/noise must not trigger a wake');
  for (const v of Object.values(engine.scores())) assert(v >= 0 && v <= 1, 'scores are probabilities');

  // 3. decision logic: needs `patience` consecutive frames over the threshold, then a cooldown
  const eng2 = new OnnxWakeEngine(models, { threshold: 0.6, patience: 2, cooldownMs: 100000, warmupSteps: 2 });
  const target = eng2.heads.find((h) => h.name === 'hey_nexora'); const realRun = target.model.run.bind(target.model); let force = 0;
  target.model.run = (feeds) => (force ? { sigmoid: { dims: [1, 1], data: Float64Array.of(force) } } : realRun(feeds));
  const loud = () => sec(1, (i) => Math.round(Math.sin(i / 7) * 8000));
  eng2.feed(loud()); force = 0.9; const got = eng2.feed(loud()); assert.strictEqual(got.length, 1, 'fires once'); assert.strictEqual(got[0].word, 'Hey Nexora');
  assert.strictEqual(eng2.feed(loud()).length, 0, 'cooldown suppresses an immediate second wake');
  const eng3 = new OnnxWakeEngine(models, { threshold: 0.6, patience: 2, cooldownMs: 0, warmupSteps: 2 }); const t3 = eng3.heads[0]; t3.model.run = () => ({ s: { dims: [1, 1], data: Float64Array.of(0.59) } });
  assert.strictEqual(eng3.feed(loud()).length, 0, 'a score just under the threshold does not fire'); eng3.setThreshold(0.5); assert.strictEqual(eng3.threshold, 0.5);

  // 4. service: worker starts, accepts audio, stays quiet, stops cleanly
  let woke = 0; const svc = new WakeWordService({ onWake: () => { woke++; }, onError: (m) => { throw new Error(m); } });
  const words = await svc.start(); assert.strictEqual(words.length, 4);
  svc.feed(sec(1, () => 0)); svc.reset(); svc.setThreshold(0.7); await new Promise((r) => setTimeout(r, 400)); assert.strictEqual(woke, 0); svc.stop();
  const bad = new WakeWordService({ dir: path.join(DEFAULT_DIR, 'missing') }); await assert.rejects(bad.start(), /missing|No wake-word|ENOENT/i); bad.stop();
  console.log('  v0.3.25 offline ONNX wake word: exact streaming, detection logic, worker service ok');
})().catch((e) => { console.error(e); process.exit(1); });
