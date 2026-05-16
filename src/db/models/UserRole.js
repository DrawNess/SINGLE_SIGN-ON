'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class UserRole extends Model {
    static associate(models) {
      UserRole.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
      UserRole.belongsTo(models.Role, { foreignKey: 'role_id', as: 'role' });
      UserRole.belongsTo(models.User, { foreignKey: 'assigned_by', as: 'assignedBy' });
    }
  }

  UserRole.init(
    {
      user_id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      role_id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      assigned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      assigned_by: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: 'UserRole',
      tableName: 'user_roles',
      underscored: true,
      timestamps: false,
    }
  );

  return UserRole;
};
