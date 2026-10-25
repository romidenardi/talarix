import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toNumber, toNumberOrZero, isNonNegative, round2, round3,
  isPositiveQuantity, isNonNegativeQuantity, quantityAllowedFor,
} from '../../src/utils/numbers.js';

test('toNumber acepta números y texto numérico, rechaza vacíos y objetos', () => {
  assert.equal(toNumber(5), 5);
  assert.equal(toNumber('12.5'), 12.5);
  assert.ok(Number.isNaN(toNumber('')));
  assert.ok(Number.isNaN(toNumber('   ')));
  assert.ok(Number.isNaN(toNumber(null)));
  assert.ok(Number.isNaN(toNumber({})));
  assert.ok(Number.isNaN(toNumber([3])));
});

test('toNumberOrZero: vacío es 0', () => {
  assert.equal(toNumberOrZero(undefined), 0);
  assert.equal(toNumberOrZero(''), 0);
  assert.equal(toNumberOrZero('10'), 10);
});

test('isNonNegative rechaza negativos y no numéricos', () => {
  assert.equal(isNonNegative(0), true);
  assert.equal(isNonNegative('1500.50'), true);
  assert.equal(isNonNegative(-5), false);
  assert.equal(isNonNegative('abc'), false);
  assert.equal(isNonNegative(Infinity), false);
});

test('round2 y round3 redondean bien los casos típicos de coma flotante', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(10.333 * 3), 31);
  assert.equal(round3(0.1 + 0.2), 0.3);
  assert.equal(round3(2.0005), 2.001);
});

test('cantidades: positivas, con hasta 3 decimales y con tope', () => {
  assert.equal(isPositiveQuantity(1), true);
  assert.equal(isPositiveQuantity('0.250'), true);
  assert.equal(isPositiveQuantity(0.001), true);
  assert.equal(isPositiveQuantity(0), false);
  assert.equal(isPositiveQuantity(-1), false);
  assert.equal(isPositiveQuantity(0.0001), false);
  assert.equal(isPositiveQuantity(1e12), false);
  assert.equal(isPositiveQuantity({}), false);
  assert.equal(isNonNegativeQuantity(0), true);
  assert.equal(isNonNegativeQuantity(-0.001), false);
});

test('por unidad solo enteros; por peso, decimales', () => {
  assert.equal(quantityAllowedFor({ unitType: 'unit' }, 2), true);
  assert.equal(quantityAllowedFor({ unitType: 'unit' }, 1.5), false);
  assert.equal(quantityAllowedFor({ unitType: 'weight' }, 0.125), true);
});
