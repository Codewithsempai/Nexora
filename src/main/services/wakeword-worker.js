/* Worker thread for the ONNX wake word: keeps the neural-net maths off the Electron main thread. */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { OnnxWakeEngine, loadModelFiles } = require('./wakeword-onnx');

let engine = null;
try {
  engine = new OnnxWakeEngine(loadModelFiles(workerData.dir), { threshold: workerData.threshold });
  parentPort.postMessage({ type: 'ready', words: engine.heads.map((h) => h.word) });
} catch (error) { parentPort.postMessage({ type: 'error', error: String(error?.message || error) }); }

parentPort.on('message', (msg) => {
  if (!engine) return;
  try {
    if (msg.type === 'pcm') {
      const hits = engine.feed(Buffer.from(msg.buffer));
      for (const hit of hits) parentPort.postMessage({ type: 'wake', ...hit });
    } else if (msg.type === 'reset') engine.reset();
    else if (msg.type === 'threshold') engine.setThreshold(msg.value);
    else if (msg.type === 'scores') parentPort.postMessage({ type: 'scores', scores: engine.scores() });
  } catch (error) { parentPort.postMessage({ type: 'error', error: String(error?.message || error) }); }
});
