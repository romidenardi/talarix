import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  combinations,
  normalizeAttributes,
  normalizeValues,
  assertNewCombinations,
  variantName,
  isVariantGroup,
} from '../../src/services/variant.service.js';

describe('Variantes', () => {
  it('arma todas las combinaciones', () => {
    assert.deepEqual(
      combinations([
        ['S', 'M'],
        ['Rojo', 'Azul'],
      ]),
      [
        ['S', 'Rojo'],
        ['S', 'Azul'],
        ['M', 'Rojo'],
        ['M', 'Azul'],
      ],
    );
    assert.equal(
      combinations([
        ['S', 'M', 'L'],
        ['Rojo', 'Azul'],
        ['Lisa', 'Rayada'],
      ]).length,
      12,
    );
  });

  it('atributos: de 1 a 3, con nombre y sin repetir', () => {
    assert.deepEqual(normalizeAttributes([' Talle ', 'Color']), ['Talle', 'Color']);
    assert.throws(() => normalizeAttributes([]), /de 1 a 3/);
    assert.throws(() => normalizeAttributes(['A', 'B', 'C', 'D']), /de 1 a 3/);
    assert.throws(() => normalizeAttributes(['Talle', 'talle']), /mismo nombre/);
    assert.throws(() => normalizeAttributes(['']), /nombre/);
  });

  it('valores: uno por atributo', () => {
    assert.deepEqual(normalizeValues([' M ', 'Rojo'], ['Talle', 'Color']), ['M', 'Rojo']);
    assert.throws(() => normalizeValues(['M'], ['Talle', 'Color']), /Talle, Color/);
    assert.throws(() => normalizeValues(['M', ' '], ['Talle', 'Color']), /Color/);
  });

  it('no repite combinaciones, sin importar mayúsculas', () => {
    assert.throws(() => assertNewCombinations([['M', 'Rojo']], [['m', 'rojo']]), /ya existe/);
    assert.throws(() => assertNewCombinations([['M'], [' m']]), /ya existe/);
    assert.doesNotThrow(() =>
      assertNewCombinations([
        ['M', 'Rojo'],
        ['M', 'Azul'],
      ]),
    );
  });

  it('nombre de la variante y principal', () => {
    assert.equal(variantName('Remera', ['M', 'Rojo']), 'Remera · M / Rojo');
    assert.equal(isVariantGroup({ variantAttributes: ['Talle'] }), true);
    assert.equal(isVariantGroup({ variantAttributes: null }), false);
  });
});
