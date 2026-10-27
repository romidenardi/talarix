import { Router } from 'express';
import {
  platformLogin,
  platformLoginMfa,
  platformMfaSetup,
  platformMfaEnable,
  listAuditLog,
  listBusinesses,
  createBusiness,
  setBusinessStatus,
  setBusinessTrial,
  startClosure,
  cancelClosure,
  reinviteUser,
  resetDemo,
} from '../controllers/platform.controller.js';
import { platformAuthMiddleware } from '../middlewares/platformAuth.middleware.js';

const router = Router();

// Ingreso en dos pasos (ver platform.controller.js). Estas rutas no exigen sesión.
router.post('/login', platformLogin);
router.post('/login/mfa', platformLoginMfa);
router.post('/login/mfa/setup', platformMfaSetup);
router.post('/login/mfa/enable', platformMfaEnable);

router.use(platformAuthMiddleware);
router.get('/audit', listAuditLog);
router.get('/businesses', listBusinesses);
router.post('/businesses', createBusiness);
router.patch('/businesses/:id/status', setBusinessStatus);
router.patch('/businesses/:id/trial', setBusinessTrial);
router.post('/businesses/:id/closure', startClosure);
router.delete('/businesses/:id/closure', cancelClosure);
router.post('/businesses/:id/reinvite', reinviteUser);
router.post('/businesses/:id/reset-demo', resetDemo);

export default router;
