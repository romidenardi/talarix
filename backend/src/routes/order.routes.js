import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { getOrders, getOrder, createOrder } from '../controllers/order.controller.js';
import { approveOrder } from '../controllers/orderApproval.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [
  body('customerId').notEmpty().withMessage('El cliente es obligatorio'),
  body('paymentId').notEmpty().withMessage('La forma de pago es obligatoria'),
  body('items').isArray({ min: 1 }).withMessage('Debés incluir al menos un artículo'),
];

// Autorización de descuentos: 5 intentos fallidos cada 15 minutos por operador, para que no se
// puedan probar contraseñas de los administradores desde la pantalla de remitos.
const approvalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `order-approval:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de autorización. Esperá 15 minutos y probá de nuevo.' },
});

router.get('/', getOrders);
router.post('/approval', requireRole('operador'), approvalLimiter, approveOrder);
router.get('/:id', getOrder);
router.post('/', requireRole('admin', 'editor', 'operador'), createRules, validate, createOrder);

export default router;
