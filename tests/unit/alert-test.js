const assert = require('assert');
const Module = require('module'); const orig = Module._load;
const created = []; const handlers = {};
Module._load = function (r, ...a) {
  if (r === 'electron') return {
    ipcMain: { on: (ch, fn) => { handlers[ch] = fn; } }, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1366, height: 727 } }) },
    BrowserWindow: class { constructor(o) { this.o = o; this.visible = false; this.sent = []; created.push(this); this.webContents = { send: (c, p) => this.sent.push([c, p]), on: (e, f) => { if (e === 'did-finish-load') this.load = f; }, setWindowOpenHandler() {} }; }
      setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} on() {} loadFile() { setTimeout(() => this.load && this.load(), 0); } setBounds(b) { this.b = b; } setIgnoreMouseEvents() {} isDestroyed() { return false; } isVisible() { return this.visible; } showInactive() { this.visible = true; } hide() { this.visible = false; } destroy() {} },
  };
  return orig.call(this, r, ...a);
};
const { ReminderAlertManager } = require('../../src/main/application/reminder-alert.js');
const { ReminderService } = require('../../src/main/services/reminder-service.js');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-alert-'));
  let t = Date.now();
  const rs = new ReminderService({ filePath: path.join(dir, 'r.json'), now: () => t });
  let focused = false;
  const mgr = new ReminderAlertManager({ reminderService: rs, windowManager: { show() {} }, shouldShow: () => !focused });
  const item = rs.add({ text: 'study', dueAt: t + 1000 }).item;
  mgr.sync(); assert.strictEqual(created.length, 0, 'nothing due yet -> no card');
  t += 2000; rs.tick(t); mgr.sync(); await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(created.length, 1); assert(created[0].visible, 'card shown when app not focused');
  assert.strictEqual(created[0].b.x * 2 + created[0].b.width, 1366, 'card is horizontally centred'); assert(created[0].b.y <= 16, 'card sits at the TOP of the screen');
  assert(created[0].sent.some(([c, p]) => c === 'alert:items' && p[0].text === 'study'));
  focused = true; mgr.sync(); assert(!created[0].visible, 'hidden while the app is focused');
  focused = false; mgr.sync(); assert(created[0].visible);
  handlers['alert:snooze']({ sender: created[0].webContents }, item.id, 10);
  assert(!created[0].visible, 'snooze hides the card');
  // x button: dismiss the card without answering; it must not pop up again for the same alert
  t += 700000; rs.tick(t); mgr.sync(); assert(created[0].visible, 'snoozed reminder fires again');
  handlers['alert:close']({ sender: created[0].webContents }, item.id); assert(!created[0].visible, 'x hides the card');
  mgr.sync(); assert(!created[0].visible, 'stays closed');
  assert.strictEqual(rs.list().find((i) => i.id === item.id).status, 'fired', 'reminder still waits in the app');
  assert.strictEqual(created[0].o.focusable, true, 'buttons are clickable');
  console.log('  desktop reminder card ok');
})().catch((e) => { console.error(e); process.exit(1); });
