import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ean13CheckDigit, parseScaleCode, readScaleCode, scaleCodeProblem, lineFromLabel } from '../src/utils/scale.js';

const ON = { enabled: true };
// Arma un EAN-13 válido a partir de los 12 primeros dígitos
const withCheck = (first12) => `${first12}${ean13CheckDigit(first12)}`;

test('dígito de control EAN-13', () => {
  assert.equal(ean13CheckDigit('779123456789'), 8);
  assert.equal(ean13CheckDigit('200417642600'), 6);
});

test('etiqueta de peso (Systel de fábrica): PLU 417, 0,250 kg', () => {
  const label = parseScaleCode(withCheck('200417000250'), ON);
  assert.deepEqual(label, { code: withCheck('200417000250'), plu: 417, value: 0.25, valueType: 'quantity' });
});

test('no lee etiquetas con la balanza desactivada, otro prefijo, dígito de control mal o largo incorrecto', () => {
  const code = withCheck('200417000250');
  assert.equal(parseScaleCode(code, { enabled: false }), null);
  assert.equal(parseScaleCode(withCheck('210417000250'), ON), null);
  const badCheck = `${code.slice(0, 12)}${(Number(code[12]) + 1) % 10}`;
  assert.equal(parseScaleCode(badCheck, ON), null);
  assert.equal(parseScaleCode('20041700025', ON), null);
  assert.equal(parseScaleCode('abc', ON), null);
});

test('dígito de control mal: dice cuál es y cuál debería ser', () => {
  const code = withCheck('200417000250');
  const wrong = `${code.slice(0, 12)}${(Number(code[12]) + 1) % 10}`;
  const result = readScaleCode(wrong, ON);
  assert.equal(result.error, 'checkDigit');
  assert.equal(result.expected, Number(code[12]));
  assert.equal(result.found, Number(wrong[12]));
  assert.match(scaleCodeProblem(result, ON), /se leyó mal/);
  assert.match(scaleCodeProblem(result, ON), new RegExp(`debería ser ${code[12]}`));
});

test('motivo cuando no es una etiqueta de balanza', () => {
  const code = withCheck('200417000250');
  assert.equal(readScaleCode(code, { enabled: false }).error, 'disabled');
  assert.equal(readScaleCode('7790001234567', ON).error, 'prefix');
  assert.equal(readScaleCode('20123', ON).error, 'format');
  assert.equal(readScaleCode(code, { enabled: true, pluStart: 12, pluLength: 4 }).error, 'positions');
  assert.match(scaleCodeProblem(readScaleCode('20123', ON), ON), /13 números/);
});

test('etiqueta de importe: cantidad = importe / precio', () => {
  const label = parseScaleCode(withCheck('200417007500'), { enabled: true, valueType: 'amount', decimals: 2 });
  assert.equal(label.value, 75);
  const line = lineFromLabel(label, { price: 30000 });
  assert.equal(line.quantity, 0.003);
  assert.equal(line.priceMismatch, false);
});

// Ojo: una etiqueta que trae solo el importe no dice el peso, así que no hay forma de saber si la
// balanza tenía otro precio. Cualquier importe se convierte en una cantidad (redondeada al gramo) y
// la diferencia queda siempre dentro del redondeo: priceMismatch no se activa con etiquetas de importe.
test('etiqueta de importe: el redondeo al gramo no se marca como diferencia de precio', () => {
  const line = lineFromLabel({ valueType: 'amount', value: 3500 }, { price: 30000 });
  assert.equal(line.quantity, 0.117);
  assert.equal(line.priceMismatch, false);
});

test('etiqueta de importe con producto sin precio', () => {
  const line = lineFromLabel({ valueType: 'amount', value: 100 }, { price: 0 });
  assert.equal(line.noPrice, true);
});
