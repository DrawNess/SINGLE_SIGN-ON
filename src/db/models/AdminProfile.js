'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class AdminProfile extends Model {
    static associate(models) {
      AdminProfile.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  AdminProfile.init(
    {
      user_id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      job_title: { type: DataTypes.STRING(100), allowNull: true },
      department: { type: DataTypes.STRING(100), allowNull: true },
      employee_code: { type: DataTypes.STRING(50), allowNull: true, unique: true },
      phone: { type: DataTypes.STRING(20), allowNull: true },
    },
    {
      sequelize,
      modelName: 'AdminProfile',
      tableName: 'admin_profiles',
      underscored: true,
      timestamps: true,
    }
  );

  return AdminProfile;
};
