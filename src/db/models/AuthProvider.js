'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class AuthProvider extends Model {
    static associate(models) {
      AuthProvider.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.access_token_enc;
      delete values.refresh_token_enc;
      return values;
    }
  }

  AuthProvider.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: false },
      provider: {
        type: DataTypes.ENUM('google', 'facebook', 'microsoft'),
        allowNull: false,
      },
      provider_user_id: { type: DataTypes.STRING(255), allowNull: false },
      email: { type: DataTypes.CITEXT, allowNull: true },
      access_token_enc: { type: DataTypes.TEXT, allowNull: true },
      refresh_token_enc: { type: DataTypes.TEXT, allowNull: true },
      token_expires_at: { type: DataTypes.DATE, allowNull: true },
      profile_data: { type: DataTypes.JSONB, allowNull: true },
      linked_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: 'AuthProvider',
      tableName: 'auth_providers',
      underscored: true,
      timestamps: true,
    }
  );

  return AuthProvider;
};
