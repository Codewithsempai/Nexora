/* NEXORA — one shared place where background Gemini text calls (memory, planner, screen help, wake fallback) report failures.
 * Before v0.3.12 each helper called a hard-coded model (gemini-2.5-flash-lite) and never told anyone it failed, so a 404 was retried
 * on EVERY spoken sentence. Now a failure puts the model on the shared cooldown list (ModelDirectory) and every caller skips it. */
let directory = null;
const { classifyFailure } = require('./model-ladder');

function bind(modelDirectory) { directory = modelDirectory || null; }

/** status = HTTP status number or an Error. 404/429/5xx/timeouts cool the model down; auth errors are not the model's fault. */
function report(model, statusOrError, detail = '') {
  if (!directory || !model) return;
  try {
    const error = statusOrError instanceof Error ? statusOrError : Object.assign(new Error(detail || `HTTP ${statusOrError}`), { status: Number(statusOrError) || 0 });
    directory.markBad(model, classifyFailure(error), error.message);
  } catch { /* never throw from health reporting */ }
}
function ok(model) { try { directory?.markGood(model); } catch { /* ignore */ } }
function cooling(model) { try { return !!directory?.isCooling(model); } catch { return false; } }
/** Drop models that are cooling down, but never return an empty list. */
function usable(models) { const list = (models || []).filter((m) => !cooling(m)); return list.length ? list : (models || []); }

module.exports = { bind, report, ok, cooling, usable };
