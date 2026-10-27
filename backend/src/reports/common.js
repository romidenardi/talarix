import pkg from 'sequelize';
import sequelize from '../config/database.js';
import { Product, Customer, Payment } from '../models/index.js';

const { Op, QueryTypes } = pkg;

// Lo que comparten los reportes. Las sumas se hacen en la base (SUM / GROUP BY): al servidor
// solo llega un renglón por día, por producto, por cliente o por alícuota, no todos los remitos.

export const LOW_STOCK_THRESHOLD = 5;

// Las fechas se guardan en UTC; se pasan así para comparar
const toSql = (date) => date.toISOString().slice(0, 23).replace('T', ' ');

export const select = (sql, { businessId, start, end, ...rest }) =>
  sequelize.query(sql, {
    replacements: { businessId, start: toSql(start), end: toSql(end), ...rest },
    type: QueryTypes.SELECT,
  });

// Remitos activos del comercio en el rango: los anulados nunca cuentan
export const ORDERS_IN_RANGE = `o.business_id = :businessId AND o.status = 'active' AND o.date >= :start AND o.date < :end`;

// Día argentino del remito (UTC-3 fijo, igual que utils/dates.js)
export const ORDER_DAY = `DATE_FORMAT(DATE_SUB(o.date, INTERVAL 3 HOUR), '%Y-%m-%d')`;

// Bruto del remito. Los remitos viejos sin bruto guardado usan la suma de sus renglones.
const ORDER_GROSS = `CASE WHEN o.gross_total > 0 THEN o.gross_total
  ELSE COALESCE((SELECT SUM(g.quantity * g.unit_price) FROM order_items g WHERE g.order_id = o.id), 0) END`;

// Una fila por remito con su bruto, para usar como tabla en un FROM / JOIN
export const ordersWithGross = (extraWhere = '') => `
  SELECT o.id, o.total, o.installment_plan_id, o.total_financed, ${ORDER_DAY} AS day, ${ORDER_GROSS} AS gross
  FROM orders o
  WHERE ${ORDERS_IN_RANGE} ${extraWhere}`;

// Importe de un renglón con los descuentos del remito repartidos (total / bruto).
// Primero se multiplica y después se divide, para no perder decimales en la proporción.
export const lineAmount = (amount) => `CASE WHEN t.gross > 0 THEN ${amount} * t.total / t.gross ELSE ${amount} END`;

// Unidades e importe vendido por producto
export const productTotals = ({ businessId, start, end, limit }) =>
  select(
    `SELECT i.product_id AS productId, SUM(i.quantity) AS units,
       SUM(${lineAmount('i.quantity * i.unit_price')}) AS amount
     FROM order_items i
     JOIN (${ordersWithGross()}) t ON t.id = i.order_id
     GROUP BY i.product_id
     ORDER BY amount DESC
     ${limit ? `LIMIT ${Number(limit)}` : ''}`,
    { businessId, start, end },
  ).then((rows) => rows.map((r) => ({ productId: r.productId, units: Number(r.units), amount: Number(r.amount) })));

export const customerName = (customer) => {
  if (!customer) return 'Sin cliente';
  return customer.businessName || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Sin nombre';
};

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));

export const loadProductsMap = async (businessId, ids) => {
  if (!ids.length) return new Map();
  const products = await Product.findAll({
    where: { businessId, id: { [Op.in]: ids } },
    attributes: ['id', 'name', 'internalCode', 'categoryId', 'vatRate', 'otherTaxes'],
  });
  return byId(products);
};

export const loadCustomersMap = async (businessId, ids) => {
  if (!ids.length) return new Map();
  const customers = await Customer.findAll({
    where: { businessId, id: { [Op.in]: ids } },
    attributes: ['id', 'firstName', 'lastName', 'businessName'],
  });
  return byId(customers);
};

export const loadPaymentsMap = async (businessId, ids) => {
  if (!ids.length) return new Map();
  const payments = await Payment.findAll({
    where: { businessId, id: { [Op.in]: ids } },
    attributes: ['id', 'name'],
  });
  return byId(payments);
};
