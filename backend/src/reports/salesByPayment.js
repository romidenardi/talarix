import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { loadOrders } from './common.js';

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
