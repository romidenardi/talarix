import { AuditLog } from '../models/index.js';

// Guarda una acción en el registro de auditoría. Nunca hace fallar la acción principal: si no se
// puede guardar, lo avisa en los logs y sigue.
//   audit(req, { action: 'customer.anonymized', targetType: 'customer', targetId: customer.id })
// El actor sale de req: el superadmin (req.platformAdmin), un usuario (req.user) o 'system'.
export const audit = async (
  req,
  { action, targetType = null, targetId = null, detail = null, businessId, actorId, actorType },
) => {
  try {
    const type = actorType || (req?.platformAdmin ? 'platform' : req?.user ? 'user' : 'system');
    await AuditLog.create({
      actorType: type,
      actorId: actorId ?? req?.platformAdmin?.id ?? req?.user?.id ?? null,
      businessId: businessId ?? req?.user?.businessId ?? null,
      action,
      targetType,
      targetId: targetId === null || targetId === undefined ? null : String(targetId),
      detail,
      ip: req?.ip ? String(req.ip).slice(0, 64) : null,
    });
  } catch (error) {
    console.error('[audit] No se pudo registrar', action, error.message);
  }
};
