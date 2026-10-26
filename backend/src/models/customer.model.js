import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const Customer = sequelize.define('Customer', {
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
  businessName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'business_name', // razón social
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'first_name',
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'last_name',
  },
  fiscalCondition: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'fiscal_condition', 
  },
  cuit: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  address: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  zipCode: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'zip_code',
  },
  city: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  province: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: { isEmail: true },
  },
  // Fecha en que se anonimizó por un pedido de supresión. Un cliente anonimizado no se edita ni se
  // le puede vender (controllers/dataRights.controller.js).
  anonymizedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'anonymized_at',
  },
}, {
  tableName: 'customers',
});

export default Customer;