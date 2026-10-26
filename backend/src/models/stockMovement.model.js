import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';
import { numericGetter } from '../utils/decimalColumn.js';

const StockMovement = sequelize.define(
  'StockMovement',
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
    productId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'product_id',
    },
    type: {
      type: DataTypes.ENUM('in', 'out', 'adjustment'),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      get: numericGetter('quantity'),
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
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
  },
  {
    tableName: 'stock_movements',
  },
);

export default StockMovement;
