import pkg from 'sequelize';
import { SupplierPayment, Supplier, Payment } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';
import { readRange } from '../utils/dates.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { actorFields } from '../services/stock.service.js';
import { isNonNegative, toNumber, round2 } from '../utils/numbers.js';
import { supplierBalances, supplierStatement } from '../services/supplierAccount.service.js';

const { Op } = pkg;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_DAYS = 366;
const MAX_AMOUNT = 999999999;

const paymentIncludes = [
  { model: Supplier, attributes: ['id', 'name'] },
  { model: Payment, attributes: ['id', 'name'] },
];

const cleanText = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max) || null;

// Pagos de un período (?from&to; sin fechas, los últimos 30 días). ?supplierId para uno solo.
export const getSupplierPayments = asyncHandler(async (req, res) => {
  const { start, end } = readRange(req.query);
  const where = { businessId: req.user.businessId, date: { [Op.gte]: start, [Op.lt]: end } };
  if (req.query.supplierId) where.supplierId = String(req.query.supplierId);
  const payments = await SupplierPayment.findAll({ where, include: paymentIncludes, order: [['date', 'DESC']] });
  res.json(payments);
});

export const createSupplierPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const requestId = cleanRequestId(req.body.requestId);
  const sendExisting = async (id) => {
    const existing = await SupplierPayment.findOne({ where: { id, businessId }, include: paymentIncludes });
    res.status(200).json(existing);
  };
  if (requestId) {
    const previous = await SupplierPayment.findOne({ where: { businessId, requestId }, attributes: ['id'] });
    if (previous) return sendExisting(previous.id);
  }

  const supplier = await Supplier.findOne({ where: { id: String(req.body.supplierId ?? ''), businessId } });
  if (!supplier) throw httpError('Proveedor no encontrado.', 404);

  if (!isNonNegative(req.body.amount) || toNumber(req.body.amount) <= 0 || toNumber(req.body.amount) > MAX_AMOUNT) {
    throw httpError('El importe tiene que ser un número mayor a 0.');
  }
  const amount = round2(toNumber(req.body.amount));

  // Forma de pago: obligatoria y del mismo comercio
  const payment = await Payment.findOne({ where: { id: String(req.body.paymentId ?? ''), businessId } });
  if (!payment) throw httpError('Elegí la forma de pago.');

  // Fecha: si viene, no puede ser futura ni de hace más de un año (igual que las compras)
  let date = new Date();
  if (req.body.date) {
    date = new Date(req.body.date);
    if (Number.isNaN(date.getTime())) throw httpError('La fecha no es válida.');
    if (date.getTime() > Date.now() + DAY_MS) throw httpError('La fecha del pago no puede ser futura.');
    if (date.getTime() < Date.now() - MAX_AGE_DAYS * DAY_MS) {
      throw httpError('La fecha del pago es de hace más de un año: revisala.');
    }
  }

  let created;
  try {
    created = await SupplierPayment.create({
      businessId,
      supplierId: supplier.id,
      paymentId: payment.id,
      date,
      amount,
      reference: cleanText(req.body.reference, 100),
      notes: cleanText(req.body.notes, 255),
      requestId,
      ...actorFields(req.user),
    });
  } catch (error) {
    // Dos envíos iguales al mismo tiempo: el otro ya lo creó
    if (requestId && isDuplicateRequest(error)) {
      const previous = await SupplierPayment.findOne({ where: { businessId, requestId }, attributes: ['id'] });
      if (previous) return sendExisting(previous.id);
    }
    throw error;
  }

  await audit(req, {
    action: 'supplier_payment.created',
    targetType: 'supplier_payment',
    targetId: created.id,
    detail: { supplier: supplier.name, amount },
  });
  const full = await SupplierPayment.findOne({ where: { id: created.id, businessId }, include: paymentIncludes });
  res.status(201).json(full);
});

// Anula un pago cargado por error: vuelve a sumar a la deuda. No se borra, queda marcado.
export const cancelSupplierPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const payment = await SupplierPayment.findOne({ where: { id: req.params.id, businessId } });
  if (!payment) throw httpError('Pago no encontrado.', 404);
  if (payment.status === 'cancelled') throw httpError('El pago ya está anulado.', 409);

  await payment.update({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelReason: cleanText(req.body?.reason, 255),
    cancelledById: req.user.id,
    cancelledByName: req.user.name ? String(req.user.name).slice(0, 100) : null,
  });
  await audit(req, {
    action: 'supplier_payment.cancelled',
    targetType: 'supplier_payment',
    targetId: payment.id,
    detail: { amount: Number(payment.amount) },
  });
  const full = await SupplierPayment.findOne({ where: { id: payment.id, businessId }, include: paymentIncludes });
  res.json(full);
});

// Saldo de cada proveedor (pantalla Cuentas corrientes)
export const getSupplierBalances = asyncHandler(async (req, res) => {
  res.json(await supplierBalances(req.user.businessId));
});

// Resumen de cuenta de un proveedor en un período (?from&to; sin fechas, los últimos 30 días)
export const getSupplierStatement = asyncHandler(async (req, res) => {
  const { from, to, start, end } = readRange(req.query);
  const statement = await supplierStatement(req.user.businessId, req.params.id, { start, end });
  res.json({ range: { from, to }, ...statement });
});
