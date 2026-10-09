const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, Blob };
vm.createContext(context);
for (const file of ['budget-core.js', 'backup-core.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
const core = context.window.SpendoBudgetCore;
const backup = context.window.SpendoBackup;
const copy = () => JSON.parse(JSON.stringify(fixture));
const fixture = { ...core.blankState(), payday: 15, theme: 'dark',
  budgets: { '2026-09': { income: 6000, bills: 250, fuel: 500, savings: 1000, otherBills: 50,
    selectedBills: [{ id: 'b1', name: '<img onerror=alert(1)>', amount: 200, paid: true }] },
    '2026-10': { income: 6100, bills: 300, fuel: 500, savings: 1000, otherBills: 50,
    selectedBills: [{ id: 'b1', name: 'Nowa migawka', amount: 250, paid: false }] } },
  expenses: [{ id: 'e1', amount: 12.34, category: 'Jedzenie', poolId: 'life', date: '2026-09-17', note: '<script>bad</script>', created: '2026-09-17T10:00:00.000Z' }],
  savingsGoals: [{ id: 'g1', name: 'Laptop', targetAmount: 5000, savedAmount: 800, contributionPerPeriod: 200,
    active: true, savedAmountConfirmed: true, targetDate: '2027-01-01', createdAt: '2026-09-17T10:00:00.000Z', lastAccruedPeriod: '' }],
  recurringBills: [{ id: 'b1', name: 'Aktualny szablon', amount: 350 }] };
let count = 0;
function test(name, run) { run(); count++; console.log(`OK ${name}`); }
function storage(initial = 'original') {
  return { value: initial, writes: 0, getItem() { return this.value; },
    setItem(key, value) { assert.equal(key, 'dzienny.v1'); this.writes++; this.value = value; }, removeItem() { this.value = null; } };
}
const prepared = backup.prepare(JSON.stringify(fixture, null, 2));
test('export/import preserves all financial data, status and historical snapshots', () => assert.equal(JSON.stringify(prepared.state), JSON.stringify(fixture)));
test('single write, readback, reload and unchanged budget/goal calculations', () => {
  const store = storage();
  const restored = backup.restore(store, prepared, 'original');
  assert.equal(store.writes, 1);
  assert.equal(JSON.stringify(restored), JSON.stringify(fixture));
  assert.equal(JSON.stringify(core.normalizeState(JSON.parse(store.value)).state), JSON.stringify(fixture));
  const period = core.periodForDate('2026-09-17', fixture.payday);
  assert.equal(JSON.stringify(core.dailyPlan(period, 3000, restored.expenses, '2026-09-17')), JSON.stringify(core.dailyPlan(period, 3000, fixture.expenses, '2026-09-17')));
  assert.equal(core.goalRemaining(restored.savingsGoals[0]), 4200);
});
for (const version of [2, 3, 4, 5]) test(`historical schema ${version} migrates safely`, () => {
  const old = copy(); old.schemaVersion = version;
  if (version < 4) delete old.recurringBills;
  if (version < 5) for (const plan of Object.values(old.budgets)) { delete plan.otherBills; delete plan.selectedBills; }
  if (version === 2) delete old.savingsGoals[0].savedAmountConfirmed;
  if (version === 5) for (const plan of Object.values(old.budgets)) for (const bill of plan.selectedBills) delete bill.paid;
  const result = backup.prepare(JSON.stringify(old));
  assert.equal(result.state.schemaVersion, 6); assert.equal(result.migrated, true);
  assert.equal(result.state.expenses.length, 1);
  if (version === 2) assert.equal(result.state.savingsGoals[0].savedAmountConfirmed, false);
});
function reject(name, mutate) { test(name, () => { const bad = copy(); mutate(bad); const store = storage(); assert.throws(() => backup.prepare(JSON.stringify(bad))); assert.equal(store.value, 'original'); assert.equal(store.writes, 0); }); }
reject('future schema', bad => bad.schemaVersion = 7);
reject('missing expenses', bad => delete bad.expenses);
reject('wrong amount type', bad => bad.expenses[0].amount = 'NaN');
reject('negative amount', bad => bad.expenses[0].amount = -1);
reject('Infinity serialized as null', bad => bad.expenses[0].amount = Infinity);
reject('NaN serialized as null', bad => bad.expenses[0].amount = NaN);
reject('unsafe huge amount', bad => bad.expenses[0].amount = 1e100);
reject('invalid calendar date', bad => bad.expenses[0].date = '2026-02-30');
reject('invalid timestamp', bad => bad.expenses[0].created = 'bad');
reject('duplicate ids', bad => bad.expenses.push(bad.expenses[0]));
reject('duplicate snapshots', bad => bad.budgets['2026-09'].selectedBills.push(bad.budgets['2026-09'].selectedBills[0]));
reject('inconsistent bill sum', bad => bad.budgets['2026-09'].bills = 999);
reject('invalid pool relationship', bad => bad.expenses[0].poolId = 'unknown');
reject('missing current goal balance confirmation', bad => delete bad.savingsGoals[0].savedAmountConfirmed);
test('damaged JSON, unrelated object, overflowing number and prototype keys rejected', () => {
  for (const data of ['{', '{}', '{"schemaVersion":1e999}', '{"__proto__":{}}', '{"constructor":{}}']) assert.throws(() => backup.prepare(data));
});
test('5 MB limit', () => assert.throws(() => backup.prepare(' '.repeat(backup.MAX_BYTES + 1)), /zbyt duży/));
test('preview and cancellation do not write', () => { const store = storage(); backup.prepare(JSON.stringify(fixture)); assert.equal(store.writes, 0); assert.equal(store.value, 'original'); });
test('quota failure preserves original', () => { const store = storage(); store.setItem = () => { throw Error('QuotaExceededError'); }; assert.throws(() => backup.restore(store, prepared, 'original'), /nie zostały zastąpione/); assert.equal(store.value, 'original'); });
test('changed data and repeated restore rejected without second write', () => {
  const store = storage(); backup.restore(store, prepared, 'original');
  assert.throws(() => backup.restore(store, prepared, 'original'), /zmieniły się/); assert.equal(store.writes, 1);
});
test('readback failure rolls back if storage recovers', () => {
  const store = storage(); let reads = 0;
  store.getItem = function() { reads++; if (reads === 2) throw Error('transient'); return this.value; };
  assert.throws(() => backup.restore(store, prepared, 'original'), /Poprzednie dane/);
  assert.equal(store.value, 'original');
});
test('permanent read failure reports rollback limitation', () => {
  const store = storage(); let reads = 0;
  store.getItem = function() { if (++reads > 1) throw Error('blocked'); return this.value; };
  assert.throws(() => backup.restore(store, prepared, 'original'), /ani cofnąć/);
});
console.log(`${count} tests passed`);
