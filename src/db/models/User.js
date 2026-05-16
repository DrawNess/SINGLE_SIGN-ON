'use strict';

const { Model, DataTypes } = require('sequelize');
const { uuidv7 } = require('uuidv7');

module.exports = (sequelize) => {
  class User extends Model {
    static associate(models) {
      User.hasOne(models.ClientProfile, { foreignKey: 'user_id', as: 'clientProfile' });
      User.hasOne(models.AdminProfile, { foreignKey: 'user_id', as: 'adminProfile' });
      User.belongsToMany(models.Role, {
        through: models.UserRole,
        foreignKey: 'user_id',
        otherKey: 'role_id',
        as: 'roles',
      });
      User.hasMany(models.UserRole, { foreignKey: 'user_id', as: 'userRoles' });
      User.hasMany(models.AuthProvider, { foreignKey: 'user_id', as: 'authProviders' });
      User.hasMany(models.RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });
      User.hasMany(models.EmailVerification, { foreignKey: 'user_id', as: 'emailVerifications' });
      User.hasMany(models.PhoneVerification, { foreignKey: 'user_id', as: 'phoneVerifications' });
      User.hasMany(models.PasswordReset, { foreignKey: 'user_id', as: 'passwordResets' });
      User.hasMany(models.PasswordHistory, { foreignKey: 'user_id', as: 'passwordHistory' });
      User.hasMany(models.Application, { foreignKey: 'created_by', as: 'createdApplications' });
      User.hasMany(models.ApiKey, { foreignKey: 'created_by', as: 'createdApiKeys' });
      User.hasMany(models.AdminInvitation, { foreignKey: 'invited_by', as: 'sentInvitations' });
      User.hasMany(models.AdminInvitation, { foreignKey: 'accepted_user_id', as: 'acceptedInvitations' });
      User.hasMany(models.AuditLog, { foreignKey: 'user_id', as: 'auditTargetLogs' });
      User.hasMany(models.AuditLog, { foreignKey: 'actor_id', as: 'auditActorLogs' });
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.password_hash;
      delete values.totp_secret;
      return values;
    }
  }

  User.init(
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: () => uuidv7() },
      email: { type: DataTypes.CITEXT, allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: true },
      status: {
        type: DataTypes.ENUM('pending', 'active', 'suspended', 'deleted'),
        allowNull: false,
        defaultValue: 'pending',
      },
      email_verified_at: { type: DataTypes.DATE, allowNull: true },
      failed_login_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: { type: DataTypes.DATE, allowNull: true },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
      last_login_ip: { type: DataTypes.INET, allowNull: true },
      password_changed_at: { type: DataTypes.DATE, allowNull: true },
      totp_secret: { type: DataTypes.STRING(255), allowNull: true },
      totp_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
      paranoid: true,
      deletedAt: 'deleted_at',
    }
  );

  return User;
};
