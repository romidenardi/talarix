import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { select, ORDERS_IN_RANGE, loadPaymentsMap } from './common.js';

export const salesByPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const rows = await select(
    `SELECT o.payment_id AS paymentId, COUNT(*) AS orders, SUM(o.total) AS total,
       SUM(o.installment_plan_id IS NOT NULL) AS installmentOrders,
       SUM(CASE WHEN o.installment_plan_id IS NOT NULL THEN COALESCE(o.total_financed, 0) ELSE 0 END) AS financed
     FROM orders o
     WHERE ${ORDERS_IN_RANGE}
     GROUP BY o.payment_id`,
    { businessId, start, end },
  );
  const payments = await loadPaymentsMap(
    businessId,
    rows.map((r) => r.paymentId),
  );
  const grandTotal = rows.reduce((sum, r) => sum + Number(r.total), 0);

  res.json({
    range: { from, to },
    payments: rows
      .map((r) => {
        const total = Number(r.total);
        return {
          paymentId: r.paymentId,
          name: payments.get(r.paymentId)?.name || 'Sin forma de pago',
          orders: Number(r.orders),
          total: round2(total),
          installmentOrders: Number(r.installmentOrders),
          financed: round2(Number(r.financed)),
          share: grandTotal > 0 ? round2((total / grandTotal) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total),
  });
});
