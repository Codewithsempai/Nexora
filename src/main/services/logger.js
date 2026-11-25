/* NEXORA — rotating, secret-redacting log file (v0.4.0). Never throws; a logging failure must not break the app. */
const fs = require('fs');
const path = require('path');
const util = require('util');

const REDACTIONS = [
  [/AIza[0-9A-Za-z_-]{30,}/g, 'AIza***REDACTED***'],
  [/([?&]key=)[^&\s"']+/gi, '$1***REDACTED***'],
  [/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***REDACTED***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***REDACTED***'],
  [/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, '$1***REDACTED***'],
];

function redact(text) {
  let out = String(text ?? '');
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

class Logger {
  constructor({ dir, maxBytes = 1024 * 1024, maxFiles = 3, fileSystem = fs, now = () => new Date() } = {}) {
    this.dir = dir; this.maxBytes = maxBytes; this.maxFiles = Math.max(1, maxFiles); this.fs = fileSystem; this.now = now;
    this.file = dir ? path.join(dir, 'nexora.log') : null;
    this.ready = false;
  }

  ensure() {
    if (this.ready || !this.dir) return this.ready;
    try { this.fs.mkdirSync(this.dir, { recursive: true }); this.ready = true; } catch { this.ready = false; }
    return this.ready;
  }

  rotate() {
    try {
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
        const to = `${this.file}.${i}`;
        if (this.fs.existsSync(from)) { try { this.fs.rmSync(to, { force: true }); } catch { /* ignore */ } this.fs.renameSync(from, to); }
      }
    } catch { /* rotation is best-effort */ }
  }

  write(level, message) {
    try {
      if (!this.ensure()) return false;
      const line = `${this.now().toISOString()} ${String(level).toUpperCase().padEnd(5)} ${redact(message).replace(/\r?\n/g, '\n    ').slice(0, 4000)}\n`;
      let size = 0;
      try { size = this.fs.statSync(this.file).size; } catch { size = 0; }
      if (size + line.length > this.maxBytes) this.rotate();
      this.fs.appendFileSync(this.file, line, 'utf8');
      return true;
    } catch { return false; }
  }

  /** Newest log text, oldest file first, trimmed to maxChars from the end. */
  readRecent(maxChars = 200000) {
    try {
      const parts = [];
      for (let i = this.maxFiles - 1; i >= 0; i--) {
        const file = i === 0 ? this.file : `${this.file}.${i}`;
        if (this.fs.existsSync(file)) parts.push(this.fs.readFileSync(file, 'utf8'));
      }
      const all = redact(parts.join(''));
      return all.length > maxChars ? all.slice(all.length - maxChars) : all;
    } catch { return ''; }
  }

  /** Mirror console.* into the log file (the original console output is kept). */
  installConsole(target = console) {
    if (target.__nexoraLogged) return;
    for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error'], ['debug', 'debug']]) {
      const original = target[method]?.bind(target);
      if (!original) continue;
      target[method] = (...args) => {
        try { original(...args); } catch { /* console closed */ }
        try { this.write(level, util.format(...args)); } catch { /* never throw */ }
      };
    }
    Object.defineProperty(target, '__nexoraLogged', { value: true });
  }
}

let instance = null;
function getLogger(options) { if (!instance || options) instance = new Logger(options || {}); return instance; }

module.exports = { Logger, getLogger, redact, REDACTIONS };
