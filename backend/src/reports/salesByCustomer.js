import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { dayKey, readRange } from '../utils/dates.js';
import { loadOrders, customerName } from './common.js';

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
