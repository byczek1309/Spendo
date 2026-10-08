(() => {
  'use strict';

  const KEY = 'dzienny.v1';
  const Core = window.SpendoBudgetCore;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const pad = value => String(value).padStart(2, '0');
  const today = new Date();
  const todayKey = Core.dateKey(today);
  const money = value => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const whole = value => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value);
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const monthName = (month, cap = true) => {
    const date = Core.parseDateKey(`${month}-01`);
    const name = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(date);
    return cap ? name.charAt(0).toLocaleUpperCase('pl-PL') + name.slice(1) : name;
  };
  const formatShortDate = (value, includeYear = false) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', ...(includeYear ? { year: 'numeric' } : {}) }).format(Core.parseDateKey(value)).replace('.', '');

  let selectedPeriod = Core.periodForDate(todayKey, 1);
  let selectedMonth = Core.monthKey(today);
  let selectedDay = '';
  let toastTimer;
  let goalToDelete = '';
  let depositGoalId = '';
  let state;
  try {
    const normalized = Core.normalizeState(JSON.parse(localStorage.getItem(KEY) || '{}'));
    state = normalized.state;
    if (normalized.migrated) localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    state = Core.blankState();
  }
  selectedPeriod = Core.periodForDate(todayKey, state.payday);

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function getBudget(period = selectedPeriod) {
    return Core.budgetForPeriod(state.budgets, period);
  }

  function hasBudget(period = selectedPeriod) {
    const saved = state.budgets[period.planMonth];
    return Object.prototype.hasOwnProperty.call(state.budgets, period.planMonth)
      && ['income', 'bills', 'fuel', 'savings'].every(field => saved?.[field] !== undefined && Number.isFinite(Number(saved[field])));
  }

  function periodExpenses(period = selectedPeriod) {
    return Core.expensesInPeriod(state.expenses, period);
  }

  function category(value) {
    return Core.categoryFor(value);
  }

  function periodLabel(period) {
    const crossesYear = period.start.slice(0, 4) !== period.end.slice(0, 4);
    return `${formatShortDate(period.start, crossesYear)} → ${formatShortDate(period.end, crossesYear)}`;
  }

  function monthDistance(from, to) {
    const [fromYear, fromMonth] = from.slice(0, 7).split('-').map(Number);
    const [toYear, toMonth] = to.slice(0, 7).split('-').map(Number);
    return Math.max(0, (toYear - fromYear) * 12 + toMonth - fromMonth);
  }

  function activeGoalAmount() {
    return Core.activeGoalContributions(state.savingsGoals);
  }

  function periodCountToTarget(targetDate) {
    if (!targetDate || targetDate < todayKey) return 0;
    const targetPeriod = Core.periodForDate(targetDate, state.payday);
    return monthDistance(selectedPeriod.start, targetPeriod.start) + 1;
  }

  function goalDateAssessment(goal) {
    if (!goal.savedAmountConfirmed || !goal.targetDate || Core.goalRemaining(goal) <= 0) return '';
    const remaining = Core.goalRemaining(goal);
    const periods = periodCountToTarget(goal.targetDate);
    const required = Core.requiredGoalContribution(remaining, periods);
    const onTime = goal.active && periods > 0 && goal.contributionPerPeriod * periods >= remaining;
    const formatted = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(Core.parseDateKey(goal.targetDate));
    const result = onTime
      ? '<span class="goal-on-time">✓ Plan wskazuje, że możesz osiągnąć cel przed terminem.</span>'
      : '<span class="goal-late">⚠️ Obecny plan może nie wystarczyć na czas.</span>';
    const suggested = required > 0 && !onTime ? `<span class="goal-required">Aby zdążyć, odkładaj około ${money(required)} zł / okres.</span>` : '';
    return `<div class="goal-date-plan"><span>Termin: ${formatted}</span>${result}${suggested}</div>`;
  }

  function renderGoalCard(goal) {
    const remaining = Core.goalRemaining(goal);
    const progress = Core.goalProgress(goal);
    const confirmed = goal.savedAmountConfirmed === true;
    const completed = confirmed && remaining <= 0;
    const status = !goal.active ? '<span class="goal-status paused">⏸ Wstrzymany</span>' : completed ? '<span class="goal-status complete">🎉 Cel osiągnięty</span>' : '';
    const periods = confirmed ? Core.goalPeriodsRemaining(goal) : 0;
    const lastTwo = periods % 100;
    const lastOne = periods % 10;
    const periodWord = periods === 1 ? 'okres' : lastOne >= 2 && lastOne <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'okresy' : 'okresów';
    const periodEstimate = !goal.active || completed || !periods ? '' : `<span class="goal-period-estimate">Prognoza: ~${periods} ${periodWord}</span><small class="goal-forecast-note">To szacunek przy obecnym planie.</small>`;
    const balanceMarkup = confirmed
      ? `<div class="goal-progress-line"><div class="goal-progress" role="progressbar" aria-label="Postęp celu ${esc(goal.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></div><strong>${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(progress)}%</strong></div><div class="goal-balance-values"><div><span>Odłożono</span><strong>${money(Math.min(Number(goal.savedAmount) || 0, Number(goal.targetAmount) || 0))} zł</strong></div><div><span>Brakuje</span><strong>${completed ? '0,00' : money(remaining)} zł</strong></div></div>${completed ? '<p class="goal-remaining">Cel osiągnięty</p>' : ''}`
      : `<div class="goal-unconfirmed-balance"><span>Saldo z poprzedniej wersji do potwierdzenia</span><strong>${money(Math.min(Number(goal.savedAmount) || 0, Number(goal.targetAmount) || 0))} zł</strong><p>Poprzednia wersja mogła doliczać planowane składki. Sprawdź faktycznie odłożoną kwotę.</p><button type="button" class="secondary-button" data-goal-action="confirm-balance" data-goal-id="${esc(goal.id)}">Potwierdź saldo</button></div>`;
    const depositAction = confirmed && !completed
      ? `<button type="button" class="secondary-button goal-deposit-button" data-goal-action="deposit" data-goal-id="${esc(goal.id)}">＋ Dodaj oszczędności</button>`
      : '';
    const plannedContribution = !goal.active || completed ? '0,00' : money(goal.contributionPerPeriod);
    return `<article class="panel goal-card ${!goal.active ? 'is-paused' : ''}"><div class="goal-card-head"><div class="goal-name-block"><span class="goal-mark">🎯</span><div><h3>${esc(goal.name || 'Cel oszczędnościowy')}</h3>${status}</div></div><div class="goal-actions"><button type="button" class="goal-icon-button" data-goal-action="edit" data-goal-id="${esc(goal.id)}" aria-label="Edytuj cel ${esc(goal.name)}">✎</button><button type="button" class="goal-icon-button" data-goal-action="pause" data-goal-id="${esc(goal.id)}" aria-label="${goal.active ? 'Wstrzymaj' : 'Wznów'} cel ${esc(goal.name)}">${goal.active ? 'Ⅱ' : '▶'}</button><button type="button" class="goal-icon-button danger-icon" data-goal-action="delete" data-goal-id="${esc(goal.id)}" aria-label="Usuń cel ${esc(goal.name)}">×</button></div></div>${balanceMarkup}<div class="goal-card-foot"><span>Planujesz odkładać ${plannedContribution} zł / okres</span>${periodEstimate}</div>${depositAction}${goalDateAssessment(goal)}</article>`;
  }

  function renderGoals(amounts) {
    const assigned = activeGoalAmount();
    const configured = hasBudget();
    $('#goals-pool-plan').textContent = configured ? `${money(amounts.savings)} zł / okres` : 'Ustaw budżet';
    $('#goals-pool-assigned').textContent = `${money(assigned)} zł`;
    const overage = configured && assigned > amounts.savings;
    const warning = `⚠️ Cele wymagają ${money(assigned)} zł, ale na oszczędności planujesz ${money(amounts.savings)} zł / okres. Zwiększ pulę Oszczędności lub zmniejsz składki celów.`;
    $('#goals-overage').textContent = warning;
    $('#goals-overage').classList.toggle('hidden', !overage);
    $('#goals-empty').classList.toggle('hidden', state.savingsGoals.length > 0);
    $('#goals-list').innerHTML = state.savingsGoals.map(renderGoalCard).join('');
    $('#budget-goals-summary').innerHTML = renderBudgetGoalsSummary(amounts, configured, assigned);
  }

  function renderBudgetGoalsSummary(amounts, configured, assigned) {
    const goals = state.savingsGoals;
    const warning = configured && assigned > amounts.savings
      ? `<p class="goal-warning" role="alert">⚠️ Cele wymagają ${money(assigned)} zł, ale na oszczędności planujesz ${money(amounts.savings)} zł / okres.</p>`
      : '';
    const rows = goals.length
      ? goals.map(goal => {
        const completed = goal.savedAmountConfirmed === true && Core.goalRemaining(goal) <= 0;
        const amount = goal.active && !completed ? money(goal.contributionPerPeriod) : '0,00';
        const note = !goal.active ? ' · Wstrzymany' : completed ? ' · Osiągnięty' : '';
        return `<div class="budget-goal-row"><span>${esc(goal.name || 'Cel oszczędnościowy')}${note}</span><strong>${amount} zł</strong></div>`;
      }).join('')
      : '<p class="budget-goals-empty">Nie masz jeszcze przypisanych celów.</p>';
    const label = configured ? `${money(assigned)} / ${money(amounts.savings)} zł przypisane` : 'Ustaw pulę Oszczędności, aby sprawdzić plan.';
    return `<div class="budget-goals-heading"><strong>Cele</strong><button type="button" class="text-button" data-screen="goals">＋ Dodaj cel</button></div>${rows}<strong class="budget-goals-total">${label}</strong>${warning}`;
  }

  function update() {
    const budget = getBudget();
    const amounts = Core.poolAmounts(budget);
    const expenses = periodExpenses();
    const spending = Core.poolSpending(expenses);
    const plan = Core.dailyPlan(selectedPeriod, amounts.life, expenses, todayKey);
    const todayExpenses = expenses.filter(expense => expense.date === todayKey).sort((a, b) => b.created.localeCompare(a.created));
    const isCurrentPeriod = Core.dateIsInPeriod(todayKey, selectedPeriod);
    const configured = hasBudget();
    const spentLife = spending.life;
    const percentage = amounts.life > 0 ? Math.min(100, Math.max(0, spentLife / amounts.life * 100)) : (spentLife > 0 ? 100 : 0);

    $('#today-label').textContent = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(today).replace(/^./, char => char.toLocaleUpperCase('pl-PL'));
    $('#screen-today').classList.toggle('needs-budget', !configured);
    $('#budget-setup-card').classList.toggle('hidden', configured);
    $('#safe-today').textContent = configured ? money(isCurrentPeriod ? plan.safeToday : Math.max(0, amounts.life - spending.life) / selectedPeriod.days) : '—';
    $('.hero-sub').textContent = `z puli Na życie · do ${formatShortDate(selectedPeriod.end)}`;
    $('#spent-total').textContent = `${whole(spentLife)} zł wydane na życie`;
    $('#monthly-total').textContent = `${whole(amounts.life)} zł na życie`;
    $('#remaining-total').textContent = configured ? `${money(amounts.life - spending.life)} zł` : '—';
    $('.summary-card .summary-note').textContent = 'do końca okresu';
    $('#spent-today').textContent = configured ? `${money(isCurrentPeriod ? plan.todaySpent : 0)} zł` : '—';
    $('#month-progress').style.width = `${percentage}%`;
    $('#detail-life-remaining').textContent = `${money(plan.remainingLife)} zł`;
    $('#detail-days-remaining').textContent = `${plan.remainingDays}`;
    $('#detail-today-limit').textContent = `${money(plan.availableToday)} zł`;
    $('#detail-today-spent').textContent = `${money(plan.todaySpent)} zł`;
    $('.daily-explainer').classList.toggle('hidden', !configured || !isCurrentPeriod);
    $('#fuel-pool-summary').classList.toggle('hidden', !configured || amounts.fuel <= 0);
    $('#fuel-pool-summary-text').textContent = `${money(amounts.fuel - spending.fuel)} zł pozostało z ${money(amounts.fuel)} zł`;
    const status = $('#status-message');
    status.classList.toggle('over', isCurrentPeriod && plan.overspend > 0);
    if (!isCurrentPeriod) status.textContent = `Okres budżetowy: ${periodLabel(selectedPeriod)}`;
    else if (plan.overspend > 0) status.textContent = `↗ Limit przekroczony o ${money(plan.overspend)} zł. Spendo nie blokuje wydatków — pozostały budżet przeliczono na kolejne dni.${plan.daysAfterToday ? ` Od jutra: ${whole(plan.nextDailyLimit)} zł dziennie.` : ' To ostatni dzień tego okresu.'}`;
    else status.textContent = `✓ Zostało ${money(plan.safeToday)} zł z dzisiejszego limitu`;

    const list = $('#today-expenses');
    list.innerHTML = todayExpenses.map(expenseRow).join('');
    $('#empty-today').classList.toggle('hidden', todayExpenses.length > 0);
    list.classList.toggle('hidden', todayExpenses.length === 0);
    renderCalendar();
    renderHistory();
    renderBudget(budget, amounts, spending);
    renderStats(expenses, amounts);
    renderGoals(amounts);
  }

  function expenseRow(expense) {
    const itemCategory = category(expense.category);
    const when = expense.date === todayKey && expense.created
      ? new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(expense.created))
      : new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(Core.parseDateKey(expense.date));
    return `<div class="expense-row"><span class="expense-icon">${itemCategory.icon}</span><div class="expense-info"><strong>${esc(expense.category)}</strong><small>${expense.note ? `${esc(expense.note)} · ` : ''}${when}</small></div><strong class="expense-price">−${money(expense.amount)} zł</strong><button class="delete-button" data-delete="${esc(expense.id)}" aria-label="Usuń wydatek">×</button></div>`;
  }

  function renderCalendar() {
    const [year, month] = selectedMonth.split('-').map(Number);
    const first = new Date(year, month - 1, 1, 12);
    const days = new Date(year, month, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const monthExpenses = state.expenses.filter(expense => expense.date.startsWith(selectedMonth));
    $('#calendar-month').textContent = monthName(selectedMonth);
    let html = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map(day => `<div class="calendar-cell weekday">${day}</div>`).join('');
    for (let index = 0; index < offset; index += 1) html += '<div class="calendar-cell"></div>';
    for (let day = 1; day <= days; day += 1) {
      const iso = `${selectedMonth}-${pad(day)}`;
      const dayPeriod = Core.periodForDate(iso, state.payday);
      const dayBudget = getBudget(dayPeriod);
      const dayLife = Core.poolAmounts(dayBudget).life;
      const dayPlan = Core.dailyPlan(dayPeriod, dayLife, state.expenses, iso);
      const sum = monthExpenses.filter(expense => expense.date === iso && expense.poolId === 'life').reduce((total, expense) => total + Number(expense.amount), 0);
      const dotClass = !hasBudget(dayPeriod) || sum <= 0 ? '' : sum > dayPlan.availableToday ? 'red' : sum > dayPlan.availableToday * 0.85 ? 'yellow' : 'green';
      const label = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(Core.parseDateKey(iso));
      html += `<div class="calendar-cell day-cell ${iso === todayKey ? 'today' : ''} ${iso === selectedDay ? 'selected' : ''}" role="button" tabindex="0" aria-label="${label}" aria-pressed="${iso === selectedDay}" data-day="${iso}">${day}${dotClass ? `<i class="dot ${dotClass}"></i>` : ''}</div>`;
    }
    $('#calendar-grid').innerHTML = html;
  }

  function renderHistory() {
    const all = state.expenses.filter(expense => expense.date.startsWith(selectedMonth));
    const rows = all.filter(expense => !selectedDay || expense.date === selectedDay)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
    $('#history-heading').textContent = selectedDay ? 'Wydatki wybranego dnia' : 'Wydatki w tym miesiącu';
    $('#history-count').textContent = `${rows.length} ${rows.length === 1 ? 'wydatek' : 'wydatków'}`;
    let last = '';
    $('#history-list').innerHTML = rows.length ? rows.map(expense => {
      let heading = '';
      if (expense.date !== last) {
        last = expense.date;
        heading = `<div class="history-day">${new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(Core.parseDateKey(expense.date))}</div>`;
      }
      return heading + expenseRow(expense);
    }).join('') : `<div class="empty-state"><span>🌿</span><p>${selectedDay ? 'Brak wydatków tego dnia.' : 'Historia zaczyna się od małych kroków.'}</p></div>`;
  }

  function renderBudget(budget, amounts, spending) {
    const configured = hasBudget();
    $('#budget-setup-note').classList.toggle('hidden', configured);
    $('.budget-total').classList.toggle('hidden', !configured);
    $('.pool-list').classList.toggle('hidden', !configured);
    $('#budget-available').textContent = `${money(amounts.life)} zł`;
    $('#budget-period-label').textContent = periodLabel(selectedPeriod);
    $('#budget-income-label').textContent = `${money(budget.income)} zł`;
    $('#pool-bills').textContent = `${money(amounts.bills - spending.bills)} zł`;
    $('#pool-bills-remaining').textContent = `z ${money(amounts.bills)} zł w planie`;
    $('#pool-fuel').textContent = `${money(amounts.fuel - spending.fuel)} zł`;
    $('#pool-fuel-remaining').textContent = `z ${money(amounts.fuel)} zł w planie`;
    $('#pool-savings').textContent = `${money(amounts.savings)} zł`;
    $('#pool-savings-remaining').textContent = 'Kwota zaplanowana do odłożenia';
    $('#pool-life').textContent = `${money(amounts.life - spending.life)} zł`;
    $('#pool-life-remaining').textContent = `z ${money(amounts.life)} zł w planie`;
    $('#budget-form').elements.income.value = configured ? budget.income : '';
    $('#budget-form').elements.bills.value = configured ? budget.bills : '';
    $('#budget-form').elements.fuel.value = configured ? budget.fuel : '';
    $('#budget-form').elements.savings.value = configured ? budget.savings : '';
  }

  function renderStats(expenses, amounts) {
    $('#stats-period').textContent = periodLabel(selectedPeriod);
    const hasExpenses = expenses.length > 0;
    $('#stats-empty').classList.toggle('hidden', hasExpenses);
    $('#stats-content').classList.toggle('hidden', !hasExpenses);
    if (!hasExpenses) return;

    const total = Core.roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
    $('#stats-total').textContent = money(total);
    $('#stats-daily-average').textContent = money(total / selectedPeriod.days);

    const largest = expenses.reduce((best, expense) => Number(expense.amount) > Number(best.amount) ? expense : best, expenses[0]);
    const largestCategory = category(largest.category);
    $('#stats-largest-category').textContent = `${largestCategory.icon} ${largestCategory.name}`;
    $('#stats-largest-amount').textContent = `${money(largest.amount)} zł`;

    const categoryTotals = new Map(Core.categories.map(item => [item.name, { category: item, amount: 0, count: 0 }]));
    expenses.forEach(expense => {
      const item = category(expense.category);
      const aggregate = categoryTotals.get(item.name);
      aggregate.amount += Number(expense.amount) || 0;
      aggregate.count += 1;
    });
    const ranked = [...categoryTotals.values()];
    ranked.forEach(item => { item.amount = Core.roundMoney(item.amount); });
    const mostFrequent = ranked.reduce((best, item) => item.count > best.count ? item : best, ranked[0]);
    $('#stats-frequent-category').textContent = `${mostFrequent.category.icon} ${mostFrequent.category.name}`;
    $('#stats-frequent-count').textContent = `${mostFrequent.count} ${mostFrequent.count === 1 ? 'wydatek' : 'wydatków'}`;

    const previousDay = Core.parseDateKey(selectedPeriod.start);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousPeriod = Core.periodForDate(Core.dateKey(previousDay), state.payday);
    const previousExpenses = periodExpenses(previousPeriod);
    const previousLifeSpent = Core.poolSpending(previousExpenses).life;
    const currentLifeSpent = Core.poolSpending(expenses).life;
    const comparison = $('#stats-comparison');
    if (previousLifeSpent > 0) {
      const change = (currentLifeSpent - previousLifeSpent) / previousLifeSpent * 100;
      const sign = change < 0 ? '−' : change > 0 ? '+' : '';
      comparison.textContent = `${sign}${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(change))}%`;
      comparison.classList.toggle('lower-spending', change < 0);
      comparison.classList.toggle('higher-spending', change > 0);
    } else {
      comparison.textContent = 'Brak danych do porównania';
      comparison.classList.remove('lower-spending', 'higher-spending');
    }

    const chart = $('#stats-categories');
    chart.innerHTML = ranked.map(item => {
      const share = total > 0 ? item.amount / total * 100 : 0;
      return `<div class="category-row"><div class="category-row-head"><span>${item.category.icon} ${item.category.name}</span><strong>${money(item.amount)} zł</strong></div><div class="category-track" role="img" aria-label="${item.category.name}: ${money(item.amount)} zł"><span style="width:${share}%"></span></div></div>`;
    }).join('');

    const configured = hasBudget();
    $('#stats-life-values').classList.toggle('hidden', !configured);
    $('#stats-life-progress').classList.toggle('hidden', !configured);
    $('#stats-life-status').classList.toggle('hidden', !configured);
    $('#stats-no-plan').classList.toggle('hidden', configured);
    if (!configured) return;

    const lifeRemaining = Core.roundMoney(amounts.life - currentLifeSpent);
    const progress = amounts.life > 0 ? Math.min(100, Math.max(0, currentLifeSpent / amounts.life * 100)) : (currentLifeSpent > 0 ? 100 : 0);
    const elapsedDays = Math.min(selectedPeriod.days, Math.max(1, Core.dayCount(selectedPeriod.start, todayKey)));
    const plannedToDate = amounts.life * elapsedDays / selectedPeriod.days;
    $('#stats-life-planned').textContent = `${money(amounts.life)} zł`;
    $('#stats-life-spent').textContent = `${money(currentLifeSpent)} zł`;
    $('#stats-life-remaining').textContent = `${money(lifeRemaining)} zł`;
    $('#stats-life-progress').querySelector('span').style.width = `${progress}%`;
    $('#stats-life-progress').setAttribute('aria-valuenow', String(Math.round(progress)));
    $('#stats-life-status').textContent = currentLifeSpent > plannedToDate
      ? '⚠️ Wydajesz szybciej, niż wynika z planu.'
      : '✓ Wydajesz zgodnie z planem.';
  }

  function showScreen(name) {
    $$('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${name}`));
    $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.screen === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('visible'), 2200);
  }

  function openModal() {
    const form = $('#expense-form');
    form.reset();
    form.elements.date.value = todayKey;
    form.elements.category.value = 'Jedzenie';
    updateCategoryPoolHint();
    $('#expense-modal').classList.remove('hidden');
    setTimeout(() => form.elements.amount.focus(), 100);
  }

  function closeModal() {
    $('#expense-modal').classList.add('hidden');
  }

  function closeGoalForm() {
    $('#goal-modal').classList.add('hidden');
    $('#goal-form-error').classList.add('hidden');
  }

  function openGoalForm(goalId = '', confirmBalance = false) {
    const form = $('#goal-form');
    const goal = state.savingsGoals.find(item => item.id === goalId);
    form.reset();
    form.dataset.confirmOverage = '';
    form.dataset.confirmBalance = confirmBalance ? 'true' : '';
    form.elements.id.value = goal?.id || '';
    form.elements.name.value = goal?.name || '';
    form.elements.targetAmount.value = goal?.targetAmount || '';
    form.elements.savedAmount.value = goal ? goal.savedAmount : '0';
    form.elements.contributionPerPeriod.value = goal?.contributionPerPeriod || '';
    form.elements.targetDate.value = goal?.targetDate || '';
    $('#goal-modal-title').textContent = goal ? (confirmBalance ? 'Potwierdź saldo celu' : 'Edytuj cel') : 'Dodaj cel';
    $('#goal-balance-notice').classList.toggle('hidden', !goal || goal.savedAmountConfirmed === true);
    form.querySelector('[type=submit]').textContent = confirmBalance ? 'Potwierdź saldo i zapisz' : goal ? 'Zapisz zmiany' : 'Dodaj cel';
    $('#goal-form-error').classList.add('hidden');
    $('#goal-modal').classList.remove('hidden');
    setTimeout(() => form.elements.name.focus(), 100);
  }

  function closeGoalDelete() {
    goalToDelete = '';
    $('#goal-delete-modal').classList.add('hidden');
  }

  function openDepositForm(goalId) {
    const goal = state.savingsGoals.find(item => item.id === goalId);
    if (!goal || goal.savedAmountConfirmed !== true || Core.goalRemaining(goal) <= 0) return;
    depositGoalId = goal.id;
    const form = $('#goal-deposit-form');
    form.reset();
    $('#goal-deposit-title').textContent = `Dodaj oszczędności · ${goal.name}`;
    $('#goal-deposit-remaining').textContent = `Brakuje ${money(Core.goalRemaining(goal))} zł do celu.`;
    $('#goal-deposit-error').classList.add('hidden');
    $('#goal-deposit-modal').classList.remove('hidden');
    setTimeout(() => form.elements.amount.focus(), 100);
  }

  function closeDepositForm() {
    depositGoalId = '';
    $('#goal-deposit-modal').classList.add('hidden');
    $('#goal-deposit-error').classList.add('hidden');
  }

  function parseDepositAmount(value) {
    const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return NaN;
    return Number(normalized);
  }

  function saveGoalDeposit(event) {
    event.preventDefault();
    const goal = state.savingsGoals.find(item => item.id === depositGoalId);
    const amount = parseDepositAmount(event.currentTarget.elements.amount.value);
    let error = '';
    if (!goal || goal.savedAmountConfirmed !== true) error = 'Najpierw potwierdź saldo celu.';
    else if (!Number.isFinite(amount) || amount <= 0) error = 'Wpisz poprawną kwotę większą od 0 zł (do dwóch miejsc po przecinku).';
    else if (amount > Core.goalRemaining(goal)) error = `Możesz dodać maksymalnie ${money(Core.goalRemaining(goal))} zł, aby osiągnąć cel.`;
    if (error) {
      $('#goal-deposit-error').textContent = error;
      $('#goal-deposit-error').classList.remove('hidden');
      return;
    }
    goal.savedAmount = Core.roundGoalMoney(Number(goal.savedAmount) + amount);
    save();
    closeDepositForm();
    update();
    showToast(Core.goalRemaining(goal) <= 0 ? 'Cel osiągnięty' : 'Oszczędności dodane');
  }

  function beginGoalDelete(goalId) {
    const goal = state.savingsGoals.find(item => item.id === goalId);
    if (!goal) return;
    goalToDelete = goal.id;
    $('#goal-delete-name').textContent = goal.name;
    $('#goal-delete-modal').classList.remove('hidden');
  }

  function saveGoalFromForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    const existing = state.savingsGoals.find(goal => goal.id === id);
    const name = form.elements.name.value.trim();
    const targetAmount = Number(form.elements.targetAmount.value);
    const savedAmount = Number(form.elements.savedAmount.value);
    const contributionPerPeriod = Number(form.elements.contributionPerPeriod.value);
    const targetDate = form.elements.targetDate.value;
    let error = '';
    if (!name) error = 'Wpisz nazwę celu.';
    else if (!Number.isFinite(targetAmount) || targetAmount <= 0) error = 'Kwota docelowa musi być większa od 0 zł.';
    else if (!Number.isFinite(savedAmount) || savedAmount < 0) error = 'Kwota już odłożona nie może być ujemna.';
    else if (savedAmount > targetAmount) error = 'Kwota już odłożona nie może przekraczać celu.';
    else if (!Number.isFinite(contributionPerPeriod) || contributionPerPeriod <= 0) error = 'Kwota odkładana w każdym okresie musi być większa od 0 zł.';
    else if (targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Core.dateKey(Core.parseDateKey(targetDate)) !== targetDate)) error = 'Wybierz poprawny termin celu.';
    if (error) {
      $('#goal-form-error').textContent = error;
      $('#goal-form-error').classList.remove('hidden');
      return;
    }

    const candidate = {
      id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : `goal-${Date.now()}`),
      name,
      targetAmount: Core.roundGoalMoney(targetAmount),
      savedAmount: Core.roundGoalMoney(savedAmount),
      contributionPerPeriod: Core.roundGoalMoney(contributionPerPeriod),
      targetDate,
      active: existing?.active !== false,
      savedAmountConfirmed: !existing || existing.savedAmountConfirmed === true || form.dataset.confirmBalance === 'true'
        || Core.roundGoalMoney(savedAmount) !== Core.roundGoalMoney(Number(existing.savedAmount)),
      createdAt: existing?.createdAt || new Date().toISOString(),
      ...(existing?.lastAccruedPeriod ? { lastAccruedPeriod: existing.lastAccruedPeriod } : {})
    };
    const proposedGoals = existing
      ? state.savingsGoals.map(goal => goal.id === existing.id ? candidate : goal)
      : [...state.savingsGoals, candidate];
    const budgetConfigured = hasBudget();
    const plannedSavings = Core.poolAmounts(getBudget()).savings;
    const overAllocation = budgetConfigured && Core.activeGoalContributions(proposedGoals) > plannedSavings;
    if (overAllocation && form.dataset.confirmOverage !== 'true') {
      $('#goal-form-error').textContent = `⚠️ Po zapisaniu cele będą wymagały ${money(Core.activeGoalContributions(proposedGoals))} zł, a pula Oszczędności wynosi ${money(plannedSavings)} zł / okres. Zwiększ pulę albo zapisz świadomie mimo ostrzeżenia.`;
      $('#goal-form-error').classList.remove('hidden');
      form.dataset.confirmOverage = 'true';
      form.querySelector('[type=submit]').textContent = existing ? 'Zapisz mimo ostrzeżenia' : 'Dodaj mimo ostrzeżenia';
      return;
    }
    state.savingsGoals = proposedGoals;
    save();
    closeGoalForm();
    update();
    showToast(existing ? 'Cel zaktualizowany' : 'Cel dodany');
  }

  function updateCategoryPoolHint() {
    const selected = Core.categoryFor($('#category-select').value);
    const pool = Core.pools.find(item => item.id === selected.poolId);
    $('#category-pool-hint').textContent = `Z puli ${pool.name}`;
  }

  $('#category-select').innerHTML = Core.categories.map(item => `<option value="${item.name}">${item.icon} ${item.name}</option>`).join('');
  $('#payday-select').innerHTML = Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('');
  $('#category-select').addEventListener('change', updateCategoryPoolHint);
  $$('[data-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.screen)));
  $$('[data-action=add]').forEach(button => button.addEventListener('click', openModal));
  $$('[data-action=close]').forEach(button => button.addEventListener('click', closeModal));
  $('#expense-modal').addEventListener('click', event => { if (event.target.id === 'expense-modal') closeModal(); });
  $('#add-goal').addEventListener('click', () => openGoalForm());
  $('#goal-form').addEventListener('submit', saveGoalFromForm);
  $('#goal-form').addEventListener('input', event => {
    const form = event.currentTarget;
    if (form.dataset.confirmOverage) {
      form.dataset.confirmOverage = '';
      form.querySelector('[type=submit]').textContent = form.elements.id.value ? 'Zapisz zmiany' : 'Dodaj cel';
      $('#goal-form-error').classList.add('hidden');
    }
  });
  $$('[data-action=close-goal]').forEach(button => button.addEventListener('click', closeGoalForm));
  $('#goal-modal').addEventListener('click', event => { if (event.target.id === 'goal-modal') closeGoalForm(); });
  $('#goal-deposit-form').addEventListener('submit', saveGoalDeposit);
  $$('[data-action=close-deposit]').forEach(button => button.addEventListener('click', closeDepositForm));
  $('#goal-deposit-modal').addEventListener('click', event => { if (event.target.id === 'goal-deposit-modal') closeDepositForm(); });
  $$('[data-action=cancel-goal-delete]').forEach(button => button.addEventListener('click', closeGoalDelete));
  $('#goal-delete-modal').addEventListener('click', event => { if (event.target.id === 'goal-delete-modal') closeGoalDelete(); });
  $('#goal-delete-modal [data-action=confirm-goal-delete]').addEventListener('click', () => {
    if (!goalToDelete) return;
    state.savingsGoals = state.savingsGoals.filter(goal => goal.id !== goalToDelete);
    save();
    closeGoalDelete();
    update();
    showToast('Cel usunięty');
  });
  $('#goals-list').addEventListener('click', event => {
    const button = event.target.closest('[data-goal-action]');
    if (!button) return;
    const goal = state.savingsGoals.find(item => item.id === button.dataset.goalId);
    if (!goal) return;
    if (button.dataset.goalAction === 'edit') openGoalForm(goal.id);
    else if (button.dataset.goalAction === 'confirm-balance') openGoalForm(goal.id, true);
    else if (button.dataset.goalAction === 'deposit') openDepositForm(goal.id);
    else if (button.dataset.goalAction === 'delete') beginGoalDelete(goal.id);
    else if (button.dataset.goalAction === 'pause') {
      goal.active = !goal.active;
      save();
      update();
      showToast(goal.active ? 'Cel wznowiony' : 'Cel wstrzymany');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeModal();
    closeGoalForm();
    closeGoalDelete();
    closeDepositForm();
  });

  $('#expense-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = Number(form.elements.amount.value);
    if (!(amount > 0) || !form.elements.date.value) return;
    const expenseDate = form.elements.date.value;
    const categoryName = form.elements.category.value;
    state.expenses.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      amount,
      category: categoryName,
      poolId: Core.poolForCategory(categoryName),
      date: expenseDate,
      note: form.elements.note.value.trim(),
      created: new Date().toISOString()
    });
    save();
    closeModal();
    update();
    const dateLabel = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' }).format(Core.parseDateKey(expenseDate));
    showToast(expenseDate === todayKey ? 'Wydatek dodany' : expenseDate < todayKey ? `Wydatek zapisany w historii — ${dateLabel}` : `Wydatek zapisany na ${dateLabel}`);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    state.expenses = state.expenses.filter(expense => expense.id !== button.dataset.delete);
    save();
    update();
    showToast('Wydatek usunięty');
  });

  $('#budget-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    state.budgets[selectedPeriod.planMonth] = Object.fromEntries(['income', 'bills', 'fuel', 'savings'].map(name => [name, Math.max(0, Number(form.elements[name].value) || 0)]));
    save();
    update();
    showToast('Plan zapisany');
  });

  $('#prev-month').addEventListener('click', () => shiftMonth(-1));
  $('#next-month').addEventListener('click', () => shiftMonth(1));
  function shiftMonth(offset) {
    const date = Core.parseDateKey(`${selectedMonth}-01`);
    date.setMonth(date.getMonth() + offset);
    selectedMonth = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    selectedDay = '';
    update();
  }

  $('#calendar-grid').addEventListener('click', event => {
    const cell = event.target.closest('[data-day]');
    if (!cell) return;
    selectedDay = cell.dataset.day;
    renderCalendar();
    renderHistory();
  });
  $('#calendar-grid').addEventListener('keydown', event => {
    const cell = event.target.closest('[data-day]');
    if (!cell || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    selectedDay = cell.dataset.day;
    renderCalendar();
    renderHistory();
  });

  function applyTheme() {
    const preference = state.theme || 'system';
    const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.dataset.theme = dark ? 'dark' : 'light';
    $('#theme-select').value = preference;
    document.querySelector('meta[name=theme-color]').content = dark ? '#161a17' : '#f6f5f1';
  }
  $('#theme-select').addEventListener('change', event => { state.theme = event.target.value; save(); applyTheme(); });
  $('#payday-select').addEventListener('change', event => {
    state.payday = Core.normalizedPayday(event.target.value);
    selectedPeriod = Core.periodForDate(todayKey, state.payday);
    $('#payday-select').value = String(state.payday);
    save();
    update();
    showToast('Okres budżetowy zaktualizowany');
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  $('#export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `Spendo-kopia-${todayKey}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    showToast('Kopia danych pobrana');
  });

  $('#payday-select').value = String(state.payday);
  applyTheme();
  update();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
