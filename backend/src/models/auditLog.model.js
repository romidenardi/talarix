import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Registro de acciones sensibles: quién, qué, cuándo y desde qué IP. Sin claves foráneas a
// propósito: el registro se conserva aunque se borre el usuario o el comercio.
// No guarda datos personales en "detail" (solo ids, roles, estados o montos).
const AuditLog = sequelize.define(
  'AuditLog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    actorType: {
      type: DataTypes.ENUM('platform', 'user', 'system'),
      allowNull: false,
      field: 'actor_type',
    },
    actorId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'actor_id',
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'business_id',
    },
    action: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    targetType: {
      type: DataTypes.STRING(40),
      allowNull: true,
      field: 'target_type',
    },
    targetId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'target_id',
    },
    detail: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    ip: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
  },
  {
    tableName: 'audit_logs',
    updatedAt: false,
    indexes: [
      { fields: ['createdAt'], name: 'idx_audit_logs_created' },
      { fields: ['business_id'], name: 'idx_audit_logs_business' },
    ],
  },
);

export default AuditLog;
