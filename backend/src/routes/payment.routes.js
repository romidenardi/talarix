import { Router } from 'express';
import { body } from 'express-validator';
import { getPayments, createPayment, updatePayment, deletePayment } from '../controllers/payment.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [body('name').notEmpty().withMessage('El nombre es obligatorio')];

router.get('/', getPayments);
router.post('/', requireRole('admin', 'editor'), createRules, validate, createPayment);
router.put('/:id', requireRole('admin', 'editor'), updatePayment);
router.delete('/:id', requireRole('admin', 'editor'), deletePayment);

export default router;
