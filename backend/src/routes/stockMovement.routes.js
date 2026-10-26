import { Router } from 'express';
import { getMovementsByProduct, createStockMovement } from '../controllers/stockMovement.controller.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.get('/product/:productId', getMovementsByProduct);
router.post('/', requireRole('admin', 'editor'), createStockMovement);

export default router;
