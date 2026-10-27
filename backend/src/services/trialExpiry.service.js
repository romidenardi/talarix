import cron from 'node-cron';
import pkg from 'sequelize';
import { Business } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { captureError } from '../utils/monitoring.js';

const { Op } = pkg;

const TIMEZONE = 'America/Argentina/Buenos_Aires';

// Motivos de suspensión (businesses.suspended_reason)
export const TRIAL_EXPIRED = 'trial_expired';
export const MANUAL = 'manual';

// Suspende los comercios cuya prueba gratis ya venció. Solo clientes activos: la demo no vence y
// un comercio en baja sigue su propio curso. Devuelve los ids suspendidos.
export const runTrialExpiry = async (now = new Date()) => {
  const due = await Business.findAll({
    where: { type: 'client', status: 'active', trialEndsAt: { [Op.lte]: now } },
    attributes: ['id', 'trialEndsAt'],
  });

  const suspended = [];
  for (const business of due) {
    // Se repite la condición: si justo lo renovaron, no se toca
    const [count] = await Business.update(
      { status: 'suspended', suspendedReason: TRIAL_EXPIRED },
      {
        where: {
          id: business.id,
          status: 'active',
          trialEndsAt: { [Op.lte]: now },
        },
      },
    );
    if (!count) continue;
    suspended.push(business.id);
    console.log(`[prueba] Venció la prueba del comercio ${business.id}: suspendido`);
    await audit(null, {
      action: 'business.trial_expired',
      actorType: 'system',
      businessId: business.id,
      targetType: 'business',
      targetId: business.id,
      detail: { trialEndsAt: business.trialEndsAt },
    });
  }
  return suspended;
};

const onFailure = (label) => (error) => {
  console.error(`[prueba] ${label}:`, error);
  captureError(error, { job: 'vencimiento-prueba' });
};

// Cada hora (a los 5 minutos) y una vez al arrancar. Devuelve lo que hay que parar al cerrar.
export const startTrialExpiryScheduler = () => {
  const task = cron.schedule(
    '5 * * * *',
    () => {
      runTrialExpiry().catch(onFailure('Error en la tarea'));
    },
    { timezone: TIMEZONE },
  );

  const firstRun = setTimeout(() => {
    runTrialExpiry().catch(onFailure('Error al iniciar'));
  }, 40 * 1000);
  firstRun.unref();

  return [task, { stop: () => clearTimeout(firstRun) }];
};
