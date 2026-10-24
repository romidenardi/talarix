import {
  Order, OrderItem, Product, Customer, Payment, InstallmentPlan, StockMovement, sequelize,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { splitPrice, splitLineParts } from '../utils/taxes.js';
import { loadComboComponents } from '../services/combo.service.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { audit } from '../utils/audit.js';
import { APPROVER_ROLES, approvalSummary, checkApproval } from '../services/orderApproval.service.js';
import {
  isPositiveQuantity, isNonNegative, toNumber, toNumberOrZero, round2, round3,
  quantityAllowedFor, unitWord,
} from '../utils/numbers.js';

const FISCAL_CONDITIONS_WITH_VAT_BREAKDOWN = ['Responsable Inscripto'];
const ROLES_THAT_CAN_ADD_STOCK = ['admin', 'editor'];

const orderIncludes = [
  { model: Customer },
  { model: Payment, attributes: ['id', 'name'] },
  {
    model: OrderItem,
    as: 'items',
    include: [{ model: Product, attributes: ['id', 'name', 'internalCode', 'unitType'] }],
  },
];

export const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.findAll({
    where: { businessId: req.user.businessId },
    include: orderIncludes,
    order: [['date', 'DESC']],
  });
  res.json(orders);
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({
    where: { id: req.params.id, businessId: req.user.businessId },
    include: orderIncludes,
  });
  if (!order) throw httpError('Remito no encontrado', 404);
  res.json(order);
});

export const createOrder = asyncHandler(async (req, res) => {
  const { customerId, paymentId, installmentPlanId, items, notes } = req.body;
  const { businessId, role, id: userId } = req.user;
  const requestId = cleanRequestId(req.body.requestId);

  // El mismo envío ya se procesó (doble clic o reintento): se devuelve ese remito, no se crea otro
  const sendExisting = async (id) => {
    const existing = await Order.findOne({ where: { id, businessId }, include: orderIncludes });
    res.status(200).json(existing);
  };
  if (requestId) {
    const previous = await Order.findOne({ where: { businessId, requestId }, attributes: ['id'] });
    if (previous) return sendExisting(previous.id);
  }

  // ---- Validación de entrada ----
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('El pedido debe tener al menos un artículo');
  }

  const rows = items.map((item, index) => {
    const n = index + 1;
    if (!item || !item.productId) throw httpError(`Artículo ${n}: falta el producto`);
    if (!isPositiveQuantity(item.quantity)) {
      throw httpError(`Artículo ${n}: la cantidad debe ser un número mayor a 0, con hasta 3 decimales`);
    }
    if (!isNonNegative(item.unitPrice)) throw httpError(`Artículo ${n}: el precio no es válido`);
    return {
      productId: item.productId,
      quantity: round3(toNumber(item.quantity)),
      unitPrice: toNumber(item.unitPrice),
      addStock: item.addStock === true,
    };
  });

  const discountPercent = toNumberOrZero(req.body.discountPercent);
  const discountAmount = toNumberOrZero(req.body.discountAmount);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw httpError('El porcentaje de descuento debe estar entre 0 y 100');
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    throw httpError('El descuento por monto no es válido');
  }

  const t = await sequelize.transaction();
  let orderId;
  try {
    const customer = await Customer.findOne({ where: { id: customerId, businessId }, transaction: t });
    if (!customer) throw httpError('Cliente no encontrado', 404);

    const payment = await Payment.findOne({ where: { id: paymentId, businessId }, transaction: t });
    if (!payment) throw httpError('Forma de pago no encontrada', 404);
    if (!payment.active) throw httpError(`La forma de pago ${payment.name} está inactiva. Elegí otra.`);

    let installmentPlan = null;
    if (installmentPlanId) {
      installmentPlan = await InstallmentPlan.findOne({
        where: { id: installmentPlanId, paymentId: payment.id, active: true },
        transaction: t,
      });
      if (!installmentPlan) throw httpError('Plan de cuotas no encontrado', 404);
    }

    const rowProducts = await Product.findAll({
      where: { id: [...new Set(rows.map((r) => r.productId))], businessId },
      transaction: t,
    });
    const rowProductMap = new Map(rowProducts.map((p) => [p.id, p]));
    for (const [index, row] of rows.entries()) {
      const rowProduct = rowProductMap.get(row.productId);
      if (!rowProduct) throw httpError(`Producto no encontrado: ${row.productId}`, 404);
      if (!rowProduct.active) {
        throw httpError(`Artículo ${index + 1}: ${rowProduct.name} está inactivo. Activalo en Productos o elegí otro.`);
      }
      if (!quantityAllowedFor(rowProduct, row.quantity)) {
        throw httpError(`Artículo ${index + 1}: ${rowProduct.name} se vende por unidad, la cantidad debe ser un entero`);
      }
    }

    // El operador vende a precio de lista y sin descuentos, salvo que lo autorice un administrador o editor
    let approver = null;
    let approval = null;
    if (!APPROVER_ROLES.includes(role)) {
      approval = approvalSummary({ rows, productMap: rowProductMap, discountPercent, discountAmount });
      if (approval.needed) {
        approver = await checkApproval(req.body.approvalToken, {
          requesterId: userId, businessId, requestId, summary: approval,
        });
      }
    }

    const comboComponents = await loadComboComponents(
      rowProducts.filter((p) => p.isCombo).map((p) => p.id),
      businessId,
      t
    );

    const requested = new Map();
    const addStockFor = new Set();
    const viaCombo = new Set();
    for (const row of rows) {
      const rowProduct = rowProductMap.get(row.productId);
      if (rowProduct.isCombo) {
        const components = comboComponents.get(row.productId) || [];
        if (!components.length) throw httpError(`El combo ${rowProduct.name} no tiene productos cargados`);
        for (const component of components) {
          requested.set(
            component.productId,
            round3((requested.get(component.productId) || 0) + row.quantity * component.quantity)
          );
          viaCombo.add(component.productId);
        }
      } else {
        requested.set(row.productId, round3((requested.get(row.productId) || 0) + row.quantity));
        if (row.addStock) addStockFor.add(row.productId);
      }
    }

    const stockPlan = new Map();
    for (const [productId, qty] of requested) {
      const product = await Product.findOne({
        where: { id: productId, businessId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!product) throw httpError(`Producto no encontrado: ${productId}`, 404);

      const shortfall = round3(Math.max(qty - product.stock, 0));
      if (shortfall > 0) {
        if (!addStockFor.has(productId)) {
          const forCombo = viaCombo.has(productId) ? ' (necesario para un combo)' : '';
          throw httpError(`Stock insuficiente para ${product.name}${forCombo} (disponible: ${product.stock}, pedido: ${qty})`);
        }
        if (!ROLES_THAT_CAN_ADD_STOCK.includes(role)) {
          throw httpError(
            `No tenés permisos para agregar stock a ${product.name}. Pedile a un administrador o editor que lo cargue.`,
            403
          );
        }
      }
      stockPlan.set(productId, { product, qty, shortfall });
    }

    const discriminatesVat = FISCAL_CONDITIONS_WITH_VAT_BREAKDOWN.includes(customer.fiscalCondition);

    let grossSubtotal = 0;
    let grossVat = 0;
    let grossInternal = 0;
    let grossTotal = 0;
    for (const row of rows) {
      const itemTotal = round2(row.quantity * row.unitPrice);
      let parts;
      if (rowProductMap.get(row.productId).isCombo) {
        row.components = comboComponents.get(row.productId).map((c) => ({
          productId: c.productId,
          name: c.product.name,
          internalCode: c.product.internalCode,
          quantity: c.quantity,
          price: Number(c.product.price) || 0,
          vatRate: Number(c.product.vatRate) || 0,
          otherTaxes: Number(c.product.otherTaxes) || 0,
        }));
        parts = splitLineParts(itemTotal, row.components);
      } else {
        const { product } = stockPlan.get(row.productId);
        parts = [splitPrice(itemTotal, product.vatRate, product.otherTaxes)];
      }
      for (const part of parts) {
        grossSubtotal += part.net;
        grossVat += part.vat;
        grossInternal += part.internal;
      }
      grossTotal += itemTotal;
    }

    const totalDiscount = grossTotal * (discountPercent / 100) + discountAmount;
    if (totalDiscount > grossTotal + 0.005) {
      throw httpError('El descuento no puede ser mayor al total del remito');
    }

    const total = round2(grossTotal - totalDiscount);
    const scale = grossTotal > 0 ? total / grossTotal : 1;
    const subtotal = discriminatesVat ? round2(grossSubtotal * scale) : null;
    const vatAmount = discriminatesVat ? round2(grossVat * scale) : null;
    const internalTaxAmount = discriminatesVat ? round2(grossInternal * scale) : null;

    let installmentsCount = null;
    let interestRate = null;
    let installmentAmount = null;
    let totalFinanced = null;
    if (installmentPlan) {
      installmentsCount = installmentPlan.installments;
      interestRate = Number(installmentPlan.interestRate);
      totalFinanced = round2(total * (1 + interestRate / 100));
      installmentAmount = round2(totalFinanced / installmentsCount);
    }

    const order = await Order.create({
      customerId: customer.id,
      paymentId: payment.id,
      installmentPlanId: installmentPlan ? installmentPlan.id : null,
      notes,
      grossTotal: round2(grossTotal),
      discountPercent,
      discountAmount,
      total,
      subtotal,
      vatAmount,
      internalTaxAmount,
      discriminatesVat,
      installmentsCount,
      interestRate,
      installmentAmount,
      totalFinanced,
      requestId,
      businessId,
    }, { transaction: t });
    orderId = order.id;

    for (const row of rows) {
      await OrderItem.create({
        orderId: order.id,
        productId: row.productId,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        components: row.components || null,
      }, { transaction: t });
    }

    const customerName = customer.businessName || customer.firstName;
    for (const { product, qty, shortfall } of stockPlan.values()) {
      if (shortfall > 0) {
        await StockMovement.create({
          businessId,
          productId: product.id,
          type: 'in',
          quantity: shortfall,
          reason: `Ajuste desde remito a ${customerName}: faltaban ${shortfall} ${unitWord(product)}`,
        }, { transaction: t });
      }

      await StockMovement.create({
        businessId,
        productId: product.id,
        type: 'out',
        quantity: -qty,
        reason: `Remito a cliente ${customerName}${viaCombo.has(product.id) ? ' (incluye combos)' : ''}`,
      }, { transaction: t });

      product.stock = round3(product.stock + shortfall - qty);
      await product.save({ transaction: t });
    }

    await t.commit();
  } catch (error) {
    await t.rollback();
    // Dos envíos iguales al mismo tiempo: el otro ya lo creó
    if (requestId && isDuplicateRequest(error)) {
      const previous = await Order.findOne({ where: { businessId, requestId }, attributes: ['id'] });
      if (previous) return sendExisting(previous.id);
    }
    throw error;
  }

  if (approver) {
    await audit(req, {
      action: 'order.approved',
      targetType: 'order',
      targetId: orderId,
      detail: {
        approver: approver.email,
        discountPercent: approval.discountPercent,
        discountAmount: approval.discountAmount,
        prices: approval.prices.length,
      },
    });
  }

  const fullOrder = await Order.findOne({
    where: { id: orderId, businessId },
    include: orderIncludes,
  });
  res.status(201).json(fullOrder);
});
