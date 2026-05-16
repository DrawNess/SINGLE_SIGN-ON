// Instancia Sequelize para el runtime de la app.
// Los modelos se registran desde src/db/models/index.js (cargado en paso 2).
const { Sequelize } = require('sequelize');
const config = require('./env');

const sequelize = new Sequelize(
  config.db.name,
  config.db.user,
  config.db.password,
  {
    host: config.db.host,
    port: config.db.port,
    dialect: 'postgres',
    logging: config.isDev ? (msg) => console.log(`[sql] ${msg}`) : false,
    pool: {
      max: config.db.pool.max,
      min: config.db.pool.min,
      idle: config.db.pool.idle,
      acquire: 30000,
    },
    define: {
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    dialectOptions: {
      // SSL en producción si tu Postgres lo requiere
      ...(config.isProd && process.env.DB_SSL === 'true'
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : {}),
    },
  }
);

async function connect() {
  await sequelize.authenticate();
  console.log(`✔ Postgres conectado: ${config.db.host}:${config.db.port}/${config.db.name}`);
}

async function disconnect() {
  await sequelize.close();
}

module.exports = { sequelize, connect, disconnect };
