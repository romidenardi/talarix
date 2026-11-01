// Mesas y comandas: menú con adicionales, anulación, cuenta dividida, propinas y rol mozo
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer, createBusiness, newRequestId, stockOf, tokenFor } from './helpers.js';

let api;
let models;
let stop;
let A;
let admin;
let operador;
let mozo;
let card;
let platformToken;
let dishes;
let extras;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Resto A');
  admin = A.users.admin.token;
  operador = A.users.operador.token;
  const waiter = await models.User.create({
    businessId: A.business.id,
    name: 'Mozo Juan',
    email: 'mozo@resto-a.test',
    role: 'mozo',
    passwordHash: 'x',
  });
  mozo = tokenFor(waiter);
  card = await models.Payment.create({ businessId: A.business.id, name: 'Tarjeta' });
  const superadmin = await models.PlatformAdmin.create({
    name: 'Superadmin',
    email: 'super@resto.test',
    passwordHash: 'x',
    active: true,
    totpEnabled: true,
  });
  platformToken = jwt.sign({ adminId: superadmin.id, scope: 'platform' }, process.env.PLATFORM_JWT_SECRET, {
    expiresIn: '1h',
  });
});

after(async () => {
  await stop?.();
});

const call = (method, path, token, body) => api(method, `/api/tables${path}`, { token, body });

describe('Módulo de mesas', () => {
  it('sin el módulo no se pueden usar; lo activa solo el superadmin', async () => {
    assert.equal((await call('GET', '/', admin)).status, 403);
    assert.equal((await call('GET', '/settings', admin)).body.enabled, false);
    // El administrador del comercio ya no lo puede activar
    assert.notEqual((await call('PUT', '/settings', admin, { enabled: true })).status, 200);
    assert.equal((await call('GET', '/settings', admin)).body.enabled, false);

    const modules = (body) =>
      api('PATCH', `/api/platform/businesses/${A.business.id}/modules`, { token: platformToken, body });
    assert.equal((await modules({ tables: 'sí' })).status, 400);
    const res = await modules({ tables: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.tablesEnabled, true);
    assert.equal((await call('GET', '/', admin)).status, 200);

    const logged = await models.AuditLog.findOne({
      where: { action: 'business.modules_changed', businessId: A.business.id },
    });
    assert.ok(logged, 'queda en el registro de actividad');

    const list = await api('GET', '/api/platform/businesses', { token: platformToken });
    assert.equal(list.body.find((b) => b.id === A.business.id).tablesEnabled, true);

    const login = await api('POST', '/api/auth/login', { body: { email: A.users.admin.email, password: A.password } });
    assert.equal(login.body.user.tablesEnabled, true);
  });
});

describe('Menú', () => {
  const menu = (method, path, token, body) => call(method, `/menu${path}`, token, body);

  it('platos y adicionales: los carga administrador o editor; el mozo solo los ve', async () => {
    assert.equal((await menu('POST', '/extras', mozo, { name: 'Salsa rosa', price: 500 })).status, 403);
    const rosa = await menu('POST', '/extras', admin, { name: 'Salsa rosa', price: 500 });
    assert.equal(rosa.status, 201, JSON.stringify(rosa.body));
    assert.equal(rosa.body.internalCode, 'ADI-1', 'el adicional sin código recibe uno');
    assert.equal(rosa.body.trackStock, false);
    const quesos = await menu('POST', '/extras', admin, { name: 'Cuatro quesos', price: 700 });
    const bolo = await menu('POST', '/extras', admin, { name: 'Bolognesa', price: 800 });
    extras = { rosa: rosa.body, quesos: quesos.body, bolo: bolo.body };

    assert.equal((await menu('POST', '/dishes', admin, { name: 'Ravioles', price: 3000 })).status, 400, 'sin código');
    const rav = await menu('POST', '/dishes', admin, {
      internalCode: 'RAV',
      name: 'Ravioles',
      price: 3000,
      promoPrice: 2500,
      extraIds: [rosa.body.id, quesos.body.id],
    });
    assert.equal(rav.status, 201, JSON.stringify(rav.body));
    assert.equal(
      (await menu('POST', '/dishes', admin, { internalCode: 'RAV', name: 'Otro', price: 1 })).status,
      409,
      'el código no se repite',
    );
    const mila = await menu('POST', '/dishes', admin, { internalCode: 'MIL', name: 'Milanesa', price: 4000 });
    dishes = { rav: rav.body, mila: mila.body };

    const list = await menu('GET', '', mozo);
    assert.equal(list.status, 200);
    assert.equal(list.body.extras.length, 3);
    const ravioles = list.body.dishes.find((d) => d.id === rav.body.id);
    assert.deepEqual([...ravioles.extraIds].sort(), [rosa.body.id, quesos.body.id].sort());

    const changed = await menu('PUT', `/dishes/${rav.body.id}`, admin, {
      extraIds: [rosa.body.id, quesos.body.id, bolo.body.id],
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const again = (await menu('GET', '', admin)).body.dishes.find((d) => d.id === rav.body.id);
    assert.equal(again.extraIds.length, 3);
  });

  it('el menú no se mezcla con productos, remitos, compras ni stock', async () => {
    const products = await api('GET', '/api/products', { token: admin });
    assert.ok(!products.body.some((p) => p.id === dishes.rav.id), 'no aparece en Productos');
    const edit = await api('PUT', `/api/products/${dishes.rav.id}`, { token: admin, body: { price: 1 } });
    assert.equal(edit.status, 400);
    assert.match(edit.body.message, /Menú/);

    const order = await api('POST', '/api/orders', {
      token: admin,
      body: {
        requestId: newRequestId(),
        customerId: A.customer.id,
        paymentId: A.payment.id,
        items: [{ productId: dishes.mila.id, quantity: 1, unitPrice: 4000 }],
      },
    });
    assert.equal(order.status, 400);
    assert.match(order.body.message, /Mesas/);

    const movement = await api('POST', '/api/stock-movements', {
      token: admin,
      body: { productId: dishes.mila.id, type: 'in', quantity: 5 },
    });
    assert.equal(movement.status, 400);
  });
});

describe('Mesas', () => {
  let table;
  let tab;

  it('alta de mesas: nombre único; el mozo no puede crear', async () => {
    const res = await call('POST', '/', admin, { name: '1', area: 'Salón' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    table = res.body;
    assert.equal((await call('POST', '/', admin, { name: '1' })).status, 409);
    assert.equal((await call('POST', '/', mozo, { name: '9' })).status, 403);
  });

  it('el mozo abre la mesa y manda una comanda con adicionales', async () => {
    const opened = await call('POST', `/${table.id}/open`, mozo, { guests: 2 });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    tab = opened.body;
    assert.equal(tab.waiterName, 'Mozo Juan');
    assert.equal((await call('POST', `/${table.id}/open`, mozo, {})).status, 409, 'no se abre dos veces');

    const common = await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: A.products.yerba.id, quantity: 1 }],
    });
    assert.equal(common.status, 400, 'en la mesa solo se piden platos del menú');
    const wrongExtra = await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: dishes.mila.id, quantity: 1, extraIds: [extras.rosa.id] }],
    });
    assert.equal(wrongExtra.status, 400, 'el adicional tiene que estar asignado al plato');

    const yerba = await stockOf(models, A.products.yerba);
    const body = {
      requestId: newRequestId(),
      items: [
        { productId: dishes.rav.id, quantity: 2, note: 'sin sal', extraIds: [extras.rosa.id] },
        { productId: dishes.mila.id, quantity: 1 },
      ],
    };
    const sent = await call('POST', `/tabs/${tab.id}/tickets`, mozo, body);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.ticket.items.length, 3, 'el adicional va en su propio renglón');
    assert.equal(await stockOf(models, A.products.yerba), yerba, 'el menú no mueve stock');

    const again = await call('POST', `/tabs/${tab.id}/tickets`, mozo, body);
    assert.equal(again.status, 200, 'el mismo envío dos veces es una sola comanda');
    assert.equal(again.body.ticket.id, sent.body.ticket.id);

    const detail = await call('GET', `/tabs/${tab.id}`, mozo);
    // Precio promo del plato (2500 × 2) + salsa rosa (500 × 2) + milanesa (4000)
    assert.equal(detail.body.total, 10000);
    const ravIndex = detail.body.items.findIndex((i) => i.productId === dishes.rav.id);
    const extra = detail.body.items[ravIndex + 1];
    assert.equal(extra.productId, extras.rosa.id, 'el adicional queda debajo de su plato');
    assert.equal(extra.parentItemId, detail.body.items[ravIndex].id);
    assert.equal(Number(extra.quantity), 2);

    const kitchen = await call('GET', '/kitchen', mozo);
    assert.equal(kitchen.status, 200);
    assert.ok(kitchen.body.some((t) => t.id === sent.body.ticket.id && t.tab.table.name === '1'));
    const ready = await call('POST', `/tickets/${sent.body.ticket.id}/ready`, mozo, {});
    assert.equal(ready.body.status, 'ready');
  });

  it('anular un plato anula sus adicionales; solo administrador o editor', async () => {
    const detail = await call('GET', `/tabs/${tab.id}`, mozo);
    const ravItem = detail.body.items.find((i) => i.productId === dishes.rav.id);

    assert.equal((await call('POST', `/tabs/${tab.id}/items/${ravItem.id}/cancel`, mozo, {})).status, 403);
    const res = await call('POST', `/tabs/${tab.id}/items/${ravItem.id}/cancel`, admin, { reason: 'se equivocó' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.total, 4000);
    const extra = res.body.items.find((i) => i.parentItemId === ravItem.id);
    assert.equal(extra.status, 'cancelled');
  });

  it('pedir la cuenta; si piden algo más, la mesa vuelve a estar abierta', async () => {
    const bill = await call('POST', `/tabs/${tab.id}/bill`, mozo, {});
    assert.equal(bill.body.status, 'billing');
    const more = await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: dishes.rav.id, quantity: 1, extraIds: [extras.quesos.id] }],
    });
    assert.equal(more.status, 201, JSON.stringify(more.body));
    const detail = (await call('GET', `/tabs/${tab.id}`, mozo)).body;
    assert.equal(detail.status, 'open');
    assert.equal(detail.total, 7200);
  });

  it('cobrar en dos partes con propina: un remito con platos y adicionales', async () => {
    assert.equal((await call('POST', `/tabs/${tab.id}/close`, mozo, {})).status, 403, 'el mozo no cobra');

    const wrong = await call('POST', `/tabs/${tab.id}/close`, operador, {
      requestId: newRequestId(),
      parts: [{ paymentId: A.payment.id, amount: 1000 }],
    });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.message, /suman/);

    const res = await call('POST', `/tabs/${tab.id}/close`, operador, {
      requestId: newRequestId(),
      parts: [
        { paymentId: A.payment.id, amount: 3600, tip: 200 },
        { paymentId: card.id, amount: 3600 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = await models.Order.findByPk(res.body.orderId);
    assert.equal(Number(order.total), 7200);
    assert.equal(order.tableTabId, tab.id);
    assert.equal(await models.OrderItem.count({ where: { orderId: order.id } }), 3);
    assert.equal(await models.OrderPayment.count({ where: { orderId: order.id } }), 2);
    assert.equal((await call('GET', `/tabs/${tab.id}`, admin)).body.status, 'closed');
    assert.equal(
      (
        await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
          items: [{ productId: dishes.mila.id, quantity: 1 }],
        })
      ).status,
      409,
    );

    const byPayment = await api('GET', '/api/reports/sales-by-payment', { token: admin });
    const amounts = Object.fromEntries(byPayment.body.payments.map((p) => [p.name, p.total]));
    assert.equal(amounts.Efectivo, 3600);
    assert.equal(amounts.Tarjeta, 3600);

    const tips = await call('GET', '/tips', admin);
    assert.equal(tips.status, 200, JSON.stringify(tips.body));
    assert.deepEqual(tips.body.waiters, [{ waiter: 'Mozo Juan', tables: 1, sales: 7200, tips: 200 }]);
  });

  it('anular una mesa entera; las mesas usadas no se borran', async () => {
    const other = await call('POST', '/', admin, { name: '2' });
    const opened = await call('POST', `/${other.body.id}/open`, mozo, {});
    await call('POST', `/tabs/${opened.body.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: dishes.mila.id, quantity: 3 }],
    });
    const res = await call('POST', `/tabs/${opened.body.id}/cancel`, admin, { reason: 'mesa equivocada' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'cancelled');

    assert.equal((await call('DELETE', `/${other.body.id}`, admin)).status, 409, 'una mesa usada no se borra');
    const unused = await call('POST', '/', admin, { name: '3' });
    assert.equal((await call('DELETE', `/${unused.body.id}`, admin)).status, 204);
  });

  it('un plato pedido no se borra, se desactiva; desactivado no se puede pedir', async () => {
    const menu = (method, path, body) => call(method, `/menu${path}`, admin, body);
    assert.equal((await menu('DELETE', `/dishes/${dishes.mila.id}`)).status, 409);
    assert.equal((await menu('DELETE', `/extras/${extras.bolo.id}`)).status, 204, 'el que no se pidió, sí');
    const ravioles = (await menu('GET', '')).body.dishes.find((d) => d.id === dishes.rav.id);
    assert.ok(!ravioles.extraIds.includes(extras.bolo.id), 'se quita de los platos');

    await menu('PUT', `/dishes/${dishes.mila.id}`, { active: false });
    const table4 = await call('POST', '/', admin, { name: '4' });
    const opened = await call('POST', `/${table4.body.id}/open`, mozo, {});
    const res = await call('POST', `/tabs/${opened.body.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: dishes.mila.id, quantity: 1 }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /no está disponible/);
  });
});

describe('Rol mozo', () => {
  it('solo usa mesas, productos y categorías', async () => {
    assert.equal((await api('GET', '/api/products', { token: mozo })).status, 200);
    assert.equal((await api('GET', '/api/categories', { token: mozo })).status, 200);
    assert.equal((await api('GET', '/api/customers', { token: mozo })).status, 403);
    assert.equal((await api('GET', '/api/orders', { token: mozo })).status, 403);
    assert.equal((await api('POST', '/api/products', { token: mozo, body: {} })).status, 403);
  });

  it('el administrador puede crear un usuario mozo', async () => {
    const res = await api('POST', '/api/users', {
      token: admin,
      body: { name: 'Ana Moza', email: 'ana@resto-a.test', password: 'caballo-verde-42', role: 'mozo' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
});
