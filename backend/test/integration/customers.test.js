// Bloque 5: condición fiscal, CUIT, anonimización completa y contraseñas
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';

let api;
let models;
let stop;
let A;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Clientes A');
});

after(async () => {
  await stop?.();
});

const createCustomer = (body) => api('POST', '/api/customers', { token: A.users.admin.token, body });

describe('Condición fiscal y CUIT', () => {
  it('normaliza la condición fiscal y el formato del CUIT', async () => {
    const res = await createCustomer({
      businessName: 'Empresa',
      fiscalCondition: 'responsable inscripto',
      cuit: '20123456786',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.fiscalCondition, 'Responsable Inscripto');
    assert.equal(res.body.cuit, '20-12345678-6');

    const ri = await createCustomer({ businessName: 'Otra', fiscalCondition: 'RI' });
    assert.equal(ri.body.fiscalCondition, 'Responsable Inscripto');
  });

  it('rechaza condiciones fiscales inventadas y CUIT mal escritos', async () => {
    const fiscal = await createCustomer({ firstName: 'Juan', fiscalCondition: 'Inventada' });
    assert.equal(fiscal.status, 400);
    assert.match(fiscal.body.message, /condición fiscal/);

    const cuit = await createCustomer({
      firstName: 'Juan',
      fiscalCondition: 'Consumidor Final',
      cuit: '20-12345678-9',
    });
    assert.equal(cuit.status, 400);
    assert.match(cuit.body.message, /CUIT/);
  });

  it('acepta DNI para un consumidor final', async () => {
    const res = await createCustomer({ firstName: 'Ana', fiscalCondition: 'CF', cuit: '12.345.678' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.cuit, '12345678');
  });

  it('un cliente viejo con CUIT inválido se puede seguir editando si no se toca el CUIT', async () => {
    const legacy = await models.Customer.create({
      businessId: A.business.id,
      firstName: 'Viejo',
      fiscalCondition: 'Consumidor Final',
      cuit: '123',
    });
    const res = await api('PUT', `/api/customers/${legacy.id}`, {
      token: A.users.admin.token,
      body: { cuit: '123', city: 'Rafaela' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.city, 'Rafaela');
  });

  it('proveedores: también valida el CUIT', async () => {
    const bad = await api('POST', '/api/suppliers', {
      token: A.users.admin.token,
      body: { name: 'Prov', cuit: '30-71234567-9' },
    });
    assert.equal(bad.status, 400);
    const good = await api('POST', '/api/suppliers', {
      token: A.users.admin.token,
      body: { name: 'Prov', cuit: '30712345671' },
    });
    assert.equal(good.status, 201, JSON.stringify(good.body));
    assert.equal(good.body.cuit, '30-71234567-1');
  });
});

describe('Anonimización completa', () => {
  it('borra los datos y las notas de sus remitos, lo marca, y no se le puede vender ni editar', async () => {
    const customer = await models.Customer.create({
      businessId: A.business.id,
      firstName: 'Lucía',
      lastName: 'Gómez',
      fiscalCondition: 'Consumidor Final',
      phone: '3492 111111',
      email: 'lucia@mail.com',
    });
    const order = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: {
        customerId: customer.id,
        paymentId: A.payment.id,
        requestId: newRequestId(),
        notes: 'Llamar a Lucía al 3492 111111',
        items: [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }],
      },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));

    const anon = await api('POST', `/api/data-rights/customers/${customer.id}/anonymize`, {
      token: A.users.admin.token,
    });
    assert.equal(anon.status, 200, JSON.stringify(anon.body));

    const after = await models.Customer.findByPk(customer.id);
    assert.ok(after.anonymizedAt);
    assert.equal(after.firstName, null);
    assert.equal(after.phone, null);
    const savedOrder = await models.Order.findByPk(order.body.id);
    assert.equal(savedOrder.notes, null, 'la nota del remito tenía datos personales');
    assert.equal(Number(savedOrder.total), 1000, 'los importes se conservan');

    const sell = await api('POST', '/api/orders', {
      token: A.users.admin.token,
      body: {
        customerId: customer.id,
        paymentId: A.payment.id,
        requestId: newRequestId(),
        items: [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }],
      },
    });
    assert.equal(sell.status, 400);
    assert.match(sell.body.message, /anonimizado/);

    const edit = await api('PUT', `/api/customers/${customer.id}`, {
      token: A.users.admin.token,
      body: { firstName: 'Lucía' },
    });
    assert.equal(edit.status, 409);

    const again = await api('POST', `/api/data-rights/customers/${customer.id}/anonymize`, {
      token: A.users.admin.token,
    });
    assert.equal(again.status, 409);
  });
});

describe('Contraseñas y emails', () => {
  it('rechaza contraseñas comunes o con el nombre de la persona', async () => {
    const common = await api('POST', '/api/users', {
      token: A.users.admin.token,
      body: { name: 'Pedro Ramírez', email: 'pedro@clientes-a.test', password: '12345678', role: 'operador' },
    });
    assert.equal(common.status, 400);
    assert.match(common.body.message, /más usadas/);

    const ownName = await api('POST', '/api/users', {
      token: A.users.admin.token,
      body: { name: 'Pedro Ramírez', email: 'pedro@clientes-a.test', password: 'ramirez2026', role: 'operador' },
    });
    assert.equal(ownName.status, 400);

    const good = await api('POST', '/api/users', {
      token: A.users.admin.token,
      body: { name: 'Pedro Ramírez', email: 'pedro@clientes-a.test', password: 'caballo-verde-42', role: 'operador' },
    });
    assert.equal(good.status, 201, JSON.stringify(good.body));
  });

  it('un email de otro comercio no revela de quién es', async () => {
    const other = await createBusiness(models, 'Clientes B');
    const res = await api('POST', '/api/users', {
      token: A.users.admin.token,
      body: { name: 'Alguien', email: other.users.admin.email, password: 'caballo-verde-42', role: 'operador' },
    });
    assert.equal(res.status, 400);
    assert.doesNotMatch(res.body.message, /Clientes B/);
  });

  it('ingreso con un email que no existe: mismo mensaje que con contraseña incorrecta', async () => {
    const unknown = await api('POST', '/api/auth/login', {
      body: { email: 'nadie@nada.test', password: 'lo-que-sea-123' },
    });
    const wrong = await api('POST', '/api/auth/login', {
      body: { email: A.users.admin.email, password: 'incorrecta-123' },
    });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.message, wrong.body.message);
  });
});
