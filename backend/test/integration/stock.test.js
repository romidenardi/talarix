// Remitos: numeración de remitos, quién hizo cada cosa, IVA guardado, redondeo y ventas simultáneas
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId, stockOf } from './helpers.js';

let api;
let models;
let stop;
let A;
let B;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Stock A');
  B = await createBusiness(models, 'Stock B');
});

after(async () => {
  await stop?.();
});

const orderFor = (biz, items, extra = {}) => ({
  customerId: biz.customer.id,
  paymentId: biz.payment.id,
  requestId: newRequestId(),
  items,
  ...extra,
});
const sell = (biz, items, extra, token = biz.users.admin.token) =>
  api('POST', '/api/orders', { token, body: orderFor(biz, items, extra) });

describe('Número de remito', () => {
  it('es correlativo por comercio y cada comercio arranca en 1', async () => {
    const line = [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }];
    const first = await sell(A, line);
    const second = await sell(A, line);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.body.number, first.body.number + 1);

    const other = await sell(B, [{ productId: B.products.yerba.id, quantity: 1, unitPrice: 1000 }]);
    assert.equal(other.status, 201, JSON.stringify(other.body));
    assert.equal(other.body.number, 1);
  });

  it('un remito anulado conserva su número y el siguiente no lo repite', async () => {
    const line = [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }];
    const created = await sell(A, line);
    await api('POST', `/api/orders/${created.body.id}/cancel`, { token: A.users.admin.token, body: {} });
    const next = await sell(A, line);
    assert.equal(next.body.number, created.body.number + 1);
  });
});

describe('Ventas simultáneas', () => {
  it('muchos remitos a la vez con los mismos productos en distinto orden: todos salen, sin deadlock', async () => {
    const x = await models.Product.create({
      businessId: A.business.id,
      internalCode: 'X',
      name: 'X',
      price: 100,
      cost: 50,
      stock: 100,
    });
    const y = await models.Product.create({
      businessId: A.business.id,
      internalCode: 'Y',
      name: 'Y',
      price: 100,
      cost: 50,
      stock: 100,
    });
    const lineXY = [
      { productId: x.id, quantity: 1, unitPrice: 100 },
      { productId: y.id, quantity: 1, unitPrice: 100 },
    ];
    const lineYX = [...lineXY].reverse();

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => sell(A, i % 2 ? lineXY : lineYX)));
    for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));

    assert.equal(await stockOf(models, x), 90);
    assert.equal(await stockOf(models, y), 90);
    const numbers = results.map((r) => r.body.number).sort((a, b) => a - b);
    assert.equal(new Set(numbers).size, 10, `números repetidos: ${numbers}`);
    assert.equal(numbers[9] - numbers[0], 9, `números salteados: ${numbers}`);
  });
});

describe('Quién hizo cada cosa', () => {
  it('el remito y su movimiento de stock guardan el usuario', async () => {
    const res = await sell(
      A,
      [{ productId: A.products.queso.id, quantity: 0.1, unitPrice: 30000 }],
      {},
      A.users.editor.token,
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.createdByName, A.users.editor.name);
    assert.equal(res.body.createdById, A.users.editor.id);

    const movements = await api('GET', `/api/stock-movements/product/${A.products.queso.id}`, {
      token: A.users.admin.token,
    });
    assert.equal(movements.body[0].createdByName, A.users.editor.name);
    assert.match(movements.body[0].reason, /remito \d{8}/);
  });

  it('las compras y los ajustes manuales también', async () => {
    const supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Proveedor' });
    const purchase = await api('POST', '/api/purchases', {
      token: A.users.operador.token,
      body: {
        supplierId: supplier.id,
        invoiceNumber: 'A-1',
        requestId: newRequestId(),
        items: [{ productId: A.products.yerba.id, quantity: 5, unitCost: 600 }],
      },
    });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
    assert.equal(purchase.body.createdByName, A.users.operador.name);

    const adjustment = await api('POST', '/api/stock-movements', {
      token: A.users.admin.token,
      body: { productId: A.products.yerba.id, type: 'in', quantity: 1, reason: 'Encontrado en depósito' },
    });
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.body));
    assert.equal(adjustment.body.movement.createdByName, A.users.admin.name);
  });

  it('un egreso manual mayor al stock se rechaza', async () => {
    const before = await stockOf(models, A.products.queso);
    const res = await api('POST', '/api/stock-movements', {
      token: A.users.admin.token,
      body: { productId: A.products.queso.id, type: 'out', quantity: before + 1 },
    });
    assert.equal(res.status, 400);
    assert.equal(await stockOf(models, A.products.queso), before);
  });

  it('no se puede cargar una compra de un combo', async () => {
    const combo = await models.Product.create({
      businessId: A.business.id,
      internalCode: 'CMB',
      name: 'Combo',
      price: 10,
      cost: 5,
      isCombo: true,
    });
    const supplier = await models.Supplier.findOne({ where: { businessId: A.business.id } });
    const res = await api('POST', '/api/purchases', {
      token: A.users.admin.token,
      body: {
        supplierId: supplier.id,
        requestId: newRequestId(),
        items: [{ productId: combo.id, quantity: 1, unitCost: 5 }],
      },
    });
    assert.equal(res.status, 400);
  });
});

describe('Importes e IVA', () => {
  it('10,333 × 3: se guarda 10,33 y el total es 30,99, igual que el renglón impreso', async () => {
    const res = await sell(A, [{ productId: A.products.yerba.id, quantity: 3, unitPrice: 10.333 }]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.items[0].unitPrice), 10.33);
    assert.equal(Number(res.body.total), 30.99);
  });

  it('cada renglón guarda el IVA del momento, y el reporte usa ese aunque después cambie el producto', async () => {
    const ri = await models.Customer.create({
      businessId: A.business.id,
      businessName: 'Empresa RI',
      fiscalCondition: 'Responsable Inscripto',
    });
    const product = await models.Product.create({
      businessId: A.business.id,
      internalCode: 'IVA',
      name: 'Con IVA',
      price: 1210,
      cost: 500,
      vatRate: 21,
      stock: 10,
    });
    const res = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: {
        customerId: ri.id,
        paymentId: A.payment.id,
        requestId: newRequestId(),
        items: [{ productId: product.id, quantity: 1, unitPrice: 1210 }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.items[0].vatRate, 21);

    const change = await api('PUT', `/api/products/${product.id}`, {
      token: A.users.admin.token,
      body: { vatRate: 10.5 },
    });
    assert.equal(change.status, 200, JSON.stringify(change.body));

    const report = await api('GET', '/api/reports/vat', { token: A.users.admin.token });
    assert.equal(report.status, 200, JSON.stringify(report.body));
    const rates = report.body.byRate.map((r) => r.rate);
    assert.ok(rates.includes(21), `alícuotas del reporte: ${rates}`);
    assert.ok(!rates.includes(10.5), 'el cambio posterior del producto no tiene que mover la venta a 10,5%');
    const sum = report.body.byRate.reduce((s, r) => s + r.vat, 0);
    assert.ok(Math.abs(sum - report.body.discriminated.vat) < 0.05, 'la tabla por alícuota cierra con el total de IVA');
  });
});
