import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Cuota de la cuenta corriente de un cliente (migración 012). Un remito a cuenta corriente se divide
// en cuotas con su vencimiento; el saldo inicial positivo del cliente es una cuota más (sin remito).
// Una cobranza paga cuotas completas: la cuota guarda cuál la pagó y cuándo.
const CustomerInstallment = sequelize.define(
  'CustomerInstallment',
  {
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
    // NULL: la cuota del saldo inicial
    orderId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'order_id',
    },
    number: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    installmentsCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'installments_count',
    },
    // Día de vencimiento (AAAA-MM-DD, sin hora)
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      field: 'due_date',
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    // cancelled: el remito se anuló, o el saldo inicial se borró
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
      validate: { isIn: [['active', 'cancelled']] },
    },
    customerPaymentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'customer_payment_id',
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'paid_at',
    },
  },
  {
    tableName: 'customer_installments',
    indexes: [
      { fields: ['business_id', 'customer_id', 'status'], name: 'idx_customer_installments_customer' },
      { fields: ['order_id'], name: 'idx_customer_installments_order' },
      { fields: ['customer_payment_id'], name: 'idx_customer_installments_payment' },
    ],
  },
);

export default CustomerInstallment;
