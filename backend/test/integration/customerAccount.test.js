// Cuenta corriente de clientes: remitos a cuenta corriente, saldo inicial, cobranzas, resumen y
// aviso antes de anonimizar a un cliente con deuda
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';
import { dayKey } from '../../src/utils/dates.js';
import { dueDates } from '../../src/utils/accountInstallments.js';

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

describe('Cobranzas por cuota', () => {
  let paymentId;
  let unpaid;
  // Las cuotas por lo que son: el saldo inicial y los remitos de 10.000 y de 1.000
  const opening = () => unpaid.find((i) => i.description === 'Saldo inicial');
  const big = () => unpaid.find((i) => i.amount === 10000);
  const small = () => unpaid.find((i) => i.amount === 1000);
  const installments = async () => {
    const res = await get(`/api/customers/${customer.id}/installments`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };

  it('cada remito y el saldo inicial son cuotas; el remito anulado no aparece', async () => {
    unpaid = (await installments()).filter((i) => !i.paid);
    // Saldo inicial 2.500 (vence hoy) y los remitos de 10.000 y 1.000 (1 cuota cada uno)
    assert.equal(unpaid.length, 3);
    assert.equal(unpaid[0].description, 'Saldo inicial', 'vence hoy: es la primera');
    assert.equal(opening().amount, 2500);
    assert.match(big().description, /^Remito \d{8}$/);
    assert.ok(small());
  });

  it('la cobranza paga cuotas completas; el mismo envío dos veces registra una sola', async () => {
    const requestId = newRequestId();
    const first = await collect({ installmentIds: [opening().id], reference: 'TRF 99', requestId });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(Number(first.body.amount), 2500);
    paymentId = first.body.id;
    const again = await collect({ installmentIds: [opening().id], reference: 'TRF 99', requestId });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, paymentId);
    assert.equal(await balanceOf(), 11000);
    assert.equal((await installments()).find((i) => i.id === opening().id).status, 'paid');
  });

  it('valida cuotas, importe, forma de pago, fecha y que el cliente sea del comercio', async () => {
    const order = big();
    assert.equal((await collect({})).status, 400, 'sin cuotas');
    const partial = await collect({ installmentIds: [order.id], amount: 5000 });
    assert.equal(partial.status, 400, 'no se cobra una parte de la cuota');
    assert.match(partial.body.message, /completas/);
    assert.equal((await collect({ installmentIds: [opening().id] })).status, 409, 'ya cobrada');
    assert.equal((await collect({ installmentIds: [order.id], paymentId: B.payment.id })).status, 400);
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal((await collect({ installmentIds: [order.id], date: future })).status, 400);
    assert.equal((await collect({ installmentIds: [order.id], customerId: B.customer.id })).status, 404);
    assert.equal(await balanceOf(), 11000, 'nada de eso cobró');
  });

  it('el resumen muestra saldo anterior, remitos y cobranzas con saldo acumulado y saldo final', async () => {
    const res = await get(`/api/customers/${customer.id}/account?from=${today()}&to=${today()}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.previousBalance, 2500);
    // Remitos de 10.000 y 1.000 (el anulado y el de contado no aparecen) y la cobranza de 2.500
    assert.deepEqual(
      res.body.movements.map((m) => [m.type, m.debit, m.credit, m.balance]),
      [
        ['order', 10000, 0, 12500],
        ['order', 1000, 0, 13500],
        ['payment', 0, 2500, 11000],
      ],
    );
    assert.match(res.body.movements[0].description, /^Remito \d{8}$/);
    assert.equal(res.body.balance, 11000);
  });

  it('anular una cobranza deja sus cuotas impagas otra vez; no se anula dos veces', async () => {
    const cancel = await api('POST', `/api/customer-payments/${paymentId}/cancel`, {
      token: admin(),
      body: { reason: 'cargada dos veces' },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.status, 'cancelled');
    assert.equal(await balanceOf(), 13500);
    assert.equal((await installments()).find((i) => i.id === opening().id).paid, false);
    const again = await api('POST', `/api/customer-payments/${paymentId}/cancel`, { token: admin(), body: {} });
    assert.equal(again.status, 409);
  });

  it('solo administrador y editor ven saldos, cuotas y mora, y registran cobranzas', async () => {
    const operador = A.users.operador.token;
    assert.equal((await get('/api/customers/balances', operador)).status, 403);
    assert.equal((await get(`/api/customers/${customer.id}/installments`, operador)).status, 403);
    assert.equal((await get('/api/customers/overdue', operador)).status, 403);
    assert.equal((await collect({ installmentIds: [opening().id] }, operador)).status, 403);
    // El editor cobra el saldo inicial y el remito de 1.000 juntos: 3.500
    const byEditor = await collect({ installmentIds: [opening().id, small().id], amount: 3500 }, A.users.editor.token);
    assert.equal(byEditor.status, 201, JSON.stringify(byEditor.body));
    assert.equal(await balanceOf(), 10000);
  });

  it('con el saldo inicial cobrado, no se puede cambiar', async () => {
    const res = await api('PUT', `/api/customers/${customer.id}`, { token: admin(), body: { openingBalance: 3000 } });
    assert.equal(res.status, 409);
    assert.equal(Number((await models.Customer.findByPk(customer.id)).openingBalance), 2500, 'no cambió');
  });

  it('un remito con cuotas cobradas no se anula', async () => {
    const res = await api('POST', `/api/orders/${small().orderId}/cancel`, { token: admin(), body: {} });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /cuotas cobradas/);
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

describe('Cuotas, interés y vencimientos', () => {
  let other;
  let order;

  before(async () => {
    other = await models.Customer.create({
      businessId: A.business.id,
      businessName: 'Almacén Las Cuotas',
      fiscalCondition: 'Responsable Inscripto',
    });
  });

  it('3 cuotas con 15 % de interés que vencen los 20: total con interés, cuotas iguales y fechas', async () => {
    const res = await sell('account', 30, {
      customerId: other.id,
      accountInstallments: 3,
      accountInterestRate: 15,
      accountDueDay: 20,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    order = res.body;
    assert.equal(Number(order.total), 30000, 'la venta no incluye el interés');
    assert.equal(Number(order.totalFinanced), 34500);
    assert.equal(Number(order.installmentAmount), 11500);
    assert.equal(order.installmentsCount, 3);
    assert.equal(order.accountDueDay, 20);

    const list = (await get(`/api/customers/${other.id}/installments`)).body;
    assert.deepEqual(
      list.map((i) => [i.number, i.amount, i.dueDate]),
      dueDates(today(), 20, 3).map((date, i) => [i + 1, 11500, date]),
    );
    const balance = (await get('/api/customers/balances')).body.find((b) => b.customerId === other.id);
    assert.equal(balance.balance, 34500, 'el saldo incluye el interés');
  });

  it('valida cuotas, interés y día de vencimiento', async () => {
    const bad = (terms) => sell('account', 1, { customerId: other.id, ...terms });
    assert.equal((await bad({ accountInstallments: 0 })).status, 400);
    assert.equal((await bad({ accountInstallments: 1.5 })).status, 400);
    assert.equal((await bad({ accountInterestRate: -5 })).status, 400);
    assert.equal((await bad({ accountDueDay: 32 })).status, 400);
  });

  it('reporte de mora: lo vencido por tramo de atraso y lo por vencer', async () => {
    const list = (await get(`/api/customers/${other.id}/installments`)).body;
    const ago = (days) => dayKey(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    // Se corren los vencimientos al pasado: 1ª hace 10 días, 2ª hace 45, 3ª hace 100
    await models.CustomerInstallment.update({ dueDate: ago(10) }, { where: { id: list[0].id } });
    await models.CustomerInstallment.update({ dueDate: ago(45) }, { where: { id: list[1].id } });
    await models.CustomerInstallment.update({ dueDate: ago(100) }, { where: { id: list[2].id } });

    const res = await get('/api/customers/overdue');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = res.body.customers.find((c) => c.customerId === other.id);
    assert.deepEqual(
      [row.d1_30, row.d31_60, row.d61_90, row.d90, row.overdue, row.notDue, row.maxDaysLate],
      [11500, 11500, 0, 11500, 34500, 0, 100],
    );
    assert.equal(res.body.customers[0].customerId, other.id, 'primero el que más atraso tiene');
    assert.equal(res.body.buckets.length, 4);

    // Cobrar la cuota más vencida la saca de la mora
    const paid = await collect({ customerId: other.id, installmentIds: [list[2].id] });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    const after = (await get('/api/customers/overdue')).body.customers.find((c) => c.customerId === other.id);
    assert.deepEqual([after.d90, after.overdue, after.maxDaysLate], [0, 23000, 45]);
  });

  it('anular un remito sin cuotas cobradas anula sus cuotas', async () => {
    const res = await sell('account', 2, { customerId: other.id, accountInstallments: 2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const cancel = await api('POST', `/api/orders/${res.body.id}/cancel`, { token: admin(), body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    const statuses = await models.CustomerInstallment.findAll({ where: { orderId: res.body.id } });
    assert.deepEqual(
      statuses.map((i) => i.status),
      ['cancelled', 'cancelled'],
    );
  });
});

describe('Recargo por mora', () => {
  const bAdmin = () => B.users.admin.token;
  const ago = (days) => dayKey(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const put = (body, token = bAdmin()) => api('PUT', '/api/customer-payments/late-fee', { token, body });
  let late;
  let withoutRate; // remito de $100.000 en 1 cuota, hecho sin tasa
  let withRate; // remito de $100.000 en 2 cuotas de $50.000, hecho con 3 % y 5 días de gracia
  // Cuotas de un remito, por número (1ª, 2ª…)
  const installmentsOf = async (orderId) =>
    (await get(`/api/customers/${late.id}/installments`, bAdmin())).body
      .filter((i) => i.orderId === orderId)
      .sort((a, b) => a.number - b.number);

  before(async () => {
    late = await models.Customer.create({
      businessId: B.business.id,
      businessName: 'Kiosco Atrasado',
      fiscalCondition: 'Responsable Inscripto',
    });
  });

  const sellB = (overrides = {}) =>
    api('POST', '/api/orders', {
      token: bAdmin(),
      body: {
        customerId: late.id,
        requestId: newRequestId(),
        paymentCondition: 'account',
        items: [{ productId: B.products.yerba.id, quantity: 100, unitPrice: 1000 }],
        ...overrides,
      },
    });
  const collectB = (body) =>
    api('POST', '/api/customer-payments', {
      token: bAdmin(),
      body: { customerId: late.id, paymentId: B.payment.id, requestId: newRequestId(), ...body },
    });

  it('sin configurar no hay recargo, y el remito no lleva tasa', async () => {
    const config = await api('GET', '/api/customer-payments/late-fee', { token: bAdmin() });
    assert.equal(config.status, 200, JSON.stringify(config.body));
    assert.deepEqual(config.body, { rate: null, graceDays: 0 });
    const res = await sellB();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.lateFeeRate, null);
    withoutRate = res.body.id;
  });

  it('se configura un % mensual y días de gracia; se valida; el operador no puede', async () => {
    assert.equal((await put({ rate: 150 })).status, 400);
    assert.equal((await put({ rate: 3, graceDays: 1.5 })).status, 400);
    assert.equal((await put({ rate: 3, graceDays: 5 }, B.users.operador.token)).status, 403);
    const res = await put({ rate: 3, graceDays: 5 }, B.users.editor.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { rate: 3, graceDays: 5 });
  });

  it('el remito a cuenta corriente guarda la tasa vigente', async () => {
    const res = await sellB({ accountInstallments: 2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.lateFeeRate), 3);
    assert.equal(res.body.lateFeeGraceDays, 5);
    withRate = res.body.id;
    const order = await api('GET', `/api/orders/${withRate}`, { token: B.users.operador.token });
    assert.equal(Number(order.body.lateFeeRate), 3, 'el operador la ve para imprimir');
  });

  it('cada cuota cobra con la tasa de su remito: sin tasa no hay recargo; cambiar la tasa no la toca', async () => {
    const [old] = await installmentsOf(withoutRate);
    const [first, second] = await installmentsOf(withRate);
    // Vencidas hace 20 días, salvo la 2ª del remito con tasa: hace 4 (dentro de la gracia)
    await models.CustomerInstallment.update({ dueDate: ago(20) }, { where: { id: [old.id, first.id] } });
    await models.CustomerInstallment.update({ dueDate: ago(4) }, { where: { id: second.id } });

    // La tasa del comercio cambia después: no afecta a los remitos ya hechos
    assert.equal((await put({ rate: 6, graceDays: 0 })).status, 200);

    const [oldNow] = await installmentsOf(withoutRate);
    const [firstNow, secondNow] = await installmentsOf(withRate);
    assert.equal(oldNow.lateFee, 0, 'el remito hecho sin tasa no cobra recargo');
    assert.equal(firstNow.lateFee, 1000, '$50.000 × 3 % ÷ 30 × 20 días, con la tasa del remito');
    assert.equal(firstNow.lateFeeRate, 3);
    assert.equal(secondNow.lateFee, 0, 'dentro de los 5 días de gracia del remito');

    const overdue = (await get('/api/customers/overdue', bAdmin())).body;
    const row = overdue.customers.find((c) => c.customerId === late.id);
    assert.equal(row.lateFee, 1000);
    assert.equal(overdue.totals.lateFee, 1000);
  });

  it('no se cobra más recargo del calculado', async () => {
    const [first] = await installmentsOf(withRate);
    const res = await collectB({ installmentIds: [first.id], lateFee: 1500 });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  it('la cobranza suma el recargo aparte: el saldo baja solo por la cuota', async () => {
    const [first] = await installmentsOf(withRate);
    const before = (await get('/api/customers/balances', bAdmin())).body.find((b) => b.customerId === late.id);
    const res = await collectB({ installmentIds: [first.id] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.amount), 50000);
    assert.equal(Number(res.body.lateFee), 1000);
    assert.equal(Number(res.body.lateFeeComputed), 1000);
    const after = (await get('/api/customers/balances', bAdmin())).body.find((b) => b.customerId === late.id);
    assert.equal(after.balance, before.balance - 50000);

    const paidInst = await models.CustomerInstallment.findByPk(first.id);
    assert.equal(Number(paidInst.lateFee), 1000);

    // En el resumen: el recargo como cargo y la cobranza por el total, así que se cancelan
    const statement = (await get(`/api/customers/${late.id}/account?from=${today()}&to=${today()}`, bAdmin())).body;
    const types = statement.movements.map((m) => m.type);
    assert.equal(statement.movements[types.indexOf('late_fee')].debit, 1000);
    assert.equal(statement.movements[types.indexOf('payment')].credit, 51000);
    assert.equal(statement.balance, after.balance);
  });

  it('se puede perdonar el recargo; anular la cobranza lo borra de las cuotas', async () => {
    const [, second] = await installmentsOf(withRate);
    await models.CustomerInstallment.update({ dueDate: ago(30) }, { where: { id: second.id } });
    const res = await collectB({ installmentIds: [second.id], lateFee: 0 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(Number(res.body.lateFee), 0);
    assert.equal(Number(res.body.lateFeeComputed), 1500, '$50.000 × 3 % ÷ 30 × 30 días');
    const cancel = await api('POST', `/api/customer-payments/${res.body.id}/cancel`, { token: bAdmin(), body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    const inst = await models.CustomerInstallment.findByPk(second.id);
    assert.equal(inst.lateFee, null);
    assert.equal(inst.paidAt, null);
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
