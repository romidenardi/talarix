import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStatements, listMigrationFiles } from '../../src/db/migrations.js';

test('separa sentencias por ";" al final de línea e ignora comentarios', () => {
  const sql = `-- comentario
ALTER TABLE orders ADD COLUMN x INT NULL;
-- otro;
UPDATE orders
SET x = 1
WHERE y = 'a;b';
CREATE INDEX idx ON orders (x)`;
  assert.deepEqual(splitStatements(sql), [
    'ALTER TABLE orders ADD COLUMN x INT NULL',
    "UPDATE orders\nSET x = 1\nWHERE y = 'a;b'",
    'CREATE INDEX idx ON orders (x)',
  ]);
});

test('un archivo solo con comentarios no tiene sentencias', () => {
  assert.deepEqual(splitStatements('-- nada\n-- tampoco'), []);
});

test('las migraciones del repo están numeradas y en orden', async () => {
  const files = await listMigrationFiles();
  assert.ok(files.length >= 1);
  assert.equal(files[0], '000-punto-de-partida.sql');
  const numbers = files.map((f) => f.slice(0, 3));
  assert.equal(new Set(numbers).size, numbers.length, `números repetidos: ${numbers}`);
});
