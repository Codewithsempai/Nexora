/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — permission levels + the approval gate.
 * Levels per action: ask (every time) · once (ask the first time each session) · always (never ask) · deny (never allowed).
 * Medium-risk actions can never be silently auto-run by the planner: they are 'ask' unless the user chose 'always'. */
const { ACTIONS, LEVELS } = require('./actions');

/* v0.3.14: hourly caps per action (a bad plan or a loop can never run an action hundreds of times).
 * Override with config `autonomy.caps.<action>` (a number; 0 = no cap). */
const DEFAULT_CAPS = { open_app: 30, open_folder: 40, open_url: 30, open_in_vscode: 20, search_files: 30, clipboard_read: 10, clipboard_write: 20, create_folder: 15, extract_zip: 10, write_note: 10 };
const HOUR_MS = 3600 * 1000;

class Policy {
  constructor(configService, { now = () => Date.now() } = {}) { this.config = configService; this.sessionGrants = new Set(); this.now = now; this.uses = new Map(); }
  cap(action) { const saved = Number(this.config?.get?.(`autonomy.caps.${action}`)); return Number.isFinite(saved) && saved >= 0 ? saved : (DEFAULT_CAPS[action] ?? 30); }
  /** Counts one use; -> { ok, used, cap }. Only call when the action is about to be allowed. */
  consume(action) {
    const cap = this.cap(action); const t = this.now();
    const list = (this.uses.get(action) || []).filter((x) => t - x < HOUR_MS);
    if (cap > 0 && list.length >= cap) { this.uses.set(action, list); return { ok: false, used: list.length, cap }; }
    list.push(t); this.uses.set(action, list); return { ok: true, used: list.length, cap };
  }
  level(action) {
    const saved = this.config?.get?.(`autonomy.permissions.${action}`);
    return LEVELS.includes(saved) ? saved : (ACTIONS[action]?.defaultLevel || 'ask');
  }
  set(action, level) {
    if (!ACTIONS[action] || !LEVELS.includes(level)) return { success: false, error: 'Unknown action or level.' };
    this.config.set(`autonomy.permissions.${action}`, level);
    if (level !== 'once') this.sessionGrants.delete(action);
    return { success: true };
  }
  table() { return Object.entries(ACTIONS).map(([action, meta]) => ({ action, risk: meta.risk, level: this.level(action), granted: this.sessionGrants.has(action) })); }
}

class ApprovalGate {
  constructor({ policy, cards, log, describe }) { this.policy = policy; this.cards = cards; this.log = log; this.describe = describe; }

  /** -> { allowed, via: 'always'|'session'|'user'|'implied'|'denied'|'timeout', reason? }.
   *  opts: { source, why, implied } — `implied` means the user just pressed a button on a card that named this exact action. */
  async request(action, args, opts = {}) {
    const out = await this._decide(action, args, opts);
    if (!out.allowed) return out;
    const use = this.policy.consume(action);
    if (use.ok) return out;
    const text = this.describe(action, args);
    this.log?.add({ kind: 'action', action, summary: `Hourly limit reached (${use.cap}/hour): ${text}`, ok: false, source: opts.source || 'user', decision: 'capped' });
    return { allowed: false, via: 'capped', reason: `I already ran “${action}” ${use.used} times this hour (limit ${use.cap}). Try again later or raise the limit in settings.` };
  }

  async _decide(action, args, opts = {}) {
    const level = this.policy.level(action);
    const text = this.describe(action, args);
    const source = opts.source || 'user';
    if (level === 'deny') { this.log?.add({ kind: 'action', action, summary: `Blocked by your settings: ${text}`, ok: false, source, decision: 'denied' }); return { allowed: false, via: 'denied', reason: 'Blocked by your permission settings.' }; }
    if (level === 'always') return { allowed: true, via: 'always' };
    if (opts.implied) return { allowed: true, via: 'implied' };
    if (level === 'once' && (this.policy.sessionGrants.has(action) || opts.planApproved)) return { allowed: true, via: 'session' };
    const buttons = [{ id: 'allow', label: level === 'once' ? 'Allow for this session' : 'Allow once', primary: true }];
    if (ACTIONS[action]?.risk === 'low' || level === 'once') buttons.push({ id: 'always', label: 'Always allow' });
    buttons.push({ id: 'deny', label: 'Deny', danger: true });
    const answer = await this.cards.ask({ kind: 'approval', label: 'NEXORA wants to', title: text, text: [opts.why ? `Why: ${String(opts.why).slice(0, 200)}` : (source === 'voice' ? 'Asked by voice.' : ''), this.voiceHint?.() ? (level === 'once' ? 'Say “OK” to allow for this session, “No” to deny.' : 'Say “OK” to allow, “No” to deny.') : ''].filter(Boolean).join(' '), buttons, timeoutMs: 60000 });
    if (answer === 'allow') { if (level === 'once') this.policy.sessionGrants.add(action); return { allowed: true, via: 'user' }; }
    if (answer === 'always') { this.policy.set(action, 'always'); return { allowed: true, via: 'user' }; }
    const via = answer === 'timeout' ? 'timeout' : 'denied';
    this.log?.add({ kind: 'action', action, summary: `${via === 'timeout' ? 'No answer (cancelled)' : 'You denied'}: ${text}`, ok: false, source, decision: via });
    return { allowed: false, via, reason: via === 'timeout' ? 'No answer in 60 seconds, so I did not do it.' : 'You said no.' };
  }
}
module.exports = { Policy, ApprovalGate, DEFAULT_CAPS };
