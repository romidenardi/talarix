import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const PlatformAdmin = sequelize.define(
  'PlatformAdmin',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },

    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'password_hash',
    },

    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    // Segundo factor (app de autenticación). Ver utils/totp.js y el login en platform.controller.js
    totpEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'totp_enabled',
    },

    totpSecret: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'totp_secret',
    },

    // Clave generada al configurar, hasta que se confirma con el primer código
    totpPendingSecret: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'totp_pending_secret',
    },

    // Último paso de 30 segundos usado: el mismo código no se acepta dos veces
    totpLastStep: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'totp_last_step',
    },

    // Hashes de los códigos de recuperación que quedan sin usar
    recoveryCodes: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'recovery_codes',
    },
  },
  {
    tableName: 'platform_admins',
  },
);

export default PlatformAdmin;
