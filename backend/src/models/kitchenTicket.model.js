import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Comanda: cada envío de platos a la cocina, con número correlativo por comercio.
//   pending: la cocina la está preparando · ready: lista para servir
const KitchenTicket = sequelize.define(
  'KitchenTicket',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    tabId: { type: DataTypes.UUID, allowNull: false, field: 'tab_id' },
    number: { type: DataTypes.INTEGER, allowNull: false },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: { isIn: [['pending', 'ready']] },
    },
    readyAt: { type: DataTypes.DATE, allowNull: true, field: 'ready_at' },
    // Identificador del envío, para no mandar dos veces la misma comanda (ver utils/requestId.js)
    requestId: { type: DataTypes.UUID, allowNull: true, field: 'request_id' },
    createdById: { type: DataTypes.UUID, allowNull: true, field: 'created_by_id' },
    createdByName: { type: DataTypes.STRING(100), allowNull: true, field: 'created_by_name' },
  },
  {
    tableName: 'kitchen_tickets',
    indexes: [
      { unique: true, fields: ['business_id', 'number'], name: 'uq_kitchen_tickets_business_number' },
      { unique: true, fields: ['business_id', 'request_id'], name: 'uq_kitchen_tickets_business_request' },
      { fields: ['tab_id'], name: 'idx_kitchen_tickets_tab' },
    ],
  },
);

export default KitchenTicket;
