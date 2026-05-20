'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  PasswordReset,
  PasswordHistory,
  RefreshToken,
  ClientProfile,
  AdminProfile,
} = require('../db/models');
const { hashPassword, verifyPassword, sha256 } = require('../utils/hash');
const { randomToken } = require('../utils/random');
const emailService = require('./email.service');
const auditService = require('./audit.service');
const tokenService = require('./token.service');
const config = require('../config/env');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Inicia el flujo de "olvidé mi contraseña".
 * - Anti-enumeración: siempre se comporta igual exista o no el email.
 * - Genera token random, guarda sha256 en password_resets.
 * - Manda email con link a {EMAIL_RESET_URL_TEMPLATE}.
 */
async function startForgotPassword(email, { req }) {
  const user = await User.findOne({ where: { email } });
  if (!user || user.status === 'deleted') return; // silencioso

  // Invalida tokens previos no usados (1 token activo a la vez)
  await PasswordReset.update(
    { used_at: new Date() },
    {
      where: {
        user_id: user.id,
        used_at: null,
        expires_at: { [Op.gt]: new Date() },
      },
    }
  );

  const plain = randomToken(32);
  const expiresAt = new Date(
    Date.now() + config.security.passwordResetTtlHours * 60 * 60 * 1000
  );

  await PasswordReset.create({
    user_id: user.id,
    token_hash: sha256(plain),
    expires_at: expiresAt,
    ip: req.ip || null,
    user_agent: req.get('user-agent') || null,
  });

  const firstName = await getFirstName(user.id);
  await emailService.sendPasswordResetEmail({
    to: user.email,
    firstName,
    token: plain,
  });

  await auditService.log({
    action: 'auth.password.reset_requested',
    userId: user.id,
    actorType: 'user',
    ...auditService.fromRequest(req),
  });
}

/**
 * Consume el token y cambia la contraseña.
 * - Valida token, expiración, no-reuse.
 * - Aplica password_history check (no reusar últimas N).
 * - Hashea nueva con Argon2id.
 * - Revoca todos los refresh tokens del usuario.
 * - Audit log.
 */
async function resetPassword({ token, newPassword, req }) {
  const row = await PasswordReset.findOne({
    where: { token_hash: sha256(token) },
  });

  if (!row) throw new HttpError(400, 'InvalidToken', 'Token inválido');
  if (row.used_at)
    throw new HttpError(400, 'TokenAlreadyUsed', 'Token ya fue utilizado');
  if (row.expires_at < new Date())
    throw new HttpError(400, 'TokenExpired', 'Token expirado');

  const user = await User.findByPk(row.user_id);
  if (!user) throw new HttpError(404, 'UserNotFound', 'Usuario no encontrado');

  await rejectIfReusedPassword(user, newPassword);

  await applyPasswordChange({
    user,
    newPassword,
    revokeReason: 'password_changed',
    action: 'auth.password.reset_completed',
    passwordResetId: row.id,
    req,
  });
}

/**
 * Cambio de contraseña por user autenticado (sabe la actual).
 */
async function changePassword({ user, currentPassword, newPassword, req }) {
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) {
    await auditService.log({
      action: 'auth.password.change_failed',
      userId: user.id,
      actorId: user.id,
      actorType: 'user',
      ...auditService.fromRequest(req),
      metadata: { reason: 'invalid_current_password' },
    });
    throw new HttpError(401, 'InvalidPassword', 'Password actual incorrecta');
  }

  if (newPassword === currentPassword) {
    throw new HttpError(
      400,
      'SamePassword',
      'La nueva contraseña debe ser distinta de la actual'
    );
  }

  await rejectIfReusedPassword(user, newPassword);

  await applyPasswordChange({
    user,
    newPassword,
    revokeReason: 'password_changed',
    action: 'auth.password.changed',
    req,
  });
}

// ============================================================
// Internos
// ============================================================

async function rejectIfReusedPassword(user, newPassword) {
  if (!user.password_hash) return; // sin password previa (OAuth-only), nada que comparar

  // Compara contra la actual
  if (await verifyPassword(newPassword, user.password_hash)) {
    throw new HttpError(
      400,
      'PasswordReused',
      `No puedes reusar una de tus últimas ${
        config.security.passwordHistorySize + 1
      } contraseñas`
    );
  }

  const size = config.security.passwordHistorySize;
  if (size <= 0) return;

  const history = await PasswordHistory.findAll({
    where: { user_id: user.id },
    order: [['created_at', 'DESC']],
    limit: size,
  });

  for (const row of history) {
    if (await verifyPassword(newPassword, row.password_hash)) {
      throw new HttpError(
        400,
        'PasswordReused',
        `No puedes reusar una de tus últimas ${size + 1} contraseñas`
      );
    }
  }
}

async function applyPasswordChange({
  user,
  newPassword,
  revokeReason,
  action,
  passwordResetId = null,
  req,
}) {
  const newHash = await hashPassword(newPassword);
  const t = await sequelize.transaction();
  try {
    // Guarda hash actual en history ANTES de sobrescribir
    if (user.password_hash) {
      await PasswordHistory.create(
        { user_id: user.id, password_hash: user.password_hash },
        { transaction: t }
      );
    }

    // Trim historial: solo dejar las últimas N
    await trimPasswordHistory(user.id, t);

    // Actualiza user
    await user.update(
      {
        password_hash: newHash,
        password_changed_at: new Date(),
        failed_login_attempts: 0,
        locked_until: null,
      },
      { transaction: t }
    );

    // Si es reset, marca token usado
    if (passwordResetId) {
      await PasswordReset.update(
        { used_at: new Date() },
        { where: { id: passwordResetId }, transaction: t }
      );
    }

    // Revoca todos los refresh activos (fuerza re-login en todos los devices)
    await RefreshToken.update(
      { revoked_at: new Date(), revoked_reason: revokeReason },
      { where: { user_id: user.id, revoked_at: null }, transaction: t }
    );

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  await auditService.log({
    action,
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    ...auditService.fromRequest(req),
  });

  // Best-effort: notifica al user que cambió la contraseña
  notifyPasswordChanged(user, req).catch((e) =>
    console.error('[notifyPasswordChanged] fallo:', e.message)
  );
}

async function notifyPasswordChanged(user, req) {
  const firstName = await getFirstName(user.id);
  await emailService.sendPasswordChangedEmail({
    to: user.email,
    firstName,
    ip: req.ip || 'desconocida',
    userAgent: req.get('user-agent') || 'desconocido',
    when: new Date().toISOString(),
  });
}

async function trimPasswordHistory(userId, transaction) {
  const size = config.security.passwordHistorySize;
  if (size <= 0) return;

  const all = await PasswordHistory.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    transaction,
  });

  if (all.length <= size) return;

  const toDelete = all.slice(size).map((r) => r.id);
  await PasswordHistory.destroy({
    where: { id: { [Op.in]: toDelete } },
    transaction,
  });
}

async function getFirstName(userId) {
  const cp = await ClientProfile.findOne({ where: { user_id: userId } });
  if (cp) return cp.first_name;
  const ap = await AdminProfile.findOne({ where: { user_id: userId } });
  if (ap) return ap.first_name;
  return '';
}

module.exports = {
  startForgotPassword,
  resetPassword,
  changePassword,
};
