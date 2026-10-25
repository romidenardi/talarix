import cron from 'node-cron';
import { resetAllDemoBusinesses } from '../services/demo.service.js';
import { captureError } from '../utils/monitoring.js';

// Devuelve la tarea (para pararla al cerrar el servidor), o null si está desactivada
export const startDemoResetJob = () => {
  if (process.env.DEMO_RESET_ENABLED === 'false') return null;

  const task = cron.schedule(
    '0 3 * * *',
    () => {
      resetAllDemoBusinesses().catch((error) => {
        console.error('[demo]', error);
        captureError(error, { job: 'demo' });
      });
    },
    { timezone: 'America/Argentina/Buenos_Aires' }
  );
  console.log('[demo] Reinicio nocturno programado: 03:00 (Buenos Aires)');
  return task;
};
