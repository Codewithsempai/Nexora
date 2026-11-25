/* End-to-end smoke test: starts the real Electron dev app against a throw-away userData folder.
 * Needs `npm install` (Electron + Playwright). Does not call Gemini and does not need a key or microphone. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  let _electron;
  try { ({ _electron } = require('playwright')); } catch { console.log('e2e skipped: playwright is not installed (npm install)'); return; }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-e2e-'));
  const app = await _electron.launch({
    args: ['.'],
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, NEXORA_USER_DATA: userData },
    timeout: 60000,
  });

  try {
    let page = null;
    for (let i = 0; i < 40 && !page; i++) {
      for (const w of app.windows()) {
        try {
          if (await w.evaluate(() => typeof window.nexoraAPI === 'object')) { page = w; break; }
        } catch { /* window still loading */ }
      }
      if (!page) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(page, 'a window with window.nexoraAPI appeared');

    const status = await page.evaluate(() => window.nexoraAPI.system.getStatus());
    assert.strictEqual(status.appName, 'NEXORA');

    const updState = await page.evaluate(() => window.nexoraAPI.updates.state());
    assert.ok(updState && typeof updState.currentVersion === 'string', 'updates.state bridge works');

    const audioDiag = await page.evaluate(() => window.nexoraAPI.audio.diagnostics());
    assert.ok(audioDiag && typeof audioDiag.duckingLabel === 'string', 'audio.diagnostics bridge works');

    const added = await page.evaluate(() => window.nexoraAPI.memory.add('personal', 'E2E: I study at Anna University'));
    assert.ok(added?.success, 'memory.add succeeded');
    const found = await page.evaluate(() => window.nexoraAPI.memory.search('Anna University'));
    assert.ok(found?.items?.some((x) => x.text.includes('Anna University')), 'memory.search retrieved saved memory');

    await page.waitForSelector('#setupWizardContainer:not([hidden])', { timeout: 10000 });
    assert.strictEqual((await page.textContent('.setup-welcome-title')).trim(), 'NEXORA');

    console.log('NEXORA e2e smoke test passed.');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
})();
