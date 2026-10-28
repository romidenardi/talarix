import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';
import { numericGetter } from '../utils/decimalColumn.js';

// Plato pedido en una comanda. El nombre y el precio se guardan al pedir.
//   active · cancelled (anulado por un administrador o editor: devuelve el stock)
const TabItem = sequelize.define(
  'TabItem',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    tabId: { type: DataTypes.UUID, allowNull: false, field: 'tab_id' },
    ticketId: { type: DataTypes.UUID, allowNull: false, field: 'ticket_id' },
    productId: { type: DataTypes.UUID, allowNull: false, field: 'product_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: false, get: numericGetter('quantity') },
    unitPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      field: 'unit_price',
      get: numericGetter('unitPrice'),
    },
    // Indicación para la cocina: "sin cebolla", "punto jugoso"
    note: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
      validate: { isIn: [['active', 'cancelled']] },
    },
    cancelledAt: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_at' },
    cancelledById: { type: DataTypes.UUID, allowNull: true, field: 'cancelled_by_id' },
    cancelledByName: { type: DataTypes.STRING(100), allowNull: true, field: 'cancelled_by_name' },
    cancelReason: { type: DataTypes.STRING, allowNull: true, field: 'cancel_reason' },
  },
  {
    tableName: 'tab_items',
    indexes: [
      { fields: ['tab_id'], name: 'idx_tab_items_tab' },
      { fields: ['ticket_id'], name: 'idx_tab_items_ticket' },
      { fields: ['product_id'], name: 'idx_tab_items_product' },
    ],
  },
);

export default TabItem;
