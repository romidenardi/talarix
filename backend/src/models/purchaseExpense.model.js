import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';
import { numericGetter } from '../utils/decimalColumn.js';

// Servicio o gasto de una compra (alquiler, luz, flete): concepto libre, sin producto ni stock.
// El costo unitario es sin IVA, como en los renglones de productos.
const PurchaseExpense = sequelize.define(
  'PurchaseExpense',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    purchaseId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'purchase_id',
    },
    description: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    // Categoría de gasto (utils/expenseCategories.js). NULL: cargado antes de que existieran.
    category: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      get: numericGetter('quantity'),
    },
    unitCost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: 'unit_cost',
      get: numericGetter('unitCost'),
    },
    vatRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      field: 'vat_rate',
      get: numericGetter('vatRate'),
    },
  },
  {
    tableName: 'purchase_expenses',
    indexes: [{ name: 'idx_purchase_expenses_purchase', fields: ['purchase_id'] }],
  },
);

export default PurchaseExpense;
