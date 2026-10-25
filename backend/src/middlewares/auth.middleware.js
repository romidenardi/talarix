import jwt from 'jsonwebtoken';
import pkg from 'sequelize';
import { User, Business } from '../models/index.js';

const { Op } = pkg;

const CLOSING_MESSAGE =
  'Esta cuenta está en proceso de baja. Solo se permite exportar los datos.';

const buildAuthMiddleware = ({ allowClosing }) => async (req, res, next) => {
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
      include: [{ model: Business, attributes: ['status', 'type'] }],
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

    req.user = {
      id: user.id,
      name: user.name,
      businessId: user.businessId,
      role: user.role,
      businessType: user.Business.type,
      businessStatus: status,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const authMiddleware = buildAuthMiddleware({ allowClosing: false });

export const authAllowClosing = buildAuthMiddleware({ allowClosing: true });
