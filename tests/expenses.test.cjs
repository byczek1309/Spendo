const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const nodes = new Map();
function $(key) {
  if (!nodes.has(key)) nodes.set(key, { value: '', textContent: '', disabled: false, hidden: false, focused: false,
    focus() { this.focused = true; }, classList: { add() {}, remove() {} },
    querySelector() { return $('#submit'); }, reset() {} });
  return nodes.get(key);
}
const fields = Object.fromEntries(['amount', 'date', 'category', 'note'].map(key => [key, { value: '', focus() {} }]));
$('#expense-form').elements = fields;
const store = { value: null, writes: 0, fail: false,
  getItem() { return this.value; }, setItem(key, value) { if (this.fail) throw Error('QuotaExceededError'); this.value = value; this.writes++; } };
let updates = 0, confirms = [], confirmation = true;
const ctx = { window: { confirm(message) { confirms.push(message); return confirmation; } }, Blob, $, KEY: 'dzienny.v1',
  localStorage: store, storage: store, document: { activeElement: { focus() {} } }, todayKey: '2026-10-09',
  setTimeout() {}, crypto: { randomUUID: () => 'new-id' }, update() { updates++; }, showToast() {}, updateCategoryPoolHint() {},
  money: value => String(value), periodLabel: period => `${period.start}–${period.end}` };
vm.createContext(ctx);
for (const file of ['budget-core.js', 'backup-core.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
ctx.Core = ctx.window.SpendoBudgetCore;
const source = fs.readFileSync('app.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('  function parseDecimalAmount('), source.indexOf('  function parseOptionalDecimalAmount(')), ctx);
vm.runInContext(source.slice(source.indexOf('  let expenseDraft = null;'), source.indexOf('  function closeGoalForm()')), ctx);
const original = { id: 'stable-id', amount: 100, category: 'Jedzenie', poolId: 'life', date: '2026-09-20', note: 'Obiad', created: '2026-09-20T10:00:00.000Z' };
const other = { ...original, id: 'other-id', amount: 15, category: 'Paliwo', poolId: 'fuel' };
const base = { ...ctx.Core.blankState(), payday: 15, expenses: [original, other],
  budgets: { '2026-09': { income: 6000, bills: 200, fuel: 500, savings: 1000, otherBills: 0, selectedBills: [{ id: 'bill', name: 'Rachunek', amount: 200, paid: true }] } },
  recurringBills: [{ id: 'bill', name: 'Szablon', amount: 250 }],
  savingsGoals: [{ id: 'goal', name: 'Cel', targetAmount: 2000, savedAmount: 500, contributionPerPeriod: 100, targetDate: '', lastAccruedPeriod: '', active: true, savedAmountConfirmed: true, createdAt: '' }] };
let tests = 0;
function reset() { ctx.state = JSON.parse(JSON.stringify(base)); store.value = JSON.stringify(ctx.state); store.writes = 0; store.fail = false; updates = 0; confirms = []; confirmation = true; ctx.closeModal(); ctx.closeExpenseDelete(); }
function run(name, fn) { reset(); fn(); tests++; console.log('OK ' + name); }
const submit = () => ctx.saveExpense({ preventDefault() {}, currentTarget: $('#expense-form') });
const edit = (changes = {}) => { ctx.openModal('stable-id'); for (const [key, value] of Object.entries(changes)) fields[key].value = value; submit(); };
const spending = date => ctx.Core.poolSpending(ctx.Core.expensesInPeriod(ctx.state.expenses, ctx.Core.periodForDate(date, ctx.state.payday)));
const unchanged = () => assert.equal(JSON.stringify(ctx.state), JSON.stringify(base));
const related = () => { for (const key of ['budgets', 'savingsGoals', 'recurringBills']) assert.equal(JSON.stringify(ctx.state[key]), JSON.stringify(base[key])); };
run('100 → 80, comma decimal, stable ID and creation timestamp, no duplicates', () => {
  edit({ amount: '80,00' }); assert.equal(ctx.state.expenses[0].amount, 80); assert.equal(ctx.state.expenses.length, 2);
  assert.equal(ctx.state.expenses[0].id, original.id); assert.equal(ctx.state.expenses[0].created, original.created);
  assert.equal(spending('2026-09-20').life, 80); assert.equal(store.writes, 1); related();
});
run('Jedzenie → Paliwo transfers pool', () => { edit({ category: 'Paliwo' }); assert.equal(spending('2026-09-20').life, 0); assert.equal(spending('2026-09-20').fuel, 115); });
run('Paliwo → Dom transfers pool', () => {
  ctx.openModal('other-id'); fields.category.value = 'Dom'; submit();
  assert.equal(spending('2026-09-20').fuel, 0); assert.equal(spending('2026-09-20').bills, 15); related();
});
run('description saved literally and prefilled', () => { ctx.openModal('stable-id'); assert.equal(fields.note.value, 'Obiad'); fields.note.value = '<b>Nowy opis</b>'; submit(); assert.equal(ctx.state.expenses[0].note, '<b>Nowy opis</b>'); });
run('same payday period across calendar month requires no confirmation', () => { edit({ date: '2026-10-10' }); assert.equal(confirms.length, 0); assert.equal(spending('2026-09-20').life, 100); });
run('payday boundary move requires confirmation and transfers period', () => {
  edit({ date: '2026-10-15' }); assert.equal(confirms.length, 1); assert.match(confirms[0], /2026-09-15/); assert.match(confirms[0], /2026-10-15/);
  assert.equal(spending('2026-09-20').life, 0); assert.equal(spending('2026-10-15').life, 100); assert.equal(ctx.state.expenses[0].date, '2026-10-15'); related();
});
run('cancel period change', () => { confirmation = false; edit({ date: '2026-10-15' }); unchanged(); assert.equal(store.writes, 0); });
run('cancel edit discards fields', () => { ctx.openModal('stable-id'); fields.amount.value = '5'; ctx.closeModal(); submit(); unchanged(); assert.equal(store.writes, 0); });
run('delete cancel defaults to safe option', () => { ctx.beginExpenseDelete('stable-id'); assert.equal($('#expense-delete-cancel').focused, true); assert.match($('#expense-delete-name').textContent, /Obiad — 100 zł/); ctx.closeExpenseDelete(); ctx.confirmExpenseDelete(); unchanged(); assert.equal(store.writes, 0); });
run('confirmed deletion affects only selected expense, repeated confirmation ignored', () => {
  ctx.beginExpenseDelete('stable-id'); ctx.confirmExpenseDelete(); ctx.confirmExpenseDelete(); assert.equal(store.writes, 1); assert.equal(ctx.state.expenses.length, 1); assert.equal(ctx.state.expenses[0].id, 'other-id'); related(); assert.equal(updates, 1);
});
run('double submit performs one operation', () => { edit({ amount: '80' }); submit(); assert.equal(store.writes, 1); assert.equal(ctx.state.expenses.length, 2); });
run('adding still works with comma amount and ignores repeated submit', () => { ctx.openModal(); fields.amount.value = '12,50'; fields.category.value = 'Jedzenie'; fields.note.value = 'Nowy'; submit(); submit(); assert.equal(ctx.state.expenses.length, 3); assert.equal(ctx.state.expenses[2].amount, 12.5); assert.equal(ctx.state.expenses[2].poolId, 'life'); assert.equal(store.writes, 1); related(); });
run('bad values and invalid categories/dates refused', () => {
  for (const change of [{ amount: 'NaN' }, { amount: 'Infinity' }, { amount: '-5' }, { amount: '0' }, { amount: '1e309' }, { amount: '1,234' }, { date: '2026-02-30' }, { category: 'Unknown' }]) { edit(change); unchanged(); }
  assert.equal(store.writes, 0);
});
run('quota error editing or deleting keeps memory and storage intact', () => {
  const raw = store.value; store.fail = true; edit({ amount: '80' }); unchanged(); assert.equal(store.value, raw);
  ctx.beginExpenseDelete('stable-id'); ctx.confirmExpenseDelete(); unchanged(); assert.equal(store.value, raw); assert.equal(updates, 0);
});
run('changed storage refuses overwrite', () => { ctx.openModal('stable-id'); store.value = 'another-tab'; fields.amount.value = '80'; submit(); unchanged(); assert.equal(store.value, 'another-tab'); });
run('already stale state cannot open edit and overwrite newer stored data', () => { const changed = JSON.parse(store.value); changed.expenses[0].amount = 77; store.value = JSON.stringify(changed); ctx.openModal('stable-id'); submit(); unchanged(); assert.equal(store.writes, 0); assert.equal(JSON.parse(store.value).expenses[0].amount, 77); });
run('changed or ambiguous ID refuses overwrite', () => {
  ctx.openModal('stable-id'); ctx.state.expenses[0].note = 'Changed'; submit(); assert.equal(store.writes, 0);
  ctx.state.expenses.push({ ...ctx.state.expenses[0] }); ctx.openModal('stable-id'); submit(); assert.equal(store.writes, 0);
});
run('reload and backup roundtrip preserve edited record and related data', () => {
  edit({ amount: '80', category: 'Dom', note: 'Nowe', date: '2026-10-15' });
  const reloaded = ctx.Core.normalizeState(JSON.parse(store.value)).state;
  assert.equal(JSON.stringify(reloaded), JSON.stringify(ctx.state));
  const imported = ctx.window.SpendoBackup.prepare(JSON.stringify(reloaded, null, 2));
  assert.equal(JSON.stringify(imported.state), JSON.stringify(ctx.state)); related();
});
run('daily limit recomputes from replacement amount without changing formula', () => {
  edit({ amount: '80' });
  const period = ctx.Core.periodForDate('2026-09-21', 15);
  const plan = ctx.Core.dailyPlan(period, 4300, ctx.state.expenses, '2026-09-21');
  assert.equal(plan.remainingLife, 4220); assert.equal(plan.periodSpent, 80);
  assert.equal(plan.availableToday, ctx.Core.roundMoney(4220 / ctx.Core.dayCount('2026-09-21', period.end)));
});
run('history and statistics use updated arrays and escaped rendering', () => {
  assert.match(source, /return heading \+ expenseRow\(expense, true\)/);
  assert.match(source, /renderStats\(expenses, amounts\)/);
  assert.match(source, /renderHistory\(\)/);
  assert.match(source, /esc\(expense.note\)/);
  edit({ amount: '80' }); assert.equal(updates, 1); assert.equal(ctx.state.expenses.reduce((sum, e) => sum + e.amount, 0), 95);
});
console.log(`${tests} expense tests passed`);
