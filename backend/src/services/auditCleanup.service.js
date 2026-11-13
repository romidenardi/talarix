import cron from 'node-cron';
import pkg from 'sequelize';
import { AuditLog, ServiceRequest } from '../models/index.js';
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

// Los pedidos de demo del sitio web se conservan 6 meses (Política de Privacidad, cláusula 6.1.5).
// Los de baja y arrepentimiento no se borran: son la constancia del pedido.
export const DEMO_REQUEST_RETENTION_MONTHS = 6;

export const demoRequestCutoff = (now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - DEMO_REQUEST_RETENTION_MONTHS);
  return cutoff;
};

export const runDemoRequestCleanup = async (now = new Date()) => {
  const removed = await ServiceRequest.destroy({
    where: { kind: 'demo', createdAt: { [Op.lt]: demoRequestCutoff(now) } },
  });
  if (removed) {
    console.log(`[demos] Se borraron ${removed} pedidos de demo de más de ${DEMO_REQUEST_RETENTION_MONTHS} meses.`);
  }
  return removed;
};

// Las dos limpiezas de datos vencidos, una después de la otra
const runAll = async () => {
  await runAuditCleanup();
  await runDemoRequestCleanup();
};

const onFailure = (label) => (error) => {
  console.error(`[actividad] ${label}:`, error);
  captureError(error, { job: 'limpieza-actividad' });
};

// Registro de actividad y pedidos de demo: todos los días a las 04:15 y una vez al arrancar. Devuelve lo que hay que parar al cerrar.
export const startAuditCleanupScheduler = () => {
  const task = cron.schedule(
    '15 4 * * *',
    () => {
      runAll().catch(onFailure('Error en la tarea diaria.'));
    },
    { timezone: TIMEZONE },
  );

  const firstRun = setTimeout(() => {
    runAll().catch(onFailure('Error al iniciar.'));
  }, 50 * 1000);
  firstRun.unref();

  return [task, { stop: () => clearTimeout(firstRun) }];
};
