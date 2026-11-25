/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — the agent loop. goal -> plan -> (plan card) -> step by step, every step through the approval gate,
 * with a Stop button, a stop word ("Nexora, stop"), a step limit and a time limit. A denied or failed step ends the task. */
const { localPlan, planWithGemini, DEFAULT_MAX_STEPS } = require('./planner');

const STOP_WORDS = /\b(?:stop|cancel|abort|enough|niruthu|nillu|நிறுத்து|நிறுத்துங்க)\b/i;
const MAX_RETRIES = 2;   // v0.3.14: Retry presses allowed per failed step
const CANT = 'I can open any installed app, folders (also on other drives) and links, search your files, create folders, extract zips and use the clipboard. I cannot do that one yet.';

class Agent {
  constructor({ executor, gate, cards, log, getApiKey = () => null, getModels = async () => null, getLimits = () => ({}), fetchImpl, homeHint = '', onState = null } = {}) {
    Object.assign(this, { executor, gate, cards, log, getApiKey, getModels, getLimits, fetchImpl, homeHint, onState });
    this.running = false; this.stopRequested = false; this.current = null;
  }
  isRunning() { return this.running; }
  state() { return this.current ? { ...this.current } : null; }
  emit() { try { this.onState?.(this.state()); } catch { /* ignore */ } }

  /** Is this short utterance a stop command for a running task? (Only meaningful while a task runs.) */
  isStopPhrase(text) {
    if (!this.running) return false;
    const t = String(text || '').trim();
    return t.length > 0 && t.split(/\s+/).length <= 7 && STOP_WORDS.test(t);
  }
  stop(reason = 'Stopped by you.') {
    if (!this.running) return { success: false, error: 'No task is running.' };
    this.stopRequested = true; this.stopReason = reason;
    this.cards.closeKind('approval', 'dismiss'); this.cards.closeKind('plan', 'dismiss');
    return { success: true };
  }

  async makePlan(goal, maxSteps) {
    try { await this.executor.warm?.(); } catch { /* built-in apps still work */ }       // v0.3.10: installed apps known before planning
    const local = localPlan(goal, this.executor, maxSteps);
    if (local && local.steps.length) return local;
    const apiKey = this.getApiKey();
    if (!apiKey) return { steps: [], say: 'That needs Gemini to plan it, but no API key is set. Simple goals like “open VS Code and Chrome” work offline.' };
    const listed = await Promise.race([Promise.resolve(this.getModels()).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
    // v0.3.12: `listed` is already the chat-model-first ladder (cooling models removed); no hard-coded flash-lite first.
    const models = Array.isArray(listed) && listed.length ? listed.slice(0, 3) : ['gemini-2.5-flash'];
    const planned = await planWithGemini({ apiKey, goal, executor: this.executor, models, maxSteps, fetchImpl: this.fetchImpl || globalThis.fetch, homeHint: this.homeHint });
    if (planned.error) return { steps: [], say: 'Gemini is slow right now, so I could not plan that. Please say it once more in a few seconds.' };
    return planned;
  }

  /** run(goal, { source }) -> { success, summary, steps:[{action,ok,summary}], cancelled? } — never throws. */
  async run(goal, { source = 'chat' } = {}) {
    const text = String(goal || '').trim().slice(0, 600);
    if (!text) return { success: false, summary: 'Tell me what to do.', steps: [] };
    if (this.running) return { success: false, summary: 'A task is already running. Press Stop (or say “Nexora, stop”) first.', steps: [] };
    const limits = { maxSteps: DEFAULT_MAX_STEPS, maxSeconds: 180, ...(this.getLimits() || {}) };
    this.running = true; this.stopRequested = false; this.stopReason = '';
    const results = []; let taskCard = null;
    this.current = { goal: text, status: 'planning', step: 0, total: 0, steps: [] }; this.emit();
    try {
      const plan = await this.makePlan(text, limits.maxSteps);
      if (!plan.steps.length) { const say = plan.say || CANT; this.log.add({ kind: 'task', summary: `No safe plan for: ${text}`, ok: false, source }); this.cards.notify({ kind: 'task', label: 'TASK', title: text, text: say, timeoutMs: 9000 }); return { success: false, summary: say, steps: [] }; }
      const described = plan.steps.map((s) => this.executor.describe(s.action, s.args));
      this.current = { goal: text, status: 'planned', step: 0, total: plan.steps.length, steps: described.map((d) => ({ text: d, state: 'pending' })) }; this.emit();
      let planApproved = false;
      if (plan.steps.length > 1) {
        const answer = await this.cards.ask({ kind: 'plan', label: 'TASK PLAN', title: text, text: `${plan.say || 'Here is what I will do, step by step. Each step still follows your permission settings.'}${this.voiceHint?.() ? ' Say “OK” to run.' : ''}`, lines: described.map((d, i) => `${i + 1}. ${d}`), buttons: [{ id: 'run', label: `Run ${plan.steps.length} steps`, primary: true }, { id: 'cancel', label: 'Cancel', danger: true }], timeoutMs: 90000 });
        if (answer !== 'run') { this.log.add({ kind: 'task', summary: `Plan not approved: ${text}`, ok: false, source, decision: answer }); return { success: false, cancelled: true, summary: 'Okay, I did not run it.', steps: [] }; }
        planApproved = true;
      }
      this.log.add({ kind: 'task', summary: `Started: ${text} (${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''})`, source });
      taskCard = this.cards.show({ kind: 'task', label: 'TASK RUNNING', title: text, text: 'Starting…', progress: 0, buttons: [{ id: 'stop', label: 'Stop', danger: true }], keepOpen: true, timeoutMs: 0, onButton: (id) => { if (id === 'stop') this.stop(); } });
      const started = Date.now(); let failed = null;
      for (let i = 0; i < plan.steps.length; i++) {
        if (this.stopRequested) { failed = this.stopReason; break; }
        if (Date.now() - started > limits.maxSeconds * 1000) { failed = `Stopped: the ${limits.maxSeconds}s time limit was reached.`; break; }
        const step = plan.steps[i];
        this.current.step = i + 1; this.current.status = 'running'; this.current.steps[i].state = 'running'; this.emit();
        this.cards.update(taskCard.id, { text: `Step ${i + 1} of ${plan.steps.length}: ${described[i]}`, progress: Math.round((i / plan.steps.length) * 100) });
        const decision = await this.gate.request(step.action, step.args, { source, why: step.why, planApproved });
        if (this.stopRequested) { failed = this.stopReason; break; }
        if (!decision.allowed) { this.current.steps[i].state = 'denied'; results.push({ action: step.action, ok: false, summary: decision.reason || 'Not allowed.' }); failed = `Stopped at step ${i + 1}: ${decision.reason || 'not allowed'}`; break; }
        let result = await this.executor.run(step.action, step.args);
        this.log.add({ kind: 'action', action: step.action, summary: result.summary || described[i], ok: result.ok, source, decision: decision.via });
        // v0.3.14: a step that FAILED (not one you denied) can be retried or skipped instead of ending the whole task.
        let retries = 0; let skipped = false;
        while (!result.ok && !this.stopRequested && limits.retryOnFail !== false && retries < MAX_RETRIES) {
          const choice = await this.cards.ask({ kind: 'task', label: 'STEP FAILED', title: described[i], text: `${result.summary || 'That step did not work.'} Retry it, skip it, or stop the task?`, buttons: [{ id: 'retry', label: 'Retry', primary: true }, { id: 'skip', label: 'Skip step' }, { id: 'stop', label: 'Stop', danger: true }], timeoutMs: 30000 });
          if (this.stopRequested) break;
          if (choice === 'skip') { skipped = true; break; }
          if (choice !== 'retry') break;
          retries += 1;
          result = await this.executor.run(step.action, step.args);
          this.log.add({ kind: 'action', action: step.action, summary: `Retry ${retries}: ${result.summary || described[i]}`, ok: result.ok, source, decision: 'retry' });
        }
        results.push({ action: step.action, ok: result.ok, skipped, summary: skipped ? `Skipped: ${result.summary}` : result.summary, data: result.data });
        this.current.steps[i].state = result.ok ? 'done' : skipped ? 'skipped' : 'failed'; this.emit();
        if (!result.ok && !skipped) { failed = `Step ${i + 1} failed: ${result.summary}`; break; }
      }
      const done = results.filter((r) => r.ok).length;
      const skippedCount = results.filter((r) => r.skipped).length;
      const success = !failed && done + skippedCount === plan.steps.length;
      const summary = success ? `Done — ${done} step${done !== 1 ? 's' : ''} completed${skippedCount ? `, ${skippedCount} skipped` : ''}.` : `${failed || 'Stopped.'} (${done}/${plan.steps.length} steps done)`;
      this.log.add({ kind: 'task', summary: `${success ? 'Finished' : 'Ended'}: ${text} — ${summary}`, ok: success, source });
      this.cards.close(taskCard.id, 'done'); taskCard = null;
      const files = results.flatMap((r) => (r.data?.files || [])).slice(0, 8);
      this.cards.notify({ kind: 'task', label: success ? 'TASK DONE' : 'TASK STOPPED', title: text, text: summary, lines: files.length ? files : results.map((r) => `${r.ok ? '✓' : r.skipped ? '↷' : '✗'} ${r.summary}`).slice(0, 8), timeoutMs: success ? 8000 : 12000 });
      return { success, summary, steps: results };
    } catch (error) {
      const summary = `Task failed: ${String(error?.message || error).slice(0, 140)}`;
      try { this.log.add({ kind: 'task', summary, ok: false, source }); } catch { /* ignore */ }
      if (taskCard) this.cards.close(taskCard.id, 'error');
      return { success: false, summary, steps: results };
    } finally {
      this.running = false; this.stopRequested = false;
      this.current = this.current ? { ...this.current, status: 'idle' } : null; this.emit(); this.current = null; this.emit();
    }
  }
}
module.exports = { Agent, STOP_WORDS };
