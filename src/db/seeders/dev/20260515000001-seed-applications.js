'use strict';

const { Sequelize } = require('sequelize');
const { uuidv7 } = require('uuidv7');
const crypto = require('node:crypto');
const argon2 = require('argon2');

// Postgres no infiere tipo de array vacío sin cast explícito.
const EMPTY_TEXT_ARRAY = Sequelize.literal("'{}'::text[]");

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // Solo apps tipo `service` necesitan client_secret (CHECK constraint).
    // Las SPA web NO tienen secret porque el código JS lo expondría.
    const ticketsSecret = crypto.randomBytes(32).toString('hex');
    const ticketsHash = await argon2.hash(ticketsSecret, { type: argon2.argon2id });

    const apps = [
      {
        id: uuidv7(),
        name: 'ecommerce',
        display_name: 'E-Commerce GEMMATEX',
        client_id: 'app_ecommerce_dev',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'ecommerce',
        allowed_origins: ['http://localhost:3000', 'http://localhost:5173'],
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'tickets-soporte',
        display_name: 'Tickets de Soporte',
        client_id: 'app_tickets_dev',
        client_secret_hash: ticketsHash,
        type: 'service',
        audience: 'tickets',
        allowed_origins: EMPTY_TEXT_ARRAY,
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'crm',
        display_name: 'CRM Administrativo',
        client_id: 'app_crm_dev',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'crm',
        allowed_origins: ['http://localhost:3001'],
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ];

    await queryInterface.bulkInsert('applications', apps);

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('APLICACIONES (DEV) CREADAS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('e-commerce      (spa-web)   client_id: app_ecommerce_dev');
    console.log('crm             (spa-web)   client_id: app_crm_dev');
    console.log('tickets-soporte (service)   client_id: app_tickets_dev');
    console.log('  client_secret:', ticketsSecret);
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠ El client_secret no se mostrará otra vez. Guárdalo.');
    console.log('');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('applications', {
      name: { [Sequelize.Op.in]: ['ecommerce', 'tickets-soporte', 'crm'] },
    });
  },
};
