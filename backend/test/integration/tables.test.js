// Mesas y comandas: stock al mandar la comanda, anulación, cuenta dividida, propinas y rol mozo
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId, stockOf, tokenFor } from './helpers.js';

let api;
let models;
let stop;
let A;
let admin;
let operador;
let mozo;
let card;

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
});

after(async () => {
  await stop?.();
});

const call = (method, path, token, body) => api(method, `/api/tables${path}`, { token, body });

describe('Activar las mesas', () => {
  it('desactivadas no se pueden usar; solo el administrador las activa', async () => {
    assert.equal((await call('GET', '/', admin)).status, 403);
    assert.equal((await call('PUT', '/settings', A.users.editor.token, { enabled: true })).status, 403);
    const res = await call('PUT', '/settings', admin, { enabled: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.enabled, true);
    assert.equal((await call('GET', '/', admin)).status, 200);

    const login = await api('POST', '/api/auth/login', { body: { email: A.users.admin.email, password: A.password } });
    assert.equal(login.body.user.tablesEnabled, true);
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

  it('el mozo abre la mesa y manda una comanda: el stock baja al mandarla', async () => {
    const opened = await call('POST', `/${table.id}/open`, mozo, { guests: 2 });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    tab = opened.body;
    assert.equal(tab.waiterName, 'Mozo Juan');
    assert.equal((await call('POST', `/${table.id}/open`, mozo, {})).status, 409, 'no se abre dos veces');

    const yerba = await stockOf(models, A.products.yerba);
    const queso = await stockOf(models, A.products.queso);
    const body = {
      requestId: newRequestId(),
      items: [
        { productId: A.products.yerba.id, quantity: 2, note: 'sin hielo' },
        { productId: A.products.queso.id, quantity: 0.5 },
      ],
    };
    const sent = await call('POST', `/tabs/${tab.id}/tickets`, mozo, body);
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.ticket.items.length, 2);
    assert.equal(await stockOf(models, A.products.yerba), yerba - 2);
    assert.equal(await stockOf(models, A.products.queso), queso - 0.5);

    const again = await call('POST', `/tabs/${tab.id}/tickets`, mozo, body);
    assert.equal(again.status, 200, 'el mismo envío dos veces es una sola comanda');
    assert.equal(again.body.ticket.id, sent.body.ticket.id);
    assert.equal(await stockOf(models, A.products.yerba), yerba - 2);

    const kitchen = await call('GET', '/kitchen', mozo);
    assert.equal(kitchen.status, 200);
    assert.ok(kitchen.body.some((t) => t.id === sent.body.ticket.id && t.tab.table.name === '1'));
    const ready = await call('POST', `/tickets/${sent.body.ticket.id}/ready`, mozo, {});
    assert.equal(ready.body.status, 'ready');
  });

  it('anular un plato: solo administrador o editor, y el stock vuelve', async () => {
    const detail = await call('GET', `/tabs/${tab.id}`, mozo);
    const quesoItem = detail.body.items.find((i) => i.productId === A.products.queso.id);
    const before = await stockOf(models, A.products.queso);

    assert.equal((await call('POST', `/tabs/${tab.id}/items/${quesoItem.id}/cancel`, mozo, {})).status, 403);
    const res = await call('POST', `/tabs/${tab.id}/items/${quesoItem.id}/cancel`, admin, { reason: 'se equivocó' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await stockOf(models, A.products.queso), before + 0.5);
    assert.equal(res.body.total, 2000);
  });

  it('pedir la cuenta; si piden algo más, la mesa vuelve a estar abierta', async () => {
    const bill = await call('POST', `/tabs/${tab.id}/bill`, mozo, {});
    assert.equal(bill.body.status, 'billing');
    const more = await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: A.products.yerba.id, quantity: 1 }],
    });
    assert.equal(more.status, 201, JSON.stringify(more.body));
    assert.equal((await call('GET', `/tabs/${tab.id}`, mozo)).body.status, 'open');
  });

  it('cobrar en dos partes con propina: un remito, sin volver a mover el stock', async () => {
    const yerba = await stockOf(models, A.products.yerba);
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
        { paymentId: A.payment.id, amount: 1500, tip: 200 },
        { paymentId: card.id, amount: 1500 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = await models.Order.findByPk(res.body.orderId);
    assert.equal(Number(order.total), 3000);
    assert.equal(order.tableTabId, tab.id);
    assert.equal(await stockOf(models, A.products.yerba), yerba, 'el stock ya se había descontado con las comandas');
    assert.equal(await models.OrderPayment.count({ where: { orderId: order.id } }), 2);
    assert.equal((await call('GET', `/tabs/${tab.id}`, admin)).body.status, 'closed');
    assert.equal(
      (
        await call('POST', `/tabs/${tab.id}/tickets`, mozo, {
          items: [{ productId: A.products.yerba.id, quantity: 1 }],
        })
      ).status,
      409,
    );

    const byPayment = await api('GET', '/api/reports/sales-by-payment', { token: admin });
    const amounts = Object.fromEntries(byPayment.body.payments.map((p) => [p.name, p.total]));
    assert.equal(amounts.Efectivo, 1500);
    assert.equal(amounts.Tarjeta, 1500);

    const tips = await call('GET', '/tips', admin);
    assert.equal(tips.status, 200, JSON.stringify(tips.body));
    assert.deepEqual(tips.body.waiters, [{ waiter: 'Mozo Juan', tables: 1, sales: 3000, tips: 200 }]);
  });

  it('anular una mesa entera devuelve el stock de lo pedido', async () => {
    const other = await call('POST', '/', admin, { name: '2' });
    const opened = await call('POST', `/${other.body.id}/open`, mozo, {});
    const before = await stockOf(models, A.products.yerba);
    await call('POST', `/tabs/${opened.body.id}/tickets`, mozo, {
      requestId: newRequestId(),
      items: [{ productId: A.products.yerba.id, quantity: 3 }],
    });
    assert.equal(await stockOf(models, A.products.yerba), before - 3);
    const res = await call('POST', `/tabs/${opened.body.id}/cancel`, admin, { reason: 'mesa equivocada' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'cancelled');
    assert.equal(await stockOf(models, A.products.yerba), before);

    assert.equal((await call('DELETE', `/${other.body.id}`, admin)).status, 409, 'una mesa usada no se borra');
    const unused = await call('POST', '/', admin, { name: '3' });
    assert.equal((await call('DELETE', `/${unused.body.id}`, admin)).status, 204);
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
