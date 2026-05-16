'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class PasswordReset extends Model {
    static associate(models) {
      PasswordReset.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.token_hash;
      return values;
    }
  }

  PasswordReset.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: false },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      ip: { type: DataTypes.INET, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'PasswordReset',
      tableName: 'password_resets',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return PasswordReset;
};
