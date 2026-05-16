'use strict';

const { HttpError } = require('./errorHandler');

/**
 * Requiere que el usuario tenga al menos uno de los roles indicados.
 * Debe ejecutarse DESPUÉS de `requireAuth()`.
 *
 * Uso:
 *   router.delete('/users/:id', requireAuth(), requireRole('admin', 'super_admin'), ...)
 */
module.exports = function requireRole(...allowed) {
  return (req, res, next) => {
    const userRoles = req.auth?.roles || [];
    if (!userRoles.some((r) => allowed.includes(r))) {
      return next(new HttpError(403, 'Forbidden', 'Permiso insuficiente'));
    }
    next();
  };
};
