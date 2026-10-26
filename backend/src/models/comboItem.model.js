import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const ComboItem = sequelize.define(
  'ComboItem',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    comboId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'combo_id',
    },
    productId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'product_id',
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
  },
  {
    tableName: 'combo_items',
    indexes: [{ unique: true, fields: ['combo_id', 'product_id'], name: 'uq_combo_items_combo_product' }],
  },
);

export default ComboItem;
