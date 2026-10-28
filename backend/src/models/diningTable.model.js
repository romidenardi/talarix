import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Mesas del comercio (migrations/003-mesas-y-comandas.sql)
const DiningTable = sequelize.define(
  'DiningTable',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    name: { type: DataTypes.STRING(30), allowNull: false },
    // Sector: Salón, Vereda, Terraza…
    area: { type: DataTypes.STRING(50), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    tableName: 'dining_tables',
    indexes: [{ unique: true, fields: ['business_id', 'name'], name: 'uq_dining_tables_business_name' }],
  },
);

export default DiningTable;
