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
  let billToDelete = '';
  let budgetGoalsSectionEnabled = null;
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

  function allocatableGoals() {
    return state.savingsGoals.filter(goal => goal.active !== false
      && !(goal.savedAmountConfirmed === true && Core.goalRemaining(goal) <= 0));
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

  function expenseRow(expense, editable = false) {
    const itemCategory = category(expense.category);
    const when = expense.date === todayKey && expense.created
      ? new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(expense.created))
      : new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(Core.parseDateKey(expense.date));
    return `<div class="expense-row"><span class="expense-icon">${itemCategory.icon}</span><div class="expense-info"><strong>${esc(expense.category)}</strong><small>${expense.note ? `${esc(expense.note)} · ` : ''}${when}</small></div><strong class="expense-price">−${money(expense.amount)} zł</strong>${editable ? `<button type="button" class="expense-edit" data-edit-expense="${esc(expense.id)}">Edytuj</button>` : ''}<button type="button" class="delete-button" data-delete="${esc(expense.id)}" aria-label="Usuń wydatek">×</button></div>`;
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
      return heading + expenseRow(expense, true);
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
    const savedBudget = state.budgets[selectedPeriod.planMonth];
    $('#budget-form').elements.bills.value = configured ? (savedBudget?.otherBills ?? budget.bills) : '';
    $('#budget-form').elements.fuel.value = configured ? budget.fuel : '';
    $('#budget-form').elements.savings.value = configured ? budget.savings : '';
    renderBudgetGoalAllocation();
    renderRecurringBills(configured && Array.isArray(savedBudget?.selectedBills) ? savedBudget.selectedBills : []);
    updateBudgetBillSummary();
    renderBillPayments(savedBudget, configured);
  }

  function renderBillPayments(savedBudget, configured) {
    const empty = $('#bill-payments-empty');
    const content = $('#bill-payments-content');
    const bills = configured && Array.isArray(savedBudget?.selectedBills)
      ? savedBudget.selectedBills.filter(bill => bill && typeof bill.id === 'string')
      : [];
    const uniqueBills = [...new Map(bills.map(bill => [bill.id, bill])).values()];

    content.classList.toggle('hidden', uniqueBills.length === 0);
    empty.classList.toggle('hidden', uniqueBills.length > 0);
    if (uniqueBills.length === 0) {
      empty.textContent = configured
        ? 'W tym okresie nie wybrano rachunków z biblioteki. Inne rachunki nie mają osobnych statusów płatności.'
        : 'Zapisz plan z wybranymi rachunkami, aby śledzić ich status płatności.';
      $('#bill-payments-list').innerHTML = '';
      return;
    }

    const paidCount = uniqueBills.filter(bill => bill.paid === true).length;
    const paidTotal = Core.roundMoney(uniqueBills.reduce((sum, bill) => sum + (bill.paid === true ? Number(bill.amount) : 0), 0));
    const unpaidTotal = Core.roundMoney(uniqueBills.reduce((sum, bill) => sum + (bill.paid === true ? 0 : Number(bill.amount)), 0));
    const progress = uniqueBills.length ? Math.round(paidCount / uniqueBills.length * 100) : 0;
    $('#bill-payments-paid-total').textContent = `${money(paidTotal)} zł`;
    $('#bill-payments-unpaid-total').textContent = `${money(unpaidTotal)} zł`;
    $('#bill-payments-count').textContent = `${paidCount} z ${uniqueBills.length}`;
    const progressBar = $('#bill-payments-progress');
    progressBar.setAttribute('aria-valuenow', String(progress));
    progressBar.setAttribute('aria-valuetext', `${paidCount} z ${uniqueBills.length} opłaconych rachunków`);
    progressBar.querySelector('span').style.width = `${progress}%`;
    $('#bill-payments-list').innerHTML = uniqueBills.map(bill => {
      const paid = bill.paid === true;
      const name = esc(bill.name);
      return `<div class="bill-payment-row"><div class="bill-payment-copy"><strong>${name}</strong><small>${money(Number(bill.amount))} zł · <span class="${paid ? 'is-paid' : ''}">${paid ? 'Opłacony' : 'Do zapłaty'}</span></small></div><button type="button" class="bill-payment-toggle${paid ? ' is-paid' : ''}" data-bill-payment-toggle="${esc(bill.id)}" aria-pressed="${paid}" aria-label="${paid ? 'Cofnij oznaczenie opłacenia rachunku' : 'Oznacz rachunek jako opłacony'}">${paid ? 'Cofnij' : 'Oznacz jako opłacony'}</button></div>`;
    }).join('');
  }

  function toggleBillPayment(id) {
    const savedBudget = state.budgets[selectedPeriod.planMonth];
    if (!hasBudget() || !Array.isArray(savedBudget?.selectedBills)) return;
    const bill = savedBudget.selectedBills.find(item => item.id === id);
    if (!bill) return;
    bill.paid = bill.paid !== true;
    save();
    renderBillPayments(savedBudget, true);
    [...$('#bill-payments-list').querySelectorAll('[data-bill-payment-toggle]')]
      .find(button => button.dataset.billPaymentToggle === id)?.focus();
  }

  function renderRecurringBills(savedBills = []) {
    const templates = new Map();
    state.recurringBills.forEach(bill => {
      if (bill?.id && !templates.has(bill.id)) templates.set(bill.id, bill);
    });
    const snapshots = new Map();
    (Array.isArray(savedBills) ? savedBills : []).forEach(bill => {
      if (bill?.id && !snapshots.has(bill.id)) snapshots.set(bill.id, bill);
    });
    const rows = [...templates.values()].map(template => {
      const snapshot = snapshots.get(template.id);
      const bill = snapshot || template;
      return recurringBillPlanRow(bill, templates.has(bill.id), Boolean(snapshot));
    });
    snapshots.forEach((snapshot, id) => {
      if (!templates.has(id)) rows.push(recurringBillPlanRow(snapshot, false, true));
    });
    $('#recurring-bills-empty').classList.toggle('hidden', templates.size > 0 || snapshots.size > 0);
    $('#recurring-bills-list').innerHTML = rows.join('');
  }

  function recurringBillPlanRow(bill, hasTemplate, snapshot = false) {
    const id = esc(bill.id);
    const name = esc(bill.name);
    const amount = Number(bill.amount);
    const amountLabel = money(amount);
    const detail = snapshot ? 'Migawka z planu · odznacz, aby użyć aktualnej kwoty' : 'Aktualna kwota z biblioteki';
    const actions = hasTemplate
      ? `<div class="recurring-bill-actions"><button class="goal-icon-button" type="button" data-bill-action="edit" data-bill-id="${id}" aria-label="Edytuj rachunek ${name}">✎</button><button class="goal-icon-button danger-icon" type="button" data-bill-action="delete" data-bill-id="${id}" aria-label="Usuń rachunek ${name}">×</button></div>`
      : '<div class="recurring-bill-actions recurring-bill-archived">Szablon usunięty</div>';
    return `<div class="recurring-bill-row"><label class="recurring-bill-select"><input type="checkbox" data-plan-bill-id="${id}" data-plan-bill-name="${name}" data-plan-bill-amount="${amount}" aria-label="Uwzględnij rachunek ${name}"${snapshot ? ' checked' : ''}><span class="recurring-bill-copy"><strong>${name}</strong><small>${detail}</small></span><strong class="recurring-bill-amount">${amountLabel} zł</strong></label>${actions}</div>`;
  }

  function selectedBillPlanFromForm() {
    const bills = [];
    const seen = new Set();
    let total = 0;
    for (const input of $$('[data-plan-bill-id]:checked')) {
      const id = input.dataset.planBillId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = input.dataset.planBillName;
      const amount = Number(input.dataset.planBillAmount);
      if (typeof name !== 'string' || !name.trim() || !Number.isFinite(amount) || amount <= 0) {
        return { bills: [], total: NaN, error: true };
      }
      total += amount;
      bills.push({ id, name, amount });
    }
    total = Core.roundMoney(total);
    return { bills, total, error: !Number.isFinite(total) };
  }

  function showCurrentBillTemplate(input) {
    const template = state.recurringBills.find(bill => bill.id === input.dataset.planBillId);
    if (!template) return;
    input.dataset.planBillName = template.name;
    input.dataset.planBillAmount = String(template.amount);
    input.setAttribute('aria-label', `Uwzględnij rachunek ${template.name}`);
    const row = input.closest('.recurring-bill-row');
    if (!row) return;
    row.querySelector('.recurring-bill-copy strong').textContent = template.name;
    row.querySelector('.recurring-bill-copy small').textContent = 'Aktualna kwota z biblioteki';
    row.querySelector('.recurring-bill-amount').textContent = `${money(template.amount)} zł`;
  }

  function updateBudgetBillSummary() {
    const manualValue = parseOptionalDecimalAmount($('#budget-form').elements.bills.value);
    const manual = Core.roundMoney(manualValue);
    const selected = selectedBillPlanFromForm();
    const total = Core.roundMoney(manual + selected.total);
    const validManual = Number.isFinite(manualValue) && manualValue >= 0 && Number.isFinite(manual);
    const valid = validManual && !selected.error && Number.isFinite(total);
    $('#bill-plan-selected-total').textContent = selected.error ? '—' : `${money(selected.total)} zł`;
    $('#bill-plan-other-total').textContent = validManual ? `${money(manual)} zł` : '—';
    $('#bill-plan-total').textContent = valid ? `${money(total)} zł` : '—';
    const error = !validManual
      ? 'Wpisz poprawną, nieujemną kwotę innych rachunków.'
      : selected.error
        ? 'Nie można odczytać kwoty zaznaczonego rachunku. Sprawdź pozycje z biblioteki.'
        : !Number.isFinite(total)
        ? 'Suma rachunków jest za duża do obliczenia.'
        : '';
    $('#bill-plan-error').textContent = error;
    $('#bill-plan-error').classList.toggle('hidden', !error);
  }

  function refreshRecurringBillLibraryPreservingDraft() {
    const selected = selectedBillPlanFromForm();
    const savedBudget = state.budgets[selectedPeriod.planMonth];
    const selectedBills = selected.error
      ? (Array.isArray(savedBudget?.selectedBills) ? savedBudget.selectedBills : [])
      : selected.bills;
    renderRecurringBills(selectedBills);
    updateBudgetBillSummary();
  }

  function renderBudgetGoalAllocation() {
    const goals = allocatableGoals();
    if (budgetGoalsSectionEnabled === null) budgetGoalsSectionEnabled = activeGoalAmount() > 0;
    $('#budget-goals-toggle').checked = budgetGoalsSectionEnabled;
    $('#budget-goal-allocation').classList.toggle('hidden', !budgetGoalsSectionEnabled);
    $('#budget-goals-preserved-note').classList.toggle('hidden', budgetGoalsSectionEnabled
      || !state.savingsGoals.some(goal => Number(goal.contributionPerPeriod) > 0));
    $('#budget-no-active-goals').classList.toggle('hidden', goals.length > 0);
    $('#budget-goal-fields').innerHTML = goals.map(goal => `<label class="budget-goal-row"><span>${esc(goal.name || 'Cel oszczędnościowy')}<small>Planowana składka / okres</small></span><span class="input-wrap"><input type="text" inputmode="decimal" autocomplete="off" data-goal-contribution="${esc(goal.id)}" aria-label="Planowana składka na cel ${esc(goal.name)}" value="${money(goal.contributionPerPeriod)}"><span>zł</span></span></label>`).join('');
    updateBudgetGoalAllocationSummary();
  }

  function parseDecimalAmount(value) {
    const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return NaN;
    return Number(normalized);
  }

  function parseOptionalDecimalAmount(value) {
    return String(value).trim() === '' ? 0 : parseDecimalAmount(value);
  }

  function updateBudgetGoalAllocationSummary() {
    const form = $('#budget-form');
    const pool = parseOptionalDecimalAmount(form.elements.savings.value);
    const inputs = $$('[data-goal-contribution]');
    const values = inputs.map(input => parseOptionalDecimalAmount(input.value));
    const valid = Number.isFinite(pool) && pool >= 0 && values.every(value => Number.isFinite(value) && value >= 0);
    const assigned = valid ? Core.roundMoney(values.reduce((sum, value) => sum + value, 0)) : NaN;
    const available = valid && Number.isFinite(assigned) ? Core.roundMoney(pool - assigned) : NaN;
    $('#budget-goal-assigned').textContent = valid && Number.isFinite(assigned) ? `${money(assigned)} / ${money(pool)} zł` : '—';
    $('#budget-goal-unassigned').textContent = Number.isFinite(available) && available >= 0 ? `${money(available)} zł` : '—';
    const error = !valid
      ? 'Wpisz poprawne kwoty nieujemne, z maksymalnie dwoma miejscami po przecinku.'
      : !Number.isFinite(assigned)
        ? 'Suma składek jest za duża do obliczenia.'
        : assigned > pool
          ? `Przypisano ${money(assigned)} zł, czyli o ${money(assigned - pool)} zł więcej niż pula Oszczędności (${money(pool)} zł). Zmniejsz składki lub zwiększ pulę.`
          : '';
    $('#budget-goal-error').textContent = error;
    $('#budget-goal-error').classList.toggle('hidden', !error);
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

  let expenseDraft = null;
  let expenseDeleteDraft = null;
  let expenseBusy = false;
  let expenseReturnFocus = null;

  function expenseError(message) {
    $('#expense-form-error').textContent = message;
    $('#expense-form-error').classList.remove('hidden');
  }

  function readExpenseStorage() {
    let stored;
    try { stored = localStorage.getItem(KEY); }
    catch { throw new Error('Nie można odczytać danych urządzenia. Spróbuj ponownie.'); }
    if (stored !== null) {
      let saved;
      try { saved = JSON.parse(stored); }
      catch { throw new Error('Zapisane dane są nieczytelne. Zachowaj kopię przed dalszymi zmianami.'); }
      if (JSON.stringify(saved) !== JSON.stringify(state)) throw new Error('Dane na urządzeniu zmieniły się. Odśwież aplikację przed edycją.');
    }
    return stored;
  }

  function expenseSnapshot(id) {
    const matches = state.expenses.filter(expense => expense.id === id);
    if (matches.length !== 1) throw new Error('Nie można jednoznacznie znaleźć wydatku. Otwórz Historię ponownie.');
    return { expense: { ...matches[0] }, stored: readExpenseStorage(), original: JSON.stringify(matches[0]) };
  }

  function openModal(expenseId = '') {
    // Add buttons pass their click event; only string IDs select an edit.
    if (typeof expenseId !== 'string') expenseId = '';
    const form = $('#expense-form');
    try {
      expenseDraft = expenseId ? expenseSnapshot(expenseId) : { stored: readExpenseStorage() };
    } catch (error) { showToast(error.message || 'Nie można odczytać danych.'); return; }
    expenseReturnFocus = document.activeElement;
    form.reset();
    const expense = expenseDraft.expense;
    form.elements.amount.value = expense ? String(expense.amount).replace('.', ',') : '';
    form.elements.date.value = expense?.date || todayKey;
    form.elements.category.value = expense?.category || 'Jedzenie';
    form.elements.note.value = expense?.note || '';
    form.querySelector('[type=submit]').disabled = false;
    form.querySelector('[type=submit]').textContent = expense ? 'Zapisz zmiany' : 'Zapisz wydatek';
    $('#modal-title').textContent = expense ? 'Edytuj wydatek' : 'Dodaj wydatek';
    $('#expense-form-error').classList.add('hidden');
    updateCategoryPoolHint();
    $('#expense-modal').classList.remove('hidden');
    setTimeout(() => { if (expenseDraft) form.elements.amount.focus(); }, 100);
  }

  function closeModal() {
    $('#expense-modal').classList.add('hidden');
    expenseDraft = null;
    expenseReturnFocus?.focus();
    expenseReturnFocus = null;
  }

  function persistExpenses(expenses, draft) {
    if (readExpenseStorage() !== draft.stored) throw new Error('Dane zmieniły się od otwarcia formularza. Odśwież aplikację i otwórz wydatek ponownie.');
    const next = { ...state, expenses };
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch { throw new Error('Nie udało się zapisać danych na urządzeniu (np. brak miejsca). Dane nie zostały zmienione.'); }
    state = next;
  }

  function saveExpense(event) {
    event.preventDefault();
    if (expenseBusy || !expenseDraft) return;
    const form = event.currentTarget;
    expenseBusy = true;
    form.querySelector('[type=submit]').disabled = true;
    try {
      const amount = parseDecimalAmount(form.elements.amount.value);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12 || Core.roundMoney(amount) <= 0) throw new Error('Wpisz dodatnią kwotę, maksymalnie 1 000 000 000 000 zł, z najwyżej dwoma miejscami po przecinku.');
      const date = form.elements.date.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '0100-01-01' || Core.dateKey(Core.parseDateKey(date)) !== date) throw new Error('Wybierz poprawną datę wydatku.');
      const category = Core.categories.find(item => item.name === form.elements.category.value);
      if (!category) throw new Error('Wybierz kategorię z listy.');
      const note = form.elements.note.value.trim();
      if (note.length > 80) throw new Error('Notatka może mieć najwyżej 80 znaków.');
      const original = expenseDraft.expense;
      if (original) {
        const current = expenseSnapshot(original.id);
        if (current.original !== expenseDraft.original) throw new Error('Wydatek został zmieniony. Otwórz go ponownie.');
        const from = Core.periodForDate(original.date, state.payday);
        const to = Core.periodForDate(date, state.payday);
        if (from.start !== to.start && !window.confirm(`Zmiana daty przeniesie wydatek z okresu ${periodLabel(from)} do ${periodLabel(to)}. Wydatki i dostępne kwoty w obu okresach zostaną przeliczone. Zapisać zmiany?`)) return;
      }
      const expense = {
        ...(original || {}),
        id: original?.id || (crypto.randomUUID ? crypto.randomUUID() : `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        amount: Core.roundMoney(amount), category: category.name, poolId: category.poolId,
        date, note, created: original?.created ?? new Date().toISOString()
      };
      if (!original && state.expenses.some(item => item.id === expense.id)) throw new Error('Nie udało się utworzyć identyfikatora. Spróbuj ponownie.');
      const expenses = original ? state.expenses.map(item => item.id === original.id ? expense : item) : [...state.expenses, expense];
      persistExpenses(expenses, expenseDraft);
      closeModal();
      update();
      const dateLabel = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' }).format(Core.parseDateKey(date));
      showToast(original ? 'Zmiany wydatku zapisane' : date === todayKey ? 'Wydatek dodany' : date < todayKey ? `Wydatek zapisany w historii — ${dateLabel}` : `Wydatek zapisany na ${dateLabel}`);
    } catch (error) {
      expenseError(error.message?.includes('Quota') ? 'Brak miejsca na zapis. Wydatek nie został zmieniony.' : error.message || 'Nie udało się zapisać wydatku. Dane nie zostały zmienione.');
    } finally {
      expenseBusy = false;
      form.querySelector('[type=submit]').disabled = false;
    }
  }

  function beginExpenseDelete(id) {
    try { expenseDeleteDraft = expenseSnapshot(id); }
    catch (error) { showToast(error.message || 'Nie można odczytać danych.'); return; }
    expenseReturnFocus = document.activeElement;
    const expense = expenseDeleteDraft.expense;
    $('#expense-delete-name').textContent = `${expense.note || expense.category} — ${money(expense.amount)} zł`;
    $('#expense-delete-error').textContent = '';
    $('#expense-delete-modal').classList.remove('hidden');
    $('#expense-delete-cancel').focus();
  }

  function closeExpenseDelete() {
    expenseDeleteDraft = null;
    $('#expense-delete-modal').classList.add('hidden');
    expenseReturnFocus?.focus();
    expenseReturnFocus = null;
  }

  function confirmExpenseDelete() {
    if (expenseBusy || !expenseDeleteDraft) return;
    expenseBusy = true;
    $('#expense-delete-confirm').disabled = true;
    try {
      const current = expenseSnapshot(expenseDeleteDraft.expense.id);
      if (current.original !== expenseDeleteDraft.original) throw new Error('Wydatek został zmieniony. Otwórz go ponownie.');
      persistExpenses(state.expenses.filter(item => item.id !== current.expense.id), expenseDeleteDraft);
      closeExpenseDelete();
      update();
      showToast('Wydatek usunięty');
    } catch (error) {
      $('#expense-delete-error').textContent = 'Nie udało się usunąć wydatku. Dane pozostały bez zmian. ' + (error.message || '');
    } finally { expenseBusy = false; $('#expense-delete-confirm').disabled = false; }
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

  function closeRecurringBillForm() {
    $('#recurring-bill-modal').classList.add('hidden');
    $('#recurring-bill-error').classList.add('hidden');
  }

  function openRecurringBillForm(billId = '') {
    const form = $('#recurring-bill-form');
    const bill = state.recurringBills.find(item => item.id === billId);
    form.reset();
    form.dataset.submitting = '';
    form.elements.id.value = bill?.id || '';
    form.elements.name.value = bill?.name || '';
    form.elements.amount.value = bill ? money(bill.amount) : '';
    $('#recurring-bill-modal-title').textContent = bill ? 'Edytuj rachunek' : 'Dodaj rachunek';
    form.querySelector('[type=submit]').textContent = bill ? 'Zapisz zmiany' : 'Dodaj rachunek';
    $('#recurring-bill-error').classList.add('hidden');
    $('#recurring-bill-modal').classList.remove('hidden');
    setTimeout(() => form.elements.name.focus(), 100);
  }

  function saveRecurringBill(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    const id = form.elements.id.value;
    const existing = state.recurringBills.find(bill => bill.id === id);
    const name = form.elements.name.value.trim();
    const amount = parseDecimalAmount(form.elements.amount.value);
    const roundedAmount = Core.roundMoney(amount);
    let error = '';
    if (!name) error = 'Wpisz nazwę rachunku.';
    else if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(roundedAmount) || roundedAmount <= 0) error = 'Wpisz poprawną kwotę większą od 0 zł (do dwóch miejsc po przecinku).';
    if (error) {
      form.dataset.submitting = '';
      $('#recurring-bill-error').textContent = error;
      $('#recurring-bill-error').classList.remove('hidden');
      return;
    }

    const bill = {
      id: existing?.id || (window.crypto?.randomUUID?.() || `bill-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      name,
      amount: roundedAmount
    };
    if (existing) state.recurringBills = state.recurringBills.map(item => item.id === existing.id ? bill : item);
    else state.recurringBills.push(bill);
    save();
    closeRecurringBillForm();
    refreshRecurringBillLibraryPreservingDraft();
    showToast(existing ? 'Rachunek zaktualizowany' : 'Rachunek dodany');
  }

  function beginRecurringBillDelete(billId) {
    const bill = state.recurringBills.find(item => item.id === billId);
    if (!bill) return;
    billToDelete = bill.id;
    $('#recurring-bill-delete-name').textContent = bill.name;
    $('#recurring-bill-delete-modal').classList.remove('hidden');
  }

  function closeRecurringBillDelete() {
    billToDelete = '';
    $('#recurring-bill-delete-modal').classList.add('hidden');
  }

  function confirmRecurringBillDelete() {
    if (!billToDelete) return;
    state.recurringBills = state.recurringBills.filter(bill => bill.id !== billToDelete);
    save();
    closeRecurringBillDelete();
    refreshRecurringBillLibraryPreservingDraft();
    showToast('Rachunek usunięty');
  }

  function saveGoalDeposit(event) {
    event.preventDefault();
    const goal = state.savingsGoals.find(item => item.id === depositGoalId);
    const amount = parseDecimalAmount(event.currentTarget.elements.amount.value);
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
    else if (!Number.isFinite(contributionPerPeriod) || contributionPerPeriod < 0) error = 'Planowana składka nie może być ujemna.';
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
  $$('[data-screen]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.screen === 'budget') {
      budgetGoalsSectionEnabled = null;
      update();
    }
    showScreen(button.dataset.screen);
  }));
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
  $('#add-recurring-bill').addEventListener('click', () => openRecurringBillForm());
  $('#recurring-bill-form').addEventListener('submit', saveRecurringBill);
  $('#recurring-bill-form').addEventListener('input', () => $('#recurring-bill-error').classList.add('hidden'));
  $$('[data-action=close-recurring-bill]').forEach(button => button.addEventListener('click', closeRecurringBillForm));
  $('#recurring-bill-modal').addEventListener('click', event => { if (event.target.id === 'recurring-bill-modal') closeRecurringBillForm(); });
  $('#recurring-bills-list').addEventListener('click', event => {
    const button = event.target.closest('[data-bill-action]');
    if (!button) return;
    if (button.dataset.billAction === 'edit') openRecurringBillForm(button.dataset.billId);
    else if (button.dataset.billAction === 'delete') beginRecurringBillDelete(button.dataset.billId);
  });
  $('#recurring-bills-list').addEventListener('change', event => {
    if (!event.target.matches('[data-plan-bill-id]')) return;
    if (!event.target.checked) showCurrentBillTemplate(event.target);
    updateBudgetBillSummary();
  });
  $('#bill-payments-list').addEventListener('click', event => {
    const button = event.target.closest('[data-bill-payment-toggle]');
    if (button) toggleBillPayment(button.dataset.billPaymentToggle);
  });
  $$('[data-action=cancel-bill-delete]').forEach(button => button.addEventListener('click', closeRecurringBillDelete));
  $('#recurring-bill-delete-modal').addEventListener('click', event => { if (event.target.id === 'recurring-bill-delete-modal') closeRecurringBillDelete(); });
  $('#recurring-bill-delete-modal [data-action=confirm-bill-delete]').addEventListener('click', confirmRecurringBillDelete);
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
    closeExpenseDelete();
    closeGoalForm();
    closeGoalDelete();
    closeDepositForm();
    closeRecurringBillForm();
    closeRecurringBillDelete();
  });

  $('#expense-form').addEventListener('submit', saveExpense);
  $('#expense-delete-cancel').addEventListener('click', closeExpenseDelete);
  $('#expense-delete-confirm').addEventListener('click', confirmExpenseDelete);
  $('#expense-delete-modal').addEventListener('click', event => { if (event.target.id === 'expense-delete-modal') closeExpenseDelete(); });
  document.addEventListener('click', event => {
    const edit = event.target.closest('[data-edit-expense]');
    if (edit) { openModal(edit.dataset.editExpense); return; }
    const button = event.target.closest('[data-delete]');
    if (button) beginExpenseDelete(button.dataset.delete);
  });

  $('#budget-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const amounts = {};
    for (const name of ['income', 'bills', 'fuel', 'savings']) {
      const value = parseOptionalDecimalAmount(form.elements[name].value);
      if (!Number.isFinite(value) || value < 0) {
        $('#budget-form-error').textContent = `Wpisz poprawną, nieujemną kwotę w polu „${({ income: 'Dochód na okres', bills: 'Inne rachunki (poza wybranymi)', fuel: 'Limit paliwa', savings: 'Planowane oszczędności' })[name]}”.`;
        $('#budget-form-error').classList.remove('hidden');
        return;
      }
      amounts[name] = Core.roundMoney(value);
    }

    const remainingBills = amounts.bills;
    const selectedBillPlan = selectedBillPlanFromForm();
    if (selectedBillPlan.error) {
      $('#bill-plan-error').textContent = 'Nie można poprawnie obliczyć zaznaczonych rachunków. Sprawdź ich kwoty i spróbuj ponownie.';
      $('#bill-plan-error').classList.remove('hidden');
      return;
    }
    amounts.bills = Core.roundMoney(remainingBills + selectedBillPlan.total);
    if (!Number.isFinite(amounts.bills)) {
      $('#bill-plan-error').textContent = 'Łączna kwota Rachunków jest za duża do obliczenia.';
      $('#bill-plan-error').classList.remove('hidden');
      return;
    }

    const allocationEnabled = $('#budget-goals-toggle').checked;
    const proposedContributions = new Map();
    let assigned = Core.activeGoalContributions(state.savingsGoals);
    if (allocationEnabled) {
      const inputs = $$('[data-goal-contribution]');
      const parsed = inputs.map(input => ({ id: input.dataset.goalContribution, value: parseOptionalDecimalAmount(input.value) }));
      if (parsed.some(item => !Number.isFinite(item.value) || item.value < 0)) {
        $('#budget-goal-error').textContent = 'Wpisz poprawne kwoty nieujemne, z maksymalnie dwoma miejscami po przecinku.';
        $('#budget-goal-error').classList.remove('hidden');
        return;
      }
      parsed.forEach(item => proposedContributions.set(item.id, item.value));
      assigned = Core.roundMoney(parsed.reduce((sum, item) => sum + item.value, 0));
      if (!Number.isFinite(assigned)) {
        $('#budget-goal-error').textContent = 'Suma składek jest za duża do obliczenia.';
        $('#budget-goal-error').classList.remove('hidden');
        return;
      }
    }
    if (assigned > amounts.savings) {
      $('#budget-form-error').textContent = `Aktywne składki celów wynoszą ${money(assigned)} zł, a pula Oszczędności ${money(amounts.savings)} zł. Zwiększ pulę albo zaznacz przypisywanie do celów i zmniejsz składki.`;
      $('#budget-form-error').classList.remove('hidden');
      if (allocationEnabled) {
        $('#budget-goal-error').textContent = `Przypisano ${money(assigned)} zł, czyli o ${money(assigned - amounts.savings)} zł więcej niż pula Oszczędności (${money(amounts.savings)} zł). Zmniejsz składki lub zwiększ pulę.`;
        $('#budget-goal-error').classList.remove('hidden');
      }
      return;
    }

    const planKey = selectedPeriod.planMonth;
    const previousPlan = state.budgets[planKey] || {};
    const previousBills = Array.isArray(previousPlan.selectedBills) ? previousPlan.selectedBills : [];
    const proposedBillById = new Map(selectedBillPlan.bills.map(bill => [bill.id, bill]));
    const changedPaidBills = previousBills.filter(previous => {
      if (previous.paid !== true) return false;
      const next = proposedBillById.get(previous.id);
      return !next || next.name !== previous.name || Core.roundMoney(Number(next.amount)) !== Core.roundMoney(Number(previous.amount));
    });
    if (changedPaidBills.length) {
      const details = changedPaidBills.map(bill => `• ${bill.name} — ${money(Number(bill.amount))} zł`).join('\n');
      const confirmed = window.confirm(`Te rachunki są oznaczone jako opłacone:\n${details}\n\nZmiana planu usunie lub zastąpi ich zapisany status w tym okresie. Czy chcesz kontynuować?`);
      if (!confirmed) return;
    }
    const selectedBills = selectedBillPlan.bills.map(bill => {
      const previous = previousBills.find(item => item.id === bill.id
        && item.name === bill.name
        && Core.roundMoney(Number(item.amount)) === Core.roundMoney(Number(bill.amount)));
      return { ...bill, paid: previous?.paid === true };
    });

    if (allocationEnabled) {
      allocatableGoals().forEach(goal => {
        if (proposedContributions.has(goal.id)) goal.contributionPerPeriod = Core.roundGoalMoney(proposedContributions.get(goal.id));
      });
    }
    state.budgets[planKey] = {
      ...previousPlan,
      ...amounts,
      otherBills: remainingBills,
      selectedBills
    };
    $('#budget-form-error').classList.add('hidden');
    $('#budget-goal-error').classList.add('hidden');
    $('#bill-plan-error').classList.add('hidden');
    save();
    update();
    showToast('Plan zapisany');
  });

  $('#budget-goals-toggle').addEventListener('change', event => {
    budgetGoalsSectionEnabled = event.currentTarget.checked;
    $('#budget-goal-allocation').classList.toggle('hidden', !budgetGoalsSectionEnabled);
    $('#budget-goals-preserved-note').classList.toggle('hidden', budgetGoalsSectionEnabled
      || !state.savingsGoals.some(goal => Number(goal.contributionPerPeriod) > 0));
    updateBudgetGoalAllocationSummary();
  });
  $('#budget-form').addEventListener('input', () => {
    $('#budget-form-error').classList.add('hidden');
    updateBudgetGoalAllocationSummary();
    updateBudgetBillSummary();
  });
  $('#budget-go-to-goals').addEventListener('click', () => showScreen('goals'));

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

  let pendingImport = null;
  let importGeneration = 0;
  let importBusy = false;
  function cancelImport() {
    importGeneration++;
    pendingImport = null;
    $('#import-file').value = '';
    $('#import-consent').checked = false;
    $('#import-restore').disabled = true;
    $('#import-preview').classList.add('hidden');
    $('#import-error').textContent = '';
  }
  $('#import-data').addEventListener('click', () => {
    if (importBusy) return;
    cancelImport();
    $('#import-file').click();
  });
  $('#import-cancel').addEventListener('click', cancelImport);
  $('#import-export').addEventListener('click', () => $('#export-data').click());
  $('#import-consent').addEventListener('change', () => {
    $('#import-restore').disabled = importBusy || !pendingImport || !$('#import-consent').checked;
  });
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    cancelImport();
    if (!file) return;
    const generation = importGeneration;
    $('#import-preview').classList.remove('hidden');
    $('#import-info').textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KB`;
    $('#import-summary').textContent = 'Sprawdzanie kopii…';
    try {
      if (!/\.json$/i.test(file.name)) throw new Error('Wybierz plik z rozszerzeniem .json.');
      if (file.size > window.SpendoBackup.MAX_BYTES) throw new Error('Plik jest zbyt duży. Maksymalny rozmiar kopii to 5 MB.');
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reader.onabort = () => reject(new Error('Nie udało się odczytać pliku. Wybierz go ponownie.'));
        reader.readAsText(file);
      });
      if (generation !== importGeneration) return;
      const prepared = window.SpendoBackup.prepare(content);
      const expected = localStorage.getItem(KEY);
      pendingImport = { prepared, expected };
      const copy = prepared.state;
      $('#import-summary').textContent = `Wydatki: ${copy.expenses.length} · Okresy: ${Object.keys(copy.budgets).length} · Cele: ${copy.savingsGoals.length} · Stałe rachunki: ${copy.recurringBills.length} · Wersja danych: ${prepared.version} · Migracja: ${prepared.migrated ? 'tak, do wersji 6' : 'nie'}.`;
    } catch (error) {
      if (generation !== importGeneration) return;
      $('#import-summary').textContent = 'Kopia nie jest gotowa do przywrócenia.';
      $('#import-error').textContent = error.message || 'Nie udało się sprawdzić kopii.';
    }
  });
  $('#import-restore').addEventListener('click', () => {
    if (importBusy || !pendingImport || !$('#import-consent').checked) return;
    importBusy = true;
    $('#import-restore').disabled = true;
    try {
      const restored = window.SpendoBackup.restore(localStorage, pendingImport.prepared, pendingImport.expected);
      state = restored;
      selectedPeriod = Core.periodForDate(todayKey, state.payday);
      selectedMonth = Core.monthKey(today);
      selectedDay = '';
      budgetGoalsSectionEnabled = null;
      $('#payday-select').value = String(state.payday);
      cancelImport();
      applyTheme();
      update();
      showToast('Kopia przywrócona');
    } catch (error) {
      pendingImport = null;
      $('#import-consent').checked = false;
      $('#import-error').textContent = error.message || 'Nie udało się przywrócić kopii.';
    } finally { importBusy = false; }
  });

  $('#payday-select').value = String(state.payday);
  applyTheme();
  update();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
