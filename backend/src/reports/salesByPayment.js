import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { select, ORDERS_IN_RANGE, loadPaymentsMap } from './common.js';

export const salesByPayment = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  // Un remito cobrado en partes (mesa con la cuenta dividida) cuenta en cada forma de pago por su parte
  const rows = await select(
    `SELECT x.paymentId, COUNT(DISTINCT x.orderId) AS orders, SUM(x.amount) AS total,
       SUM(x.installment) AS installmentOrders, SUM(x.financed) AS financed
     FROM (
       SELECT o.id AS orderId, o.payment_id AS paymentId, o.total AS amount,
         (o.installment_plan_id IS NOT NULL) AS installment,
         CASE WHEN o.installment_plan_id IS NOT NULL THEN COALESCE(o.total_financed, 0) ELSE 0 END AS financed
       FROM orders o
       WHERE ${ORDERS_IN_RANGE} AND NOT EXISTS (SELECT 1 FROM order_payments p WHERE p.order_id = o.id)
       UNION ALL
       SELECT o.id, op.payment_id, op.amount, 0, 0
       FROM orders o
       JOIN order_payments op ON op.order_id = o.id
       WHERE ${ORDERS_IN_RANGE}
     ) x
     GROUP BY x.paymentId`,
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
