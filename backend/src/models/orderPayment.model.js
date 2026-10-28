import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';
import { numericGetter } from '../utils/decimalColumn.js';

// Cobros de un remito pagado en partes (cuenta de una mesa dividida). La propina va aparte del
// importe: no es parte de la venta. Un remito sin filas acá se cobró entero con su forma de pago.
const OrderPayment = sequelize.define(
  'OrderPayment',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    orderId: { type: DataTypes.UUID, allowNull: false, field: 'order_id' },
    paymentId: { type: DataTypes.UUID, allowNull: false, field: 'payment_id' },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, get: numericGetter('amount') },
    tip: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, get: numericGetter('tip') },
  },
  {
    tableName: 'order_payments',
    indexes: [
      { fields: ['order_id'], name: 'idx_order_payments_order' },
      { fields: ['business_id'], name: 'idx_order_payments_business' },
    ],
  },
);

export default OrderPayment;
