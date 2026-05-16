'use strict';

/**
 * Migración inicial del schema SSO GEMMATEX.
 * Crea las 15 tablas con enums, índices, CHECK constraints y triggers updated_at.
 *
 * Orden de creación respeta dependencias FK:
 *   roles → users → applications → user_roles → client_profiles → admin_profiles
 *   → auth_providers → api_keys → refresh_tokens → email_verifications
 *   → phone_verifications → password_resets → password_history
 *   → admin_invitations → audit_logs
 *
 * Notas:
 * - PKs UUID v7 generados en app (lib uuidv7) — sin default en DB.
 * - Enums nativos Postgres (Sequelize crea `enum_<tabla>_<columna>`).
 * - Soft delete (`deleted_at`) en `users` y `applications`.
 * - Trigger `set_updated_at()` para actualizar `updated_at` desde SQL directo.
 */

const now = (Sequelize) => Sequelize.fn('NOW');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const NOW = now(Sequelize);

    // ============================================================
    // 1. roles
    // ============================================================
    await queryInterface.createTable('roles', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 2. users
    // ============================================================
    await queryInterface.createTable('users', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      email: { type: DataTypes.CITEXT, allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: true },
      status: {
        type: DataTypes.ENUM('pending', 'active', 'suspended', 'deleted'),
        allowNull: false,
        defaultValue: 'pending',
      },
      email_verified_at: { type: DataTypes.DATE, allowNull: true },
      failed_login_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: { type: DataTypes.DATE, allowNull: true },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
      last_login_ip: { type: DataTypes.INET, allowNull: true },
      password_changed_at: { type: DataTypes.DATE, allowNull: true },
      totp_secret: { type: DataTypes.STRING(255), allowNull: true },
      totp_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });

    // ============================================================
    // 3. applications
    // ============================================================
    await queryInterface.createTable('applications', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      display_name: { type: DataTypes.STRING(150), allowNull: false },
      client_id: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      client_secret_hash: { type: DataTypes.STRING(255), allowNull: true },
      type: {
        type: DataTypes.ENUM('spa-web', 'mobile', 'desktop', 'service'),
        allowNull: false,
      },
      audience: { type: DataTypes.STRING(100), allowNull: false },
      allowed_origins: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      allowed_redirect_uris: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });

    // ============================================================
    // 4. user_roles (M:N, PK compuesta)
    // ============================================================
    await queryInterface.createTable('user_roles', {
      user_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      assigned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      assigned_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
    });

    // ============================================================
    // 5. client_profiles (1:1)
    // ============================================================
    await queryInterface.createTable('client_profiles', {
      user_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      phone: { type: DataTypes.STRING(13), allowNull: false, unique: true },
      phone_verified_at: { type: DataTypes.DATE, allowNull: true },
      document_type: {
        type: DataTypes.ENUM('CI', 'NIT'),
        allowNull: true,
      },
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
        allowNull: false,
      },
      provincia: { type: DataTypes.STRING(100), allowNull: false },
      ciudad: { type: DataTypes.STRING(100), allowNull: false },
      calle_avenida: { type: DataTypes.STRING(200), allowNull: false },
      numero: { type: DataTypes.STRING(20), allowNull: false },
      casa_dpto: { type: DataTypes.STRING(50), allowNull: true },
      link_google_maps: { type: DataTypes.TEXT, allowNull: true },
      country: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'BO' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 6. admin_profiles (1:1)
    // ============================================================
    await queryInterface.createTable('admin_profiles', {
      user_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      job_title: { type: DataTypes.STRING(100), allowNull: true },
      department: { type: DataTypes.STRING(100), allowNull: true },
      employee_code: { type: DataTypes.STRING(50), allowNull: true, unique: true },
      phone: { type: DataTypes.STRING(20), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 7. auth_providers (OAuth futuro)
    // ============================================================
    await queryInterface.createTable('auth_providers', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      provider: {
        type: DataTypes.ENUM('google', 'facebook', 'microsoft'),
        allowNull: false,
      },
      provider_user_id: { type: DataTypes.STRING(255), allowNull: false },
      email: { type: DataTypes.CITEXT, allowNull: true },
      access_token_enc: { type: DataTypes.TEXT, allowNull: true },
      refresh_token_enc: { type: DataTypes.TEXT, allowNull: true },
      token_expires_at: { type: DataTypes.DATE, allowNull: true },
      profile_data: { type: DataTypes.JSONB, allowNull: true },
      linked_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 8. api_keys (service-to-service)
    // ============================================================
    await queryInterface.createTable('api_keys', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      application_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'applications', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING(100), allowNull: false },
      key_prefix: { type: DataTypes.STRING(16), allowNull: false },
      key_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      scopes: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
      last_used_at: { type: DataTypes.DATE, allowNull: true },
      last_used_ip: { type: DataTypes.INET, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 9. refresh_tokens (rotación + family + theft detection)
    // ============================================================
    await queryInterface.createTable('refresh_tokens', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      application_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'applications', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      family_id: { type: DataTypes.UUID, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      revoked_reason: {
        type: DataTypes.ENUM('logout', 'rotation', 'theft_detected', 'admin', 'password_changed'),
        allowNull: true,
      },
      replaced_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'refresh_tokens', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      ip: { type: DataTypes.INET, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 10. email_verifications
    // ============================================================
    await queryInterface.createTable('email_verifications', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      email: { type: DataTypes.CITEXT, allowNull: false },
      new_email: { type: DataTypes.CITEXT, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 11. phone_verifications
    // ============================================================
    await queryInterface.createTable('phone_verifications', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      phone: { type: DataTypes.STRING(13), allowNull: false },
      code_hash: { type: DataTypes.STRING(255), allowNull: false },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 12. password_resets
    // ============================================================
    await queryInterface.createTable('password_resets', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      ip: { type: DataTypes.INET, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 13. password_history (últimas N contraseñas hasheadas)
    // ============================================================
    await queryInterface.createTable('password_history', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 14. admin_invitations
    // ============================================================
    await queryInterface.createTable('admin_invitations', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      email: { type: DataTypes.CITEXT, allowNull: false },
      invited_role_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      invited_by: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      accepted_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // 15. audit_logs
    // ============================================================
    await queryInterface.createTable('audit_logs', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      actor_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      actor_type: {
        type: DataTypes.ENUM('user', 'admin', 'system', 'api_key'),
        allowNull: false,
      },
      api_key_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'api_keys', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      application_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'applications', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      action: { type: DataTypes.STRING(100), allowNull: false },
      entity: { type: DataTypes.STRING(100), allowNull: true },
      entity_id: { type: DataTypes.UUID, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      ip: { type: DataTypes.INET, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: NOW },
    });

    // ============================================================
    // ÍNDICES ADICIONALES
    // ============================================================

    // users
    await queryInterface.addIndex('users', ['status'], { name: 'idx_users_status' });
    await queryInterface.addIndex('users', ['deleted_at'], { name: 'idx_users_deleted_at' });
    await queryInterface.addIndex('users', ['locked_until'], { name: 'idx_users_locked_until' });
    // Índice parcial usuarios activos (raw SQL — Sequelize no soporta WHERE)
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_users_active ON users(email)
      WHERE deleted_at IS NULL AND status = 'active'
    `);

    // applications
    await queryInterface.addIndex('applications', ['is_active'], { name: 'idx_applications_is_active' });
    await queryInterface.addIndex('applications', ['deleted_at'], { name: 'idx_applications_deleted_at' });

    // user_roles
    await queryInterface.addIndex('user_roles', ['role_id'], { name: 'idx_user_roles_role_id' });

    // client_profiles
    await queryInterface.addIndex('client_profiles', ['phone'], { name: 'idx_client_profiles_phone' });

    // auth_providers
    await queryInterface.addIndex('auth_providers', ['provider', 'provider_user_id'], {
      name: 'uq_auth_providers_provider_user',
      unique: true,
    });
    await queryInterface.addIndex('auth_providers', ['user_id'], { name: 'idx_auth_providers_user_id' });

    // api_keys
    await queryInterface.addIndex('api_keys', ['application_id'], { name: 'idx_api_keys_application_id' });
    await queryInterface.addIndex('api_keys', ['revoked_at'], { name: 'idx_api_keys_revoked_at' });
    await queryInterface.addIndex('api_keys', ['expires_at'], { name: 'idx_api_keys_expires_at' });

    // refresh_tokens
    await queryInterface.addIndex('refresh_tokens', ['user_id'], { name: 'idx_refresh_tokens_user_id' });
    await queryInterface.addIndex('refresh_tokens', ['family_id'], { name: 'idx_refresh_tokens_family_id' });
    await queryInterface.addIndex('refresh_tokens', ['expires_at'], { name: 'idx_refresh_tokens_expires_at' });
    await queryInterface.addIndex('refresh_tokens', ['revoked_at'], { name: 'idx_refresh_tokens_revoked_at' });

    // email_verifications
    await queryInterface.addIndex('email_verifications', ['user_id'], { name: 'idx_email_verifications_user_id' });
    await queryInterface.addIndex('email_verifications', ['expires_at'], { name: 'idx_email_verifications_expires_at' });

    // phone_verifications
    await queryInterface.addIndex('phone_verifications', ['user_id'], { name: 'idx_phone_verifications_user_id' });
    await queryInterface.addIndex('phone_verifications', ['expires_at'], { name: 'idx_phone_verifications_expires_at' });

    // password_resets
    await queryInterface.addIndex('password_resets', ['user_id'], { name: 'idx_password_resets_user_id' });

    // password_history
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_password_history_user_created
      ON password_history(user_id, created_at DESC)
    `);

    // admin_invitations
    await queryInterface.addIndex('admin_invitations', ['email'], { name: 'idx_admin_invitations_email' });
    await queryInterface.addIndex('admin_invitations', ['expires_at'], { name: 'idx_admin_invitations_expires_at' });

    // audit_logs
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC)
    `);
    await queryInterface.addIndex('audit_logs', ['actor_id'], { name: 'idx_audit_logs_actor_id' });
    await queryInterface.addIndex('audit_logs', ['action'], { name: 'idx_audit_logs_action' });
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC)
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX idx_audit_logs_metadata ON audit_logs USING GIN(metadata)
    `);

    // ============================================================
    // CHECK CONSTRAINTS
    // ============================================================

    // Phone formato Bolivia
    await queryInterface.sequelize.query(`
      ALTER TABLE client_profiles
      ADD CONSTRAINT check_phone_bolivia_format
      CHECK (phone ~ '^\\+591[0-9]{8}$')
    `);

    // NIT requiere razon_social
    await queryInterface.sequelize.query(`
      ALTER TABLE client_profiles
      ADD CONSTRAINT check_nit_requires_razon_social
      CHECK (
        document_type IS NULL
        OR document_type = 'CI'
        OR (document_type = 'NIT' AND razon_social IS NOT NULL)
      )
    `);

    // Application secret por tipo (SPA no tiene secret, resto sí)
    await queryInterface.sequelize.query(`
      ALTER TABLE applications
      ADD CONSTRAINT check_app_secret_by_type
      CHECK (
        (type = 'spa-web' AND client_secret_hash IS NULL)
        OR (type IN ('mobile', 'desktop', 'service') AND client_secret_hash IS NOT NULL)
      )
    `);

    // ============================================================
    // TRIGGER updated_at automático
    // ============================================================

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    const tablesWithUpdatedAt = [
      'users',
      'roles',
      'applications',
      'client_profiles',
      'admin_profiles',
      'auth_providers',
      'admin_invitations',
    ];

    for (const table of tablesWithUpdatedAt) {
      await queryInterface.sequelize.query(`
        CREATE TRIGGER tg_${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `);
    }
  },

  async down(queryInterface, Sequelize) {
    // Drop triggers + función (CASCADE no, hacemos explícito)
    const tablesWithUpdatedAt = [
      'users',
      'roles',
      'applications',
      'client_profiles',
      'admin_profiles',
      'auth_providers',
      'admin_invitations',
    ];

    for (const table of tablesWithUpdatedAt) {
      await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS tg_${table}_updated_at ON ${table}`);
    }
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS set_updated_at()');

    // Drop tablas en orden inverso
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('admin_invitations');
    await queryInterface.dropTable('password_history');
    await queryInterface.dropTable('password_resets');
    await queryInterface.dropTable('phone_verifications');
    await queryInterface.dropTable('email_verifications');
    await queryInterface.dropTable('refresh_tokens');
    await queryInterface.dropTable('api_keys');
    await queryInterface.dropTable('auth_providers');
    await queryInterface.dropTable('admin_profiles');
    await queryInterface.dropTable('client_profiles');
    await queryInterface.dropTable('user_roles');
    await queryInterface.dropTable('applications');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('roles');

    // Drop enums (Sequelize los crea con prefijo enum_<tabla>_<columna>)
    const enums = [
      'enum_users_status',
      'enum_applications_type',
      'enum_client_profiles_document_type',
      'enum_client_profiles_departamento',
      'enum_auth_providers_provider',
      'enum_refresh_tokens_revoked_reason',
      'enum_audit_logs_actor_type',
    ];
    for (const e of enums) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${e}"`);
    }
  },
};
