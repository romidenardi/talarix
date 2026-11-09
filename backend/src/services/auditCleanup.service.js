import cron from 'node-cron';
import pkg from 'sequelize';
import { AuditLog } from '../models/index.js';
import { captureError } from '../utils/monitoring.js';

const { Op } = pkg;

const TIMEZONE = 'America/Argentina/Buenos_Aires';

// El registro de actividad se conserva 12 meses (Política de Privacidad, cláusula 6)
export const AUDIT_RETENTION_MONTHS = 12;

export const auditCutoff = (now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - AUDIT_RETENTION_MONTHS);
  return cutoff;
};

// Borra los registros más viejos que el plazo. Devuelve cuántos borró.
export const runAuditCleanup = async (now = new Date()) => {
  const removed = await AuditLog.destroy({ where: { createdAt: { [Op.lt]: auditCutoff(now) } } });
  if (removed) console.log(`[actividad] Se borraron ${removed} registros de más de ${AUDIT_RETENTION_MONTHS} meses.`);
  return removed;
};

const onFailure = (label) => (error) => {
  console.error(`[actividad] ${label}:`, error);
  captureError(error, { job: 'limpieza-actividad' });
};

// Todos los días a las 04:15 y una vez al arrancar. Devuelve lo que hay que parar al cerrar.
export const startAuditCleanupScheduler = () => {
  const task = cron.schedule(
    '15 4 * * *',
    () => {
      runAuditCleanup().catch(onFailure('Error en la tarea diaria.'));
    },
    { timezone: TIMEZONE },
  );

  const firstRun = setTimeout(() => {
    runAuditCleanup().catch(onFailure('Error al iniciar.'));
  }, 50 * 1000);
  firstRun.unref();

  return [task, { stop: () => clearTimeout(firstRun) }];
};
