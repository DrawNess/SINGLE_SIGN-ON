'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class Application extends Model {
    static associate(models) {
      Application.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
      Application.hasMany(models.ApiKey, { foreignKey: 'application_id', as: 'apiKeys' });
      Application.hasMany(models.RefreshToken, { foreignKey: 'application_id', as: 'refreshTokens' });
      Application.hasMany(models.AuditLog, { foreignKey: 'application_id', as: 'auditLogs' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.client_secret_hash;
      return values;
    }
  }

  Application.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      display_name: { type: DataTypes.STRING(150), allowNull: false },
      client_id: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      client_secret_hash: { type: DataTypes.STRING(255), allowNull: true },
      type: {
        type: DataTypes.ENUM('spa-web', 'mobile', 'desktop', 'service'),
        allowNull: false,
      },
      audience: { type: DataTypes.STRING(100), allowNull: false },
      allowed_origins: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      allowed_redirect_uris: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: 'Application',
      tableName: 'applications',
      underscored: true,
      timestamps: true,
      paranoid: true,
      deletedAt: 'deleted_at',
    }
  );

  return Application;
};
