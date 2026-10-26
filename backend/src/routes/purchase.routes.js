import { Router } from 'express';
import { body } from 'express-validator';
import { getPurchases, createPurchase, cancelPurchase } from '../controllers/purchase.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [
  body('supplierId').notEmpty().withMessage('El proveedor es obligatorio'),
  body('items').isArray({ min: 1 }).withMessage('Debe incluir al menos un artículo'),
];

router.get('/', getPurchases);
router.post('/', requireRole('admin', 'editor', 'operador'), createRules, validate, createPurchase);
// Solo administrador y editor anulan compras (igual que los remitos)
router.post('/:id/cancel', requireRole('admin', 'editor'), cancelPurchase);

export default router;
