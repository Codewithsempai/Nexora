/* ==========================================================================
   NEXORA — offline ONNX wake word (v0.3.25)
   Replaces the old "send the clip to Gemini and read the transcript" wake check. Everything runs locally:

     16 kHz mic PCM ──► melspectrogram.onnx ──► embedding_model.onnx ──► one classifier head per wake phrase
                         (every 80 ms)          (96-d speech embedding)     hey_nexora / hey_nexo / nexora / nexo

   This is the openWakeWord streaming recipe. The classifier heads in assets/wakeword/ take the last 16 embeddings
   ([1,16,96], about 1.3 s) and return a 0-1 score. The ops are executed by ./onnx-lite.js (no native module, no WASM).

   Speed: every layer of the embedding network is a plain convolution/pool in time, so consecutive 760 ms windows
   (which overlap by 68 of 76 frames) share almost all their work. IncrementalEmbedding computes only the 8 new
   frames per step and gives exactly the same numbers as running the full network on the whole window.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { OnnxModel, OPS, tensor } = require('./onnx-lite');

const SAMPLE_RATE = 16000;
const STEP = 1280;                 // 80 ms of audio per step
const MEL_CONTEXT = 160 * 3;       // extra samples so the STFT frames at the chunk edges are complete
const MEL_ROWS_PER_STEP = 8;
const EMBED_WINDOW = 76;           // mel rows per embedding
const HEAD_FRAMES = 16;            // embeddings per classifier call
const EMBED_DIM = 96;
const FRONT_END = new Set(['melspectrogram.onnx', 'embedding_model.onnx']);

/* ---- row helpers for [1, C, rows, W] tensors ---- */
function sliceRows(t, from) {
  const [N, C, R, W] = t.dims; const nr = R - from; const out = new Float64Array(C * nr * W);
  for (let c = 0; c < C; c++) for (let r = 0; r < nr; r++) { const src = (c * R + from + r) * W; out.set(t.data.subarray ? t.data.subarray(src, src + W) : t.data.slice(src, src + W), (c * nr + r) * W); }
  return tensor([N, C, nr, W], out);
}
function concatRows(a, b) {
  if (!a) return b;
  const [N, C, Ra, W] = a.dims; const Rb = b.dims[2]; const R = Ra + Rb; const out = new Float64Array(C * R * W);
  for (let c = 0; c < C; c++) { out.set(a.data.subarray(c * Ra * W, (c + 1) * Ra * W), c * R * W); out.set(b.data.subarray(c * Rb * W, (c + 1) * Rb * W), (c * R + Ra) * W); }
  return tensor([N, C, R, W], out);
}

/** Runs the speech-embedding CNN one chunk of mel rows at a time, keeping just enough rows per layer as context. */
class IncrementalEmbedding {
  constructor(model) {
    this.layers = [];
    let prev = null;
    for (const node of model.nodes) {
      if (node.op === 'Reshape') { prev = node.outputs[0]; continue; }     // input/output reshapes are handled here
      if (prev && node.inputs[0] !== prev) throw new Error('embedding model is not a simple chain; cannot stream it');
      const consts = node.inputs.slice(1).map((n) => (n ? model.inits.get(n) : undefined));
      if (!['Conv', 'LeakyRelu', 'Max', 'MaxPool'].includes(node.op)) throw new Error('embedding model has an unexpected op: ' + node.op);
      if (node.op === 'Conv') {
        const pads = node.attrs.pads ? node.attrs.pads.ints : [0, 0, 0, 0]; const st = node.attrs.strides ? node.attrs.strides.ints : [1, 1];
        if (pads[0] || pads[2] || st[0] !== 1) throw new Error('embedding conv must not pad or stride in time (needed for exact streaming)');
      }
      this.layers.push({ node, consts, tail: null });
      prev = node.outputs[0];
    }
    this.reset();
  }
  reset() { for (const l of this.layers) l.tail = null; }
  /** @param {Float64Array} rows mel rows (count x 32), row-major. Returns a 96-d embedding, or null while the window is still filling. */
  push(rows, count) {
    // [1, 1, rows, 32]
    let x = tensor([1, 1, count, 32], rows);
    for (const l of this.layers) {
      if (!x) return null;
      const { node, consts } = l;
      if (node.op === 'Conv') {
        const kh = consts[0].dims[2]; const buf = concatRows(l.tail, x);
        if (buf.dims[2] < kh) { l.tail = buf; x = null; continue; }
        x = OPS.Conv(node, [buf, ...consts]); l.tail = kh > 1 ? sliceRows(buf, buf.dims[2] - (kh - 1)) : null;
      } else if (node.op === 'MaxPool') {
        const k = node.attrs.kernel_shape.ints; const s = node.attrs.strides ? node.attrs.strides.ints : [1, 1]; const buf = concatRows(l.tail, x);
        if (buf.dims[2] < k[0]) { l.tail = buf; x = null; continue; }
        const out = OPS.MaxPool(node, [buf]); const consumed = out.dims[2] * s[0];
        l.tail = consumed < buf.dims[2] ? sliceRows(buf, consumed) : null; x = out;
      } else x = OPS[node.op](node, [x, ...consts]);
    }
    if (!x) return null;
    return Float64Array.from(x.data.subarray(0, EMBED_DIM));
  }
}

class OnnxWakeEngine {
  /**
   * @param {{mel: Buffer, embedding: Buffer, heads: {name: string, word: string, bytes: Buffer}[]}} models
   * @param {{threshold?: number, patience?: number, cooldownMs?: number, warmupSteps?: number}} opts
   */
  constructor(models, opts = {}) {
    this.mel = new OnnxModel(models.mel);
    this.fullEmbedding = new OnnxModel(models.embedding);
    this.embedding = new IncrementalEmbedding(this.fullEmbedding);
    this.heads = models.heads.map((h) => ({ name: h.name, word: h.word, model: new OnnxModel(h.bytes), streak: 0, score: 0 }));
    this.threshold = opts.threshold ?? 0.6;
    this.patience = opts.patience ?? 2;
    this.cooldownMs = opts.cooldownMs ?? 2500;
    this.warmupSteps = opts.warmupSteps ?? 20;
    this.reset();
  }

  setThreshold(v) { if (Number.isFinite(v)) this.threshold = Math.min(0.99, Math.max(0.05, v)); }

  reset() {
    this.pending = new Float32Array(0);       // samples not yet part of a full 80 ms step
    this.raw = new Float32Array(0);           // recent audio, int16-range values (what openWakeWord feeds the mel model)
    this.features = Array.from({ length: HEAD_FRAMES }, () => new Float64Array(EMBED_DIM));
    this.steps = 0; this.lastFireAt = 0; this.levelEma = 0;
    this.embedding.reset();
    this.embedding.push(new Float64Array(68 * 32).fill(1), 68);     // openWakeWord starts its mel buffer as ones(76, 32)
    for (const h of this.heads) { h.streak = 0; h.score = 0; }
  }

  /** @param {Buffer|Int16Array} pcm16 mono 16 kHz little-endian int16. Returns the detections found in this call. */
  feed(pcm16) {
    const samples = Buffer.isBuffer(pcm16) ? new Int16Array(pcm16.buffer, pcm16.byteOffset, Math.floor(pcm16.length / 2)) : pcm16;
    const merged = new Float32Array(this.pending.length + samples.length); merged.set(this.pending); for (let i = 0; i < samples.length; i++) merged[this.pending.length + i] = samples[i];
    let pos = 0; const hits = [];
    while (merged.length - pos >= STEP) { const hit = this.step(merged.subarray(pos, pos + STEP)); if (hit) hits.push(hit); pos += STEP; }
    this.pending = merged.slice(pos);
    return hits;
  }

  step(chunk) {
    // keep the last STEP + 480 samples
    const need = STEP + MEL_CONTEXT; const keep = new Float32Array(Math.min(need, this.raw.length + chunk.length));
    const all = new Float32Array(this.raw.length + chunk.length); all.set(this.raw); all.set(chunk, this.raw.length);
    keep.set(all.subarray(all.length - keep.length)); this.raw = keep;
    let sum = 0; for (let i = 0; i < chunk.length; i += 4) sum += chunk[i] * chunk[i]; const rms = Math.sqrt(sum / Math.ceil(chunk.length / 4)) / 32768;
    this.levelEma = Math.max(rms, this.levelEma * 0.97);
    if (this.raw.length < need) return null;
    this.steps++;

    const melOut = this.mel.run({ input: tensor([1, need], Float64Array.from(this.raw)) }).output;
    const rows = new Float64Array(melOut.data.length); for (let i = 0; i < rows.length; i++) rows[i] = melOut.data[i] / 10 + 2;   // openWakeWord melspec transform
    const emb = this.embedding.push(rows, melOut.data.length / 32);
    if (!emb) return null;
    this.features.shift(); this.features.push(emb);

    const input = new Float64Array(HEAD_FRAMES * EMBED_DIM); this.features.forEach((f, i) => input.set(f, i * EMBED_DIM));
    const t = tensor([1, HEAD_FRAMES, EMBED_DIM], input);
    let best = null; const warm = this.steps > this.warmupSteps;
    for (const h of this.heads) {
      h.score = Object.values(h.model.run({ x: t }))[0].data[0];
      h.streak = warm && h.score >= this.threshold ? h.streak + 1 : 0;
      if (h.streak >= this.patience && (!best || h.score > best.score)) best = h;
    }
    const now = Date.now();
    if (best && this.levelEma > 0.002 && now - this.lastFireAt > this.cooldownMs) {
      this.lastFireAt = now; const hit = { name: best.name, word: best.word, score: best.score };
      for (const h of this.heads) h.streak = 0;
      return hit;
    }
    return null;
  }

  /** current score of every head (0-1), for tuning/diagnostics */
  scores() { const o = {}; for (const h of this.heads) o[h.name] = h.score; return o; }
}

/** "hey_nexora.onnx" -> "Hey Nexora" */
function prettyName(file) { return path.basename(file, '.onnx').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

/** Reads assets/wakeword/: the two shared front-end models plus every other *.onnx there as a wake-phrase head. */
function loadModelFiles(dir) {
  const read = (f) => fs.readFileSync(path.join(dir, f));
  for (const f of FRONT_END) if (!fs.existsSync(path.join(dir, f))) throw new Error(`Wake-word model missing: ${path.join(dir, f)}`);
  const heads = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.onnx') && !FRONT_END.has(f)).sort().map((f) => ({ name: path.basename(f, '.onnx'), word: prettyName(f), bytes: read(f) }));
  if (!heads.length) throw new Error(`No wake-word model (*.onnx) found in ${dir}`);
  return { mel: read('melspectrogram.onnx'), embedding: read('embedding_model.onnx'), heads };
}

module.exports = { OnnxWakeEngine, IncrementalEmbedding, loadModelFiles, prettyName, STEP, SAMPLE_RATE };
