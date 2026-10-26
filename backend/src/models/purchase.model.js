import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const Purchase = sequelize.define('Purchase', {
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
  supplierId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'supplier_id',
  },
  invoiceNumber: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'invoice_number',
  },
  date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  total: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  // Anulación (controllers/purchase.controller.js → cancelPurchase)
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
  tableName: 'purchases',
  indexes: [
    { unique: true, fields: ['business_id', 'request_id'], name: 'uq_purchases_business_request' },
  ],
});

export default Purchase;