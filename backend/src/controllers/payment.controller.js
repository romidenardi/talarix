import { Payment, InstallmentPlan, Order, sequelize } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { pick } from '../utils/pick.js';
import { isPositiveInt, toNumber, toNumberOrZero } from '../utils/numbers.js';

const planInclude = [{ model: InstallmentPlan, as: 'installmentPlans', where: { active: true }, required: false }];

const planKey = (installments, rate) => `${installments}|${Number(rate).toFixed(2)}`;

const normalizePlans = (plans) => {
  const unique = new Map();
  for (const plan of plans) {
    if (!plan || !plan.installments) continue;
    if (!isPositiveInt(plan.installments)) {
      throw httpError('La cantidad de cuotas debe ser un entero mayor a 0');
    }
    const installments = toNumber(plan.installments);
    const interestRate = toNumberOrZero(plan.interestRate);
    if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 999.99) {
      throw httpError('El interés no es válido');
    }
    unique.set(planKey(installments, interestRate), { installments, interestRate });
  }
  return [...unique.values()];
};

const syncPlans = async (paymentId, incoming, t) => {
  const existing = await InstallmentPlan.findAll({ where: { paymentId }, transaction: t });
  const wanted = new Map(incoming.map((p) => [planKey(p.installments, p.interestRate), p]));

  for (const plan of existing) {
    const key = planKey(plan.installments, plan.interestRate);
    if (wanted.has(key)) {
      if (!plan.active) await plan.update({ active: true }, { transaction: t });
      wanted.delete(key);
      continue;
    }
    const used = await Order.count({ where: { installmentPlanId: plan.id }, transaction: t });
    if (used > 0) {
      if (plan.active) await plan.update({ active: false }, { transaction: t });
    } else {
      await plan.destroy({ transaction: t });
    }
  }

  for (const plan of wanted.values()) {
    await InstallmentPlan.create({ paymentId, ...plan }, { transaction: t });
  }
};

export const getPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.findAll({
    where: { businessId: req.user.businessId },
    include: planInclude,
    order: [['name', 'ASC']],
  });
  res.json(payments);
});

export const createPayment = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError('El nombre es obligatorio');

  const plans = Array.isArray(req.body.installmentPlans) ? normalizePlans(req.body.installmentPlans) : [];

  const t = await sequelize.transaction();
  let paymentId;
  try {
    const payment = await Payment.create({ name, businessId: req.user.businessId }, { transaction: t });
    paymentId = payment.id;
    await syncPlans(payment.id, plans, t);
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  const fullPayment = await Payment.findByPk(paymentId, { include: planInclude });
  res.status(201).json(fullPayment);
});

export const updatePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payment = await Payment.findOne({ where: { id, businessId: req.user.businessId } });
  if (!payment) throw httpError('Forma de pago no encontrada', 404);

  const plans = Array.isArray(req.body.installmentPlans) ? normalizePlans(req.body.installmentPlans) : null;

  const t = await sequelize.transaction();
  try {
    await payment.update(pick(req.body, ['name', 'active']), { transaction: t });
    if (plans) await syncPlans(payment.id, plans, t);
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  const fullPayment = await Payment.findByPk(payment.id, { include: planInclude });
  res.json(fullPayment);
});

export const deletePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { businessId } = req.user;

  const payment = await Payment.findOne({ where: { id, businessId } });
  if (!payment) throw httpError('Forma de pago no encontrada', 404);

  const usedInOrders = await Order.count({ where: { paymentId: id, businessId } });
  if (usedInOrders > 0) {
    throw httpError('Esta forma de pago se usó en remitos ya creados y no se puede eliminar.', 409);
  }

  await InstallmentPlan.destroy({ where: { paymentId: id } });
  await payment.destroy();
  res.status(204).send();
});
