import { Router } from 'express';
import {
  getSupplierPayments,
  createSupplierPayment,
  cancelSupplierPayment,
} from '../controllers/supplierPayment.controller.js';

// Pagos a proveedores: solo administrador y editor (se monta con requireRole en app.js)
const router = Router();

router.get('/', getSupplierPayments);
router.post('/', createSupplierPayment);
router.post('/:id/cancel', cancelSupplierPayment);

export default router;
