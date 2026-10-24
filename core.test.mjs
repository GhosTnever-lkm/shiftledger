import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMonths, aggregateWeeks, exportBackup, exportCsv, MAX_BACKUP_BYTES, parseBackup, ShiftError, validateShift } from './core.mjs';

const shift = (overrides = {}) => ({ date: '2026-10-10', start: '09:00', end: '17:30', breakMinutes: 30, rate: '12.50', currency: 'USD', ...overrides });

test('normalizes a daytime shift and computes exact gross cents', () => {
  assert.deepEqual(validateShift(shift()), { date: '2026-10-10', start: '09:00', end: '17:30', breakMinutes: 30, rate: '12.50', rateCents: 1250, currency: 'USD', note: '', elapsedMinutes: 510, paidMinutes: 480, payCents: 10000 });
});

test('handles a shift crossing midnight and same-time full day', () => {
  assert.equal(validateShift(shift({ start: '22:00', end: '06:00', breakMinutes: 45 })).paidMinutes, 435);
  assert.equal(validateShift(shift({ start: '00:00', end: '00:00', breakMinutes: 0 })).elapsedMinutes, 1440);
});

test('rejects impossible dates, malformed times, break overflow and rates', () => {
  for (const item of [shift({ date: '2026-02-29' }), shift({ start: '24:00' }), shift({ end: '12:99' }), shift({ breakMinutes: 511 }), shift({ rate: '-1' }), shift({ rate: '2.345' }), shift({ currency: 'usd' })]) assert.throws(() => validateShift(item), ShiftError);
});

test('rounds gross pay to cents using paid minutes', () => {
  assert.equal(validateShift(shift({ start: '09:00', end: '09:01', rate: '10.00', breakMinutes: 0 })).payCents, 17);
});

test('groups weekly and monthly totals without combining currencies', () => {
  const items = [shift(), shift({ date: '2026-10-11', currency: 'USD', start: '10:00', end: '14:00', breakMinutes: 0 }), shift({ date: '2026-10-11', currency: 'EUR' })];
  assert.deepEqual(aggregateWeeks(items).map((row) => [row.period, row.currency, row.shifts]), [['2026-W41', 'EUR', 1], ['2026-W41', 'USD', 2]]);
  assert.deepEqual(aggregateMonths(items).map((row) => [row.period, row.currency]), [['2026-10', 'EUR'], ['2026-10', 'USD']]);
});

test('uses ISO week-year at calendar year boundaries', () => {
  assert.equal(aggregateWeeks([shift({ date: '2021-01-01' })])[0].period, '2020-W53');
});

test('validates dates in years 0001 through 0099 without the JavaScript 1900 offset', () => {
  assert.equal(validateShift(shift({ date: '0001-01-01' })).date, '0001-01-01');
  assert.equal(validateShift(shift({ date: '0099-12-31' })).date, '0099-12-31');
  assert.throws(() => validateShift(shift({ date: '0001-02-29' })), { code: 'INVALID_DATE' });
});

test('exports quoted CSV and prefixes formula-like notes', () => {
  const csv = exportCsv([shift({ note: '=HYPERLINK("https://example.test")' })]);
  assert.ok(csv.startsWith('"date","start"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"")"'));
  assert.ok(csv.includes('\r\n'));
});

test('round-trips a versioned backup and rejects malformed or excessive backups', () => {
  const items = [shift(), shift({ date: '2026-10-11', currency: 'EUR' })];
  assert.deepEqual(parseBackup(exportBackup(items)), items.map((x) => ({ ...x, rate: '12.50', note: '' })));
  assert.throws(() => parseBackup('{'), { code: 'INVALID_BACKUP' });
  assert.throws(() => parseBackup(JSON.stringify({ app: 'ShiftLedger', version: 2, shifts: [] })), { code: 'INVALID_BACKUP' });
  assert.throws(() => parseBackup(JSON.stringify({ app: 'ShiftLedger', version: 1, shifts: Array(5001).fill(shift()) })), { code: 'SHIFT_LIMIT' });
  assert.throws(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), { code: 'BACKUP_TOO_LARGE' });
});

test('round-trips a maximum-size valid backup by UTF-8 byte size', () => {
  const items = Array.from({ length: 5000 }, () => shift({ note: '\0'.repeat(500) }));
  const backup = exportBackup(items);
  assert.ok(new TextEncoder().encode(backup).byteLength > 2_000_000);
  assert.ok(new TextEncoder().encode(backup).byteLength <= MAX_BACKUP_BYTES);
  assert.equal(parseBackup(backup).length, 5000);
  assert.throws(() => parseBackup('я'.repeat(MAX_BACKUP_BYTES / 2 + 1)), { code: 'BACKUP_TOO_LARGE' });
});
