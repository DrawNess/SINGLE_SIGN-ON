'use strict';

const { uuidv7 } = require('uuidv7');
const argon2 = require('argon2');
const crypto = require('node:crypto');

module.exports = {
  async up(queryInterface) {
    const email = 'admin@gemmatex.com.bo';

    const [roles] = await queryInterface.sequelize.query(
      "SELECT id FROM roles WHERE name = 'super_admin' LIMIT 1"
    );
    if (!roles[0]) {
      throw new Error("Rol 'super_admin' no encontrado. Corre primero: npm run db:seed");
    }

    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      { bind: [email] }
    );
    if (existing[0]) {
      console.log(`super_admin ya existe (${email}). Skip.`);
      return;
    }

    const password = crypto
      .randomBytes(16)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 16);

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const userId = uuidv7();
    const now = new Date();

    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.bulkInsert(
        'users',
        [{
          id: userId,
          email,
          password_hash: passwordHash,
          status: 'active',
          email_verified_at: now,
          failed_login_attempts: 0,
          password_changed_at: now,
          totp_enabled: false,
          created_at: now,
          updated_at: now,
        }],
        { transaction: t }
      );

      await queryInterface.bulkInsert(
        'admin_profiles',
        [{
          user_id: userId,
          first_name: 'Super',
          last_name: 'Admin',
          job_title: 'Administrador del Sistema',
          department: 'IT',
          created_at: now,
          updated_at: now,
        }],
        { transaction: t }
      );

      await queryInterface.bulkInsert(
        'user_roles',
        [{
          user_id: userId,
          role_id: roles[0].id,
          assigned_at: now,
        }],
        { transaction: t }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('SUPER ADMIN (PROD) CREADO');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Email:    ${email}`);
    console.log(`Password: ${password}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠ Cambia esta password tras el primer login.');
    console.log('⚠ Esta password NO se mostrará otra vez.');
    console.log('');
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { email: 'admin@gemmatex.com.bo' });
  },
};
