// Compras: anulación, factura repetida, costo promedio, costo 0 y fechas
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId, stockOf } from './helpers.js';

let api;
let models;
let stop;
let A;
let supplier;

const DAY_MS = 24 * 60 * 60 * 1000;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Compras A');
  supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Mayorista' });
});

after(async () => {
  await stop?.();
});

const buy = (items, extra = {}, token = A.users.admin.token) =>
  api('POST', '/api/purchases', {
    token,
    body: { supplierId: supplier.id, requestId: newRequestId(), items, ...extra },
  });
const costOf = async (product) => Number((await models.Product.findByPk(product.id)).cost);

describe('Factura repetida', () => {
  it('la misma factura del mismo proveedor pide confirmación, aunque esté escrita distinto', async () => {
    const line = [{ productId: A.products.yerba.id, quantity: 2, unitCost: 600 }];
    const first = await buy(line, { invoiceNumber: 'A 0001-00001234' });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const before = await stockOf(models, A.products.yerba);
    const again = await buy(line, { invoiceNumber: 'a0001-00001234' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'DUPLICATE_INVOICE');
    assert.equal(await stockOf(models, A.products.yerba), before, 'no tiene que sumar stock sin confirmar');

    const confirmed = await buy(line, { invoiceNumber: 'a0001-00001234', confirmDuplicateInvoice: true });
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
    assert.equal(await stockOf(models, A.products.yerba), before + 2);
  });

  it('otro proveedor con el mismo número no es repetida', async () => {
    const other = await models.Supplier.create({ businessId: A.business.id, name: 'Otro' });
    const res = await api('POST', '/api/purchases', {
      token: A.users.admin.token,
      body: {
        supplierId: other.id,
        requestId: newRequestId(),
        invoiceNumber: 'A 0001-00001234',
        items: [{ productId: A.products.yerba.id, quantity: 1, unitCost: 600 }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
});

describe('Costo del producto', () => {
  it('dos renglones del mismo producto: queda el costo promedio ponderado', async () => {
    const res = await buy([
      { productId: A.products.queso.id, quantity: 1, unitCost: 10000 },
      { productId: A.products.queso.id, quantity: 3, unitCost: 20000 },
    ]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await costOf(A.products.queso), 17500);
  });

  it('una compra bonificada (costo 0) no pisa el costo que tenía', async () => {
    const before = await costOf(A.products.queso);
    const res = await buy([{ productId: A.products.queso.id, quantity: 1, unitCost: 0 }]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await costOf(A.products.queso), before);
  });
});

describe('Fechas', () => {
  it('rechaza fechas futuras y de hace más de un año', async () => {
    const line = [{ productId: A.products.yerba.id, quantity: 1, unitCost: 600 }];
    const future = await buy(line, { date: new Date(Date.now() + 5 * DAY_MS).toISOString() });
    assert.equal(future.status, 400);
    assert.match(future.body.message, /futura/);

    const old = await buy(line, { date: new Date(Date.now() - 10 * 365 * DAY_MS).toISOString() });
    assert.equal(old.status, 400);
    assert.match(old.body.message, /más de un año/);

    const lastWeek = await buy(line, { date: new Date(Date.now() - 7 * DAY_MS).toISOString() });
    assert.equal(lastWeek.status, 201, JSON.stringify(lastWeek.body));
  });
});

describe('Anular una compra', () => {
  it('resta del stock lo que había sumado, queda marcada y no se puede anular dos veces', async () => {
    const before = await stockOf(models, A.products.yerba);
    const purchase = await buy([{ productId: A.products.yerba.id, quantity: 7, unitCost: 600 }], {
      invoiceNumber: 'B-77',
    });
    assert.equal(await stockOf(models, A.products.yerba), before + 7);

    const cancelled = await api('POST', `/api/purchases/${purchase.body.id}/cancel`, {
      token: A.users.editor.token,
      body: { reason: 'Cargada dos veces' },
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(cancelled.body.cancelledByName, A.users.editor.name);
    assert.equal(await stockOf(models, A.products.yerba), before);

    const again = await api('POST', `/api/purchases/${purchase.body.id}/cancel`, {
      token: A.users.admin.token,
      body: {},
    });
    assert.equal(again.status, 409);

    const log = await models.AuditLog.findOne({ where: { action: 'purchase.cancelled', targetId: purchase.body.id } });
    assert.ok(log);
  });

  it('una factura anulada se puede volver a cargar sin aviso de repetida', async () => {
    const res = await buy([{ productId: A.products.yerba.id, quantity: 7, unitCost: 600 }], { invoiceNumber: 'B-77' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it('si ya se vendió lo comprado, no se puede anular', async () => {
    const product = await models.Product.create({
      businessId: A.business.id,
      internalCode: 'VEN',
      name: 'Vendido',
      price: 100,
      cost: 50,
      stock: 0,
    });
    const purchase = await buy([{ productId: product.id, quantity: 5, unitCost: 50 }]);
    const sale = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: {
        customerId: A.customer.id,
        paymentId: A.payment.id,
        requestId: newRequestId(),
        items: [{ productId: product.id, quantity: 3, unitPrice: 100 }],
      },
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));

    const res = await api('POST', `/api/purchases/${purchase.body.id}/cancel`, {
      token: A.users.admin.token,
      body: {},
    });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /ajuste/);
    assert.equal(await stockOf(models, product), 2);
  });

  it('el operador no puede anular compras', async () => {
    const purchase = await buy([{ productId: A.products.yerba.id, quantity: 1, unitCost: 600 }]);
    const res = await api('POST', `/api/purchases/${purchase.body.id}/cancel`, {
      token: A.users.operador.token,
      body: {},
    });
    assert.equal(res.status, 403);
  });
});
