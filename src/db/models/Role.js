'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class Role extends Model {
    static associate(models) {
      Role.belongsToMany(models.User, {
        through: models.UserRole,
        foreignKey: 'role_id',
        otherKey: 'user_id',
        as: 'users',
      });
      Role.hasMany(models.UserRole, { foreignKey: 'role_id', as: 'userRoles' });
      Role.hasMany(models.AdminInvitation, { foreignKey: 'invited_role_id', as: 'invitations' });
    }
  }

  Role.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'Role',
      tableName: 'roles',
      underscored: true,
      timestamps: true,
    }
  );

  return Role;
};
