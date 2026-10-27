// Listados por fechas y reportes sumados en la base
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';
import { dayKey } from '../../src/utils/dates.js';

let api;
let models;
let stop;
let A;
let B;

const DAY_MS = 24 * 60 * 60 * 1000;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Reportes A');
  B = await createBusiness(models, 'Reportes B');
});

after(async () => {
  await stop?.();
});

const sell = (business, items, extra = {}) =>
  api('POST', '/api/orders', {
    token: business.users.admin.token,
    body: {
      customerId: business.customer.id,
      paymentId: business.payment.id,
      requestId: newRequestId(),
      items,
      ...extra,
    },
  });

const get = (path, business = A) => api('GET', path, { token: business.users.admin.token });

describe('Listados por fechas', () => {
  it('remitos: sin fechas trae los últimos 30 días; con fechas, solo ese período', async () => {
    const recent = await sell(A, [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }]);
    const old = await sell(A, [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }]);
    assert.equal(recent.status, 201, JSON.stringify(recent.body));
    assert.equal(old.status, 201, JSON.stringify(old.body));
    const oldDate = new Date(Date.now() - 40 * DAY_MS);
    await models.Order.update({ date: oldDate }, { where: { id: old.body.id } });

    const byDefault = await get('/api/orders');
    assert.equal(byDefault.status, 200, JSON.stringify(byDefault.body));
    const ids = byDefault.body.map((o) => o.id);
    assert.ok(ids.includes(recent.body.id));
    assert.ok(!ids.includes(old.body.id), 'el de hace 40 días no entra en los últimos 30');

    const day = dayKey(oldDate);
    const range = await get(`/api/orders?from=${day}&to=${day}`);
    assert.equal(range.status, 200, JSON.stringify(range.body));
    assert.deepEqual(
      range.body.map((o) => o.id),
      [old.body.id],
    );

    const bad = await get('/api/orders?from=2026-13-01');
    assert.equal(bad.status, 400);
    const tooLong = await get('/api/orders?from=2020-01-01&to=2026-01-01');
    assert.equal(tooLong.status, 400);
  });

  it('compras: mismo filtro', async () => {
    const supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Mayorista' });
    const buy = () =>
      api('POST', '/api/purchases', {
        token: A.users.admin.token,
        body: {
          supplierId: supplier.id,
          requestId: newRequestId(),
          items: [{ productId: A.products.yerba.id, quantity: 1, unitCost: 600 }],
        },
      });
    const recent = await buy();
    const old = await buy();
    assert.equal(recent.status, 201, JSON.stringify(recent.body));
    const oldDate = new Date(Date.now() - 40 * DAY_MS);
    await models.Purchase.update({ date: oldDate }, { where: { id: old.body.id } });

    const ids = (await get('/api/purchases')).body.map((p) => p.id);
    assert.ok(ids.includes(recent.body.id));
    assert.ok(!ids.includes(old.body.id));

    const day = dayKey(oldDate);
    const range = await get(`/api/purchases?from=${day}&to=${day}`);
    assert.deepEqual(
      range.body.map((p) => p.id),
      [old.body.id],
    );
  });
});

describe('Reportes', () => {
  // Un día fijo y propio para estos remitos, así no se mezclan con los de otras pruebas
  const day = dayKey(new Date(Date.now() - 3 * DAY_MS));
  const at = (hour) => new Date(`${day}T${hour}:00-03:00`);
  const range = `from=${day}&to=${day}`;

  before(async () => {
    const yerba = await sell(A, [{ productId: A.products.yerba.id, quantity: 2, unitPrice: 1000 }]);
    const queso = await sell(A, [{ productId: A.products.queso.id, quantity: 0.5, unitPrice: 30000 }], {
      discountPercent: 10,
    });
    const cancelled = await sell(A, [{ productId: A.products.yerba.id, quantity: 5, unitPrice: 1000 }]);
    const otherBusiness = await sell(B, [{ productId: B.products.yerba.id, quantity: 7, unitPrice: 1000 }]);
    for (const res of [yerba, queso, cancelled, otherBusiness]) assert.equal(res.status, 201, JSON.stringify(res.body));

    const cancel = await api('POST', `/api/orders/${cancelled.body.id}/cancel`, {
      token: A.users.admin.token,
      body: {},
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

    // 23:30 hora argentina: ya es el día siguiente en UTC, pero tiene que contar en este día
    await models.Order.update({ date: at('10:00') }, { where: { id: yerba.body.id } });
    await models.Order.update({ date: at('23:30') }, { where: { id: queso.body.id } });
    await models.Order.update({ date: at('12:00') }, { where: { id: [cancelled.body.id, otherBusiness.body.id] } });
  });

  it('resumen: totales, descuentos y serie por día (sin anulados ni otro comercio)', async () => {
    const res = await get(`/api/reports/sales-summary?${range}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.totals.orders, 2);
    assert.equal(res.body.totals.gross, 17000);
    assert.equal(res.body.totals.discounts, 1500);
    assert.equal(res.body.totals.total, 15500);
    assert.equal(res.body.totals.avgTicket, 7750);
    assert.deepEqual(res.body.series, [{ period: day, orders: 2, total: 15500 }]);

    const byMonth = await get(`/api/reports/sales-summary?${range}&groupBy=month`);
    assert.deepEqual(byMonth.body.series, [{ period: day.slice(0, 7), orders: 2, total: 15500 }]);
  });

  it('por producto: el descuento del remito se reparte en sus renglones', async () => {
    const res = await get(`/api/reports/sales-by-product?${range}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.products.map((p) => [p.name, p.units, p.amount]),
      [
        ['Queso por kg', 0.5, 13500],
        ['Yerba 1 kg', 2, 2000],
      ],
    );
    assert.deepEqual(res.body.categories, [{ category: 'Sin categoría', units: 2.5, amount: 15500 }]);
  });

  it('por cliente y por forma de pago', async () => {
    const customers = await get(`/api/reports/sales-by-customer?${range}`);
    assert.equal(customers.status, 200, JSON.stringify(customers.body));
    assert.deepEqual(customers.body.customers, [
      {
        customerId: A.customer.id,
        name: 'Cliente Reportes A',
        orders: 2,
        total: 15500,
        lastPurchase: day,
        avgTicket: 7750,
      },
    ]);

    const payments = await get(`/api/reports/sales-by-payment?${range}`);
    assert.equal(payments.status, 200, JSON.stringify(payments.body));
    assert.equal(payments.body.payments.length, 1);
    assert.equal(payments.body.payments[0].name, 'Efectivo');
    assert.equal(payments.body.payments[0].total, 15500);
    assert.equal(payments.body.payments[0].share, 100);
  });

  it('IVA: consumidor final va a "sin discriminar"; la tabla por alícuota cierra', async () => {
    const res = await get(`/api/reports/vat?${range}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.notDiscriminated.orders, 2);
    assert.equal(res.body.notDiscriminated.total, 15500);
    assert.equal(res.body.discriminated.orders, 0);
    assert.deepEqual(res.body.byRate, []);
  });

  it('un día sin ventas devuelve todo en cero', async () => {
    const empty = 'from=2025-01-01&to=2025-01-01';
    const summary = await get(`/api/reports/sales-summary?${empty}`);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.totals.orders, 0);
    assert.equal(summary.body.totals.total, 0);
    for (const path of ['sales-by-product', 'sales-by-customer', 'sales-by-payment', 'vat']) {
      const res = await get(`/api/reports/${path}?${empty}`);
      assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body)}`);
    }
  });

  it('el tablero responde', async () => {
    const res = await get('/api/reports/dashboard');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(typeof res.body.month.total, 'number');
    assert.ok(Array.isArray(res.body.topProducts));
  });
});
