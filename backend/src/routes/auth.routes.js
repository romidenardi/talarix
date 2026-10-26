import { Router } from 'express';
import { login, activateAccount, forgotPassword, resetPassword } from '../controllers/auth.controller.js';

const router = Router();

router.post('/login', login);
router.post('/activate', activateAccount);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
