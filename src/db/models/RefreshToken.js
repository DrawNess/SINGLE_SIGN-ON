'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class RefreshToken extends Model {
    static associate(models) {
      RefreshToken.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
      RefreshToken.belongsTo(models.Application, { foreignKey: 'application_id', as: 'application' });
      RefreshToken.belongsTo(models.RefreshToken, { foreignKey: 'replaced_by', as: 'replacement' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.token_hash;
      return values;
    }
  }

  RefreshToken.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: false },
      application_id: { type: DataTypes.UUID, allowNull: false },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      family_id: { type: DataTypes.UUID, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      revoked_reason: {
        type: DataTypes.ENUM('logout', 'rotation', 'theft_detected', 'admin', 'password_changed'),
        allowNull: true,
      },
      replaced_by: { type: DataTypes.UUID, allowNull: true },
      ip: { type: DataTypes.INET, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'RefreshToken',
      tableName: 'refresh_tokens',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return RefreshToken;
};
