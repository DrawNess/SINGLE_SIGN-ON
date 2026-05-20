'use strict';

const authService = require('../services/auth.service');
const verificationService = require('../services/verification.service');
const passwordService = require('../services/password.service');
const invitationService = require('../services/invitation.service');
const userService = require('../services/user.service');
const { User } = require('../db/models');
const { HttpError } = require('../middleware/errorHandler');
const {
  setRefreshCookie,
  clearRefreshCookie,
  shouldUseCookie,
  COOKIE_NAME,
} = require('../utils/cookies');

/**
 * Emite los tokens al cliente según el tipo de application:
 * - spa-web → refresh en cookie httpOnly, omitido del JSON
 * - otros (mobile/desktop/service) → refresh en JSON body
 */
function respondWithTokens(res, application, payload) {
  if (shouldUseCookie(application)) {
    setRefreshCookie(
      res,
      payload.refresh_token,
      payload.refresh_token_expires_at
    );
    const { refresh_token, ...rest } = payload;
    return res.json({ ...rest, refresh_in: 'cookie' });
  }
  return res.json(payload);
}

/**
 * Extrae refresh_token del body o cookie.
 */
function extractRefreshToken(req) {
  return req.body?.refresh_token || req.cookies?.[COOKIE_NAME] || null;
}

async function register(req, res, next) {
  try {
    const application = await authService.resolveApplication(
      req.get('X-Client-Id')
    );
    const user = await authService.register(req.body, { req, application });
    res.status(201).json({
      message: 'Cuenta creada',
      user: user.toJSON(),
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const application = await authService.resolveApplication(
      req.get('X-Client-Id')
    );
    const { user, roles, tokens } = await authService.login(req.body, {
      req,
      application,
    });
    respondWithTokens(res, application, {
      user: { ...user.toJSON(), roles },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const refreshToken = extractRefreshToken(req);
    if (!refreshToken) {
      throw new HttpError(
        400,
        'BadRequest',
        'refresh_token requerido (body o cookie)'
      );
    }
    const { user, roles, tokens, application } = await authService.refresh(
      refreshToken,
      { req }
    );
    respondWithTokens(res, application, {
      user: { ...user.toJSON(), roles },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const refreshToken = extractRefreshToken(req);
    await authService.logout({
      refreshPlain: refreshToken,
      allDevices: !!req.body?.all_devices,
      userId: req.auth.userId,
      req,
    });
    if (req.cookies?.[COOKIE_NAME]) {
      clearRefreshCookie(res);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const { user, roles } = await authService.me(req.auth.userId);
    res.json({ user: { ...user.toJSON(), roles } });
  } catch (err) {
    next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const token = req.body?.token || req.query?.token;
    if (!token) throw new HttpError(400, 'BadRequest', 'token requerido');
    const { mode } = await verificationService.consumeToken(token, { req });
    res.json({
      message:
        mode === 'email_change'
          ? 'Email cambiado correctamente. Inicia sesión nuevamente.'
          : 'Email verificado. Tu cuenta está activa.',
      mode,
    });
  } catch (err) {
    next(err);
  }
}

async function resendVerification(req, res, next) {
  try {
    await verificationService.resendRegistrationVerification(req.body.email, { req });
    // Respuesta genérica anti-enumeración
    res.json({
      message:
        'Si el correo está registrado y pendiente de verificación, recibirás un nuevo email.',
    });
  } catch (err) {
    next(err);
  }
}

async function changeEmail(req, res, next) {
  try {
    const user = await User.findByPk(req.auth.userId);
    if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');
    await verificationService.startEmailChange({
      user,
      newEmail: req.body.new_email,
      currentPassword: req.body.current_password,
      req,
    });
    res.json({
      message:
        'Te enviamos un correo a la nueva dirección. Confirma para completar el cambio.',
    });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    await passwordService.startForgotPassword(req.body.email, { req });
    // Respuesta genérica anti-enumeración
    res.json({
      message:
        'Si el correo está registrado, recibirás un email para restablecer tu contraseña.',
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    await passwordService.resetPassword({
      token: req.body.token,
      newPassword: req.body.new_password,
      req,
    });
    res.json({
      message: 'Contraseña actualizada. Inicia sesión con tus nuevas credenciales.',
    });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const user = await User.findByPk(req.auth.userId);
    if (!user) throw new HttpError(404, 'NotFound', 'Usuario no encontrado');
    await passwordService.changePassword({
      user,
      currentPassword: req.body.current_password,
      newPassword: req.body.new_password,
      req,
    });
    res.json({
      message: 'Contraseña cambiada. Inicia sesión nuevamente en todos tus dispositivos.',
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// Self-service: PATCH /me, GET/DELETE sessions
// ============================================================

async function updateMe(req, res, next) {
  try {
    const result = await userService.updateMyProfile(req.auth.userId, req.body, { req });
    const userJson = result.user.toJSON();
    res.json({
      user: { ...userJson, roles: result.roles },
      profile: result.profile.toJSON(),
      profile_type: result.profileType,
    });
  } catch (err) {
    next(err);
  }
}

async function listMySessions(req, res, next) {
  try {
    const sessions = await userService.listMySessions(req.auth.userId, req.auth.sid);
    res.json({
      items: sessions,
      total: sessions.length,
    });
  } catch (err) {
    next(err);
  }
}

async function revokeMySession(req, res, next) {
  try {
    await userService.revokeMySession(req.auth.userId, req.params.id, { req });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function logoutOthers(req, res, next) {
  try {
    const result = await userService.logoutOthers(req.auth.userId, req.auth.sid, { req });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function acceptInvitation(req, res, next) {
  try {
    const application = await authService.resolveApplication(
      req.get('X-Client-Id')
    );
    const { user, role } = await invitationService.acceptInvitation({
      token: req.body.token,
      password: req.body.password,
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      jobTitle: req.body.job_title,
      department: req.body.department,
      phone: req.body.phone,
      req,
    });

    // Login automático tras aceptar
    const tokenService = require('../services/token.service');
    const roles = [role];
    const tokens = await tokenService.issueTokenPair({
      user,
      roles,
      application,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    respondWithTokens(res.status(201), application, {
      message: 'Invitación aceptada. Cuenta creada.',
      user: { ...user.toJSON(), roles },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  updateMe,
  listMySessions,
  revokeMySession,
  logoutOthers,
  verifyEmail,
  resendVerification,
  changeEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  acceptInvitation,
};
