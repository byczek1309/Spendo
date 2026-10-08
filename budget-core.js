((root) => {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const STATE_SCHEMA_VERSION = 5;
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

  function roundGoalMoney(value) {
    if (!Number.isFinite(value)) return 0;
    return Number.isFinite(value * 100) ? roundMoney(value) : value;
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
    return { schemaVersion: STATE_SCHEMA_VERSION, payday: 1, budgets: {}, expenses: [], savingsGoals: [], recurringBills: [], theme: 'system' };
  }

  function normalizeRecurringBill(bill, index) {
    if (!bill || typeof bill !== 'object' || Array.isArray(bill)) return null;
    const name = typeof bill.name === 'string' ? bill.name.trim() : '';
    const amount = Number(bill.amount);
    const roundedAmount = roundMoney(amount);
    if (!name || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(roundedAmount) || roundedAmount <= 0) return null;
    return {
      ...bill,
      id: typeof bill.id === 'string' && bill.id ? bill.id : `bill-${index}`,
      name,
      amount: roundedAmount
    };
  }

  function normalizePlannedBillSnapshot(bill) {
    if (!bill || typeof bill !== 'object' || Array.isArray(bill)) return null;
    const id = typeof bill.id === 'string' ? bill.id : '';
    const name = typeof bill.name === 'string' ? bill.name.trim() : '';
    const amount = Number(bill.amount);
    const roundedAmount = roundMoney(amount);
    if (!id || !name || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(roundedAmount) || roundedAmount <= 0) return null;
    return { id, name, amount: roundedAmount };
  }

  function normalizeBudgetPlans(sourceBudgets) {
    const budgets = {};
    let migrated = false;
    const entries = sourceBudgets && typeof sourceBudgets === 'object' && !Array.isArray(sourceBudgets)
      ? Object.entries(sourceBudgets)
      : [];

    entries.forEach(([periodKey, plan]) => {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        budgets[periodKey] = plan;
        return;
      }

      const hasSplitData = Array.isArray(plan.selectedBills)
        && Number.isFinite(Number(plan.otherBills))
        && Number(plan.otherBills) >= 0;
      if (!hasSplitData) {
        const oldBills = Number(plan.bills);
        const otherBills = Number.isFinite(oldBills) && oldBills >= 0 ? roundMoney(oldBills) : 0;
        budgets[periodKey] = { ...plan, otherBills, selectedBills: [] };
        if (!Array.isArray(plan.selectedBills) || plan.otherBills !== otherBills || plan.selectedBills.length > 0) migrated = true;
        return;
      }

      const selectedBills = [];
      const seenIds = new Set();
      plan.selectedBills.forEach(bill => {
        const normalized = normalizePlannedBillSnapshot(bill);
        if (!normalized || seenIds.has(normalized.id)) {
          migrated = true;
          return;
        }
        seenIds.add(normalized.id);
        selectedBills.push(normalized);
        if (bill.id !== normalized.id || bill.name !== normalized.name || bill.amount !== normalized.amount) migrated = true;
      });
      const otherBills = roundMoney(Number(plan.otherBills));
      if (plan.otherBills !== otherBills || selectedBills.length !== plan.selectedBills.length) migrated = true;
      budgets[periodKey] = { ...plan, otherBills, selectedBills };
    });

    if (!sourceBudgets || typeof sourceBudgets !== 'object' || Array.isArray(sourceBudgets)) migrated = true;
    return { budgets, migrated };
  }

  function normalizeSavingsGoal(goal, index) {
    const source = goal && typeof goal === 'object' && !Array.isArray(goal) ? goal : {};
    const amount = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) >= 0 ? roundGoalMoney(Number(value)) : fallback;
    const targetDate = typeof source.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.targetDate)
      && dateKey(parseDateKey(source.targetDate)) === source.targetDate ? source.targetDate : '';
    return {
      ...source,
      id: typeof source.id === 'string' && source.id ? source.id : `goal-${index}`,
      name: typeof source.name === 'string' ? source.name.trim() : '',
      targetAmount: amount(source.targetAmount),
      savedAmount: amount(source.savedAmount),
      contributionPerPeriod: amount(source.contributionPerPeriod),
      targetDate,
      active: source.active !== false,
      savedAmountConfirmed: source.savedAmountConfirmed === true,
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
      lastAccruedPeriod: typeof source.lastAccruedPeriod === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.lastAccruedPeriod)
        && dateKey(parseDateKey(source.lastAccruedPeriod)) === source.lastAccruedPeriod ? source.lastAccruedPeriod : ''
    };
  }

  function goalRemaining(goal) {
    const target = Number(goal?.targetAmount);
    const saved = Number(goal?.savedAmount);
    if (!Number.isFinite(target) || !Number.isFinite(saved) || target <= 0) return 0;
    return roundGoalMoney(Math.max(0, target - saved));
  }

  function goalProgress(goal) {
    const target = Number(goal?.targetAmount);
    const saved = Number(goal?.savedAmount);
    if (!Number.isFinite(target) || !Number.isFinite(saved) || target <= 0) return 0;
    return Math.min(100, Math.max(0, saved / target * 100));
  }

  function goalPeriodsRemaining(goal) {
    const remaining = goalRemaining(goal);
    const contribution = Number(goal?.contributionPerPeriod);
    if (remaining <= 0 || !Number.isFinite(contribution) || contribution <= 0) return 0;
    const periods = remaining / contribution;
    return Number.isFinite(periods) ? Math.ceil(periods) : 0;
  }

  function activeGoalContributions(goals) {
    const total = (Array.isArray(goals) ? goals : []).reduce((sum, goal) => {
      const contribution = Number(goal?.contributionPerPeriod);
      const completed = goal?.savedAmountConfirmed === true && goalRemaining(goal) <= 0;
      if (goal?.active === false || completed || !Number.isFinite(contribution) || contribution <= 0) return sum;
      const next = sum + contribution;
      return Number.isFinite(next) ? next : Number.MAX_VALUE;
    }, 0);
    return roundGoalMoney(total);
  }

  function requiredGoalContribution(remaining, availablePeriods) {
    const amount = Number(remaining);
    const periods = Number(availablePeriods);
    if (!Number.isFinite(amount) || !Number.isFinite(periods) || amount <= 0 || periods <= 0) return 0;
    const required = amount / periods;
    if (!Number.isFinite(required)) return 0;
    return Number.isFinite(required * 100) ? Math.ceil(required * 100) / 100 : required;
  }

  function normalizeState(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const budgetPlans = normalizeBudgetPlans(source.budgets);
    let recurringBillsMigrated = !Array.isArray(source.recurringBills);
    const recurringBills = (Array.isArray(source.recurringBills) ? source.recurringBills : [])
      .map((bill, index) => {
        const normalized = normalizeRecurringBill(bill, index);
        if (!normalized || bill.id !== normalized.id || bill.name !== normalized.name || bill.amount !== normalized.amount) {
          recurringBillsMigrated = true;
        }
        return normalized;
      })
      .filter(Boolean);
    const state = {
      ...blankState(),
      ...source,
      budgets: budgetPlans.budgets,
      expenses: Array.isArray(source.expenses) ? source.expenses : [],
      savingsGoals: Array.isArray(source.savingsGoals)
        ? source.savingsGoals.filter(goal => goal && typeof goal === 'object' && !Array.isArray(goal)).map(normalizeSavingsGoal)
        : [],
      recurringBills,
      payday: normalizedPayday(source.payday)
    };
    let migrated = source.schemaVersion !== STATE_SCHEMA_VERSION
      || source.payday !== state.payday
      || budgetPlans.migrated
      || !Array.isArray(source.savingsGoals)
      || recurringBillsMigrated
      || (Array.isArray(source.savingsGoals) && source.savingsGoals.some(goal =>
        goal && typeof goal === 'object' && !Array.isArray(goal) && typeof goal.savedAmountConfirmed !== 'boolean'));

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

    state.schemaVersion = STATE_SCHEMA_VERSION;
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
    normalizeRecurringBill,
    budgetForPeriod,
    poolAmounts,
    expensesInPeriod,
    poolSpending,
    dailyPlan,
    goalRemaining,
    goalProgress,
    goalPeriodsRemaining,
    activeGoalContributions,
    requiredGoalContribution,
    roundGoalMoney,
    roundMoney
  });
})(window);
