'use strict';

/**
 * Carga todos los modelos Sequelize y registra asociaciones.
 *
 * Uso:
 *   const { models, sequelize } = require('./src/db/models');
 *   const user = await models.User.findOne(...);
 */

const fs = require('node:fs');
const path = require('node:path');
const { sequelize } = require('../../config/db');

const models = {};

const files = fs
  .readdirSync(__dirname)
  .filter(
    (f) =>
      f !== 'index.js' &&
      f.endsWith('.js') &&
      !f.startsWith('.') &&
      !f.endsWith('.test.js')
  );

for (const file of files) {
  const factory = require(path.join(__dirname, file));
  const model = factory(sequelize);
  models[model.name] = model;
}

// Registrar asociaciones después de cargar todos los modelos
for (const name of Object.keys(models)) {
  if (typeof models[name].associate === 'function') {
    models[name].associate(models);
  }
}

module.exports = {
  sequelize,
  models,
  ...models,
};
