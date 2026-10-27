import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { startOfDay, addDays, periodKey, readRange } from '../utils/dates.js';
import { select, ordersWithGross } from './common.js';

export const salesSummary = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);
  const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy) ? req.query.groupBy : 'day';

  // Un renglón por día; las semanas y los meses se arman acá con esos días
  const days = await select(
    `SELECT t.day, COUNT(*) AS orders, SUM(t.gross) AS gross, SUM(GREATEST(t.gross - t.total, 0)) AS discounts,
       SUM(t.total) AS total, SUM(t.installment_plan_id IS NOT NULL) AS installmentOrders,
       SUM(CASE WHEN t.installment_plan_id IS NOT NULL THEN COALESCE(t.total_financed, 0) ELSE 0 END) AS financed
     FROM (${ordersWithGross()}) t
     GROUP BY t.day`,
    { businessId, start, end },
  );

  const series = new Map();
  for (let key = from; key <= to; key = addDays(key, 1)) {
    const k = periodKey(startOfDay(key), groupBy);
    if (!series.has(k)) series.set(k, { period: k, orders: 0, total: 0 });
  }

  const totals = { orders: 0, gross: 0, discounts: 0, total: 0, installmentOrders: 0, financed: 0 };
  for (const day of days) {
    for (const field of Object.keys(totals)) totals[field] += Number(day[field]) || 0;
    const bucket = series.get(periodKey(startOfDay(day.day), groupBy));
    if (bucket) {
      bucket.orders += Number(day.orders);
      bucket.total += Number(day.total);
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
