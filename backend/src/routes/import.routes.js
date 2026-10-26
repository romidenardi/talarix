import { Router } from 'express';
import { upload } from '../config/multer.js';
import { importProducts, importCustomers, importSuppliers } from '../controllers/import.controller.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.post('/products', requireRole('admin', 'editor'), upload.single('file'), importProducts);
router.post('/customers', requireRole('admin', 'editor'), upload.single('file'), importCustomers);
router.post('/suppliers', requireRole('admin', 'editor'), upload.single('file'), importSuppliers);

export default router;
