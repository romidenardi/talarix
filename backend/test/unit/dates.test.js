import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, startOfDay, addDays, periodKey, readRange } from '../../src/utils/dates.js';

test('un remito de las 23:30 del último día del mes cuenta ese día y ese mes', () => {
  const lastNight = new Date('2026-10-31T23:30:00-03:00'); // en UTC ya es 1 de noviembre
  assert.equal(dayKey(lastNight), '2026-10-31');
  assert.equal(periodKey(lastNight, 'month'), '2026-10');
  assert.equal(dayKey(new Date('2026-11-01T00:05:00-03:00')), '2026-11-01');
});

test('el día arranca a las 00:00 de Argentina', () => {
  assert.equal(startOfDay('2026-10-31').toISOString(), '2026-10-31T03:00:00.000Z');
});

test('sumar días cruzando meses y años', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('semanas desde el lunes', () => {
  assert.equal(periodKey(new Date('2026-10-25T12:00:00-03:00'), 'week'), '2026-10-19'); // domingo
  assert.equal(periodKey(new Date('2026-10-26T12:00:00-03:00'), 'week'), '2026-10-26'); // lunes
});

test('rango de fechas: incluye el día "hasta" completo y rechaza rangos inválidos', () => {
  const { start, end } = readRange({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(start.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.throws(() => readRange({ from: '2026-10-31', to: '2026-10-01' }), /anterior/);
  assert.throws(() => readRange({ from: '31/10/2026', to: '2026-10-31' }), /formato/);
  assert.throws(() => readRange({ from: '2024-01-01', to: '2026-10-31' }), /rango máximo/);
});
