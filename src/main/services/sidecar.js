/* ==========================================================================
   NEXORA — Rust Native Core Sidecar Manager
   Spawns, monitors, and interfaces with the native Rust binary via stdio JSON-RPC.
   ========================================================================== */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class SidecarManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.status = 'offline'; // 'offline' | 'starting' | 'online' | 'error'
    this.pid = null;
    this.startTime = null;
    this.pendingRequests = new Map();
    this.requestId = 1;
    this.metrics = {
      cpuUsage: 0,
      memoryBytes: 0,
      lastHeartbeat: null,
      latencyMs: 0,
    };
  }

  resolveBinaryPath() {
    const exeName = process.platform === 'win32' ? 'nexora-core.exe' : 'nexora-core';
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, 'native', exeName),
        path.join(process.resourcesPath, exeName),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'rust', 'target', 'release', exeName),
      );
    }
    // Check native/rust build outputs in development
    candidates.push(
      path.join(__dirname, '../../../native/rust/target/release/nexora-core.exe'),
      path.join(__dirname, '../../../native/rust/target/debug/nexora-core.exe'),
      path.join(__dirname, '../../../native/rust/target/release/nexora-core'),
      path.join(__dirname, '../../../native/rust/target/debug/nexora-core'),
      path.join(__dirname, '../../../target/release/nexora.exe'),
      path.join(__dirname, '../../../target/debug/nexora.exe'),
    );

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  start() {
    const binPath = this.resolveBinaryPath();
    if (!binPath) {
      this.status = 'offline';
      console.log('[NEXORA Sidecar] Native binary not yet built. Running in simulated fallback mode.');
      return;
    }

    try {
      this.status = 'starting';
      this.process = spawn(binPath, ['--sidecar'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.pid = this.process.pid;
      this.startTime = Date.now();
      this.status = 'online';
      console.log(`[NEXORA Sidecar] Spawned native core (PID: ${this.pid}) at ${binPath}`);

      this.process.stdout.on('data', (data) => {
        this.handleStdout(data);
      });

      this.process.stderr.on('data', (data) => {
        console.warn(`[NEXORA Sidecar Stderr] ${data.toString().trim()}`);
      });

      this.process.on('close', (code) => {
        console.log(`[NEXORA Sidecar] Native core exited with code ${code}`);
        this.status = 'offline';
        this.process = null;
        this.pid = null;
        this.emit('status-change', this.getStatus());
      });

      this.process.on('error', (err) => {
        console.error('[NEXORA Sidecar] Process error:', err.message);
        this.status = 'error';
        this.emit('status-change', this.getStatus());
      });

      this.startHeartbeat();
    } catch (err) {
      console.error('[NEXORA Sidecar] Failed to spawn sidecar:', err.message);
      this.status = 'error';
    }
  }

  handleStdout(data) {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const { resolve, timer, start } = this.pendingRequests.get(msg.id);
          clearTimeout(timer);
          this.pendingRequests.delete(msg.id);
          this.metrics.latencyMs = Math.round(performance.now() - start);
          resolve(msg.result);
        } else if (msg.event) {
          this.emit('event', msg);
        }
      } catch {
        // Non-JSON debug line
        console.log(`[NEXORA Sidecar Raw] ${trimmed}`);
      }
    }
  }

  sendRequest(method, params = {}) {
    if (!this.process || this.status !== 'online') {
      // Graceful local emulation when binary is offline
      if (method === 'ping') {
        return Promise.resolve({ pong: true, timestamp: Date.now(), simulated: true });
      }
      if (method === 'diagnostics') {
        return Promise.resolve({
          os: process.platform,
          arch: process.arch,
          memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          uptimeSec: Math.round(process.uptime()),
          simulated: true,
        });
      }
      return Promise.reject(new Error('Native core sidecar is offline'));
    }

    const id = this.requestId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const start = performance.now();
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Sidecar request timeout: ${method}`));
        }
      }, 5000);

      this.pendingRequests.set(id, { resolve, reject, timer, start });
      this.process.stdin.write(payload);
    });
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (this.status === 'online') {
        try {
          await this.sendRequest('ping');
          this.metrics.lastHeartbeat = Date.now();
        } catch {
          // heartbeat missed
        }
      }
    }, 4000);
    this.heartbeatTimer.unref?.();
  }

  getStatus() {
    return {
      status: this.status,
      pid: this.pid,
      uptimeSec: this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0,
      latencyMs: this.metrics.latencyMs,
      binaryFound: !!this.resolveBinaryPath(),
    };
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {}
      this.process = null;
      this.status = 'offline';
    }
  }
}

let sidecarInstance = null;
function getSidecarManager() {
  if (!sidecarInstance) {
    sidecarInstance = new SidecarManager();
  }
  return sidecarInstance;
}

module.exports = {
  getSidecarManager,
};
