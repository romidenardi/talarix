import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCALE_CONFIG, normalizeScaleConfig, resolveScaleConfig } from '../../src/utils/scaleConfig.js';

test('sin configuración guardada usa la de fábrica (Systel)', () => {
  assert.deepEqual(resolveScaleConfig(null), DEFAULT_SCALE_CONFIG);
  assert.deepEqual(normalizeScaleConfig({}), DEFAULT_SCALE_CONFIG);
});

test('acepta una configuración válida y la normaliza', () => {
  const cfg = normalizeScaleConfig({ enabled: true, prefix: '21', valueType: 'amount', decimals: '2' });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.prefix, '21');
  assert.equal(cfg.valueType, 'amount');
  assert.equal(cfg.decimals, 2);
});

test('rechaza configuraciones imposibles', () => {
  assert.throws(() => normalizeScaleConfig({ prefix: 'AB' }), /prefijo/);
  assert.throws(() => normalizeScaleConfig({ valueType: 'otro' }), /peso o el importe/);
  assert.throws(() => normalizeScaleConfig({ valueStart: 5 }), /superponerse/);
  assert.throws(() => normalizeScaleConfig({ valueStart: 8 }), /primeros 12/);
  assert.throws(() => normalizeScaleConfig({ pluStart: 2 }), /prefijo/);
  assert.throws(() => normalizeScaleConfig({ decimals: 9 }), /decimales/);
});
