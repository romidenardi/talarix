import pkg from 'sequelize';
import { Purchase, PurchaseExpense, Supplier } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { purchaseTotals } from '../utils/purchaseTotals.js';
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from '../utils/expenseCategories.js';

const { Op } = pkg;

// Gastos de un período: los servicios cargados en las compras activas (alquiler, luz, fletes...),
// agrupados por categoría de gasto, con el detalle de cada uno. Cada servicio se calcula como un
// renglón de su factura (neto redondeado a centavos e IVA de su alícuota). No incluye productos ni
// insumos, que van al stock.
export const expensesReport = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const purchases = await Purchase.findAll({
    where: { businessId, status: 'active', date: { [Op.gte]: start, [Op.lt]: end } },
    attributes: ['id', 'date', 'invoiceNumber'],
    include: [
      { model: Supplier, attributes: ['id', 'name'] },
      { model: PurchaseExpense, as: 'expenses', required: true },
    ],
    order: [['date', 'ASC']],
  });

  const byCategory = new Map();
  const rows = [];
  for (const purchase of purchases) {
    for (const expense of purchase.expenses) {
      const { subtotal: net, vatAmount: vat, total } = purchaseTotals([expense]);
      const key = expense.category || null;
      const group = byCategory.get(key) || {
        category: key,
        label: expenseCategoryLabel(key),
        count: 0,
        net: 0,
        vat: 0,
        total: 0,
      };
      group.count += 1;
      group.net += net;
      group.vat += vat;
      group.total += total;
      byCategory.set(key, group);
      rows.push({
        id: expense.id,
        purchaseId: purchase.id,
        date: purchase.date,
        supplier: purchase.Supplier?.name || '',
        invoiceNumber: purchase.invoiceNumber || '',
        description: expense.description,
        category: key,
        categoryLabel: expenseCategoryLabel(key),
        net,
        vat,
        total,
      });
    }
  }

  // En el orden de la lista de categorías; «Sin categoría» al final
  const order = (key) => {
    const index = EXPENSE_CATEGORIES.findIndex((c) => c.value === key);
    return index === -1 ? EXPENSE_CATEGORIES.length : index;
  };
  const categories = [...byCategory.values()]
    .map((g) => ({ ...g, net: round2(g.net), vat: round2(g.vat), total: round2(g.total) }))
    .sort((a, b) => b.total - a.total || order(a.category) - order(b.category));

  res.json({
    range: { from, to },
    totals: {
      count: rows.length,
      net: round2(categories.reduce((sum, c) => sum + c.net, 0)),
      vat: round2(categories.reduce((sum, c) => sum + c.vat, 0)),
      total: round2(categories.reduce((sum, c) => sum + c.total, 0)),
    },
    categories,
    expenses: rows,
  });
});
