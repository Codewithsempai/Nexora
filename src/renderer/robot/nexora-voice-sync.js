/*!
 * Nexora Voice Sync  -  made by codewithsempai
 * Turns voice (AI speech audio, microphone, audio file, or browser TTS text) into
 * values that drive the robot's face display and body:
 *
 *   v = voice.update(dt, t)
 *   v.open   0..1   mouth opening (0 when the robot is only listening)
 *   v.width  .7..1.4 mouth width  (round "oo" -> wide "ee")
 *   v.level  0..1   loudness (glow pulse, voice wave, gesture strength)
 *   v.peak   0..1   short spike on loud syllables (eye squint / emphasis)
 *   v.vis    {open,pucker,press,teeth,tongue} real mouth-shape weights (visemes: M/B/P closure, F/V, TH, O/U round ...)
 *   v.viseme current viseme name ('A','E','I','O','U','MBP','FV','L','TH','SH','SZ','KG','rest')
 *   v.low / v.mid / v.high  band energies for the voice-wave VFX
 *   v.wave   Float32Array of the last audio frame (for drawing a waveform)
 *
 * Sources:
 *   voice.useElement(audioEl)   play the AI voice through <audio>/<video> and sync to it
 *   voice.useStream(mediaStream)  any MediaStream (e.g. WebRTC TTS)
 *   voice.useMic()              microphone -> level/wave only (robot is listening, mouth stays closed)
 *   voice.useFile(file)         user-picked audio file, plays it and syncs
 *   voice.speakText(text,opts)  browser speechSynthesis with word-timed mouth shapes
 *   voice.simulate(true)        fake talking envelope (when you only know "AI is speaking")
 *   voice.stop()
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoraVoiceSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const VOW = { a: [.95, 1.05], e: [.62, 1.3], i: [.42, 1.38], o: [.85, .74], u: [.55, .7], y: [.45, 1.2] };
  // full viseme set: [open, width, pucker, press(lips shut), teeth, tongue]
  const VIS = {
    rest: [0, 1, 0, 0, 0, 0], A: [.95, 1.05, 0, 0, .5, .3], E: [.62, 1.3, 0, 0, .9, .1], I: [.42, 1.38, 0, 0, .9, .05],
    O: [.85, .74, .55, 0, 0, 0], U: [.55, .66, 1, 0, 0, 0], MBP: [.02, .95, 0, 1, 0, 0], FV: [.2, 1.05, 0, 0, 1, 0],
    L: [.4, 1.1, 0, 0, .7, 1], TH: [.25, 1.1, 0, 0, .9, .9], SH: [.32, .75, .7, 0, .5, 0], SZ: [.15, 1.3, 0, 0, 1, 0], KG: [.45, 1, 0, 0, .3, .2]
  };
  const LET = { a: 'A', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I', m: 'MBP', b: 'MBP', p: 'MBP', f: 'FV', v: 'FV', l: 'L', t: 'L', d: 'L', n: 'L', r: 'U', w: 'U', q: 'U', s: 'SZ', z: 'SZ', c: 'KG', k: 'KG', g: 'KG', j: 'SH', x: 'SZ', h: 'A' };
  function wordVisemes(w) {
    w = w.toLowerCase().replace(/[^a-z]/g, ''); const out = [];
    for (let i = 0; i < w.length; i++) {
      const d = w.slice(i, i + 2); let v;
      if (d === 'th') { v = 'TH'; i++; } else if (d === 'sh' || d === 'ch') { v = 'SH'; i++; }
      else if (d === 'oo') { v = 'U'; i++; } else if (d === 'ee') { v = 'I'; i++; } else if (d === 'ph') { v = 'FV'; i++; } else v = LET[w[i]];
      if (v && out[out.length - 1] !== v) out.push(v);
    }
    return out;
  }

  const high0 = (t) => .5 + .5 * Math.sin(t * 3.1);
  class NexoraVoiceSync {
    constructor(opts) {
      this.o = Object.assign({ gain: 3.2, gate: .02, attack: 22, release: 9, fft: 1024 }, opts || {});
      this.open = 0; this.width = 1; this.level = 0; this.peak = 0; this.low = 0; this.mid = 0; this.high = 0;
      this.wave = new Float32Array(256); this.speaking = false; this.role = 'none'; this.source = 'none';
      this._ac = null; this._an = null; this._td = null; this._fd = null; this._node = null;
      this._floor = .01; this._sim = false; this._seg = []; this._segT0 = 0; this._lastB = -9; this._tNow = 0;
      this._els = new WeakMap(); this._lvlPrev = 0;
      this.viseme = 'rest'; this.vis = { open: 0, pucker: 0, press: 0, teeth: 0, tongue: 0 };
    }
    _audio() {
      if (!this._ac) { const AC = window.AudioContext || window.webkitAudioContext; this._ac = new AC(); }
      if (this._ac.state === 'suspended') this._ac.resume();
      if (!this._an) {
        this._an = this._ac.createAnalyser(); this._an.fftSize = this.o.fft; this._an.smoothingTimeConstant = .5;
        this._td = new Uint8Array(this._an.fftSize); this._fd = new Uint8Array(this._an.frequencyBinCount);
      }
      return this._ac;
    }
    _detach() { if (this._node) { try { this._node.disconnect(this._an); } catch (e) { } this._node = null; } if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; } }
    /** play AI voice through an <audio>/<video> element and sync to it (element keeps playing normally) */
    useElement(el) {
      const ac = this._audio(); this._detach(); this.stopText();
      let src = this._els.get(el);
      if (!src) { src = ac.createMediaElementSource(el); src.connect(ac.destination); this._els.set(el, src); }
      src.connect(this._an); this._node = src; this.role = 'output'; this.source = 'element'; this._sim = false;
      return this;
    }
    useStream(stream) {
      const ac = this._audio(); this._detach(); this.stopText();
      const src = ac.createMediaStreamSource(stream); src.connect(this._an); this._node = src;
      this.role = 'output'; this.source = 'stream'; this._sim = false; return this;
    }
    /** microphone: drives level / wave / glow only; mouth stays closed because the robot is listening */
    async useMic() {
      const ac = this._audio(); this._detach(); this.stopText();
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this._stream = st; const src = ac.createMediaStreamSource(st); src.connect(this._an); this._node = src;
      this.role = 'input'; this.source = 'mic'; this._sim = false; return this;
    }
    /** audio file: plays it and syncs the mouth. returns the <audio> element */
    useFile(file) {
      const el = new Audio(URL.createObjectURL(file)); el.crossOrigin = 'anonymous';
      this.useElement(el); this.audioEl = el; el.play();
      return el;
    }
    /** v4: feed an externally measured output loudness (0..1), e.g. the app's own voice playback level. Use feed(null) to release. */
    feed(level) { if (level == null) { this._ext = null; if (this.source === 'external') { this.source = 'none'; this.role = 'none'; this.speaking = false; } return this; } this._ext = clamp(level); this.role = 'output'; this.source = 'external'; return this; }
    simulate(on) { this._sim = !!on; if (on) { this.role = 'output'; this.source = 'simulated'; } else if (this.source === 'simulated') { this.source = 'none'; this.role = 'none'; this.speaking = false; } return this; }
    /** browser TTS with word-timed mouth shapes. Returns a promise that resolves when speech ends. */
    speakText(text, o) {
      o = o || {};
      return new Promise(res => {
        if (!('speechSynthesis' in window)) { this.simulate(true); setTimeout(() => { this.simulate(false); res(); }, Math.max(1200, text.length * 65)); return; }
        this._detach(); speechSynthesis.cancel(); this.role = 'output'; this.source = 'tts'; this._sim = false;
        const u = new SpeechSynthesisUtterance(text); u.rate = o.rate || 1; u.pitch = o.pitch || 1; if (o.voice) u.voice = o.voice;
        const done = () => { this.speaking = false; this._seg = []; this._ttsOn = false; this.source = 'none'; this.role = 'none'; if (o.onend) o.onend(); res(); };
        u.onstart = () => { this._ttsOn = true; this.speaking = true; this._lastB = this._tNow; if (o.onstart) o.onstart(); };
        u.onend = u.onerror = done;
        u.onboundary = ev => {
          if (ev.name && ev.name !== 'word') return;
          const m = /^[\w'’-]+/.exec(text.slice(ev.charIndex)); if (!m) return;
          this._queueWord(m[0], (u.rate || 1)); this._lastB = this._tNow;
        };
        this._ttsFallbackFrom = this._tNow;
        speechSynthesis.speak(u);
      });
    }
    stopText() { if ('speechSynthesis' in window) speechSynthesis.cancel(); this._ttsOn = false; this._seg = []; }
    stop() { this.stopText(); this._detach(); if (this.audioEl) { this.audioEl.pause(); this.audioEl = null; } this._sim = false; this._ext = null; this.role = 'none'; this.source = 'none'; this.speaking = false; }
    // word -> per-vowel mouth segments, timed from "now"
    _queueWord(w, rate) {
      const seq = wordVisemes(w); if (!seq.length) return;
      const dur = clamp(seq.length * .085 / rate + .05, .12, 1.0), seg = dur / seq.length, base = this._tNow; this._seg = [];
      seq.forEach((k, i) => { const v = VIS[k]; this._seg.push({ a: base + i * seg, b: base + (i + 1) * seg, k, open: v[0], width: v[1], pu: v[2], pr: v[3], te: v[4], to: v[5] }); });
      this._segEnd = base + dur;
    }
    _fromAnalyser() {
      const an = this._an; if (!an) return null;
      an.getByteTimeDomainData(this._td); an.getByteFrequencyData(this._fd);
      let s = 0; const n = this._td.length;
      for (let i = 0; i < n; i++) { const v = (this._td[i] - 128) / 128; s += v * v; if (i < this.wave.length) this.wave[i] = v; }
      const rms = Math.sqrt(s / n), hz = this._ac.sampleRate / an.fftSize, f = this._fd;
      const band = (a, b) => { let t = 0, c = 0; for (let i = Math.max(1, Math.floor(a / hz)); i < Math.min(f.length, Math.ceil(b / hz)); i++) { t += f[i]; c++; } return c ? t / c / 255 : 0; };
      return { rms, low: band(80, 500), mid: band(500, 2000), high: band(2000, 6000) };
    }
    /** call every frame */
    update(dt, t) {
      this._tNow = t; dt = clamp(dt, 0, .1);
      let tOpen = 0, tWidth = 1, tLevel = 0, low = 0, mid = 0, high = 0, spk = false, tPu = 0, tPr = 0, tTe = 0, tTo = 0, vk = 'rest';
      if (this._ttsOn) {
        spk = true; const now = t;
        if (this._seg.length) {
          let seg = null; for (const s of this._seg) if (now >= s.a && now < s.b) { seg = s; break; }
          if (seg) { const ph = (now - seg.a) / (seg.b - seg.a); const env = Math.sin(Math.PI * clamp(ph)) ** .5; tOpen = seg.open * (.3 + .7 * env); tWidth = seg.width; tPu = seg.pu; tPr = seg.pr; tTe = seg.te; tTo = seg.to; vk = seg.k; if (seg.pr > .5) tOpen = seg.open; }
        }
        // no boundary events on this voice (some platforms) -> synthetic syllable envelope
        if (now - this._lastB > .55) { tOpen = .15 + .6 * Math.abs(Math.sin(t * 11)) * (.5 + .5 * Math.sin(t * 4.7)); tWidth = 1 + .18 * Math.sin(t * 6); }
        tLevel = tOpen * .9; low = tOpen * .6; mid = tOpen * .5; high = (tWidth - .7) * .4;
        for (let i = 0; i < this.wave.length; i++) this.wave[i] = Math.sin(i * .35 + t * 30) * tOpen * .6;
      } else if (this._ext != null) {
        // externally measured loudness drives how far the (synthetic) syllable envelope opens the mouth
        const lv = this._ext, env = .25 + .75 * Math.abs(Math.sin(t * 11)) * (.55 + .45 * Math.sin(t * 4.7));
        spk = lv > .015; tOpen = clamp(lv * 2.4) * env * 1.25; tWidth = 1 + .22 * Math.sin(t * 6) + (high0(t) - .5) * .1;
        tLevel = clamp(lv * 1.6); low = tOpen * .6; mid = tOpen * .5; high = .25 * Math.abs(Math.sin(t * 8));
        if (spk) { const vv = ['A', 'E', 'O', 'I', 'U', 'A', 'MBP', 'L'][Math.floor(t * 9) % 8], V = VIS[vv]; tPu = V[2] * .8; tPr = V[3] * (tOpen < .12 ? 1 : 0); tTe = V[4]; tTo = V[5]; vk = vv; }
        for (let i = 0; i < this.wave.length; i++) this.wave[i] = Math.sin(i * .35 + t * 30) * tOpen * .6;
      } else if (this._sim) {
        spk = true; tOpen = .15 + .6 * Math.abs(Math.sin(t * 11)) * (.5 + .5 * Math.sin(t * 4.7)); tWidth = 1 + .2 * Math.sin(t * 6);
        tLevel = tOpen * .9; low = tOpen * .6; mid = tOpen * .5; high = .25 * Math.abs(Math.sin(t * 8));
        for (let i = 0; i < this.wave.length; i++) this.wave[i] = Math.sin(i * .35 + t * 30) * tOpen * .6;
      } else if (this._node) {
        const a = this._fromAnalyser();
        if (a) {
          this._floor = Math.min(this._floor * 1.0005 + 1e-5, Math.max(.004, a.rms)) * .999 + .00002;   // slow noise floor
          const sig = Math.max(0, a.rms - Math.max(this.o.gate, this._floor * 1.6));
          tLevel = clamp(sig * this.o.gain * 2.2); low = a.low; mid = a.mid; high = a.high;
          if (this.role === 'output') {
            spk = tLevel > .03; tOpen = clamp(sig * this.o.gain * 3.2);
            const tot = a.low + a.mid + a.high + 1e-4; tWidth = clamp(.72 + (a.high * 1.4 + a.mid * .5) / tot * .75, .7, 1.4);
            tPu = clamp((1 - tWidth) * 2.2); tTe = clamp((a.high * 2.2)); tTo = clamp(a.mid * .5 * (1 - tOpen)); vk = tOpen < .08 ? 'rest' : tWidth > 1.15 ? 'E' : tWidth < .85 ? 'O' : 'A';
            if (tOpen < .06 && tLevel > .02) { tPr = .6; vk = 'MBP'; }
          }
        }
      }
      const k = v => 1 - Math.exp(-v * dt);
      const vs = this.vis, kv = k(spk ? 28 : 12);
      vs.pucker += (tPu - vs.pucker) * kv; vs.press += (tPr - vs.press) * kv; vs.teeth += (tTe - vs.teeth) * kv; vs.tongue += (tTo - vs.tongue) * kv; vs.open = this.open;
      this.viseme = spk ? vk : 'rest';
      const up = tOpen > this.open;
      this.open += (tOpen - this.open) * k(up ? this.o.attack : this.o.release);
      this.width += (tWidth - this.width) * k(14);
      const upL = tLevel > this.level;
      this.level += (tLevel - this.level) * k(upL ? 24 : 7);
      this.low += (low - this.low) * k(16); this.mid += (mid - this.mid) * k(16); this.high += (high - this.high) * k(16);
      this.peak = Math.max(0, Math.min(1, (this.level - this._lvlPrev) * 18)) * .6 + this.peak * Math.exp(-dt * 10); this._lvlPrev = this.level;
      this.speaking = spk && this.role === 'output';
      return this;
    }
  }
  NexoraVoiceSync.VISEMES = VIS; NexoraVoiceSync.wordVisemes = wordVisemes;
  NexoraVoiceSync.default = NexoraVoiceSync;
  return NexoraVoiceSync;
});
