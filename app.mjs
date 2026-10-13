import { aggregateMonths, aggregateWeeks, exportBackup, exportCsv, parseBackup, validateShift } from './core.mjs';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'shiftledger.shifts.v1';
let shifts = loadShifts();
let period = 'month';
let query = '';

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cleanShift(shift) {
  return { date: shift.date, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes, rate: shift.rate, currency: shift.currency, note: shift.note || '' };
}

function loadShifts() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5000).flatMap((item) => {
      try {
        if (typeof item.id !== 'string' || !item.id) return [];
        return [{ id: item.id.slice(0, 80), ...cleanShift(validateShift(item)) }];
      } catch { return []; }
    });
  } catch { return []; }
}

function save(nextShifts = shifts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextShifts));
    shifts = nextShifts;
    render();
    return true;
  } catch {
    message('Не удалось сохранить: хранилище браузера переполнено.', true);
    return false;
  }
}

function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function displayMoney(cents, currency) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

function displayHours(minutes) {
  return `${(minutes / 60).toFixed(2)} ч`;
}

function filteredShifts() {
  const today = new Date();
  const date = localDate(today);
  const items = shifts.map((item) => ({ ...item, calc: validateShift(item) }));
  let result = items;
  if (period === 'month') result = items.filter((item) => item.date.slice(0, 7) === date.slice(0, 7));
  if (period === 'week') {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    const from = localDate(monday), to = localDate(sunday);
    result = items.filter((item) => item.date >= from && item.date <= to);
  }
  if (query) {
    const q = query.trim().toLowerCase();
    result = result.filter((item) => `${item.date} ${item.start} ${item.end} ${item.currency} ${item.note}`.toLowerCase().includes(q));
  }
  return result.sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
}

function groupCurrencies(items) {
  const result = new Map();
  for (const item of items) {
    const current = result.get(item.currency) || { cents: 0, minutes: 0, count: 0 };
    current.cents += item.calc.payCents;
    current.minutes += item.calc.paidMinutes;
    current.count += 1;
    result.set(item.currency, current);
  }
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function metric(label, value, detail) {
  const card = document.createElement('article'); card.className = 'metric';
  const title = document.createElement('span'); title.className = 'metric-label'; title.textContent = label;
  const amount = document.createElement('strong'); amount.className = 'metric-value'; amount.textContent = value;
  const note = document.createElement('span'); note.className = 'metric-detail'; note.textContent = detail;
  card.append(title, amount, note); return card;
}

function renderSummary(items) {
  const grid = $('summary-grid'); grid.replaceChildren();
  const totalMinutes = items.reduce((sum, item) => sum + item.calc.paidMinutes, 0);
  const totalShifts = items.length;
  const money = groupCurrencies(items);
  const headline = money.length === 1 ? displayMoney(money[0][1].cents, money[0][0]) : money.length ? `${money.length} валюты` : '—';
  const earningsNote = money.length === 1 ? `${money[0][0]} · до налогов` : 'Разные валюты показаны отдельно';
  grid.append(metric('ОПЛАЧИВАЕМЫЕ ЧАСЫ', displayHours(totalMinutes), `${(totalMinutes / 60).toFixed(2)} часов суммарно`), metric('СМЕНЫ', String(totalShifts), period === 'month' ? 'В выбранном месяце' : period === 'week' ? 'На этой неделе' : 'За всё время'), metric('НАЧИСЛЕНО', headline, earningsNote));
  const chips = $('currency-summary'); chips.replaceChildren();
  if (!money.length) {
    const empty = document.createElement('span'); empty.className = 'fine-print'; empty.textContent = 'Добавь смену, чтобы увидеть сумму по каждой валюте.'; chips.append(empty);
  } else for (const [currency, data] of money) {
    const chip = document.createElement('span'); chip.className = 'currency-chip';
    const name = document.createElement('b'); name.textContent = currency;
    const value = document.createElement('span'); value.textContent = displayMoney(data.cents, currency);
    const hours = document.createElement('small'); hours.textContent = `${displayHours(data.minutes)} · ${data.count} смен`;
    chip.append(name, value, hours); chips.append(chip);
  }
}

function renderRows(items) {
  const body = $('shift-rows'); body.replaceChildren();
  $('empty-state').hidden = items.length > 0;
  $('record-count').textContent = items.length ? `Показано ${items.length} ${items.length === 1 ? 'смена' : 'смен'} · всего записей: ${shifts.length}` : '';
  for (const item of items) {
    const row = document.createElement('tr');
    const values = [
      ['date', new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${item.date}T12:00:00`))],
      ['', `${item.start}–${item.end}`], ['', `${item.breakMinutes} мин`], ['', displayHours(item.calc.paidMinutes)], ['', `${(item.calc.rateCents / 100).toFixed(2)} ${item.currency}/ч`], ['amount', displayMoney(item.calc.payCents, item.currency)], ['note', item.note || '—'],
    ];
    for (const [className, text] of values) { const cell = document.createElement('td'); cell.className = className; cell.textContent = text; if (className === 'note') cell.title = item.note || ''; row.append(cell); }
    const actions = document.createElement('td'); actions.className = 'row-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Изменить'; edit.setAttribute('aria-label', `Изменить смену ${item.date}`); edit.addEventListener('click', () => startEdit(item.id));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Удалить'; remove.setAttribute('aria-label', `Удалить смену ${item.date}`); remove.addEventListener('click', () => deleteShift(item.id));
    actions.append(edit, remove); row.append(actions); body.append(row);
  }
}

function renderPeriods() {
  const filtered = shifts.map((item) => ({ ...item, calc: validateShift(item) }));
  const weekly = aggregateWeeks(filtered);
  const monthly = aggregateMonths(filtered);
  const renderLedger = (targetId, rows, emptyText) => {
    const target = $(targetId); target.replaceChildren();
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'fine-print'; empty.textContent = emptyText; target.append(empty); return; }
    for (const row of [...rows].reverse().slice(0, 8)) {
      const line = document.createElement('div'); line.className = 'ledger-row';
      const period = document.createElement('strong'); period.textContent = row.period;
      const detail = document.createElement('span'); detail.textContent = `${row.shifts} смен · ${displayHours(row.paidMinutes)}`;
      const amount = document.createElement('b'); amount.textContent = displayMoney(row.payCents, row.currency);
      const currency = document.createElement('small'); currency.textContent = row.currency;
      line.append(period, detail, amount, currency); target.append(line);
    }
    if (rows.length > 8) { const more = document.createElement('p'); more.className = 'ledger-more'; more.textContent = `Показаны последние 8 из ${rows.length} периодов`; target.append(more); }
  };
  renderLedger('weekly-summary', weekly, 'Недельные итоги появятся после первой смены.');
  renderLedger('monthly-summary', monthly, 'Месячные итоги появятся после первой смены.');
}

function render() {
  const items = filteredShifts();
  renderSummary(items);
  renderRows(items);
  renderPeriods();
}

function resetForm() {
  $('shift-form').reset();
  $('edit-id').value = '';
  $('shift-date').value = localDate();
  $('shift-start').value = '09:00'; $('shift-end').value = '17:00'; $('shift-break').value = '30';
  $('form-title').textContent = 'Добавить смену'; $('save-shift').innerHTML = 'Сохранить смену <span>↗</span>';
  $('cancel-edit').hidden = true;
}

function startEdit(id) {
  const item = shifts.find((shift) => shift.id === id); if (!item) return;
  $('edit-id').value = id; $('shift-date').value = item.date; $('shift-start').value = item.start; $('shift-end').value = item.end;
  $('shift-break').value = String(item.breakMinutes); $('shift-rate').value = item.rate; $('shift-currency').value = item.currency; $('shift-note').value = item.note || '';
  $('form-title').textContent = 'Изменить смену'; $('save-shift').textContent = 'Сохранить изменения'; $('cancel-edit').hidden = false;
  location.hash = 'entry'; $('shift-date').focus();
}

function deleteShift(id) {
  const nextShifts = shifts.filter((item) => item.id !== id);
  if (save(nextShifts)) message('Запись смены удалена.');
}

function submitShift(event) {
  event.preventDefault();
  try {
    const shift = validateShift({ date: $('shift-date').value, start: $('shift-start').value, end: $('shift-end').value, breakMinutes: Number($('shift-break').value), rate: $('shift-rate').value, currency: $('shift-currency').value, note: $('shift-note').value });
    const id = $('edit-id').value;
    let nextShifts;
    if (id) nextShifts = shifts.map((item) => item.id === id ? { id, ...cleanShift(shift) } : item);
    else {
      if (shifts.length >= 5000) throw new Error('Достигнут лимит 5000 смен. Экспортируй архив и очисти часть записей.');
      nextShifts = [...shifts, { id: crypto.randomUUID(), ...cleanShift(shift) }];
    }
    if (save(nextShifts)) { resetForm(); message(id ? 'Изменения сохранены.' : 'Смена добавлена.'); }
  } catch (error) { message(error.message || 'Не удалось сохранить смену.', true); }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file) {
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('JSON-файл больше 2 МБ.');
    const incoming = parseBackup(await file.text());
    if (shifts.length + incoming.length > 5000) throw new Error('Импорт превысит лимит 5000 смен. Сначала экспортируй и освободи место.');
    if (!confirm(`Добавить ${incoming.length} смен из архива? Текущие записи останутся.`)) return;
    const nextShifts = [...shifts, ...incoming.map((item) => ({ id: crypto.randomUUID(), ...item }))];
    if (save(nextShifts)) message(`Добавлено записей: ${incoming.length}.`);
  } catch (error) { message(error.message || 'Не удалось импортировать файл.', true); }
  finally { $('import-json').value = ''; }
}

$('shift-form').addEventListener('submit', submitShift);
$('cancel-edit').addEventListener('click', () => { resetForm(); message('Редактирование отменено.'); });
$('period-filter').addEventListener('change', (event) => { period = event.target.value; render(); });
$('reset-period').addEventListener('click', () => { period = 'month'; query = ''; $('period-filter').value = 'month'; $('search').value = ''; render(); });
$('search').addEventListener('input', (event) => { query = event.target.value; render(); });
$('export-csv').addEventListener('click', () => { try { download('shiftledger-shifts.csv', `\ufeff${exportCsv(shifts)}`, 'text/csv;charset=utf-8'); message(`Экспортировано смен: ${shifts.length}.`); } catch (error) { message(error.message, true); } });
$('export-json').addEventListener('click', () => { try { download('shiftledger-backup.json', exportBackup(shifts), 'application/json'); message('JSON-резервная копия готова.'); } catch (error) { message(error.message, true); } });
$('import-json').addEventListener('change', () => importFile($('import-json').files?.[0]));
$('shift-date').value = localDate();
render();
