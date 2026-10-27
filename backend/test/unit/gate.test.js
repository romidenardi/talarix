import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../../src/utils/gate.js';

describe('createGate', () => {
  it('una por comercio y un máximo total', () => {
    const gate = createGate({ max: 2, perKey: 1 });
    const a = gate.tryEnter('A');
    assert.ok(a);
    assert.equal(gate.tryEnter('A'), null, 'el mismo comercio espera');
    const b = gate.tryEnter('B');
    assert.ok(b);
    assert.equal(gate.tryEnter('C'), null, 'lleno');
    a();
    assert.ok(gate.tryEnter('C'));
    assert.equal(gate.running, 2);
  });

  it('liberar dos veces no descuenta de más', () => {
    const gate = createGate({ max: 1 });
    const release = gate.tryEnter('A');
    release();
    release();
    assert.equal(gate.running, 0);
    assert.ok(gate.tryEnter('A'));
  });
});
