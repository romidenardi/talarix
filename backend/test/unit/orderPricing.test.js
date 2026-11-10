import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceOrder, discriminatesVatFor, vatBreakdown } from '../../src/services/orderPricing.js';

test('10,333 × 3: el precio se redondea a 10,33 y el total cierra con el renglón (30,99)', () => {
  const r = priceOrder({ lines: [{ quantity: 3, unitPrice: 10.333, vatRate: 21 }] });
  assert.deepEqual(r.lineTotals, [30.99]);
  assert.equal(r.grossTotal, 30.99);
  assert.equal(r.total, 30.99);
});

test('la suma de renglones no arrastra errores de coma flotante', () => {
  const lines = Array.from({ length: 10 }, () => ({ quantity: 1, unitPrice: 0.1, vatRate: 21 }));
  assert.equal(priceOrder({ lines }).total, 1);
});

test('producto por peso: 0,250 kg × $30.000', () => {
  assert.equal(priceOrder({ lines: [{ quantity: 0.25, unitPrice: 30000, vatRate: 21 }] }).total, 7500);
});

test('descuento por porcentaje y por monto', () => {
  const r = priceOrder({
    lines: [{ quantity: 2, unitPrice: 1000, vatRate: 21 }],
    discountPercent: 10,
    discountAmount: 100,
  });
  assert.equal(r.grossTotal, 2000);
  assert.equal(r.totalDiscount, 300);
  assert.equal(r.total, 1700);
});

test('descuento mayor al total: error', () => {
  assert.throws(() => priceOrder({ lines: [{ quantity: 1, unitPrice: 100 }], discountAmount: 150 }), /mayor al total/);
  assert.equal(priceOrder({ lines: [{ quantity: 1, unitPrice: 100 }], discountPercent: 100 }).total, 0);
});

test('Responsable Inscripto: neto + IVA + internos = total, también con descuento', () => {
  const r = priceOrder({
    lines: [
      { quantity: 1, unitPrice: 1210, vatRate: 21 },
      { quantity: 2, unitPrice: 552.5, vatRate: 10.5 },
      { quantity: 1, unitPrice: 1290, vatRate: 21, otherTaxes: 8 },
    ],
    discountPercent: 5,
    discriminatesVat: true,
  });
  assert.ok(Math.abs(r.subtotal + r.vatAmount + r.internalTaxAmount - r.total) <= 0.02, JSON.stringify(r));
  assert.ok(r.internalTaxAmount > 0);
});

test('consumidor final: no discrimina IVA', () => {
  const r = priceOrder({ lines: [{ quantity: 1, unitPrice: 1210, vatRate: 21 }] });
  assert.equal(r.subtotal, null);
  assert.equal(r.vatAmount, null);
  assert.equal(discriminatesVatFor('Responsable Inscripto'), true);
  assert.equal(discriminatesVatFor('Consumidor Final'), false);
});

test('combo con productos de distinta alícuota', () => {
  const r = priceOrder({
    lines: [
      {
        quantity: 1,
        unitPrice: 3000,
        components: [
          { price: 1000, quantity: 1, vatRate: 21 },
          { price: 1000, quantity: 2, vatRate: 10.5 },
        ],
      },
    ],
    discriminatesVat: true,
  });
  assert.equal(r.total, 3000);
  assert.ok(Math.abs(r.subtotal + r.vatAmount - 3000) <= 0.01);
});

test('cuotas con interés', () => {
  const r = priceOrder({ lines: [{ quantity: 1, unitPrice: 1000 }], plan: { installments: 3, interestRate: 12 } });
  assert.equal(r.totalFinanced, 1120);
  assert.equal(r.installmentAmount, 373.33);
  assert.equal(r.installmentsCount, 3);
});

const round = (n) => Math.round(n * 100) / 100;

// Arma el remito con priceOrder y lo desglosa como al imprimirlo
const breakdownOf = (lines, discount = {}) => {
  const r = priceOrder({ lines, discriminatesVat: true, ...discount });
  const rows = vatBreakdown({
    items: lines,
    grossTotal: r.grossTotal,
    total: r.total,
    subtotal: r.subtotal,
    vatAmount: r.vatAmount,
  });
  return { r, rows };
};

test('desglose de IVA: un renglón por alícuota y la suma da el IVA del remito', () => {
  const { r, rows } = breakdownOf([
    { quantity: 1, unitPrice: 1210, vatRate: 21 },
    { quantity: 2, unitPrice: 552.5, vatRate: 10.5 },
  ]);
  assert.deepEqual(
    rows.map((x) => x.rate),
    [21, 10.5],
  );
  assert.equal(rows[0].vat, 210);
  assert.equal(rows[1].vat, 105);
  assert.equal(rows[0].vat + rows[1].vat, r.vatAmount);
});

test('desglose de IVA: el combo reparte entre las alícuotas de sus productos', () => {
  const { r, rows } = breakdownOf([
    {
      quantity: 1,
      unitPrice: 2000,
      vatRate: null,
      components: [
        { price: 1210, quantity: 1, vatRate: 21, otherTaxes: 0 },
        { price: 1105, quantity: 1, vatRate: 10.5, otherTaxes: 0 },
      ],
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(round(rows.reduce((s, x) => s + x.vat, 0)), r.vatAmount);
  assert.equal(round(rows.reduce((s, x) => s + x.net, 0)), r.subtotal);
});

test('desglose de IVA: con descuento y centavos sueltos, la suma cierra igual', () => {
  const { r, rows } = breakdownOf(
    [
      { quantity: 3, unitPrice: 10.33, vatRate: 21 },
      { quantity: 7, unitPrice: 3.17, vatRate: 10.5 },
      { quantity: 1, unitPrice: 99.99, vatRate: 21 },
    ],
    { discountPercent: 7 },
  );
  assert.equal(round(rows.reduce((s, x) => s + x.vat, 0)), r.vatAmount);
  assert.equal(round(rows.reduce((s, x) => s + x.net, 0)), r.subtotal);
});

test('desglose de IVA: remito viejo sin alícuota guardada usa la del producto', () => {
  const rows = vatBreakdown({
    items: [{ quantity: 1, unitPrice: 1105, vatRate: null, fallbackVatRate: '10.50' }],
    grossTotal: 1105,
    total: 1105,
    subtotal: 1000,
    vatAmount: 105,
  });
  assert.deepEqual(rows, [{ rate: 10.5, net: 1000, vat: 105 }]);
});
