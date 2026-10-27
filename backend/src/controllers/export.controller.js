import { Business } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { buildBusinessExport } from '../services/export.service.js';
import { audit } from '../utils/audit.js';
import { createGate } from '../utils/gate.js';

// El Excel se arma entero en memoria: como mucho dos a la vez en el servidor y una por comercio
const exportGate = createGate({ max: 2, perKey: 1 });

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const exportStatus = asyncHandler(async (req, res) => {
  const business = await Business.findByPk(req.user.businessId, {
    attributes: ['name', 'status', 'deleteAt'],
  });
  if (!business) throw httpError('Comercio no encontrado', 404);

  res.json({
    name: business.name,
    status: business.status,
    deleteAt: business.status === 'closing' ? business.deleteAt : null,
  });
});

export const exportBusinessData = asyncHandler(async (req, res) => {
  const release = exportGate.tryEnter(req.user.businessId);
  if (!release) throw httpError('Ya hay una exportación en curso. Probá de nuevo en un minuto.', 429);
  let result;
  try {
    result = await buildBusinessExport(req.user.businessId);
  } finally {
    release();
  }
  const { buffer, filename } = result;

  console.log(`[export] comercio ${req.user.businessId} · usuario ${req.user.id}`);
  await audit(req, { action: 'business.exported', targetType: 'business', targetId: req.user.businessId });

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(buffer);
});
