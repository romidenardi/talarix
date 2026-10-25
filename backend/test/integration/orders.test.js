// Pruebas de integración: la API de verdad, contra una base MySQL de pruebas.
// Correr con: npm run test:integration (ver README → Tests)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId, stockOf } from './helpers.js';

let api;
let models;
let stop;
let A; // comercio principal
let B; // otro comercio, para probar el aislamiento

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Almacen A');
  B = await createBusiness(models, 'Almacen B');
});

after(async () => {
  await stop?.();
});

// Remito básico del comercio A
const orderBody = (overrides = {}) => ({
  customerId: A.customer.id,
  paymentId: A.payment.id,
  requestId: newRequestId(),
  items: [{ productId: A.products.yerba.id, quantity: 2, unitPrice: 1000 }],
  ...overrides,
});

describe('Servidor', () => {
  it('/health responde ok', async () => {
    const res = await api('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('sin token no deja entrar', async () => {
    const res = await api('GET', '/api/orders');
    assert.equal(res.status, 401);
  });
});

describe('Remitos', () => {
  it('crear un remito descuenta el stock y calcula el total', async () => {
    const before = await stockOf(models, A.products.yerba);
    const res = await api('POST', '/api/orders', { token: A.users.admin.token, body: orderBody() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.total), 2000);
    assert.equal(await stockOf(models, A.products.yerba), before - 2);
  });

  it('producto por peso: 0,250 kg descuenta 0,250 del stock', async () => {
    const before = await stockOf(models, A.products.queso);
    const res = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: orderBody({ items: [{ productId: A.products.queso.id, quantity: 0.25, unitPrice: 30000 }] }),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.total), 7500);
    assert.equal(await stockOf(models, A.products.queso), before - 0.25);
  });

  it('el mismo envío dos veces (doble clic) crea un solo remito', async () => {
    const body = orderBody();
    const before = await stockOf(models, A.products.yerba);
    const first = await api('POST', '/api/orders', { token: A.users.admin.token, body });
    const second = await api('POST', '/api/orders', { token: A.users.admin.token, body });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    assert.equal(await stockOf(models, A.products.yerba), before - 2);
  });

  it('sin stock suficiente no crea nada', async () => {
    const before = await stockOf(models, A.products.yerba);
    const count = await models.Order.count();
    const res = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: orderBody({ items: [{ productId: A.products.yerba.id, quantity: 50000, unitPrice: 1000 }] }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Stock insuficiente/);
    assert.equal(await stockOf(models, A.products.yerba), before);
    assert.equal(await models.Order.count(), count);
  });

  it('un producto por unidad no acepta cantidades con decimales', async () => {
    const res = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: orderBody({ items: [{ productId: A.products.yerba.id, quantity: 1.5, unitPrice: 1000 }] }),
    });
    assert.equal(res.status, 400);
  });

  it('anular un remito devuelve el stock, y no se puede anular dos veces', async () => {
    const before = await stockOf(models, A.products.yerba);
    const created = await api('POST', '/api/orders', { token: A.users.admin.token, body: orderBody() });
    assert.equal(created.status, 201);
    assert.equal(await stockOf(models, A.products.yerba), before - 2);

    const cancelled = await api('POST', `/api/orders/${created.body.id}/cancel`, {
      token: A.users.admin.token, body: { reason: 'Prueba' },
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(await stockOf(models, A.products.yerba), before);

    const again = await api('POST', `/api/orders/${created.body.id}/cancel`, { token: A.users.admin.token, body: {} });
    assert.equal(again.status, 409);
  });

  it('el operador no puede anular remitos', async () => {
    const created = await api('POST', '/api/orders', { token: A.users.admin.token, body: orderBody() });
    const res = await api('POST', `/api/orders/${created.body.id}/cancel`, { token: A.users.operador.token, body: {} });
    assert.equal(res.status, 403);
  });

  it('no vende productos ni formas de pago inactivos', async () => {
    const inactive = await models.Product.create({
      businessId: A.business.id, internalCode: 'INA', name: 'Inactivo', price: 100, cost: 50, stock: 10, active: false,
    });
    const res = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: orderBody({ items: [{ productId: inactive.id, quantity: 1, unitPrice: 100 }] }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /inactivo/);

    const oldPayment = await models.Payment.create({ businessId: A.business.id, name: 'Cheque', active: false });
    const res2 = await api('POST', '/api/orders', { token: A.users.admin.token, body: orderBody({ paymentId: oldPayment.id }) });
    assert.equal(res2.status, 400);
    assert.match(res2.body.message, /inactiva/);
  });

  it('datos mal formados en los renglones no dan error 500', async () => {
    for (const productId of [{ id: 1 }, [A.products.yerba.id], 123]) {
      const res = await api('POST', '/api/orders', {
        token: A.users.admin.token,
        body: orderBody({ items: [{ productId, quantity: 1, unitPrice: 1000 }] }),
      });
      assert.ok(res.status < 500, `productId ${JSON.stringify(productId)} → ${res.status}`);
    }
  });
});

describe('Operador: descuentos y precios con autorización', () => {
  it('a precio de lista o promocional no necesita autorización', async () => {
    const list = await api('POST', '/api/orders', { token: A.users.operador.token, body: orderBody() });
    assert.equal(list.status, 201, JSON.stringify(list.body));
    const promo = await api('POST', '/api/orders', {
      token: A.users.operador.token,
      body: orderBody({ items: [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 900 }] }),
    });
    assert.equal(promo.status, 201, JSON.stringify(promo.body));
  });

  it('con descuento y sin autorización responde APPROVAL_REQUIRED y no toca el stock', async () => {
    const before = await stockOf(models, A.products.yerba);
    const res = await api('POST', '/api/orders', {
      token: A.users.operador.token, body: orderBody({ discountPercent: 10 }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'APPROVAL_REQUIRED');
    assert.equal(await stockOf(models, A.products.yerba), before);
  });

  it('con precio cambiado y sin autorización también la pide', async () => {
    const res = await api('POST', '/api/orders', {
      token: A.users.operador.token,
      body: orderBody({ items: [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1 }] }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'APPROVAL_REQUIRED');
  });

  it('la autorización de un admin vale para ese remito, y queda en la actividad', async () => {
    const body = orderBody({ discountPercent: 10 });
    const wrong = await api('POST', '/api/orders/approval', {
      token: A.users.operador.token,
      body: { email: A.users.admin.email, password: 'incorrecta', requestId: body.requestId, discountPercent: 10, items: [] },
    });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.approvalToken, undefined);

    const byOperator = await api('POST', '/api/orders/approval', {
      token: A.users.operador.token,
      body: { email: A.users.operador.email, password: A.password, requestId: body.requestId, discountPercent: 10, items: [] },
    });
    assert.equal(byOperator.status, 403, 'un operador no puede autorizar');

    const approval = await api('POST', '/api/orders/approval', {
      token: A.users.operador.token,
      body: { email: A.users.admin.email, password: A.password, requestId: body.requestId, discountPercent: 10, items: [] },
    });
    assert.equal(approval.status, 200, JSON.stringify(approval.body));
    assert.ok(approval.body.approvalToken);

    const created = await api('POST', '/api/orders', {
      token: A.users.operador.token, body: { ...body, approvalToken: approval.body.approvalToken },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(Number(created.body.total), 1800);

    const log = await models.AuditLog.findOne({ where: { action: 'order.approved', targetId: created.body.id } });
    assert.ok(log, 'falta el registro order.approved');
    assert.equal(log.detail.approver, A.users.admin.email);

    // La misma autorización no sirve para otro remito ni para otro descuento
    const reuse = await api('POST', '/api/orders', {
      token: A.users.operador.token,
      body: { ...orderBody({ discountPercent: 10 }), approvalToken: approval.body.approvalToken },
    });
    assert.equal(reuse.status, 403);
    assert.equal(reuse.body.code, 'APPROVAL_REQUIRED');
  });

  it('un admin de otro comercio no puede autorizar', async () => {
    const body = orderBody({ discountPercent: 5 });
    const res = await api('POST', '/api/orders/approval', {
      token: A.users.operador.token,
      body: { email: B.users.admin.email, password: B.password, requestId: body.requestId, discountPercent: 5, items: [] },
    });
    assert.equal(res.status, 403);
  });

  it('admin y editor aplican descuentos sin autorización', async () => {
    for (const role of ['admin', 'editor']) {
      const res = await api('POST', '/api/orders', { token: A.users[role].token, body: orderBody({ discountPercent: 50 }) });
      assert.equal(res.status, 201, `${role}: ${JSON.stringify(res.body)}`);
      assert.equal(Number(res.body.total), 1000);
    }
  });
});

describe('Aislamiento entre comercios', () => {
  it('un comercio no ve los clientes de otro', async () => {
    const res = await api('GET', '/api/customers', { token: B.users.admin.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.every((c) => c.id !== A.customer.id));
  });

  it('no puede editar ni borrar datos de otro comercio', async () => {
    const edit = await api('PUT', `/api/customers/${A.customer.id}`, { token: B.users.admin.token, body: { city: 'Otra' } });
    assert.equal(edit.status, 404);
    const del = await api('DELETE', `/api/products/${A.products.yerba.id}`, { token: B.users.admin.token });
    assert.equal(del.status, 404);
  });

  it('no puede mover un cliente a otro comercio cambiando businessId', async () => {
    const res = await api('PUT', `/api/customers/${A.customer.id}`, {
      token: A.users.admin.token, body: { city: 'Rafaela', businessId: B.business.id },
    });
    assert.equal(res.status, 200);
    const customer = await models.Customer.findByPk(A.customer.id);
    assert.equal(customer.businessId, A.business.id);
  });

  it('no puede vender productos de otro comercio', async () => {
    const res = await api('POST', '/api/orders', {
      token: B.users.admin.token,
      body: {
        customerId: B.customer.id,
        paymentId: B.payment.id,
        requestId: newRequestId(),
        items: [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }],
      },
    });
    assert.equal(res.status, 404);
  });
});

describe('Productos', () => {
  it('no se puede pisar el stock ni poner precios negativos al editar', async () => {
    const before = await stockOf(models, A.products.queso);
    const stock = await api('PUT', `/api/products/${A.products.queso.id}`, { token: A.users.admin.token, body: { stock: 9999 } });
    assert.ok(stock.status < 300);
    assert.equal(await stockOf(models, A.products.queso), before);

    const negative = await api('PUT', `/api/products/${A.products.queso.id}`, { token: A.users.admin.token, body: { price: -5 } });
    assert.equal(negative.status, 400);
  });

  it('un producto con ventas no se borra; uno sin movimientos sí', async () => {
    const sold = await api('DELETE', `/api/products/${A.products.yerba.id}`, { token: A.users.admin.token });
    assert.equal(sold.status, 409);

    const fresh = await models.Product.create({
      businessId: A.business.id, internalCode: 'NUE', name: 'Nuevo', price: 10, cost: 5,
    });
    const del = await api('DELETE', `/api/products/${fresh.id}`, { token: A.users.admin.token });
    assert.equal(del.status, 204);
  });
});
