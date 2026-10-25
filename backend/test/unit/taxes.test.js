import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPrice, splitLineParts } from '../../src/utils/taxes.js';

const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.005, `${msg}: ${actual} ≠ ${expected}`);

test('precio con IVA 21%: neto + IVA = total', () => {
  const { net, vat, internal } = splitPrice(1210, 21, 0);
  close(net, 1000, 'neto');
  close(vat, 210, 'IVA');
  close(internal, 0, 'internos');
});

test('IVA 10,5% e impuestos internos', () => {
  const { net, vat, internal } = splitPrice(1155, 10.5, 5);
  close(net, 1000, 'neto');
  close(vat, 105, 'IVA');
  close(internal, 50, 'internos');
  close(net + vat + internal, 1155, 'suma');
});

test('IVA 0% o vacío: todo es neto', () => {
  assert.deepEqual(splitPrice(500, 0, 0), { net: 500, vat: 0, internal: 0 });
  assert.deepEqual(splitPrice(500, null, undefined), { net: 500, vat: 0, internal: 0 });
});

test('combo: reparte el total según el precio de cada producto y respeta su alícuota', () => {
  const parts = splitLineParts(3000, [
    { price: 1000, quantity: 1, vatRate: 21 },
    { price: 1000, quantity: 2, vatRate: 10.5 },
  ]);
  close(parts[0].total, 1000, 'parte 1');
  close(parts[1].total, 2000, 'parte 2');
  assert.equal(parts[0].vatRate, 21);
  assert.equal(parts[1].vatRate, 10.5);
  close(parts.reduce((s, p) => s + p.net + p.vat + p.internal, 0), 3000, 'suma de partes');
});

test('combo con productos sin precio: reparte por cantidad', () => {
  const parts = splitLineParts(900, [
    { price: 0, quantity: 1, vatRate: 21 },
    { price: 0, quantity: 2, vatRate: 21 },
  ]);
  close(parts[0].total, 300, 'parte 1');
  close(parts[1].total, 600, 'parte 2');
});
