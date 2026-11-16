import pkg from 'sequelize';
import { CustomerInstallment, Customer, Order } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round2, toNumber } from '../utils/numbers.js';
import { dayKey } from '../utils/dates.js';
import { formatOrderNumber } from './orderNumber.service.js';
import { dueDates, splitAmount, daysLate } from '../utils/accountInstallments.js';

export { dueDates, splitAmount, daysLate };

const { Op } = pkg;

// Cuotas de la cuenta corriente de clientes.
//   - Un remito a cuenta corriente lleva cantidad de cuotas (1 o más), interés opcional (un % total
//     sobre el remito) y el día del mes en que vencen.
//   - La primera cuota vence el próximo día elegido posterior a la venta (vendido el 10/11 con día
//     20: vence el 20/11; vendido el 25/11: el 20/12). Las demás, un mes después de la anterior. Si
//     el mes no tiene ese día (31 en abril), vence el último día del mes.
//   - Las cuotas son iguales; los centavos que sobran van a la última.
//   - Una cobranza paga cuotas completas. Anularla las deja impagas otra vez.
//   - El saldo inicial positivo del cliente es una cuota más, sin remito, que vence el día que se carga.

export const MAX_INSTALLMENTS = 60;

// Lee las condiciones de la cuenta corriente del remito: { installments, interestRate, dueDay }
export const readAccountTerms = (body) => {
  const installments =
    body.accountInstallments === undefined || body.accountInstallments === '' ? 1 : Number(body.accountInstallments);
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS) {
    throw httpError(`La cantidad de cuotas tiene que ser un número entero entre 1 y ${MAX_INSTALLMENTS}.`);
  }
  const rawRate = body.accountInterestRate;
  const interestRate = rawRate === undefined || rawRate === null || rawRate === '' ? 0 : toNumber(rawRate);
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 1000) {
    throw httpError('El interés tiene que ser un porcentaje de 0 en adelante.');
  }
  // Sin día elegido, vencen el mismo día del mes de la venta (la primera, al mes siguiente)
  const rawDay = body.accountDueDay;
  const dueDay =
    rawDay === undefined || rawDay === null || rawDay === '' ? Number(dayKey(new Date()).slice(8, 10)) : Number(rawDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw httpError('Elegí el día del mes en que vencen las cuotas (de 1 a 31).');
  }
  return { installments, interestRate: round2(interestRate), dueDay };
};

// Total con interés, cuotas y vencimientos de un remito a cuenta corriente
export const accountPlan = ({ total, date, installments, interestRate, dueDay }) => {
  const financed = round2(total * (1 + interestRate / 100));
  const amounts = splitAmount(financed, installments);
  const dates = dueDates(dayKey(new Date(date)), dueDay, installments);
  return {
    totalFinanced: financed,
    installmentAmount: amounts[0],
    installments: amounts.map((amount, i) => ({ number: i + 1, amount, dueDate: dates[i] })),
  };
};

export const createOrderInstallments = async ({ order, plan, transaction }) =>
  CustomerInstallment.bulkCreate(
    plan.installments.map((inst) => ({
      businessId: order.businessId,
      customerId: order.customerId,
      orderId: order.id,
      number: inst.number,
      installmentsCount: plan.installments.length,
      dueDate: inst.dueDate,
      amount: inst.amount,
    })),
    { transaction },
  );

// Al anular un remito: si tiene cuotas cobradas no se puede (primero se anulan esas cobranzas); si no,
// las cuotas se anulan con él.
export const cancelOrderInstallments = async ({ order, transaction }) => {
  const installments = await CustomerInstallment.findAll({
    where: { orderId: order.id, businessId: order.businessId, status: 'active' },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (installments.some((i) => i.paidAt)) {
    throw httpError(
      'Este remito tiene cuotas cobradas. Para anularlo, primero anulá esas cobranzas en Cuentas corrientes.',
      409,
    );
  }
  if (installments.length) {
    await CustomerInstallment.update(
      { status: 'cancelled' },
      { where: { id: installments.map((i) => i.id) }, transaction },
    );
  }
};

// El saldo inicial se mantiene como una cuota: se crea, se actualiza o se anula. Si ya está cobrada,
// no se puede cambiar.
export const syncOpeningInstallment = async ({ customer, transaction }) => {
  const opening = round2(Number(customer.openingBalance) || 0);
  const current = await CustomerInstallment.findOne({
    where: { businessId: customer.businessId, customerId: customer.id, orderId: null, status: 'active' },
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (current?.paidAt) {
    if (Math.abs(Number(current.amount) - Math.max(opening, 0)) > 0.005) {
      throw httpError('El saldo inicial de este cliente ya está cobrado: no se puede cambiar.', 409);
    }
    return;
  }
  if (opening > 0) {
    if (current) {
      if (Math.abs(Number(current.amount) - opening) > 0.005)
        await current.update({ amount: opening }, { transaction });
    } else {
      await CustomerInstallment.create(
        {
          businessId: customer.businessId,
          customerId: customer.id,
          orderId: null,
          number: 1,
          installmentsCount: 1,
          dueDate: dayKey(new Date()),
          amount: opening,
        },
        { transaction },
      );
    }
  } else if (current) {
    await current.update({ status: 'cancelled' }, { transaction });
  }
};

const describe = (inst) =>
  inst.orderId ? `Remito ${inst.Order ? formatOrderNumber(inst.Order) : ''}`.trim() : 'Saldo inicial';

// Cuotas de un cliente: las impagas primero (por vencimiento) y después las pagadas
export const customerInstallments = async (businessId, customerId) => {
  const customer = await Customer.findOne({ where: { id: customerId, businessId }, attributes: ['id'] });
  if (!customer) throw httpError('Cliente no encontrado.', 404);
  const rows = await CustomerInstallment.findAll({
    where: { businessId, customerId, status: 'active' },
    include: [{ model: Order, attributes: ['id', 'number', 'date'] }],
    order: [
      ['dueDate', 'ASC'],
      ['createdAt', 'ASC'],
      [Order, 'number', 'ASC'],
      ['number', 'ASC'],
    ],
  });
  const today = dayKey(new Date());
  return rows
    .map((inst) => {
      const late = inst.paidAt ? 0 : daysLate(inst.dueDate, today);
      return {
        id: inst.id,
        orderId: inst.orderId,
        description: describe(inst),
        number: inst.number,
        installmentsCount: inst.installmentsCount,
        dueDate: inst.dueDate,
        amount: round2(Number(inst.amount)),
        paid: Boolean(inst.paidAt),
        paidAt: inst.paidAt,
        customerPaymentId: inst.customerPaymentId,
        daysLate: late,
        status: inst.paidAt ? 'paid' : late > 0 ? 'overdue' : 'pending',
      };
    })
    .sort((a, b) => Number(a.paid) - Number(b.paid));
};

// Tramos de mora por días de atraso
export const OVERDUE_BUCKETS = [
  { key: 'd1_30', label: '1 a 30 días', min: 1, max: 30 },
  { key: 'd31_60', label: '31 a 60 días', min: 31, max: 60 },
  { key: 'd61_90', label: '61 a 90 días', min: 61, max: 90 },
  { key: 'd90', label: 'Más de 90 días', min: 91, max: Infinity },
];

// Mora a hoy: por cliente, lo impago por vencer y lo vencido por tramo de atraso
export const overdueReport = async (businessId, customerNameOf) => {
  const today = dayKey(new Date());
  const rows = await CustomerInstallment.findAll({
    where: { businessId, status: 'active', paidAt: null },
    include: [{ model: Customer, attributes: ['id', 'businessName', 'firstName', 'lastName', 'cuit', 'phone'] }],
  });
  const empty = () => ({ notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, overdue: 0, total: 0 });
  const byCustomer = new Map();
  const totals = { ...empty(), customers: 0 };
  for (const inst of rows) {
    const amount = Number(inst.amount);
    const late = daysLate(inst.dueDate, today);
    const key = late > 0 ? OVERDUE_BUCKETS.find((b) => late >= b.min && late <= b.max).key : 'notDue';
    const entry = byCustomer.get(inst.customerId) || {
      customerId: inst.customerId,
      name: inst.Customer ? customerNameOf(inst.Customer) : 'Cliente',
      cuit: inst.Customer?.cuit || null,
      phone: inst.Customer?.phone || null,
      oldestDueDate: null,
      maxDaysLate: 0,
      ...empty(),
    };
    entry[key] += amount;
    entry.total += amount;
    if (late > 0) {
      entry.overdue += amount;
      entry.maxDaysLate = Math.max(entry.maxDaysLate, late);
      if (!entry.oldestDueDate || inst.dueDate < entry.oldestDueDate) entry.oldestDueDate = inst.dueDate;
    }
    byCustomer.set(inst.customerId, entry);
  }
  const customers = [...byCustomer.values()]
    .map((c) => {
      const rounded = { ...c };
      for (const k of Object.keys(empty())) rounded[k] = round2(c[k]);
      return rounded;
    })
    .sort((a, b) => b.maxDaysLate - a.maxDaysLate || b.overdue - a.overdue || a.name.localeCompare(b.name, 'es'));
  for (const c of customers) {
    for (const k of Object.keys(empty())) totals[k] = round2(totals[k] + c[k]);
  }
  totals.customers = customers.filter((c) => c.overdue > 0).length;
  return { date: today, buckets: OVERDUE_BUCKETS.map(({ key, label }) => ({ key, label })), totals, customers };
};

// Para la cobranza: las cuotas elegidas, bloqueadas, del cliente, activas e impagas
export const lockUnpaidInstallments = async ({ businessId, customerId, ids, transaction }) => {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!unique.length) throw httpError('Elegí las cuotas que paga el cliente.');
  const rows = await CustomerInstallment.findAll({
    where: { id: { [Op.in]: unique }, businessId, customerId, status: 'active' },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (rows.length !== unique.length) throw httpError('Alguna de las cuotas elegidas no es de este cliente.', 404);
  if (rows.some((r) => r.paidAt)) {
    throw httpError('Alguna de las cuotas elegidas ya está cobrada. Actualizá la pantalla.', 409);
  }
  return rows;
};
