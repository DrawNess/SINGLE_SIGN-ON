'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  EmailVerification,
  ClientProfile,
  AdminProfile,
  RefreshToken,
} = require('../db/models');
const { sha256 } = require('../utils/hash');
const { randomToken } = require('../utils/random');
const emailService = require('./email.service');
const auditService = require('./audit.service');
const tokenService = require('./token.service');
const config = require('../config/env');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Genera un token random + crea fila en email_verifications.
 * Devuelve el token en plano (jamás se vuelve a poder leer tras esto).
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.email      Email al que se manda (current o new)
 * @param {string} [opts.newEmail] Si presente → flujo de cambio email
 * @param {Object} [opts.transaction] Sequelize transaction
 */
async function issueEmailToken({ userId, email, newEmail = null, transaction }) {
  const plain = randomToken(32);
  const expiresAt = new Date(
    Date.now() + config.security.emailVerifyTtlHours * 60 * 60 * 1000
  );

  await EmailVerification.create(
    {
      user_id: userId,
      email,
      new_email: newEmail,
      token_hash: sha256(plain),
      expires_at: expiresAt,
    },
    { transaction }
  );

  return { plain, expiresAt };
}

/**
 * Invalida (mark used_at) todas las verificaciones activas del user
 * sin new_email (registro). Usado antes de re-enviar para que solo 1 sea válido.
 */
async function invalidatePendingRegistrationTokens(userId, transaction) {
  await EmailVerification.update(
    { used_at: new Date() },
    {
      where: {
        user_id: userId,
        new_email: null,
        used_at: null,
        expires_at: { [Op.gt]: new Date() },
      },
      transaction,
    }
  );
}

/**
 * Consume un token. Marca verificación, activa user (si era registro)
 * o cambia email (si era cambio). Lanza HttpError si inválido.
 *
 * Devuelve { user, mode } donde mode = 'registration' | 'email_change'.
 */
async function consumeToken(plainToken, { req }) {
  const row = await EmailVerification.findOne({
    where: { token_hash: sha256(plainToken) },
  });

  if (!row) {
    throw new HttpError(400, 'InvalidToken', 'Token de verificación inválido');
  }
  if (row.used_at) {
    throw new HttpError(400, 'TokenAlreadyUsed', 'Token ya fue utilizado');
  }
  if (row.expires_at < new Date()) {
    throw new HttpError(400, 'TokenExpired', 'Token expirado');
  }

  const isEmailChange = !!row.new_email;
  const t = await sequelize.transaction();
  let user;
  try {
    user = await User.findByPk(row.user_id, { transaction: t });
    if (!user) {
      await t.rollback();
      throw new HttpError(404, 'UserNotFound', 'Usuario no encontrado');
    }

    if (isEmailChange) {
      // Validar que el nuevo email no esté tomado por otro
      const conflict = await User.findOne({
        where: { email: row.new_email, id: { [Op.ne]: user.id } },
        paranoid: false,
        transaction: t,
      });
      if (conflict) {
        await t.rollback();
        throw new HttpError(409, 'EmailInUse', 'El nuevo email ya está registrado');
      }
      await user.update(
        { email: row.new_email, email_verified_at: new Date() },
        { transaction: t }
      );
      // Por seguridad, revoca todas las sesiones activas
      await RefreshToken.update(
        { revoked_at: new Date(), revoked_reason: 'admin' },
        { where: { user_id: user.id, revoked_at: null }, transaction: t }
      );
    } else {
      // Registro normal: marca verificado + activa
      const updates = { email_verified_at: new Date() };
      if (user.status === 'pending') {
        updates.status = 'active';
      }
      await user.update(updates, { transaction: t });
    }

    await EmailVerification.update(
      { used_at: new Date() },
      { where: { id: row.id }, transaction: t }
    );

    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  await auditService.log({
    action: isEmailChange ? 'auth.email_changed' : 'auth.email_verified',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    ...auditService.fromRequest(req),
    metadata: isEmailChange ? { new_email: row.new_email } : undefined,
  });

  return { user, mode: isEmailChange ? 'email_change' : 'registration' };
}

/**
 * Vuelve a enviar el email de verificación de registro.
 * Anti-enumeración: siempre devuelve 200, exista o no el email.
 */
async function resendRegistrationVerification(email, { req }) {
  const user = await User.findOne({ where: { email } });
  if (!user) return; // silent (anti-enum)
  if (user.email_verified_at) return; // ya verificado, silent

  const firstName = await getFirstName(user.id);

  const t = await sequelize.transaction();
  try {
    await invalidatePendingRegistrationTokens(user.id, t);
    const { plain } = await issueEmailToken({
      userId: user.id,
      email: user.email,
      transaction: t,
    });
    await t.commit();
    await emailService.sendVerificationEmail({
      to: user.email,
      firstName,
      token: plain,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }

  await auditService.log({
    action: 'auth.email_verification.resent',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    ...auditService.fromRequest(req),
  });
}

/**
 * Inicia el flujo de cambio de email. Requiere autenticación + password.
 * Envía email AL NUEVO destino (no al actual).
 */
async function startEmailChange({ user, newEmail, currentPassword, req }) {
  const { verifyPassword } = require('../utils/hash');
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'InvalidPassword', 'Password actual incorrecta');
  }

  // ¿Mismo email? rechazar
  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    throw new HttpError(400, 'BadRequest', 'El nuevo email es igual al actual');
  }

  // ¿Está tomado por otro?
  const conflict = await User.findOne({ where: { email: newEmail } });
  if (conflict) {
    throw new HttpError(409, 'EmailInUse', 'Ese email ya está registrado');
  }

  const firstName = await getFirstName(user.id);

  const { plain } = await issueEmailToken({
    userId: user.id,
    email: newEmail,
    newEmail,
  });

  await emailService.sendEmailChangeEmail({
    to: newEmail,
    firstName,
    newEmail,
    token: plain,
  });

  await auditService.log({
    action: 'auth.email_change.requested',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    ...auditService.fromRequest(req),
    metadata: { new_email: newEmail },
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
  issueEmailToken,
  invalidatePendingRegistrationTokens,
  consumeToken,
  resendRegistrationVerification,
  startEmailChange,
};
