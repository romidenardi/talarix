import { Router } from 'express';
import { cancelOrder } from '../controllers/orderCancel.controller.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

// Solo administrador y editor pueden anular remitos
router.post('/:id/cancel', requireRole('admin', 'editor'), cancelOrder);

export default router;
