// Insumos (productos que se compran pero no se venden) y servicios o gastos en las compras
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';
import { dayKey } from '../../src/utils/dates.js';

let api;
let models;
let stop;
let A;
let supplier;
let bolsas;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Insumos A');
  supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Papelera' });
});

after(async () => {
  await stop?.();
});

const admin = () => A.users.admin.token;
const get = (path) => api('GET', path, { token: admin() });
const buy = (body) =>
  api('POST', '/api/purchases', {
    token: admin(),
    body: { supplierId: supplier.id, requestId: newRequestId(), ...body },
  });

describe('Insumos', () => {
  it('se crean como producto marcado, sin precio de venta', async () => {
    const res = await api('POST', '/api/products', {
      token: admin(),
      body: {
        internalCode: 'INS-1',
        name: 'Bolsas camiseta',
        unitType: 'unit',
        price: 999,
        cost: 10,
        vatRate: 21,
        isSupply: true,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.isSupply, true);
    assert.equal(Number(res.body.price), 0);
    bolsas = res.body;
  });

  it('no aparecen en Productos; sí en Insumos y en el listado para compras', async () => {
    const ids = (res) => res.body.map((p) => p.id);
    assert.ok(!ids(await get('/api/products')).includes(bolsas.id));
    assert.deepEqual(ids(await get('/api/products?kind=supply')), [bolsas.id]);
    const all = ids(await get('/api/products?kind=all'));
    assert.ok(all.includes(bolsas.id) && all.includes(A.products.yerba.id));
  });

  it('no se venden ni van en combos', async () => {
    const sale = await api('POST', '/api/orders', {
      token: admin(),
      body: {
        customerId: A.customer.id,
        paymentId: A.payment.id,
        requestId: newRequestId(),
        items: [{ productId: bolsas.id, quantity: 1, unitPrice: 0 }],
      },
    });
    assert.equal(sale.status, 400);
    assert.match(sale.body.message, /es un insumo/);

    const combo = await api('POST', '/api/combos', {
      token: admin(),
      body: { internalCode: 'CMB-INS', name: 'Combo', components: [{ productId: bolsas.id, quantity: 1 }] },
    });
    assert.equal(combo.status, 400);
    assert.match(combo.body.message, /es un insumo/);
  });

  it('editar un insumo no le pone precio', async () => {
    const res = await api('PUT', `/api/products/${bolsas.id}`, {
      token: admin(),
      body: { name: 'Bolsas camiseta 40x50', price: 500 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(res.body.price), 0);
  });
});

describe('Servicios y gastos en las compras', () => {
  it('una compra con insumo y servicio: el insumo suma stock, el servicio no; IVA del 27 %', async () => {
    const res = await buy({
      items: [{ productId: bolsas.id, quantity: 100, unitCost: 10 }],
      expenses: [{ description: 'Flete', quantity: 1, unitCost: 1000, vatRate: 27 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.subtotal), 2000);
    assert.equal(Number(res.body.vatAmount), 480); // 1000 × 21 % + 1000 × 27 %
    assert.equal(Number(res.body.total), 2480);
    assert.equal(res.body.expenses.length, 1);
    assert.equal(res.body.expenses[0].description, 'Flete');

    const product = await models.Product.findByPk(bolsas.id);
    assert.equal(Number(product.stock), 100);
  });

  it('una compra solo de servicios no necesita productos ni toca el stock, y se puede anular', async () => {
    const movementsBefore = await models.StockMovement.count();
    const res = await buy({
      invoiceNumber: 'B 0001-00000077',
      items: [],
      expenses: [{ description: 'Luz de octubre', quantity: 1, unitCost: 50000, vatRate: 27 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.total), 63500);
    assert.equal(await models.StockMovement.count(), movementsBefore);

    const cancel = await api('POST', `/api/purchases/${res.body.id}/cancel`, {
      token: admin(),
      body: { reason: 'prueba' },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  });

  it('valida el concepto, el IVA y que haya al menos un renglón', async () => {
    const noRows = await buy({ items: [], expenses: [] });
    assert.equal(noRows.status, 400);
    assert.match(noRows.body.message, /al menos un artículo o un servicio/);

    const noDescription = await buy({ expenses: [{ description: '  ', quantity: 1, unitCost: 10, vatRate: 21 }] });
    assert.equal(noDescription.status, 400);
    assert.match(noDescription.body.message, /Servicio 1: falta el concepto/);

    const badVat = await buy({ expenses: [{ description: 'Alquiler', quantity: 1, unitCost: 10, vatRate: 7 }] });
    assert.equal(badVat.status, 400);
    assert.match(badVat.body.message, /Servicio 1: el IVA/);
  });

  it('el reporte de IVA compras incluye los servicios', async () => {
    const today = dayKey(new Date());
    const res = await get(`/api/reports/purchase-vat?from=${today}&to=${today}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.byRate.map((r) => [r.rate, r.net, r.vat]),
      [
        [27, 1000, 270],
        [21, 1000, 210],
      ],
    );
  });
});

describe('Categorías de gasto', () => {
  it('cada servicio guarda su categoría; sin categoría va a «Otros»; una inventada se rechaza', async () => {
    const res = await buy({
      expenses: [
        { description: 'Alquiler de noviembre', quantity: 1, unitCost: 100000, vatRate: 21, category: 'rent' },
        { description: 'Gastos varios', quantity: 1, unitCost: 500, vatRate: 0 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const categories = res.body.expenses.map((e) => e.category).sort();
    assert.deepEqual(categories, ['other', 'rent']);

    const bad = await buy({
      expenses: [{ description: 'X', quantity: 1, unitCost: 10, vatRate: 21, category: 'viajes-a-europa' }],
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /Servicio 1: la categoría de gasto/);
  });

  it('el reporte de gastos agrupa por categoría, sin contar compras anuladas ni productos', async () => {
    const today = dayKey(new Date());
    const res = await get(`/api/reports/expenses?from=${today}&to=${today}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const byCategory = Object.fromEntries(res.body.categories.map((c) => [c.category, c]));
    assert.equal(byCategory.rent.total, 121000);
    assert.equal(byCategory.rent.label, 'Alquiler');
    // Flete (1.000 + 27 %) y gastos varios (500): los dos en «Otros». La luz de la compra anulada no.
    assert.equal(byCategory.other.count, 2);
    assert.equal(byCategory.other.total, 1770);
    assert.ok(res.body.expenses.every((e) => e.description !== 'Luz de octubre'));
    assert.equal(res.body.totals.total, 122770);
  });
});
