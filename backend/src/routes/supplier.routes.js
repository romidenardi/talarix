import { Router } from 'express';
import { body } from 'express-validator';
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../controllers/supplier.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [body('name').notEmpty().withMessage('El nombre es obligatorio')];

const updateRules = [
  body('name').optional().trim().notEmpty().withMessage('El nombre no puede quedar vacío'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('El email no es válido'),
  body('active').optional().isBoolean().withMessage('El estado no es válido'),
];

router.get('/', getSuppliers);
router.post('/', requireRole('admin', 'editor'), createRules, validate, createSupplier);
router.put('/:id', requireRole('admin', 'editor'), updateRules, validate, updateSupplier);
router.delete('/:id', requireRole('admin', 'editor'), deleteSupplier);

export default router;
