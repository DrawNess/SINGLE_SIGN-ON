'use strict';

/**
 * Índices para performance de /admin/stats.
 *
 * Sin estos índices las queries son sequential scan sobre audit_logs.
 * Con 100K+ filas se nota; con 1M+ es crítico.
 *
 * Reversible.
 */
module.exports = {
  async up(queryInterface) {
    // audit_logs: filtros por action + created_at (queries del dashboard)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at
      ON audit_logs (action, created_at DESC);
    `);

    // audit_logs: WHERE action AND user_id IS NOT NULL (first login query)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action_user_created
      ON audit_logs (action, user_id, created_at)
      WHERE user_id IS NOT NULL;
    `);

    // users: GROUP BY DATE(created_at) y filtros por rango
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_users_created_at
      ON users (created_at);
    `);

    // refresh_tokens: WHERE revoked_at IS NULL AND expires_at > NOW()
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
      ON refresh_tokens (expires_at)
      WHERE revoked_at IS NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_audit_logs_action_created_at`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_audit_logs_action_user_created`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_users_created_at`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS idx_refresh_tokens_active`);
  },
};
