import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Cuenta de una mesa: se abre al sentarse y se cierra al cobrar (genera un remito).
//   open: abierta · billing: pidió la cuenta · closed: cobrada · cancelled: anulada
const TableTab = sequelize.define(
  'TableTab',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    tableId: { type: DataTypes.UUID, allowNull: false, field: 'table_id' },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'open',
      validate: { isIn: [['open', 'billing', 'closed', 'cancelled']] },
    },
    guests: { type: DataTypes.INTEGER, allowNull: true },
    waiterId: { type: DataTypes.UUID, allowNull: true, field: 'waiter_id' },
    waiterName: { type: DataTypes.STRING(100), allowNull: true, field: 'waiter_name' },
    openedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'opened_at' },
    closedAt: { type: DataTypes.DATE, allowNull: true, field: 'closed_at' },
    closedById: { type: DataTypes.UUID, allowNull: true, field: 'closed_by_id' },
    closedByName: { type: DataTypes.STRING(100), allowNull: true, field: 'closed_by_name' },
    cancelReason: { type: DataTypes.STRING, allowNull: true, field: 'cancel_reason' },
  },
  {
    tableName: 'table_tabs',
    indexes: [
      { fields: ['business_id', 'status'], name: 'idx_table_tabs_business_status' },
      { fields: ['table_id'], name: 'idx_table_tabs_table' },
    ],
  },
);

export default TableTab;
