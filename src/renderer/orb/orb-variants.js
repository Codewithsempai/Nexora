// Exact canvas renderer source extracted from the supplied NEXORA orb test HTML.
// Original particle positions required by the sphere renderer (360-point Fibonacci sphere).
const PTS = (() => { const n = 360, p = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - i / (n - 1) * 2, r = Math.sqrt(1 - y * y), th = g * i; p[i * 3] = Math.cos(th) * r; p[i * 3 + 1] = y; p[i * 3 + 2] = Math.sin(th) * r; } return p; })();

const colors = new WeakMap()

// Colours glide between states instead of snapping.
function smooth(ctx, rgb) {
  const cur = colors.get(ctx) || rgb.slice()
  for (let i = 0; i < 3; i++) cur[i] += (rgb[i] - cur[i]) * 0.12
  colors.set(ctx, cur)
  return cur
}

function c3(c, a, add = 0) {
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + add)))
  return 'rgba(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'
}

const fibs = new Map()
const graphs = new Map()

// n points spread evenly over a unit sphere, as a flat [x,y,z,x,y,z...] list
function fib(n) {
  let p = fibs.get(n)
  if (!p) {
    p = []
    const g = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * 2
      const r = Math.sqrt(1 - y * y)
      p.push(Math.cos(g * i) * r, y, Math.sin(g * i) * r)
    }
    fibs.set(n, p)
  }
  return p
}

// the k nearest points to (x,y,z) among points lo..hi-1
function near(P, x, y, z, lo, hi, skip, k) {
  const d = []
  for (let j = lo; j < hi; j++) {
    if (j !== skip) d.push([(P[j * 3] - x) ** 2 + (P[j * 3 + 1] - y) ** 2 + (P[j * 3 + 2] - z) ** 2, j])
  }
  d.sort((a, b) => a[0] - b[0])
  return d.slice(0, k).map((e) => e[1])
}

// Two nested shells of nodes: n outer, n2 inner (half the radius), linked to near neighbours and to each other.
function graph(n, n2) {
  const key = n * 1000 + n2
  let g = graphs.get(key)
  if (!g) {
    const P = fib(n).slice()
    const Q = fib(n2)
    for (let i = 0; i < Q.length; i++) P.push(Q[i] * 0.5)
    const N = n + n2
    const E = []
    const seen = new Set()
    const add = function (i, j) {
      const k = Math.min(i, j) * 1000 + Math.max(i, j)
      if (!seen.has(k)) {
        seen.add(k)
        E.push([i, j])
      }
    }
    for (let i = 0; i < n; i++) near(P, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0, n, i, 3).forEach((j) => add(i, j))
    for (let i = n; i < N; i++) {
      near(P, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], n, N, i, 2).forEach((j) => add(i, j))
      near(P, P[i * 3] * 2, P[i * 3 + 1] * 2, P[i * 3 + 2] * 2, 0, n, -1, 1).forEach((j) => add(i, j))
    }
    g = { P, E, n, N, hops: new Map() }
    graphs.set(key, g)
  }
  return g
}

// number of links from node src to every other node
function hops(g, src) {
  let d = g.hops.get(src)
  if (!d) {
    d = new Array(g.N).fill(99)
    const adj = []
    for (let i = 0; i < g.N; i++) adj.push([])
    for (let k = 0; k < g.E.length; k++) {
      adj[g.E[k][0]].push(g.E[k][1])
      adj[g.E[k][1]].push(g.E[k][0])
    }
    d[src] = 0
    const q = [src]
    for (let h = 0; h < q.length; h++) {
      for (let m = 0; m < adj[q[h]].length; m++) {
        const j = adj[q[h]][m]
        if (d[j] === 99) {
          d[j] = d[q[h]] + 1
          q.push(j)
        }
      }
    }
    g.hops.set(src, d)
  }
  return d
}

function mix(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function ease3(w) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, w)), 3)
}

// how loud the orb is right now (0..1)
function level(s) {
  if (s.reduce) return 0
  if (s.state === 'speaking') return Math.min(1, s.out * 3.5 + s.energy * 0.5)
  if (s.state === 'listening') return Math.min(1, s.mic * 4)
  if (s.state === 'thinking') return 0.5
  return 0
}

// per-canvas animation clock: speed changes never make the motion jump
const anims = new WeakMap()
function anim(ctx, s, speed) {
  let a = anims.get(ctx)
  if (!a) {
    a = { ph: 0.8, last: s.t, tw: 3.1, layer: null }
    anims.set(ctx, a)
  }
  const dt = Math.min(100, Math.max(0, s.t - a.last))
  a.last = s.t
  if (!s.reduce) a.ph += dt * speed
  return a
}

function pointRing(ctx, s, c, R, t) {
  if (s.state !== 'pointing') return
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineWidth = Math.max(1, s.px * 0.012)
  ctx.strokeStyle = c3(c, 0.6, 40)
  ctx.beginPath()
  ctx.arc(s.px / 2, s.px / 2, R * 1.28 * (s.reduce ? 1 : 1 + 0.05 * Math.sin(t * 0.006)), 0, Math.PI * 2)
  ctx.stroke()
}

// soft glass edge: light gathers toward the rim of the sphere
function rim(ctx, px, c, R, a) {
  const g = ctx.createRadialGradient(px / 2, px / 2, R * 0.65, px / 2, px / 2, R * 1.06)
  g.addColorStop(0, c3(c, 0))
  g.addColorStop(0.85, c3(c, a * 0.5, 30))
  g.addColorStop(1, c3(c, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, px, px)
}

// NEURAL SPHERE: two counter-rotating shells joined by links, a glowing core, light packets travelling the links,
// drifting dust. Idle: nodes twinkle. Listening: network draws in, rings close inward. Thinking: a signal hops from node
// to node through both shells and the core flashes. Speaking: bands of light run down the sphere.
function drawNeural(ctx, s) {
  const px = s.px
  const t = s.reduce ? 0 : s.t
  const c = smooth(ctx, s.rgb)
  const c2 = [150, 110, 255]
  const cx = px / 2
  const ease = ease3(s.wake)
  const lvl = level(s)
  const A = anim(ctx, s, s.state === 'thinking' ? 0.0007 : 0.0002)
  const R = px * 0.34 * (0.5 + 0.5 * ease) * (1 + (s.state === 'speaking' ? lvl * 0.1 : s.state === 'listening' ? -lvl * 0.08 : 0))
  const n = px >= 110 ? 64 : px >= 60 ? 40 : 16
  const n2 = px >= 110 ? 24 : px >= 60 ? 12 : 0
  const g = graph(n, n2)
  const P = g.P
  const E = g.E
  const cyc = t / 1100
  const d = s.state === 'thinking' ? hops(g, (Math.floor(cyc) * 7) % n) : null
  const wave = (cyc % 1) * 10
  ctx.clearRect(0, 0, px, px)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  const glow = ctx.createRadialGradient(cx, cx, R * 0.5, cx, cx, px / 2)
  glow.addColorStop(0, c3(c, 0.2 + lvl * 0.12))
  glow.addColorStop(1, c3(c, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, px, px)
  rim(ctx, px, c, R, 0.3 + lvl * 0.3)
  ctx.globalCompositeOperation = 'lighter'
  // glowing core, flashes when a signal reaches the middle
  const flash = d ? Math.max(0, 1 - Math.abs(wave - 5) / 1.5) : 0
  const cr = R * 0.42 * (1 + lvl * 0.4 + flash * 0.3 + Math.sin(t * 0.002) * 0.05)
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, cr)
  core.addColorStop(0, 'rgba(255,255,255,' + ((0.3 + 0.4 * flash + 0.3 * lvl) * ease).toFixed(3) + ')')
  core.addColorStop(0.4, c3(c, (0.22 + 0.3 * flash + 0.2 * lvl) * ease, 40))
  core.addColorStop(1, c3(c, 0))
  ctx.fillStyle = core
  ctx.fillRect(0, 0, px, px)
  const X = []
  const Y = []
  const Z = []
  const G = []
  for (let i = 0; i < g.N; i++) {
    const inner = i >= n
    const ang = inner ? 1 - A.ph * 1.6 : A.ph // the inner shell turns the other way, faster
    const tilt = inner ? 0.9 : 0.35
    const wk = ease3(s.wake * 1.5 - (i / g.N) * 0.5) // nodes switch on one after another
    const x1 = P[i * 3] * Math.cos(ang) + P[i * 3 + 2] * Math.sin(ang)
    const z1 = -P[i * 3] * Math.sin(ang) + P[i * 3 + 2] * Math.cos(ang)
    const y2 = P[i * 3 + 1] * Math.cos(tilt) - z1 * Math.sin(tilt)
    const z2 = P[i * 3 + 1] * Math.sin(tilt) + z1 * Math.cos(tilt)
    const pe = 1 / (1 - z2 * 0.22)
    X.push(cx + x1 * R * pe * wk)
    Y.push(cx + y2 * R * pe * wk)
    Z.push(z2 * (inner ? 0.6 : 1))
    const tw = s.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.003 + i * 1.7)
    const band = s.state === 'speaking' ? lvl * Math.max(0, Math.sin(P[i * 3 + 1] * 5 * (inner ? 2 : 1) - t * 0.007)) : 0
    const fire = d ? Math.max(0, 1 - Math.abs(wave - d[i]) / 1.1) : 0
    G.push(Math.min(1, tw * 0.3 + band + fire + (s.state === 'listening' ? lvl * 0.5 * tw : 0)))
  }
  ctx.globalAlpha = s.state === 'idle' ? 0.82 : 1
  ctx.lineWidth = Math.max(0.6, px * 0.0042)
  for (let k = 0; k < E.length; k++) {
    const i = E[k][0]
    const j = E[k][1]
    const depth = ((Z[i] + Z[j]) / 2 + 1) / 2
    const gl = (G[i] + G[j]) / 2
    const m = Math.min(1, Math.max(0, (X[i] + X[j] - px) / (R * 4) + 0.5))
    ctx.strokeStyle = c3(mix(c, c2, m), (0.07 + 0.34 * depth + 0.6 * gl) * ease * (j >= n || i >= n ? 0.8 : 1), 40 * gl)
    ctx.beginPath()
    ctx.moveTo(X[i], Y[i])
    ctx.lineTo(X[j], Y[j])
    ctx.stroke()
  }
  // light packets travelling along the links
  if (!s.reduce) {
    const np = s.state === 'idle' ? 3 : 6 + Math.round(lvl * 10)
    for (let j = 0; j < np; j++) {
      const ph = t / (s.state === 'idle' ? 1500 : 800) + j * 0.31
      const e = E[(Math.floor(ph) * 37 + j * 13) % E.length]
      const u = ph % 1
      const px1 = X[e[0]] + (X[e[1]] - X[e[0]]) * u
      const py1 = Y[e[0]] + (Y[e[1]] - Y[e[0]]) * u
      const al = Math.sin(u * Math.PI) * ease
      ctx.fillStyle = c3(c2, 0.35 * al, 60)
      ctx.beginPath()
      ctx.arc(px1, py1, px * 0.012, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * al).toFixed(3) + ')'
      ctx.beginPath()
      ctx.arc(px1, py1, px * 0.0045, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (let i = 0; i < g.N; i++) {
    const depth = (Z[i] + 1) / 2
    const m = Math.min(1, Math.max(0, (X[i] - cx) / (R * 2) + 0.5))
    const col = mix(c, c2, m)
    const r = px * (0.0035 + 0.008 * depth) * (1 + G[i] * 1.1) * (i >= n ? 0.8 : 1)
    ctx.fillStyle = c3(col, (0.12 + 0.5 * G[i]) * ease)
    ctx.beginPath()
    ctx.arc(X[i], Y[i], r * 2.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = c3(col, (0.4 + 0.6 * depth) * ease, 30 + 100 * G[i])
    ctx.beginPath()
    ctx.arc(X[i], Y[i], r, 0, Math.PI * 2)
    ctx.fill()
  }
  // drifting dust on a wider shell
  if (px >= 60) {
    const D = fib(36)
    const da = -A.ph * 0.5
    for (let i = 0; i < 36; i++) {
      const x1 = D[i * 3] * Math.cos(da) + D[i * 3 + 2] * Math.sin(da)
      const z1 = -D[i * 3] * Math.sin(da) + D[i * 3 + 2] * Math.cos(da)
      const y2 = D[i * 3 + 1] * Math.cos(0.6) - z1 * Math.sin(0.6)
      const tw = s.reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.004 + i * 3.1)
      ctx.fillStyle = c3(mix(c, c2, 0.5), 0.28 * tw * ease, 40)
      ctx.beginPath()
      ctx.arc(cx + x1 * R * 1.5, cx + y2 * R * 1.5, px * 0.0032, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  if (s.state === 'listening') {
    const ph = s.reduce ? 0.3 : (t * 0.0008) % 1
    ctx.lineWidth = Math.max(1, px * 0.01)
    ctx.strokeStyle = c3(c, ph * (0.15 + 0.55 * lvl), 50)
    ctx.beginPath()
    ctx.arc(cx, cx, R * (1.55 - 0.5 * ph), 0, Math.PI * 2)
    ctx.stroke()
  }
  pointRing(ctx, s, c, R, t)
}

// PARTICLE FLOW: lit streams of dots over soft inner haze, with glowing light trails, bloom on the bright dots and
// sparkles. Idle: slow drift. Listening: streams quicken, sphere draws in. Thinking: tight fast vortex.
// Speaking: waves of light run along the streams.
function drawFlow(ctx, s) {
  const px = s.px
  const t = s.reduce ? 0 : s.t
  const c = smooth(ctx, s.rgb)
  const c2 = [40, 220, 255]
  const cx = px / 2
  const ease = ease3(s.wake)
  const lvl = level(s)
  const speed = 0.00022 * (s.state === 'thinking' ? 3.2 : s.state === 'listening' ? 1 + lvl * 3 : s.state === 'speaking' ? 1 + lvl * 1.5 : 1)
  const A = anim(ctx, s, speed)
  const flow = A.ph
  A.tw += ((s.state === 'thinking' ? 5.6 : s.state === 'pointing' ? 1.4 : 3.1) - A.tw) * 0.05 // twist eases between states
  const R = px * 0.34 * (0.5 + 0.5 * ease) * (1 + (s.state === 'listening' ? -lvl * 0.07 : s.state === 'speaking' ? lvl * 0.05 : 0))
  const S = px >= 110 ? 14 : px >= 60 ? 10 : 7
  const SUB = px >= 60 ? 5 : 3
  const M = px >= 110 ? 24 : px >= 60 ? 16 : 8
  const n = S * SUB * M
  const sleepy = s.state === 'idle' ? 0.75 : 1
  const cT = Math.cos(0.38)
  const sT = Math.sin(0.38)
  ctx.clearRect(0, 0, px, px)
  ctx.globalCompositeOperation = 'source-over'
  const glow = ctx.createRadialGradient(cx, cx, R * 0.6, cx, cx, px / 2)
  glow.addColorStop(0, c3(c, 0.2 + lvl * 0.15))
  glow.addColorStop(1, c3(c, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, px, px)
  // soft haze inside the sphere gives it volume
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cx, R, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 3; b++) {
    const bx = cx + Math.cos(flow * 1.3 + b * 2.1) * R * 0.45
    const by = cx + Math.sin(flow * 1.7 + b * 2.1) * R * 0.45
    const hz = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.8)
    hz.addColorStop(0, c3(b % 2 ? c2 : c, (0.2 + lvl * 0.12) * ease, 0))
    hz.addColorStop(1, c3(c, 0))
    ctx.fillStyle = hz
    ctx.fillRect(0, 0, px, px)
  }
  ctx.restore()
  rim(ctx, px, c, R, 0.35 + lvl * 0.3)
  // dots are drawn on a separate layer that fades slowly, which leaves glowing trails
  const cv = ctx.canvas
  let L = A.layer
  if (!s.reduce && typeof document !== 'undefined') {
    if (!L || L.width !== cv.width || L.height !== cv.height) {
      L = document.createElement('canvas')
      L.width = cv.width
      L.height = cv.height
      A.layer = L
    }
  } else {
    L = null
  }
  const lc = L ? L.getContext('2d') : null
  if (lc) {
    lc.setTransform(1, 0, 0, 1, 0, 0)
    lc.globalCompositeOperation = 'destination-out'
    lc.fillStyle = 'rgba(0,0,0,0.5)'
    lc.fillRect(0, 0, L.width, L.height)
    lc.setTransform(ctx.getTransform())
  }
  const dc = lc || ctx
  const X = new Float32Array(n)
  const Y = new Float32Array(n)
  const RD = new Float32Array(n)
  const BK = new Uint8Array(n)
  let i = 0
  for (let st = 0; st < S; st++) {
    for (let sb = 0; sb < SUB; sb++) {
      for (let k = 0; k < M; k++) {
        const wk = ease3(s.wake * 1.4 - (i / n) * 0.4) // dots spiral in when it wakes
        const u = (k / M + flow * 0.5 + sb * 0.011) % 1 // position along the stream
        const y0 = -Math.cos(Math.PI * u)
        const r0 = Math.sqrt(1 - y0 * y0)
        const spread = (sb - (SUB - 1) / 2) * (0.035 + 0.05 * Math.sin(u * 6.3 + 1))
        const lon = (st / S) * Math.PI * 2 + spread + A.tw * u + 0.7 * Math.sin(u * 7 + flow * 2) + flow * 0.8 + (1 - wk) * 2.5
        const x1 = r0 * Math.cos(lon)
        const z1 = r0 * Math.sin(lon)
        const y2 = y0 * cT - z1 * sT
        const z2 = y0 * sT + z1 * cT
        let kk = 1
        let boost = 0
        if (!s.reduce) {
          if (s.state === 'speaking') {
            kk = 1 + lvl * 0.12 * Math.sin(u * 14 - t * 0.012)
            boost = lvl * Math.max(0, Math.sin(u * 10 - t * 0.01))
          } else if (s.state === 'listening') {
            kk = 1 - lvl * 0.1 * (0.5 + 0.5 * Math.sin(u * 6 + t * 0.005))
            boost = lvl * 0.4
          } else if (s.state === 'thinking') {
            kk = 1 + 0.03 * Math.sin(u * 20 + t * 0.012)
            boost = 0.2
          }
        }
        const sp = s.reduce ? 0 : Math.max(0, Math.sin(t * 0.004 + i * 12.9898) - 0.985) * 60 // random sparkles
        const depth = (z2 + 1) / 2
        const edge = Math.pow(1 - Math.abs(z2), 2)
        const lit = Math.max(0, -x1 * 0.35 - y2 * 0.5 + z2 * 0.8) // light from the upper left
        const al = Math.min(1, (0.12 + 0.45 * depth + 0.5 * edge + 0.3 * lit + 0.5 * boost + sp) * sleepy * ease)
        const m = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(st * 0.55 + u * 4 + flow)))
        X[i] = cx + x1 * R * kk * wk
        Y[i] = cx + y2 * R * kk * wk
        RD[i] = px * (0.0032 + 0.0032 * depth + 0.0035 * edge) * (1 + boost * 0.7 + sp)
        BK[i] = Math.min(3, Math.floor(al * 4)) * 4 + Math.min(3, Math.floor(m * 4))
        i++
      }
    }
  }
  dc.globalCompositeOperation = 'lighter'
  for (let b = 0; b < 16; b++) {
    const col = mix(c, c2, (b % 4) / 3)
    dc.fillStyle = c3(col, ((Math.floor(b / 4) + 1) / 4) * (lc ? 0.55 : 0.95), 20)
    dc.beginPath()
    for (let j = 0; j < n; j++) {
      if (BK[j] === b) {
        dc.moveTo(X[j] + RD[j], Y[j])
        dc.arc(X[j], Y[j], RD[j], 0, Math.PI * 2)
      }
    }
    dc.fill()
    if (b >= 12) {
      // bloom around the brightest dots
      dc.fillStyle = c3(col, lc ? 0.06 : 0.12, 40)
      dc.beginPath()
      for (let j = 0; j < n; j++) {
        if (BK[j] === b) {
          dc.moveTo(X[j] + RD[j] * 2.4, Y[j])
          dc.arc(X[j], Y[j], RD[j] * 2.4, 0, Math.PI * 2)
        }
      }
      dc.fill()
    }
  }
  if (lc) {
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(L, 0, 0)
    ctx.restore()
  }
  pointRing(ctx, s, c, R, t)
}


// This legacy module contains only the Neural Sphere and Particle Flow renderers.
// The original NEXORA particle sphere is exported by html-orb-renderers.js.
export { drawNeural, drawFlow };
