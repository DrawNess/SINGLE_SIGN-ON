'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class ClientProfile extends Model {
    static associate(models) {
      ClientProfile.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  ClientProfile.init(
    {
      user_id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      phone: {
        type: DataTypes.STRING(13),
        allowNull: false,
        unique: true,
        validate: { is: /^\+591[0-9]{8}$/ },
      },
      phone_verified_at: { type: DataTypes.DATE, allowNull: true },
      document_type: { type: DataTypes.ENUM('CI', 'NIT'), allowNull: true },
      document_number: { type: DataTypes.STRING(20), allowNull: true, unique: true },
      birth_date: { type: DataTypes.DATEONLY, allowNull: true },
      razon_social: { type: DataTypes.STRING(200), allowNull: true },
      departamento: {
        type: DataTypes.ENUM(
          'La Paz',
          'Cochabamba',
          'Santa Cruz',
          'Oruro',
          'Potosí',
          'Chuquisaca',
          'Tarija',
          'Beni',
          'Pando'
        ),
        allowNull: true,
      },
      provincia: { type: DataTypes.STRING(100), allowNull: true },
      ciudad: { type: DataTypes.STRING(100), allowNull: true },
      calle_avenida: { type: DataTypes.STRING(200), allowNull: true },
      numero: { type: DataTypes.STRING(20), allowNull: true },
      casa_dpto: { type: DataTypes.STRING(50), allowNull: true },
      link_google_maps: { type: DataTypes.TEXT, allowNull: true },
      country: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'BO' },
    },
    {
      sequelize,
      modelName: 'ClientProfile',
      tableName: 'client_profiles',
      underscored: true,
      timestamps: true,
      validate: {
        nitRequiresRazonSocial() {
          if (this.document_type === 'NIT' && !this.razon_social) {
            throw new Error('razon_social es obligatorio cuando document_type es NIT');
          }
        },
      },
    }
  );

  return ClientProfile;
};
