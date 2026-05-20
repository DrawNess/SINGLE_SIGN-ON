'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const { HttpError } = require('./errorHandler');

/**
 * Verifica el JWT del header `Authorization: Bearer <token>`.
 * Si válido → pone `req.auth = { userId, roles, audience, appId, claims }`.
 * Si no → 401.
 *
 * Opcional: pasar { audience: 'ecommerce' } para forzar verificación de aud.
 */
function requireAuth(options = {}) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return next(new HttpError(401, 'Unauthorized', 'Bearer token requerido'));
    }

    try {
      const claims = verifyAccessToken(token, { audience: options.audience });
      req.auth = {
        userId: claims.sub,
        roles: claims.roles || [],
        audience: claims.aud,
        appId: claims.app_id,
        sid: claims.sid || null,
        claims,
      };
      next();
    } catch (err) {
      const msg =
        err.name === 'TokenExpiredError'
          ? 'Token expirado'
          : err.name === 'JsonWebTokenError'
            ? 'Token inválido'
            : 'No autenticado';
      next(new HttpError(401, 'Unauthorized', msg));
    }
  };
}

module.exports = { requireAuth };
