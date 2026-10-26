import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { startOfDay, addDays, periodKey, readRange } from '../utils/dates.js';
import { loadOrders, orderGross } from './common.js';

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
