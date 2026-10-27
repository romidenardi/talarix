import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateDbHost, dbHostWarning } from '../../src/utils/dbHost.js';

describe('Dirección de la base', () => {
  it('reconoce la red privada de Railway y la base local', () => {
    assert.equal(isPrivateDbHost('mysql.railway.internal'), true);
    assert.equal(isPrivateDbHost(' MySQL-UOHe.railway.internal '), true);
    assert.equal(isPrivateDbHost('localhost'), true);
    assert.equal(isPrivateDbHost('127.0.0.1'), true);
    assert.equal(isPrivateDbHost('roundhouse.proxy.rlwy.net'), false);
    assert.equal(isPrivateDbHost(''), false);
  });

  it('avisa solo en Railway y con la dirección pública', () => {
    assert.equal(dbHostWarning({ DB_HOST: 'roundhouse.proxy.rlwy.net' }), null, 'en local no avisa');
    assert.equal(dbHostWarning({ RAILWAY_ENVIRONMENT_NAME: 'production', DB_HOST: 'mysql.railway.internal' }), null);
    assert.match(
      dbHostWarning({ RAILWAY_ENVIRONMENT_NAME: 'production', DB_HOST: 'roundhouse.proxy.rlwy.net' }),
      /no va cifrada/,
    );
  });
});
