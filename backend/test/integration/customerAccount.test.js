// Cuenta corriente de clientes: remitos a cuenta corriente, saldo inicial, cobranzas, resumen y
// aviso antes de anonimizar a un cliente con deuda
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';
import { dayKey } from '../../src/utils/dates.js';

let api;
let models;
let stop;
let A;
let B;
let customer;
let transferencia;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Cta cte clientes A');
  B = await createBusiness(models, 'Cta cte clientes B');
  customer = A.customer;
  transferencia = await models.Payment.create({ businessId: A.business.id, name: 'Transferencia' });
});

after(async () => {
  await stop?.();
});

const admin = () => A.users.admin.token;
const get = (path, token = admin()) => api('GET', path, { token });
const today = () => dayKey(new Date());
const balanceOf = async () => {
  const res = await get('/api/customers/balances');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.find((row) => row.customerId === customer.id).balance;
};
// Yerba a $1.000 la unidad
const sell = (paymentCondition, quantity, overrides = {}, token = admin()) =>
  api('POST', '/api/orders', {
    token,
    body: {
      customerId: customer.id,
      requestId: newRequestId(),
      ...(paymentCondition === 'account' ? {} : { paymentId: A.payment.id }),
      paymentCondition,
      items: [{ productId: A.products.yerba.id, quantity, unitPrice: 1000 }],
      ...overrides,
    },
  });
const collect = (body, token = admin()) =>
  api('POST', '/api/customer-payments', {
    token,
    body: { customerId: customer.id, paymentId: transferencia.id, requestId: newRequestId(), ...body },
  });

describe('Remitos a cuenta corriente', () => {
  it('suman al saldo del cliente, sin forma de pago; los de contado no', async () => {
    assert.equal((await sell('cash', 1)).status, 201);
    const account = await sell('account', 10);
    assert.equal(account.status, 201, JSON.stringify(account.body));
    assert.equal(account.body.paymentCondition, 'account');
    assert.equal(account.body.paymentId, null);
    assert.equal(await balanceOf(), 10000);
  });

  it('a cuenta corriente se ignoran la forma de pago y las cuotas que vengan', async () => {
    const res = await sell('account', 1, { paymentId: A.payment.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.paymentId, null);
    assert.equal(await balanceOf(), 11000);
    const cancel = await api('POST', `/api/orders/${res.body.id}/cancel`, { token: admin(), body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(await balanceOf(), 10000, 'un remito anulado deja de sumar');
  });

  it('al contado la forma de pago sigue siendo obligatoria; una condición inventada se rechaza', async () => {
    const noPayment = await api('POST', '/api/orders', {
      token: admin(),
      body: {
        customerId: customer.id,
        requestId: newRequestId(),
        items: [{ productId: A.products.yerba.id, quantity: 1, unitPrice: 1000 }],
      },
    });
    assert.equal(noPayment.status, 400);
    assert.equal((await sell('fiado', 1)).status, 400);
  });

  it('no se vende a cuenta corriente a Consumidor Final', async () => {
    const generic = await models.Customer.create({
      businessId: A.business.id,
      firstName: 'Consumidor',
      lastName: 'Final',
      fiscalCondition: 'Consumidor Final',
    });
    const res = await sell('account', 1, { customerId: generic.id });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Consumidor Final/);
  });

  it('el operador también vende a cuenta corriente', async () => {
    const res = await sell('account', 1, {}, A.users.operador.token);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await balanceOf(), 11000);
  });

  it('el reporte por forma de pago muestra las ventas a cuenta corriente aparte', async () => {
    const res = await get('/api/reports/sales-by-payment');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const account = res.body.payments.find((p) => p.name === 'Cuenta corriente');
    assert.equal(account.total, 11000);
  });

  it('el saldo inicial se suma y el cambio queda en la actividad', async () => {
    const res = await api('PUT', `/api/customers/${customer.id}`, { token: admin(), body: { openingBalance: 2500 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await balanceOf(), 13500);
    const log = await models.AuditLog.findOne({
      where: { action: 'customer.opening_balance_changed', targetId: customer.id },
    });
    assert.ok(log);
  });
});

describe('Cobranzas', () => {
  let paymentId;

  it('una cobranza descuenta de la deuda total; el mismo envío dos veces registra una sola', async () => {
    const requestId = newRequestId();
    const first = await collect({ amount: 4000, reference: 'TRF 99', requestId });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    paymentId = first.body.id;
    const again = await collect({ amount: 4000, reference: 'TRF 99', requestId });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, paymentId);
    assert.equal(await balanceOf(), 9500);
  });

  it('valida importe, forma de pago, fecha y que el cliente sea del comercio', async () => {
    assert.equal((await collect({ amount: 0 })).status, 400);
    assert.equal((await collect({ amount: 100, paymentId: B.payment.id })).status, 400);
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal((await collect({ amount: 100, date: future })).status, 400);
    assert.equal((await collect({ amount: 100, customerId: B.customer.id })).status, 404);
  });

  it('el resumen muestra saldo anterior, remitos y cobranzas con saldo acumulado y saldo final', async () => {
    const res = await get(`/api/customers/${customer.id}/account?from=${today()}&to=${today()}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.previousBalance, 2500);
    // Remitos de 10.000 y 1.000 (el anulado y el de contado no aparecen) y cobranza de 4.000
    assert.deepEqual(
      res.body.movements.map((m) => [m.type, m.debit, m.credit, m.balance]),
      [
        ['order', 10000, 0, 12500],
        ['order', 1000, 0, 13500],
        ['payment', 0, 4000, 9500],
      ],
    );
    assert.match(res.body.movements[0].description, /^Remito \d{8}$/);
    assert.equal(res.body.balance, 9500);
  });

  it('anular una cobranza la vuelve a sumar a la deuda; no se anula dos veces', async () => {
    const cancel = await api('POST', `/api/customer-payments/${paymentId}/cancel`, {
      token: admin(),
      body: { reason: 'cargada dos veces' },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.status, 'cancelled');
    assert.equal(await balanceOf(), 13500);
    const again = await api('POST', `/api/customer-payments/${paymentId}/cancel`, { token: admin(), body: {} });
    assert.equal(again.status, 409);
  });

  it('solo administrador y editor ven saldos y registran cobranzas', async () => {
    const operador = A.users.operador.token;
    assert.equal((await get('/api/customers/balances', operador)).status, 403);
    assert.equal((await collect({ amount: 10 }, operador)).status, 403);
    const byEditor = await collect({ amount: 3500 }, A.users.editor.token);
    assert.equal(byEditor.status, 201, JSON.stringify(byEditor.body));
    assert.equal(await balanceOf(), 10000);
  });

  it('una forma de pago usada en una cobranza no se borra', async () => {
    const res = await api('DELETE', `/api/payments/${transferencia.id}`, { token: admin() });
    assert.equal(res.status, 409);
  });

  it('un cliente con cobranzas no se borra', async () => {
    const res = await api('DELETE', `/api/customers/${customer.id}`, { token: admin() });
    assert.equal(res.status, 409);
  });
});

describe('Anonimizar un cliente con deuda', () => {
  it('primero avisa la deuda; con la confirmación, anonimiza y la deuda se conserva', async () => {
    const path = `/api/data-rights/customers/${customer.id}/anonymize`;
    const warned = await api('POST', path, { token: admin(), body: {} });
    assert.equal(warned.status, 409);
    assert.equal(warned.body.code, 'CUSTOMER_HAS_DEBT');
    assert.match(warned.body.message, /10000\.00/);
    assert.equal((await models.Customer.findByPk(customer.id)).anonymizedAt, null);

    const done = await api('POST', path, { token: admin(), body: { confirmDebt: true } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await balanceOf(), 10000);
    const payments = await models.CustomerPayment.findAll({ where: { customerId: customer.id } });
    assert.ok(payments.length >= 2);
    assert.ok(
      payments.every((p) => p.reference === null && p.cancelReason === null),
      'se borran los textos libres de sus cobranzas',
    );
  });

  it('sin deuda anonimiza directo', async () => {
    const other = await models.Customer.create({
      businessId: A.business.id,
      firstName: 'Sin',
      lastName: 'Deuda',
      fiscalCondition: 'Consumidor Final',
    });
    const res = await api('POST', `/api/data-rights/customers/${other.id}/anonymize`, { token: admin(), body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});
