import { Order, OrderItem, Product, Customer, Payment } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { audit } from '../utils/audit.js';
import { createOrder as createOrderService } from '../services/order.service.js';

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
    order: [
      ['date', 'DESC'],
      ['number', 'DESC'],
    ],
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

// Toda la lógica está en services/order.service.js: acá solo se arma la respuesta
export const createOrder = asyncHandler(async (req, res) => {
  const { orderId, created, approver, approval } = await createOrderService({ body: req.body, user: req.user });

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
    where: { id: orderId, businessId: req.user.businessId },
    include: orderIncludes,
  });
  res.status(created ? 201 : 200).json(fullOrder);
});
