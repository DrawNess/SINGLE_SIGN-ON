'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class AdminInvitation extends Model {
    static associate(models) {
      AdminInvitation.belongsTo(models.Role, { foreignKey: 'invited_role_id', as: 'role' });
      AdminInvitation.belongsTo(models.User, { foreignKey: 'invited_by', as: 'inviter' });
      AdminInvitation.belongsTo(models.User, { foreignKey: 'accepted_user_id', as: 'acceptedBy' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.token_hash;
      return values;
    }
  }

  AdminInvitation.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      email: { type: DataTypes.CITEXT, allowNull: false },
      invited_role_id: { type: DataTypes.UUID, allowNull: false },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      invited_by: { type: DataTypes.UUID, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      accepted_user_id: { type: DataTypes.UUID, allowNull: true },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'AdminInvitation',
      tableName: 'admin_invitations',
      underscored: true,
      timestamps: true,
    }
  );

  return AdminInvitation;
};
