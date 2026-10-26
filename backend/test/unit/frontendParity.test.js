import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as backTaxes from '../../src/utils/taxes.js';
import * as frontTaxes from '../../../frontend/src/utils/taxes.js';
import { DEFAULT_SCALE_CONFIG as backScale } from '../../src/utils/scaleConfig.js';
import { DEFAULT_SCALE_CONFIG as frontScale } from '../../../frontend/src/utils/scale.js';

// El cálculo de IVA está copiado en el frontend (vista previa) y en el backend (lo que se guarda).
// Si alguien cambia uno y no el otro, este test falla.
const CASES = [
  [1210, 21, 0],
  [1155, 10.5, 5],
  [999.99, 21, 8],
  [0, 21, 0],
  [500, 0, 0],
  [31, 10.5, null],
];

test('splitPrice da lo mismo en el frontend y en el backend', () => {
  for (const args of CASES) {
    assert.deepEqual(frontTaxes.splitPrice(...args), backTaxes.splitPrice(...args), `caso ${args.join(', ')}`);
  }
});

test('splitLineParts reparte igual en el frontend y en el backend', () => {
  const components = [
    { price: 1000, quantity: 1, vatRate: 21, otherTaxes: 0 },
    { price: 350, quantity: 3, vatRate: 10.5, otherTaxes: 4 },
  ];
  const back = backTaxes.splitLineParts(2500, components);
  const front = frontTaxes.splitLineParts(2500, components);
  front.forEach((part, i) => {
    for (const key of ['total', 'net', 'vat', 'internal']) assert.equal(part[key], back[i][key], `${key} ${i}`);
  });
});

test('la configuración de fábrica de la balanza es la misma en los dos lados', () => {
  assert.deepEqual(frontScale, backScale);
});
