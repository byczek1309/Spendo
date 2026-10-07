((root) => {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const pools = [
    { id: 'bills', icon: '🧾', name: 'Rachunki', field: 'bills' },
    { id: 'fuel', icon: '⛽', name: 'Paliwo', field: 'fuel' },
    { id: 'savings', icon: '🏦', name: 'Oszczędności', field: 'savings' },
    { id: 'life', icon: '💳', name: 'Na życie', field: null }
  ];
  const categories = [
    { id: 'food', icon: '🍔', name: 'Jedzenie', poolId: 'life' },
    { id: 'fuel', icon: '⛽', name: 'Paliwo', poolId: 'fuel' },
    { id: 'home', icon: '🏠', name: 'Dom', poolId: 'bills' },
    { id: 'fun', icon: '🎮', name: 'Rozrywka', poolId: 'life' },
    { id: 'shopping', icon: '🛍️', name: 'Zakupy', poolId: 'life' },
    { id: 'transport', icon: '🚗', name: 'Transport', poolId: 'life' },
    { id: 'other', icon: '📦', name: 'Inne', poolId: 'life' }
  ];
  const poolIds = new Set(pools.map(pool => pool.id));

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDateKey(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function monthKey(dateOrKey) {
    const value = typeof dateOrKey === 'string' ? dateOrKey : dateKey(dateOrKey);
    return value.slice(0, 7);
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function startOfMonth(year, monthIndex, payday) {
    const firstOfMonth = new Date(year, monthIndex, 1, 12);
    const day = Math.min(payday, daysInMonth(year, monthIndex));
    return dateKey(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), day, 12));
  }

  function addDays(value, offset) {
    const date = parseDateKey(value);
    date.setDate(date.getDate() + offset);
    return dateKey(date);
  }

  function dayNumber(value) {
    const [year, month, day] = value.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  }

  function dayCount(first, last) {
    return dayNumber(last) - dayNumber(first) + 1;
  }

  function normalizedPayday(value) {
    const day = Number(value);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
  }

  function periodForDate(value, payday = 1) {
    payday = normalizedPayday(payday);
    const date = parseDateKey(value);
    const currentMonthStart = startOfMonth(date.getFullYear(), date.getMonth(), payday);
    let start;

    if (value >= currentMonthStart) {
      start = currentMonthStart;
    } else {
      start = startOfMonth(date.getFullYear(), date.getMonth() - 1, payday);
    }

    const startDate = parseDateKey(start);
    const nextMonthStart = startOfMonth(startDate.getFullYear(), startDate.getMonth() + 1, payday);
    const end = addDays(nextMonthStart, -1);

    return {
      start,
      end,
      planMonth: monthKey(start),
      days: dayCount(start, end)
    };
  }

  function periodStartingInMonth(value, payday = 1) {
    const [year, month] = value.split('-').map(Number);
    const start = startOfMonth(year, month - 1, normalizedPayday(payday));
    return periodForDate(start, payday);
  }

  function dateIsInPeriod(value, period) {
    return value >= period.start && value <= period.end;
  }

  function categoryFor(value) {
    return categories.find(category => category.id === value || category.name === value) || categories[categories.length - 1];
  }

  function poolForCategory(value) {
    return categoryFor(value).poolId;
  }

  function blankState() {
    return { schemaVersion: 2, payday: 1, budgets: {}, expenses: [], theme: 'system' };
  }

  function normalizeState(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const state = {
      ...blankState(),
      ...source,
      budgets: source.budgets && typeof source.budgets === 'object' && !Array.isArray(source.budgets) ? source.budgets : {},
      expenses: Array.isArray(source.expenses) ? source.expenses : [],
      payday: normalizedPayday(source.payday)
    };
    let migrated = source.schemaVersion !== 2 || source.payday !== state.payday;

    state.expenses = state.expenses.map((expense, index) => {
      if (!expense || typeof expense !== 'object' || Array.isArray(expense)) {
        migrated = true;
        return {
          id: `legacy-${index}`,
          amount: 0,
          category: 'Inne',
          poolId: 'life',
          date: '',
          note: '',
          created: ''
        };
      }

      const category = categoryFor(expense.category);
      const poolId = poolIds.has(expense.poolId) ? expense.poolId : category.poolId;
      const normalized = {
        ...expense,
        id: expense.id || `legacy-${index}-${expense.date || 'date'}`,
        amount: Number.isFinite(Number(expense.amount)) ? Number(expense.amount) : 0,
        category: category.name === 'Inne' && expense.category ? String(expense.category) : category.name,
        poolId,
        date: typeof expense.date === 'string' ? expense.date : '',
        note: typeof expense.note === 'string' ? expense.note : '',
        created: typeof expense.created === 'string' ? expense.created : ''
      };

      if (expense.poolId !== poolId || expense.id !== normalized.id || expense.category !== normalized.category || expense.amount !== normalized.amount || expense.date !== normalized.date || expense.note !== normalized.note || expense.created !== normalized.created) {
        migrated = true;
      }
      return normalized;
    });

    state.schemaVersion = 2;
    return { state, migrated };
  }

  function budgetForPeriod(budgets, period) {
    const saved = budgets[period.planMonth] || {};
    const value = (field, fallback) => Number.isFinite(Number(saved[field])) ? Number(saved[field]) : fallback;
    return {
      income: value('income', 6000),
      bills: value('bills', 1500),
      fuel: value('fuel', 500),
      savings: value('savings', 1000)
    };
  }

  function poolAmounts(budget) {
    return {
      bills: roundMoney(budget.bills),
      fuel: roundMoney(budget.fuel),
      savings: roundMoney(budget.savings),
      life: roundMoney(Math.max(0, budget.income - budget.bills - budget.fuel - budget.savings))
    };
  }

  function expensesInPeriod(expenses, period) {
    return expenses.filter(expense => dateIsInPeriod(expense.date, period));
  }

  function poolSpending(expenses) {
    const totals = { bills: 0, fuel: 0, savings: 0, life: 0 };
    expenses.forEach(expense => {
      const poolId = poolIds.has(expense.poolId) ? expense.poolId : poolForCategory(expense.category);
      totals[poolId] += Number(expense.amount) || 0;
    });
    Object.keys(totals).forEach(poolId => { totals[poolId] = roundMoney(totals[poolId]); });
    return totals;
  }

  function dailyPlan(period, lifeAmount, expenses, value) {
    const inPeriod = expensesInPeriod(expenses, period).filter(expense => {
      const poolId = poolIds.has(expense.poolId) ? expense.poolId : poolForCategory(expense.category);
      return poolId === 'life';
    });
    const beforeToday = inPeriod.filter(expense => expense.date < value).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const todaySpent = inPeriod.filter(expense => expense.date === value).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const remainingDays = Math.max(1, dayCount(value, period.end));
    const daysAfterToday = Math.max(0, remainingDays - 1);
    const availableToday = roundMoney((lifeAmount - beforeToday) / remainingDays);
    const futureAmount = roundMoney(lifeAmount - beforeToday - todaySpent);

    return {
      availableToday,
      todaySpent: roundMoney(todaySpent),
      safeToday: roundMoney(Math.max(0, availableToday - todaySpent)),
      remainingLife: roundMoney(lifeAmount - inPeriod.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)),
      remainingDays,
      daysAfterToday,
      nextDailyLimit: daysAfterToday ? roundMoney(Math.max(0, futureAmount / daysAfterToday)) : 0,
      overspend: roundMoney(Math.max(0, todaySpent - availableToday)),
      periodSpent: roundMoney(inPeriod.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))
    };
  }

  root.SpendoBudgetCore = Object.freeze({
    categories,
    pools,
    dateKey,
    parseDateKey,
    monthKey,
    dayCount,
    normalizedPayday,
    periodForDate,
    periodStartingInMonth,
    dateIsInPeriod,
    categoryFor,
    poolForCategory,
    blankState,
    normalizeState,
    budgetForPeriod,
    poolAmounts,
    expensesInPeriod,
    poolSpending,
    dailyPlan,
    roundMoney
  });
})(window);
