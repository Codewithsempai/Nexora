/* NEXORA audio bridge: captures mono microphone PCM at 16 kHz and plays Live PCM output. */
export class VoiceAudio {
  constructor() {
    this.context = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.sources = new Set();
    this.nextPlayTime = 0;
    this.captureActive = false;
    this.onLevel = null;
    this.onHealth = null;          // v0.3.11: (message) => void, tells the UI when the mic had to be recovered
    this.wantCapture = false;      // the user asked for listening; the watchdog keeps it alive
    this.lastFrameAt = 0;
    this.watchdog = null;
    this.restarting = false;
    this.restartFailures = 0;
    this.onDeviceChange = () => { if (this.wantCapture) void this.recover('microphone devices changed'); };
  }

  /** v0.3.11 "not listening" fix: a mic that was unplugged, a suspended AudioContext (sleep / lock screen) or a stalled
   *  audio graph used to leave NEXORA silently deaf. This watchdog notices and restarts capture by itself. */
  startWatchdog() {
    this.stopWatchdog();
    this.lastFrameAt = Date.now();
    this.watchdog = setInterval(() => {
      if (!this.wantCapture || this.restarting) return;
      const track = this.stream?.getAudioTracks?.()[0];
      if (this.context && this.context.state === 'suspended') { void this.context.resume().catch(() => {}); }
      if (!this.captureActive) { void this.recover('capture was not running'); return; }
      if (track && track.readyState === 'ended') { void this.recover('microphone was disconnected'); return; }
      if (Date.now() - this.lastFrameAt > 4000) void this.recover('no audio from the microphone for 4 s');
    }, 2000);
    try { navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange); } catch { /* ignore */ }
  }

  stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    try { navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange); } catch { /* ignore */ }
  }

  async recover(reason) {
    if (this.restarting || !this.wantCapture) return;
    this.restarting = true;
    try {
      this.stopCapture({ keepWanted: true });
      await new Promise((resolve) => setTimeout(resolve, Math.min(300 * 2 ** this.restartFailures, 5000)));
      if (!this.wantCapture) return;
      const result = await this.startCapture({ fromWatchdog: true });
      if (result.success) { this.restartFailures = 0; this.onHealth?.(`Microphone recovered (${reason}).`, true); }
      else { this.restartFailures = Math.min(this.restartFailures + 1, 5); this.onHealth?.(`Microphone problem: ${result.error}`, false); }
    } finally { this.restarting = false; }
  }

  async ensureContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is unavailable in this environment.');
    if (!this.context || this.context.state === 'closed') this.context = new AudioContextCtor();
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  async startCapture({ fromWatchdog = false } = {}) {
    if (!fromWatchdog) this.wantCapture = true;
    if (this.captureActive) return { success: true, alreadyActive: true };
    if (!navigator.mediaDevices?.getUserMedia) return { success: false, error: 'Microphone capture is unavailable. Check the app permission and secure media access.' };
    try {
      const context = await this.ensureContext();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.source = context.createMediaStreamSource(this.stream);
      this.processor = context.createScriptProcessor(2048, 1, 1);
      this.silentGain = context.createGain();
      this.silentGain.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        if (!this.captureActive) return;
        this.lastFrameAt = Date.now();
        const channel = event.inputBuffer.getChannelData(0);
        if (this.onLevel) { let s = 0; for (let i = 0; i < channel.length; i += 4) s += channel[i] * channel[i]; this.onLevel('mic', Math.sqrt(s / Math.ceil(channel.length / 4))); }
        const pcm = this.resampleTo16k(channel, context.sampleRate);
        if (pcm.length) window.nexoraAPI?.voice?.pushPcm?.(this.toBase64(pcm));
      };
      this.source.connect(this.processor);
      this.processor.connect(this.silentGain);
      this.silentGain.connect(context.destination);
      const track = this.stream.getAudioTracks()[0];
      if (track) track.onended = () => { if (this.wantCapture && !this.restarting) void this.recover('microphone track ended'); };
      context.onstatechange = () => { if (context.state === 'suspended' && this.wantCapture) void context.resume().catch(() => {}); };
      this.captureActive = true;
      this.lastFrameAt = Date.now();
      if (!this.watchdog) this.startWatchdog();
      return { success: true };
    } catch (error) {
      this.stopCapture({ keepWanted: fromWatchdog });
      const message = error?.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow microphone access for NEXORA in Windows settings.'
        : (error?.message || 'Unable to start microphone capture.');
      return { success: false, error: message };
    }
  }

  resampleTo16k(input, inputRate) {
    const ratio = inputRate / 16000;
    const length = Math.floor(input.length / ratio);
    const output = new Uint8Array(length * 2);
    const view = new DataView(output.buffer);
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0; let count = 0;
      for (let j = start; j < end; j++) { sum += input[j]; count++; }
      const sample = Math.max(-1, Math.min(1, count ? sum / count : input[start] || 0));
      view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return output;
  }

  toBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  async playPcm(payload) {
    try {
      const context = await this.ensureContext();
      const raw = atob(payload.data);
      const samples = Math.floor(raw.length / 2);
      if (!samples) return;
      const buffer = context.createBuffer(1, samples, Number(payload.sampleRate) || 24000);
      const channel = buffer.getChannelData(0);
      const view = new DataView(new ArrayBuffer(raw.length));
      for (let i = 0; i < raw.length; i++) view.setUint8(i, raw.charCodeAt(i));
      let energy = 0;
      for (let i = 0; i < samples; i++) { channel[i] = view.getInt16(i * 2, true) / 32768; if (i % 4 === 0) energy += channel[i] * channel[i]; }
      this.onLevel?.('out', Math.sqrt(energy / Math.ceil(samples / 4)));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const now = context.currentTime;
      const startAt = Math.max(now + 0.025, this.nextPlayTime);
      this.nextPlayTime = startAt + buffer.duration;
      this.sources.add(source);
      source.onended = () => { this.sources.delete(source); try { source.disconnect(); } catch {} };
      source.start(startAt);
    } catch (error) {
      console.warn('[NEXORA Voice] Unable to play Live audio chunk:', error?.message || error);
    }
  }

  stopPlayback() {
    for (const source of this.sources) { try { source.stop(); } catch {} try { source.disconnect(); } catch {} }
    this.sources.clear();
    this.nextPlayTime = this.context?.currentTime || 0;
  }

  stopCapture({ keepWanted = false } = {}) {
    if (!keepWanted) { this.wantCapture = false; this.stopWatchdog(); }
    this.captureActive = false;
    if (this.processor) { this.processor.onaudioprocess = null; try { this.processor.disconnect(); } catch {} }
    if (this.source) { try { this.source.disconnect(); } catch {} }
    if (this.silentGain) { try { this.silentGain.disconnect(); } catch {} }
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.processor = null; this.source = null; this.silentGain = null; this.stream = null;
  }

  destroy() {
    this.stopCapture(); this.stopPlayback();
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = null;
  }
}
