import pkg from 'sequelize';
import {
  sequelize,
  Business,
  DiningTable,
  TableTab,
  KitchenTicket,
  TabItem,
  Product,
  Customer,
  Payment,
  Order,
  OrderPayment,
} from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { lockProducts, moveStock } from './stock.service.js';
import { loadComboComponents, computeCombo } from './combo.service.js';
import { isVariantGroup } from './variant.service.js';
import { createOrder } from './order.service.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { isPositiveQuantity, isNonNegative, toNumber, round2, round3, quantityAllowedFor } from '../utils/numbers.js';

// Mesas y comandas.
//   1. Se abre la cuenta de una mesa (TableTab).
//   2. Cada envío a la cocina es una comanda (KitchenTicket) con sus platos (TabItem). El stock se
//      descuenta al mandarla; si no alcanza, queda negativo: el plato ya se está preparando.
//   3. Un administrador o editor puede anular un plato: el stock vuelve.
//   4. Al cobrar se genera un remito con todos los platos, sin volver a mover el stock. Si se paga en
//      partes, cada parte queda en order_payments con su forma de pago y su propina.
// Orden de los bloqueos, siempre el mismo para no trabarse: la cuenta, el comercio, los productos.

const { QueryTypes, Op } = pkg;

export const OPEN_STATUSES = ['open', 'billing'];
export const MANAGER_ROLES = ['admin', 'editor'];
export const CASHIER_ROLES = ['admin', 'editor', 'operador'];
const MAX_ITEMS = 50;
const MAX_PARTS = 20;

const who = (user) => String(user?.name || '').slice(0, 100) || null;
const cleanText = (value, max = 255) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

export const lineTotal = (item) => round2(Number(item.quantity) * Number(item.unitPrice));
export const tabTotal = (items) =>
  round2(items.filter((i) => i.status === 'active').reduce((sum, i) => sum + lineTotal(i), 0));

const lockTab = async (tabId, businessId, transaction) => {
  const tab = await TableTab.findOne({ where: { id: tabId, businessId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!tab) throw httpError('Mesa no encontrada', 404);
  return tab;
};

const assertOpen = (tab) => {
  if (!OPEN_STATUSES.includes(tab.status)) throw httpError('Esta mesa ya se cerró', 409);
};

const tableName = async (tab, transaction) =>
  (await DiningTable.findOne({ where: { id: tab.tableId }, attributes: ['name'], transaction }))?.name || '';

// Cuánto se mueve de cada producto: los combos mueven sus componentes
const stockNeeds = async (lines, businessId, transaction) => {
  const products = await Product.findAll({ where: { id: lines.map((l) => l.productId), businessId }, transaction });
  const byId = new Map(products.map((p) => [p.id, p]));
  const combos = await loadComboComponents(
    products.filter((p) => p.isCombo).map((p) => p.id),
    businessId,
    transaction,
  );
  const needs = new Map();
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) continue;
    const parts = product.isCombo
      ? (combos.get(product.id) || []).map((c) => [c.productId, c.quantity * line.quantity])
      : [[product.id, line.quantity]];
    for (const [productId, qty] of parts) needs.set(productId, round3((needs.get(productId) || 0) + qty));
  }
  return needs;
};

const moveTabStock = async ({ lines, businessId, sign, reason, user }, transaction) => {
  const needs = await stockNeeds(lines, businessId, transaction);
  const locked = await lockProducts([...needs.keys()], businessId, transaction);
  for (const [productId, qty] of needs) {
    const product = locked.get(productId);
    if (!product) continue;
    await moveStock(
      { product, type: sign > 0 ? 'in' : 'out', delta: sign * qty, reason, actor: user, allowNegative: true },
      transaction,
    );
  }
};

// ---- Mesas ----

export const listTables = async (businessId) => {
  const [tables, tabs] = await Promise.all([
    DiningTable.findAll({
      where: { businessId },
      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    }),
    TableTab.findAll({
      where: { businessId, status: OPEN_STATUSES },
      include: [{ model: TabItem, as: 'items', attributes: ['quantity', 'unitPrice', 'status'] }],
    }),
  ]);
  const tabByTable = new Map(tabs.map((tab) => [tab.tableId, tab]));
  return tables.map((table) => {
    const tab = tabByTable.get(table.id);
    return {
      ...table.toJSON(),
      tab: tab
        ? {
            id: tab.id,
            status: tab.status,
            guests: tab.guests,
            waiterName: tab.waiterName,
            openedAt: tab.openedAt,
            items: tab.items.filter((i) => i.status === 'active').length,
            total: tabTotal(tab.items),
          }
        : null,
    };
  });
};

export const openTab = async ({ tableId, guests, user }) => {
  const { businessId } = user;
  let people = null;
  if (guests !== undefined && guests !== null && guests !== '') {
    people = Number(guests);
    if (!Number.isInteger(people) || people < 1 || people > 99) {
      throw httpError('La cantidad de personas debe ser un número entre 1 y 99');
    }
  }
  return sequelize.transaction(async (t) => {
    // Se bloquea la mesa: dos mozos que abren la misma mesa a la vez no pueden abrir dos cuentas
    const table = await DiningTable.findOne({
      where: { id: tableId, businessId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!table || !table.active) throw httpError('Mesa no encontrada', 404);
    const open = await TableTab.findOne({ where: { businessId, tableId, status: OPEN_STATUSES }, transaction: t });
    if (open) throw httpError(`La mesa ${table.name} ya está abierta`, 409);
    return TableTab.create(
      { businessId, tableId, guests: people, waiterId: user.id, waiterName: who(user), openedAt: new Date() },
      { transaction: t },
    );
  });
};

export const getTab = async (tabId, businessId) => {
  const tab = await TableTab.findOne({
    where: { id: tabId, businessId },
    include: [
      { model: DiningTable, as: 'table', attributes: ['id', 'name', 'area'] },
      { model: TabItem, as: 'items' },
      { model: KitchenTicket, as: 'tickets' },
    ],
    order: [
      [{ model: TabItem, as: 'items' }, 'createdAt', 'ASC'],
      [{ model: KitchenTicket, as: 'tickets' }, 'number', 'ASC'],
    ],
  });
  if (!tab) throw httpError('Mesa no encontrada', 404);
  const order =
    tab.status === 'closed'
      ? await Order.findOne({ where: { tableTabId: tab.id }, attributes: ['id', 'number'] })
      : null;
  return { ...tab.toJSON(), total: tabTotal(tab.items), order };
};

// ---- Comandas ----

// Número de comanda correlativo por comercio (mismo criterio que services/orderNumber.service.js)
const nextTicketNumber = async (businessId, transaction) => {
  await Business.findOne({ where: { id: businessId }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
  const [row] = await sequelize.query(
    'SELECT MAX(`number`) AS maxNumber FROM kitchen_tickets WHERE business_id = :businessId FOR UPDATE',
    { replacements: { businessId }, type: QueryTypes.SELECT, transaction },
  );
  return (Number(row?.maxNumber) || 0) + 1;
};

const readTicketItems = (items) => {
  if (!Array.isArray(items) || !items.length) throw httpError('La comanda tiene que tener al menos un plato');
  if (items.length > MAX_ITEMS) throw httpError(`Una comanda puede tener hasta ${MAX_ITEMS} platos`);
  return items.map((item, index) => {
    const n = index + 1;
    if (!item || typeof item.productId !== 'string' || !item.productId)
      throw httpError(`Plato ${n}: falta el producto`);
    if (!isPositiveQuantity(item.quantity)) throw httpError(`Plato ${n}: la cantidad debe ser mayor a 0`);
    return { productId: item.productId, quantity: round3(toNumber(item.quantity)), note: cleanText(item.note) };
  });
};

export const sendTicket = async ({ tabId, items, requestId: rawRequestId, user }) => {
  const { businessId } = user;
  const requestId = cleanRequestId(rawRequestId);
  const lines = readTicketItems(items);

  const previousTicket = async () =>
    requestId ? KitchenTicket.findOne({ where: { businessId, requestId }, attributes: ['id'] }) : null;
  const previous = await previousTicket();
  if (previous) return { ticketId: previous.id, created: false };

  const t = await sequelize.transaction();
  try {
    const tab = await lockTab(tabId, businessId, t);
    assertOpen(tab);

    const products = await Product.findAll({
      where: { id: [...new Set(lines.map((l) => l.productId))], businessId },
      transaction: t,
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const combos = await loadComboComponents(
      products.filter((p) => p.isCombo).map((p) => p.id),
      businessId,
      t,
    );
    for (const [index, line] of lines.entries()) {
      const product = byId.get(line.productId);
      if (!product) throw httpError(`Plato ${index + 1}: producto no encontrado`, 404);
      if (!product.active) throw httpError(`Plato ${index + 1}: ${product.name} está inactivo`);
      if (isVariantGroup(product)) throw httpError(`Plato ${index + 1}: ${product.name} tiene variantes. Elegí cuál.`);
      if (!quantityAllowedFor(product, line.quantity)) {
        throw httpError(`Plato ${index + 1}: ${product.name} se pide por unidad, la cantidad debe ser un entero`);
      }
      if (product.isCombo && !(combos.get(product.id) || []).length) {
        throw httpError(`El combo ${product.name} no tiene productos cargados`);
      }
    }

    const number = await nextTicketNumber(businessId, t);
    const ticket = await KitchenTicket.create(
      { businessId, tabId: tab.id, number, requestId, createdById: user.id, createdByName: who(user) },
      { transaction: t },
    );
    // El precio del momento: el de lista, o el del combo
    const priceOf = (product) =>
      product.isCombo ? computeCombo(product, combos.get(product.id)).price : round2(Number(product.price) || 0);
    await TabItem.bulkCreate(
      lines.map((line) => {
        const product = byId.get(line.productId);
        return {
          businessId,
          tabId: tab.id,
          ticketId: ticket.id,
          productId: product.id,
          name: product.name,
          quantity: line.quantity,
          unitPrice: priceOf(product),
          note: line.note,
        };
      }),
      { transaction: t },
    );

    const name = await tableName(tab, t);
    await moveTabStock({ lines, businessId, sign: -1, reason: `Mesa ${name}, comanda ${number}`, user }, t);
    // Si había pedido la cuenta y pide algo más, la mesa vuelve a estar abierta
    if (tab.status === 'billing') await tab.update({ status: 'open' }, { transaction: t });

    await t.commit();
    return { ticketId: ticket.id, created: true };
  } catch (error) {
    await t.rollback();
    if (requestId && isDuplicateRequest(error)) {
      const again = await previousTicket();
      if (again) return { ticketId: again.id, created: false };
    }
    throw error;
  }
};

export const getTicket = async (ticketId, businessId) => {
  const ticket = await KitchenTicket.findOne({
    where: { id: ticketId, businessId },
    include: [
      { model: TabItem, as: 'items' },
      {
        model: TableTab,
        as: 'tab',
        attributes: ['id', 'waiterName', 'guests', 'status'],
        include: [{ model: DiningTable, as: 'table', attributes: ['name', 'area'] }],
      },
    ],
  });
  if (!ticket) throw httpError('Comanda no encontrada', 404);
  return ticket;
};

// Comandas para la pantalla de la cocina: las pendientes y las listas de la última hora
export const kitchenTickets = async (businessId) => {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return KitchenTicket.findAll({
    where: {
      businessId,
      [Op.or]: [{ status: 'pending' }, { status: 'ready', readyAt: { [Op.gte]: since } }],
    },
    include: [
      { model: TabItem, as: 'items' },
      {
        model: TableTab,
        as: 'tab',
        attributes: ['id', 'waiterName', 'status'],
        include: [{ model: DiningTable, as: 'table', attributes: ['name', 'area'] }],
      },
    ],
    order: [['number', 'ASC']],
    limit: 100,
  });
};

export const markTicket = async ({ ticketId, ready, businessId }) => {
  const ticket = await KitchenTicket.findOne({ where: { id: ticketId, businessId } });
  if (!ticket) throw httpError('Comanda no encontrada', 404);
  await ticket.update(ready ? { status: 'ready', readyAt: new Date() } : { status: 'pending', readyAt: null });
  return ticket;
};

// ---- Anular, pedir la cuenta ----

export const cancelItem = async ({ tabId, itemId, reason, user }) => {
  const { businessId } = user;
  return sequelize.transaction(async (t) => {
    const tab = await lockTab(tabId, businessId, t);
    assertOpen(tab);
    const item = await TabItem.findOne({ where: { id: itemId, tabId: tab.id, businessId }, transaction: t });
    if (!item) throw httpError('Plato no encontrado', 404);
    if (item.status !== 'active') throw httpError('Ese plato ya estaba anulado', 409);

    const motive = cleanText(reason);
    const name = await tableName(tab, t);
    await moveTabStock(
      {
        lines: [{ productId: item.productId, quantity: Number(item.quantity) }],
        businessId,
        sign: 1,
        reason: `Anulado en mesa ${name}${motive ? `: ${motive}` : ''}`,
        user,
      },
      t,
    );
    await item.update(
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelledByName: who(user),
        cancelReason: motive,
      },
      { transaction: t },
    );
    return item;
  });
};

export const requestBill = async ({ tabId, user }) =>
  sequelize.transaction(async (t) => {
    const tab = await lockTab(tabId, user.businessId, t);
    assertOpen(tab);
    await tab.update({ status: 'billing' }, { transaction: t });
    return tab;
  });

// Anular la cuenta entera (por ejemplo, se abrió en la mesa equivocada): devuelve el stock de lo pedido
export const cancelTab = async ({ tabId, reason, user }) => {
  const { businessId } = user;
  return sequelize.transaction(async (t) => {
    const tab = await lockTab(tabId, businessId, t);
    assertOpen(tab);
    const items = await TabItem.findAll({ where: { tabId: tab.id, businessId, status: 'active' }, transaction: t });
    const motive = cleanText(reason);
    if (items.length) {
      const name = await tableName(tab, t);
      await moveTabStock(
        {
          lines: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
          businessId,
          sign: 1,
          reason: `Mesa ${name} anulada${motive ? `: ${motive}` : ''}`,
          user,
        },
        t,
      );
      const now = new Date();
      await TabItem.update(
        {
          status: 'cancelled',
          cancelledAt: now,
          cancelledById: user.id,
          cancelledByName: who(user),
          cancelReason: motive,
        },
        { where: { tabId: tab.id, status: 'active' }, transaction: t },
      );
    }
    await tab.update(
      { status: 'cancelled', closedAt: new Date(), closedById: user.id, closedByName: who(user), cancelReason: motive },
      { transaction: t },
    );
    return tab;
  });
};

// ---- Cobrar ----

const defaultCustomer = async (businessId, transaction) => {
  const found = await Customer.findOne({
    where: { businessId, firstName: 'Consumidor', lastName: 'Final', anonymizedAt: null },
    transaction,
  });
  return (
    found ||
    Customer.create(
      { businessId, firstName: 'Consumidor', lastName: 'Final', fiscalCondition: 'Consumidor Final' },
      { transaction },
    )
  );
};

const readParts = (parts, total) => {
  if (!Array.isArray(parts) || !parts.length) throw httpError('Indicá cómo se paga');
  if (parts.length > MAX_PARTS) throw httpError(`La cuenta se puede dividir en hasta ${MAX_PARTS} partes`);
  const rows = parts.map((part, index) => {
    const n = index + 1;
    if (!part || typeof part.paymentId !== 'string' || !part.paymentId) {
      throw httpError(`Parte ${n}: falta la forma de pago`);
    }
    if (!isNonNegative(part.amount)) throw httpError(`Parte ${n}: el importe no es válido`);
    const tip = part.tip === undefined || part.tip === null || part.tip === '' ? 0 : part.tip;
    if (!isNonNegative(tip)) throw httpError(`Parte ${n}: la propina no es válida`);
    return { paymentId: part.paymentId, amount: round2(toNumber(part.amount)), tip: round2(toNumber(tip)) };
  });
  const sum = round2(rows.reduce((s, r) => s + r.amount, 0));
  if (Math.abs(sum - total) > 0.001) {
    throw httpError(`Las partes suman $${sum.toFixed(2)} y la cuenta es de $${total.toFixed(2)}`);
  }
  return rows;
};

export const closeTab = async ({ tabId, body, user }) => {
  const { businessId } = user;
  const requestId = cleanRequestId(body.requestId);
  const previousOrder = async () =>
    requestId ? Order.findOne({ where: { businessId, requestId }, attributes: ['id'] }) : null;
  const previous = await previousOrder();
  if (previous) return { orderId: previous.id, created: false };

  const t = await sequelize.transaction();
  try {
    const tab = await lockTab(tabId, businessId, t);
    assertOpen(tab);
    const items = await TabItem.findAll({
      where: { tabId: tab.id, businessId, status: 'active' },
      order: [['createdAt', 'ASC']],
      transaction: t,
    });
    if (!items.length) throw httpError('La mesa no tiene platos para cobrar. Si no se usó, anulala.');
    const total = tabTotal(items);
    const parts = readParts(body.parts, total);

    const payments = await Payment.findAll({
      where: { id: [...new Set(parts.map((p) => p.paymentId))], businessId },
      transaction: t,
    });
    const paymentById = new Map(payments.map((p) => [p.id, p]));
    for (const part of parts) {
      const payment = paymentById.get(part.paymentId);
      if (!payment) throw httpError('Forma de pago no encontrada', 404);
      if (!payment.active) throw httpError(`La forma de pago ${payment.name} está inactiva. Elegí otra.`);
    }

    const customerId = body.customerId || (await defaultCustomer(businessId, t)).id;
    // La forma de pago "principal" del remito es la de la parte más grande
    const main = parts.reduce((a, b) => (b.amount > a.amount ? b : a));
    const name = await tableName(tab, t);

    const { orderId } = await createOrder({
      body: {
        customerId,
        paymentId: main.paymentId,
        requestId,
        notes: `Mesa ${name}`,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
        })),
      },
      user,
      options: { tableTabId: tab.id, transaction: t },
    });

    const order = await Order.findOne({ where: { id: orderId }, attributes: ['id', 'total'], transaction: t });
    if (Math.abs(Number(order.total) - total) > 0.001) {
      throw httpError('El total del remito no coincide con el de la mesa. Revisá los platos y volvé a intentar.');
    }

    await OrderPayment.bulkCreate(
      parts.map((p) => ({ businessId, orderId, paymentId: p.paymentId, amount: p.amount, tip: p.tip })),
      { transaction: t },
    );
    await tab.update(
      { status: 'closed', closedAt: new Date(), closedById: user.id, closedByName: who(user) },
      { transaction: t },
    );

    await t.commit();
    return { orderId, created: true };
  } catch (error) {
    await t.rollback();
    if (requestId && isDuplicateRequest(error)) {
      const again = await previousOrder();
      if (again) return { orderId: again.id, created: false };
    }
    throw error;
  }
};
