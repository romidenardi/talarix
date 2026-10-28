import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const Business = sequelize.define(
  'Business',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    cuit: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.ENUM('active', 'suspended', 'closing'),
      allowNull: false,
      defaultValue: 'active',
    },
    type: {
      type: DataTypes.ENUM('demo', 'client'),
      allowNull: false,
      defaultValue: 'client',
    },
    // Fin de la prueba gratis (NULL = sin vencimiento). Al pasar, se suspende solo
    // (services/trialExpiry.service.js)
    trialEndsAt: { type: DataTypes.DATE, allowNull: true, field: 'trial_ends_at' },
    // Por qué está suspendido: 'trial_expired' o 'manual' (migrations/001-motivo-de-suspension.sql)
    suspendedReason: { type: DataTypes.STRING(20), allowNull: true, field: 'suspended_reason' },
    // Usa mesas y comandas (lo activa el administrador desde la pantalla Mesas)
    tablesEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'tables_enabled' },
    contactEmail: { type: DataTypes.STRING, allowNull: true, field: 'contact_email' },
    // Fecha en que se borran definitivamente los datos (solo si status = closing)
    deleteAt: { type: DataTypes.DATE, allowNull: true, field: 'delete_at' },
    // Formato de las etiquetas de la balanza del comercio (ver utils/scaleConfig.js)
    scaleConfig: { type: DataTypes.JSON, allowNull: true, field: 'scale_config' },
  },
  {
    tableName: 'businesses',
  },
);

export default Business;
