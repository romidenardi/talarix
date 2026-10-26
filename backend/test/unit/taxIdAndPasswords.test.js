import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaxId, cuitCheckDigit } from '../../src/utils/taxId.js';
import { weakPasswordReason, COMMON_PASSWORDS } from '../../src/utils/passwordStrength.js';
import * as frontTaxId from '../../../frontend/src/utils/taxId.js';
import * as frontStrength from '../../../frontend/src/utils/passwordStrength.js';

test('CUIT válido: se guarda con formato, con o sin guiones', () => {
  assert.deepEqual(normalizeTaxId('20123456786'), { value: '20-12345678-6' });
  assert.deepEqual(normalizeTaxId('20-12345678-6'), { value: '20-12345678-6' });
  assert.deepEqual(normalizeTaxId(' 30.71234567.1 '), { value: '30-71234567-1' });
  assert.equal(cuitCheckDigit('2030111222'), 0);
});

test('DNI de 7 u 8 números', () => {
  assert.deepEqual(normalizeTaxId('12.345.678'), { value: '12345678' });
  assert.deepEqual(normalizeTaxId('1234567'), { value: '1234567' });
});

test('vacío es null; mal escrito o con dígito verificador incorrecto, error', () => {
  assert.deepEqual(normalizeTaxId(''), { value: null });
  assert.deepEqual(normalizeTaxId(null), { value: null });
  assert.match(normalizeTaxId('20-12345678-9').error, /no es válido/);
  assert.match(normalizeTaxId('123').error, /11 números/);
  assert.match(normalizeTaxId('20-ABC').error, /solo puede tener números/);
});

test('contraseñas débiles', () => {
  for (const p of ['12345678', 'Password1', 'Argentina', 'aaaaaaaa', 'abcdefgh', '87654321', 'Talarix2026', 'qwertyuiop']) {
    assert.ok(weakPasswordReason(p), `debería rechazar ${p}`);
  }
  assert.ok(weakPasswordReason('romina2026!', { email: 'romina@mail.com' }), 'contiene el email');
  assert.ok(weakPasswordReason('Fernandez99', { name: 'Ana Fernández' }), 'contiene el nombre');
  for (const p of ['caballo-verde-42', 'Mate con 3 bizcochos', 'k9#Lp2!qXz']) {
    assert.equal(weakPasswordReason(p, { email: 'ana@mail.com', name: 'Ana Pérez' }), null, p);
  }
});

test('frontend y backend usan las mismas reglas de CUIT y de contraseñas', () => {
  assert.deepEqual(frontStrength.COMMON_PASSWORDS, COMMON_PASSWORDS);
  for (const v of ['20123456786', '20-12345678-9', '12345678', '123', '', 'x']) {
    assert.deepEqual(frontTaxId.normalizeTaxId(v), normalizeTaxId(v), v);
  }
  for (const p of ['12345678', 'caballo-verde-42', 'Talarix1', 'aaaaaaaa']) {
    assert.equal(frontStrength.weakPasswordReason(p), weakPasswordReason(p), p);
  }
});
