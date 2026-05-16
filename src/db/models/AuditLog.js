'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class AuditLog extends Model {
    static associate(models) {
      AuditLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'subject' });
      AuditLog.belongsTo(models.User, { foreignKey: 'actor_id', as: 'actor' });
      AuditLog.belongsTo(models.ApiKey, { foreignKey: 'api_key_id', as: 'apiKey' });
      AuditLog.belongsTo(models.Application, { foreignKey: 'application_id', as: 'application' });
    }
  }

  AuditLog.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: true },
      actor_id: { type: DataTypes.UUID, allowNull: true },
      actor_type: {
        type: DataTypes.ENUM('user', 'admin', 'system', 'api_key'),
        allowNull: false,
      },
      api_key_id: { type: DataTypes.UUID, allowNull: true },
      application_id: { type: DataTypes.UUID, allowNull: true },
      action: { type: DataTypes.STRING(100), allowNull: false },
      entity: { type: DataTypes.STRING(100), allowNull: true },
      entity_id: { type: DataTypes.UUID, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      ip: { type: DataTypes.INET, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return AuditLog;
};
