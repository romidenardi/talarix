import { Router } from 'express';
import { body } from 'express-validator';
import { getPurchases, createPurchase, cancelPurchase } from '../controllers/purchase.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [
  body('supplierId').notEmpty().withMessage('El proveedor es obligatorio.'),
  // Al menos un artículo o un servicio: lo controla createPurchase
  body('items').optional().isArray().withMessage('Los artículos no son válidos.'),
  body('expenses').optional().isArray().withMessage('Los servicios no son válidos.'),
];

router.get('/', getPurchases);
router.post('/', requireRole('admin', 'editor', 'operador'), createRules, validate, createPurchase);
router.post('/:id/cancel', requireRole('admin', 'editor'), cancelPurchase);

export default router;
