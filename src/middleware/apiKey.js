'use strict';

const apiKeyService = require('../services/apiKey.service');
const { HttpError } = require('./errorHandler');

/**
 * Middleware que verifica Bearer token tipo API key (`sk_live_...`).
 * Si OK → setea `req.apiKey` y `req.application`.
 * Si scopes provistos → exige todos.
 *
 * Uso:
 *   router.get('/users/:id', requireApiKey('users:read'), handler);
 */
function requireApiKey(...requiredScopes) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return next(new HttpError(401, 'Unauthorized', 'Bearer token requerido'));
    }
    if (!token.startsWith('sk_')) {
      return next(
        new HttpError(401, 'Unauthorized', 'Se esperaba una API key (prefijo sk_)')
      );
    }

    try {
      const key = await apiKeyService.validateApiKey(token, { ip: req.ip });

      // Check scopes
      for (const scope of requiredScopes) {
        if (!key.scopes.includes(scope)) {
          return next(
            new HttpError(403, 'InsufficientScope', `Falta scope: ${scope}`)
          );
        }
      }

      req.apiKey = key;
      req.application = key.application;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireApiKey };
