import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'business_id',
  },
  customerId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'customer_id',
  },
  paymentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'payment_id',
  },
  installmentPlanId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'installment_plan_id',
  },
  date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  grossTotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true, 
    field: 'gross_total',
  },
  discountPercent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'discount_percent',
  },
  discountAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'discount_amount', 
  },
  total: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  subtotal: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true, 
  },
  vatAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'vat_amount',
  },
  internalTaxAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'internal_tax_amount',
  },
  discriminatesVat: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'discriminates_vat',
  },
  installmentsCount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'installments_count',
  },
  interestRate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    field: 'interest_rate',
  },
  installmentAmount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'installment_amount',
  },
  totalFinanced: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    field: 'total_financed',
  },
  notes: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'active',
    validate: { isIn: [['active', 'cancelled']] },
  },
  cancelledAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'cancelled_at',
  },
  cancelReason: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'cancel_reason',
  },
  cancelledById: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'cancelled_by_id',
  },
  // Número correlativo por comercio (services/orderNumber.service.js)
  number: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Quién lo hizo: el id y el nombre (por si después se borra el usuario)
  createdById: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'created_by_id',
  },
  createdByName: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'created_by_name',
  },
  // Identificador del envío desde el frontend, para no crear dos veces el mismo (ver utils/requestId.js)
  requestId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'request_id',
  },
}, {
  tableName: 'orders',
  indexes: [
    { unique: true, fields: ['business_id', 'request_id'], name: 'uq_orders_business_request' },
    { unique: true, fields: ['business_id', 'number'], name: 'uq_orders_business_number' },
  ],
});

export default Order;
