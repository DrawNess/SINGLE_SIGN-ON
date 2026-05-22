'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Role,
  UserRole,
  ClientProfile,
  Application,
} = require('../db/models');
const { hashPassword, verifyPassword } = require('../utils/hash');
const tokenService = require('./token.service');
const auditService = require('./audit.service');
const verificationService = require('./verification.service');
const emailService = require('./email.service');
const { HttpError } = require('../middleware/errorHandler');
const config = require('../config/env');

/**
 * Resuelve la application desde el header X-Client-Id.
 * Lanza 400 si no existe o no está activa.
 */
async function resolveApplication(clientId) {
  if (!clientId) {
    throw new HttpError(400, 'BadRequest', 'Header X-Client-Id requerido');
  }
  const app = await Application.findOne({
    where: { client_id: clientId, is_active: true },
  });
  if (!app) {
    throw new HttpError(400, 'BadRequest', 'Aplicación no encontrada o inactiva');
  }
  return app;
}

async function getRoleNames(userId) {
  const roles = await Role.findAll({
    include: [
      {
        model: UserRole,
        as: 'userRoles',
        where: { user_id: userId },
        attributes: [],
        required: true,
      },
    ],
    attributes: ['name'],
  });
  return roles.map((r) => r.name);
}

/**
 * Registra un nuevo cliente.
 * - Crea user + client_profile + asigna rol 'client' en transacción.
 * - Status 'active' por ahora (verificación email/SMS = futura iteración).
 * - Devuelve usuario público sin emitir tokens (debe loguear después).
 */
async function register(input, { req, application }) {
  const existing = await User.findOne({ where: { email: input.email } });
  if (existing) {
    throw new HttpError(409, 'EmailInUse', 'Email ya registrado');
  }
  const existingPhone = await ClientProfile.findOne({
    where: { phone: input.phone },
  });
  if (existingPhone) {
    throw new HttpError(409, 'PhoneInUse', 'Teléfono ya registrado');
  }
  if (input.document_number) {
    const existingDoc = await ClientProfile.findOne({
      where: { document_number: input.document_number },
    });
    if (existingDoc) {
      throw new HttpError(409, 'DocumentInUse', 'Documento ya registrado');
    }
  }

  const passwordHash = await hashPassword(input.password);
  const clientRole = await Role.findOne({ where: { name: 'client' } });
  if (!clientRole) {
    throw new HttpError(500, 'ConfigError', "Rol 'client' no existe. Corre seed.");
  }

  const t = await sequelize.transaction();
  let user;
  let emailToken;
  try {
    user = await User.create(
      {
        email: input.email,
        password_hash: passwordHash,
        status: 'pending',
        password_changed_at: new Date(),
      },
      { transaction: t }
    );

    await ClientProfile.create(
      {
        user_id: user.id,
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone,
        document_type: input.document_type || null,
        document_number: input.document_number || null,
        razon_social: input.razon_social || null,
        birth_date: input.birth_date || null,
        departamento: input.departamento || null,
        provincia: input.provincia || null,
        ciudad: input.ciudad || null,
        calle_avenida: input.calle_avenida || null,
        numero: input.numero || null,
        casa_dpto: input.casa_dpto || null,
        link_google_maps: input.link_google_maps || null,
      },
      { transaction: t }
    );

    await UserRole.create(
      { user_id: user.id, role_id: clientRole.id, assigned_by: user.id },
      { transaction: t }
    );

    // Emite token de verificación de email dentro de la misma TX
    const issued = await verificationService.issueEmailToken({
      userId: user.id,
      email: user.email,
      transaction: t,
    });
    emailToken = issued.plain;

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // Enviar email FUERA de la transacción (no debe romper registro)
  try {
    await emailService.sendVerificationEmail({
      to: user.email,
      firstName: input.first_name,
      token: emailToken,
    });
  } catch (err) {
    console.error('[register] envío email falló:', err.message);
    // No throw — registro ya está OK, usuario puede pedir resend.
  }

  await auditService.log({
    action: 'auth.register',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    applicationId: application?.id,
    ...auditService.fromRequest(req),
    metadata: { email: user.email },
  });

  return user;
}

/**
 * Login con email + password.
 * - Aplica lockout tras N intentos fallidos.
 * - Actualiza last_login_at, last_login_ip.
 * - Emite par access + refresh.
 */
async function login(input, { req, application }) {
  const user = await User.findOne({
    where: { email: input.email },
    paranoid: true,
  });

  // Anti-enumeración: mismo error para email-no-existe y password-incorrecta
  const failGeneric = () => {
    throw new HttpError(401, 'InvalidCredentials', 'Email o password incorrectos');
  };

  if (!user) {
    await auditService.log({
      action: 'auth.login.failed',
      actorType: 'system',
      applicationId: application?.id,
      ...auditService.fromRequest(req),
      metadata: { reason: 'user_not_found', email: input.email },
    });
    failGeneric();
  }

  if (user.status === 'suspended') {
    throw new HttpError(403, 'AccountSuspended', 'Cuenta suspendida');
  }
  if (user.status === 'deleted') {
    failGeneric();
  }

  if (user.locked_until && user.locked_until > new Date()) {
    throw new HttpError(
      423,
      'AccountLocked',
      `Cuenta bloqueada. Reintenta tras ${user.locked_until.toISOString()}`
    );
  }

  const valid = await verifyPassword(input.password, user.password_hash);

  if (!valid) {
    const failed = (user.failed_login_attempts || 0) + 1;
    const updates = { failed_login_attempts: failed };
    if (failed >= config.security.loginMaxAttempts) {
      updates.locked_until = new Date(
        Date.now() + config.security.loginLockoutMinutes * 60 * 1000
      );
      updates.failed_login_attempts = 0;
    }
    await user.update(updates);

    await auditService.log({
      action: 'auth.login.failed',
      userId: user.id,
      actorType: 'system',
      applicationId: application?.id,
      ...auditService.fromRequest(req),
      metadata: { reason: 'bad_password', attempts: failed },
    });

    failGeneric();
  }

  if (user.status === 'pending') {
    throw new HttpError(
      403,
      'AccountPending',
      'Cuenta pendiente de verificación de email/teléfono'
    );
  }

  await user.update({
    failed_login_attempts: 0,
    locked_until: null,
    last_login_at: new Date(),
    last_login_ip: req.ip,
  });

  const roles = await getRoleNames(user.id);
  const tokens = await tokenService.issueTokenPair({
    user,
    roles,
    application,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  await auditService.log({
    action: 'auth.login.success',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    applicationId: application?.id,
    ...auditService.fromRequest(req),
  });

  return { user, roles, tokens };
}

/**
 * Refresh: rota el refresh, emite nuevo par. Detecta robo.
 */
async function refresh(refreshPlain, { req }) {
  let row;
  try {
    row = await tokenService.validateRefreshToken(refreshPlain);
  } catch (err) {
    if (err.code === 'REFRESH_REVOKED') {
      await auditService.log({
        action: 'auth.token.theft_detected',
        userId: err.userId,
        actorType: 'system',
        ...auditService.fromRequest(req),
        metadata: { family_id: err.familyId },
      });
      // Best-effort: notifica al user que su sesión fue comprometida
      notifyTheft(err.userId, req).catch((e) =>
        console.error('[notifyTheft] fallo:', e.message)
      );
      throw new HttpError(401, 'TokenTheftDetected', 'Sesión comprometida, vuelve a loguear');
    }
    throw new HttpError(401, 'InvalidRefreshToken', err.message);
  }

  const user = await User.findByPk(row.user_id);
  if (!user || user.status !== 'active') {
    throw new HttpError(401, 'Unauthorized', 'Usuario no activo');
  }

  const application = await Application.findByPk(row.application_id);
  if (!application || !application.is_active) {
    throw new HttpError(400, 'BadRequest', 'Aplicación inactiva');
  }

  const roles = await getRoleNames(user.id);

  const tokens = await tokenService.rotateTokenPair({
    user,
    roles,
    application,
    familyId: row.family_id,
    previousId: row.id,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  await auditService.log({
    action: 'auth.token.refreshed',
    userId: user.id,
    actorId: user.id,
    actorType: 'user',
    applicationId: application.id,
    ...auditService.fromRequest(req),
  });

  return { user, roles, tokens, application };
}

/**
 * Logout. Si trae refresh_token, revoca solo ese. Si all_devices=true,
 * revoca todos los del user.
 */
async function logout({ refreshPlain, allDevices, userId, req }) {
  if (allDevices) {
    await tokenService.revokeAllForUser(userId, 'logout');
  } else if (refreshPlain) {
    const { sha256 } = require('../utils/hash');
    const { RefreshToken } = require('../db/models');
    const hash = sha256(refreshPlain);
    await RefreshToken.update(
      { revoked_at: new Date(), revoked_reason: 'logout' },
      { where: { token_hash: hash, revoked_at: null } }
    );
  }

  await auditService.log({
    action: 'auth.logout',
    userId,
    actorId: userId,
    actorType: 'user',
    ...auditService.fromRequest(req),
    metadata: { all_devices: !!allDevices },
  });
}

async function me(userId) {
  const user = await User.findByPk(userId, {
    include: [
      { model: ClientProfile, as: 'clientProfile' },
      { association: 'adminProfile' },
    ],
  });
  if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');
  const roles = await getRoleNames(userId);
  return { user, roles };
}

/**
 * Manda email de seguridad al user cuya sesión fue comprometida.
 * Carga user + first_name + dispara email.
 */
async function notifyTheft(userId, req) {
  const { User, ClientProfile, AdminProfile } = require('../db/models');
  const user = await User.findByPk(userId);
  if (!user) return;
  let firstName = '';
  const cp = await ClientProfile.findOne({ where: { user_id: userId } });
  if (cp) firstName = cp.first_name;
  else {
    const ap = await AdminProfile.findOne({ where: { user_id: userId } });
    if (ap) firstName = ap.first_name;
  }
  await emailService.sendSecurityTheftEmail({
    to: user.email,
    firstName,
    ip: req.ip || 'desconocida',
    userAgent: req.get('user-agent') || 'desconocido',
    when: new Date().toISOString(),
  });
}

module.exports = {
  resolveApplication,
  register,
  login,
  refresh,
  logout,
  me,
  getRoleNames,
};
