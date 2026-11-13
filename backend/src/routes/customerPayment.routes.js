import { Router } from 'express';
import {
  getCustomerPayments,
  createCustomerPayment,
  cancelCustomerPayment,
} from '../controllers/customerPayment.controller.js';

// Cobranzas a clientes: solo administrador y editor (se monta con requireRole en app.js)
const router = Router();

router.get('/', getCustomerPayments);
router.post('/', createCustomerPayment);
router.post('/:id/cancel', cancelCustomerPayment);

export default router;
