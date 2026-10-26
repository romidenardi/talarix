import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { splitPrice, splitLineParts } from '../utils/taxes.js';
import { readRange } from '../utils/dates.js';
import { loadOrders, orderScale, loadProductsMap } from './common.js';

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
      .map((r) => ({
        rate: r.rate,
        net: round2(r.net),
        vat: round2(r.vat),
        internal: round2(r.internal),
        total: round2(r.total),
      }))
      .sort((a, b) => b.rate - a.rate),
    byInternalRate: [...byInternalRate.values()]
      .map((r) => ({ rate: r.rate, net: round2(r.net), internal: round2(r.internal), total: round2(r.total) }))
      .sort((a, b) => b.rate - a.rate),
  });
});
