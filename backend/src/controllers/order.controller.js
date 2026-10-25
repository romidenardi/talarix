import {
  Order, OrderItem, Product, Customer, Payment, InstallmentPlan, sequelize,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { loadComboComponents } from '../services/combo.service.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { audit } from '../utils/audit.js';
import { APPROVER_ROLES, approvalSummary, checkApproval } from '../services/orderApproval.service.js';
import { lockProducts, moveStock, actorFields } from '../services/stock.service.js';
import { priceOrder, discriminatesVatFor } from '../services/orderPricing.js';
import { nextOrderNumber, formatOrderNumber } from '../services/orderNumber.service.js';
import {
  isPositiveQuantity, isNonNegative, toNumber, toNumberOrZero, round2, round3,
  quantityAllowedFor, unitWord,
} from '../utils/numbers.js';

const ROLES_THAT_CAN_ADD_STOCK = ['admin', 'editor'];
const MAX_PRICE = 99999999;

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
    order: [['date', 'DESC'], ['number', 'DESC']],
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
    if (!item || typeof item.productId !== 'string' || !item.productId) throw httpError(`Artículo ${n}: falta el producto`);
    if (!isPositiveQuantity(item.quantity)) {
      throw httpError(`Artículo ${n}: la cantidad debe ser un número mayor a 0, con hasta 3 decimales`);
    }
    if (!isNonNegative(item.unitPrice) || toNumber(item.unitPrice) > MAX_PRICE) {
      throw httpError(`Artículo ${n}: el precio no es válido`);
    }
    return {
      productId: item.productId,
      quantity: round3(toNumber(item.quantity)),
      unitPrice: round2(toNumber(item.unitPrice)), // centavos: es lo que se guarda y se imprime
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

  // Autorización de descuentos del operador (se completa dentro de la transacción y se registra al final)
  let approver = null;
  let approval = null;

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

    // Cuánto sale de cada producto (los combos descuentan sus componentes)
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

    // Primero el número (bloquea el comercio) y después los productos, siempre en el mismo orden
    const number = await nextOrderNumber(businessId, t);
    const locked = await lockProducts([...requested.keys()], businessId, t);

    const stockPlan = [];
    for (const [productId, qty] of requested) {
      const product = locked.get(productId);
      if (!product) throw httpError(`Producto no encontrado: ${productId}`, 404);

      const shortfall = round3(Math.max(qty - Number(product.stock), 0));
      if (shortfall > 0) {
        if (!addStockFor.has(productId)) {
          const forCombo = viaCombo.has(productId) ? ' (necesario para un combo)' : '';
          throw httpError(`Stock insuficiente para ${product.name}${forCombo} (disponible: ${Number(product.stock)}, pedido: ${qty})`);
        }
        if (!ROLES_THAT_CAN_ADD_STOCK.includes(role)) {
          throw httpError(
            `No tenés permisos para agregar stock a ${product.name}. Pedile a un administrador o editor que lo cargue.`,
            403
          );
        }
      }
      stockPlan.push({ product, qty, shortfall });
    }

    // Lo que se vende, con el IVA del momento (se guarda en cada renglón)
    const lines = rows.map((row) => {
      const product = rowProductMap.get(row.productId);
      if (product.isCombo) {
        return {
          ...row,
          vatRate: null,
          otherTaxes: null,
          components: comboComponents.get(row.productId).map((c) => ({
            productId: c.productId,
            name: c.product.name,
            internalCode: c.product.internalCode,
            quantity: c.quantity,
            price: Number(c.product.price) || 0,
            vatRate: Number(c.product.vatRate) || 0,
            otherTaxes: Number(c.product.otherTaxes) || 0,
          })),
        };
      }
      return {
        ...row,
        vatRate: Number(product.vatRate) || 0,
        otherTaxes: product.otherTaxes === null || product.otherTaxes === undefined ? null : Number(product.otherTaxes),
        components: null,
      };
    });

    const totals = priceOrder({
      lines,
      discountPercent,
      discountAmount,
      discriminatesVat: discriminatesVatFor(customer.fiscalCondition),
      plan: installmentPlan,
    });

    const order = await Order.create({
      businessId,
      number,
      customerId: customer.id,
      paymentId: payment.id,
      installmentPlanId: installmentPlan ? installmentPlan.id : null,
      notes,
      grossTotal: totals.grossTotal,
      discountPercent,
      discountAmount,
      total: totals.total,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      internalTaxAmount: totals.internalTaxAmount,
      discriminatesVat: discriminatesVatFor(customer.fiscalCondition),
      installmentsCount: totals.installmentsCount,
      interestRate: totals.interestRate,
      installmentAmount: totals.installmentAmount,
      totalFinanced: totals.totalFinanced,
      requestId,
      ...actorFields(req.user),
    }, { transaction: t });
    orderId = order.id;

    await OrderItem.bulkCreate(lines.map((line) => ({
      orderId: order.id,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      otherTaxes: line.otherTaxes,
      components: line.components,
    })), { transaction: t });

    const customerName = customer.businessName || [customer.firstName, customer.lastName].filter(Boolean).join(' ');
    const label = `remito ${formatOrderNumber(order)} a ${customerName}`;
    for (const { product, qty, shortfall } of stockPlan) {
      if (shortfall > 0) {
        await moveStock({
          product,
          type: 'in',
          delta: shortfall,
          reason: `Ajuste desde ${label}: faltaban ${shortfall} ${unitWord(product)}`,
          actor: req.user,
        }, t);
      }
      await moveStock({
        product,
        type: 'out',
        delta: -qty,
        reason: `Venta, ${label}${viaCombo.has(product.id) ? ' (incluye combos)' : ''}`,
        actor: req.user,
      }, t);
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
