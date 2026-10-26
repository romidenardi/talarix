import { Purchase, PurchaseItem, Product, Supplier, sequelize } from '../models/index.js';
import { lockProducts, moveStock, actorFields } from '../services/stock.service.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';
import {
  isPositiveQuantity, isNonNegative, toNumber, round2, round3, quantityAllowedFor,
} from '../utils/numbers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COST = 99999999;
const MAX_AGE_DAYS = 366;

const purchaseIncludes = [
  { model: Supplier, attributes: ['id', 'name'] },
  {
    model: PurchaseItem,
    as: 'items',
    include: [{ model: Product, attributes: ['id', 'name', 'internalCode', 'unitType'] }],
  },
];

const arDate = (date) =>
  new Date(date).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

// Para comparar números de factura escritos distinto: "A 0001-00001234" = "a0001 00001234"
const invoiceKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getPurchases = asyncHandler(async (req, res) => {
  const purchases = await Purchase.findAll({
    where: { businessId: req.user.businessId },
    include: purchaseIncludes,
    order: [['date', 'DESC']],
  });
  res.json(purchases);
});

export const createPurchase = asyncHandler(async (req, res) => {
  const { supplierId, date, items } = req.body;
  const { businessId } = req.user;
  const requestId = cleanRequestId(req.body.requestId);
  const invoiceNumber = req.body.invoiceNumber ? String(req.body.invoiceNumber).trim().slice(0, 255) || null : null;

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
    if (!isNonNegative(item.unitCost) || toNumber(item.unitCost) > MAX_COST) {
      throw httpError(`Artículo ${n}: el costo no es válido`);
    }
    return {
      productId: item.productId,
      quantity: round3(toNumber(item.quantity)),
      unitCost: round2(toNumber(item.unitCost)),
    };
  });

  // Fecha: si viene, no puede ser futura ni de hace más de un año (casi seguro es un error de tipeo)
  let purchaseDate = new Date();
  if (date) {
    purchaseDate = new Date(date);
    if (Number.isNaN(purchaseDate.getTime())) throw httpError('La fecha no es válida');
    if (purchaseDate.getTime() > Date.now() + DAY_MS) throw httpError('La fecha de la compra no puede ser futura');
    if (purchaseDate.getTime() < Date.now() - MAX_AGE_DAYS * DAY_MS) {
      throw httpError('La fecha de la compra es de hace más de un año: revisala');
    }
  }

  const t = await sequelize.transaction();
  let purchaseId;
  try {
    const supplier = await Supplier.findOne({ where: { id: supplierId, businessId }, transaction: t });
    if (!supplier) throw httpError('Proveedor no encontrado', 404);

    // La misma factura del mismo proveedor ya cargada (y no anulada): se avisa, salvo que el usuario
    // confirme que es correcto cargarla otra vez (confirmDuplicateInvoice)
    if (invoiceNumber && req.body.confirmDuplicateInvoice !== true) {
      const key = invoiceKey(invoiceNumber);
      const sameSupplier = await Purchase.findAll({
        where: { businessId, supplierId: supplier.id, status: 'active' },
        attributes: ['id', 'invoiceNumber', 'date', 'total'],
        transaction: t,
      });
      const duplicate = key && sameSupplier.find((p) => invoiceKey(p.invoiceNumber) === key);
      if (duplicate) {
        throw httpError(
          `La factura ${invoiceNumber} de ${supplier.name} ya está cargada (compra del ${arDate(duplicate.date)} `
          + `por $${Number(duplicate.total).toFixed(2)}). Si la cargás de nuevo, el stock se suma dos veces.`,
          409,
          'DUPLICATE_INVOICE'
        );
      }
    }

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
        entry = { product, quantity: 0, amount: 0 };
        byProduct.set(row.productId, entry);
      }
      if (!quantityAllowedFor(entry.product, row.quantity)) {
        throw httpError(`Artículo ${index + 1}: ${entry.product.name} se maneja por unidad, la cantidad debe ser un entero`);
      }
      entry.quantity = round3(entry.quantity + row.quantity);
      entry.amount += row.quantity * row.unitCost;
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

    await PurchaseItem.bulkCreate(rows.map((row) => ({
      purchaseId: purchase.id,
      productId: row.productId,
      quantity: row.quantity,
      unitCost: row.unitCost,
    })), { transaction: t });

    for (const { product, quantity, amount } of byProduct.values()) {
      // Costo del producto: el promedio de esta compra (si el mismo producto vino en dos renglones
      // con costos distintos, pesa cada uno según su cantidad). Si todo vino a costo 0 (bonificado),
      // se conserva el costo que tenía.
      const averageCost = round2(amount / quantity);
      if (averageCost > 0) product.cost = averageCost;
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

// Anula una compra cargada por error: resta del stock lo que había sumado. Si ya no hay stock
// suficiente (se vendió parte), no se puede anular: se corrige con un ajuste de stock.
// El costo de los productos no se toca. Para corregir una compra: anularla y cargarla de nuevo.
export const cancelPurchase = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const reason = String(req.body?.reason || '').trim().slice(0, 255) || null;

  const t = await sequelize.transaction();
  let purchase;
  try {
    purchase = await Purchase.findOne({
      where: { id: req.params.id, businessId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!purchase) throw httpError('Compra no encontrada', 404);
    if (purchase.status === 'cancelled') throw httpError('La compra ya está anulada', 409);

    const items = await PurchaseItem.findAll({ where: { purchaseId: purchase.id }, transaction: t });
    const quantityByProduct = new Map();
    for (const item of items) {
      quantityByProduct.set(item.productId, round3((quantityByProduct.get(item.productId) || 0) + Number(item.quantity)));
    }
    const supplier = await Supplier.findOne({ where: { id: purchase.supplierId }, attributes: ['name'], transaction: t });
    const label = `compra a ${supplier?.name || 'proveedor'}${purchase.invoiceNumber ? `, factura ${purchase.invoiceNumber}` : ''}`;

    const locked = await lockProducts([...quantityByProduct.keys()], businessId, t);
    for (const [productId, quantity] of quantityByProduct) {
      const product = locked.get(productId);
      if (!product) throw httpError('Un producto de la compra ya no existe: no se puede anular', 409);
      if (Number(product.stock) < quantity) {
        throw httpError(
          `No se puede anular: de ${product.name} quedan ${Number(product.stock)} y la compra había sumado ${quantity}. `
          + 'Si ya vendiste parte, corregí el stock con un ajuste.',
          409
        );
      }
      await moveStock({
        product,
        type: 'out',
        delta: -quantity,
        reason: `Anulación de la ${label}`,
        actor: req.user,
      }, t);
    }

    await purchase.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
      cancelledById: req.user.id,
      cancelledByName: req.user.name ? String(req.user.name).slice(0, 100) : null,
    }, { transaction: t });

    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  await audit(req, { action: 'purchase.cancelled', targetType: 'purchase', targetId: purchase.id });

  const fullPurchase = await Purchase.findOne({
    where: { id: purchase.id, businessId },
    include: purchaseIncludes,
  });
  res.json(fullPurchase);
});
