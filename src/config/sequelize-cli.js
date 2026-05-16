// Config consumido por sequelize-cli (migrations, seeders).
// El runtime de la app usa src/config/db.js (Sequelize instance).
require('dotenv').config();

const common = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  dialect: 'postgres',
  define: {
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  migrationStorageTableName: 'sequelize_meta',
  seederStorageTableName: 'sequelize_seeders',
  seederStorage: 'sequelize',
};

module.exports = {
  development: { ...common, logging: console.log },
  test: { ...common, logging: false },
  production: { ...common, logging: false },
};
