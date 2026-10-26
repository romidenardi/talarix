import cron from 'node-cron';
import pkg from 'sequelize';
import { Business } from '../models/index.js';
import { purgeBusiness } from './businessPurge.service.js';
import { captureError } from '../utils/monitoring.js';

const { Op } = pkg;

const TIMEZONE = 'America/Argentina/Buenos_Aires';

export const runClosurePurge = async () => {
  if (process.env.DISABLE_AUTO_PURGE === 'true') return;

  const due = await Business.findAll({
    where: { status: 'closing', type: 'client', deleteAt: { [Op.lte]: new Date() } },
    attributes: ['id', 'name'],
  });

  for (const business of due) {
    try {
      await purgeBusiness(business.id);
      console.log(`[baja] Se eliminaron los datos del comercio ${business.id}`);
    } catch (error) {
      console.error(`[baja] No se pudo eliminar el comercio ${business.id}:`, error.message);
      // Alerta: la baja prometida en los términos no se cumplió
      captureError(error, { job: 'baja', comercio: business.id });
    }
  }
};

const onFailure = (label) => (error) => {
  console.error(`[baja] ${label}:`, error);
  captureError(error, { job: 'baja' });
};

// Devuelve lo que hay que parar al cerrar el servidor
export const startClosureScheduler = () => {
  const task = cron.schedule(
    '30 3 * * *',
    () => {
      runClosurePurge().catch(onFailure('Error en la tarea diaria'));
    },
    { timezone: TIMEZONE },
  );

  const firstRun = setTimeout(() => {
    runClosurePurge().catch(onFailure('Error al iniciar'));
  }, 30 * 1000);
  firstRun.unref();

  return [task, { stop: () => clearTimeout(firstRun) }];
};
