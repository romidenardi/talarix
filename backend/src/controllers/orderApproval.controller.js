import bcrypt from 'bcryptjs';
import { User, Product } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { cleanRequestId } from '../utils/requestId.js';
import { audit } from '../utils/audit.js';
import { isNonNegative, toNumber, toNumberOrZero, round2 } from '../utils/numbers.js';
import { APPROVER_ROLES, approvalSummary, signApproval } from '../services/orderApproval.service.js';

// POST /api/orders/approval
// El operador pide la autorización de un administrador o editor (email y contraseña de esa persona)
// para un remito con descuento o con precios distintos a los de lista.
// Body: { email, password, requestId, discountPercent, discountAmount, items: [{ productId, unitPrice }] }
export const approveOrder = asyncHandler(async (req, res) => {
  const { businessId, id: requesterId } = req.user;
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const requestId = cleanRequestId(req.body.requestId);

  if (!email || !password) throw httpError('Completá el email y la contraseña de quien autoriza');
  if (!requestId) throw httpError('Falta el identificador del remito. Recargá la página.');

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const rows = items
    .filter((item) => item && typeof item.productId === 'string' && isNonNegative(item.unitPrice))
    .map((item) => ({ productId: item.productId, unitPrice: round2(toNumber(item.unitPrice)) }));
  const products = await Product.findAll({
    where: { id: [...new Set(rows.map((r) => r.productId))], businessId },
    attributes: ['id', 'name', 'price', 'promoPrice'],
  });
  const summary = approvalSummary({
    rows,
    productMap: new Map(products.map((p) => [p.id, p])),
    discountPercent: toNumberOrZero(req.body.discountPercent),
    discountAmount: toNumberOrZero(req.body.discountAmount),
  });
  if (!summary.needed) throw httpError('Este remito no tiene nada que autorizar');

  const approver = await User.findOne({ where: { email, businessId } });
  const valid = approver
    && approver.active
    && approver.passwordHash
    && APPROVER_ROLES.includes(approver.role)
    && (await bcrypt.compare(password, approver.passwordHash));
  if (!valid) {
    await audit(req, { action: 'order.approval_failed' });
    throw httpError('El email o la contraseña no son correctos, o esa persona no puede autorizar (tiene que ser administrador o editor).', 403);
  }

  const approvalToken = signApproval({ approver, requesterId, businessId, requestId, summary });
  res.json({ approvalToken, approverName: approver.name });
});
