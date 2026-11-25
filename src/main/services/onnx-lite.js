/* ==========================================================================
   NEXORA — onnx-lite (v0.3.25)
   A small, dependency-free ONNX executor in plain JavaScript (Float32). It runs exactly the operators the
   wake-word pipeline needs (openWakeWord mel-spectrogram + speech-embedding + classifier heads), so NEXORA
   needs no native module, no WASM and no `npm install` for offline wake-word detection.

   Supported ops: Constant Unsqueeze Reshape Transpose Cast Conv MaxPool MatMul Gemm Add Sub Mul Div Pow Max
   Clip Log Relu LeakyRelu Sigmoid ReduceMax LayerNormalization.
   Anything else throws a clear error naming the op, so an unsupported model fails loudly, never silently.
   ========================================================================== */
'use strict';

/* ---------------------------- protobuf reader ---------------------------- */
function readVarint(buf, pos) {
  let lo = 0; let hi = 0; let shift = 0; let b;
  do {
    b = buf[pos++];
    if (shift < 28) lo |= (b & 0x7f) << shift;
    else if (shift === 28) { lo |= (b & 0x0f) << 28; hi |= (b & 0x7f) >>> 4; }
    else hi |= (b & 0x7f) << (shift - 32);
    shift += 7;
  } while (b & 0x80);
  lo >>>= 0; hi >>>= 0;
  const big = (BigInt(hi) << 32n) | BigInt(lo);
  const value = Number(BigInt.asIntN(64, big));      // int64 semantics: -1 is encoded as 2^64-1
  return [value, pos];
}

function* fieldsOf(buf) {
  let pos = 0;
  while (pos < buf.length) {
    let key; [key, pos] = readVarint(buf, pos);
    const field = key >>> 3; const wire = key & 7;
    if (wire === 0) { let v; [v, pos] = readVarint(buf, pos); yield [field, wire, v]; }
    else if (wire === 2) { let len; [len, pos] = readVarint(buf, pos); yield [field, wire, buf.subarray(pos, pos + len)]; pos += len; }
    else if (wire === 5) { yield [field, wire, buf.subarray(pos, pos + 4)]; pos += 4; }
    else if (wire === 1) { yield [field, wire, buf.subarray(pos, pos + 8)]; pos += 8; }
    else throw new Error('ONNX parse error: unsupported protobuf wire type ' + wire);
  }
}

function packedVarints(buf) { const out = []; let pos = 0; while (pos < buf.length) { let v; [v, pos] = readVarint(buf, pos); out.push(v); } return out; }
function copyAligned(u8) { const c = new Uint8Array(u8.length); c.set(u8); return c.buffer; }

/* ------------------------------- tensors -------------------------------- */
const prod = (dims) => dims.reduce((a, b) => a * b, 1);
function tensor(dims, data, type = 'float32') { return { dims, data, type }; }

function parseTensor(buf) {
  const t = { dims: [], dt: 1, raw: null, floats: [], ints: [], name: '' };
  for (const [f, w, v] of fieldsOf(buf)) {
    if (f === 1) { if (w === 2) t.dims.push(...packedVarints(v)); else t.dims.push(v); }
    else if (f === 2) t.dt = v;
    else if (f === 8) t.name = Buffer.from(v).toString('utf8');
    else if (f === 9) t.raw = v;
    else if (f === 4) { if (w === 2) { const f32 = new Float32Array(copyAligned(v)); for (const x of f32) t.floats.push(x); } else t.floats.push(new Float32Array(copyAligned(v))[0]); }
    else if (f === 7 || f === 5) { if (w === 2) t.ints.push(...packedVarints(v)); else t.ints.push(v); }
  }
  const n = prod(t.dims);
  let data; let type;
  if (t.dt === 1) {
    type = 'float32';
    data = t.raw ? new Float32Array(copyAligned(t.raw)) : Float32Array.from(t.floats);
  } else if (t.dt === 7) {
    type = 'int64';
    if (t.raw) { const dv = new DataView(copyAligned(t.raw)); data = new Float64Array(n); for (let i = 0; i < n; i++) data[i] = Number(dv.getBigInt64(i * 8, true)); }
    else data = Float64Array.from(t.ints);
  } else if (t.dt === 6) {
    type = 'int64';
    if (t.raw) data = Float64Array.from(new Int32Array(copyAligned(t.raw))); else data = Float64Array.from(t.ints);
  } else if (t.dt === 11) {
    type = 'float32'; data = t.raw ? Float32Array.from(new Float64Array(copyAligned(t.raw))) : Float32Array.from(t.floats);
  } else throw new Error('ONNX: unsupported tensor data type ' + t.dt + ' (' + t.name + ')');
  if (data.length !== n) throw new Error(`ONNX: tensor "${t.name}" has ${data.length} values for shape [${t.dims}]`);
  return { name: t.name, tensor: tensor(t.dims.slice(), data, type) };
}

function parseAttribute(buf) {
  const a = { name: '', f: null, i: null, s: null, t: null, floats: [], ints: [] };
  for (const [f, w, v] of fieldsOf(buf)) {
    if (f === 1) a.name = Buffer.from(v).toString('utf8');
    else if (f === 2) a.f = new Float32Array(copyAligned(v))[0];
    else if (f === 3) a.i = v;
    else if (f === 4) a.s = Buffer.from(v).toString('utf8');
    else if (f === 5) a.t = parseTensor(v).tensor;
    else if (f === 7) { if (w === 2) a.floats.push(...new Float32Array(copyAligned(v))); else a.floats.push(new Float32Array(copyAligned(v))[0]); }
    else if (f === 8) { if (w === 2) a.ints.push(...packedVarints(v)); else a.ints.push(v); }
  }
  return a;
}

function parseModel(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let graph = null;
  for (const [f, , v] of fieldsOf(buf)) if (f === 7) graph = v;
  if (!graph) throw new Error('ONNX: file has no graph');
  const nodes = []; const inits = new Map(); const inputs = []; const outputs = [];
  const nameOf = (v) => { for (const [f, , x] of fieldsOf(v)) if (f === 1) return Buffer.from(x).toString('utf8'); return ''; };
  for (const [f, , v] of fieldsOf(graph)) {
    if (f === 1) {
      const n = { op: '', name: '', inputs: [], outputs: [], attrs: {} };
      for (const [nf, , nv] of fieldsOf(v)) {
        if (nf === 1) n.inputs.push(Buffer.from(nv).toString('utf8'));
        else if (nf === 2) n.outputs.push(Buffer.from(nv).toString('utf8'));
        else if (nf === 3) n.name = Buffer.from(nv).toString('utf8');
        else if (nf === 4) n.op = Buffer.from(nv).toString('utf8');
        else if (nf === 5) { const a = parseAttribute(nv); n.attrs[a.name] = a; }
      }
      nodes.push(n);
    } else if (f === 5) { const { name, tensor: t } = parseTensor(v); inits.set(name, t); }
    else if (f === 11) inputs.push(nameOf(v));
    else if (f === 12) outputs.push(nameOf(v));
  }
  return { nodes, inits, inputs: inputs.filter((n) => !inits.has(n)), outputs };
}

/* ------------------------------ op helpers ------------------------------- */
function broadcastShape(a, b) {
  const n = Math.max(a.length, b.length); const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = a[a.length - 1 - i] ?? 1; const y = b[b.length - 1 - i] ?? 1;
    if (x !== y && x !== 1 && y !== 1) throw new Error(`ONNX: cannot broadcast [${a}] with [${b}]`);
    out[n - 1 - i] = Math.max(x, y);
  }
  return out;
}
function stridesOf(dims) { const s = new Array(dims.length); let acc = 1; for (let i = dims.length - 1; i >= 0; i--) { s[i] = acc; acc *= dims[i]; } return s; }

function binary(a, b, fn) {
  const A = a.data; const B = b.data;
  if (A.length === B.length && a.dims.length === b.dims.length) { const out = new Float64Array(A.length); for (let i = 0; i < A.length; i++) out[i] = fn(A[i], B[i]); return tensor(a.dims.slice(), out); }
  if (B.length === 1) { const out = new Float64Array(A.length); const y = B[0]; for (let i = 0; i < A.length; i++) out[i] = fn(A[i], y); return tensor(a.dims.length >= b.dims.length ? a.dims.slice() : broadcastShape(a.dims, b.dims), out); }
  if (A.length === 1) { const out = new Float64Array(B.length); const x = A[0]; for (let i = 0; i < B.length; i++) out[i] = fn(x, B[i]); return tensor(b.dims.length >= a.dims.length ? b.dims.slice() : broadcastShape(a.dims, b.dims), out); }
  const dims = broadcastShape(a.dims, b.dims); const n = prod(dims); const out = new Float64Array(n);
  const pad = (d) => Array(dims.length - d.length).fill(1).concat(d);
  const ad = pad(a.dims); const bd = pad(b.dims); const as = stridesOf(ad); const bs = stridesOf(bd);
  const idx = new Array(dims.length).fill(0);
  for (let i = 0; i < n; i++) {
    let ia = 0; let ib = 0;
    for (let d = 0; d < dims.length; d++) { ia += (ad[d] === 1 ? 0 : idx[d]) * as[d]; ib += (bd[d] === 1 ? 0 : idx[d]) * bs[d]; }
    out[i] = fn(A[ia], B[ib]);
    for (let d = dims.length - 1; d >= 0; d--) { if (++idx[d] < dims[d]) break; idx[d] = 0; }
  }
  return tensor(dims, out);
}
const unary = (x, fn) => { const out = new Float64Array(x.data.length); for (let i = 0; i < out.length; i++) out[i] = fn(x.data[i]); return tensor(x.dims.slice(), out); };
const attrInts = (n, name, dflt) => (n.attrs[name] ? n.attrs[name].ints.slice() : dflt);
const attrInt = (n, name, dflt) => (n.attrs[name] && n.attrs[name].i !== null ? n.attrs[name].i : dflt);
const attrFloat = (n, name, dflt) => (n.attrs[name] && n.attrs[name].f !== null ? n.attrs[name].f : dflt);

const f64 = (t) => (t.data instanceof Float64Array ? t.data : (t._f64 ||= Float64Array.from(t.data)));

/** Conv, NCHW, any group, with 1-D inputs treated as H = 1. Float64 inner loops; 1x3 and 3x1 kernels (the bulk of the
 *  speech-embedding network) are unrolled so each output row is written once per input channel. */
function conv(x, w, bias, node) {
  let xd = x.dims; let wd = w.dims; const is1d = xd.length === 3;
  if (is1d) { xd = [xd[0], xd[1], 1, xd[2]]; wd = [wd[0], wd[1], 1, wd[2]]; }
  const [N, C, H, W] = xd; const [O, Cg, KH, KW] = wd;
  const group = attrInt(node, 'group', 1);
  let strides = attrInts(node, 'strides', is1d ? [1] : [1, 1]); let dil = attrInts(node, 'dilations', is1d ? [1] : [1, 1]);
  let pads = attrInts(node, 'pads', is1d ? [0, 0] : [0, 0, 0, 0]);
  if (is1d) { strides = [1, strides[0]]; dil = [1, dil[0]]; pads = [0, pads[0], 0, pads[1]]; }
  const [sy, sx] = strides; const [dy, dx] = dil; const [pt, pl, pb, pr] = pads;
  const OH = Math.floor((H + pt + pb - dy * (KH - 1) - 1) / sy) + 1;
  const OW = Math.floor((W + pl + pr - dx * (KW - 1) - 1) / sx) + 1;
  const out = new Float64Array(N * O * OH * OW); const X = f64(x); const Wt = f64(w); const B = bias ? f64(bias) : null;
  const og = O / group;
  const simple = sx === 1 && dx === 1 && dy === 1 && sy === 1 && pl === 0 && pr === 0 && pt === 0 && pb === 0;
  for (let n = 0; n < N; n++) {
    for (let o = 0; o < O; o++) {
      const g = Math.floor(o / og); const ob = (n * O + o) * OH * OW;
      if (B) out.fill(B[o], ob, ob + OH * OW);
      for (let cg = 0; cg < Cg; cg++) {
        const c = g * Cg + cg; const xb = (n * C + c) * H * W; const wb = (o * Cg + cg) * KH * KW;
        if (H === 1 && KH === 1 && dx === 1 && pt === 0 && pb === 0) {  // 1-D strided conv (the STFT): one contiguous dot product per frame
          for (let ox = 0; ox < OW; ox++) { const start = ox * sx - pl; let acc = 0; const lo = Math.max(0, -start); const hi = Math.min(KW, W - start); for (let k = lo; k < hi; k++) acc += Wt[wb + k] * X[xb + start + k]; out[ob + ox] += acc; }
        } else if (KH === 1 && KW === 3 && sx === 1 && sy === 1 && dx === 1 && pl === 1 && pr === 1 && pt === 0 && pb === 0 && OW === W && W >= 2) {   // 1x3, "same" padding along the width
          const w0 = Wt[wb]; const w1 = Wt[wb + 1]; const w2 = Wt[wb + 2];
          for (let oy = 0; oy < OH; oy++) {
            const xr = xb + oy * W; const orow = ob + oy * OW;
            out[orow] += w1 * X[xr] + w2 * X[xr + 1];
            for (let ox = 1; ox < W - 1; ox++) out[orow + ox] += w0 * X[xr + ox - 1] + w1 * X[xr + ox] + w2 * X[xr + ox + 1];
            out[orow + W - 1] += w0 * X[xr + W - 2] + w1 * X[xr + W - 1];
          }
        } else if (simple && KH === 1 && KW === 3) {                       // 1x3, valid padding
          const w0 = Wt[wb]; const w1 = Wt[wb + 1]; const w2 = Wt[wb + 2];
          for (let oy = 0; oy < OH; oy++) { const xr = xb + oy * W; const orow = ob + oy * OW; for (let ox = 0; ox < OW; ox++) out[orow + ox] += w0 * X[xr + ox] + w1 * X[xr + ox + 1] + w2 * X[xr + ox + 2]; }
        } else if (simple && KH === 3 && KW === 1) {                // 3x1, valid padding
          const w0 = Wt[wb]; const w1 = Wt[wb + 1]; const w2 = Wt[wb + 2];
          for (let oy = 0; oy < OH; oy++) { const r0 = xb + oy * W; const r1 = r0 + W; const r2 = r1 + W; const orow = ob + oy * OW; for (let ox = 0; ox < OW; ox++) out[orow + ox] += w0 * X[r0 + ox] + w1 * X[r1 + ox] + w2 * X[r2 + ox]; }
        } else {                                                    // general case
          for (let kh = 0; kh < KH; kh++) {
            for (let kw = 0; kw < KW; kw++) {
              const wv = Wt[wb + kh * KW + kw]; if (wv === 0) continue;
              const oyLo = Math.max(0, Math.ceil((pt - kh * dy) / sy)); const oyHi = Math.min(OH - 1, Math.floor((H - 1 + pt - kh * dy) / sy));
              const oxLo = Math.max(0, Math.ceil((pl - kw * dx) / sx)); const oxHi = Math.min(OW - 1, Math.floor((W - 1 + pl - kw * dx) / sx));
              for (let oy = oyLo; oy <= oyHi; oy++) {
                const iy = oy * sy - pt + kh * dy; const xr = xb + iy * W; const orow = ob + oy * OW;
                if (sx === 1) { const off = xr - pl + kw * dx; for (let ox = oxLo; ox <= oxHi; ox++) out[orow + ox] += X[off + ox] * wv; }
                else { for (let ox = oxLo; ox <= oxHi; ox++) out[orow + ox] += X[xr + ox * sx - pl + kw * dx] * wv; }
              }
            }
          }
        }
      }
    }
  }
  return tensor(is1d ? [N, O, OW] : [N, O, OH, OW], out);
}

function maxPool(x, node) {
  const [N, C, H, W] = x.dims; const k = attrInts(node, 'kernel_shape', [1, 1]); const s = attrInts(node, 'strides', [1, 1]); const p = attrInts(node, 'pads', [0, 0, 0, 0]);
  const OH = Math.floor((H + p[0] + p[2] - k[0]) / s[0]) + 1; const OW = Math.floor((W + p[1] + p[3] - k[1]) / s[1]) + 1;
  const out = new Float64Array(N * C * OH * OW); let o = 0;
  for (let nc = 0; nc < N * C; nc++) {
    const base = nc * H * W;
    for (let oy = 0; oy < OH; oy++) for (let ox = 0; ox < OW; ox++) {
      let m = -Infinity;
      for (let ky = 0; ky < k[0]; ky++) { const iy = oy * s[0] - p[0] + ky; if (iy < 0 || iy >= H) continue; for (let kx = 0; kx < k[1]; kx++) { const ix = ox * s[1] - p[1] + kx; if (ix < 0 || ix >= W) continue; const v = x.data[base + iy * W + ix]; if (v > m) m = v; } }
      out[o++] = m;
    }
  }
  return tensor([N, C, OH, OW], out);
}

function matmul(a, b) {
  if (b.dims.length !== 2) throw new Error('ONNX: MatMul supports a 2-D right operand only');
  const K = a.dims[a.dims.length - 1]; const [K2, Nn] = b.dims; if (K !== K2) throw new Error(`ONNX: MatMul shape mismatch ${a.dims} x ${b.dims}`);
  const M = a.data.length / K; const out = new Float64Array(M * Nn); const A = a.data; const B = b.data;
  for (let m = 0; m < M; m++) { const ob = m * Nn; for (let k = 0; k < K; k++) { const av = A[m * K + k]; if (av === 0) continue; const bb = k * Nn; for (let n = 0; n < Nn; n++) out[ob + n] += av * B[bb + n]; } }
  return tensor([...a.dims.slice(0, -1), Nn], out);
}

function transpose(x, perm) {
  const nd = x.dims.length; perm = perm && perm.length ? perm : [...Array(nd).keys()].reverse();
  const od = perm.map((p) => x.dims[p]); const xs = stridesOf(x.dims); const out = new Float64Array(x.data.length); const idx = new Array(nd).fill(0);
  for (let i = 0; i < out.length; i++) {
    let src = 0; for (let d = 0; d < nd; d++) src += idx[d] * xs[perm[d]];
    out[i] = x.data[src];
    for (let d = nd - 1; d >= 0; d--) { if (++idx[d] < od[d]) break; idx[d] = 0; }
  }
  return tensor(od, out);
}

function reshape(x, shapeT, allowzero) {
  const total = x.data.length; const raw = Array.from(shapeT.data); const dims = raw.map((d, i) => (d === 0 && !allowzero ? x.dims[i] : d));
  const unknown = dims.indexOf(-1); if (unknown >= 0) { const known = dims.reduce((a, d, i) => (i === unknown ? a : a * d), 1); dims[unknown] = total / known; }
  if (prod(dims) !== total) throw new Error(`ONNX: Reshape [${x.dims}] -> [${raw}] is invalid`);
  return tensor(dims, x.data, x.type);
}

function layerNorm(x, scale, bias, node) {
  let axis = attrInt(node, 'axis', -1); const eps = attrFloat(node, 'epsilon', 1e-5); if (axis < 0) axis += x.dims.length;
  const inner = prod(x.dims.slice(axis)); const outer = x.data.length / inner; const out = new Float64Array(x.data.length);
  for (let o = 0; o < outer; o++) {
    let mean = 0; for (let i = 0; i < inner; i++) mean += x.data[o * inner + i]; mean /= inner;
    let v = 0; for (let i = 0; i < inner; i++) { const d = x.data[o * inner + i] - mean; v += d * d; } v /= inner;
    const inv = 1 / Math.sqrt(v + eps);
    for (let i = 0; i < inner; i++) out[o * inner + i] = (x.data[o * inner + i] - mean) * inv * scale.data[i] + (bias ? bias.data[i] : 0);
  }
  return tensor(x.dims.slice(), out);
}

function reduceMax(x, node, axesT) {
  const keep = attrInt(node, 'keepdims', 1); let axes = axesT ? Array.from(axesT.data) : attrInts(node, 'axes', null);
  if (!axes || !axes.length) { let m = -Infinity; for (const v of x.data) if (v > m) m = v; return tensor(keep ? x.dims.map(() => 1) : [], Float64Array.of(m)); }
  axes = axes.map((a) => (a < 0 ? a + x.dims.length : a)); const od = x.dims.map((d, i) => (axes.includes(i) ? 1 : d)); const out = new Float64Array(prod(od)).fill(-Infinity);
  const os = stridesOf(od); const idx = new Array(x.dims.length).fill(0);
  for (let i = 0; i < x.data.length; i++) { let o = 0; for (let d = 0; d < idx.length; d++) o += (axes.includes(d) ? 0 : idx[d]) * os[d]; if (x.data[i] > out[o]) out[o] = x.data[i]; for (let d = idx.length - 1; d >= 0; d--) { if (++idx[d] < x.dims[d]) break; idx[d] = 0; } }
  return tensor(keep ? od : od.filter((_, i) => !axes.includes(i)), out);
}

/* --------------------------------- ops ---------------------------------- */
const OPS = {
  Constant: (n) => { const a = n.attrs.value; if (a && a.t) return a.t; if (n.attrs.value_float) return tensor([], Float32Array.of(n.attrs.value_float.f)); if (n.attrs.value_int) return tensor([], Float64Array.of(n.attrs.value_int.i), 'int64'); throw new Error('ONNX: unsupported Constant'); },
  Unsqueeze: (n, [x, axesT]) => { const axes = axesT ? Array.from(axesT.data) : attrInts(n, 'axes', []); const nd = x.dims.length + axes.length; const norm = axes.map((a) => (a < 0 ? a + nd : a)); const dims = []; let src = 0; for (let i = 0; i < nd; i++) dims.push(norm.includes(i) ? 1 : x.dims[src++]); return tensor(dims, x.data, x.type); },
  Reshape: (n, [x, s]) => reshape(x, s, attrInt(n, 'allowzero', 0)),
  Transpose: (n, [x]) => transpose(x, attrInts(n, 'perm', null)),
  Cast: (n, [x]) => (attrInt(n, 'to', 1) === 1 ? tensor(x.dims.slice(), Float64Array.from(x.data)) : tensor(x.dims.slice(), Float64Array.from(x.data, Math.trunc), 'int64')),
  Conv: (n, [x, w, b]) => conv(x, w, b, n),
  MaxPool: (n, [x]) => maxPool(x, n),
  MatMul: (n, [a, b]) => matmul(a, b),
  Gemm: (n, [a, b, c]) => {
    const tA = attrInt(n, 'transA', 0); const tB = attrInt(n, 'transB', 0); const alpha = attrFloat(n, 'alpha', 1); const beta = attrFloat(n, 'beta', 1);
    const M = tA ? a.dims[1] : a.dims[0]; const K = tA ? a.dims[0] : a.dims[1]; const Nn = tB ? b.dims[0] : b.dims[1]; const out = new Float64Array(M * Nn);
    for (let m = 0; m < M; m++) for (let j = 0; j < Nn; j++) { let s = 0; for (let k = 0; k < K; k++) s += (tA ? a.data[k * M + m] : a.data[m * K + k]) * (tB ? b.data[j * K + k] : b.data[k * Nn + j]); out[m * Nn + j] = alpha * s + (c ? beta * (c.data.length === 1 ? c.data[0] : c.data.length === Nn ? c.data[j] : c.data[m * Nn + j]) : 0); }
    return tensor([M, Nn], out);
  },
  Add: (n, [a, b]) => binary(a, b, (x, y) => x + y),
  Sub: (n, [a, b]) => binary(a, b, (x, y) => x - y),
  Mul: (n, [a, b]) => binary(a, b, (x, y) => x * y),
  Div: (n, [a, b]) => binary(a, b, (x, y) => x / y),
  Pow: (n, [a, b]) => (b.data.length === 1 && b.data[0] === 2 ? unary(a, (x) => x * x) : binary(a, b, Math.pow)),
  Max: (n, ins) => ins.reduce((a, b) => binary(a, b, (x, y) => (x > y ? x : y))),
  Clip: (n, [x, lo, hi]) => { const mn = lo && lo.data.length ? lo.data[0] : -Infinity; const mx = hi && hi.data.length ? hi.data[0] : Infinity; return unary(x, (v) => (v < mn ? mn : v > mx ? mx : v)); },
  Log: (n, [x]) => unary(x, Math.log),
  Relu: (n, [x]) => unary(x, (v) => (v > 0 ? v : 0)),
  LeakyRelu: (n, [x]) => { const a = attrFloat(n, 'alpha', 0.01); return unary(x, (v) => (v >= 0 ? v : a * v)); },
  Sigmoid: (n, [x]) => unary(x, (v) => 1 / (1 + Math.exp(-v))),
  ReduceMax: (n, [x, axes]) => reduceMax(x, n, axes),
  LayerNormalization: (n, [x, s, b]) => layerNorm(x, s, b, n),
};

class OnnxModel {
  constructor(bytes) {
    const m = parseModel(bytes);
    this.nodes = m.nodes; this.inits = m.inits; this.inputNames = m.inputs; this.outputNames = m.outputs;
    for (const n of this.nodes) if (!OPS[n.op]) throw new Error(`onnx-lite: operator "${n.op}" is not supported (node ${n.name || n.outputs[0]})`);
  }
  /** @param {Record<string, {dims:number[], data:Float32Array}>} feeds @returns {Record<string, {dims:number[], data:Float32Array}>} */
  run(feeds) {
    const env = new Map(this.inits);
    for (const [k, v] of Object.entries(feeds)) env.set(k, v);
    for (const node of this.nodes) {
      const ins = node.inputs.map((name) => { if (!name) return undefined; const t = env.get(name); if (!t) throw new Error(`onnx-lite: missing tensor "${name}" for ${node.op}`); return t; });
      const out = OPS[node.op](node, ins);
      env.set(node.outputs[0], out);
    }
    const res = {}; for (const name of this.outputNames) res[name] = env.get(name);
    return res;
  }
}

module.exports = { OnnxModel, parseModel, tensor, OPS, prod };
