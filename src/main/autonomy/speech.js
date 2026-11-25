/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — what NEXORA SAYS when a task or screen explanation finishes. Pure functions (unit-tested). */
const VERBS = { opened: 'I opened', created: 'I created', copied: 'I copied', extracted: 'I extracted', found: 'I found', read: 'I read' };
/** C:\Users\Daya\Desktop\nexora-test -> nexora-test  (never read a long path out loud) */
const shortenPaths = (t) => String(t || '').replace(/[A-Za-z]:\\[^\s"“”]+/g, (p) => p.split('\\').filter(Boolean).pop() || p).replace(/\/(?:[^\s/]+\/)+([^\s/]+)/g, '$1');
const sentence = (s) => { const t = shortenPaths(String(s || '').replace(/https?:\/\/(?:www\.)?/gi, '').replace(/(\w)\/(?=\s|$)/g, '$1')).replace(/\s+/g, ' ').trim().replace(/[.!\s]+$/, ''); const first = t.split(' ')[0]?.toLowerCase(); return `${VERBS[first] ? `${VERBS[first]} ${t.slice(first.length).trim()}` : t}.`; };
const _unused = (s) => { const t = shortenPaths(s).replace(/\s+/g, ' ').trim().replace(/[.!\s]+$/, ''); const first = t.split(' ')[0]?.toLowerCase(); return `${VERBS[first] ? `${VERBS[first]} ${t.slice(first.length).trim()}` : t}.`; };

/** res = result of Agent.run -> one short spoken line, e.g. "I opened Calculator." */
function spokenLine(res) {
  if (!res) return '';
  if (res.cancelled) return 'Okay, I did not run it.';
  const steps = Array.isArray(res.steps) ? res.steps : [];
  if (res.success) {
    const done = steps.filter((s) => s.ok).map((s) => sentence(s.summary)).slice(0, 3);
    return done.length ? done.join(' ') : 'Done.';
  }
  const bad = steps.find((s) => !s.ok);
  const reason = shortenPaths(bad?.summary || res.summary || 'it did not work').replace(/^Failed:\s*/i, '').slice(0, 140);
  const ok = steps.filter((s) => s.ok).map((s) => sentence(s.summary)).slice(0, 2);
  return `${ok.join(' ')} Sorry, I could not finish: ${reason}`.trim();
}
module.exports = { spokenLine, shortenPaths };
