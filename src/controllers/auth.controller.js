'use strict';

const authService = require('../services/auth.service');
const verificationService = require('../services/verification.service');
const passwordService = require('../services/password.service');
const invitationService = require('../services/invitation.service');
const { User } = require('../db/models');
const { HttpError } = require('../middleware/errorHandler');

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
    res.json({
      user: { ...user.toJSON(), roles },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { user, roles, tokens } = await authService.refresh(
      req.body.refresh_token,
      { req }
    );
    res.json({
      user: { ...user.toJSON(), roles },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout({
      refreshPlain: req.body?.refresh_token,
      allDevices: !!req.body?.all_devices,
      userId: req.auth.userId,
      req,
    });
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

    res.status(201).json({
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
  verifyEmail,
  resendVerification,
  changeEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  acceptInvitation,
};
