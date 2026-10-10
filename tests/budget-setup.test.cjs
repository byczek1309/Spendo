const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app.js', 'utf8');
const nodes = new Map();
function $(key) {
  if (!nodes.has(key)) {
    const classes = new Set();
    nodes.set(key, { value: '', textContent: '', checked: false, disabled: false, listeners: {},
      classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, toggle(c, on) { on ? classes.add(c) : classes.delete(c); }, contains(c) { return classes.has(c); } },
      addEventListener(event, fn) { this.listeners[event] = fn; }, querySelector() { return $('#submit'); } });
  }
  return nodes.get(key);
}
const fields = Object.fromEntries(['income', 'bills', 'fuel', 'savings'].map(name => [name, { value: '' }]));
$('#budget-form').elements = fields;
let selected = [], contributions = [], updates = 0, navigations = [], toasts = [], lastLimit;
const storage = { value: null, writes: 0, fail: false, duringSave: null,
  getItem() { return this.value; }, setItem(key, value) { assert.equal(key, 'dzienny.v1'); this.duringSave?.(); if (this.fail) throw Error('QuotaExceededError'); this.writes++; this.value = value; } };
const screens = ['today', 'budget'].map(name => ({ ...$(`#screen-${name}`), id: `screen-${name}` }));
const tabs = ['today', 'budget'].map(name => ({ ...$(`#tab-${name}`), dataset: { screen: name } }));
const ctx = { window: { confirm: () => true, scrollTo(options) { navigations.push(options); } }, Blob, $, KEY: 'dzienny.v1', localStorage: storage, storage,
  $$(selector) { if (selector === '[data-plan-bill-id]:checked') return selected; if (selector === '[data-goal-contribution]') return contributions; if (selector === '.screen') return screens; if (selector === '.tab') return tabs; return []; },
  money: value => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value),
  showToast(message) { toasts.push(message); }, update() { updates++; const period = ctx.selectedPeriod; const amounts = ctx.Core.poolAmounts(ctx.Core.budgetForPeriod(ctx.state.budgets, period)); lastLimit = ctx.Core.dailyPlan(period, amounts.life, ctx.state.expenses, '2026-10-10').safeToday; },
  allocatableGoals() { return ctx.state.savingsGoals.filter(goal => goal.active); }, updateBudgetGoalAllocationSummary() {} };
vm.createContext(ctx);
for (const file of ['budget-core.js', 'backup-core.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
ctx.Core = ctx.window.SpendoBudgetCore;
function extract(start, end) { vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), ctx); }
extract('  function parseDecimalAmount(', '  function updateBudgetGoalAllocationSummary(');
extract('  function selectedBillPlanFromForm(', '  function showCurrentBillTemplate(');
extract('  function budgetFormPreview(', '  function refreshRecurringBillLibraryPreservingDraft(');
extract('  function showScreen(', '  function showToast(');
extract('  let budgetSaveBusy = false;', "  $('#budget-goals-toggle').addEventListener");
extract("  $('#budget-form').addEventListener('input'", "  $('#budget-go-to-goals').addEventListener");
const bill = { id: 'bill', name: 'Internet', amount: 50 };
const goal = { id: 'goal', name: 'Laptop', targetAmount: 2000, savedAmount: 100, contributionPerPeriod: 20, active: false, savedAmountConfirmed: true, createdAt: '', targetDate: '', lastAccruedPeriod: '' };
const expense = { id: 'expense', amount: 10, category: 'Jedzenie', poolId: 'life', date: '2026-10-09', note: '', created: '' };
const base = { ...ctx.Core.blankState(), payday: 1, expenses: [expense], savingsGoals: [goal], recurringBills: [bill] };
const clone = value => JSON.parse(JSON.stringify(value));
function reset() {
  ctx.state = clone(base); ctx.selectedPeriod = ctx.Core.periodForDate('2026-10-10', 1);
  storage.value = JSON.stringify(ctx.state); storage.writes = 0; storage.fail = false; storage.duringSave = null;
  for (const field of Object.values(fields)) field.value = '';
  selected = []; contributions = []; updates = 0; navigations = []; toasts = []; lastLimit = undefined;
  $('#budget-goals-toggle').checked = false; $('#budget-form-error').classList.add('hidden');
  screens.forEach(screen => screen.classList.toggle('active', screen.id === 'screen-budget'));
}
const submit = () => $('#budget-form').listeners.submit({ preventDefault() {}, currentTarget: $('#budget-form') });
const input = () => $('#budget-form').listeners.input();
function selectBill(amount = 50) { selected = [{ dataset: { planBillId: bill.id, planBillName: bill.name, planBillAmount: String(amount) } }]; ctx.updateBudgetBillSummary(); }
let count = 0;
function test(name, run) { reset(); run(); count++; console.log('OK ' + name); }
function unchanged(raw) { assert.equal(JSON.stringify(ctx.state), raw); assert.equal(storage.value, raw); assert.equal(storage.writes, 0); assert.equal(updates, 0); assert.equal(navigations.length, 0); assert.equal(toasts.length, 0); }
function unrelated() { for (const name of ['expenses', 'savingsGoals', 'recurringBills', 'payday', 'schemaVersion']) assert.equal(JSON.stringify(ctx.state[name]), JSON.stringify(base[name])); }
test('empty income blocks first save, does not write or navigate', () => { const raw = storage.value; submit(); unchanged(raw); assert.match($('#budget-form-error').textContent, /Wpisz dochód/); });
test('explicit zero has clear notice, can save zero allocations', () => { fields.income.value = '0'; input(); assert.match($('#budget-preview-message').textContent, /Wpisano 0 zł dochodu/); submit(); assert.equal(ctx.state.budgets['2026-10'].income, 0); assert.equal(toasts[0], 'Budżet gotowy'); assert.equal(lastLimit, 0); });
test('positive income with other fields empty saves zeros', () => { fields.income.value = '1000'; submit(); const plan = ctx.state.budgets['2026-10']; assert.equal(plan.bills, 0); assert.equal(plan.fuel, 0); assert.equal(plan.savings, 0); assert.equal(lastLimit, ctx.Core.roundMoney((1000 - 10) / 22)); unrelated(); });
test('live input updates all five totals without writing', () => { fields.income.value = '1000'; fields.bills.value = '100,50'; fields.fuel.value = '200'; fields.savings.value = '300'; input(); assert.equal($('#budget-preview-income').textContent, '1000,00 zł'); assert.equal($('#budget-preview-bills').textContent, '100,50 zł'); assert.equal($('#budget-preview-fuel').textContent, '200,00 zł'); assert.equal($('#budget-preview-savings').textContent, '300,00 zł'); assert.equal($('#budget-preview-life').textContent, '399,50 zł'); assert.equal(storage.writes, 0); });
test('selected bill snapshots included live and in saved plan', () => { fields.income.value = '1000'; fields.bills.value = '20'; selectBill(50); assert.equal($('#budget-preview-bills').textContent, '70,00 zł'); assert.equal($('#budget-preview-life').textContent, '930,00 zł'); submit(); assert.equal(ctx.state.budgets['2026-10'].bills, 70); assert.equal(ctx.state.budgets['2026-10'].selectedBills[0].amount, 50); unrelated(); });
test('unchecking bill updates summary', () => { fields.income.value = '100'; selectBill(); selected = []; ctx.updateBudgetBillSummary(); assert.equal($('#budget-preview-bills').textContent, '0,00 zł'); });
test('precise deficit blocks save; correcting amounts enables save', () => { const raw = storage.value; fields.income.value = '100'; fields.bills.value = '100,25'; fields.fuel.value = '10'; input(); assert.equal($('#budget-preview-life').textContent, '-10,25 zł'); assert.match($('#budget-preview-message').textContent, /przekraczają dochód o 10,25 zł/); submit(); unchanged(raw); fields.income.value = '110,25'; input(); submit(); assert.equal(storage.writes, 1); assert.equal(ctx.state.budgets['2026-10'].income, 110.25); });
test('zero income with positive reservations cannot save', () => { const raw = storage.value; fields.income.value = '0'; selectBill(); submit(); unchanged(raw); assert.match($('#budget-form-error').textContent, /50,00 zł/); });
test('first success navigates to today and scrolls to top', () => { fields.income.value = '1000'; submit(); assert.equal(toasts[0], 'Budżet gotowy'); assert.equal(screens[0].classList.contains('active'), true); assert.equal(navigations[0].top, 0); });
test('editing existing budget stays in budget and preserves paid status/history', () => { const plan = { income: 1000, bills: 50, fuel: 0, savings: 0, otherBills: 0, selectedBills: [{ ...bill, paid: true }] }; ctx.state.budgets = { '2026-09': clone(plan), '2026-10': clone(plan) }; storage.value = JSON.stringify(ctx.state); fields.income.value = '1200'; selectBill(); submit(); assert.equal(navigations.length, 0); assert.equal(toasts[0], 'Plan zapisany'); assert.equal(ctx.state.budgets['2026-10'].selectedBills[0].paid, true); assert.equal(JSON.stringify(ctx.state.budgets['2026-09']), JSON.stringify(plan)); unrelated(); });
test('existing user creating next period also stays in budget', () => { ctx.state.budgets['2026-09'] = { income: 100, bills: 0, fuel: 0, savings: 0, otherBills: 0, selectedBills: [] }; storage.value = JSON.stringify(ctx.state); fields.income.value = '100'; submit(); assert.equal(navigations.length, 0); assert.equal(toasts[0], 'Plan zapisany'); });
test('write failure preserves state including proposed goal allocation, no success UI', () => { ctx.state.savingsGoals[0].active = true; storage.value = JSON.stringify(ctx.state); const raw = storage.value; fields.income.value = '1000'; fields.savings.value = '100'; $('#budget-goals-toggle').checked = true; contributions = [{ dataset: { goalContribution: 'goal' }, value: '50' }]; storage.fail = true; submit(); unchanged(raw); assert.match($('#budget-form-error').textContent, /Nie udało się zapisać/); assert.equal($('#submit').disabled, false); });
test('retry after write failure succeeds', () => { fields.income.value = '100'; storage.fail = true; submit(); storage.fail = false; submit(); assert.equal(storage.writes, 1); assert.equal(toasts[0], 'Budżet gotowy'); });
test('summary initialization leaves existing data untouched', () => { ctx.state.budgets['2026-09'] = { income: 0, bills: 10, fuel: 0, savings: 0 }; storage.value = JSON.stringify(ctx.state); const raw = storage.value; input(); unchanged(raw); });
test('invalid numbers and excessive sums rejected', () => { const raw = storage.value; for (const value of ['NaN', 'Infinity', '-1', '1e309']) { fields.income.value = value; submit(); unchanged(raw); } fields.income.value = '1'; fields.fuel.value = '9'.repeat(310); submit(); unchanged(raw); });
test('saving still respects goal allocation validation', () => { const raw = storage.value; fields.income.value = '100'; fields.savings.value = '10'; $('#budget-goals-toggle').checked = true; contributions = [{ dataset: { goalContribution: 'goal' }, value: '20' }]; submit(); unchanged(raw); });
test('reentrant submit is ignored while saving', () => { fields.income.value = '100'; storage.duringSave = submit; submit(); assert.equal(storage.writes, 1); });
test('saved state reloads and roundtrips through backup', () => { fields.income.value = '1000'; selectBill(); submit(); assert.equal(JSON.stringify(ctx.Core.normalizeState(JSON.parse(storage.value)).state), JSON.stringify(ctx.state)); assert.equal(JSON.stringify(ctx.window.SpendoBackup.prepare(storage.value).state), JSON.stringify(ctx.state)); });
console.log(`${count} budget setup tests passed`);
