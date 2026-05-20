'use strict';

const config = require('../config/env');

const COOKIE_NAME = 'refresh_token';

/**
 * Setea el refresh_token como cookie httpOnly + Secure + SameSite=Strict.
 * Solo se usa para applications type=spa-web.
 *
 * @param {Response} res
 * @param {string} plainToken
 * @param {Date|string} expiresAt
 */
function setRefreshCookie(res, plainToken, expiresAt) {
  const expires =
    expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const maxAge = Math.max(0, expires.getTime() - Date.now());

  res.cookie(COOKIE_NAME, plainToken, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: config.cookie.refreshPath,
    domain: config.cookie.domain,
    maxAge,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    path: config.cookie.refreshPath,
    domain: config.cookie.domain,
  });
}

/**
 * Decide si una application debe usar cookie en lugar de body JSON.
 * SPA web → cookie (más seguro vs XSS).
 * Mobile/desktop/service → body (sin manejo de cookies).
 */
function shouldUseCookie(application) {
  return application && application.type === 'spa-web';
}

module.exports = {
  setRefreshCookie,
  clearRefreshCookie,
  shouldUseCookie,
  COOKIE_NAME,
};
