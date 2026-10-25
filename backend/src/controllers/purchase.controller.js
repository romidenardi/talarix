import { Purchase, PurchaseItem, Product, Supplier, sequelize } from '../models/index.js';
import { lockProducts, moveStock, actorFields } from '../services/stock.service.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import {
  isPositiveQuantity, isNonNegative, toNumber, round2, round3, quantityAllowedFor,
} from '../utils/numbers.js';

const purchaseIncludes = [
  { model: Supplier, attributes: ['id', 'name'] },
  {
    model: PurchaseItem,
    as: 'items',
    include: [{ model: Product, attributes: ['id', 'name', 'internalCode', 'unitType'] }],
  },
];

export const getPurchases = asyncHandler(async (req, res) => {
  const purchases = await Purchase.findAll({
    where: { businessId: req.user.businessId },
    include: purchaseIncludes,
    order: [['date', 'DESC']],
  });
  res.json(purchases);
});

export const createPurchase = asyncHandler(async (req, res) => {
  const { supplierId, invoiceNumber, date, items } = req.body;
  const { businessId } = req.user;
  const requestId = cleanRequestId(req.body.requestId);

  // El mismo envío ya se procesó (doble clic o reintento): se devuelve esa compra, no se crea otra
  const sendExisting = async (id) => {
    const existing = await Purchase.findOne({ where: { id, businessId }, include: purchaseIncludes });
    res.status(200).json(existing);
  };
  if (requestId) {
    const previous = await Purchase.findOne({ where: { businessId, requestId }, attributes: ['id'] });
    if (previous) return sendExisting(previous.id);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('La compra debe tener al menos un artículo');
  }

  const rows = items.map((item, index) => {
    const n = index + 1;
    if (!item || typeof item.productId !== 'string' || !item.productId) throw httpError(`Artículo ${n}: falta el producto`);
    if (!isPositiveQuantity(item.quantity)) {
      throw httpError(`Artículo ${n}: la cantidad debe ser un número mayor a 0, con hasta 3 decimales`);
    }
    if (!isNonNegative(item.unitCost)) throw httpError(`Artículo ${n}: el costo no es válido`);
    return {
      productId: item.productId,
      quantity: round3(toNumber(item.quantity)),
      unitCost: toNumber(item.unitCost),
    };
  });

  let purchaseDate = new Date();
  if (date) {
    purchaseDate = new Date(date);
    if (Number.isNaN(purchaseDate.getTime())) throw httpError('La fecha no es válida');
  }

  const t = await sequelize.transaction();
  let purchaseId;
  try {
    const supplier = await Supplier.findOne({ where: { id: supplierId, businessId }, transaction: t });
    if (!supplier) throw httpError('Proveedor no encontrado', 404);

    // Los productos se bloquean ordenados por id, igual que al vender (evita deadlocks)
    const locked = await lockProducts(rows.map((r) => r.productId), businessId, t);
    const byProduct = new Map();
    let total = 0;
    for (const [index, row] of rows.entries()) {
      let entry = byProduct.get(row.productId);
      if (!entry) {
        const product = locked.get(row.productId);
        if (!product) throw httpError(`Producto no encontrado: ${row.productId}`, 404);
        if (product.isCombo) {
          throw httpError(`Artículo ${index + 1}: ${product.name} es un combo. Cargá la compra de los productos que lo forman.`);
        }
        entry = { product, quantity: 0, lastCost: row.unitCost };
        byProduct.set(row.productId, entry);
      }
      if (!quantityAllowedFor(entry.product, row.quantity)) {
        throw httpError(`Artículo ${index + 1}: ${entry.product.name} se maneja por unidad, la cantidad debe ser un entero`);
      }
      entry.quantity = round3(entry.quantity + row.quantity);
      entry.lastCost = row.unitCost;
      total += row.quantity * row.unitCost;
    }

    const purchase = await Purchase.create({
      supplierId: supplier.id,
      invoiceNumber,
      date: purchaseDate,
      total: round2(total),
      requestId,
      businessId,
      ...actorFields(req.user),
    }, { transaction: t });
    purchaseId = purchase.id;

    for (const row of rows) {
      await PurchaseItem.create({
        purchaseId: purchase.id,
        productId: row.productId,
        quantity: row.quantity,
        unitCost: row.unitCost,
      }, { transaction: t });
    }

    for (const { product, quantity, lastCost } of byProduct.values()) {
      product.cost = lastCost; // se guarda junto con el stock
      await moveStock({
        product,
        type: 'in',
        delta: quantity,
        reason: `Compra a ${supplier.name}${invoiceNumber ? `, factura ${invoiceNumber}` : ''}`,
        actor: req.user,
      }, t);
    }

    await t.commit();
  } catch (error) {
    await t.rollback();
    // Dos envíos iguales al mismo tiempo: el otro ya la creó
    if (requestId && isDuplicateRequest(error)) {
      const previous = await Purchase.findOne({ where: { businessId, requestId }, attributes: ['id'] });
      if (previous) return sendExisting(previous.id);
    }
    throw error;
  }

  const fullPurchase = await Purchase.findOne({
    where: { id: purchaseId, businessId },
    include: purchaseIncludes,
  });
  res.status(201).json(fullPurchase);
});
