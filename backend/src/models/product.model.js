import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';
import { numericGetter } from '../utils/decimalColumn.js';

const Product = sequelize.define(
  'Product',
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
    categoryId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'category_id',
    },
    internalCode: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'internal_code',
    },
    barcode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    scalePlu: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'scale_plu',
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    unitType: {
      type: DataTypes.ENUM('unit', 'weight'),
      allowNull: false,
      defaultValue: 'unit',
      field: 'unit_type',
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    promoPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: 'promo_price',
    },
    cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    fiscalActivity: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'fiscal_activity',
    },
    vatRate: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 21.0,
      field: 'vat_rate',
    },
    otherTaxes: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      field: 'other_taxes',
    },
    stock: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      defaultValue: 0,
      get: numericGetter('stock'),
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    isCombo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_combo',
    },
    specialPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: 'special_price',
    },
    // Variantes (services/variant.service.js). En el producto principal, los nombres de los
    // atributos (["Talle", "Color"]); en cada variante, su principal y sus valores (["M", "Rojo"]).
    parentId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'parent_id',
    },
    variantAttributes: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'variant_attributes',
    },
    variantValues: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'variant_values',
    },
    // La variante tiene precio y promo propios; si no, toma los del principal
    ownPrice: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'own_price',
    },
  },
  {
    tableName: 'products',
    indexes: [
      { unique: true, fields: ['business_id', 'barcode'], name: 'uq_products_business_barcode' },
      { unique: true, fields: ['business_id', 'scale_plu'], name: 'uq_products_business_scale_plu' },
      { fields: ['parent_id'], name: 'idx_products_parent' },
    ],
  },
);

export default Product;
