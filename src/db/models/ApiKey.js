'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class ApiKey extends Model {
    static associate(models) {
      ApiKey.belongsTo(models.Application, { foreignKey: 'application_id', as: 'application' });
      ApiKey.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
      ApiKey.hasMany(models.AuditLog, { foreignKey: 'api_key_id', as: 'auditLogs' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.key_hash;
      return values;
    }
  }

  ApiKey.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      application_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      key_prefix: { type: DataTypes.STRING(16), allowNull: false },
      key_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      scopes: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      last_used_at: { type: DataTypes.DATE, allowNull: true },
      last_used_ip: { type: DataTypes.INET, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: 'ApiKey',
      tableName: 'api_keys',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return ApiKey;
};
