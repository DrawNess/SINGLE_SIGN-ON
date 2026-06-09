'use strict';

const { Sequelize } = require('sequelize');
const { uuidv7 } = require('uuidv7');
const crypto = require('node:crypto');
const argon2 = require('argon2');

const EMPTY_TEXT_ARRAY = Sequelize.literal("'{}'::text[]");

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const [existing] = await queryInterface.sequelize.query(
      "SELECT client_id FROM applications WHERE client_id LIKE '%_prod'"
    );
    if (existing.length > 0) {
      console.log('Apps prod ya existen, skip:', existing.map(a => a.client_id).join(', '));
      return;
    }

    const apiV6Secret = crypto.randomBytes(32).toString('hex');
    const apiV6Hash = await argon2.hash(apiV6Secret, { type: argon2.argon2id });

    const apps = [
      {
        id: uuidv7(),
        name: 'account-portal-prod',
        display_name: 'Portal de Cuenta GEMMATEX',
        client_id: 'app_account_portal_prod',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'account',
        allowed_origins: ['https://account.gemmatex.com.bo'],
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'ecommerce-prod',
        display_name: 'E-Commerce GEMMATEX',
        client_id: 'app_ecommerce_prod',
        client_secret_hash: null,
        type: 'spa-web',
        audience: 'ecommerce',
        allowed_origins: ['https://gemmatex.com.bo', 'https://account.gemmatex.com.bo'],
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv7(),
        name: 'api-v6-prod',
        display_name: 'API V6 Ecommerce (Producción)',
        client_id: 'app_api_v6_prod',
        client_secret_hash: apiV6Hash,
        type: 'service',
        audience: 'api-v6',
        allowed_origins: EMPTY_TEXT_ARRAY,
        allowed_redirect_uris: EMPTY_TEXT_ARRAY,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ];

    await queryInterface.bulkInsert('applications', apps);

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('APLICACIONES (PROD) CREADAS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('account-portal-prod  (spa-web)   client_id: app_account_portal_prod');
    console.log('ecommerce-prod       (spa-web)   client_id: app_ecommerce_prod');
    console.log('api-v6-prod          (service)   client_id: app_api_v6_prod');
    console.log('  client_secret:', apiV6Secret);
    console.log('  ⚠ Crear API key con scopes users:read, users:list');
    console.log('     vía POST /api/v1/admin/applications/<id>/api-keys.');
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠ El client_secret NO se mostrará otra vez. Guárdalo.');
    console.log('');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('applications', {
      client_id: {
        [Sequelize.Op.in]: [
          'app_account_portal_prod',
          'app_ecommerce_prod',
          'app_api_v6_prod',
        ],
      },
    });
  },
};
