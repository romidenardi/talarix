import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireRole } from '../middlewares/role.middleware.js';
import { forbidInDemo } from '../middlewares/demo.middleware.js';
import { exportBusinessData, exportStatus } from '../controllers/export.controller.js';

const router = Router();

const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Hiciste varias exportaciones seguidas. Probá de nuevo en unos minutos.' },
});

router.use(requireRole('admin'));
router.get('/status', exportStatus);
router.get('/', forbidInDemo, exportLimiter, exportBusinessData);

export default router;
