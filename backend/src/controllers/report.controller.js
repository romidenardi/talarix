import pkg from 'sequelize';
import {
  Order, OrderItem, Product, Category, Customer, Payment,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { round2 } from '../utils/numbers.js';
import { splitPrice, splitLineParts } from '../utils/taxes.js';

const { Op } = pkg;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; 
const LOW_STOCK_THRESHOLD = 5; 
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayKey = (date) => new Date(date.getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10);
const startOfDay = (key) => new Date(`${key}T00:00:00-03:00`);
const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const periodKey = (date, groupBy) => {
  const key = dayKey(date);
  if (groupBy === 'week') return mondayOf(key);
  if (groupBy === 'month') return key.slice(0, 7);
  return key;
};

const readRange = (query) => {
  const to = query.to || dayKey(new Date());
  const from = query.from || addDays(to, -29);
  if (!KEY_RE.test(from) || !KEY_RE.test(to)) {
    throw httpError('Las fechas deben tener el formato AAAA-MM-DD');
  }
  const start = startOfDay(from);
  const lastDay = startOfDay(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime())) {
    throw httpError('Fecha inválida');
  }
  const end = startOfDay(addDays(to, 1));
  if (end <= start) throw httpError('La fecha "hasta" no puede ser anterior a "desde"');
  if ((end - start) / DAY_MS > MAX_RANGE_DAYS) {
    throw httpError(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
  }
  return { from, to, start, end };
};

// Los remitos anulados nunca cuentan
const loadOrders = (businessId, start, end) =>
  Order.findAll({
    where: { businessId, status: 'active', date: { [Op.gte]: start, [Op.lt]: end } },
    include: [
      { model: OrderItem, as: 'items', attributes: ['productId', 'quantity', 'unitPrice', 'components', 'vatRate', 'otherTaxes'] },
      { model: Customer, attributes: ['id', 'firstName', 'lastName', 'businessName'] },
      { model: Payment, attributes: ['id', 'name'] },
    ],
    order: [['date', 'ASC']],
  });

const itemsSum = (order) =>
  order.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);

const orderGross = (order) => {
  const gross = Number(order.grossTotal);
  return gross > 0 ? gross : itemsSum(order);
};

// Proporción del total final sobre el bruto: reparte los descuentos entre los ítems
const orderScale = (order) => {
  const gross = orderGross(order);
  return gross > 0 ? Number(order.total) / gross : 1;
};

const customerName = (customer) => {
  if (!customer) return 'Sin cliente';
  return customer.businessName
    || [customer.firstName, customer.lastName].filter(Boolean).join(' ')
    || 'Sin nombre';
};

const loadProductsMap = async (businessId, ids) => {
  if (!ids.length) return new Map();
  const products = await Product.findAll({
    where: { businessId, id: { [Op.in]: ids } },
    attributes: ['id', 'name', 'internalCode', 'categoryId', 'vatRate', 'otherTaxes'],
  });
  return new Map(products.map((p) => [p.id, p]));
};

export const salesSummary = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);
  const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy) ? req.query.groupBy : 'day';

  const orders = await loadOrders(businessId, start, end);

  const series = new Map();
  for (let key = from; key <= to; key = addDays(key, 1)) {
    const k = periodKey(startOfDay(key), groupBy);
    if (!series.has(k)) series.set(k, { period: k, orders: 0, total: 0 });
  }

  const totals = { orders: 0, gross: 0, discounts: 0, total: 0, installmentOrders: 0, financed: 0 };
  for (const order of orders) {
    const gross = orderGross(order);
    const total = Number(order.total);
    totals.orders += 1;
    totals.gross += gross;
    totals.discounts += Math.max(gross - total, 0);
    totals.total += total;
    if (order.installmentPlanId) {
      totals.installmentOrders += 1;
      totals.financed += Number(order.totalFinanced) || 0;
    }
    const bucket = series.get(periodKey(order.date, groupBy));
    if (bucket) {
      bucket.orders += 1;
      bucket.total += total;
    }
  }

  res.json({
    range: { from, to, groupBy },
    totals: {
      orders: totals.orders,
      gross: round2(totals.gross),
      discounts: round2(totals.discounts),
      total: round2(totals.total),
      avgTicket: totals.orders ? round2(totals.total / totals.orders) : 0,
      installmentOrders: totals.installmentOrders,
      financed: round2(totals.financed),
    },
    series: [...series.values()].map((s) => ({ ...s, total: round2(s.total) })),
  });
});

export const salesByProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const orders = await loadOrders(businessId, start, end);

  const byProduct = new Map();
  for (const order of orders) {
    const scale = orderScale(order);
    for (const item of order.items) {
      const row = byProduct.get(item.productId) || { units: 0, amount: 0 };
      row.units += Number(item.quantity);
      row.amount += Number(item.quantity) * Number(item.unitPrice) * scale; 
      byProduct.set(item.productId, row);
    }
  }

  const products = await loadProductsMap(businessId, [...byProduct.keys()]);
  const categories = await Category.findAll({ where: { businessId }, attributes: ['id', 'name'] });
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const rows = [...byProduct.entries()].map(([productId, row]) => {
    const product = products.get(productId);
    return {
      productId,
      code: product?.internalCode || '',
      name: product?.name || 'Producto eliminado',
      category: (product?.categoryId && categoryName.get(product.categoryId)) || 'Sin categoría',
      units: row.units,
      amount: round2(row.amount),
    };
  }).sort((a, b) => b.amount - a.amount);

  const byCategory = new Map();
  for (const row of rows) {
    const c = byCategory.get(row.category) || { category: row.category, units: 0, amount: 0 };
    c.units += row.units;
    c.amount += row.amount;
    byCategory.set(row.category, c);
  }

  res.json({
    range: { from, to },
    products: rows,
    categories: [...byCategory.values()]
      .map((c) => ({ ...c, amount: round2(c.amount) }))
      .sort((a, b) => b.amount - a.amount),
  });
});

export const salesByCustomer = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const orders = await loadOrders(businessId, start, end);

  const byCustomer = new Map();
  for (const order of orders) {
    const row = byCustomer.get(order.customerId) || {
      customerId: order.customerId,
      name: customerName(order.Customer),
      orders: 0,
      total: 0,
      lastPurchase: null,
    };
    row.orders += 1;
    row.total += Number(order.total);
    row.lastPurchase = dayKey(order.date); 
    byCustomer.set(order.customerId, row);
  }

  res.json({
    range: { from, to },
    customers: [...byCustomer.values()]
      .map((c) => ({ ...c, total: round2(c.total), avgTicket: round2(c.total / c.orders) }))
      .sort((a, b) => b.total - a.total),
  });
});

export const salesByPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const orders = await loadOrders(businessId, start, end);

  const byPayment = new Map();
  let grandTotal = 0;
  for (const order of orders) {
    const row = byPayment.get(order.paymentId) || {
      paymentId: order.paymentId,
      name: order.Payment?.name || 'Sin forma de pago',
      orders: 0,
      total: 0,
      installmentOrders: 0,
      financed: 0,
    };
    const total = Number(order.total);
    row.orders += 1;
    row.total += total;
    grandTotal += total;
    if (order.installmentPlanId) {
      row.installmentOrders += 1;
      row.financed += Number(order.totalFinanced) || 0;
    }
    byPayment.set(order.paymentId, row);
  }

  res.json({
    range: { from, to },
    payments: [...byPayment.values()]
      .map((p) => ({
        ...p,
        total: round2(p.total),
        financed: round2(p.financed),
        share: grandTotal > 0 ? round2((p.total / grandTotal) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total),
  });
});

export const vatReport = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const orders = await loadOrders(businessId, start, end);
  const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
  const products = await loadProductsMap(businessId, productIds);

  const discriminated = { orders: 0, net: 0, vat: 0, internal: 0, total: 0 };
  const notDiscriminated = { orders: 0, total: 0 };
  const byRate = new Map();
  const byInternalRate = new Map();

  for (const order of orders) {
    if (!order.discriminatesVat) {
      notDiscriminated.orders += 1;
      notDiscriminated.total += Number(order.total);
      continue;
    }

    discriminated.orders += 1;
    discriminated.net += Number(order.subtotal) || 0;
    discriminated.vat += Number(order.vatAmount) || 0;
    discriminated.internal += Number(order.internalTaxAmount) || 0;
    discriminated.total += Number(order.total);

    const scale = orderScale(order);
    const addPart = ({ vatRate, internalRate, net, vat, internal, total }) => {
      const row = byRate.get(vatRate) || { rate: vatRate, net: 0, vat: 0, internal: 0, total: 0 };
      row.net += net;
      row.vat += vat;
      row.internal += internal;
      row.total += total;
      byRate.set(vatRate, row);

      if (internalRate > 0) {
        const internalRow = byInternalRate.get(internalRate) || { rate: internalRate, net: 0, internal: 0, total: 0 };
        internalRow.net += net;
        internalRow.internal += internal;
        internalRow.total += total;
        byInternalRate.set(internalRate, internalRow);
      }
    };

    for (const item of order.items) {
      // Mismo redondeo por renglón que al generar el remito (services/orderPricing.js)
      const itemTotal = round2(Number(item.quantity) * Number(item.unitPrice)) * scale;

      // Combo: se reparte entre sus productos con los datos guardados al vender
      if (Array.isArray(item.components) && item.components.length) {
        splitLineParts(itemTotal, item.components).forEach(addPart);
        continue;
      }

      // El IVA guardado al vender. Los remitos anteriores a esa columna usan el actual del producto.
      const product = products.get(item.productId);
      const soldWithRate = item.vatRate !== null && item.vatRate !== undefined;
      const rate = soldWithRate ? Number(item.vatRate) : Number(product?.vatRate) || 0;
      const internalRate = soldWithRate ? Number(item.otherTaxes) || 0 : Number(product?.otherTaxes) || 0;
      const split = splitPrice(itemTotal, rate, internalRate);
      addPart({
        vatRate: rate,
        internalRate,
        total: itemTotal,
        ...split,
      });
    }
  }
  res.json({
    range: { from, to },
    discriminated: {
      orders: discriminated.orders,
      net: round2(discriminated.net),
      vat: round2(discriminated.vat),
      internal: round2(discriminated.internal),
      total: round2(discriminated.total),
    },
    notDiscriminated: {
      orders: notDiscriminated.orders,
      total: round2(notDiscriminated.total),
    },
    byRate: [...byRate.values()]
      .map((r) => ({ rate: r.rate, net: round2(r.net), vat: round2(r.vat), internal: round2(r.internal), total: round2(r.total) }))
      .sort((a, b) => b.rate - a.rate),
    byInternalRate: [...byInternalRate.values()]
      .map((r) => ({ rate: r.rate, net: round2(r.net), internal: round2(r.internal), total: round2(r.total) }))
      .sort((a, b) => b.rate - a.rate),
  });
});

export const dashboard = asyncHandler(async (req, res) => {
  const { businessId } = req.user;

  const now = new Date();
  const today = dayKey(now);
  const monthKey = `${today.slice(0, 7)}-01`;
  const monthStart = startOfDay(monthKey);

  const prevDate = new Date(`${monthKey}T00:00:00Z`);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevStart = startOfDay(prevDate.toISOString().slice(0, 10));
  // Mismo tramo del mes anterior, para comparar parejo
  const prevEnd = new Date(Math.min(
    prevStart.getTime() + (now.getTime() - monthStart.getTime()),
    monthStart.getTime()
  ));

  const orders = await loadOrders(businessId, prevStart, new Date(now.getTime() + 1000));

  const current = { total: 0, orders: 0 };
  const previous = { total: 0, orders: 0 };
  const productTotals = new Map();
  for (const order of orders) {
    if (order.date >= monthStart) {
      current.total += Number(order.total);
      current.orders += 1;
      const scale = orderScale(order);
      for (const item of order.items) {
        const row = productTotals.get(item.productId) || { units: 0, amount: 0 };
        row.units += Number(item.quantity);
        row.amount += Number(item.quantity) * Number(item.unitPrice) * scale;
        productTotals.set(item.productId, row);
      }
    } else if (order.date < prevEnd) {
      previous.total += Number(order.total);
      previous.orders += 1;
    }
  }

  const top = [...productTotals.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .slice(0, 5);
  const topProducts = await loadProductsMap(businessId, top.map(([id]) => id));

  // Los combos no tienen stock propio: no cuentan como stock bajo
  const stockWhere = { businessId, active: true, isCombo: false };
  const [lowStockCount, outOfStockCount, lowStockItems] = await Promise.all([
    Product.count({ where: { ...stockWhere, stock: { [Op.lte]: LOW_STOCK_THRESHOLD } } }),
    Product.count({ where: { ...stockWhere, stock: { [Op.lte]: 0 } } }),
    Product.findAll({
      where: { ...stockWhere, stock: { [Op.lte]: LOW_STOCK_THRESHOLD } },
      attributes: ['id', 'name', 'internalCode', 'stock'],
      order: [['stock', 'ASC'], ['name', 'ASC']],
      limit: 8,
    }),
  ]);

  res.json({
    month: { from: monthKey, total: round2(current.total), orders: current.orders },
    previous: { total: round2(previous.total), orders: previous.orders },
    topProducts: top.map(([productId, row]) => ({
      productId,
      name: topProducts.get(productId)?.name || 'Producto eliminado',
      units: row.units,
      amount: round2(row.amount),
    })),
    stock: {
      threshold: LOW_STOCK_THRESHOLD,
      lowCount: lowStockCount,
      outCount: outOfStockCount,
      items: lowStockItems.map((p) => ({
        id: p.id, name: p.name, code: p.internalCode, stock: p.stock,
      })),
    },
  });
});
