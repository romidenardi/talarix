import { Router } from 'express';
import { body } from 'express-validator';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '../controllers/customer.controller.js';
import { getCustomerBalances, getCustomerStatement } from '../controllers/customerPayment.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [
  body('fiscalCondition').notEmpty().withMessage('La condición fiscal es obligatoria.'),
  body().custom((_, { req }) => {
    if (!req.body.businessName && !req.body.firstName) {
      throw new Error('Debés completar razón social o nombre y apellido.');
    }
    return true;
  }),
];

const updateRules = [
  body('fiscalCondition').optional().trim().notEmpty().withMessage('La condición fiscal no puede quedar vacía.'),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('El email no es válido.'),
  body('openingBalance')
    .optional({ values: 'null' })
    .isFloat({ min: -999999999, max: 999999999 })
    .withMessage('El saldo inicial tiene que ser un número.'),
  body().custom((_, { req }) => {
    const touchesName = 'businessName' in req.body || 'firstName' in req.body;
    if (touchesName && !req.body.businessName && !req.body.firstName) {
      throw new Error('Debés completar razón social o nombre y apellido.');
    }
    return true;
  }),
];

router.get('/', getCustomers);
// Cuenta corriente: saldo de cada cliente y resumen de uno
router.get('/balances', requireRole('admin', 'editor'), getCustomerBalances);
router.get('/:id/account', requireRole('admin', 'editor'), getCustomerStatement);
router.post('/', requireRole('admin', 'editor'), createRules, validate, createCustomer);
router.put('/:id', requireRole('admin', 'editor'), updateRules, validate, updateCustomer);
router.delete('/:id', requireRole('admin', 'editor'), deleteCustomer);

export default router;
