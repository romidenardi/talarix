import pkg from 'sequelize';
import { CustomerPayment, Customer, Payment } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';
import { readRange } from '../utils/dates.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { actorFields } from '../services/stock.service.js';
import { isNonNegative, toNumber, round2 } from '../utils/numbers.js';
import { customerBalances, customerStatement } from '../services/customerAccount.service.js';

const { Op } = pkg;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_DAYS = 366;
const MAX_AMOUNT = 999999999;

const paymentIncludes = [
  { model: Customer, attributes: ['id', 'businessName', 'firstName', 'lastName'] },
  { model: Payment, attributes: ['id', 'name'] },
];

const cleanText = (value, max) =>
  String(value ?? '')
    .trim()
    .slice(0, max) || null;

// Cobranzas a clientes (cuenta corriente): solo administrador y editor (se monta con requireRole en
// app.js). Es el espejo de controllers/supplierPayment.controller.js.

// Cobranzas de un período (?from&to; sin fechas, los últimos 30 días). ?customerId para uno solo.
export const getCustomerPayments = asyncHandler(async (req, res) => {
  const { start, end } = readRange(req.query);
  const where = { businessId: req.user.businessId, date: { [Op.gte]: start, [Op.lt]: end } };
  if (req.query.customerId) where.customerId = String(req.query.customerId);
  const payments = await CustomerPayment.findAll({ where, include: paymentIncludes, order: [['date', 'DESC']] });
  res.json(payments);
});

export const createCustomerPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const requestId = cleanRequestId(req.body.requestId);
  const sendExisting = async (id) => {
    const existing = await CustomerPayment.findOne({ where: { id, businessId }, include: paymentIncludes });
    res.status(200).json(existing);
  };
  if (requestId) {
    const previous = await CustomerPayment.findOne({ where: { businessId, requestId }, attributes: ['id'] });
    if (previous) return sendExisting(previous.id);
  }

  const customer = await Customer.findOne({ where: { id: String(req.body.customerId ?? ''), businessId } });
  if (!customer) throw httpError('Cliente no encontrado.', 404);

  if (!isNonNegative(req.body.amount) || toNumber(req.body.amount) <= 0 || toNumber(req.body.amount) > MAX_AMOUNT) {
    throw httpError('El importe tiene que ser un número mayor a 0.');
  }
  const amount = round2(toNumber(req.body.amount));

  // Forma de pago con la que pagó el cliente: obligatoria y del mismo comercio
  const payment = await Payment.findOne({ where: { id: String(req.body.paymentId ?? ''), businessId } });
  if (!payment) throw httpError('Elegí la forma de pago.');

  // Fecha: si viene, no puede ser futura ni de hace más de un año (igual que los pagos a proveedores)
  let date = new Date();
  if (req.body.date) {
    date = new Date(req.body.date);
    if (Number.isNaN(date.getTime())) throw httpError('La fecha no es válida.');
    if (date.getTime() > Date.now() + DAY_MS) throw httpError('La fecha de la cobranza no puede ser futura.');
    if (date.getTime() < Date.now() - MAX_AGE_DAYS * DAY_MS) {
      throw httpError('La fecha de la cobranza es de hace más de un año: revisala.');
    }
  }

  let created;
  try {
    created = await CustomerPayment.create({
      businessId,
      customerId: customer.id,
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
      const previous = await CustomerPayment.findOne({ where: { businessId, requestId }, attributes: ['id'] });
      if (previous) return sendExisting(previous.id);
    }
    throw error;
  }

  // Sin el nombre del cliente en el registro (puede ser una persona): solo el importe
  await audit(req, {
    action: 'customer_payment.created',
    targetType: 'customer_payment',
    targetId: created.id,
    detail: { amount },
  });
  const full = await CustomerPayment.findOne({ where: { id: created.id, businessId }, include: paymentIncludes });
  res.status(201).json(full);
});

// Anula una cobranza cargada por error: vuelve a sumar a la deuda. No se borra, queda marcada.
export const cancelCustomerPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const payment = await CustomerPayment.findOne({ where: { id: req.params.id, businessId } });
  if (!payment) throw httpError('Cobranza no encontrada.', 404);
  if (payment.status === 'cancelled') throw httpError('La cobranza ya está anulada.', 409);

  await payment.update({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelReason: cleanText(req.body?.reason, 255),
    cancelledById: req.user.id,
    cancelledByName: req.user.name ? String(req.user.name).slice(0, 100) : null,
  });
  await audit(req, {
    action: 'customer_payment.cancelled',
    targetType: 'customer_payment',
    targetId: payment.id,
    detail: { amount: Number(payment.amount) },
  });
  const full = await CustomerPayment.findOne({ where: { id: payment.id, businessId }, include: paymentIncludes });
  res.json(full);
});

// Saldo de cada cliente (pantalla Cuentas corrientes y columna Saldo de Clientes)
export const getCustomerBalances = asyncHandler(async (req, res) => {
  res.json(await customerBalances(req.user.businessId));
});

// Resumen de cuenta de un cliente en un período (?from&to; sin fechas, los últimos 30 días)
export const getCustomerStatement = asyncHandler(async (req, res) => {
  const { from, to, start, end } = readRange(req.query);
  const statement = await customerStatement(req.user.businessId, req.params.id, { start, end });
  res.json({ range: { from, to }, ...statement });
});
