import pkg from 'sequelize';
import { CustomerInstallment, Customer, Order, Business } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round2, toNumber, formatMoney } from '../utils/numbers.js';
import { dayKey } from '../utils/dates.js';
import { formatOrderNumber } from './orderNumber.service.js';
import { dueDates, splitAmount, daysLate, lateFee, spreadFee } from '../utils/accountInstallments.js';

export { dueDates, splitAmount, daysLate, lateFee, spreadFee };

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
//   - Recargo por mora (opcional): el comercio configura un % mensual y días de gracia, y cada remito
//     a cuenta corriente guarda los vigentes al hacerlo (los que imprime en la leyenda). Cada cuota
//     cobra con los de su remito: si después se cambia la tasa, los remitos anteriores no cambian; un
//     remito hecho sin tasa no cobra recargo. El saldo inicial (sin remito) usa la tasa vigente.
//     Se calcula por día de atraso desde el vencimiento (utils/accountInstallments.js, lateFee). No se
//     guarda mientras la cuota está impaga; al cobrar queda en la cuota y en la cobranza, que puede
//     perdonarlo en todo o en parte. No cambia el saldo: se cobra aparte.

export const MAX_INSTALLMENTS = 60;
export const MAX_LATE_FEE_RATE = 100;
export const MAX_GRACE_DAYS = 90;

// Recargo por mora del comercio: { rate (NULL = no cobra), graceDays }
export const lateFeeConfig = async (businessId, transaction) => {
  const business = await Business.findByPk(businessId, {
    attributes: ['id', 'lateFeeRate', 'lateFeeGraceDays'],
    transaction,
  });
  const rate =
    business?.lateFeeRate === null || business?.lateFeeRate === undefined ? null : Number(business.lateFeeRate);
  return { rate: rate > 0 ? rate : null, graceDays: Number(business?.lateFeeGraceDays) || 0 };
};

// Lee la configuración del recargo: % mensual vacío o 0 = no cobra recargo
export const readLateFeeConfig = (body) => {
  const raw = body.rate;
  const rate = raw === undefined || raw === null || raw === '' ? 0 : toNumber(raw);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_LATE_FEE_RATE) {
    throw httpError(`El recargo tiene que ser un % mensual entre 0 y ${MAX_LATE_FEE_RATE}.`);
  }
  const rawGrace = body.graceDays;
  const graceDays = rawGrace === undefined || rawGrace === null || rawGrace === '' ? 0 : Number(rawGrace);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > MAX_GRACE_DAYS) {
    throw httpError(`Los días de gracia tienen que ser un número entero entre 0 y ${MAX_GRACE_DAYS}.`);
  }
  return { rate: rate > 0 ? round2(rate) : null, graceDays };
};

// Lo que se guarda en un remito a cuenta corriente para la leyenda del recargo
export const orderLateFeeFields = (config) => ({
  lateFeeRate: config?.rate ?? null,
  lateFeeGraceDays: config?.rate ? config.graceDays : null,
});

// Tasa y días de gracia de cada cuota (en el orden de rows): los de su remito; el saldo inicial, los
// vigentes del comercio
export const installmentRates = async (businessId, rows, transaction) => {
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))];
  const [config, orders] = await Promise.all([
    rows.some((r) => !r.orderId) ? lateFeeConfig(businessId, transaction) : null,
    orderIds.length
      ? Order.findAll({
          where: { id: { [Op.in]: orderIds }, businessId },
          attributes: ['id', 'lateFeeRate', 'lateFeeGraceDays'],
          transaction,
        })
      : [],
  ]);
  const byOrder = new Map(
    orders.map((o) => [
      o.id,
      { rate: Number(o.lateFeeRate) > 0 ? Number(o.lateFeeRate) : null, graceDays: Number(o.lateFeeGraceDays) || 0 },
    ]),
  );
  return rows.map((r) => (r.orderId ? byOrder.get(r.orderId) || { rate: null, graceDays: 0 } : config));
};

// Recargo de una cuota impaga a la fecha day (AAAA-MM-DD), con su tasa ({ rate, graceDays })
const feeAt = (inst, day, terms) =>
  lateFee(Number(inst.amount), daysLate(inst.dueDate, day), terms?.rate, terms?.graceDays);

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
  const rates = await installmentRates(businessId, rows);
  return rows
    .map((inst, index) => {
      const late = inst.paidAt ? 0 : daysLate(inst.dueDate, today);
      // Pagada: el recargo que se cobró. Impaga: el que lleva a hoy
      const fee = inst.paidAt ? round2(Number(inst.lateFee) || 0) : feeAt(inst, today, rates[index]);
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
        lateFee: fee,
        // Tasa con la que cobra recargo (la de su remito), para calcularlo en la cobranza
        lateFeeRate: rates[index]?.rate ?? null,
        lateFeeGraceDays: rates[index]?.graceDays ?? 0,
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
  const config = await lateFeeConfig(businessId);
  const rows = await CustomerInstallment.findAll({
    where: { businessId, status: 'active', paidAt: null },
    include: [{ model: Customer, attributes: ['id', 'businessName', 'firstName', 'lastName', 'cuit', 'phone'] }],
  });
  const empty = () => ({ notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, overdue: 0, total: 0, lateFee: 0 });
  const byCustomer = new Map();
  const totals = { ...empty(), customers: 0 };
  const rates = await installmentRates(businessId, rows);
  for (const [index, inst] of rows.entries()) {
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
      entry.lateFee += feeAt(inst, today, rates[index]);
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
  return {
    date: today,
    lateFeeConfig: config,
    buckets: OVERDUE_BUCKETS.map(({ key, label }) => ({ key, label })),
    totals,
    customers,
  };
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

// Recargo de las cuotas que se cobran, a la fecha de la cobranza (day, AAAA-MM-DD). charged: lo que
// se cobra de recargo (undefined = todo lo calculado); puede ser menos (se perdona) pero no más.
// rates: la tasa de cada cuota (installmentRates). Devuelve { computed, charged, perInstallment:
// [recargo cobrado de cada cuota, en el orden de rows] }.
export const paymentLateFees = ({ rows, day, rates, charged }) => {
  const fees = rows.map((inst, index) => feeAt(inst, day, rates[index]));
  const computed = round2(fees.reduce((sum, f) => sum + f, 0));
  let total = computed;
  if (charged !== undefined && charged !== null && charged !== '') {
    total = toNumber(charged);
    if (!Number.isFinite(total) || total < 0) throw httpError('El recargo por mora no es válido.');
    if (total > computed + 0.005) {
      throw httpError(`El recargo por mora de estas cuotas es de ${formatMoney(computed)}: no se puede cobrar más.`);
    }
    total = round2(total);
  }
  const perInstallment = Math.abs(total - computed) < 0.005 ? fees : spreadFee(total, fees);
  return { computed, charged: total, perInstallment };
};
