// IVA: compras con IVA por renglón, reportes de IVA compras y posición de IVA, desglose por
// alícuota del remito impreso y categorías que se pueden elegir en un producto
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';
import { dayKey } from '../../src/utils/dates.js';

let api;
let models;
let stop;
let A;
let supplier;
let harina;
let ri;

const today = () => dayKey(new Date());

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'IVA A');
  supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Molino' });
  harina = await models.Product.create({
    businessId: A.business.id,
    internalCode: 'HAR',
    name: 'Harina 1 kg',
    unitType: 'unit',
    price: 1105,
    cost: 500,
    vatRate: 10.5,
    stock: 100,
  });
  ri = await models.Customer.create({
    businessId: A.business.id,
    businessName: 'Almacén Inscripto SRL',
    fiscalCondition: 'Responsable Inscripto',
    cuit: '30-71234567-9',
  });
});

after(async () => {
  await stop?.();
});

const admin = () => A.users.admin.token;
const buy = (items, extra = {}) =>
  api('POST', '/api/purchases', {
    token: admin(),
    body: { supplierId: supplier.id, requestId: newRequestId(), items, ...extra },
  });
const sell = (customer, items) =>
  api('POST', '/api/orders', {
    token: admin(),
    body: { customerId: customer.id, paymentId: A.payment.id, requestId: newRequestId(), items },
  });
const get = (path) => api('GET', path, { token: admin() });

describe('Compras con IVA', () => {
  it('guarda neto, IVA por alícuota y total = neto + IVA; el costo del producto queda sin IVA', async () => {
    const res = await buy([
      { productId: A.products.yerba.id, quantity: 2, unitCost: 500, vatRate: 21 },
      { productId: harina.id, quantity: 10, unitCost: 100 },
    ]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.subtotal), 2000);
    assert.equal(Number(res.body.vatAmount), 315); // 1000 × 21% + 1000 × 10,5%
    assert.equal(Number(res.body.total), 2315);

    const rates = res.body.items.map((i) => i.vatRate).sort();
    assert.deepEqual(rates, [10.5, 21], 'sin alícuota, toma la del producto');
    assert.equal(Number((await models.Product.findByPk(harina.id)).cost), 100);
  });

  it('rechaza una alícuota que no corresponde', async () => {
    const res = await buy([{ productId: A.products.yerba.id, quantity: 1, unitCost: 100, vatRate: 7 }]);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Artículo 1: el IVA/);
  });
});

describe('Reportes de IVA compras y posición de IVA', () => {
  let report;

  before(async () => {
    // Una compra vieja, sin IVA cargado, y una anulada: ninguna suma crédito fiscal
    const old = await buy([{ productId: A.products.yerba.id, quantity: 1, unitCost: 999 }]);
    // Como quedaban antes: el total era la suma de los costos, sin IVA
    await models.Purchase.update({ subtotal: null, vatAmount: null, total: 999 }, { where: { id: old.body.id } });
    await models.PurchaseItem.update({ vatRate: null }, { where: { purchaseId: old.body.id } });
    const cancelled = await buy([{ productId: harina.id, quantity: 1, unitCost: 1000 }]);
    const cancel = await api('POST', `/api/purchases/${cancelled.body.id}/cancel`, {
      token: admin(),
      body: { reason: 'prueba' },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

    report = await get(`/api/reports/purchase-vat?from=${today()}&to=${today()}`);
    assert.equal(report.status, 200, JSON.stringify(report.body));
  });

  it('IVA compras: suma por alícuota y deja aparte las compras sin IVA cargado', () => {
    assert.equal(report.body.totals.purchases, 1);
    assert.equal(report.body.totals.vat, 315);
    assert.deepEqual(
      report.body.byRate.map((r) => [r.rate, r.net, r.vat]),
      [
        [21, 1000, 210],
        [10.5, 1000, 105],
      ],
    );
    assert.deepEqual(report.body.withoutVat, { purchases: 1, total: 999 });
  });

  it('posición de IVA: débito de todas las ventas menos el crédito de las compras', async () => {
    // Consumidor final (IVA incluido, sin discriminar) y Responsable Inscripto: los dos son débito
    assert.equal(
      (await sell(A.customer, [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1210 }])).status,
      201,
    );
    assert.equal((await sell(ri, [{ productId: harina.id, quantity: 2, unitPrice: 1105 }])).status, 201);

    const res = await get(`/api/reports/vat-position?from=${today()}&to=${today()}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.debit, 420); // 1210 → 210 de IVA; 2210 → 210 de IVA
    assert.equal(res.body.credit, 315);
    assert.equal(res.body.balance, 105);
    const row21 = res.body.byRate.find((r) => r.rate === 21);
    assert.deepEqual([row21.debit, row21.credit, row21.balance], [210, 210, 0]);
    assert.equal(res.body.purchasesWithoutVat.purchases, 1);
  });
});

describe('Remito impreso', () => {
  it('con IVA discriminado trae el IVA abierto por alícuota', async () => {
    const sale = await sell(ri, [
      { productId: A.products.yerba.id, quantity: 1, unitPrice: 1210 },
      { productId: harina.id, quantity: 1, unitPrice: 1105 },
    ]);
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const res = await get(`/api/orders/${sale.body.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.vatBreakdown, [
      { rate: 21, net: 1000, vat: 210 },
      { rate: 10.5, net: 1000, vat: 105 },
    ]);
  });

  it('a consumidor final no trae desglose', async () => {
    const sale = await sell(A.customer, [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1210 }]);
    const res = await get(`/api/orders/${sale.body.id}`);
    assert.equal(res.body.vatBreakdown, null);
  });
});

describe('Categoría de un producto', () => {
  let rubro;
  let sub;
  let suelta;

  before(async () => {
    rubro = await models.Category.create({ businessId: A.business.id, name: 'Almacén' });
    sub = await models.Category.create({ businessId: A.business.id, name: 'Infusiones', parentId: rubro.id });
    suelta = await models.Category.create({ businessId: A.business.id, name: 'Varios' });
  });

  const newProduct = (code, categoryId) =>
    api('POST', '/api/products', {
      token: admin(),
      body: {
        internalCode: code,
        name: `Producto ${code}`,
        price: 100,
        cost: 50,
        vatRate: 21,
        unitType: 'unit',
        categoryId,
      },
    });

  it('un rubro con subcategorías no se puede elegir', async () => {
    const res = await newProduct('CAT1', rubro.id);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Almacén tiene subcategorías/);
  });

  it('una subcategoría o una categoría sin subcategorías, sí', async () => {
    assert.equal((await newProduct('CAT2', sub.id)).status, 201);
    assert.equal((await newProduct('CAT3', suelta.id)).status, 201);
  });

  it('un producto que ya estaba en el rubro se puede editar sin cambiarle la categoría', async () => {
    await A.products.yerba.update({ categoryId: rubro.id });
    const res = await api('PUT', `/api/products/${A.products.yerba.id}`, {
      token: admin(),
      body: { name: 'Yerba 1 kg suave', categoryId: rubro.id },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});
