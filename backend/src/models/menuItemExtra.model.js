import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Qué adicionales se pueden pedir con cada plato del menú (migrations/004-menu-y-adicionales.sql)
const MenuItemExtra = sequelize.define(
  'MenuItemExtra',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    dishId: { type: DataTypes.UUID, allowNull: false, field: 'dish_id' },
    extraId: { type: DataTypes.UUID, allowNull: false, field: 'extra_id' },
  },
  {
    tableName: 'menu_item_extras',
    indexes: [
      { unique: true, fields: ['dish_id', 'extra_id'], name: 'uq_menu_item_extras_dish_extra' },
      { fields: ['business_id'], name: 'idx_menu_item_extras_business' },
    ],
  },
);

export default MenuItemExtra;
