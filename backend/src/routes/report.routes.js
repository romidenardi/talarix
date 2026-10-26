import { Router } from 'express';
import {
  salesSummary,
  salesByProduct,
  salesByCustomer,
  salesByPayment,
  vatReport,
  dashboard,
} from '../controllers/report.controller.js';

const router = Router();

router.get('/dashboard', dashboard);
router.get('/sales-summary', salesSummary);
router.get('/sales-by-product', salesByProduct);
router.get('/sales-by-customer', salesByCustomer);
router.get('/sales-by-payment', salesByPayment);
router.get('/vat', vatReport);

export default router;
