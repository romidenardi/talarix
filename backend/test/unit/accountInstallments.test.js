// Cuotas de la cuenta corriente de clientes: vencimientos, importes y días de atraso
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueDates, splitAmount, daysLate } from '../../src/utils/accountInstallments.js';

describe('Vencimientos', () => {
  it('la primera vence el próximo día elegido posterior a la venta', () => {
    assert.deepEqual(dueDates('2026-11-10', 20, 1), ['2026-11-20']);
    assert.deepEqual(dueDates('2026-11-25', 20, 1), ['2026-12-20']);
    assert.deepEqual(dueDates('2026-11-20', 20, 1), ['2026-12-20'], 'vendido el mismo día: el mes siguiente');
  });

  it('las demás, una por mes, pasando de año', () => {
    assert.deepEqual(dueDates('2026-11-25', 20, 3), ['2026-12-20', '2027-01-20', '2027-02-20']);
  });

  it('si el mes no tiene ese día, vence el último día del mes', () => {
    assert.deepEqual(dueDates('2027-01-15', 31, 4), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    assert.deepEqual(dueDates('2028-02-05', 30, 1), ['2028-02-29'], 'año bisiesto');
    assert.deepEqual(dueDates('2027-02-28', 31, 1), ['2027-03-31'], 'el 28 de febrero ya es el último día');
  });
});

describe('Importe de cada cuota', () => {
  it('cuotas iguales; los centavos que sobran van a la última', () => {
    assert.deepEqual(splitAmount(34500, 3), [11500, 11500, 11500]);
    assert.deepEqual(splitAmount(100, 3), [33.33, 33.33, 33.34]);
    assert.deepEqual(splitAmount(1000.01, 1), [1000.01]);
    const parts = splitAmount(98765.43, 7);
    assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 9876543);
  });
});

describe('Días de atraso', () => {
  it('cuenta días corridos desde el vencimiento; antes o el mismo día, 0', () => {
    assert.equal(daysLate('2026-11-20', '2026-11-19'), 0);
    assert.equal(daysLate('2026-11-20', '2026-11-20'), 0);
    assert.equal(daysLate('2026-11-20', '2026-11-21'), 1);
    assert.equal(daysLate('2026-10-20', '2026-11-20'), 31);
    assert.equal(daysLate('2026-03-01', '2026-03-31'), 30);
  });
});
