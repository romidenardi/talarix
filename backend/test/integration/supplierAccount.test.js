// Cuenta corriente con proveedores: compras a cuenta corriente, saldo inicial, pagos y resumen
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId } from './helpers.js';
import { dayKey } from '../../src/utils/dates.js';

let api;
let models;
let stop;
let A;
let B;
let supplier;
let transferencia;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Cuenta corriente A');
  B = await createBusiness(models, 'Cuenta corriente B');
  supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Mayorista' });
  transferencia = await models.Payment.create({ businessId: A.business.id, name: 'Transferencia' });
});

after(async () => {
  await stop?.();
});

const admin = () => A.users.admin.token;
const get = (path, token = admin()) => api('GET', path, { token });
const today = () => dayKey(new Date());
const balanceOf = async () => {
  const res = await get('/api/suppliers/balances');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.find((row) => row.supplierId === supplier.id).balance;
};
const buy = (paymentCondition, unitCost) =>
  api('POST', '/api/purchases', {
    token: admin(),
    body: {
      supplierId: supplier.id,
      requestId: newRequestId(),
      paymentCondition,
      items: [{ productId: A.products.yerba.id, quantity: 1, unitCost, vatRate: 0 }],
    },
  });
const pay = (body, token = admin()) =>
  api('POST', '/api/supplier-payments', {
    token,
    body: { supplierId: supplier.id, paymentId: transferencia.id, requestId: newRequestId(), ...body },
  });

describe('Saldo del proveedor', () => {
  it('suma las compras a cuenta corriente, no las de contado', async () => {
    assert.equal((await buy('cash', 500)).status, 201);
    const account = await buy('account', 10000);
    assert.equal(account.status, 201, JSON.stringify(account.body));
    assert.equal(account.body.paymentCondition, 'account');
    assert.equal(await balanceOf(), 10000);
  });

  it('el saldo inicial se suma y el cambio queda en la actividad', async () => {
    const res = await api('PUT', `/api/suppliers/${supplier.id}`, { token: admin(), body: { openingBalance: 2500 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await balanceOf(), 12500);
    const log = await models.AuditLog.findOne({
      where: { action: 'supplier.opening_balance_changed', targetId: supplier.id },
    });
    assert.ok(log);
  });

  it('una compra a cuenta corriente anulada deja de sumar', async () => {
    const extra = await buy('account', 700);
    assert.equal(await balanceOf(), 13200);
    const cancel = await api('POST', `/api/purchases/${extra.body.id}/cancel`, { token: admin(), body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(await balanceOf(), 12500);
  });

  it('rechaza una condición de pago inventada', async () => {
    const res = await buy('fiado', 100);
    assert.equal(res.status, 400);
  });
});

describe('Pagos a proveedores', () => {
  let paymentId;

  it('un pago descuenta de la deuda total; el mismo envío dos veces registra uno solo', async () => {
    const requestId = newRequestId();
    const first = await pay({ amount: 4000, reference: 'TRF 123', requestId });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    paymentId = first.body.id;
    const again = await pay({ amount: 4000, reference: 'TRF 123', requestId });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, paymentId);
    assert.equal(await balanceOf(), 8500);
  });

  it('valida importe, forma de pago y fecha', async () => {
    assert.equal((await pay({ amount: 0 })).status, 400);
    assert.equal((await pay({ amount: 100, paymentId: B.payment.id })).status, 400);
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal((await pay({ amount: 100, date: future })).status, 400);
  });

  it('no se le paga a un proveedor de otro comercio', async () => {
    const other = await models.Supplier.create({ businessId: B.business.id, name: 'Ajeno' });
    const res = await pay({ supplierId: other.id, amount: 100 });
    assert.equal(res.status, 404);
  });

  it('el resumen de cuenta muestra saldo anterior, movimientos con saldo acumulado y saldo final', async () => {
    const res = await get(`/api/suppliers/${supplier.id}/account?from=${today()}&to=${today()}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.previousBalance, 2500);
    // Compra de 10.000 (la anulada y la de contado no aparecen) y pago de 4.000
    assert.deepEqual(
      res.body.movements.map((m) => [m.type, m.debit, m.credit, m.balance]),
      [
        ['purchase', 10000, 0, 12500],
        ['payment', 0, 4000, 8500],
      ],
    );
    assert.equal(res.body.balance, 8500);
  });

  it('anular un pago lo vuelve a sumar a la deuda; no se anula dos veces', async () => {
    const cancel = await api('POST', `/api/supplier-payments/${paymentId}/cancel`, {
      token: admin(),
      body: { reason: 'cargado dos veces' },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.status, 'cancelled');
    assert.equal(await balanceOf(), 12500);
    const again = await api('POST', `/api/supplier-payments/${paymentId}/cancel`, { token: admin(), body: {} });
    assert.equal(again.status, 409);
  });

  it('pagar de más deja saldo a favor (negativo)', async () => {
    assert.equal((await pay({ amount: 13000 })).status, 201);
    assert.equal(await balanceOf(), -500);
  });

  it('el operador no ve saldos ni registra pagos', async () => {
    const operador = A.users.operador.token;
    assert.equal((await get('/api/suppliers/balances', operador)).status, 403);
    assert.equal((await pay({ amount: 10 }, operador)).status, 403);
  });

  it('un proveedor con pagos no se borra', async () => {
    const res = await api('DELETE', `/api/suppliers/${supplier.id}`, { token: admin() });
    assert.equal(res.status, 409);
  });
});
