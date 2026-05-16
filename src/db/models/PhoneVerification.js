'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class PhoneVerification extends Model {
    static associate(models) {
      PhoneVerification.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.code_hash;
      return values;
    }
  }

  PhoneVerification.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: false },
      phone: { type: DataTypes.STRING(13), allowNull: false },
      code_hash: { type: DataTypes.STRING(255), allowNull: false },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'PhoneVerification',
      tableName: 'phone_verifications',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return PhoneVerification;
};
