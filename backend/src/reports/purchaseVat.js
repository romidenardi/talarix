import pkg from 'sequelize';
import { Purchase, PurchaseItem, PurchaseExpense, Supplier } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { purchaseTotals } from '../utils/purchaseTotals.js';
import { salesVatByRate } from './vat.js';

const { Op } = pkg;

// IVA de las compras de un período (crédito fiscal), con productos, insumos y servicios. Cada compra
// se calcula como su factura, con purchaseTotals (el mismo cálculo que al cargarla), y se suma por
// alícuota. Las compras anuladas no cuentan. Las cargadas antes de que las compras tuvieran IVA
// quedan aparte, sin desglose.
export const purchaseVatByRate = async ({ businessId, start, end }) => {
  const purchases = await Purchase.findAll({
    where: { businessId, status: 'active', date: { [Op.gte]: start, [Op.lt]: end } },
    attributes: ['id', 'date', 'invoiceNumber', 'subtotal', 'vatAmount', 'total'],
    include: [
      { model: Supplier, attributes: ['id', 'name'] },
      { model: PurchaseItem, as: 'items', attributes: ['quantity', 'unitCost', 'vatRate'] },
      { model: PurchaseExpense, as: 'expenses', attributes: ['quantity', 'unitCost', 'vatRate'] },
    ],
    order: [['date', 'ASC']],
  });

  const byRate = new Map();
  const rows = [];
  const withoutVat = { purchases: 0, total: 0 };
  for (const purchase of purchases) {
    if (purchase.subtotal === null || purchase.items.some((item) => item.vatRate === null)) {
      withoutVat.purchases += 1;
      withoutVat.total += Number(purchase.total);
      continue;
    }
    // Productos, insumos y servicios de la factura
    const totals = purchaseTotals([...purchase.items, ...purchase.expenses]);
    for (const part of totals.byRate) {
      const row = byRate.get(part.rate) || { rate: part.rate, net: 0, vat: 0, total: 0 };
      row.net += part.net;
      row.vat += part.vat;
      row.total += part.total;
      byRate.set(part.rate, row);
    }
    rows.push({
      id: purchase.id,
      date: purchase.date,
      supplier: purchase.Supplier?.name || '',
      invoiceNumber: purchase.invoiceNumber || '',
      net: totals.subtotal,
      vat: totals.vatAmount,
      total: totals.total,
      byRate: totals.byRate,
    });
  }

  const rates = [...byRate.values()]
    .map((r) => ({ rate: r.rate, net: round2(r.net), vat: round2(r.vat), total: round2(r.total) }))
    .sort((a, b) => b.rate - a.rate);
  return {
    purchases: rows,
    byRate: rates,
    totals: {
      purchases: rows.length,
      net: round2(rates.reduce((sum, r) => sum + r.net, 0)),
      vat: round2(rates.reduce((sum, r) => sum + r.vat, 0)),
      total: round2(rates.reduce((sum, r) => sum + r.total, 0)),
    },
    withoutVat: { purchases: withoutVat.purchases, total: round2(withoutVat.total) },
  };
};

// Reporte de IVA compras: el detalle de cada factura (como un libro de IVA compras) y el resumen
export const purchaseVatReport = asyncHandler(async (req, res) => {
  const { from, to, start, end } = readRange(req.query);
  const result = await purchaseVatByRate({ businessId: req.user.businessId, start, end });
  res.json({ range: { from, to }, ...result });
});

// Posición de IVA de un período: débito fiscal (IVA de todas las ventas) menos crédito fiscal
// (IVA de las compras). Positivo: saldo a pagar; negativo: saldo a favor.
export const vatPositionReport = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);
  const [sales, purchases] = await Promise.all([
    salesVatByRate({ businessId, start, end, onlyDiscriminated: false }),
    purchaseVatByRate({ businessId, start, end }),
  ]);

  const debitRates = sales.byRate.map((r) => ({ rate: r.rate, net: r.net, vat: r.vat }));
  const debit = round2(debitRates.reduce((sum, r) => sum + r.vat, 0));
  const credit = purchases.totals.vat;

  // Una fila por alícuota, con lo de ventas y lo de compras lado a lado
  const rates = [...new Set([...debitRates.map((r) => r.rate), ...purchases.byRate.map((r) => r.rate)])].sort(
    (a, b) => b - a,
  );
  const byRate = rates.map((rate) => {
    const sale = debitRates.find((r) => r.rate === rate) || { net: 0, vat: 0 };
    const purchase = purchases.byRate.find((r) => r.rate === rate) || { net: 0, vat: 0 };
    return {
      rate,
      salesNet: sale.net,
      debit: sale.vat,
      purchasesNet: purchase.net,
      credit: purchase.vat,
      balance: round2(sale.vat - purchase.vat),
    };
  });

  res.json({
    range: { from, to },
    debit,
    credit,
    balance: round2(debit - credit),
    byRate,
    purchasesWithoutVat: purchases.withoutVat,
  });
});
