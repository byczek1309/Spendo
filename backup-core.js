((root) => {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const KEY = 'dzienny.v1';
  const fail = message => { throw new Error(message); };
  const check = (condition, path) => { if (!condition) fail(`Nieprawidłowe lub brakujące pole: ${path}.`); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.length <= 10000;
  const id = value => text(value) && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
  const amount = (value, positive = false) => typeof value === 'number' && Number.isFinite(value) && value >= (positive ? 0.01 : 0) && value <= 1e12;
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0100-01-01' && root.SpendoBudgetCore.dateKey(root.SpendoBudgetCore.parseDateKey(value)) === value;
  const stamp = value => value === '' || (text(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
  function safeTree(value, depth = 0) {
    check(depth <= 12, 'zbyt głęboka struktura');
    if (typeof value === 'number') check(Number.isFinite(value), 'liczba');
    if (typeof value === 'string') check(text(value), 'zbyt długi tekst');
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => {
        check(!['__proto__', 'prototype', 'constructor'].includes(key), 'niedozwolony klucz');
        safeTree(child, depth + 1);
      });
    }
  }
  function unique(items, path, validate) {
    check(Array.isArray(items) && items.length <= 50000, path);
    const seen = new Set();
    items.forEach(item => {
      check(object(item) && id(item.id) && !seen.has(item.id), `${path}: identyfikator`);
      seen.add(item.id);
      validate(item);
    });
  }
  function validate(source) {
    safeTree(source);
    check(object(source), 'stan aplikacji');
    const v = source.schemaVersion;
    if (Number.isInteger(v) && v > 6) fail('Ta kopia wymaga nowszej wersji Pulnora. Zaktualizuj aplikację.');
    check(Number.isInteger(v) && v >= 2 && v <= 6, 'obsługiwana wersja danych (2–6)');
    check(Number.isInteger(source.payday) && source.payday >= 1 && source.payday <= 31, 'payday');
    check(['system', 'light', 'dark'].includes(source.theme), 'theme');
    check(object(source.budgets), 'budgets');
    Object.entries(source.budgets).forEach(([month, plan]) => {
      check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && date(`${month}-01`) && object(plan), 'okres budżetowy');
      ['income', 'bills', 'fuel', 'savings'].forEach(field => check(amount(plan[field]), `budgets.${month}.${field}`));
      if (v >= 5 || 'selectedBills' in plan || 'otherBills' in plan) {
        check(amount(plan.otherBills), 'otherBills');
        unique(plan.selectedBills, 'selectedBills', bill => {
          check(text(bill.name) && bill.name.trim() && amount(bill.amount, true), 'migawka rachunku');
          check(typeof bill.paid === 'boolean' || (v < 6 && bill.paid === undefined), 'paid');
        });
        const total = root.SpendoBudgetCore.roundMoney(plan.otherBills + plan.selectedBills.reduce((sum, bill) => sum + bill.amount, 0));
        check(Math.abs(total - plan.bills) < 0.005, 'suma rachunków');
      }
    });
    unique(source.expenses, 'expenses', expense => {
      check(amount(expense.amount, true) && date(expense.date) && text(expense.category) && expense.category.trim(), 'wydatek');
      check(['life', 'fuel', 'bills', 'savings'].includes(expense.poolId) && text(expense.note) && stamp(expense.created), 'pola wydatku');
    });
    if (v >= 3 || 'savingsGoals' in source) unique(source.savingsGoals, 'savingsGoals', goal => {
      check(text(goal.name) && goal.name.trim(), 'nazwa celu');
      ['targetAmount', 'savedAmount', 'contributionPerPeriod'].forEach(field => check(amount(goal[field]), `cel.${field}`));
      check(goal.targetDate === '' || date(goal.targetDate), 'targetDate');
      check(goal.lastAccruedPeriod === '' || date(goal.lastAccruedPeriod), 'lastAccruedPeriod');
      check(stamp(goal.createdAt) && typeof goal.active === 'boolean', 'ustawienia celu');
      check(typeof goal.savedAmountConfirmed === 'boolean' || (v === 2 && goal.savedAmountConfirmed === undefined), 'savedAmountConfirmed');
    });
    if (v >= 4 || 'recurringBills' in source) unique(source.recurringBills, 'recurringBills', bill => {
      check(text(bill.name) && bill.name.trim() && amount(bill.amount, true), 'stały rachunek');
    });
    return v;
  }
  function prepare(content) {
    check(typeof content === 'string', 'zawartość pliku');
    if (new Blob([content]).size > MAX_BYTES) fail('Plik jest zbyt duży. Maksymalny rozmiar kopii to 5 MB.');
    let source;
    try { source = JSON.parse(content); } catch { fail('Plik nie zawiera poprawnego JSON.'); }
    const version = validate(source);
    const normalized = root.SpendoBudgetCore.normalizeState(source);
    validate(normalized.state);
    return { state: normalized.state, version, migrated: normalized.migrated };
  }
  // Web Storage setItem is atomic on failure. Never remove the original first.
  function restore(storage, prepared, expected) {
    const serialized = JSON.stringify(prepared.state);
    validate(prepared.state);
    const previous = storage.getItem(KEY);
    if (previous !== expected) fail('Dane zmieniły się od otwarcia podglądu. Wybierz kopię ponownie.');
    try { storage.setItem(KEY, serialized); } catch { fail('Nie udało się zapisać kopii (np. brak miejsca). Bieżące dane nie zostały zastąpione.'); }
    try {
      const readback = storage.getItem(KEY);
      check(readback === serialized, 'odczyt zapisanej kopii');
      return prepare(readback).state;
    } catch {
      try {
        // Avoid overwriting another tab's intervening save.
        const current = storage.getItem(KEY);
        if (current !== serialized) fail('zmiana w innej karcie');
        if (previous === null) storage.removeItem(KEY); else storage.setItem(KEY, previous);
        check(storage.getItem(KEY) === previous, 'cofnięcie');
      } catch { fail('Nie udało się potwierdzić zapisu ani cofnąć operacji. Nie edytuj danych; zachowaj kopie i ponownie otwórz aplikację.'); }
      fail('Nie udało się odczytać przywróconej kopii. Poprzednie dane zostały zachowane.');
    }
  }
  root.SpendoBackup = Object.freeze({ MAX_BYTES, prepare, restore });
})(window);
