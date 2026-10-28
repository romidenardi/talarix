import jwt from 'jsonwebtoken';
import pkg from 'sequelize';
import { User, Business } from '../models/index.js';

const { Op } = pkg;

const CLOSING_MESSAGE = 'Esta cuenta está en proceso de baja. Solo se permite exportar los datos.';

// El mozo solo usa Mesas: la API de mesas (cada ruta revisa además su rol) y la lista de productos
// y categorías para elegir los platos. Todo lo demás le responde 403.
const MOZO_ALLOWED = [
  { method: 'GET', prefix: '/api/products' },
  { method: 'GET', prefix: '/api/categories' },
  { method: '*', prefix: '/api/tables' },
];
export const mozoCanUse = (method, url) => {
  const path = String(url || '').split('?')[0];
  return MOZO_ALLOWED.some(
    (rule) =>
      (rule.method === '*' || rule.method === method) && (path === rule.prefix || path.startsWith(`${rule.prefix}/`)),
  );
};

const buildAuthMiddleware =
  ({ allowClosing }) =>
  async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token no proporcionado' });
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ message: 'Token inválido o expirado' });
    }

    if (!decoded.id || !decoded.businessId) {
      return res.status(401).json({ message: 'Token inválido' });
    }

    try {
      const user = await User.findOne({
        where: {
          id: decoded.id,
          businessId: decoded.businessId,
          active: true,
          passwordHash: { [Op.ne]: null },
        },
        attributes: ['id', 'businessId', 'role', 'tokenVersion', 'name'],
        include: [{ model: Business, attributes: ['status', 'type', 'tablesEnabled'] }],
      });

      if (!user) {
        return res.status(401).json({ message: 'Sesión inválida' });
      }

      // La contraseña cambió después de emitir este token: hay que volver a ingresar
      if ((decoded.tv ?? 0) !== user.tokenVersion) {
        return res.status(401).json({ message: 'Tu sesión se cerró porque cambió la contraseña. Ingresá de nuevo.' });
      }

      const status = user.Business.status;

      if (status === 'closing') {
        if (!allowClosing || user.role !== 'admin') {
          return res.status(403).json({ message: CLOSING_MESSAGE, code: 'ACCOUNT_CLOSING' });
        }
      } else if (status !== 'active') {
        return res.status(401).json({ message: 'Sesión inválida' });
      }

      if (user.role === 'mozo' && !mozoCanUse(req.method, req.originalUrl)) {
        return res.status(403).json({ message: 'No tenés permisos para realizar esta acción' });
      }

      req.user = {
        id: user.id,
        name: user.name,
        businessId: user.businessId,
        role: user.role,
        businessType: user.Business.type,
        businessStatus: status,
        tablesEnabled: Boolean(user.Business.tablesEnabled),
      };
      next();
    } catch (error) {
      next(error);
    }
  };

export const authMiddleware = buildAuthMiddleware({ allowClosing: false });

export const authAllowClosing = buildAuthMiddleware({ allowClosing: true });
