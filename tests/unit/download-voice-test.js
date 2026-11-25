/* v0.3.13: spoken download card answers, write_note action, planner retry. */
const assert = require('assert');
const { watcherChoice } = require('../../src/main/autonomy/voice-choice');
const { ActionExecutor } = require('../../src/main/autonomy/actions');
const { planWithGemini } = require('../../src/main/autonomy/planner');
const { Watchers } = require('../../src/main/autonomy/watchers');
(async () => {
  const b = [{ id: 'extract', primary: true }, { id: 'folder' }, { id: 'no' }];
  assert.strictEqual(watcherChoice('extract', b), 'extract'); assert.strictEqual(watcherChoice('show folder', b), 'folder'); assert.strictEqual(watcherChoice('ignore', b), 'no');
  assert.strictEqual(watcherChoice('ok', b), 'extract'); assert.strictEqual(watcherChoice('extract it and open chrome then play a song', b), null);
  assert.strictEqual(watcherChoice('folder', [{ id: 'explain', primary: true }, { id: 'no' }]), null);

  // write_note: validated, saved with CRLF, opened in Notepad.
  const writes = []; const calls = [];
  const ex = new ActionExecutor({ platform: 'win32', folders: { home: 'C:\\U', desktop: 'C:\\U\\Desktop', documents: 'C:\\U\\Documents', downloads: 'C:\\U\\Downloads' },
    fs: { existsSync: () => false, writeFileSync: (f, c) => writes.push([f, c]), statSync: () => ({}) }, path: require('path').win32, execFile: (c, a, o, cb) => { calls.push([c, a]); cb(null); }, driveMap: () => ({}) });
  const lines = Array.from({ length: 10 }, (_, i) => `Iron Man fact ${i + 1}`).join('\n');
  const v = ex.validate('write_note', { title: 'Iron Man: facts?', content: lines }); assert(v.ok && v.args.title === 'Iron Man facts' && v.args.folder === 'desktop');
  assert(!ex.validate('write_note', { content: '  ' }).ok); assert(!ex.validate('write_note', { content: 'x', folder: 'system32' }).ok);
  const r = await ex.run('write_note', { title: 'Iron Man', content: lines }); assert(r.ok && /Notepad/.test(r.summary));
  assert(writes[0][1].includes('\r\n') && calls[0][1].includes('notepad'));

  // planner: a timed-out model gets one more try.
  let n = 0; const fetchImpl = async () => { n++; if (n === 1) { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ steps: [{ action: 'write_note', args: { title: 'Iron Man', content: lines } }], say: 'Seri' }) }] } }] }) }; };
  const plan = await planWithGemini({ apiKey: 'k', goal: 'Type 10 lines about Iron Man in Notepad', executor: ex, models: ['gemini-test-model-x'], fetchImpl });
  assert(!plan.error && plan.steps.length === 1 && plan.steps[0].action === 'write_note' && n === 2);

  // watcher: speaks the offer and extracts when answered.
  const said = []; let cardDef = null; let resolveCard;
  const cards = { ask: (d) => { cardDef = d; return new Promise((res) => { resolveCard = res; }); }, notify() {} };
  const wk = new Watchers({ cards, config: { get: () => undefined }, log: { add() {} }, speak: (t) => said.push(t), voiceHint: () => true, now: () => new Date(2026, 10, 22, 14, 0).getTime(), runAction: async () => ({ ok: true, summary: 'Extracted' }), path: require('path') });
  const done = wk.offerExtract('C:\\Users\\U\\Downloads\\NEXORA_v0_3_13b.zip'); assert(/say “Extract”/.test(cardDef.text) && /extract, show folder, or ignore/.test(said[0]));
  resolveCard('extract'); await done; assert(/Extract pannitten/.test(said[1]));
  console.log('  v0.3.13 download voice answers + write_note + planner retry ok');
})().catch((e) => { console.error(e); process.exit(1); });
