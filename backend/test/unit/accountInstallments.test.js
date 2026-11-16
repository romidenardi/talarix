// Cuotas de la cuenta corriente de clientes: vencimientos, importes, días de atraso y recargo por mora
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueDates, splitAmount, daysLate, lateFee, spreadFee } from '../../src/utils/accountInstallments.js';

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

describe('Recargo por mora', () => {
  it('interés simple por día: % mensual ÷ 30 por cada día de atraso', () => {
    assert.equal(lateFee(100000, 20, 3), 2000);
    assert.equal(lateFee(100000, 30, 3), 3000);
    assert.equal(lateFee(100000, 1, 3), 100);
    assert.equal(lateFee(33333.33, 7, 2.5), 194.44);
  });

  it('sin tasa, sin atraso o dentro de los días de gracia, no hay recargo', () => {
    assert.equal(lateFee(100000, 20, null), 0);
    assert.equal(lateFee(100000, 20, 0), 0);
    assert.equal(lateFee(100000, 0, 3), 0);
    assert.equal(lateFee(100000, 5, 3, 5), 0, 'el último día de gracia todavía no tiene recargo');
  });

  it('pasados los días de gracia, se cuenta desde el vencimiento', () => {
    assert.equal(lateFee(100000, 6, 3, 5), 600);
  });
});

describe('Reparto del recargo perdonado en parte', () => {
  it('en proporción a lo que calculó cada cuota; los centavos a la última', () => {
    assert.deepEqual(spreadFee(1000, [1500, 500]), [750, 250]);
    assert.deepEqual(spreadFee(100, [1, 1, 1]), [33.33, 33.33, 33.34]);
    assert.deepEqual(spreadFee(10, [3, 0]), [10, 0], 'la cuota sin recargo no se lleva nada');
    assert.deepEqual(spreadFee(0, [3, 4]), [0, 0]);
  });
});
