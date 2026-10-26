import pkg from 'sequelize';
import { Product } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { dayKey, startOfDay } from '../utils/dates.js';
import { LOW_STOCK_THRESHOLD, loadOrders, orderScale, loadProductsMap } from './common.js';

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

  const top = [...productTotals.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);
  const topProducts = await loadProductsMap(
    businessId,
    top.map(([id]) => id),
  );

  // Los combos no tienen stock propio: no cuentan como stock bajo
  const stockWhere = { businessId, active: true, isCombo: false };
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
        id: p.id,
        name: p.name,
        code: p.internalCode,
        stock: p.stock,
      })),
    },
  });
});
