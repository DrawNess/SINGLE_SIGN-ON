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

    const facturacionSecret = crypto.randomBytes(32).toString('hex');
    const facturacionHash = await argon2.hash(facturacionSecret, { type: argon2.argon2id });

    const apiV6Secret = crypto.randomBytes(32).toString('hex');
    const apiV6Hash = await argon2.hash(apiV6Secret, { type: argon2.argon2id });

    const apps = [
      {
        id: uuidv7(),
        name: 'account-portal',
        display_name: 'Portal de Cuenta GEMMATEX',
        client_id: 'app_account_portal_dev',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'account',
        allowed_origins: ['http://localhost:3000', 'http://localhost:4200'],
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'ecommerce',
        display_name: 'E-Commerce GEMMATEX',
        client_id: 'app_ecommerce_dev',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'ecommerce',
        allowed_origins: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4200'],
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'support-portal',
        display_name: 'Portal de Soporte GEMMATEX',
        client_id: 'app_support_dev',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'support',
        allowed_origins: ['http://localhost:3002'],
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
      {
        id: uuidv7(),
        name: 'facturacion-backend',
        display_name: 'Facturación Backend',
        client_id: 'app_facturacion_dev',
        client_secret_hash: facturacionHash,
        type: 'service',
        audience: 'facturacion',
        allowed_origins: EMPTY_TEXT_ARRAY,
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'api-v6-dev',
        display_name: 'API V6 Ecommerce Dev',
        client_id: 'app_api_v6_dev',
        client_secret_hash: apiV6Hash,
        type: 'service',
        audience: 'api-v6',
        allowed_origins: ['http://localhost:1115'],
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
    console.log('account-portal      (spa-web)   client_id: app_account_portal_dev');
    console.log('e-commerce          (spa-web)   client_id: app_ecommerce_dev');
    console.log('support-portal      (spa-web)   client_id: app_support_dev');
    console.log('crm                 (spa-web)   client_id: app_crm_dev');
    console.log('tickets-soporte     (service)   client_id: app_tickets_dev');
    console.log('  client_secret:', ticketsSecret);
    console.log('facturacion-backend (service)   client_id: app_facturacion_dev');
    console.log('  client_secret:', facturacionSecret);
    console.log('api-v6-dev          (service)   client_id: app_api_v6_dev');
    console.log('  client_secret:', apiV6Secret);
    console.log('  ⚠ Crear API key con scopes users:read, users:list');
    console.log('     vía POST /api/v1/admin/applications/<id>/api-keys.');
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠ Los client_secret no se mostrarán otra vez. Guárdalos.');
    console.log('');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('applications', {
      name: {
        [Sequelize.Op.in]: [
          'account-portal',
          'ecommerce',
          'support-portal',
          'tickets-soporte',
          'crm',
          'facturacion-backend',
          'api-v6-dev',
        ],
      },
    });
  },
};
