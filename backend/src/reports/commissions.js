import pkg from 'sequelize';
import { Order, User } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { round2 } from '../utils/numbers.js';
import { readRange } from '../utils/dates.js';
import { formatOrderNumber } from '../services/orderNumber.service.js';

const { Op } = pkg;

// Comisiones de un período (services/commission.service.js): por vendedor, los remitos activos que
// llevan comisión, lo vendido y la comisión, con el detalle de cada remito para liquidarla. Usa la
// foto guardada en cada remito (vendedor, % e importe), no el % actual del usuario.
// enabled: si algún usuario tiene comisión o hubo comisiones en el período (si no, la pantalla no
// muestra la solapa).
export const commissionsReport = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { from, to, start, end } = readRange(req.query);

  const [orders, users] = await Promise.all([
    Order.findAll({
      where: {
        businessId,
        status: 'active',
        date: { [Op.gte]: start, [Op.lt]: end },
        commissionAmount: { [Op.ne]: null },
      },
      attributes: [
        'id',
        'number',
        'date',
        'total',
        'sellerId',
        'sellerName',
        'commissionRate',
        'commissionAmount',
        'tableTabId',
      ],
      order: [
        ['date', 'ASC'],
        ['number', 'ASC'],
      ],
    }),
    User.findAll({ where: { businessId }, attributes: ['id', 'name', 'commissionRate', 'active'] }),
  ]);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const bySeller = new Map();
  const rows = orders.map((o) => {
    const key = o.sellerId || o.sellerName || 'sin-vendedor';
    const user = o.sellerId ? usersById.get(o.sellerId) : null;
    const name = user?.name || o.sellerName || 'Sin vendedor';
    const group = bySeller.get(key) || {
      sellerId: o.sellerId,
      name,
      currentRate: user?.commissionRate === null || !user ? null : Number(user.commissionRate),
      count: 0,
      sales: 0,
      commission: 0,
    };
    group.count += 1;
    group.sales += Number(o.total);
    group.commission += Number(o.commissionAmount);
    bySeller.set(key, group);
    return {
      id: o.id,
      number: formatOrderNumber(o),
      date: o.date,
      seller: name,
      sellerId: o.sellerId,
      table: Boolean(o.tableTabId),
      total: round2(Number(o.total)),
      rate: Number(o.commissionRate),
      commission: round2(Number(o.commissionAmount)),
    };
  });

  const sellers = [...bySeller.values()]
    .map((g) => ({ ...g, sales: round2(g.sales), commission: round2(g.commission) }))
    .sort((a, b) => b.commission - a.commission || a.name.localeCompare(b.name, 'es'));

  res.json({
    range: { from, to },
    enabled: users.some((u) => u.commissionRate !== null && Number(u.commissionRate) > 0) || rows.length > 0,
    totals: {
      count: rows.length,
      sales: round2(sellers.reduce((sum, s) => sum + s.sales, 0)),
      commission: round2(sellers.reduce((sum, s) => sum + s.commission, 0)),
    },
    sellers,
    orders: rows,
  });
});
