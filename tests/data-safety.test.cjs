const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const current = { schemaVersion: 6, payday: 10, budgets: {}, expenses: [], savingsGoals: [], recurringBills: [], theme: 'system' };
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(raw = JSON.stringify(current), failure = '') {
  const native = { value: raw, writes: 0, removes: 0, failure,
    getItem() { if (this.failure === 'read') throw Error('SecurityError'); return this.value; },
    setItem(key, value) { if (this.failure === 'write') throw Error('QuotaExceededError'); this.writes++; this.value = value; },
    removeItem() { this.removes++; this.value = null; } };
  const blocked = [];
  const context = { window: {}, Blob };
  vm.createContext(context);
  for (const file of ['budget-core.js', 'backup-core.js', 'data-safety.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  const session = context.window.SpendoDataSafety.create(() => native, message => blocked.push(message));
  return { context, session, native, blocked };
}
for (const version of [7, 999]) test(`schema ${version}: before normalization, no writes even setting attempt or restart`, () => {
  const raw = JSON.stringify({ ...current, schemaVersion: version });
  const f = fixture(raw); let normalized = 0;
  f.context.window.SpendoBudgetCore = { ...f.context.window.SpendoBudgetCore, normalizeState() { normalized++; throw Error('must not run'); } };
  assert.throws(() => f.session.load(), /nowszą wersję/);
  assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify({ ...current, theme: 'dark' })));
  assert.equal(normalized, 0); assert.equal(f.native.value, raw); assert.equal(f.native.writes, 0);
  const restart = f.context.window.SpendoDataSafety.create(() => f.native);
  assert.throws(() => restart.load()); assert.equal(f.native.writes, 0);
});
for (const raw of ['{bad', '', 'null', '[]', '{}', '{"schemaVersion":"6"}', '{"schemaVersion":0}', '{"schemaVersion":6.5}', JSON.stringify({ ...current, expenses: null }), JSON.stringify({ ...current, payday: 32 })]) test(`damaged/invalid stored source preserved: ${raw.slice(0, 40)}`, () => {
  const f = fixture(raw); assert.throws(() => f.session.load()); assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify(current))); assert.equal(f.native.value, raw); assert.equal(f.native.writes, 0); assert.equal(f.native.removes, 0);
});
test('schema 6 loads without an automatic write and normal changes persist', () => {
  const f = fixture(); const state = f.session.load(); assert.equal(JSON.stringify(state), JSON.stringify(current)); assert.equal(f.native.writes, 0);
  f.session.setItem('dzienny.v1', JSON.stringify({ ...state, theme: 'dark' })); assert.equal(JSON.parse(f.native.value).schemaVersion, 6); assert.equal(JSON.parse(f.native.value).theme, 'dark');
});
test('only absent storage is a new installation; no write at startup', () => { const f = fixture(null); assert.equal(f.session.load().schemaVersion, 6); assert.equal(f.native.writes, 0); f.session.setItem('dzienny.v1', JSON.stringify(current)); assert.equal(f.native.writes, 1); });
test('read failure blocks all subsequent writes', () => { const f = fixture(undefined, 'read'); assert.throws(() => f.session.load()); f.native.failure = ''; assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify(current))); assert.equal(f.native.writes, 0); });
test('quota failure leaves previous bytes and safe in-memory snapshot; retry works', () => { const f = fixture(); f.session.load(); const raw = f.native.value; f.native.failure = 'write'; assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify({ ...current, theme: 'dark' })), /Poprzedni zapis/); assert.equal(f.native.value, raw); assert.equal(f.session.snapshotState().theme, 'system'); f.native.failure = ''; f.session.setItem('dzienny.v1', JSON.stringify({ ...current, theme: 'dark' })); assert.equal(f.native.writes, 1); });
for (const external of [JSON.stringify({ ...current, theme: 'dark' }), JSON.stringify({ ...current, schemaVersion: 7 }), '{bad', null]) test('external change/deletion cannot be overwritten: ' + String(external).slice(0, 35), () => { const f = fixture(); f.session.load(); f.native.value = external; assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify(current))); assert.equal(f.native.value, external); assert.equal(f.native.writes, 0); assert.ok(f.blocked.length > 0); });
test('guard rejects unsupported outgoing schema and deletion', () => { const f = fixture(); f.session.load(); assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify({ ...current, schemaVersion: 7 }))); assert.throws(() => f.session.removeItem('dzienny.v1')); assert.equal(f.native.writes, 0); assert.equal(f.native.removes, 0); });
for (const version of [2, 3, 4, 5]) test(`supported schema ${version}: existing normalization in memory, original bytes untouched`, () => { const old = { ...current, schemaVersion: version }; if (version < 4) delete old.recurringBills; if (version < 3) delete old.savingsGoals; const raw = JSON.stringify(old); const f = fixture(raw); assert.equal(f.session.load().schemaVersion, 6); assert.equal(f.native.value, raw); assert.equal(f.native.writes, 0); });
test('new goal with existing optional accrual field omission stays usable locally', () => {
  const f = fixture(); f.session.load(); const state = clone(current); state.savingsGoals = [{ id: 'g1', name: 'Test', targetAmount: 100, savedAmount: 0, contributionPerPeriod: 10, targetDate: '', active: true, savedAmountConfirmed: true, createdAt: '2026-10-10T10:00:00.000Z' }]; f.session.setItem('dzienny.v1', JSON.stringify(state)); assert.equal(f.session.snapshotState().savingsGoals[0].savedAmount, 0);
});
test('ordinary backup import/export through central guard remains compatible', () => {
  const f = fixture(); const loaded = f.session.load(); const prepared = f.context.window.SpendoBackup.prepare(JSON.stringify(loaded, null, 2)); const restored = f.context.window.SpendoBackup.restore(f.session, prepared, f.native.value); assert.equal(JSON.stringify(restored), JSON.stringify(loaded)); assert.equal(f.native.writes, 1);
});

// Run the real app entry point with an isolated fake DOM and storage.
function app(raw, failure = '', prepare = () => {}) {
  const f = fixture(raw, failure), nodes = new Map(), events = {};
  function node(key) {
    if (!nodes.has(key)) {
      const classes = new Set(['hidden']);
      const element = { value: '', checked: false, disabled: false, dataset: {}, style: {}, textContent: '', innerHTML: '', listeners: {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
        addEventListener(event, fn) { this.listeners[event] = fn; }, querySelector: sub => node(key + ' ' + sub), querySelectorAll: () => [], setAttribute() {}, focus() {}, reset() {}, click() { this.listeners.click?.(); } };
      element.elements = new Proxy({}, { get: (_, field) => node(key + ':' + String(field)) }); nodes.set(key, element);
    }
    return nodes.get(key);
  }
  const w = f.context.window;
  Object.defineProperty(w, 'localStorage', { get() { if (failure === 'getter') throw Error('SecurityError'); return f.native; } });
  w.addEventListener = (event, fn) => events[event] = fn; w.scrollTo = () => {};
  Object.assign(f.context, { document: { body: node('body'), querySelector: node, querySelectorAll: () => [], addEventListener(event, fn) { events['document:' + event] = fn; }, createElement: key => node(key), activeElement: node('focus') },
    navigator: {}, location: { protocol: 'https:' }, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 1, clearTimeout() {}, crypto: { randomUUID: () => 'test-id' }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} } });
  prepare(f);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), f.context);
  return { ...f, node, events };
}
for (const method of ['normalizeState', 'blankState']) {
  const raw = method === 'normalizeState' ? JSON.stringify(current) : null;
  const inject = f => {
    f.context.window.SpendoBudgetCore = { ...f.context.window.SpendoBudgetCore,
      [method]() { throw Error('simulated initialization failure'); } };
  };
  test(`${method} exception protects storage and permanently blocks session writes`, () => {
    const f = fixture(raw); inject(f);
    assert.throws(() => f.session.load(), /bezpiecznie przygotować/);
    assert.equal(f.blocked.length, 1);
    assert.throws(() => f.session.setItem('dzienny.v1', JSON.stringify(current)), /Zapis został zablokowany/);
    assert.throws(() => f.session.load(), /Zapis został zablokowany/);
    assert.equal(f.native.value, raw);
    assert.equal(f.native.writes, 0); assert.equal(f.native.removes, 0);
  });
  test(`real app ${method} exception displays protection without success or editing handlers`, () => {
    const f = app(raw, '', inject);
    assert.equal(f.node('#data-protection').classList.contains('hidden'), false);
    assert.equal(f.node('.app-shell').classList.contains('hidden'), true);
    assert.match(f.node('#data-protection-message').textContent, /bezpiecznie przygotować/);
    assert.equal(f.node('#theme-select').listeners.change, undefined);
    assert.equal(f.node('#budget-form').listeners.submit, undefined);
    assert.equal(f.native.value, raw);
    assert.equal(f.native.writes, 0); assert.equal(f.native.removes, 0);
  });
}
for (const raw of [JSON.stringify({ ...current, schemaVersion: 7 }), '{bad']) test('real app startup protects source and does not register editing handlers', () => {
  const f = app(raw); assert.equal(f.native.value, raw); assert.equal(f.native.writes, 0); assert.equal(f.node('#data-protection').classList.contains('hidden'), false); assert.equal(f.node('#theme-select').listeners.change, undefined); assert.equal(f.node('#budget-form').listeners.submit, undefined);
});
test('localStorage getter failure shows protection without writes', () => { const f = app(JSON.stringify(current), 'getter'); assert.equal(f.native.writes, 0); assert.match(f.node('#data-protection-message').textContent, /pamięci urządzenia/); });
test('real schema 6 app works, theme save and export stay available', () => { const f = app(JSON.stringify(current)); assert.equal(f.native.writes, 0); f.node('#theme-select').listeners.change({ target: { value: 'dark' } }); assert.equal(JSON.parse(f.native.value).theme, 'dark'); assert.equal(f.native.writes, 1); assert.equal(typeof f.node('#export-data').listeners.click, 'function'); f.node('#export-data').listeners.click(); });
test('real theme operation cannot overwrite newer schema introduced after startup', () => { const f = app(JSON.stringify(current)); const newer = JSON.stringify({ ...current, schemaVersion: 7 }); f.native.value = newer; f.node('#theme-select').listeners.change({ target: { value: 'dark' } }); assert.equal(f.native.value, newer); assert.equal(f.native.writes, 0); assert.equal(f.node('#data-protection').classList.contains('hidden'), false); });
test('real quota failure rolls back theme in memory and shows no success', () => { const f = app(JSON.stringify(current)); f.native.failure = 'write'; f.node('#theme-select').listeners.change({ target: { value: 'dark' } }); assert.equal(JSON.parse(f.native.value).theme, 'system'); assert.equal(f.node('#theme-select').value, 'system'); assert.equal(f.node('#data-save-error').classList.contains('hidden'), false); });
test('storage event checks changes before next user operation', () => { const f = app(JSON.stringify(current)); f.native.value = JSON.stringify({ ...current, schemaVersion: 999 }); f.events.storage({ key: 'dzienny.v1' }); assert.equal(f.node('#data-protection').classList.contains('hidden'), false); assert.equal(f.native.writes, 0); });
test('supported old state can open expense editing without persisting startup normalization', () => {
  const raw = JSON.stringify({ ...current, schemaVersion: 2, expenses: [{ id: 'e1', amount: 100, date: '2026-10-01', category: 'Jedzenie', poolId: 'life', note: 'Test', created: '' }] });
  const f = app(raw);
  f.events['document:click']({ target: { closest: selector => selector === '[data-edit-expense]' ? { dataset: { editExpense: 'e1' } } : null } });
  assert.equal(f.node('#expense-modal').classList.contains('hidden'), false);
  assert.equal(f.node('#expense-form').elements.amount.value, '100');
  assert.equal(f.native.value, raw); assert.equal(f.native.writes, 0);
});
test('goal operation rolls back on quota error, can retry and preserves actual savings', () => {
  const original = { ...current, savingsGoals: [{ id: 'g1', name: 'Test', targetAmount: 1000, savedAmount: 100, contributionPerPeriod: 20, targetDate: '', createdAt: '', active: true, savedAmountConfirmed: true }] };
  const f = app(JSON.stringify(original));
  const event = { target: { closest: () => ({ dataset: { goalAction: 'pause', goalId: 'g1' } }) } };
  f.native.failure = 'write'; f.node('#goals-list').listeners.click(event);
  assert.equal(JSON.parse(f.native.value).savingsGoals[0].active, true);
  f.native.failure = ''; f.node('#goals-list').listeners.click(event);
  assert.equal(JSON.parse(f.native.value).savingsGoals[0].active, false);
  assert.equal(JSON.parse(f.native.value).savingsGoals[0].savedAmount, 100);
  assert.equal(f.native.writes, 1);
});
test('all app native writes routed to central adapter; finance algorithms untouched', () => { const source = fs.readFileSync('app.js', 'utf8'); assert.ok(!/localStorage\.(setItem|removeItem|clear|getItem)/.test(source)); assert.match(source, /SpendoBackup.restore\(storage,/); assert.match(source, /if \(!save\(\)\) return/); });

test('service worker installs complete assets and serves app plus protection offline', async () => {
  const events = {}, files = new Map(), names = new Set(['spendo-v40']);
  let networkCalls = 0;
  const context = {
    self: { addEventListener: (name, handler) => events[name] = handler, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      open: async name => { names.add(name); return { addAll: async paths => { for (const path of paths) files.set(path, fs.readFileSync(path === '/' ? 'index.html' : '.' + path, 'utf8')); } }; },
      keys: async () => [...names], delete: async name => names.delete(name),
      match: async request => files.get(typeof request === 'string' ? request : new URL(request.url).pathname)
    },
    fetch: async () => { networkCalls++; throw Error('offline'); }, URL, location: { origin: 'http://localhost:8765' }
  };
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), context);
  let pending;
  events.install({ waitUntil: promise => pending = promise }); await pending;
  events.activate({ waitUntil: promise => pending = promise }); await pending;
  assert.deepEqual([...names], ['spendo-v41']);
  for (const path of ['/', '/index.html', '/app.js', '/data-safety.js', '/backup-core.js', '/budget-core.js']) {
    events.fetch({ request: { method: 'GET', url: 'http://localhost:8765' + path }, respondWith: promise => pending = promise });
    assert.equal(await pending, files.get(path));
  }
  assert.equal(networkCalls, 0);
  assert.match(files.get('/index.html'), /src="\/data-safety.js"/);
});
