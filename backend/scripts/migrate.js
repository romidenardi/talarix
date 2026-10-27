import dotenv from 'dotenv';
dotenv.config();

import { sequelize } from '../src/models/index.js';
import { runMigrations, listMigrationFiles } from '../src/db/migrations.js';

// Aplica las migraciones pendientes sin levantar el servidor (el servidor también lo hace al arrancar).
//   npm run migrate              aplica las pendientes
//   npm run migrate -- --status  solo muestra cuáles están aplicadas y cuáles pendientes
const statusOnly = process.argv.includes('--status');

try {
  await sequelize.authenticate();
  if (statusOnly) {
    const files = await listMigrationFiles();
    let applied = new Set();
    try {
      const [rows] = await sequelize.query('SELECT name FROM schema_migrations');
      applied = new Set(rows.map((row) => row.name));
    } catch {
      console.log('Todavía no existe la tabla schema_migrations (se crea al arrancar el servidor).');
    }
    for (const name of files) console.log(`${applied.has(name) ? '✓ aplicada ' : '· pendiente'}  ${name}`);
  } else {
    const { applied } = await runMigrations(sequelize);
    console.log(applied.length ? `Listo: ${applied.length} aplicadas.` : 'Nada que aplicar.');
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
