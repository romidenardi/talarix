// Lectura de etiquetas de balanza (frontend/src/utils/scale.js) y los avisos de cada problema
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readScaleCode,
  parseScaleCode,
  scaleCodeProblem,
  lineFromLabel,
  ean13CheckDigit,
} from '../../../frontend/src/utils/scale.js';

const config = { enabled: true }; // valores de fábrica de Systel
const withDigit = (first12) => `${first12}${ean13CheckDigit(first12)}`;
const good = withDigit('200417642600'); // PLU 417, 0,6426 → 642,600 g con 3 decimales

describe('Etiquetas de balanza', () => {
  it('lee PLU y peso de una etiqueta correcta', () => {
    const { label } = readScaleCode(good, config);
    assert.equal(label.plu, 417);
    assert.equal(label.value, 642.6);
    assert.equal(parseScaleCode(good, config).plu, 417);
  });

  it('dígito de control mal: dice cuál es y cuál debería ser', () => {
    const wrong = `${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`;
    const result = readScaleCode(wrong, config);
    assert.equal(result.error, 'checkDigit');
    assert.equal(result.expected, Number(good[12]));
    assert.equal(parseScaleCode(wrong, config), null);
    assert.match(scaleCodeProblem(result, config), /se leyó mal/);
    assert.match(scaleCodeProblem(result, config), new RegExp(`debería ser ${good[12]}`));
  });

  it('otros códigos no son etiquetas de balanza', () => {
    assert.equal(readScaleCode('7790001234567', config).error, 'prefix');
    assert.equal(readScaleCode('20123', config).error, 'format');
    assert.equal(readScaleCode(good, { enabled: false }).error, 'disabled');
    assert.equal(readScaleCode(good, { enabled: true, pluStart: 12, pluLength: 4 }).error, 'positions');
  });

  it('etiqueta con importe: la cantidad sale del precio del sistema', () => {
    const amountConfig = { enabled: true, valueType: 'amount', decimals: 2 };
    const { label } = readScaleCode(withDigit('200417150000'), amountConfig);
    assert.equal(label.value, 1500);
    const line = lineFromLabel(label, { price: 1000 });
    assert.equal(line.quantity, 1.5);
    assert.equal(line.priceMismatch, false);
  });
});
