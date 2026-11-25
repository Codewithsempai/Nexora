/* End-to-end smoke test: starts the real Electron app against a throw-away data folder.
 * Needs `npm install` (Electron + Playwright). Does not call Gemini and does not need a key or microphone. */
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const pkg = require('../../package.json');

(async () => {
  let _electron;
  try { ({ _electron } = require('playwright')); } catch { console.log('e2e skipped: playwright is not installed (npm install)'); return; }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-e2e-'));
  const app = await _electron.launch({ args: ['.'], cwd: path.join(__dirname, '..', '..'), env: { ...process.env, NEXORA_USER_DATA: userData }, timeout: 60000 });
  try {
    // the main window is the one that has the preload bridge
    let page = null; const deadline = Date.now() + 45000;
    while (!page && Date.now() < deadline) {
      for (const w of app.windows()) { try { if (await w.evaluate(() => typeof window.nexoraAPI === 'object')) { page = w; break; } } catch { /* window still loading */ } }
      if (!page) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(page, 'a window with window.nexoraAPI appeared');
    const status = await page.evaluate(() => window.nexoraAPI.system.getStatus());
    assert.strictEqual(status.version, pkg.version, 'running version matches package.json');

    const added = await page.evaluate(() => window.nexoraAPI.memory.add('personal', 'E2E: I study at Anna University'));
    assert.ok(added.success, 'memory add');
    const found = await page.evaluate(() => window.nexoraAPI.memory.search('where is my college'));
    assert.ok(found.items.some((i) => /Anna University/.test(i.text)), 'synonym recall through the real IPC path');
    const exp = await page.evaluate(() => window.nexoraAPI.memory.exportData());
    assert.ok(exp.success && exp.data.items.length >= 1, 'export');
    const again = await page.evaluate((d) => window.nexoraAPI.memory.importData(d), exp.data);
    assert.ok(again.success && again.added === 0, 're-import adds nothing');

    assert.ok(await page.evaluate(() => typeof window.nexoraAPI.diagnostics.export === 'function'), 'diagnostics bridge');
    assert.ok(fs.existsSync(path.join(userData, 'logs', 'nexora.log')), 'log file is written');
    const log = fs.readFileSync(path.join(userData, 'logs', 'nexora.log'), 'utf8');
    assert.ok(/starting/.test(log) && !/AIza[0-9A-Za-z_-]{30,}/.test(log), 'log has start line and no API key');
    console.log('NEXORA e2e smoke test passed.');
  } finally { await app.close().catch(() => {}); fs.rmSync(userData, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exit(1); });
