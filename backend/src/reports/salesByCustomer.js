import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { select, ORDERS_IN_RANGE, ORDER_DAY, customerName, loadCustomersMap } from './common.js';

export const salesByCustomer = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const rows = await select(
    `SELECT o.customer_id AS customerId, COUNT(*) AS orders, SUM(o.total) AS total, MAX(${ORDER_DAY}) AS lastPurchase
     FROM orders o
     WHERE ${ORDERS_IN_RANGE}
     GROUP BY o.customer_id`,
    { businessId, start, end },
  );
  const customers = await loadCustomersMap(
    businessId,
    rows.map((r) => r.customerId),
  );

  res.json({
    range: { from, to },
    customers: rows
      .map((r) => {
        const orders = Number(r.orders);
        const total = Number(r.total);
        return {
          customerId: r.customerId,
          name: customerName(customers.get(r.customerId)),
          orders,
          total: round2(total),
          lastPurchase: r.lastPurchase,
          avgTicket: round2(total / orders),
        };
      })
      .sort((a, b) => b.total - a.total),
  });
});
