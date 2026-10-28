import { Order, OrderItem, Product, Customer, Payment, InstallmentPlan, sequelize } from '../models/index.js';
import { isVariantGroup } from './variant.service.js';
import { httpError } from '../utils/httpError.js';
import { loadComboComponents } from './combo.service.js';
import { cleanRequestId, isDuplicateRequest } from '../utils/requestId.js';
import { APPROVER_ROLES, approvalSummary, checkApproval } from './orderApproval.service.js';
import { lockProducts, moveStock, actorFields } from './stock.service.js';
import { priceOrder, discriminatesVatFor } from './orderPricing.js';
import { nextOrderNumber, formatOrderNumber } from './orderNumber.service.js';
import {
  isPositiveQuantity,
  isNonNegative,
  toNumber,
  toNumberOrZero,
  round2,
  round3,
  quantityAllowedFor,
  unitWord,
} from '../utils/numbers.js';

const ROLES_THAT_CAN_ADD_STOCK = ['admin', 'editor'];
const MAX_PRICE = 99999999;

// Crea un remito: valida el pedido, busca cliente y forma de pago, revisa la autorización del
// operador, planifica el stock, calcula los importes (orderPricing.js), guarda y mueve el stock
// (stock.service.js), todo en una transacción.
//   body: lo que manda el frontend · user: req.user
// Devuelve { orderId, created } (created = false si ya existía por el mismo requestId) y, si un
// administrador autorizó un descuento o precio, { approver, approval } para el registro de actividad.
//
// Al cobrar una mesa (services/table.service.js) se llama con options = { tableTabId, transaction }:
// el stock ya se descontó al mandar cada comanda y los precios son los del momento del pedido, así que
// no se mueve stock, no se pide autorización y no se revisa si el producto sigue activo.
export const createOrder = async ({ body, user, options = {} }) => {
  const fromTab = Boolean(options.tableTabId);
  const external = options.transaction || null;
  const { customerId, paymentId, installmentPlanId, items, notes } = body;
  const { businessId, role, id: userId } = user;
  const requestId = cleanRequestId(body.requestId);

  // El mismo envío ya se procesó (doble clic o reintento): se devuelve ese remito, no se crea otro
  if (requestId) {
    const previous = await Order.findOne({ where: { businessId, requestId }, attributes: ['id'] });
    if (previous) return { orderId: previous.id, created: false };
  }

  // ---- Validación de entrada ----
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('El pedido debe tener al menos un artículo');
  }

  const rows = items.map((item, index) => {
    const n = index + 1;
    if (!item || typeof item.productId !== 'string' || !item.productId)
      throw httpError(`Artículo ${n}: falta el producto`);
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

  const discountPercent = toNumberOrZero(body.discountPercent);
  const discountAmount = toNumberOrZero(body.discountAmount);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw httpError('El porcentaje de descuento debe estar entre 0 y 100');
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    throw httpError('El descuento por monto no es válido');
  }

  // Autorización de descuentos del operador (se completa dentro de la transacción y se registra al final)
  let approver = null;
  let approval = null;

  const t = external || (await sequelize.transaction());
  let orderId;
  try {
    const customer = await Customer.findOne({ where: { id: customerId, businessId }, transaction: t });
    if (!customer) throw httpError('Cliente no encontrado', 404);
    if (customer.anonymizedAt) {
      throw httpError(
        'Ese cliente fue anonimizado por un pedido de supresión de datos: no se le puede hacer un remito.',
      );
    }

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
      if (!rowProduct.active && !fromTab) {
        throw httpError(`Artículo ${index + 1}: ${rowProduct.name} está inactivo. Activalo en Productos o elegí otro.`);
      }
      if (isVariantGroup(rowProduct)) {
        throw httpError(`Artículo ${index + 1}: ${rowProduct.name} tiene variantes. Elegí cuál (talle, color…).`);
      }
      if (!quantityAllowedFor(rowProduct, row.quantity)) {
        throw httpError(
          `Artículo ${index + 1}: ${rowProduct.name} se vende por unidad, la cantidad debe ser un entero`,
        );
      }
    }

    // El operador vende a precio de lista y sin descuentos, salvo que lo autorice un administrador o editor
    if (!fromTab && !APPROVER_ROLES.includes(role)) {
      approval = approvalSummary({ rows, productMap: rowProductMap, discountPercent, discountAmount });
      if (approval.needed) {
        approver = await checkApproval(body.approvalToken, {
          requesterId: userId,
          businessId,
          requestId,
          summary: approval,
        });
      }
    }

    const comboComponents = await loadComboComponents(
      rowProducts.filter((p) => p.isCombo).map((p) => p.id),
      businessId,
      t,
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
            round3((requested.get(component.productId) || 0) + row.quantity * component.quantity),
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
    const locked = fromTab ? new Map() : await lockProducts([...requested.keys()], businessId, t);

    const stockPlan = [];
    for (const [productId, qty] of fromTab ? [] : requested) {
      const product = locked.get(productId);
      if (!product) throw httpError(`Producto no encontrado: ${productId}`, 404);

      const shortfall = round3(Math.max(qty - Number(product.stock), 0));
      if (shortfall > 0) {
        if (!addStockFor.has(productId)) {
          const forCombo = viaCombo.has(productId) ? ' (necesario para un combo)' : '';
          throw httpError(
            `Stock insuficiente para ${product.name}${forCombo} (disponible: ${Number(product.stock)}, pedido: ${qty})`,
          );
        }
        if (!ROLES_THAT_CAN_ADD_STOCK.includes(role)) {
          throw httpError(
            `No tenés permisos para agregar stock a ${product.name}. Pedile a un administrador o editor que lo cargue.`,
            403,
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

    const order = await Order.create(
      {
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
        tableTabId: options.tableTabId || null,
        ...actorFields(user),
      },
      { transaction: t },
    );
    orderId = order.id;

    await OrderItem.bulkCreate(
      lines.map((line) => ({
        orderId: order.id,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        otherTaxes: line.otherTaxes,
        components: line.components,
      })),
      { transaction: t },
    );

    const customerName = customer.businessName || [customer.firstName, customer.lastName].filter(Boolean).join(' ');
    const label = `remito ${formatOrderNumber(order)} a ${customerName}`;
    for (const { product, qty, shortfall } of stockPlan) {
      if (shortfall > 0) {
        await moveStock(
          {
            product,
            type: 'in',
            delta: shortfall,
            reason: `Ajuste desde ${label}: faltaban ${shortfall} ${unitWord(product)}`,
            actor: user,
          },
          t,
        );
      }
      await moveStock(
        {
          product,
          type: 'out',
          delta: -qty,
          reason: `Venta, ${label}${viaCombo.has(product.id) ? ' (incluye combos)' : ''}`,
          actor: user,
        },
        t,
      );
    }

    if (!external) await t.commit();
  } catch (error) {
    if (external) throw error;
    await t.rollback();
    // Dos envíos iguales al mismo tiempo: el otro ya lo creó
    if (requestId && isDuplicateRequest(error)) {
      const previous = await Order.findOne({ where: { businessId, requestId }, attributes: ['id'] });
      if (previous) return { orderId: previous.id, created: false };
    }
    throw error;
  }

  return { orderId, created: true, approver, approval };
};
