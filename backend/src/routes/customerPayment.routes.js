import { Router } from 'express';
import {
  getCustomerPayments,
  createCustomerPayment,
  cancelCustomerPayment,
  getLateFeeConfig,
  updateLateFeeConfig,
} from '../controllers/customerPayment.controller.js';

// Cobranzas a clientes: solo administrador y editor (se monta con requireRole en app.js)
const router = Router();

router.get('/', getCustomerPayments);
// Recargo por mora del comercio (% mensual y días de gracia)
router.get('/late-fee', getLateFeeConfig);
router.put('/late-fee', updateLateFeeConfig);
router.post('/', createCustomerPayment);
router.post('/:id/cancel', cancelCustomerPayment);

export default router;
