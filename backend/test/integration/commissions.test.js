// Comisiones por venta: % opcional por usuario, foto en cada remito (vendedor, % e importe), en las
// mesas para el mozo que la atendió, y reporte por vendedor
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId, tokenFor } from './helpers.js';

let api;
let models;
let stop;
let A;
let waiter;
let mozo;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Comisiones A');
  await A.business.update({ tablesEnabled: true });
  waiter = await models.User.create({
    businessId: A.business.id,
    name: 'Mozo Pedro',
    email: 'mozo@comisiones-a.test',
    role: 'mozo',
    passwordHash: 'x',
  });
  mozo = tokenFor(waiter);
});

after(async () => {
  await stop?.();
});

const admin = () => A.users.admin.token;
const setRate = (userId, commissionRate, token = admin()) =>
  api('PUT', `/api/users/${userId}`, { token, body: { commissionRate } });
// Yerba a $1.000 la unidad
const sell = (token, quantity, overrides = {}) =>
  api('POST', '/api/orders', {
    token,
    body: {
      customerId: A.customer.id,
      paymentId: A.payment.id,
      requestId: newRequestId(),
      items: [{ productId: A.products.yerba.id, quantity, unitPrice: 1000 }],
      ...overrides,
    },
  });
const report = () => api('GET', '/api/reports/commissions', { token: admin() });

describe('Porcentaje de comisión de cada usuario', () => {
  it('sin ningún usuario con comisión, el reporte viene apagado', async () => {
    const res = await report();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.enabled, false);
  });

  it('lo asigna el administrador; vacío o 0 es sin comisión; fuera de rango se rechaza', async () => {
    const { operador, editor } = A.users;
    assert.equal((await setRate(operador.id, 150)).status, 400);
    assert.equal((await setRate(operador.id, 'mucho')).status, 400);
    assert.equal((await setRate(operador.id, 5, editor.token)).status, 403, 'el editor no gestiona usuarios');

    const ok = await setRate(operador.id, '2,5');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(Number(ok.body.commissionRate), 2.5);
    assert.equal((await setRate(editor.id, 0)).body.commissionRate, null);
    assert.equal((await setRate(waiter.id, 10)).status, 200);

    const log = await models.AuditLog.findOne({ where: { action: 'user.updated', targetId: operador.id } });
    assert.ok(log, 'el cambio de comisión queda en la actividad');
  });
});

describe('Comisión en cada remito', () => {
  it('queda la foto: vendedor, % e importe sobre el total final con descuento', async () => {
    const res = await sell(A.users.operador.token, 10);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.sellerId, A.users.operador.id);
    assert.equal(Number(res.body.commissionRate), 2.5);
    assert.equal(Number(res.body.commissionAmount), 250);

    const discounted = await sell(admin(), 10, { discountPercent: 10 });
    assert.equal(discounted.status, 201);
    assert.equal(discounted.body.sellerId, A.users.admin.id);
    assert.equal(discounted.body.commissionAmount, null, 'el administrador no tiene comisión');
  });

  it('cambiar el % no toca los remitos ya hechos', async () => {
    const before = await sell(A.users.operador.token, 4);
    await setRate(A.users.operador.id, 5);
    const after = await sell(A.users.operador.token, 4);
    assert.equal(Number((await models.Order.findByPk(before.body.id)).commissionAmount), 100);
    assert.equal(Number(after.body.commissionAmount), 200);
  });

  it('en una mesa, la comisión es del mozo que la atendió aunque la cobre otro', async () => {
    const call = (method, path, token, body) => api(method, `/api/tables${path}`, { token, body });
    const dish = await call('POST', '/menu/dishes', admin(), { internalCode: 'MIL', name: 'Milanesa', price: 4000 });
    assert.equal(dish.status, 201, JSON.stringify(dish.body));
    const table = (await call('POST', '/', admin(), { name: '1' })).body;
    const tab = (await call('POST', `/${table.id}/open`, mozo, {})).body;
    const sent = await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: dish.body.id, quantity: 2 }],
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const closed = await call('POST', `/tabs/${tab.id}/close`, A.users.operador.token, {
      requestId: newRequestId(),
      parts: [{ paymentId: A.payment.id, amount: 8000, tip: 500 }],
    });
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    const order = await models.Order.findByPk(closed.body.orderId);
    assert.equal(order.sellerId, waiter.id);
    assert.equal(order.sellerName, 'Mozo Pedro');
    assert.equal(Number(order.commissionAmount), 800, '10 % de 8.000, sin la propina');
  });
});

describe('Reporte de comisiones', () => {
  it('agrupa por vendedor, sin remitos anulados ni los que no tienen comisión', async () => {
    const extra = await sell(A.users.operador.token, 2);
    const cancel = await api('POST', `/api/orders/${extra.body.id}/cancel`, { token: admin(), body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

    const res = await report();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.enabled, true);
    const byName = Object.fromEntries(res.body.sellers.map((s) => [s.name, s]));
    // Operador: 10.000 al 2,5 % + 4.000 al 2,5 % + 4.000 al 5 % (el anulado no cuenta)
    assert.deepEqual(
      [
        byName[A.users.operador.name].count,
        byName[A.users.operador.name].sales,
        byName[A.users.operador.name].commission,
      ],
      [3, 18000, 550],
    );
    assert.equal(byName[A.users.operador.name].currentRate, 5);
    assert.deepEqual([byName['Mozo Pedro'].count, byName['Mozo Pedro'].commission], [1, 800]);
    assert.equal(byName[A.users.admin.name], undefined);
    assert.equal(res.body.totals.commission, 1350);
    assert.equal(res.body.orders.length, 4);
    assert.ok(res.body.orders.find((o) => o.seller === 'Mozo Pedro').table);
  });

  it('solo lo ven administrador y editor', async () => {
    const res = await api('GET', '/api/reports/commissions', { token: A.users.operador.token });
    assert.equal(res.status, 403);
  });
});
