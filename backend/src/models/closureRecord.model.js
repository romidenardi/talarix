import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../config/database.js';

const ClosureRecord = sequelize.define(
  'ClosureRecord',
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, field: 'business_id' },
    businessName: { type: DataTypes.STRING, allowNull: false, field: 'business_name' },
    scheduledFor: { type: DataTypes.DATE, allowNull: true, field: 'scheduled_for' },
    deletedAt: { type: DataTypes.DATE, allowNull: false, field: 'deleted_at' },
    userCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'user_count' },
  },
  {
    tableName: 'closure_records',
  },
);

export default ClosureRecord;
