/* ==========================================================================
   NEXORA — wake-word service (v0.3.25)
   Owns the offline ONNX wake detector. Normally runs in a worker thread; if a worker cannot be started it falls
   back to running the same engine inside the main process, so wake standby never depends on a network call.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { OnnxWakeEngine, loadModelFiles } = require('./wakeword-onnx');

function resolveUnpackedPath(targetPath) {
  const normalized = String(targetPath || '');
  if (!normalized.includes('app.asar')) return normalized;
  const unpacked = normalized.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
  return fs.existsSync(unpacked) ? unpacked : normalized;
}

const DEFAULT_DIR = resolveUnpackedPath(path.join(__dirname, '..', '..', '..', 'assets', 'wakeword'));

class WakeWordService {
  /** @param {{dir?: string, threshold?: number, onWake: (hit: {name: string, word: string, score: number}) => void, onError?: (message: string) => void}} o */
  constructor({ dir = DEFAULT_DIR, threshold = 0.6, onWake, onError }) {
    this.dir = dir; this.threshold = threshold; this.onWake = onWake; this.onError = onError;
    this.worker = null; this.engine = null; this.ready = false; this.words = []; this.stopped = true;
  }

  /** Resolves with the list of wake phrases once the models are loaded, rejects with a readable error otherwise. */
  start() {
    this.stopped = false;
    if (this.ready) return Promise.resolve(this.words);
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message) => { if (settled) return; settled = true; this.cleanup(); reject(new Error(message)); };
      const ok = (words) => { if (settled) return; settled = true; this.ready = true; this.words = words; resolve(words); };
      try {
        const workerFile = resolveUnpackedPath(path.join(__dirname, 'wakeword-worker.js'));
        this.worker = new Worker(workerFile, { workerData: { dir: resolveUnpackedPath(this.dir), threshold: this.threshold } });
      } catch (error) { this.startInProcess(ok, fail, error); return; }
      this.worker.on('message', (msg) => {
        if (msg.type === 'ready') ok(msg.words);
        else if (msg.type === 'wake') { if (!this.stopped) this.onWake?.(msg); }
        else if (msg.type === 'error') { if (!settled) fail(msg.error); else this.onError?.(msg.error); }
      });
      this.worker.on('error', (error) => { if (!settled) this.startInProcess(ok, fail, error); else { this.ready = false; this.onError?.(`Wake-word worker stopped: ${error?.message || error}`); } });
      this.worker.on('exit', (code) => { if (code !== 0 && !this.stopped && this.ready) { this.ready = false; this.onError?.(`Wake-word worker exited (code ${code}).`); } });
    });
  }

  startInProcess(ok, fail, cause) {
    try {
      this.cleanup();
      this.engine = new OnnxWakeEngine(loadModelFiles(this.dir), { threshold: this.threshold });
      console.warn('[NEXORA Wake] worker unavailable, running the ONNX detector in-process:', cause?.message || cause);
      ok(this.engine.heads.map((h) => h.word));
    } catch (error) { fail(String(error?.message || error)); }
  }

  /** @param {Buffer} pcm 16 kHz mono int16 */
  feed(pcm) {
    if (!this.ready || this.stopped) return;
    if (this.worker) { const copy = new Uint8Array(pcm.length); copy.set(pcm); this.worker.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer]); return; }
    if (this.engine) for (const hit of this.engine.feed(pcm)) this.onWake?.(hit);
  }

  reset() { if (this.worker) this.worker.postMessage({ type: 'reset' }); else this.engine?.reset(); }
  setThreshold(value) { this.threshold = value; if (this.worker) this.worker.postMessage({ type: 'threshold', value }); else this.engine?.setThreshold(value); }

  cleanup() { if (this.worker) { try { this.worker.removeAllListeners(); void this.worker.terminate(); } catch { /* ignore */ } this.worker = null; } }
  stop() { this.stopped = true; this.ready = false; this.cleanup(); this.engine = null; }
}

module.exports = { WakeWordService, DEFAULT_DIR };
