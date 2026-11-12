import pkg from 'sequelize';
import { Supplier, Purchase, SupplierPayment, Payment } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round2 } from '../utils/numbers.js';

const { Op, fn, col } = pkg;

// Cuenta corriente con proveedores. El saldo de un proveedor es:
//   saldo inicial + compras a cuenta corriente − pagos
// contando solo las compras y los pagos activos (los anulados no cuentan). Positivo: se le debe;
// negativo: saldo a favor. Los pagos se aplican a la deuda total, no a una factura.

const ACCOUNT_PURCHASE = { status: 'active', paymentCondition: 'account' };

// Suma por proveedor: { [supplierId]: importe }
const sumBySupplier = async (Model, field, where) => {
  const rows = await Model.findAll({
    where,
    attributes: [
      [col('supplier_id'), 'supplierId'],
      [fn('SUM', col(field)), 'sum'],
      [fn('MAX', col('date')), 'last'],
    ],
    group: [col('supplier_id')],
    raw: true,
  });
  return new Map(rows.map((r) => [r.supplierId, { sum: Number(r.sum) || 0, last: r.last ? new Date(r.last) : null }]));
};

// Saldo de todos los proveedores del comercio
export const supplierBalances = async (businessId) => {
  const [suppliers, purchases, payments] = await Promise.all([
    Supplier.findAll({
      where: { businessId },
      attributes: ['id', 'name', 'cuit', 'active', 'openingBalance'],
      order: [['name', 'ASC']],
    }),
    sumBySupplier(Purchase, 'total', { businessId, ...ACCOUNT_PURCHASE }),
    sumBySupplier(SupplierPayment, 'amount', { businessId, status: 'active' }),
  ]);

  return suppliers.map((supplier) => {
    const bought = purchases.get(supplier.id);
    const paid = payments.get(supplier.id);
    const opening = Number(supplier.openingBalance) || 0;
    const dates = [bought?.last, paid?.last].filter(Boolean);
    return {
      supplierId: supplier.id,
      name: supplier.name,
      cuit: supplier.cuit,
      active: supplier.active,
      openingBalance: round2(opening),
      purchases: round2(bought?.sum || 0),
      payments: round2(paid?.sum || 0),
      balance: round2(opening + (bought?.sum || 0) - (paid?.sum || 0)),
      lastMovementAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
    };
  });
};

// Resumen de cuenta de un proveedor en un período: saldo anterior, movimientos con saldo acumulado
// y saldo final. start/end: Date (end excluido), como readRange.
export const supplierStatement = async (businessId, supplierId, { start, end }) => {
  const supplier = await Supplier.findOne({ where: { id: supplierId, businessId } });
  if (!supplier) throw httpError('Proveedor no encontrado.', 404);

  const before = { [Op.lt]: start };
  const inRange = { [Op.gte]: start, [Op.lt]: end };
  const [boughtBefore, paidBefore, purchases, payments] = await Promise.all([
    Purchase.sum('total', { where: { businessId, supplierId, ...ACCOUNT_PURCHASE, date: before } }),
    SupplierPayment.sum('amount', { where: { businessId, supplierId, status: 'active', date: before } }),
    Purchase.findAll({
      where: { businessId, supplierId, ...ACCOUNT_PURCHASE, date: inRange },
      attributes: ['id', 'date', 'invoiceNumber', 'total', 'createdAt'],
    }),
    SupplierPayment.findAll({
      where: { businessId, supplierId, status: 'active', date: inRange },
      attributes: ['id', 'date', 'amount', 'reference', 'notes', 'createdAt'],
      include: [{ model: Payment, attributes: ['id', 'name'] }],
    }),
  ]);

  const previousBalance = round2(
    (Number(supplier.openingBalance) || 0) + (Number(boughtBefore) || 0) - (Number(paidBefore) || 0),
  );

  const movements = [
    ...purchases.map((p) => ({
      type: 'purchase',
      id: p.id,
      date: p.date,
      createdAt: p.createdAt,
      description: p.invoiceNumber ? `Compra, factura ${p.invoiceNumber}` : 'Compra',
      debit: round2(Number(p.total)),
      credit: 0,
    })),
    ...payments.map((p) => ({
      type: 'payment',
      id: p.id,
      date: p.date,
      createdAt: p.createdAt,
      description: ['Pago', p.Payment?.name, p.reference && `ref. ${p.reference}`].filter(Boolean).join(' · '),
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
    supplier: {
      id: supplier.id,
      name: supplier.name,
      cuit: supplier.cuit,
      openingBalance: Number(supplier.openingBalance),
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
