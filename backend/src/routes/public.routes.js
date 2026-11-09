import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { createServiceRequest } from '../services/serviceRequest.service.js';

// Rutas públicas, sin sesión. app.js les pone un límite de pedidos por IP.
const router = Router();

// Botones de baja y de arrepentimiento: { kind, name, email, businessName?, reason? }
router.post(
  '/requests',
  asyncHandler(async (req, res) => {
    // Campo trampa: el formulario lo deja vacío y oculto; solo un robot lo completa
    if (req.body.website) throw httpError('Solicitud inválida.');
    res.status(201).json(await createServiceRequest(req.body, req));
  }),
);

export default router;
