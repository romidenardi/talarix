import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getUsers, createUser, updateUser, deleteUser, sendAccessLink } from '../controllers/user.controller.js';

const router = Router();

// Crear usuarios y mandar links envía mails con el remitente de Talarix: tope diario por comercio
const mailLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `mail:${req.user.businessId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Llegaste al máximo de usuarios nuevos y links enviados por hoy. Probá de nuevo mañana.' },
});

router.get('/', getUsers);
router.post('/', mailLimiter, createUser);
router.post('/:id/send-link', mailLimiter, sendAccessLink);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
