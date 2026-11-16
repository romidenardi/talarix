import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Cobranza a un cliente (cuenta corriente). Paga cuotas completas (customer_installments guarda cuál
// la pagó). Se anula, no se borra: queda el historial, y las cuotas vuelven a quedar impagas.
const CustomerPayment = sequelize.define(
  'CustomerPayment',
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
    // Forma de pago (efectivo, transferencia...): las mismas de los remitos
    paymentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'payment_id',
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // Lo que pagó de cuotas (es lo que baja el saldo del cliente)
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    // Recargo por mora (migración 013): lo cobrado, aparte de las cuotas, y lo que se había calculado.
    // La diferencia es lo que se perdonó. Lo que pagó el cliente en total es amount + lateFee.
    lateFee: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'late_fee',
    },
    lateFeeComputed: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
      field: 'late_fee_computed',
    },
    // Número de transferencia, de cheque, etc.
    reference: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    notes: {
      type: DataTypes.STRING(255),
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
    cancelledByName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cancelled_by_name',
    },
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
    // Identificador del envío desde el frontend, para no registrar dos veces la misma cobranza
    requestId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'request_id',
    },
  },
  {
    tableName: 'customer_payments',
    indexes: [
      { unique: true, fields: ['business_id', 'request_id'], name: 'uq_customer_payments_business_request' },
      { fields: ['business_id', 'customer_id'], name: 'idx_customer_payments_customer' },
    ],
  },
);

export default CustomerPayment;
