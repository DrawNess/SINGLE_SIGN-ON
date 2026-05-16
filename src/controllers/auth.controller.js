'use strict';

const authService = require('../services/auth.service');

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

module.exports = { register, login, refresh, logout, me };
