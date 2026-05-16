'use strict';

const { uuidv7 } = require('uuidv7');

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert('roles', [
      {
        id: uuidv7(),
        name: 'client',
        description: 'Cliente final. Accede a e-commerce y tickets de soporte.',
        is_system: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'staff',
        description: 'Personal interno con acceso limitado a herramientas de soporte.',
        is_system: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'admin',
        description: 'Administrador. Gestión de usuarios, roles y aplicaciones.',
        is_system: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'super_admin',
        description: 'Super administrador. Control total del sistema, gestión de admins.',
        is_system: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('roles', {
      name: { [Sequelize.Op.in]: ['client', 'staff', 'admin', 'super_admin'] },
    });
  },
};
