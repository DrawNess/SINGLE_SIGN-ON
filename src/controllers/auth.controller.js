'use strict';

const authService = require('../services/auth.service');
const verificationService = require('../services/verification.service');
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

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  verifyEmail,
  resendVerification,
  changeEmail,
};
