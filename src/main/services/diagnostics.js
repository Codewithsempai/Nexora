/* NEXORA — support bundle (v0.4.0). A plain-text report users can attach to a bug report. Contains NO keys and NO memory contents. */
const os = require('os');
const { redact } = require('./logger');

const SECRET_KEY = /(key|token|secret|password|credential)/i;

/** Deep copy of a config object with secret-looking fields removed and long strings shortened. */
function redactConfig(value, depth = 0) {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactConfig(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) && typeof v === 'string' ? '***REDACTED***' : redactConfig(v, depth + 1);
    return out;
  }
  if (typeof value === 'string') return redact(value).slice(0, 300);
  return value;
}

function buildReport({ appInfo = {}, config = {}, services = {}, logs = '', now = new Date(), homeDir = os.homedir() } = {}) {
  const scrub = (text) => (homeDir ? String(text).split(homeDir).join('~') : String(text));
  const lines = [];
  lines.push('NEXORA diagnostics', `Created: ${now.toISOString()}`, '');
  lines.push('== App ==');
  for (const [k, v] of Object.entries(appInfo)) lines.push(`${k}: ${v}`);
  lines.push('', '== System ==', `platform: ${process.platform} ${process.arch}`, `os: ${os.type()} ${os.release()}`,
    `cpus: ${os.cpus()?.length || '?'}`, `totalMemoryMB: ${Math.round(os.totalmem() / 1048576)}`, `freeMemoryMB: ${Math.round(os.freemem() / 1048576)}`);
  lines.push('', '== Services ==');
  for (const [k, v] of Object.entries(services)) lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  lines.push('', '== Settings (secrets removed) ==', JSON.stringify(redactConfig(config), null, 2));
  lines.push('', '== Recent log ==', logs || '(log is empty)');
  return scrub(redact(lines.join('\n')));
}

module.exports = { buildReport, redactConfig };
