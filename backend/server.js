import dotenv from 'dotenv';
dotenv.config();

import app from './src/app.js';
import { sequelize } from './src/models/index.js';
import { startClosureScheduler } from './src/services/closureScheduler.service.js';
import { startDemoResetJob } from './src/jobs/demoReset.job.js';
import { initMonitoring, captureError, flushMonitoring } from './src/utils/monitoring.js';

const PORT = process.env.PORT || 3000;

const REQUIRED_ENV = [
  'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT',
  'JWT_SECRET', 'PLATFORM_JWT_SECRET', 'APP_URL',
];

let server = null;
const jobs = [];
let shuttingDown = false;

// Cierre ordenado: Railway manda SIGTERM antes de reemplazar el servidor en cada deploy.
// Se dejan de aceptar pedidos nuevos, se terminan los que están en curso (hasta 10 s), se paran
// las tareas programadas y se cierra la conexión con la base.
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[servidor] ${signal} recibido: cerrando…`);

  const force = setTimeout(() => {
    console.error('[servidor] El cierre tardó más de 10 s: se fuerza la salida');
    process.exit(1);
  }, 10000);
  force.unref();

  for (const job of jobs) {
    try {
      job?.stop?.();
    } catch {
      /* nada */
    }
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    await sequelize.close();
  } catch {
    /* nada */
  }
  await flushMonitoring();
  console.log('[servidor] Cerrado');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[servidor] Promesa rechazada sin manejar:', reason instanceof Error ? reason.stack : reason);
  captureError(reason instanceof Error ? reason : new Error(String(reason)), { origen: 'unhandledRejection' });
});

const start = async () => {
  try {
    const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      console.error('Faltan variables de entorno:', missing.join(', '));
      process.exit(1);
    }
    if (process.env.JWT_SECRET === process.env.PLATFORM_JWT_SECRET) {
      console.error('JWT_SECRET y PLATFORM_JWT_SECRET deben ser distintos');
      process.exit(1);
    }

    await initMonitoring();

    await sequelize.authenticate();
    console.log('Conexión a MySQL exitosa');

    await sequelize.sync();

    server = app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));

    jobs.push(...startClosureScheduler(), startDemoResetJob());
  } catch (error) {
    console.error('Error al iniciar:', error);
    captureError(error, { origen: 'arranque' });
    await flushMonitoring();
    process.exit(1);
  }
};

start();
