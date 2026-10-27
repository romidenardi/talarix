import { Category } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { productTotals, loadProductsMap } from './common.js';

export const salesByProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const totals = await productTotals({ businessId, start, end });

  const products = await loadProductsMap(
    businessId,
    totals.map((t) => t.productId),
  );
  const categories = await Category.findAll({ where: { businessId }, attributes: ['id', 'name'] });
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const rows = totals
    .map(({ productId, units, amount }) => {
      const product = products.get(productId);
      return {
        productId,
        code: product?.internalCode || '',
        name: product?.name || 'Producto eliminado',
        category: (product?.categoryId && categoryName.get(product.categoryId)) || 'Sin categoría',
        units,
        amount: round2(amount),
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const byCategory = new Map();
  for (const row of rows) {
    const c = byCategory.get(row.category) || { category: row.category, units: 0, amount: 0 };
    c.units += row.units;
    c.amount += row.amount;
    byCategory.set(row.category, c);
  }

  res.json({
    range: { from, to },
    products: rows,
    categories: [...byCategory.values()]
      .map((c) => ({ ...c, amount: round2(c.amount) }))
      .sort((a, b) => b.amount - a.amount),
  });
});
