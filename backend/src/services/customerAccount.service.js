import pkg from 'sequelize';
import { Customer, Order, CustomerPayment, Payment } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round2 } from '../utils/numbers.js';
import { formatOrderNumber } from './orderNumber.service.js';

const { Op, fn, col } = pkg;

// Cuenta corriente de clientes (el espejo de services/supplierAccount.service.js). El saldo de un
// cliente es:
//   saldo inicial + remitos activos a cuenta corriente − cobranzas activas
// Positivo: el cliente debe; negativo: tiene saldo a favor. Las cobranzas se aplican a la deuda
// total, no a un remito. Anular un remito o una cobranza la saca de la cuenta.

const ACCOUNT_ORDER = { status: 'active', paymentCondition: 'account' };

export const customerName = (c) =>
  c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Cliente sin nombre';

// Suma por cliente: { [customerId]: { sum, last } }
const sumByCustomer = async (Model, field, where) => {
  const rows = await Model.findAll({
    where,
    attributes: [
      [col('customer_id'), 'customerId'],
      [fn('SUM', col(field)), 'sum'],
      [fn('MAX', col('date')), 'last'],
    ],
    group: [col('customer_id')],
    raw: true,
  });
  return new Map(rows.map((r) => [r.customerId, { sum: Number(r.sum) || 0, last: r.last ? new Date(r.last) : null }]));
};

// Saldo de todos los clientes del comercio
export const customerBalances = async (businessId) => {
  const [customers, orders, payments] = await Promise.all([
    Customer.findAll({
      where: { businessId },
      attributes: ['id', 'businessName', 'firstName', 'lastName', 'cuit', 'openingBalance', 'anonymizedAt'],
    }),
    sumByCustomer(Order, 'total', { businessId, ...ACCOUNT_ORDER }),
    sumByCustomer(CustomerPayment, 'amount', { businessId, status: 'active' }),
  ]);

  return customers
    .map((customer) => {
      const sold = orders.get(customer.id);
      const paid = payments.get(customer.id);
      const opening = Number(customer.openingBalance) || 0;
      const dates = [sold?.last, paid?.last].filter(Boolean);
      return {
        customerId: customer.id,
        name: customerName(customer),
        cuit: customer.cuit,
        anonymized: Boolean(customer.anonymizedAt),
        openingBalance: round2(opening),
        sales: round2(sold?.sum || 0),
        payments: round2(paid?.sum || 0),
        balance: round2(opening + (sold?.sum || 0) - (paid?.sum || 0)),
        lastMovementAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

// Saldo de un cliente (para avisar antes de anonimizarlo, por ejemplo)
export const customerBalance = async (businessId, customerId) => {
  const customer = await Customer.findOne({ where: { id: customerId, businessId } });
  if (!customer) throw httpError('Cliente no encontrado.', 404);
  const [sold, paid] = await Promise.all([
    Order.sum('total', { where: { businessId, customerId, ...ACCOUNT_ORDER } }),
    CustomerPayment.sum('amount', { where: { businessId, customerId, status: 'active' } }),
  ]);
  return round2((Number(customer.openingBalance) || 0) + (Number(sold) || 0) - (Number(paid) || 0));
};

// Resumen de cuenta de un cliente en un período: saldo anterior, movimientos con saldo acumulado y
// saldo final. start/end: Date (end excluido), como readRange.
export const customerStatement = async (businessId, customerId, { start, end }) => {
  const customer = await Customer.findOne({ where: { id: customerId, businessId } });
  if (!customer) throw httpError('Cliente no encontrado.', 404);

  const before = { [Op.lt]: start };
  const inRange = { [Op.gte]: start, [Op.lt]: end };
  const [soldBefore, paidBefore, orders, payments] = await Promise.all([
    Order.sum('total', { where: { businessId, customerId, ...ACCOUNT_ORDER, date: before } }),
    CustomerPayment.sum('amount', { where: { businessId, customerId, status: 'active', date: before } }),
    Order.findAll({
      where: { businessId, customerId, ...ACCOUNT_ORDER, date: inRange },
      attributes: ['id', 'date', 'number', 'total', 'createdAt'],
    }),
    CustomerPayment.findAll({
      where: { businessId, customerId, status: 'active', date: inRange },
      attributes: ['id', 'date', 'amount', 'reference', 'notes', 'createdAt'],
      include: [{ model: Payment, attributes: ['id', 'name'] }],
    }),
  ]);

  const previousBalance = round2(
    (Number(customer.openingBalance) || 0) + (Number(soldBefore) || 0) - (Number(paidBefore) || 0),
  );

  const movements = [
    ...orders.map((o) => ({
      type: 'order',
      id: o.id,
      date: o.date,
      createdAt: o.createdAt,
      description: `Remito ${formatOrderNumber(o)}`,
      debit: round2(Number(o.total)),
      credit: 0,
    })),
    ...payments.map((p) => ({
      type: 'payment',
      id: p.id,
      date: p.date,
      createdAt: p.createdAt,
      description: ['Cobranza', p.Payment?.name, p.reference && `ref. ${p.reference}`].filter(Boolean).join(' · '),
      notes: p.notes || null,
      debit: 0,
      credit: round2(Number(p.amount)),
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date) || new Date(a.createdAt) - new Date(b.createdAt));

  let balance = previousBalance;
  for (const movement of movements) {
    balance = round2(balance + movement.debit - movement.credit);
    movement.balance = balance;
    delete movement.createdAt;
  }

  return {
    customer: {
      id: customer.id,
      name: customerName(customer),
      cuit: customer.cuit,
      address: customer.address,
      city: customer.city,
      openingBalance: Number(customer.openingBalance),
    },
    previousBalance,
    movements,
    totals: {
      debit: round2(movements.reduce((sum, m) => sum + m.debit, 0)),
      credit: round2(movements.reduce((sum, m) => sum + m.credit, 0)),
    },
    balance,
  };
};
