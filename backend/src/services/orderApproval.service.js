import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { httpError } from '../utils/httpError.js';

// Autorización de descuentos y precios fuera de lista en remitos.
// El rol operador vende a precio de lista (o al precio promocional cargado en el producto) y sin
// descuentos. Si necesita otra cosa, un administrador o editor del comercio lo autoriza con su email
// y contraseña: el servidor devuelve un token corto que vale solo para ESE remito (su requestId), ESOS
// descuentos y ESOS precios. Si el operador cambia algo después, hace falta autorizar de nuevo.

export const APPROVER_ROLES = ['admin', 'editor'];
const SCOPE = 'order-approval';
const TTL = '10m';

const APPROVAL_MESSAGE =
  'Este remito tiene un descuento o un precio distinto al de lista: ' +
  'tiene que autorizarlo un administrador o editor.';

const samePrice = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// Precio que el operador puede usar sin pedir autorización
export const isListPrice = (product, unitPrice) =>
  samePrice(unitPrice, product.price) ||
  (product.promoPrice !== null && product.promoPrice !== undefined && samePrice(unitPrice, product.promoPrice));

// Lo que hay que autorizar: descuentos y renglones con precio distinto al de lista
export const approvalSummary = ({ rows, productMap, discountPercent, discountAmount }) => {
  const prices = [];
  for (const row of rows) {
    const product = productMap.get(row.productId);
    if (!product || isListPrice(product, row.unitPrice)) continue;
    if (!prices.some((p) => p.productId === row.productId && samePrice(p.unitPrice, row.unitPrice))) {
      prices.push({ productId: row.productId, unitPrice: Number(row.unitPrice) });
    }
  }
  return {
    discountPercent: Number(discountPercent) || 0,
    discountAmount: Number(discountAmount) || 0,
    prices,
    needed: prices.length > 0 || Number(discountPercent) > 0 || Number(discountAmount) > 0,
  };
};

export const signApproval = ({ approver, requesterId, businessId, requestId, summary }) =>
  jwt.sign(
    {
      scope: SCOPE,
      approverId: approver.id,
      requesterId,
      businessId,
      requestId,
      discountPercent: summary.discountPercent,
      discountAmount: summary.discountAmount,
      prices: summary.prices,
    },
    process.env.JWT_SECRET,
    { expiresIn: TTL },
  );

const approvalRequired = (message = APPROVAL_MESSAGE) => httpError(message, 403, 'APPROVAL_REQUIRED');

// Verifica que el token cubra exactamente este remito. Devuelve a quien autorizó.
export const checkApproval = async (token, { requesterId, businessId, requestId, summary }) => {
  if (!token || !requestId) throw approvalRequired();

  let data;
  try {
    data = jwt.verify(String(token), process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw approvalRequired('La autorización venció. Pedila de nuevo.');
  }

  const matches =
    data.scope === SCOPE &&
    data.businessId === businessId &&
    data.requesterId === requesterId &&
    data.requestId === requestId &&
    Math.abs(Number(data.discountPercent) - summary.discountPercent) < 0.0001 &&
    samePrice(data.discountAmount, summary.discountAmount) &&
    summary.prices.every((p) =>
      (data.prices || []).some((a) => a.productId === p.productId && samePrice(a.unitPrice, p.unitPrice)),
    );
  if (!matches) throw approvalRequired('El remito cambió después de la autorización. Pedila de nuevo.');

  // Quien autorizó tiene que seguir activo y con permiso
  const approver = await User.findOne({
    where: { id: data.approverId, businessId, active: true },
    attributes: ['id', 'name', 'email', 'role'],
  });
  if (!approver || !APPROVER_ROLES.includes(approver.role)) throw approvalRequired();
  return approver;
};
