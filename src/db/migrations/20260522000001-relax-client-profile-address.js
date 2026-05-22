'use strict';

/**
 * Hace opcionales los campos de dirección en client_profiles.
 * Razón: el registro inicial no requiere dirección completa.
 * El cliente puede completarla después desde su perfil.
 *
 * Campos afectados:
 *   - departamento, provincia, ciudad, calle_avenida, numero  →  allowNull TRUE
 *
 * Mantienen NOT NULL: first_name, last_name, phone, country.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE client_profiles ALTER COLUMN departamento DROP NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN provincia DROP NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN ciudad DROP NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN calle_avenida DROP NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN numero DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    // Revert: vuelven a NOT NULL.
    // CUIDADO: filas con NULL romperán al revertir. Hacer UPDATE antes si aplica.
    await queryInterface.sequelize.query(`
      ALTER TABLE client_profiles ALTER COLUMN departamento SET NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN provincia SET NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN ciudad SET NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN calle_avenida SET NOT NULL;
      ALTER TABLE client_profiles ALTER COLUMN numero SET NOT NULL;
    `);
  },
};
