import pkg from 'sequelize';
import { Order, OrderItem, Product, Customer, Payment } from '../models/index.js';

const { Op } = pkg;

// Lo que comparten los reportes: carga de remitos y ayudas de cálculo
export const LOW_STOCK_THRESHOLD = 5;

// Los remitos anulados nunca cuentan
export const loadOrders = (businessId, start, end) =>
  Order.findAll({
    where: { businessId, status: 'active', date: { [Op.gte]: start, [Op.lt]: end } },
    include: [
      {
        model: OrderItem,
        as: 'items',
        attributes: ['productId', 'quantity', 'unitPrice', 'components', 'vatRate', 'otherTaxes'],
      },
      { model: Customer, attributes: ['id', 'firstName', 'lastName', 'businessName'] },
      { model: Payment, attributes: ['id', 'name'] },
    ],
    order: [['date', 'ASC']],
  });

export const itemsSum = (order) => order.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);

export const orderGross = (order) => {
  const gross = Number(order.grossTotal);
  return gross > 0 ? gross : itemsSum(order);
};

// Proporción del total final sobre el bruto: reparte los descuentos entre los ítems
export const orderScale = (order) => {
  const gross = orderGross(order);
  return gross > 0 ? Number(order.total) / gross : 1;
};

export const customerName = (customer) => {
  if (!customer) return 'Sin cliente';
  return customer.businessName || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Sin nombre';
};

export const loadProductsMap = async (businessId, ids) => {
  if (!ids.length) return new Map();
  const products = await Product.findAll({
    where: { businessId, id: { [Op.in]: ids } },
    attributes: ['id', 'name', 'internalCode', 'categoryId', 'vatRate', 'otherTaxes'],
  });
  return new Map(products.map((p) => [p.id, p]));
};
