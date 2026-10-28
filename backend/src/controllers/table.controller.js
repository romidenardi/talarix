import { Business, DiningTable, TableTab } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';
import { readRange } from '../utils/dates.js';
import { select } from '../reports/common.js';
import { round2 } from '../utils/numbers.js';
import {
  listTables,
  openTab,
  getTab,
  sendTicket,
  getTicket,
  kitchenTickets,
  markTicket,
  cancelItem,
  requestBill,
  cancelTab,
  closeTab,
  OPEN_STATUSES,
} from '../services/table.service.js';

// ---- Módulo de mesas (lo activa el superadmin) ----

export const getSettings = asyncHandler(async (req, res) => {
  const business = await Business.findByPk(req.user.businessId, { attributes: ['tablesEnabled'] });
  res.json({ enabled: Boolean(business?.tablesEnabled) });
});

// ---- Mesas (alta y cambios: administrador y editor) ----

const readTable = (body, partial = false) => {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 30) throw httpError('La mesa necesita un nombre o número de hasta 30 caracteres');
    data.name = name;
  }
  if (body.area !== undefined)
    data.area =
      String(body.area ?? '')
        .trim()
        .slice(0, 50) || null;
  if (body.sortOrder !== undefined) {
    const order = Number(body.sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 9999) throw httpError('El orden debe ser un número entero');
    data.sortOrder = order;
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  return data;
};

const rethrowDuplicateName = (err) => {
  if (err?.name === 'SequelizeUniqueConstraintError') throw httpError('Ya hay una mesa con ese nombre', 409);
  throw err;
};

const findOwnTable = async (id, businessId) => {
  const table = await DiningTable.findOne({ where: { id, businessId } });
  if (!table) throw httpError('Mesa no encontrada', 404);
  return table;
};

const hasOpenTab = (table) => TableTab.count({ where: { tableId: table.id, status: OPEN_STATUSES } });

export const getTables = asyncHandler(async (req, res) => {
  res.json(await listTables(req.user.businessId));
});

export const createTable = asyncHandler(async (req, res) => {
  const data = readTable(req.body);
  try {
    res.status(201).json(await DiningTable.create({ ...data, businessId: req.user.businessId }));
  } catch (err) {
    rethrowDuplicateName(err);
  }
});

export const updateTable = asyncHandler(async (req, res) => {
  const table = await findOwnTable(req.params.id, req.user.businessId);
  const data = readTable(req.body, true);
  if (data.active === false && (await hasOpenTab(table))) {
    throw httpError('La mesa está abierta: cobrala o anulala antes de desactivarla', 409);
  }
  try {
    await table.update(data);
  } catch (err) {
    rethrowDuplicateName(err);
  }
  res.json(table);
});

export const deleteTable = asyncHandler(async (req, res) => {
  const table = await findOwnTable(req.params.id, req.user.businessId);
  const used = await TableTab.count({ where: { tableId: table.id } });
  if (used) {
    throw httpError(`La mesa ${table.name} ya se usó y no se puede eliminar. Si no la usás más, desactivala.`, 409);
  }
  await table.destroy();
  res.status(204).send();
});

// ---- Cuentas y comandas ----

export const openTableTab = asyncHandler(async (req, res) => {
  const tab = await openTab({ tableId: req.params.id, guests: req.body.guests, user: req.user });
  res.status(201).json(await getTab(tab.id, req.user.businessId));
});

export const getTableTab = asyncHandler(async (req, res) => {
  res.json(await getTab(req.params.tabId, req.user.businessId));
});

export const createTicket = asyncHandler(async (req, res) => {
  const { ticketId, created } = await sendTicket({
    tabId: req.params.tabId,
    items: req.body.items,
    requestId: req.body.requestId,
    user: req.user,
  });
  res.status(created ? 201 : 200).json({ ticket: await getTicket(ticketId, req.user.businessId) });
});

export const getKitchenTicket = asyncHandler(async (req, res) => {
  res.json(await getTicket(req.params.ticketId, req.user.businessId));
});

export const getKitchen = asyncHandler(async (req, res) => {
  res.json(await kitchenTickets(req.user.businessId));
});

export const setTicketReady = asyncHandler(async (req, res) => {
  res.json(
    await markTicket({
      ticketId: req.params.ticketId,
      ready: req.body.ready !== false,
      businessId: req.user.businessId,
    }),
  );
});

export const cancelTabItem = asyncHandler(async (req, res) => {
  const item = await cancelItem({
    tabId: req.params.tabId,
    itemId: req.params.itemId,
    reason: req.body.reason,
    user: req.user,
  });
  await audit(req, {
    action: 'tables.item_cancelled',
    targetType: 'tab',
    targetId: req.params.tabId,
    detail: { quantity: Number(item.quantity), amount: round2(Number(item.quantity) * Number(item.unitPrice)) },
  });
  res.json(await getTab(req.params.tabId, req.user.businessId));
});

export const askForBill = asyncHandler(async (req, res) => {
  await requestBill({ tabId: req.params.tabId, user: req.user });
  res.json(await getTab(req.params.tabId, req.user.businessId));
});

export const cancelTableTab = asyncHandler(async (req, res) => {
  await cancelTab({ tabId: req.params.tabId, reason: req.body.reason, user: req.user });
  await audit(req, { action: 'tables.tab_cancelled', targetType: 'tab', targetId: req.params.tabId });
  res.json(await getTab(req.params.tabId, req.user.businessId));
});

export const closeTableTab = asyncHandler(async (req, res) => {
  const { orderId, created } = await closeTab({ tabId: req.params.tabId, body: req.body, user: req.user });
  res.status(created ? 201 : 200).json({ orderId });
});

// ---- Propinas por mozo (?from=AAAA-MM-DD&to=AAAA-MM-DD) ----

export const getTips = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);
  const rows = await select(
    `SELECT COALESCE(tt.waiter_name, 'Sin mozo') AS waiter, COUNT(DISTINCT o.id) AS tables,
       SUM(op.amount) AS sales, SUM(op.tip) AS tips
     FROM order_payments op
     JOIN orders o ON o.id = op.order_id
     LEFT JOIN table_tabs tt ON tt.id = o.table_tab_id
     WHERE o.business_id = :businessId AND o.status = 'active' AND o.date >= :start AND o.date < :end
     GROUP BY COALESCE(tt.waiter_name, 'Sin mozo')
     ORDER BY tips DESC`,
    { businessId, start, end },
  );
  const waiters = rows.map((r) => ({
    waiter: r.waiter,
    tables: Number(r.tables),
    sales: round2(Number(r.sales)),
    tips: round2(Number(r.tips)),
  }));
  res.json({
    range: { from, to },
    waiters,
    total: round2(waiters.reduce((sum, w) => sum + w.tips, 0)),
  });
});
