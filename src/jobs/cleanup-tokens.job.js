'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  RefreshToken,
  EmailVerification,
  PasswordReset,
  PhoneVerification,
  AuditLog,
} = require('../db/models');
const config = require('../config/env');

// ID determinístico para advisory lock (cualquier int64 estable)
const ADVISORY_LOCK_ID = 92348923489234;

/**
 * Job de limpieza periódica.
 *
 * Borra:
 *   - refresh_tokens revocados o expirados hace >N días
 *   - email_verifications usados o expirados >N días
 *   - password_resets usados o expirados >N días
 *   - phone_verifications usados o expirados >N días
 *   - audit_logs muy viejos (compliance: >365d default)
 *
 * Usa `pg_try_advisory_lock` para que solo UNA réplica del SSO ejecute a la vez.
 */
async function cleanupTokens() {
  const startedAt = Date.now();
  const stats = {
    refresh_tokens: 0,
    email_verifications: 0,
    password_resets: 0,
    phone_verifications: 0,
    audit_logs: 0,
    skipped: false,
    duration_ms: 0,
  };

  // Advisory lock: solo 1 pod ejecuta el job en clusters multi-réplica.
  const [[lockRow]] = await sequelize.query(
    'SELECT pg_try_advisory_lock(:id) AS got',
    { replacements: { id: ADVISORY_LOCK_ID } }
  );
  if (!lockRow.got) {
    console.log('[job:cleanup] otro pod ya lo está corriendo, skip');
    stats.skipped = true;
    return stats;
  }

  try {
    const now = new Date();

    // 1) refresh_tokens revocados o expirados
    const refreshCutoff = new Date(
      now.getTime() - config.jobs.cleanupRefreshTokensDays * 86400000
    );
    stats.refresh_tokens = await RefreshToken.destroy({
      where: {
        [Op.or]: [
          { revoked_at: { [Op.lt]: refreshCutoff } },
          { expires_at: { [Op.lt]: refreshCutoff } },
        ],
      },
    });

    // 2) email_verifications
    const emailCutoff = new Date(
      now.getTime() - config.jobs.cleanupEmailTokensDays * 86400000
    );
    stats.email_verifications = await EmailVerification.destroy({
      where: {
        [Op.or]: [
          { used_at: { [Op.lt]: emailCutoff } },
          { expires_at: { [Op.lt]: emailCutoff } },
        ],
      },
    });

    // 3) password_resets
    const pwCutoff = new Date(
      now.getTime() - config.jobs.cleanupPasswordResetsDays * 86400000
    );
    stats.password_resets = await PasswordReset.destroy({
      where: {
        [Op.or]: [
          { used_at: { [Op.lt]: pwCutoff } },
          { expires_at: { [Op.lt]: pwCutoff } },
        ],
      },
    });

    // 4) phone_verifications
    const phoneCutoff = new Date(
      now.getTime() - config.jobs.cleanupPhoneVerificationsDays * 86400000
    );
    stats.phone_verifications = await PhoneVerification.destroy({
      where: {
        [Op.or]: [
          { used_at: { [Op.lt]: phoneCutoff } },
          { expires_at: { [Op.lt]: phoneCutoff } },
        ],
      },
    });

    // 5) audit_logs muy viejos (compliance: retención larga)
    const auditCutoff = new Date(
      now.getTime() - config.jobs.cleanupAuditLogsDays * 86400000
    );
    stats.audit_logs = await AuditLog.destroy({
      where: { created_at: { [Op.lt]: auditCutoff } },
    });

    stats.duration_ms = Date.now() - startedAt;

    console.log('[job:cleanup] OK', JSON.stringify(stats));
  } catch (err) {
    console.error('[job:cleanup] error:', err.message);
    stats.error = err.message;
  } finally {
    // Liberar lock SIEMPRE
    await sequelize.query('SELECT pg_advisory_unlock(:id)', {
      replacements: { id: ADVISORY_LOCK_ID },
    });
  }

  return stats;
}

module.exports = { cleanupTokens, ADVISORY_LOCK_ID };
