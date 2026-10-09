const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  const elements = new Map();
  const $ = key => {
    if (!elements.has(key)) elements.set(key, { value: '', checked: false, disabled: false, textContent: '', listeners: {},
      classList: { add() {}, remove() {} }, addEventListener(name, fn) { this.listeners[name] = fn; }, click() { return this.listeners.click?.(); } });
    return elements.get(key);
  };
  const storage = { value: 'original', writes: 0, getItem() { return this.value; }, setItem(key, value) { this.writes++; this.value = value; }, removeItem() { this.value = null; } };
  let refreshed = 0, exports = 0;
  const context = { KEY: 'dzienny.v1', window: {}, Blob, $, localStorage: storage, todayKey: '2026-10-09', today: new Date(2026, 9, 9),
    state: null, selectedPeriod: null, selectedMonth: '', selectedDay: '', budgetGoalsSectionEnabled: null,
    applyTheme() {}, update() { refreshed++; }, showToast() {},
    FileReader: class { readAsText(file) { this.result = file.content; Promise.resolve().then(() => this.onload()); } } };
  vm.createContext(context);
  for (const file of ['budget-core.js', 'backup-core.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  context.Core = context.window.SpendoBudgetCore;
  const app = fs.readFileSync('app.js', 'utf8');
  const start = app.indexOf('  let pendingImport = null;');
  const end = app.indexOf("  $('#payday-select').value = String(state.payday);\n  applyTheme();", start);
  vm.runInContext(app.slice(start, end), context);
  $('#export-data').listeners.click = () => exports++;
  const data = JSON.stringify(context.Core.blankState());
  const choose = () => $('#import-file').listeners.change({ target: { files: [{ name: 'test.json', size: data.length, content: data }] } });
  await choose();
  assert.equal(storage.writes, 0);
  assert.equal($('#import-restore').disabled, true);
  $('#import-restore').click(); assert.equal(storage.writes, 0);
  $('#import-export').click(); assert.equal(exports, 1);
  $('#import-cancel').click(); $('#import-restore').click(); assert.equal(storage.writes, 0);
  const reading = choose(); $('#import-cancel').click(); await reading;
  $('#import-consent').checked = true; $('#import-consent').listeners.change();
  assert.equal($('#import-restore').disabled, true);
  await choose();
  $('#import-consent').checked = true; $('#import-consent').listeners.change();
  assert.equal($('#import-restore').disabled, false);
  $('#import-restore').click(); $('#import-restore').click();
  assert.equal(storage.writes, 1); assert.equal(refreshed, 1);
  assert.equal(JSON.parse(storage.value).schemaVersion, 6);
  console.log('OK UI: preview, explicit consent, backup download, cancellation during read, double click, refresh after readback');
})().catch(error => { console.error(error); process.exitCode = 1; });
