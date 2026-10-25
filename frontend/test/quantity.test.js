import { test } from 'node:test';
import assert from 'node:assert/strict';
import { round3, toKg, toPricePerKg, formatQuantity } from '../src/utils/quantity.js';

test('gramos a kg', () => {
  assert.equal(toKg(250, 'g'), 0.25);
  assert.equal(toKg(1, 'g'), 0.001);
  assert.equal(toKg(1.5, 'kg'), 1.5);
  assert.equal(toKg('', 'g'), 0);
});

test('precio cargado por 100 g se guarda por kg', () => {
  assert.equal(toPricePerKg(3000, '100'), 30000);
  assert.equal(toPricePerKg(1500, '500'), 3000);
  assert.equal(toPricePerKg(45, '1'), 45000);
  assert.equal(toPricePerKg(1000, '1000'), 1000);
});

test('round3', () => {
  assert.equal(round3(0.1 + 0.2), 0.3);
  assert.equal(round3('x'), 0);
});

test('formato de cantidades', () => {
  assert.equal(formatQuantity(0.25, 'weight'), '0,250 kg');
  assert.equal(formatQuantity(3, 'unit'), '3');
});
