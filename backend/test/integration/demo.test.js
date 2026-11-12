// Datos de ejemplo de la cuenta demo: se cargan con insumos, servicios y consumos, y reiniciarla
// no deja nada colgado
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness } from './helpers.js';

let models;
let stop;
let demo;
let resetDemoBusiness;

before(async () => {
  ({ models, stop } = await startTestServer());
  // Después de arrancar el servidor de prueba, que configura la base
  ({ resetDemoBusiness } = await import('../../src/services/demo.service.js'));
  demo = await createBusiness(models, 'Demo de ejemplo');
  await models.Business.update({ type: 'demo' }, { where: { id: demo.business.id } });
});

after(async () => {
  await stop?.();
});

describe('Cuenta demo', () => {
  it('se carga con insumos, servicios y el uso de los insumos', async () => {
    await resetDemoBusiness(demo.business.id);
    const businessId = demo.business.id;

    const supplies = await models.Product.findAll({ where: { businessId, isSupply: true } });
    assert.equal(supplies.length, 4);
    const bolsas = supplies.find((p) => p.internalCode === 'INS-001');
    assert.equal(Number(bolsas.stock), 360); // 500 comprados − 140 usados

    const purchases = await models.Purchase.findAll({
      where: { businessId },
      include: [{ model: models.PurchaseExpense, as: 'expenses' }],
    });
    const expenses = purchases.flatMap((p) => p.expenses);
    assert.deepEqual(expenses.map((e) => Number(e.vatRate)).sort(), [21, 21, 27]);
  });

  it('reiniciarla dos veces no duplica ni deja servicios sueltos', async () => {
    await resetDemoBusiness(demo.business.id);
    const purchaseIds = (await models.Purchase.findAll({ where: { businessId: demo.business.id } })).map((p) => p.id);
    const expenses = await models.PurchaseExpense.findAll();
    const own = expenses.filter((e) => purchaseIds.includes(e.purchaseId));
    assert.equal(own.length, 3);
    // Ningún servicio de un comercio demo queda apuntando a una compra borrada
    const allPurchaseIds = new Set((await models.Purchase.findAll({ attributes: ['id'] })).map((p) => p.id));
    assert.ok(expenses.every((e) => allPurchaseIds.has(e.purchaseId)));
  });
});
