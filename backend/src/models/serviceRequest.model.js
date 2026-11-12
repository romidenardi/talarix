import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

// Pedidos hechos desde formularios públicos: los botones de baja y de arrepentimiento (/baja y
// /arrepentimiento de la app) y el formulario «Agendá una demo» del sitio web. Los atiende el
// superadmin. Sin clave foránea al comercio: la constancia queda aunque se borre.
//   kind:   cancellation (baja) · withdrawal (arrepentimiento del Plan Pago) · demo (pedido de demo)
//   status: pending · done
const ServiceRequest = sequelize.define(
  'ServiceRequest',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Código que recibe quien hizo el pedido, por ejemplo BAJ-7K3Q9PXM
    code: { type: DataTypes.STRING(20), allowNull: false },
    kind: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [['cancellation', 'withdrawal', 'demo']] },
    },
    name: { type: DataTypes.STRING(255), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    businessName: { type: DataTypes.STRING(255), allowNull: true, field: 'business_name' },
    reason: { type: DataTypes.TEXT, allowNull: true },
    // El comercio del usuario con ese email, si existe (para ubicarlo rápido en el panel)
    businessId: { type: DataTypes.UUID, allowNull: true, field: 'business_id' },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: { isIn: [['pending', 'done']] },
    },
    // Nota interna del superadmin al resolverlo
    note: { type: DataTypes.STRING(500), allowNull: true },
    resolvedAt: { type: DataTypes.DATE, allowNull: true, field: 'resolved_at' },
    ip: { type: DataTypes.STRING(64), allowNull: true },
  },
  {
    tableName: 'service_requests',
    indexes: [
      { unique: true, fields: ['code'], name: 'uq_service_requests_code' },
      { fields: ['status'], name: 'idx_service_requests_status' },
    ],
  },
);

export default ServiceRequest;
