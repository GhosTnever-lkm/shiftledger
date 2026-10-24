export const BACKUP_VERSION = 1;
export const MAX_SHIFTS = 5000;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export class ShiftError extends Error {
  constructor(code, message) { super(message); this.name = 'ShiftError'; this.code = code; }
}

function fail(code, message) { throw new ShiftError(code, message); }

function validDate(value) {
  if (typeof value !== 'string') fail('INVALID_DATE', 'Date must use YYYY-MM-DD.');
  const match = DATE_RE.exec(value);
  if (!match) fail('INVALID_DATE', 'Date must use YYYY-MM-DD.');
  const [, year, month, day] = match;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (date.toISOString().slice(0, 10) !== value) fail('INVALID_DATE', 'Date is not a real calendar day.');
  return value;
}

function validTime(value, field) {
  if (typeof value !== 'string' || !TIME_RE.test(value)) fail('INVALID_TIME', `${field} must use 24-hour HH:MM.`);
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function rateToCents(value) {
  const source = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof source !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(source)) fail('INVALID_RATE', 'Hourly rate must be a non-negative amount with at most two decimals.');
  const [whole, fraction = ''] = source.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function validateShift(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_SHIFT', 'Shift must be an object.');
  const date = validDate(input.date);
  const startMinutes = validTime(input.start, 'Start time');
  const endMinutesRaw = validTime(input.end, 'End time');
  const elapsedMinutes = endMinutesRaw <= startMinutes ? endMinutesRaw + 1440 - startMinutes : endMinutesRaw - startMinutes;
  if (elapsedMinutes <= 0 || elapsedMinutes > 1440) fail('INVALID_DURATION', 'Shift duration must be between 1 minute and 24 hours.');
  const breakMinutes = input.breakMinutes;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > elapsedMinutes) fail('INVALID_BREAK', 'Break must be whole minutes within the shift duration.');
  const rateCents = rateToCents(input.rate);
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) fail('INVALID_CURRENCY', 'Currency must be a three-letter uppercase code.');
  const note = input.note ?? '';
  if (typeof note !== 'string' || note.length > 500) fail('INVALID_NOTE', 'Note must be text up to 500 characters.');
  const paidMinutes = elapsedMinutes - breakMinutes;
  const payCents = Math.round((rateCents * paidMinutes) / 60);
  return { date, start: input.start, end: input.end, breakMinutes, rate: (rateCents / 100).toFixed(2), rateCents, currency: input.currency, note, elapsedMinutes, paidMinutes, payCents };
}

function isoWeek(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + (3 - ((firstThursday.getUTCDay() + 6) % 7)));
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function aggregateBy(shifts, keyFor) {
  if (!Array.isArray(shifts)) fail('INVALID_SHIFTS', 'Shifts must be an array.');
  const groups = new Map();
  for (const entry of shifts) {
    const shift = validateShift(entry);
    const period = keyFor(shift.date);
    const key = `${period}|${shift.currency}`;
    const current = groups.get(key) || { period, currency: shift.currency, shifts: 0, elapsedMinutes: 0, paidMinutes: 0, payCents: 0 };
    current.shifts += 1;
    current.elapsedMinutes += shift.elapsedMinutes;
    current.paidMinutes += shift.paidMinutes;
    current.payCents += shift.payCents;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency));
}

export function aggregateWeeks(shifts) { return aggregateBy(shifts, isoWeek); }
export function aggregateMonths(shifts) { return aggregateBy(shifts, (date) => date.slice(0, 7)); }

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportCsv(shifts) {
  if (!Array.isArray(shifts)) fail('INVALID_SHIFTS', 'Shifts must be an array.');
  const header = ['date', 'start', 'end', 'break_minutes', 'elapsed_hours', 'paid_hours', 'hourly_rate', 'gross_pay', 'currency', 'note'];
  const rows = shifts.map((entry) => {
    const shift = validateShift(entry);
    return [shift.date, shift.start, shift.end, shift.breakMinutes, (shift.elapsedMinutes / 60).toFixed(2), (shift.paidMinutes / 60).toFixed(2), (shift.rateCents / 100).toFixed(2), (shift.payCents / 100).toFixed(2), shift.currency, shift.note];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function exportBackup(shifts) {
  if (!Array.isArray(shifts) || shifts.length > MAX_SHIFTS) fail('SHIFT_LIMIT', `Backup may contain at most ${MAX_SHIFTS} shifts.`);
  const clean = shifts.map((entry) => {
    const shift = validateShift(entry);
    return { date: shift.date, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes, rate: (shift.rateCents / 100).toFixed(2), currency: shift.currency, note: shift.note };
  });
  const backup = JSON.stringify({ app: 'ShiftLedger', version: BACKUP_VERSION, shifts: clean }, null, 2);
  if (new TextEncoder().encode(backup).byteLength > MAX_BACKUP_BYTES) fail('BACKUP_TOO_LARGE', 'Backup must be no larger than 20 MiB.');
  return backup;
}

export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) fail('BACKUP_TOO_LARGE', 'Backup must be no larger than 20 MiB.');
  let data;
  try { data = JSON.parse(text); } catch { fail('INVALID_BACKUP', 'Backup is not valid JSON.'); }
  if (!data || data.app !== 'ShiftLedger' || data.version !== BACKUP_VERSION || !Array.isArray(data.shifts)) fail('INVALID_BACKUP', 'Backup format or version is not supported.');
  if (data.shifts.length > MAX_SHIFTS) fail('SHIFT_LIMIT', `Backup may contain at most ${MAX_SHIFTS} shifts.`);
  return data.shifts.map((entry) => {
    const shift = validateShift(entry);
    return { date: shift.date, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes, rate: (shift.rateCents / 100).toFixed(2), currency: shift.currency, note: shift.note };
  });
}
