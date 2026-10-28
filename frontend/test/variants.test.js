import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVariants, parseValues, isVariantGroup } from '../src/utils/variants.js';

test('valores separados por coma, sin vacíos ni repetidos', () => {
  assert.deepEqual(parseValues(' S, M ,, m, L '), ['S', 'M', 'L']);
  assert.deepEqual(parseValues(''), []);
});

test('arma las combinaciones de los atributos cargados', () => {
  const result = buildVariants([
    { name: 'Talle', values: 'S, M' },
    { name: 'Color', values: 'Rojo, Azul' },
    { name: '', values: '' },
  ]);
  assert.deepEqual(result.attributes, ['Talle', 'Color']);
  assert.deepEqual(
    result.items.map((i) => i.values.join('/')),
    ['S/Rojo', 'S/Azul', 'M/Rojo', 'M/Azul'],
  );
});

test('avisa lo que falta', () => {
  assert.match(buildVariants([{ name: '', values: '' }]).error, /al menos un atributo/);
  assert.match(buildVariants([{ name: '', values: 'S' }]).error, /nombre/);
  assert.match(buildVariants([{ name: 'Talle', values: ' , ' }]).error, /valores de Talle/);
  assert.match(
    buildVariants([
      { name: 'Talle', values: 'S' },
      { name: 'talle', values: 'M' },
    ]).error,
    /mismo nombre/,
  );
  const many = Array.from({ length: 11 }, (_, i) => `v${i}`).join(',');
  assert.match(
    buildVariants([
      { name: 'A', values: many },
      { name: 'B', values: many },
    ]).error,
    /máximo es 100/,
  );
});

test('producto principal', () => {
  assert.equal(isVariantGroup({ variantAttributes: ['Talle'] }), true);
  assert.equal(isVariantGroup({ variantAttributes: null }), false);
});
