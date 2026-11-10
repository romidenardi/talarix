import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { splitPrice, splitLineParts } from '../utils/taxes.js';
import { readRange } from '../utils/dates.js';
import { select, ORDERS_IN_RANGE, ordersWithGross, lineAmount } from './common.js';

// Combo: renglón con la lista de sus productos guardada al vender
const IS_COMBO = `COALESCE(JSON_TYPE(i.components) = 'ARRAY' AND JSON_LENGTH(i.components) > 0, 0)`;

// Mismo redondeo por renglón que al generar el remito (services/orderPricing.js)
const LINE_TOTAL = lineAmount('ROUND(i.quantity * i.unit_price, 2)');

const parseComponents = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// IVA de las ventas sumado por alícuota (y los impuestos internos por porcentaje), con los
// descuentos de cada remito repartidos. onlyDiscriminated: solo los remitos a Responsables
// Inscriptos (reporte de IVA ventas); sin eso, todas las ventas (débito fiscal de la posición de IVA,
// que incluye el IVA contenido en los remitos a consumidores finales y monotributistas).
export const salesVatByRate = async ({ businessId, start, end, onlyDiscriminated }) => {
  const params = { businessId, start, end };
  const filter = onlyDiscriminated ? 'AND o.discriminates_vat = 1' : '';
  const [rateRows, comboRows] = await Promise.all([
    // Renglones comunes, sumados por alícuota. El IVA es el guardado al vender; los remitos
    // anteriores a esa columna usan el actual del producto.
    select(
      `SELECT x.rate, x.internalRate, SUM(x.lineTotal) AS total
       FROM (
         SELECT
           CASE WHEN i.vat_rate IS NOT NULL THEN i.vat_rate ELSE COALESCE(p.vat_rate, 0) END AS rate,
           CASE WHEN i.vat_rate IS NOT NULL THEN COALESCE(i.other_taxes, 0) ELSE COALESCE(p.other_taxes, 0) END
             AS internalRate,
           ${LINE_TOTAL} AS lineTotal
         FROM order_items i
         JOIN (${ordersWithGross(filter)}) t ON t.id = i.order_id
         LEFT JOIN products p ON p.id = i.product_id AND p.business_id = :businessId
         WHERE ${IS_COMBO} = 0
       ) x
       GROUP BY x.rate, x.internalRate`,
      params,
    ),
    // Combos: se reparten acá entre sus productos con los datos guardados al vender
    select(
      `SELECT i.components, ${LINE_TOTAL} AS lineTotal
       FROM order_items i
       JOIN (${ordersWithGross(filter)}) t ON t.id = i.order_id
       WHERE ${IS_COMBO} = 1`,
      params,
    ),
  ]);

  const byRate = new Map();
  const byInternalRate = new Map();
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

  // La división del IVA es proporcional, así que da lo mismo dividir cada renglón o la suma
  for (const row of rateRows) {
    const vatRate = Number(row.rate) || 0;
    const internalRate = Number(row.internalRate) || 0;
    const total = Number(row.total);
    addPart({ vatRate, internalRate, total, ...splitPrice(total, vatRate, internalRate) });
  }
  for (const row of comboRows) {
    const components = parseComponents(row.components);
    if (Array.isArray(components) && components.length) {
      splitLineParts(Number(row.lineTotal), components).forEach(addPart);
    }
  }

  return {
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
  };
};

export const vatReport = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const [totalsRows, { byRate, byInternalRate }] = await Promise.all([
    // Totales de los remitos con y sin IVA discriminado
    select(
      `SELECT o.discriminates_vat AS discriminates, COUNT(*) AS orders, SUM(COALESCE(o.subtotal, 0)) AS net,
         SUM(COALESCE(o.vat_amount, 0)) AS vat, SUM(COALESCE(o.internal_tax_amount, 0)) AS internal,
         SUM(o.total) AS total
       FROM orders o
       WHERE ${ORDERS_IN_RANGE}
       GROUP BY o.discriminates_vat`,
      { businessId, start, end },
    ),
    salesVatByRate({ businessId, start, end, onlyDiscriminated: true }),
  ]);

  const discriminated = { orders: 0, net: 0, vat: 0, internal: 0, total: 0 };
  const notDiscriminated = { orders: 0, total: 0 };
  for (const row of totalsRows) {
    if (Number(row.discriminates)) {
      discriminated.orders += Number(row.orders);
      discriminated.net += Number(row.net);
      discriminated.vat += Number(row.vat);
      discriminated.internal += Number(row.internal);
      discriminated.total += Number(row.total);
    } else {
      notDiscriminated.orders += Number(row.orders);
      notDiscriminated.total += Number(row.total);
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
    byRate,
    byInternalRate,
  });
});
