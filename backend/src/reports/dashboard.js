import pkg from 'sequelize';
import { Product } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { dayKey, startOfDay } from '../utils/dates.js';
import { LOW_STOCK_THRESHOLD, select, ORDERS_IN_RANGE, productTotals, loadProductsMap } from './common.js';

const { Op } = pkg;

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
  const prevEnd = new Date(
    Math.min(prevStart.getTime() + (now.getTime() - monthStart.getTime()), monthStart.getTime()),
  );

  const nowEnd = new Date(now.getTime() + 1000);
  const sumOrders = (start, end) =>
    select(`SELECT COUNT(*) AS orders, SUM(o.total) AS total FROM orders o WHERE ${ORDERS_IN_RANGE}`, {
      businessId,
      start,
      end,
    }).then(([row]) => ({ orders: Number(row?.orders) || 0, total: Number(row?.total) || 0 }));

  const [current, previous, top] = await Promise.all([
    sumOrders(monthStart, nowEnd),
    sumOrders(prevStart, prevEnd),
    productTotals({ businessId, start: monthStart, end: nowEnd, limit: 5 }),
  ]);

  const topProducts = await loadProductsMap(
    businessId,
    top.map((t) => t.productId),
  );

  // Los combos y los productos con variantes no tienen stock propio: no cuentan como stock bajo
  const stockWhere = { businessId, active: true, isCombo: false, variantAttributes: null };
  const [lowStockCount, outOfStockCount, lowStockItems] = await Promise.all([
    Product.count({ where: { ...stockWhere, stock: { [Op.lte]: LOW_STOCK_THRESHOLD } } }),
    Product.count({ where: { ...stockWhere, stock: { [Op.lte]: 0 } } }),
    Product.findAll({
      where: { ...stockWhere, stock: { [Op.lte]: LOW_STOCK_THRESHOLD } },
      attributes: ['id', 'name', 'internalCode', 'stock'],
      order: [
        ['stock', 'ASC'],
        ['name', 'ASC'],
      ],
      limit: 8,
    }),
  ]);

  res.json({
    month: { from: monthKey, total: round2(current.total), orders: current.orders },
    previous: { total: round2(previous.total), orders: previous.orders },
    topProducts: top.map(({ productId, units, amount }) => ({
      productId,
      name: topProducts.get(productId)?.name || 'Producto eliminado',
      units,
      amount: round2(amount),
    })),
    stock: {
      threshold: LOW_STOCK_THRESHOLD,
      lowCount: lowStockCount,
      outCount: outOfStockCount,
      items: lowStockItems.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.internalCode,
        stock: p.stock,
      })),
    },
  });
});
