'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class EmailVerification extends Model {
    static associate(models) {
      EmailVerification.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.token_hash;
      return values;
    }
  }

  EmailVerification.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      user_id: { type: DataTypes.UUID, allowNull: false },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      email: { type: DataTypes.CITEXT, allowNull: false },
      new_email: { type: DataTypes.CITEXT, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'EmailVerification',
      tableName: 'email_verifications',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  return EmailVerification;
};
