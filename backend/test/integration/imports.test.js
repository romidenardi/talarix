// Importación desde CSV: atómica, sin duplicados y con valores escritos a la argentina
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness } from './helpers.js';

let upload;
let models;
let stop;
let A;

before(async () => {
  ({ upload, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Importadora');
  await models.Category.create({ businessId: A.business.id, name: 'Almacén' });
});

after(async () => {
  await stop?.();
});

// CSV como lo guarda Excel en castellano: punto y coma y BOM
const csv = (rows) => `﻿${rows.map((r) => r.join(';')).join('\r\n')}\r\n`;
const PRODUCT_HEADER = ['Código Interno', 'Nombre', 'Categoría', 'Precio', 'Costo', 'IVA', 'Unidad'];
const importProducts = (rows) => upload('/api/imports/products', {
  token: A.users.admin.token, filename: 'productos.csv', content: csv([PRODUCT_HEADER, ...rows]),
});
const productByCode = (code) => models.Product.findOne({ where: { businessId: A.business.id, internalCode: code } });

describe('Importación de productos', () => {
  it('lee coma decimal, miles con punto, kg, IVA 10,5 y categorías sin tilde', async () => {
    const res = await importProducts([
      ['P1', 'Arroz', 'almacen', '1234,50', '800', '21', 'unidad'],
      ['P2', 'Queso', 'Fiambrería', '12.500', '8.200,75', '10,5', 'kg'],
      ['P3', 'Fideos', '', '1.500,00', '', '', ''],
    ]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.imported, true, JSON.stringify(res.body));
    assert.equal(res.body.created, 3);

    const arroz = await productByCode('P1');
    assert.equal(Number(arroz.price), 1234.5);
    const almacen = await models.Category.findOne({ where: { businessId: A.business.id, name: 'Almacén' } });
    assert.equal(arroz.categoryId, almacen.id, '"almacen" tiene que ir a la categoría "Almacén" existente');

    const queso = await productByCode('P2');
    assert.equal(Number(queso.price), 12500);
    assert.equal(Number(queso.cost), 8200.75);
    assert.equal(Number(queso.vatRate), 10.5);
    assert.equal(queso.unitType, 'weight');
    assert.ok(queso.categoryId, 'la categoría Fiambrería se crea');
    assert.ok(res.body.notes.some((n) => n.includes('Fiambrería')));

    const fideos = await productByCode('P3');
    assert.equal(Number(fideos.price), 1500);
    assert.equal(Number(fideos.vatRate), 21);
    assert.equal(fideos.unitType, 'unit');
    assert.equal(fideos.categoryId, null);
  });

  it('subir el mismo archivo otra vez no duplica nada', async () => {
    const before = await models.Product.count({ where: { businessId: A.business.id } });
    const res = await importProducts([
      ['P1', 'Arroz', 'almacen', '1234,50', '800', '21', 'unidad'],
      ['P2', 'Queso', 'Fiambrería', '12.500', '8.200,75', '10,5', 'kg'],
    ]);
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, true);
    assert.equal(res.body.created, 0);
    assert.equal(res.body.skipped.length, 2);
    assert.equal(await models.Product.count({ where: { businessId: A.business.id } }), before);
  });

  it('si una fila tiene un error no se importa ninguna', async () => {
    const before = await models.Product.count({ where: { businessId: A.business.id } });
    const res = await importProducts([
      ['N1', 'Bueno', '', '100', '50', '21', 'unidad'],
      ['N2', 'Precio mal', '', 'cien', '50', '21', 'unidad'],
      ['N3', 'IVA mal', '', '100', '50', '27', 'unidad'],
      ['N4', 'Unidad mal', '', '100', '50', '21', 'litro'],
      ['N1', 'Repetido', '', '100', '50', '21', 'unidad'],
    ]);
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, false);
    assert.equal(res.body.created, 0);
    assert.deepEqual(res.body.errors.map((e) => e.row), [3, 4, 5, 6]);
    assert.match(res.body.errors[0].message, /Precio inválido/);
    assert.match(res.body.errors[1].message, /IVA/);
    assert.match(res.body.errors[2].message, /Unidad desconocida/);
    assert.match(res.body.errors[3].message, /fila 2/);
    assert.equal(await models.Product.count({ where: { businessId: A.business.id } }), before);
  });

  it('un archivo que no es una planilla da un error claro, no 500', async () => {
    const res = await upload('/api/imports/products', {
      token: A.users.admin.token, filename: 'catalogo.pdf', content: '%PDF-1.4 nada que ver',
    });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  });

  it('el operador no puede importar', async () => {
    const res = await upload('/api/imports/products', {
      token: A.users.operador.token, filename: 'p.csv', content: csv([PRODUCT_HEADER]),
    });
    assert.equal(res.status, 403);
  });
});

describe('Importación de clientes y proveedores', () => {
  it('normaliza la condición fiscal y no repite clientes', async () => {
    const content = csv([
      ['Razón Social', 'Nombre', 'Apellido', 'Condición Fiscal', 'CUIT'],
      ['Norte SRL', '', '', 'responsable inscripto', '30-71234567-1'],
      ['', 'Ana', 'Pérez', 'CF', ''],
      ['Norte S.R.L.', '', '', 'RI', '30712345671'],
    ]);
    const first = await upload('/api/imports/customers', { token: A.users.admin.token, filename: 'c.csv', content });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.imported, true, JSON.stringify(first.body));
    assert.equal(first.body.created, 2);
    assert.equal(first.body.skipped.length, 1, 'el mismo CUIT escrito distinto es el mismo cliente');

    const norte = await models.Customer.findOne({ where: { businessId: A.business.id, businessName: 'Norte SRL' } });
    assert.equal(norte.fiscalCondition, 'Responsable Inscripto');

    const again = await upload('/api/imports/customers', { token: A.users.admin.token, filename: 'c.csv', content });
    assert.equal(again.body.created, 0);
    assert.equal(again.body.skipped.length, 3);
  });

  it('condición fiscal desconocida frena la importación', async () => {
    const res = await upload('/api/imports/customers', {
      token: A.users.admin.token,
      filename: 'c.csv',
      content: csv([['Nombre', 'Condición Fiscal'], ['Juan', 'Monotributista'], ['Pedro', 'Inventada']]),
    });
    assert.equal(res.body.imported, false);
    assert.match(res.body.errors[0].message, /Condición fiscal desconocida/);
    assert.equal(await models.Customer.count({ where: { businessId: A.business.id, firstName: 'Juan' } }), 0);
  });

  it('proveedores sin duplicar por nombre', async () => {
    const content = csv([['Nombre', 'Email'], ['Lácteos del Centro', 'ventas@lacteos.com.ar'], ['Molino Sur', '']]);
    const first = await upload('/api/imports/suppliers', { token: A.users.admin.token, filename: 's.csv', content });
    assert.equal(first.body.created, 2, JSON.stringify(first.body));
    const again = await upload('/api/imports/suppliers', { token: A.users.admin.token, filename: 's.csv', content });
    assert.equal(again.body.created, 0);
    assert.equal(again.body.skipped.length, 2);
  });
});
