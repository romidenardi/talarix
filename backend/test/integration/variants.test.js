// Productos con variantes: alta, precio heredado, bloqueos del principal y borrado
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, newRequestId, stockOf } from './helpers.js';

let api;
let models;
let stop;
let A;
let token;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Variantes A');
  token = A.users.admin.token;
});

after(async () => {
  await stop?.();
});

const remera = (overrides = {}) => ({
  internalCode: 'REM',
  name: 'Remera',
  price: 1000,
  cost: 500,
  unitType: 'unit',
  vatRate: 21,
  variants: {
    attributes: ['Talle', 'Color'],
    items: [{ values: ['S', 'Rojo'] }, { values: ['M', 'Rojo'] }, { values: ['M', 'Azul'], price: 1200 }],
  },
  ...overrides,
});

const variantsOf = (parentId) => models.Product.findAll({ where: { parentId }, order: [['internalCode', 'ASC']] });

const createRemera = async (overrides) => {
  const res = await api('POST', '/api/products', { token, body: remera(overrides) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};

const sell = (productId, quantity = 1) =>
  api('POST', '/api/orders', {
    token,
    body: {
      customerId: A.customer.id,
      paymentId: A.payment.id,
      requestId: newRequestId(),
      items: [{ productId, quantity, unitPrice: 1000 }],
    },
  });

describe('Alta de un producto con variantes', () => {
  it('crea el principal y una variante por combinación, con nombre, código y precio', async () => {
    const items = remera().variants.items.map((item, i) => (i === 1 ? { ...item, barcode: '7790000000011' } : item));
    const parent = await createRemera({ variants: { attributes: ['Talle', 'Color'], items } });
    assert.deepEqual(parent.variantAttributes, ['Talle', 'Color']);
    assert.equal(parent.variants.length, 3);

    const variants = await variantsOf(parent.id);
    assert.deepEqual(
      variants.map((v) => [v.internalCode, v.name, Number(v.price), v.ownPrice]),
      [
        ['REM-1', 'Remera · S / Rojo', 1000, false],
        ['REM-2', 'Remera · M / Rojo', 1000, false],
        ['REM-3', 'Remera · M / Azul', 1200, true],
      ],
    );
    assert.equal(variants[1].barcode, '7790000000011');
    assert.equal(Number(variants[0].vatRate), 21);
  });

  it('una combinación repetida o un código de barras usado no crea nada', async () => {
    const before = await models.Product.count();
    const repeated = await api('POST', '/api/products', {
      token,
      body: remera({
        internalCode: 'BUZ',
        variants: { attributes: ['Talle'], items: [{ values: ['M'] }, { values: [' m '] }] },
      }),
    });
    assert.equal(repeated.status, 409);

    const usedBarcode = await api('POST', '/api/products', {
      token,
      body: remera({
        internalCode: 'GOR',
        variants: { attributes: ['Talle'], items: [{ values: ['U'], barcode: '7790000000011' }] },
      }),
    });
    assert.equal(usedBarcode.status, 409);
    assert.equal(await models.Product.count(), before);
  });

  it('solo por unidad y con 1 a 3 atributos', async () => {
    const weight = await api('POST', '/api/products', { token, body: remera({ unitType: 'weight' }) });
    assert.equal(weight.status, 400);
    const tooMany = await api('POST', '/api/products', {
      token,
      body: remera({ variants: { attributes: ['A', 'B', 'C', 'D'], items: [{ values: ['1', '2', '3', '4'] }] } }),
    });
    assert.equal(tooMany.status, 400);
  });
});

describe('El principal no se vende, no se compra y no tiene stock', () => {
  it('remito, compra, movimiento de stock y combo piden la variante', async () => {
    const parent = await createRemera({ internalCode: 'CAM', name: 'Camisa' });
    const [variant] = await variantsOf(parent.id);

    const sale = await sell(parent.id);
    assert.equal(sale.status, 400);
    assert.match(sale.body.message, /tiene variantes/);

    const supplier = await models.Supplier.create({ businessId: A.business.id, name: 'Textil' });
    const buyParent = await api('POST', '/api/purchases', {
      token,
      body: {
        supplierId: supplier.id,
        requestId: newRequestId(),
        items: [{ productId: parent.id, quantity: 5, unitCost: 400 }],
      },
    });
    assert.equal(buyParent.status, 400);

    const move = await api('POST', '/api/stock-movements', {
      token,
      body: { productId: parent.id, type: 'in', quantity: 3 },
    });
    assert.equal(move.status, 400);

    const combo = await api('POST', '/api/combos', {
      token,
      body: { internalCode: 'CMB', name: 'Combo', components: [{ productId: parent.id, quantity: 1 }] },
    });
    assert.equal(combo.status, 400);

    // La variante sí: se compra, se vende y mueve su propio stock
    const buyVariant = await api('POST', '/api/purchases', {
      token,
      body: {
        supplierId: supplier.id,
        requestId: newRequestId(),
        items: [{ productId: variant.id, quantity: 5, unitCost: 400 }],
      },
    });
    assert.equal(buyVariant.status, 201, JSON.stringify(buyVariant.body));
    const sold = await sell(variant.id, 2);
    assert.equal(sold.status, 201, JSON.stringify(sold.body));
    assert.equal(await stockOf(models, variant), 3);
    assert.equal(await stockOf(models, parent), 0);

    const dashboard = await api('GET', '/api/reports/dashboard', { token });
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
    assert.ok(!dashboard.body.stock.items.some((p) => p.id === parent.id), 'el principal no aparece como sin stock');
  });
});

describe('Cambios', () => {
  it('el principal pasa sus datos a las variantes; el precio, solo a las que no tienen uno propio', async () => {
    const parent = await createRemera({ internalCode: 'BUZO', name: 'Buzo' });
    const category = await models.Category.create({ businessId: A.business.id, name: 'Ropa' });

    const res = await api('PUT', `/api/products/${parent.id}`, {
      token,
      body: { name: 'Buzo con capucha', price: 1500, categoryId: category.id, vatRate: 10.5 },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const variants = await variantsOf(parent.id);
    assert.deepEqual(
      variants.map((v) => [v.name, Number(v.price), v.categoryId, Number(v.vatRate)]),
      [
        ['Buzo con capucha · S / Rojo', 1500, category.id, 10.5],
        ['Buzo con capucha · M / Rojo', 1500, category.id, 10.5],
        ['Buzo con capucha · M / Azul', 1200, category.id, 10.5],
      ],
    );
  });

  it('inactivar el principal inactiva las variantes, y una variante no se activa sola', async () => {
    const parent = await createRemera({ internalCode: 'GORRA', name: 'Gorra' });
    await api('PUT', `/api/products/${parent.id}`, { token, body: { active: false } });
    const variants = await variantsOf(parent.id);
    assert.ok(variants.every((v) => v.active === false));

    const res = await api('PUT', `/api/products/${variants[0].id}`, { token, body: { active: true } });
    assert.equal(res.status, 400);
  });

  it('precio propio de una variante, y volver al del principal', async () => {
    const parent = await createRemera({ internalCode: 'MED', name: 'Medias' });
    const [variant] = await variantsOf(parent.id);

    const own = await api('PUT', `/api/products/${variant.id}`, { token, body: { price: 900 } });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.ownPrice, true);

    await api('PUT', `/api/products/${parent.id}`, { token, body: { price: 1100 } });
    assert.equal(Number((await models.Product.findByPk(variant.id)).price), 900);

    const back = await api('PUT', `/api/products/${variant.id}`, { token, body: { ownPrice: false } });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(Number(back.body.price), 1100);
    assert.equal(back.body.ownPrice, false);
  });

  it('cambiar los valores de una variante: no a una combinación que ya existe', async () => {
    const parent = await createRemera({ internalCode: 'POL', name: 'Polo' });
    const [first] = await variantsOf(parent.id);

    const taken = await api('PUT', `/api/products/${first.id}`, { token, body: { variantValues: ['M', 'Rojo'] } });
    assert.equal(taken.status, 409);

    const ok = await api('PUT', `/api/products/${first.id}`, { token, body: { variantValues: ['XL', 'Rojo'] } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.name, 'Polo · XL / Rojo');
  });

  it('agregar variantes a un producto que ya existe', async () => {
    const parent = await createRemera({ internalCode: 'SHO', name: 'Short' });
    const added = await api('POST', `/api/products/${parent.id}/variants`, {
      token,
      body: { items: [{ values: ['S', 'Verde'] }, { values: ['M', 'Verde'] }] },
    });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.deepEqual(
      added.body.map((v) => v.internalCode),
      ['SHO-4', 'SHO-5'],
    );

    const repeated = await api('POST', `/api/products/${parent.id}/variants`, {
      token,
      body: { items: [{ values: ['s', 'rojo'] }] },
    });
    assert.equal(repeated.status, 409);
  });
});

describe('Borrado', () => {
  it('con una variante vendida no se borra; sin historial se borra todo', async () => {
    const sold = await createRemera({ internalCode: 'JEAN', name: 'Jean' });
    const [variant] = await variantsOf(sold.id);
    await models.Product.update({ stock: 5 }, { where: { id: variant.id } });
    assert.equal((await sell(variant.id)).status, 201);

    const blocked = await api('DELETE', `/api/products/${sold.id}`, { token });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /aparece en 1 remito/);

    const clean = await createRemera({ internalCode: 'FAL', name: 'Falda' });
    const res = await api('DELETE', `/api/products/${clean.id}`, { token });
    assert.equal(res.status, 204);
    assert.equal(await models.Product.count({ where: { parentId: clean.id } }), 0);
    assert.equal(await models.Product.findByPk(clean.id), null);
  });
});
