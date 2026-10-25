import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, isEmptyRow, parseAmount, parseUnit, parseVat, parsePercent, normalizeFiscalCondition,
} from '../../src/utils/importValues.js';

test('normalizeText ignora tildes, mayúsculas y espacios', () => {
  assert.equal(normalizeText('  Almacén   Ramos '), 'almacen ramos');
  assert.equal(normalizeText('ALMACEN ramos'), normalizeText('Almacén Ramos'));
  assert.equal(normalizeText('\uFEFFCódigo Interno'), 'codigo interno');
});

test('fila vacía', () => {
  assert.equal(isEmptyRow({ a: '', b: '  ' }), true);
  assert.equal(isEmptyRow({ a: '', b: 0 }), false);
});

test('importes con coma o punto decimal', () => {
  const cases = {
    '1234,50': 1234.5, '1.234,50': 1234.5, '$ 1.234,50': 1234.5, '1234.50': 1234.5, '1,234.50': 1234.5,
    '1.234': 1234, '1.234.567': 1234567, '1,234,567': 1234567, '0.250': 0.25, '0,250': 0.25, '10,5': 10.5,
    '1500': 1500, '-5': -5,
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseAmount(input), expected, input);
  assert.equal(parseAmount(1500.75), 1500.75);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('12a')));
});

test('unidad: peso, kg, kilo… o unidad', () => {
  for (const v of ['peso', 'Kg', 'KILO', 'kilos', 'a granel', 'Por kg']) assert.equal(parseUnit(v), 'weight', v);
  for (const v of ['', 'unidad', 'Unidades', 'u', 'un.', 'c/u']) assert.equal(parseUnit(v), 'unit', v);
  assert.equal(parseUnit('litro'), null);
});

test('IVA: 21, 10,5, %, exento y formato porcentaje de Excel', () => {
  const cases = { '': 21, 21: 21, '21%': 21, '10,5': 10.5, '10.5': 10.5, '10,5 %': 10.5, 0: 0, exento: 0, 0.21: 21, 0.105: 10.5 };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseVat(input), expected, String(input));
  assert.ok(Number.isNaN(parseVat('27')));
  assert.ok(Number.isNaN(parseVat('mucho')));
});

test('impuestos internos', () => {
  assert.equal(parsePercent(''), null);
  assert.equal(parsePercent('8'), 8);
  assert.equal(parsePercent('8,5%'), 8.5);
  assert.ok(Number.isNaN(parsePercent('150')));
});

test('condición fiscal con variantes y abreviaturas', () => {
  const cases = {
    'Responsable inscripto': 'Responsable Inscripto', RI: 'Responsable Inscripto', 'resp. inscripto': 'Responsable Inscripto',
    'consumidor final': 'Consumidor Final', CF: 'Consumidor Final', Monotributo: 'Monotributista', exenta: 'Exento',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(normalizeFiscalCondition(input), expected, input);
  assert.equal(normalizeFiscalCondition('otra cosa'), null);
});
