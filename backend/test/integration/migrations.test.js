// Migraciones contra MySQL: una base existente aplica solo las pendientes, una vez cada una
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from './helpers.js';

let models;
let stop;
let dir;

before(async () => {
  ({ models, stop } = await startTestServer());
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'talarix-migraciones-'));
});

after(async () => {
  await models?.sequelize.query('ALTER TABLE businesses DROP COLUMN prueba_migracion').catch(() => {});
  await stop?.();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('Migraciones', () => {
  it('la base nueva se crea completa y queda anotada la migración de partida', async () => {
    const [rows] = await models.sequelize.query('SELECT name FROM schema_migrations');
    assert.ok(rows.some((r) => r.name === '000-punto-de-partida.sql'));
  });

  it('una migración nueva se aplica una sola vez', async () => {
    const { runMigrations } = await import('../../src/db/migrations.js');
    await fs.writeFile(
      path.join(dir, '900-prueba.sql'),
      '-- columna de prueba\nALTER TABLE businesses ADD COLUMN prueba_migracion INT NULL;\nUPDATE businesses SET prueba_migracion = 7;\n',
    );

    const first = await runMigrations(models.sequelize, { dir, log: () => {} });
    assert.deepEqual(first.applied, ['900-prueba.sql']);
    const [cols] = await models.sequelize.query("SHOW COLUMNS FROM businesses LIKE 'prueba_migracion'");
    assert.equal(cols.length, 1);

    const second = await runMigrations(models.sequelize, { dir, log: () => {} });
    assert.deepEqual(second.applied, []);
  });

  it('si una sentencia falla, dice en qué archivo y no la marca como aplicada', async () => {
    const { runMigrations } = await import('../../src/db/migrations.js');
    await fs.writeFile(path.join(dir, '901-rota.sql'), 'ALTER TABLE tabla_que_no_existe ADD COLUMN x INT;\n');
    await assert.rejects(runMigrations(models.sequelize, { dir, log: () => {} }), /901-rota\.sql, sentencia 1/);
    const [rows] = await models.sequelize.query("SELECT name FROM schema_migrations WHERE name = '901-rota.sql'");
    assert.equal(rows.length, 0);
  });
});
