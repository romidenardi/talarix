import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';
import { numericGetter } from '../utils/decimalColumn.js';

const OrderItem = sequelize.define('OrderItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'order_id',
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'product_id',
  },
  quantity: {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false,
    get: numericGetter('quantity'),
  },
  unitPrice: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'unit_price',
  },
  components: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  // IVA e impuestos internos del producto AL MOMENTO DE LA VENTA (los reportes usan estos, no los
  // actuales del producto). En combos, cada componente guarda los suyos dentro de `components`.
  vatRate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    field: 'vat_rate',
    get: numericGetter('vatRate'),
  },
  otherTaxes: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    field: 'other_taxes',
    get: numericGetter('otherTaxes'),
  },
}, {
  tableName: 'order_items',
});

export default OrderItem;
