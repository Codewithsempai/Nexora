/* ==========================================================================
   NEXORA — Voice Audio Bridge
   Microphone capture and assistant voice playback are strictly decoupled:
   - Capture uses MediaStreamTrackProcessor when available (no AudioContext and
     no silent connection to speaker output) or an isolated capture sink.
   - Playback uses the shared PlaybackBus with independent Gemini voice volume,
     gain smoothing, and soft peak limiting.
   ========================================================================== */

import { getSharedPlaybackBus, clamp01 } from './playback-bus.js';

export class VoiceAudio {
  constructor(options = {}) {
    this.playbackBus = options.playbackBus || getSharedPlaybackBus();
    this.context = null; // playback AudioContext (alias kept for diagnostic inspection)
    this.voiceGainNode = null;
    this.voiceVolume = clamp01(options.voiceOutputVolume ?? 0.75, 0.75);

    this.captureContext = null; // only used if MediaStreamTrackProcessor fallback is needed
    this.captureReader = null;
    this.captureMode = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.captureSink = null;

    this.sources = new Set();
    this.nextPlayTime = 0;
    this.captureActive = false;
    this.startPromise = null;
    this.onLevel = null;
    this.onHealth = null;
    this.onPcm = options.onPcm || null;
    this.forwardToMain = true;

    this.wantCapture = false;
    this.lastFrameAt = 0;
    this.watchdog = null;
    this.restarting = false;
    this.restartFailures = 0;

    this.micDeviceId = options.micDeviceId || 'default';
    this.echoCancellation = options.echoCancellation === true;
    this.noiseSuppression = options.noiseSuppression !== false;
    this.autoGainControl = options.autoGainControl === true;

    this.onDeviceChange = () => { if (this.wantCapture) void this.recover('microphone devices changed'); };
  }

  setVoiceOutputVolume(val) {
    this.voiceVolume = clamp01(val, this.voiceVolume);
    if (this.voiceGainNode && this.context) {
      const now = this.context.currentTime || 0;
      if (typeof this.voiceGainNode.gain.setTargetAtTime === 'function') {
        this.voiceGainNode.gain.setTargetAtTime(this.voiceVolume, now, 0.03);
      } else {
        this.voiceGainNode.gain.value = this.voiceVolume;
      }
    }
  }

  setOutputProfile(profile) {
    return this.playbackBus.setOutputProfile(profile);
  }

  setCaptureOptions({ deviceId, echoCancellation, noiseSuppression, autoGainControl } = {}) {
    if (typeof deviceId === 'string' && deviceId.trim()) this.micDeviceId = deviceId.trim();
    if (typeof echoCancellation === 'boolean') this.echoCancellation = echoCancellation;
    if (typeof noiseSuppression === 'boolean') this.noiseSuppression = noiseSuppression;
    if (typeof autoGainControl === 'boolean') this.autoGainControl = autoGainControl;
  }

  applyConfig(audioCfg = {}) {
    if (!audioCfg || typeof audioCfg !== 'object') return;
    if (audioCfg.voiceOutputVolume != null) this.setVoiceOutputVolume(audioCfg.voiceOutputVolume);
    if (audioCfg.outputProfile) this.setOutputProfile(audioCfg.outputProfile);
    this.setCaptureOptions({
      deviceId: audioCfg.micDeviceId,
      echoCancellation: audioCfg.echoCancellation,
      noiseSuppression: audioCfg.noiseSuppression,
      autoGainControl: audioCfg.autoGainControl,
    });
  }

  async listInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${idx + 1}`,
        groupId: d.groupId || '',
        isBluetoothHeadset: /headset|hands-free|hfp|bluetooth/i.test(d.label || ''),
      }));
  }

  startWatchdog() {
    this.stopWatchdog();
    this.lastFrameAt = Date.now();
    this.watchdog = setInterval(() => {
      if (!this.wantCapture || this.restarting || this.startPromise) return;
      const track = this.stream?.getAudioTracks?.()[0];
      if (this.captureContext && this.captureContext.state === 'suspended') {
        void this.captureContext.resume().catch(() => {});
      }
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
    return this.ensurePlaybackContext();
  }

  async ensurePlaybackContext() {
    const context = this.playbackBus.ensureContext();
    if (!context) throw new Error('Web Audio is unavailable in this environment.');
    if (this.context !== context || !this.voiceGainNode) {
      this.context = context;
      this.voiceGainNode = context.createGain();
      const now = context.currentTime || 0;
      if (typeof this.voiceGainNode.gain.setValueAtTime === 'function') {
        this.voiceGainNode.gain.setValueAtTime(this.voiceVolume, now);
      } else {
        this.voiceGainNode.gain.value = this.voiceVolume;
      }
      const dest = this.playbackBus.getDestinationNode() || context.destination;
      this.voiceGainNode.connect(dest);
    }
    return context;
  }

  buildConstraints(useSelectedDevice = true) {
    const audio = {
      channelCount: 1,
      echoCancellation: this.echoCancellation,
      noiseSuppression: this.noiseSuppression,
      autoGainControl: this.autoGainControl,
    };
    if (useSelectedDevice && this.micDeviceId && this.micDeviceId !== 'default') {
      audio.deviceId = { ideal: this.micDeviceId };
    }
    return { audio, video: false };
  }

  emitCapturedSamples(channel, sampleRate) {
    if (!this.captureActive || !channel?.length) return;
    this.lastFrameAt = Date.now();
    if (this.onLevel) {
      let s = 0;
      const step = Math.max(1, Math.min(4, channel.length));
      let count = 0;
      for (let i = 0; i < channel.length; i += step) { s += channel[i] * channel[i]; count++; }
      this.onLevel('mic', Math.sqrt(s / Math.max(1, count)));
    }
    const pcm = this.resampleTo16k(channel, sampleRate);
    if (pcm.length) {
      const b64 = this.toBase64(pcm);
      this.onPcm?.(b64, pcm);
      if (this.forwardToMain) globalThis.window?.nexoraAPI?.voice?.pushPcm?.(b64);
    }
  }

  async startTrackProcessorCapture(track) {
    const processor = new globalThis.MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    this.captureReader = reader;
    this.captureMode = 'track-processor';
    let monoScratch = null;

    const pump = async () => {
      try {
        while (this.captureActive && this.captureReader === reader) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          try {
            const frames = frame.numberOfFrames || 0;
            const channels = frame.numberOfChannels || 1;
            const rate = frame.sampleRate || 16000;
            if (frames > 0) {
              if (!monoScratch || monoScratch.length !== frames) monoScratch = new Float32Array(frames);
              const fmt = String(frame.format || '');
              try {
                if (fmt.endsWith('-planar')) {
                  frame.copyTo(monoScratch, { planeIndex: 0, format: 'f32-planar' });
                } else {
                  const temp = new Float32Array(frames * channels);
                  frame.copyTo(temp, { planeIndex: 0, format: 'f32' });
                  for (let i = 0; i < frames; i++) monoScratch[i] = temp[i * channels];
                }
                this.emitCapturedSamples(monoScratch, rate);
              } catch {
                // Fallback direct f32-planar copy across channel 0 if browser supports conversion
                try {
                  frame.copyTo(monoScratch, { planeIndex: 0, format: 'f32-planar' });
                  this.emitCapturedSamples(monoScratch, rate);
                } catch {}
              }
            }
          } finally {
            frame.close();
          }
        }
      } catch (err) {
        if (this.captureActive && this.wantCapture && !this.restarting) {
          void this.recover(err?.message || 'microphone stream interrupted');
        }
      }
    };
    void pump();
  }

  async startFallbackNodeCapture(stream) {
    const AudioContextCtor = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is unavailable in this environment.');
    if (!this.captureContext || this.captureContext.state === 'closed') {
      this.captureContext = new AudioContextCtor({ latencyHint: 'interactive' });
    }
    if (this.captureContext.state === 'suspended') await this.captureContext.resume();

    const context = this.captureContext;
    this.source = context.createMediaStreamSource(stream);
    this.processor = context.createScriptProcessor(2048, 1, 1);
    this.captureMode = 'isolated-node';
    // Route into a MediaStreamAudioDestinationNode (never context.destination / speakers).
    this.captureSink = typeof context.createMediaStreamDestination === 'function'
      ? context.createMediaStreamDestination()
      : context.createGain();
    if (this.captureSink.gain) this.captureSink.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (!this.captureActive) return;
      this.emitCapturedSamples(event.inputBuffer.getChannelData(0), context.sampleRate);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.captureSink);
  }

  async startCapture({ fromWatchdog = false, forwardToMain = true } = {}) {
    if (!fromWatchdog) this.wantCapture = true;
    this.forwardToMain = forwardToMain;
    if (this.captureActive && this.stream) return { success: true, alreadyActive: true };
    if (this.startPromise) return this.startPromise;
    if (!navigator.mediaDevices?.getUserMedia) {
      return { success: false, error: 'Microphone capture is unavailable. Check the app permission and secure media access.' };
    }

    this.startPromise = (async () => {
      try {
        // Ensure no duplicate streams remain open
        if (this.stream) this.stopCapture({ keepWanted: true });

        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(this.buildConstraints(true));
        } catch (err) {
          if (this.micDeviceId && this.micDeviceId !== 'default' && ['OverconstrainedError', 'NotFoundError'].includes(err?.name)) {
            stream = await navigator.mediaDevices.getUserMedia(this.buildConstraints(false));
          } else {
            throw err;
          }
        }

        if (!this.wantCapture && !fromWatchdog) {
          stream.getTracks().forEach((t) => t.stop());
          return { success: false, error: 'Microphone capture cancelled.' };
        }

        this.stream = stream;
        const track = this.stream.getAudioTracks()[0];
        if (!track) throw new Error('No audio track returned by microphone.');
        track.onended = () => { if (this.wantCapture && !this.restarting) void this.recover('microphone track ended'); };

        this.captureActive = true;
        this.lastFrameAt = Date.now();

        if (typeof globalThis.MediaStreamTrackProcessor === 'function') {
          await this.startTrackProcessorCapture(track);
        } else {
          await this.startFallbackNodeCapture(stream);
        }

        if (!this.watchdog) this.startWatchdog();
        return {
          success: true,
          mode: this.captureMode,
          deviceLabel: track.label || 'Default Microphone',
        };
      } catch (error) {
        this.stopCapture({ keepWanted: fromWatchdog });
        const message = error?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access for NEXORA in Windows settings.'
          : error?.name === 'NotFoundError'
            ? 'No microphone was found on this PC. Connect a microphone and try again.'
            : (error?.message || 'Unable to start microphone capture.');
        return { success: false, error: message };
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  resampleTo16k(input, inputRate) {
    const ratio = inputRate / 16000;
    const length = Math.floor(input.length / ratio);
    if (length <= 0) return new Uint8Array(0);
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
      const context = await this.ensurePlaybackContext();
      const raw = atob(payload.data);
      const samples = Math.floor(raw.length / 2);
      if (!samples) return;
      const buffer = context.createBuffer(1, samples, Number(payload.sampleRate) || 24000);
      const channel = buffer.getChannelData(0);
      const view = new DataView(new ArrayBuffer(raw.length));
      for (let i = 0; i < raw.length; i++) view.setUint8(i, raw.charCodeAt(i));
      let energy = 0;
      for (let i = 0; i < samples; i++) {
        // Clamp decoded PCM samples softly within [-0.98, 0.98] to prevent digital clipping
        const sample = Math.max(-0.98, Math.min(0.98, view.getInt16(i * 2, true) / 32768));
        channel[i] = sample;
        if (i % 4 === 0) energy += sample * sample;
      }
      this.onLevel?.('out', Math.sqrt(energy / Math.ceil(samples / 4)));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.voiceGainNode || this.playbackBus.getDestinationNode() || context.destination);
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
    if (!keepWanted) { this.wantCapture = false; this.stopWatchdog(); this.onPcm = null; this.forwardToMain = true; }
    this.captureActive = false;
    this.captureMode = null;
    if (this.captureReader) {
      const r = this.captureReader;
      this.captureReader = null;
      try { void r.cancel().catch(() => {}); } catch {}
    }
    if (this.processor) { this.processor.onaudioprocess = null; try { this.processor.disconnect(); } catch {} }
    if (this.source) { try { this.source.disconnect(); } catch {} }
    if (this.captureSink) { try { this.captureSink.disconnect?.(); } catch {} }
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.processor = null; this.source = null; this.captureSink = null; this.stream = null;
  }

  destroy() {
    this.stopCapture();
    this.stopPlayback();
    try { this.voiceGainNode?.disconnect?.(); } catch {}
    if (this.captureContext && this.captureContext.state !== 'closed') {
      void this.captureContext.close?.().catch(() => {});
    }
    this.captureContext = null;
    this.voiceGainNode = null;
  }
}
