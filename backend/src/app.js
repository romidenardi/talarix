import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth.routes.js';
import platformRoutes from './routes/platform.routes.js';
import categoryRoutes from './routes/category.routes.js';
import productRoutes from './routes/product.routes.js';
import comboRoutes from './routes/combo.routes.js';
import scaleRoutes from './routes/scale.routes.js';
import stockMovementRoutes from './routes/stockMovement.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import customerRoutes from './routes/customer.routes.js';
import supplierRoutes from './routes/supplier.routes.js';
import purchaseRoutes from './routes/purchase.routes.js';
import orderRoutes from './routes/order.routes.js';
import orderCancelRoutes from './routes/orderCancel.routes.js';
import reportRoutes from './routes/report.routes.js';
import importRoutes from './routes/import.routes.js';
import userRoutes from './routes/user.routes.js';
import exportRoutes from './routes/export.routes.js';
import dataRightsRoutes from './routes/dataRights.routes.js';
import { authMiddleware, authAllowClosing } from './middlewares/auth.middleware.js';
import { requireRole } from './middlewares/role.middleware.js';
import { forbidInDemo } from './middlewares/demo.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { sequelize } from './models/index.js';

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());

// Estado del servidor, para Railway (Healthcheck Path) o un monitor externo. No pide token ni
// devuelve datos: solo si el servidor responde y llega a la base.
app.get('/health', async (req, res) => {
  try {
    await sequelize.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', message: 'Sin conexión con la base de datos' });
  }
});
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({ limit: '1mb' }));

// ---- Límites de intentos ----
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TOO_MANY = { message: 'Demasiados intentos. Probá de nuevo en unos minutos.' };
const emailKey = (prefix) => (req) =>
  `${prefix}:${String(req.body?.email || '')
    .trim()
    .toLowerCase()}`;

// Ingreso: solo cuentan los intentos fallidos (skipSuccessfulRequests). Por red (IP) el límite es
// amplio, para que un local con varios empleados detrás de la misma conexión no se bloquee; por
// cuenta es estricto, para frenar a quien prueba contraseñas desde muchas IP distintas.
const loginByIp = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});
const loginByAccount = (prefix) =>
  rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 5,
    skipSuccessfulRequests: true,
    keyGenerator: emailKey(prefix),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Demasiados intentos fallidos con esta cuenta. Probá de nuevo en 15 minutos o recuperá la contraseña.',
    },
  });
app.use('/api/auth/login', loginByIp, loginByAccount('login'));
// Superadmin. Paso 1 (contraseña): mismos límites que el ingreso de usuarios. app.post y no app.use,
// para que no alcance también a /login/mfa*, que tiene su propio límite.
app.post('/api/platform/login', loginByIp, loginByAccount('platform'));

// Paso 2 (código de 6 dígitos): 5 códigos fallidos cada 15 minutos por superadmin. La clave sale del
// token del paso 1 (sin verificarlo acá: lo verifica el controlador, y uno falso no prueba códigos).
const mfaKey = (req) => {
  const decoded = jwt.decode(String(req.body?.mfaToken || ''));
  return `platform-mfa:${decoded?.adminId || ipKeyGenerator(req.ip)}`;
};
const platformMfaLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: mfaKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados códigos incorrectos. Esperá 15 minutos y volvé a ingresar.' },
});
app.use('/api/platform/login/mfa', loginByIp, platformMfaLimiter);

// Activar cuenta, recuperar y restablecer contraseña: cuentan todos los pedidos (mandan mails o usan links)
const accountLinksLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});
app.use(['/api/auth/activate', '/api/auth/forgot-password', '/api/auth/reset-password'], accountLinksLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/platform', platformRoutes);

app.use('/api/categories', authMiddleware, categoryRoutes);
app.use('/api/products', authMiddleware, productRoutes);
app.use('/api/combos', authMiddleware, comboRoutes);
app.use('/api/scale-config', authMiddleware, scaleRoutes);
app.use('/api/stock-movements', authMiddleware, stockMovementRoutes);
app.use('/api/payments', authMiddleware, paymentRoutes);
app.use('/api/customers', authMiddleware, customerRoutes);
app.use('/api/suppliers', authMiddleware, supplierRoutes);
app.use('/api/purchases', authMiddleware, purchaseRoutes);
app.use('/api/orders', authMiddleware, orderCancelRoutes, orderRoutes);
app.use('/api/reports', authMiddleware, requireRole('admin', 'editor'), reportRoutes);
app.use('/api/imports', authMiddleware, forbidInDemo, importRoutes);
app.use('/api/users', authMiddleware, forbidInDemo, requireRole('admin'), userRoutes);

app.use('/api/export', authAllowClosing, exportRoutes);
app.use('/api/data-rights', authMiddleware, forbidInDemo, dataRightsRoutes);

app.use(errorMiddleware);

export default app;
