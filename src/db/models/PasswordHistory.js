'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class PasswordHistory extends Model {
    static associate(models) {
      PasswordHistory.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.password_hash;
      return values;
    }
  }

  PasswordHistory.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: false },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
    },
    {
      sequelize,
      modelName: 'PasswordHistory',
      tableName: 'password_history',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return PasswordHistory;
};
