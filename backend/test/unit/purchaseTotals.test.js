import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseTotals } from '../../src/utils/purchaseTotals.js';

test('neto por alícuota, IVA sobre cada neto y total = neto + IVA', () => {
  const r = purchaseTotals([
    { quantity: 2, unitCost: 500, vatRate: 21 },
    { quantity: 10, unitCost: 100, vatRate: 10.5 },
    { quantity: 1, unitCost: 300, vatRate: 21 },
  ]);
  assert.deepEqual(r.byRate, [
    { rate: 21, net: 1300, vat: 273, total: 1573 },
    { rate: 10.5, net: 1000, vat: 105, total: 1105 },
  ]);
  assert.equal(r.subtotal, 2300);
  assert.equal(r.vatAmount, 378);
  assert.equal(r.total, 2678);
});

test('cada renglón se redondea a centavos y el IVA se redondea una vez por alícuota', () => {
  const r = purchaseTotals([
    { quantity: 3, unitCost: 10.33, vatRate: 21 },
    { quantity: 0.333, unitCost: 99.99, vatRate: 21 },
  ]);
  // 30,99 + 33,30 (33,29667) = 64,29 → IVA 13,50 (13,5009)
  assert.equal(r.subtotal, 64.29);
  assert.equal(r.vatAmount, 13.5);
  assert.equal(r.total, 77.79);
});

test('sin IVA (0%) y sin renglones', () => {
  assert.deepEqual(purchaseTotals([{ quantity: 1, unitCost: 100, vatRate: 0 }]).byRate, [
    { rate: 0, net: 100, vat: 0, total: 100 },
  ]);
  assert.deepEqual(purchaseTotals([]), { byRate: [], subtotal: 0, vatAmount: 0, total: 0 });
});
