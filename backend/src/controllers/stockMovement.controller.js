import { StockMovement, Product, sequelize } from '../models/index.js';
import { lockProducts, moveStock } from '../services/stock.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import {
  isPositiveQuantity, isNonNegativeQuantity, toNumber, round3, quantityAllowedFor,
} from '../utils/numbers.js';

export const getMovementsByProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { businessId } = req.user;

  const product = await Product.findOne({ where: { id: productId, businessId } });
  if (!product) throw httpError('Producto no encontrado', 404);

  const movements = await StockMovement.findAll({
    where: { productId, businessId },
    order: [['date', 'DESC']],
  });
  res.json(movements);
});

export const createStockMovement = asyncHandler(async (req, res) => {
  const { productId, type, quantity, newStock } = req.body;
  const { businessId } = req.user;
  const reason = req.body.reason ? String(req.body.reason).slice(0, 255) : null;

  if (!['in', 'out', 'adjustment'].includes(type)) throw httpError('Tipo de movimiento inválido');

  if (type === 'adjustment') {
    if (!isNonNegativeQuantity(newStock)) {
      throw httpError('El stock nuevo debe ser un número mayor o igual a 0, con hasta 3 decimales');
    }
  } else if (!isPositiveQuantity(quantity)) {
    throw httpError('La cantidad debe ser un número mayor a 0, con hasta 3 decimales');
  }

  const t = await sequelize.transaction();
  try {
    const product = typeof productId === 'string'
      ? (await lockProducts([productId], businessId, t)).get(productId)
      : null;
    if (!product) throw httpError('Producto no encontrado', 404);
    if (product.isCombo) throw httpError('Un combo no tiene stock propio: se calcula con sus productos');

    const amount = round3(toNumber(type === 'adjustment' ? newStock : quantity));
    if (!quantityAllowedFor(product, amount)) {
      throw httpError('Este producto se maneja por unidad: usá cantidades enteras');
    }

    let delta;
    if (type === 'in') delta = amount;
    else if (type === 'out') delta = -amount;
    else delta = round3(amount - Number(product.stock)); // ajuste: queda exactamente en el stock nuevo

    const movement = await moveStock({ product, type, delta, reason, actor: req.user }, t);

    await t.commit();
    res.status(201).json({ movement, newStock: product.stock });
  } catch (error) {
    await t.rollback();
    throw error;
  }
});
