import { Router } from 'express';
import {
  login,
  activateAccount,
  forgotPassword,
  resetPassword,
  getTermsStatus,
  acceptTerms,
} from '../controllers/auth.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/login', login);
router.post('/activate', activateAccount);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Con sesión: estado y aceptación de la versión vigente de los textos legales
router.get('/terms', authMiddleware, getTermsStatus);
router.post('/terms', authMiddleware, acceptTerms);

export default router;
